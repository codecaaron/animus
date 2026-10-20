//! What a module's components hand to code the analysis cannot see.
//!
//! One walk follows two kinds of value: a top-level function's inputs (its
//! parameters and what derives from them, `this` in a class, `arguments`)
//! and the elements the module builds, each carrying the component tags it
//! holds. From every occurrence of such a value the walk climbs the syntax
//! tree. Each position it reaches is judged by `Walk::place`, the one list
//! of what keeps a value where React renders it ([`InPlace`]), carries it on
//! to its parent, binds it, or hands it to a receiving element, whose own
//! record judges it. A position stays in place only where nothing the
//! analysis cannot see can run there with the value: any other position,
//! an expression shape the walk does not know included, hands the value to
//! unknown code, a forwarding record.
//!
//! What the allowlist trusts by name (the built-ins it lists, React's
//! functions, the prototypes their methods come from) is proven against the
//! analysed code: any analysed write that could redirect one of them (into
//! a global or React, into any object the module does not own, or of a
//! built-in's method name or by a bracketed key into a binding that may
//! hold a prototype), or any use that lets one escape as a value the walk
//! cannot follow, leaves no usage proven (`FileFacts::patches_intrinsics`).
//! Code outside the analysis is assumed not to redirect them: the trust
//! every static analyser places in the platform and the framework it
//! targets. Analysed code that runs a string (an indirect `eval`,
//! `Function`, a called `constructor`) is not outside it, and leaves no
//! usage proven either.
//!
//! An input's caller may have put any key on it, the props object React
//! builds included (`toString={…}`, or a spread of what its own caller
//! gave it): converting, iterating, awaiting or stringifying an input
//! hands it outside, and only the positions that run none of its code
//! (`typeof`, `!`, a truth test, `===`) keep it. React reads what it gets
//! as at an element, where a value the caller built with hooks
//! (`Held::hookable`) is handed outside.

use oxc::ast::ast::{
    AssignmentOperator, AssignmentTarget, BindingPattern, CallExpression, Class, Expression, Function,
    IdentifierReference, ImportDeclarationSpecifier, JSXElement, JSXElementName, MethodDefinitionKind,
    ObjectPropertyKind, Program, PropertyKey, PropertyKind, Statement, StaticMemberExpression,
};
use oxc::ast::AstKind;
use oxc::ast_visit::Visit;
use oxc::semantic::{ScopeId, Scoping, SymbolFlags, SymbolId};
use oxc::span::{GetSpan, Span};
use oxc::syntax::operator::{BinaryOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use super::{
    is_erased_wrapper, ComponentBody, jsx_member_path, jsx_member_root, tag_origin, ElementConst, Inputs, IntrinsicPatch, MemberEffect,
    OpaqueCall, OpaqueTag, Polymorphic, PropKey, PropReach, SiteShape, SpreadArg, TagOrigin,
};
use crate::chain_walk::{unwrap_type_assertions, ChainDescriptor};

/// The positions that keep a value where React renders it, or with code
/// the analysis reads, each with why. A position not listed hands the
/// value to unknown code. "Hookable" below means the value may be an
/// object this module built whose own properties hold code that a
/// conversion, an iteration, a property read, an `await` or a disposal runs
/// (`Held::hookable`): no listed position keeps a hookable value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InPlace {
    /// What a component (or a class's `render`) returns: React renders it.
    /// A host element (`<div>`, not a custom element's attributes) carries
    /// its children, attributes and spreads on with itself, as do React's
    /// own components (`Fragment`, `Suspense`); React DOM sets attributes,
    /// and an event handler receives an event, not the value.
    Rendered,
    /// What a function bound to a local, or a class method, returns: each
    /// call through the binding or `this` carries the result on from where
    /// it is. A call of a function value carries the value on as its
    /// result.
    Returned,
    /// A position that yields a primitive and runs no code of the value's
    /// but its own: a truth test (`if` and loop tests, the test of `?:`),
    /// `!`, `typeof`, `void`, `===` and `!==`, `switch` and `case`, the right
    /// side of `in` and `#x in`, the right side of `for…in`, and a
    /// conversion (arithmetic, a comparison, `+=`, `++`, an untagged
    /// template, a computed key, a converting built-in such as `String` or
    /// `Math.max`) of a value that is neither hookable nor an input: what
    /// converts it is its own conversion, which sees only itself. `&&`,
    /// `||` and `??` carry their operands on.
    Primitive,
    /// A statement that discards the value (an expression statement, a
    /// sequence's earlier expressions, a block reached other than through a
    /// `return`), a write into the value (the target of a plain or logical
    /// assignment, `delete`), or an element's own tag name.
    Discarded,
    /// A binding holds it: a declarator's initializer, a default value, an
    /// assignment to a local, a store into a plain object or array literal
    /// the function owns (`Module::in_place`), or a `for…of` declaration.
    /// The binding's reads carry it on.
    Bound,
    /// React's own code that keeps what it gets in React: a state setter
    /// (React hands its argument back as the state, which the state binding
    /// then holds, and its updater sees the state), `setState` on a class
    /// that extends React's `Component` and nothing can override, the
    /// constructor of React's `Component`, `createPortal`, a DOM root's
    /// `render`, React DOM's `render`, `hydrate` and `hydrateRoot`, and the
    /// server renderers `renderToString`, `renderToStaticMarkup`,
    /// `renderToPipeableStream` and `renderToReadableStream`.
    KeptByReact,
    /// A built-in that reads its argument without running any of its code:
    /// `Boolean`, `Array.isArray`, `Number.isFinite`, `Number.isNaN`,
    /// and `Object.is`.
    Builtin,
    /// A call inside an Animus builder chain, which the engine reads.
    Builder,
    /// An export: a module that imports it is analysed, or is outside the
    /// analysis as the module's escapes say.
    Exported,
    /// A class field's value, a store into `this` that runs no setter
    /// (`ClassFacts::plain_store`), a call of the class's own method through
    /// `this` (`ClassFacts::own_method`), or a member's definition: kept on
    /// the instance React owns, where `this` reads it back. A ref to the
    /// instance is judged at the element that sets it (`OpaqueTag::exposed`);
    /// an element is never kept on the instance.
    Instance,
    /// A child or attribute of a component element: the element's own
    /// record (`OpaqueTag`) judges whether its receiver keeps it in place.
    Received,
}

/// What a value may carry: the component's inputs, the component tags of
/// the elements it holds, the imports it reads, which may hold more
/// elements (`ElementConst`), and whether it may be a hookable object.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Held {
    inputs: Inputs<Name>,
    /// The value may be an object this module built whose own properties
    /// hold code that converting, iterating, reading, awaiting or disposing
    /// of it runs, with the object as `this`: a getter, a computed or
    /// spread property, a property named for a conversion or `then`, or a
    /// prototype it sets (`Declarations::hookable_objects`), or one a
    /// computed or hook-named store reached, or into an array any named
    /// store (`hookable_bindings`, `named_stores`).
    hookable: bool,
    tags: BTreeSet<Name>,
    imports: BTreeSet<SymbolId>,
}

/// A component tag, interned by the module's walk (`Names`): a value is
/// copied, joined and compared as one number, and named only in
/// `Module::finish`.
type Name = u32;

/// The component tags a module's walk has met, each under one `Name`.
#[derive(Default)]
struct Names {
    ids: FxHashMap<String, Name>,
    texts: Vec<String>,
}

impl Names {
    fn id(&mut self, name: &str) -> Name {
        if let Some(id) = self.ids.get(name) {
            return *id;
        }
        let id = self.texts.len() as Name;
        self.ids.insert(name.to_string(), id);
        self.texts.push(name.to_string());
        id
    }

    /// The names of `ids`, in name order.
    fn texts(&self, ids: &BTreeSet<Name>) -> BTreeSet<String> {
        ids.iter().map(|id| self.texts[*id as usize].clone()).collect()
    }
}

impl Held {
    /// Whether it carries nothing a receiver could read.
    fn is_empty(&self) -> bool {
        !self.inputs.any() && !self.has_elements()
    }

    fn has_elements(&self) -> bool {
        !self.tags.is_empty() || !self.imports.is_empty()
    }

    /// Adds `other`, saying whether anything was new.
    fn join(&mut self, other: &Held) -> bool {
        // A value that may be the props object or one of its members holds
        // every input, and its members are no props.
        let inputs = if matches!((&self.inputs, &other.inputs), (Inputs::Named(_), Inputs::AllBut(_)) | (Inputs::AllBut(_), Inputs::Named(_))) {
            self.inputs = Inputs::Every;
            true
        } else {
            self.inputs.join(&other.inputs)
        };
        let mut grew = inputs || (!self.hookable && other.hookable);
        self.hookable |= other.hookable;
        for tag in &other.tags {
            grew |= self.tags.insert(*tag);
        }
        for import in &other.imports {
            grew |= self.imports.insert(*import);
        }
        grew
    }

    /// The elements alone, as a function's result carries them to its
    /// callers, without the inputs of the function they came from.
    fn elements(&self) -> Held {
        Held { inputs: Inputs::None, hookable: self.hookable, tags: self.tags.clone(), imports: self.imports.clone() }
    }

    fn hooked(&self) -> Held {
        Held { hookable: true, ..self.clone() }
    }

    /// Whether converting, iterating or awaiting it may run hooks: of an
    /// object this module built (`hookable`), or of an input, whose caller
    /// may have put any key on it, the props object React builds included.
    fn runs_hooks(&self) -> bool {
        self.hookable || self.inputs.any()
    }

    const INPUTS: Held = Held { inputs: Inputs::Every, hookable: false, tags: BTreeSet::new(), imports: BTreeSet::new() };

    /// The value's member `name`, when the member is read off it.
    fn member(&self, name: Name) -> Held {
        Held { inputs: self.inputs.member(name), ..self.clone() }
    }
}

/// What a call does with what its arguments carry.
enum Callee {
    /// Keeps it in place.
    Kept(InPlace),
    /// A built-in that converts what it gets to a primitive (`String`,
    /// `parseInt`, `Math`'s and `console`'s methods, `JSON.stringify`): a hookable
    /// value or an input hands its hooks the value. With `callbacks`, a
    /// callback (`JSON.stringify`'s replacer) receives it.
    Converts { callbacks: bool },
    /// Returns what it gets: React's functions and hooks, a built-in array
    /// method on an array built in place, `Object.keys`, `Object.entries`,
    /// `Object.values`, `Object.fromEntries`, `Array.of`, `Array.from`, the
    /// scheduling globals. The result carries the arguments on, and a callback the
    /// module declares receives them (`Walk::callbacks`). One that calls the
    /// callbacks it gets at the positions `calls` lists (an array method's
    /// first, `Children.map`'s and `Array.from`'s second, `setTimeout`'s
    /// first) makes any other function there unknown code that receives
    /// them. A hookable value is handed: these read or iterate it; so is an
    /// input anywhere but a position they call, React's own functions
    /// aside.
    PassThrough { calls: &'static [usize] },
    /// React's state setter, by the state bindings its hook returned.
    State(Vec<SymbolId>),
    /// `this.setState` on a class `ClassFacts::react_state` proves.
    ClassState,
    /// A function or class the module declares at the top, or an import:
    /// the analysis judges it by name, and its result may carry them on.
    Named(String),
    /// A function a component body declares and never reassigns, whose
    /// parameters receive them and whose result carries them on.
    Local(ScopeId),
    /// A read method of an exported or imported `const` array that every
    /// reference here reads in place, named for the analysis to judge: a
    /// built-in, as an array's `PassThrough`, while the array is held
    /// (`FileFacts::held_arrays`), and unknown code otherwise: by the
    /// callee's name (`rows.map`) and the array's.
    HeldArray { callee: String, array: String },
    /// A write method of an array built in place (`ARRAY_WRITE_METHODS`):
    /// the array binding, if any, holds what it gets.
    Stores(Option<SymbolId>),
    /// Code the analysis cannot see.
    Unknown,
}

/// The array methods that read an array in place: none calls code but the
/// callbacks it gets.
const ARRAY_READ_METHODS: [&str; 27] = [
    "at", "concat", "entries", "every", "filter", "find", "findIndex", "findLast", "findLastIndex", "flat", "flatMap",
    "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "reduce", "reduceRight", "slice", "some",
    "toReversed", "toSorted", "toSpliced", "values", "with",
];

/// The read methods whose callback gets the array itself, by the position
/// of that parameter.
const ARRAY_CALLBACK_METHODS: [(&str, usize); 12] = [
    ("every", 2), ("filter", 2), ("find", 2), ("findIndex", 2), ("findLast", 2), ("findLastIndex", 2),
    ("flatMap", 2), ("forEach", 2), ("map", 2), ("some", 2), ("reduce", 3), ("reduceRight", 3),
];

/// The array methods that store what they get in the array, and call
/// nothing.
const ARRAY_WRITE_METHODS: [&str; 4] = ["push", "unshift", "splice", "fill"];

/// Own property names a conversion, `await`, JSON or React runs as code:
/// React iterates `'@@iterator'`, renders an object whose `$$typeof` marks
/// an element by calling its `type`, and calls a lazy's `_init`.
const HOOK_KEYS: [&str; 9] =
    ["toString", "valueOf", "toLocaleString", "toJSON", "then", "__proto__", "@@iterator", "$$typeof", "_init"];

/// Globals whose prototype an analysed write could change for every value.
const INTRINSICS: [&str; 14] = [
    "Array", "Object", "Function", "String", "Number", "Boolean", "Symbol", "Promise", "Map", "Set", "RegExp",
    "Iterator", "Date", "Error",
];

/// The globals that read what they get and run none of its code.
const READ_GLOBALS: [&str; 1] = ["Boolean"];

/// The globals that convert what they get to a primitive.
const CONVERTING_GLOBALS: [&str; 9] = [
    "String", "Number", "isNaN", "isFinite", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent", "Symbol",
];

/// The globals that schedule the callbacks they get.
const SCHEDULING_GLOBALS: [&str; 5] = ["setTimeout", "setInterval", "queueMicrotask", "requestAnimationFrame", "requestIdleCallback"];

/// The methods of `Math` the allowlist trusts: any other member is unknown
/// code.
const MATH_METHODS: [&str; 37] = [
    "abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "cbrt", "ceil", "clz32", "cos", "cosh", "exp", "expm1",
    "f16round", "floor", "fround", "hypot", "imul", "log", "log10", "log1p", "log2", "max", "min", "pow", "random", "round",
    "sign", "sin", "sinh", "sqrt", "sumPrecise", "tan", "tanh", "trunc",
];

/// The methods of `console` the allowlist trusts: any other member is
/// unknown code.
const CONSOLE_METHODS: [&str; 21] = [
    "assert", "clear", "count", "countReset", "debug", "dir", "dirxml", "error", "group", "groupCollapsed", "groupEnd", "info",
    "log", "table", "time", "timeEnd", "timeLog", "timeStamp", "trace", "warn", "profile",
];

/// The statics the allowlist trusts on `Object`, `Array`, `Number` and
/// `JSON` beyond the array methods' names.
const TRUSTED_STATICS: [&str; 8] = ["is", "fromEntries", "isArray", "of", "from", "isFinite", "isNaN", "stringify"];

/// The globals the allowlist trusts by name, beside `INTRINSICS` and the
/// global functions above: read off the global object (`window.Math`) and
/// let go, one could be redirected.
const TRUSTED_GLOBALS: [&str; 9] = ["Math", "JSON", "Reflect", "console", "React", "ReactDOM", "Proxy", "WeakMap", "WeakSet"];

/// Whether the allowlist trusts the global `name`.
fn trusted_global(name: &str) -> bool {
    [&TRUSTED_GLOBALS[..], &INTRINSICS, &GLOBAL_OBJECTS, &READ_GLOBALS, &CONVERTING_GLOBALS, &SCHEDULING_GLOBALS]
        .iter()
        .any(|names| names.contains(&name))
}

/// The names of the global object: a trusted global is a member of it.
const GLOBAL_OBJECTS: [&str; 4] = ["globalThis", "window", "self", "global"];

/// What one module's walk records.
#[derive(Default)]
pub(super) struct Records {
    pub calls: Vec<OpaqueCall>,
    pub tags: Vec<OpaqueTag>,
    pub element_consts: BTreeMap<String, ElementConst>,
    /// See `FileFacts::held_arrays`.
    pub held_arrays: BTreeSet<String>,
    /// See `FileFacts::misused_imports`.
    pub misused_imports: BTreeSet<String>,
    /// See `FileFacts::class_components`.
    pub classes: BTreeSet<String>,
    /// See `FileFacts::patches_intrinsics`.
    pub patches_intrinsics: Option<IntrinsicPatch>,
    /// See `FileFacts::outside_let_goes`.
    pub outside_let_goes: Vec<(u32, String)>,
    /// See `FileFacts::keyed_stores`.
    pub keyed_stores: Vec<(u32, String)>,
    /// See `FileFacts::rewrites_object`.
    pub rewrites_object: bool,
    /// See `FileFacts::child_cloners`.
    pub child_cloners: BTreeMap<String, bool>,
}

/// What the walk reads that a later change can grow: the unit that read
/// one is walked again when it grows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Key {
    Held(SymbolId),
    Returns(ScopeId),
    Arguments(ScopeId),
    /// What reaches a receiving element, by its span, which the element's
    /// own climb carries.
    Receiver(u32),
}

/// What the fixpoint walks again: a top-level statement, by index, or a
/// function inside one, by its span, which the walk re-enters where it
/// first found it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum Unit {
    Statement(usize),
    Function(u32),
}

/// Where the walk first found a function: what it needs to walk the
/// function again on its own.
#[derive(Clone)]
struct Context<'a> {
    function: FunctionNode<'a>,
    ancestors: Vec<AstKind<'a>>,
    depth: usize,
    class: Vec<u32>,
    top: Rc<[String]>,
}

#[derive(Clone, Copy)]
enum FunctionNode<'a> {
    Function(&'a Function<'a>, oxc::syntax::scope::ScopeFlags),
    Arrow(&'a oxc::ast::ast::ArrowFunctionExpression<'a>),
}

/// The forwarding records, receiving elements, element-holding top-level
/// bindings and held arrays of `program`, whose `exported` locals other
/// modules may read.
pub(super) fn forwarding<'a>(
    program: &Program<'a>,
    scoping: &Scoping,
    chains: &[&ChainDescriptor],
    exported: &FxHashSet<&str>,
    aliases: &super::LocalAliases,
) -> Records {
    let mut module = Module::of(program, scoping, chains, exported);
    module.aliases = aliases.elements.clone();
    let tops: Vec<Rc<[String]>> = program.body.iter().map(|statement| top_level_names(statement).into()).collect();
    let mut contexts: FxHashMap<u32, Context<'a>> = FxHashMap::default();
    // Every statement is walked once, in order; then each unit that read
    // something before it grew is walked again, until nothing grows. A unit
    // is the innermost function around a read, so a change inside one
    // function walks that function again, not the statement around it. The
    // unit that went stale last is walked first, so a change runs down a
    // chain of callers before a reader of the whole chain walks again; a
    // unit already pending keeps its place.
    let mut readers: FxHashMap<Key, FxHashSet<Unit>> = FxHashMap::default();
    let mut pending: Vec<Unit> = Vec::new();
    let mut queued: FxHashSet<Unit> = FxHashSet::default();
    let mut first = (0..program.body.len()).map(Unit::Statement);
    while let Some(unit) = first.next().or_else(|| pending.pop()) {
        queued.remove(&unit);
        module.unit = unit;
        match unit {
            Unit::Statement(index) => {
                let mut walk = Walk::new(&mut module, &mut contexts, Rc::clone(&tops[index]), Vec::new(), 0, Vec::new());
                walk.visit_statement(&program.body[index]);
            }
            Unit::Function(start) => {
                let Context { function, ancestors, depth, class, top } = contexts[&start].clone();
                let mut walk = Walk::new(&mut module, &mut contexts, top, ancestors, depth, class);
                match function {
                    FunctionNode::Function(function, flags) => walk.visit_function(function, flags),
                    FunctionNode::Arrow(arrow) => walk.visit_arrow_function_expression(arrow),
                }
            }
        }
        let reads = std::mem::take(&mut module.reads);
        for (reader, key) in reads.keys() {
            readers.entry(*key).or_default().insert(*reader);
        }
        for (key, at) in std::mem::take(&mut module.changed) {
            for reader in readers.get(&key).into_iter().flatten() {
                // This walk saw what grew after it read it.
                let stale = reads.get(&(*reader, key)).is_none_or(|read| *read < at);
                if stale && queued.insert(*reader) {
                    pending.push(*reader);
                }
            }
        }
    }
    module.finish()
}

/// What one module's walk knows and has found.
struct Module<'s> {
    scoping: &'s Scoping,
    /// Import binding → module specifier.
    sources: FxHashMap<SymbolId, String>,
    namespaces: FxHashSet<SymbolId>,
    react: super::ReactImports,
    chain_spans: Vec<(u32, u32)>,
    /// The arrays whose methods the walk knows.
    arrays: Arrays,
    /// Each function's parameter bindings, by its scope.
    params: FxHashMap<ScopeId, Vec<SymbolId>>,
    /// Each function's parameter bindings with the input each holds.
    param_inputs: FxHashMap<ScopeId, Vec<(SymbolId, ParamInput)>>,
    /// A component's parameter bindings of its props object and of its `as`
    /// (`ParamInput::Props`, `ParamInput::AsType`), and those that hold only
    /// what its caller wrote but `asChild` (`ParamInput::caller`).
    props_params: FxHashSet<SymbolId>,
    as_types: FxHashSet<SymbolId>,
    caller_params: FxHashSet<SymbolId>,
    /// A component's parameter bindings of its `asChild` (`ParamInput::AsChild`).
    as_child_params: FxHashSet<SymbolId>,
    /// See `Declarations::reshaped_beyond_clones`.
    reshaped_beyond_clones: FxHashSet<SymbolId>,
    /// The imports of Animus's `renderAsChild`.
    slot_renders: FxHashSet<SymbolId>,
    /// See `Records::child_cloners`.
    child_cloners: BTreeMap<String, bool>,
    /// The function a binding is declared to.
    functions: FxHashMap<SymbolId, ScopeId>,
    /// Bindings a function body declares, and never reassigns, to an array
    /// literal or to an object literal of plain data properties (no
    /// accessor, no `__proto__`): a store of a property into one runs no
    /// code, unless a store made it hookable (`Held::hookable`), which
    /// hands it on at every member (`Walk::read_through`).
    in_place: FxHashSet<SymbolId>,
    /// See `Declarations::reshaped`.
    reshaped: FxHashSet<SymbolId>,
    /// React's state setters, with the state bindings their hook returned
    /// (`const [s, set] = useState()`): one is React's only while nothing
    /// reassigns it (`Walk::callee_of`).
    setters: FxHashMap<SymbolId, Vec<SymbolId>>,
    /// A state hook's call, by its start, and the state bindings it returns:
    /// the reducer and initializer it gets see the state.
    hook_states: FxHashMap<u32, Vec<SymbolId>>,
    /// The scopes of the functions bound to a name, whose call sites carry
    /// what they return.
    bound: FxHashSet<ScopeId>,
    /// Every class, by its span.
    classes: FxHashMap<u32, ClassFacts>,
    /// The object literals that may be hookable (`Held::hookable`), by span.
    hookable_objects: FxHashSet<u32>,
    /// What each binding may hold.
    held: FxHashMap<SymbolId, Held>,
    /// What each function bound to a name, or class method, returns to its
    /// callers, by scope.
    returns: FxHashMap<ScopeId, Held>,
    /// What each function's calls pass it, which `arguments` reads, by scope.
    arguments: FxHashMap<ScopeId, Held>,
    /// The component tags inside each component element, by span: syntax
    /// alone gives them, once.
    element_tags: FxHashMap<u32, BTreeSet<Name>>,
    /// See `LocalAliases::elements`: each alias element's tags.
    aliases: FxHashMap<u32, Vec<(String, TagOrigin)>>,
    names: Names,
    /// The functions a top-level statement declares (a component, a helper,
    /// a class method): their parameters are inputs, and React or the
    /// module's callers receive what they return.
    roots: FxHashSet<ScopeId>,
    /// The unit being walked, what each unit the walk passed through read,
    /// each when it first read it, and what grew since the last walk, each
    /// when it grew, by a clock that each growth advances.
    unit: Unit,
    reads: FxHashMap<(Unit, Key), u64>,
    changed: Vec<(Key, u64)>,
    clock: u64,
    /// Forwarding records: by site, callee and the array whose read method
    /// it is, what reaches it.
    sinks: BTreeMap<(u32, Option<String>, Option<String>), Reached>,
    /// Receiving elements, by span.
    receivers: BTreeMap<u32, Receiver>,
    /// The elements a default export holds, which no binding names.
    default: Held,
    /// See `FileFacts::patches_intrinsics`.
    patches_intrinsics: Option<IntrinsicPatch>,
    /// See `FileFacts::outside_let_goes`.
    outside_let_goes: Vec<(u32, String)>,
    /// See `FileFacts::keyed_stores`.
    keyed_stores: Vec<(u32, String)>,
    /// See `FileFacts::rewrites_object`.
    rewrites_object: bool,
    /// The module's top-level class bindings, declared or `const X = class`.
    class_names: BTreeSet<String>,
}

/// What reaches a forwarding record, and the top-level bindings around it.
struct Reached {
    top: Rc<[String]>,
    held: Held,
}

/// A receiving element's record: its tag, origin and polymorphism, whether
/// a ref can read the instance it renders, and what reaches its children
/// and attributes.
struct Receiver {
    tag: String,
    origin: TagOrigin,
    /// The other tags an alias element may render (`OpaqueTag::also`).
    also: Vec<(String, TagOrigin)>,
    polymorphic: Polymorphic,
    site: SiteShape,
    exposed: bool,
    reached: Reached,
    /// What reaches it through each prop (`PropKey`, its name interned).
    props: BTreeMap<WalkProp, Held>,
}

/// `PropKey`, with the prop's name interned by the walk (`Names`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum WalkProp {
    Children,
    Named(Name),
    Spread,
}

/// What a class's base is.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Base {
    None,
    /// React's `Component` or `PureComponent`.
    React,
    /// Any other base, by the name the analysis can judge it by: a class
    /// the module declares at its top, or an import.
    Other(Option<String>),
}

/// What a class declares and how its code uses `this`.
struct ClassFacts {
    base: Base,
    /// Its instance methods (not accessors), by name.
    methods: FxHashMap<String, ScopeId>,
    /// Every instance member name it declares other than its methods:
    /// fields and accessors.
    members: FxHashSet<String>,
    accessors: FxHashSet<String>,
    /// The members code inside the class writes through `this`.
    written: FxHashSet<String>,
    /// Whether code inside the class uses `this` other than to read, call
    /// or write a member by name.
    this_escapes: bool,
    /// Whether nothing outside can reshape an instance: the class is never
    /// exported, and every reference to it is a JSX tag, so no code
    /// subclasses it or reaches its prototype.
    sealed: bool,
}

impl ClassFacts {
    /// Whether nothing can reshape an instance: no code outside reaches the
    /// class, none inside lets `this` go, and no base but React's puts its
    /// own members on it.
    fn closed(&self) -> bool {
        self.sealed && !self.this_escapes && matches!(self.base, Base::None | Base::React)
    }

    /// Whether `this.name` is the class's own method whenever its code runs.
    fn own_method(&self, name: &str) -> Option<ScopeId> {
        let unchanged = self.closed()
            && !self.written.contains(name)
            && !self.members.contains(name);
        self.methods.get(name).copied().filter(|_| unchanged)
    }

    /// Whether `this.setState` and `this.forceUpdate` are React's.
    fn react_state(&self) -> bool {
        let untouched = ["setState", "forceUpdate"]
            .iter()
            .all(|name| !self.methods.contains_key(*name) && !self.members.contains(*name) && !self.written.contains(*name));
        self.base == Base::React && self.closed() && untouched
    }

    /// Whether a store into `this.name` runs no code: the class and its
    /// base declare no setter for it.
    fn plain_store(&self, name: &str) -> bool {
        self.closed() && !self.accessors.contains(name)
    }
}

impl<'s> Module<'s> {
    fn of(program: &Program<'_>, scoping: &'s Scoping, chains: &[&ChainDescriptor], exported: &FxHashSet<&str>) -> Self {
        let mut sources = FxHashMap::default();
        let mut namespaces = FxHashSet::default();
        let mut held = FxHashMap::default();
        let mut slot_renders = FxHashSet::default();
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else { continue };
            for specifier in import.specifiers.iter().flatten() {
                let Some(symbol) = specifier.local().symbol_id.get() else { continue };
                let source = import.source.value.as_str();
                sources.insert(symbol, source.to_string());
                // Animus's `renderAsChild` clones the one child it gets, as
                // its own `asChild` does.
                if super::is_animus_system_specifier(source)
                    && matches!(specifier, ImportDeclarationSpecifier::ImportSpecifier(named) if named.imported.name() == "renderAsChild")
                {
                    slot_renders.insert(symbol);
                }
                if matches!(specifier, ImportDeclarationSpecifier::ImportNamespaceSpecifier(_)) {
                    namespaces.insert(symbol);
                }
                // An import may hold elements its module builds.
                if !REACT_MODULES.contains(&source) {
                    let imports = BTreeSet::from([symbol]);
                    held.insert(symbol, Held { imports, ..Held::default() });
                }
            }
        }
        let react = super::ReactImports::from(program, scoping, &REACT_MODULES);
        let react_imports = sources.iter().filter(|(_, source)| REACT_MODULES.contains(&source.as_str())).map(|(symbol, _)| *symbol).collect();
        let mut declarations = Declarations::new(scoping, &react, react_imports, &slot_renders);
        declarations.visit_program(program);
        let uses = declarations.decided_uses();
        let arrays = Arrays::of(scoping, &declarations, &uses, &sources, &namespaces, exported);
        // A class nothing outside can reshape: unexported (`exported` names
        // no class declaration), and named only as a JSX tag.
        let exported_classes: FxHashSet<u32> = program
            .body
            .iter()
            .filter_map(|statement| match statement {
                Statement::ExportDeclaration(export) => match &export.declaration {
                    oxc::ast::ast::Declaration::ClassDeclaration(class) => Some(class.span.start),
                    _ => None,
                },
                Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                    oxc::ast::ast::ExportDefaultDeclarationKind::ClassDeclaration(class) => Some(class.span.start),
                    _ => None,
                },
                _ => None,
            })
            .collect();
        for (symbol, class) in &declarations.class_bindings {
            let references = scoping.get_resolved_reference_ids(*symbol).len();
            let tags = declarations.tag_references.get(symbol).copied().unwrap_or(0);
            if let Some(facts) = declarations.classes.get_mut(class) {
                facts.sealed =
                    !exported_classes.contains(class) && !exported.contains(scoping.symbol_name(*symbol)) && references == tags;
            }
        }
        let arrays_named = declarations
            .named_stores
            .iter()
            .filter(|symbol| declarations.module_arrays.contains(symbol) || declarations.local_arrays.contains(symbol));
        for symbol in declarations.hookable_bindings.iter().chain(arrays_named) {
            held.entry(*symbol).or_insert_with(Held::default).hookable = true;
        }
        // A re-export of React's own lets its exports go where the analysis
        // cannot follow writes to them.
        let reexports_react = program.body.iter().find_map(|statement| match statement {
            Statement::ExportFromDeclaration(export) if REACT_MODULES.contains(&export.source.value.as_str()) => Some(export.span.start),
            Statement::ExportAllDeclaration(export) if REACT_MODULES.contains(&export.source.value.as_str()) => Some(export.span.start),
            _ => None,
        });
        // A built-in's name written into a binding that may hold a prototype.
        let redirected = declarations
            .built_in_writes
            .iter()
            .filter(|(symbol, _)| {
                !declarations.literal_bindings.contains(symbol)
                    && !scoping.symbol_flags(**symbol).intersects(SymbolFlags::Function | SymbolFlags::Class)
            })
            .map(|(_, at)| *at)
            .min();
        // A let-go to an import with no source the analysis may follow
        // (`import lib = require(…)`) may reach code it reads.
        let unsourced = declarations.outside_let_goes.iter().find(|(_, import)| !sources.contains_key(import)).map(|(at, _)| *at);
        let patches_intrinsics = declarations
            .patches_intrinsics
            .or(reexports_react.map(|at| IntrinsicPatch { at, rule: "react-reexport" }))
            .or(redirected.map(|at| IntrinsicPatch { at, rule: "prototype-name-write" }))
            .or(unsourced.map(|at| IntrinsicPatch { at, rule: "trusted-let-go" }));
        // A default export's class has no binding of its own when anonymous.
        let default_class = program.body.iter().any(|statement| {
            matches!(statement, Statement::ExportDefaultDeclaration(export) if matches!(&export.declaration,
                oxc::ast::ast::ExportDefaultDeclarationKind::ClassDeclaration(_) | oxc::ast::ast::ExportDefaultDeclarationKind::ClassExpression(_)))
        });
        let class_names = declarations
            .class_bindings
            .keys()
            .filter(|symbol| scoping.symbol_scope_id(**symbol) == scoping.root_scope_id())
            .map(|symbol| scoping.symbol_name(*symbol).to_string())
            .chain(default_class.then(|| "default".to_string()))
            .collect();
        let outside_let_goes =
            declarations.outside_let_goes.iter().filter_map(|(at, import)| Some((*at, sources.get(import)?.clone()))).collect();
        let Declarations {
            params, param_inputs, functions, in_place, reshaped, reshaped_beyond_clones, setters, hook_states, classes, hookable_objects, keyed_stores,
            rewrites_object, ..
        } = declarations;
        Module {
            scoping,
            sources,
            namespaces,
            react,
            chain_spans: chains.iter().map(|chain| chain.span).collect(),
            arrays,
            params,
            slot_renders,
            child_cloners: BTreeMap::new(),
            props_params: FxHashSet::default(),
            as_types: FxHashSet::default(),
            caller_params: FxHashSet::default(),
            as_child_params: FxHashSet::default(),
            reshaped_beyond_clones,
            param_inputs,
            bound: functions.values().copied().collect(),
            functions,
            in_place,
            reshaped,
            setters,
            hook_states,
            classes,
            hookable_objects,
            held,
            returns: FxHashMap::default(),
            arguments: FxHashMap::default(),
            element_tags: FxHashMap::default(),
            aliases: FxHashMap::default(),
            names: Names::default(),
            roots: FxHashSet::default(),
            unit: Unit::Statement(0),
            reads: FxHashMap::default(),
            changed: Vec::new(),
            clock: 0,
            sinks: BTreeMap::new(),
            receivers: BTreeMap::new(),
            default: Held::default(),
            patches_intrinsics,
            outside_let_goes,
            keyed_stores,
            rewrites_object,
            class_names,
        }
    }

    fn grew(&mut self, key: Key) {
        self.clock += 1;
        self.changed.push((key, self.clock));
    }

    fn hold(&mut self, symbol: SymbolId, value: &Held) {
        if self.held.entry(symbol).or_default().join(value) {
            self.grew(Key::Held(symbol));
        }
    }

    /// Records that the unit being walked reads `key`.
    fn note_read(&mut self, key: Key) {
        self.reads.entry((self.unit, key)).or_insert(self.clock);
    }

    /// What `symbol` holds, read by the unit being walked.
    fn read(&mut self, symbol: SymbolId) -> Held {
        self.note_read(Key::Held(symbol));
        self.held.get(&symbol).cloned().unwrap_or_default()
    }

    /// Holds `value` in every binding `pattern` declares; a destructuring of
    /// the props object gives each binding the prop its static key names.
    fn hold_pattern(&mut self, pattern: &BindingPattern<'_>, value: &Held) {
        match pattern {
            BindingPattern::ObjectPattern(object) if matches!(value.inputs, Inputs::AllBut(_)) => {
                let mut named = BTreeSet::new();
                for property in &object.properties {
                    let held = match (property.computed, property.key.static_name()) {
                        (false, Some(key)) => {
                            let name = self.names.id(&key);
                            named.insert(name);
                            value.member(name)
                        }
                        _ => value.clone(),
                    };
                    self.hold_pattern(&property.value, &held);
                }
                if let Some(rest) = &object.rest {
                    let mut held = value.clone();
                    if let Inputs::AllBut(except) = &mut held.inputs {
                        std::rc::Rc::make_mut(except).extend(named);
                    }
                    self.hold_pattern(&rest.argument, &held);
                }
            }
            BindingPattern::AssignmentPattern(assignment) => self.hold_pattern(&assignment.left, value),
            pattern => {
                for symbol in bindings(pattern) {
                    self.hold(symbol, value);
                }
            }
        }
    }

    fn give_back(&mut self, scope: ScopeId, value: &Held) {
        if self.returns.entry(scope).or_default().join(value) {
            self.grew(Key::Returns(scope));
        }
    }

    /// What the function at `scope` returns, read by the unit being walked.
    fn returned_by(&mut self, scope: ScopeId) -> Option<Held> {
        self.note_read(Key::Returns(scope));
        self.returns.get(&scope).cloned()
    }

    /// A component tag `name` writes, with its first name, unless React's
    /// own component or a host element.
    fn component_tag<'n, 'a>(&self, name: &'n JSXElementName<'a>) -> Option<(String, Option<&'n IdentifierReference<'a>>)> {
        let (tag, root) = match name {
            JSXElementName::IdentifierReference(id) => (id.name.to_string(), Some(&**id)),
            JSXElementName::MemberExpression(member) => (jsx_member_path(member)?, jsx_member_root(member)),
            _ => return None,
        };
        (!root.is_some_and(|root| self.react(root))).then_some((tag, root))
    }

    /// Whether `name` is a component tag (`component_tag`), without naming it.
    fn is_component_tag(&self, name: &JSXElementName<'_>) -> bool {
        match name {
            JSXElementName::IdentifierReference(id) => !self.react(id),
            JSXElementName::MemberExpression(member) => {
                jsx_member_root(member).is_none_or(|root| !self.react(root)) && jsx_member_path(member).is_some()
            }
            _ => false,
        }
    }

    /// Whether `object` is an array whose methods are the built-in ones: a
    /// literal, or a binding of one (`Arrays::built`).
    fn built_array(&self, object: &Expression<'_>) -> bool {
        match unwrap_type_assertions(object) {
            Expression::ArrayExpression(_) => true,
            Expression::Identifier(id) => self.symbol(id).is_some_and(|symbol| self.arrays.built.contains(&symbol)),
            _ => false,
        }
    }

    /// Adds `value`'s elements to what the top-level binding `name` holds
    /// or returns, which its references carry and the records name.
    fn top_join(&mut self, name: &str, value: &Held) {
        if !value.has_elements() {
            return;
        }
        let elements = value.elements();
        match self.scoping.get_root_binding(name.into()) {
            Some(symbol) => self.hold(symbol, &elements),
            None => {
                self.default.join(&elements);
            }
        }
    }

    /// `value` reaches the parameters of the function at `scope`, and its
    /// `arguments`.
    fn taint(&mut self, scope: ScopeId, value: &Held) {
        if self.arguments.entry(scope).or_default().join(value) {
            self.grew(Key::Arguments(scope));
        }
        for index in 0..self.params.get(&scope).map_or(0, Vec::len) {
            let symbol = self.params[&scope][index];
            self.hold(symbol, value);
        }
    }

    /// A component's parameters hold its inputs, each binding the one it
    /// names (`ParamInput`), and its `arguments` all of them.
    fn seed_inputs(&mut self, scope: ScopeId) {
        if self.arguments.entry(scope).or_default().join(&Held::INPUTS) {
            self.grew(Key::Arguments(scope));
        }
        for index in 0..self.param_inputs.get(&scope).map_or(0, Vec::len) {
            let (symbol, input) = self.param_inputs[&scope][index].clone();
            match input {
                ParamInput::Props => self.props_params.insert(symbol),
                ParamInput::AsType => self.as_types.insert(symbol),
                ParamInput::AsChild => self.as_child_params.insert(symbol),
                _ => false,
            };
            if input.caller() {
                self.caller_params.insert(symbol);
            }
            let inputs = match input {
                ParamInput::Props => Inputs::all(),
                ParamInput::Every => Inputs::Every,
                ParamInput::AsType => Inputs::named(BTreeSet::from([self.names.id("as")])),
                ParamInput::AsChild => Inputs::named(BTreeSet::from([self.names.id("asChild")])),
                ParamInput::Named { key, .. } => Inputs::named(BTreeSet::from([self.names.id(&key)])),
                ParamInput::Rest(named) => Inputs::all_but(named.iter().map(|name| self.names.id(name)).collect()),
            };
            self.hold(symbol, &Held { inputs, ..Held::default() });
        }
    }

    fn sink(&mut self, at: u32, callee: Option<String>, held_array: Option<String>, top: &Rc<[String]>, value: &Held) {
        let entry = self.sinks.entry((at, callee, held_array)).or_insert_with(|| Reached { top: Rc::clone(top), held: Held::default() });
        entry.held.join(value);
    }

    fn symbol(&self, id: &IdentifierReference<'_>) -> Option<SymbolId> {
        super::symbol_of(self.scoping, id)
    }

    fn at_root(&self, symbol: SymbolId) -> bool {
        self.scoping.symbol_scope_id(symbol) == self.scoping.root_scope_id()
    }

    /// Whether `id` is React's: an import of one of React's modules, or an
    /// unbound `React`.
    fn react(&self, id: &IdentifierReference<'_>) -> bool {
        match self.symbol(id) {
            Some(symbol) => self.react.functions.contains_key(&symbol) || self.react.namespaces.contains(&symbol),
            None => id.name == "React",
        }
    }

    /// The name React exports the function `id` imports under.
    fn react_name(&self, id: &IdentifierReference<'_>) -> Option<&str> {
        self.symbol(id).and_then(|symbol| self.react.functions.get(&symbol)).map(String::as_str)
    }

    /// Whether `id` is a React namespace: a default or namespace import of
    /// one of React's modules, or an unbound `React`.
    /// Whether `object` is React's `Children`, imported or read off React.
    fn children(&self, object: &Expression<'_>) -> bool {
        match unwrap_type_assertions(object) {
            Expression::Identifier(id) => self.react_name(id) == Some("Children"),
            Expression::StaticMemberExpression(member) => {
                member.property.name == "Children" && matches!(&member.object, Expression::Identifier(id) if self.react_namespace(id))
            }
            _ => false,
        }
    }

    fn react_namespace(&self, id: &IdentifierReference<'_>) -> bool {
        match self.symbol(id) {
            Some(symbol) => self.react.namespaces.contains(&symbol),
            None => id.name == "React",
        }
    }

    /// What `function` refers to as a callable the module declares: a
    /// function a body declares (`Local`), or one the module declares at
    /// its top or imports, by name, with its scope when the module has it.
    fn function_of(&self, id: &IdentifierReference<'_>) -> Option<(Option<String>, Option<ScopeId>)> {
        let symbol = self.symbol(id)?;
        if self.scoping.symbol_is_mutated(symbol) {
            return None;
        }
        if self.sources.contains_key(&symbol) {
            return (!self.namespaces.contains(&symbol) && !self.react(id)).then(|| (Some(id.name.to_string()), None));
        }
        let scope = self.functions.get(&symbol).copied();
        if self.at_root(symbol) {
            let declared = scope.is_some() || self.scoping.symbol_flags(symbol).intersects(SymbolFlags::Function);
            return declared.then(|| (Some(id.name.to_string()), scope));
        }
        scope.map(|scope| (None, Some(scope)))
    }

    fn finish(self) -> Records {
        let (names, scoping) = (&self.names, self.scoping);
        // The imports a value holds, in name order.
        let imported = |held: &Held| {
            let mut imports: Vec<String> = held.imports.iter().map(|symbol| scoping.symbol_name(*symbol).to_string()).collect();
            imports.sort_unstable();
            imports
        };
        let inputs = |held: &Held| held.inputs.map(|name| names.texts[*name as usize].clone());
        let record = |Reached { top, held }: Reached| {
            let forwards_from = if held.inputs.any() { top.to_vec() } else { Vec::new() };
            (names.texts(&held.tags), imported(&held), forwards_from, inputs(&held))
        };
        let calls = self
            .sinks
            .into_iter()
            .filter(|(_, reached)| !reached.held.is_empty())
            .map(|((_, callee, held_array), reached)| {
                let (tags, imported_args, forwards_from, inputs) = record(reached);
                OpaqueCall { callee, held_array, tags, imported_args, forwards_from, inputs }
            })
            .collect();
        let tags = self
            .receivers
            .into_iter()
            .filter(|(_, receiver)| !receiver.reached.held.is_empty())
            .map(|(at, Receiver { tag, origin, also, polymorphic, site, exposed, reached, props })| {
                let key = |key: WalkProp| match key {
                    WalkProp::Children => PropKey::Children,
                    WalkProp::Named(name) => PropKey::Named(names.texts[name as usize].clone()),
                    WalkProp::Spread => PropKey::Spread,
                };
                let (tags, imported_args, forwards_from, whole) = record(reached);
                // Reached through one prop, the element's whole record is that prop's.
                let props = if props.len() == 1 {
                    let only = props.into_keys().next().map(key).unwrap_or(PropKey::Children);
                    vec![PropReach { key: only, tags: BTreeSet::new(), imported_args: Vec::new(), inputs: whole }]
                } else {
                    props
                        .into_iter()
                        .map(|(prop, held)| PropReach { key: key(prop), tags: names.texts(&held.tags), imported_args: imported(&held), inputs: inputs(&held) })
                        .collect()
                };
                OpaqueTag { tag, origin, also, polymorphic, site, at, exposed, tags, imported_args, forwards_from, props }
            })
            .collect();
        // The module's own top-level bindings that hold elements, by name.
        let sources = &self.sources;
        let element_const = |held: &Held| ElementConst { tags: names.texts(&held.tags), imports: imported(held) };
        let mut element_consts: BTreeMap<String, ElementConst> = self
            .held
            .iter()
            .filter(|(symbol, held)| {
                held.has_elements() && scoping.symbol_scope_id(**symbol) == scoping.root_scope_id() && !sources.contains_key(*symbol)
            })
            .map(|(symbol, held)| (scoping.symbol_name(*symbol).to_string(), element_const(held)))
            .collect();
        if self.default.has_elements() {
            element_consts.insert("default".to_string(), element_const(&self.default));
        }
        Records {
            calls,
            tags,
            element_consts,
            held_arrays: self.arrays.held_names,
            misused_imports: self.arrays.misused_imports,
            classes: self.class_names,
            patches_intrinsics: self.patches_intrinsics,
            outside_let_goes: self.outside_let_goes,
            keyed_stores: self.keyed_stores,
            rewrites_object: self.rewrites_object,
            child_cloners: self.child_cloners,
        }
    }
}

/// The name a class member's key gives it, `#name` for a private one.
fn member_name(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::PrivateIdentifier(private) => Some(format!("#{}", private.name)),
        key => key.static_name().map(|name| name.to_string()),
    }
}

/// The declarations the walk needs before it starts: every function's
/// parameters and arity, the bindings declared to a function, an object or
/// array built in place, or React's state setters, array `const`s, classes,
/// and the object literals and bindings that may be hookable.
struct Declarations<'r> {
    scoping: &'r Scoping,
    react: &'r super::ReactImports,
    ancestors: Vec<AstKind<'r>>,
    params: FxHashMap<ScopeId, Vec<SymbolId>>,
    /// Each function's parameter bindings with the input each holds.
    param_inputs: FxHashMap<ScopeId, Vec<(SymbolId, ParamInput)>>,
    /// Each function's parameter count and whether it has a rest
    /// parameter, by scope.
    arity: FxHashMap<ScopeId, (usize, bool)>,
    /// The functions that read their own `arguments`.
    uses_arguments: FxHashSet<ScopeId>,
    functions: FxHashMap<SymbolId, ScopeId>,
    in_place: FxHashSet<SymbolId>,
    /// The bindings some reference uses other than as a JSX spread's
    /// argument or to read a member (an assignment's target among them):
    /// code that may change what they hold.
    reshaped: FxHashSet<SymbolId>,
    /// Those of `reshaped` some reference uses other than in an element's
    /// config (`element_config`), which `renderAsChild`, `cloneElement` and
    /// `createElement` read by its own keys and change nothing in.
    reshaped_beyond_clones: FxHashSet<SymbolId>,
    /// The imports of Animus's `renderAsChild`.
    slot_renders: &'r FxHashSet<SymbolId>,
    setters: FxHashMap<SymbolId, Vec<SymbolId>>,
    hook_states: FxHashMap<u32, Vec<SymbolId>>,
    /// `const`s declared to an array literal: at the module's top, and in a
    /// function.
    module_arrays: FxHashSet<SymbolId>,
    local_arrays: FxHashSet<SymbolId>,
    classes: FxHashMap<u32, ClassFacts>,
    /// The binding each class is declared to.
    class_bindings: FxHashMap<SymbolId, u32>,
    /// How many references to each binding are a JSX tag.
    tag_references: FxHashMap<SymbolId, usize>,
    hookable_objects: FxHashSet<u32>,
    /// Bindings some code stores into by a computed key or a hook-named
    /// key: they may hold hooks.
    hookable_bindings: FxHashSet<SymbolId>,
    /// Bindings some code stores into by any other name: an array among
    /// them may hold hooks.
    named_stores: FxHashSet<SymbolId>,
    /// Bindings declared to a literal, a function, a class or an array a
    /// built-in builds (`fresh_array`), never reassigned, and reduce
    /// accumulators that only ever hold their literal (`accumulator`): none
    /// holds a built-in's prototype.
    literal_bindings: FxHashSet<SymbolId>,
    /// Bindings written by a built-in's method or hook name, or by a
    /// bracketed key (`written_into`), with the first such write.
    built_in_writes: FxHashMap<SymbolId, u32>,
    /// See `FileFacts::patches_intrinsics`.
    patches_intrinsics: Option<IntrinsicPatch>,
    /// A trusted global let go to a callee rooted at an import, with the
    /// import (see `FileFacts::outside_let_goes`).
    outside_let_goes: Vec<(u32, SymbolId)>,
    /// `const`s declared to a provably primitive value (`primitive`).
    primitive_consts: FxHashSet<SymbolId>,
    /// Functions bound to a name, never reassigned, whose every return is
    /// provably primitive by `primitive`'s forms other than such a call:
    /// each is added once the walk leaves its body.
    primitive_functions: FxHashSet<SymbolId>,
    /// See `FileFacts::keyed_stores`.
    keyed_stores: Vec<(u32, String)>,
    /// See `FileFacts::rewrites_object`.
    rewrites_object: bool,
    /// The bindings importing from React's modules, written or not.
    react_imports: FxHashSet<SymbolId>,
    /// How the references to each import (type-only ones included) and
    /// each unwritten variable use it (`array_use`), as `Use` bits by
    /// symbol; `decided_uses` adds `blind_calls`.
    uses: Vec<u8>,
    /// The callback-taking read-method calls whose use `callback_blind`
    /// decides once every function is declared, with the binding and the
    /// method's name.
    blind_calls: Vec<(SymbolId, &'r str, &'r CallExpression<'r>)>,
    /// Whether each variable is never written (`symbol_is_mutated`, which
    /// scans every reference), once known: 0 unknown, 1 unwritten, 2 written.
    unwritten: Vec<u8>,
    depth: usize,
}

// `Declarations` borrows the program for its ancestors; the lifetime of the
// scoping reference stands in for both.
impl<'r> Declarations<'r> {
    /// Whether the reference at `span` is an element's config, or a spread
    /// or a value in one: the second argument of `renderAsChild`,
    /// `cloneElement` or `createElement`.
    fn element_config(&self, span: Span) -> bool {
        let mut up = self.ancestors.iter().rev();
        let (current, parent) = match super::peel_wrappers(span, &mut up) {
            (current, Some(AstKind::SpreadElement(spread))) if spread.argument.span() == current => {
                let Some(AstKind::ObjectExpression(object)) = up.next() else { return false };
                super::peel_wrappers(object.span, &mut up)
            }
            (current, Some(AstKind::ObjectProperty(property))) if !property.computed && property.value.span() == current => {
                let Some(AstKind::ObjectExpression(object)) = up.next() else { return false };
                super::peel_wrappers(object.span, &mut up)
            }
            other => other,
        };
        matches!(parent, Some(AstKind::CallExpression(call))
            if call.arguments.get(1).is_some_and(|argument| argument.span() == current)
                && (matches!(unwrap_type_assertions(&call.callee), Expression::Identifier(callee)
                        if self.symbol(callee).is_some_and(|symbol| self.slot_renders.contains(&symbol)))
                    || self.react.names(self.scoping, &call.callee, &["cloneElement", "createElement"], true)))
    }

    fn new(scoping: &'r Scoping, react: &'r super::ReactImports, react_imports: FxHashSet<SymbolId>, slot_renders: &'r FxHashSet<SymbolId>) -> Self {
        Declarations {
            scoping,
            react,
            slot_renders,
            reshaped_beyond_clones: FxHashSet::default(),
            ancestors: Vec::new(),
            params: FxHashMap::default(),
            param_inputs: FxHashMap::default(),
            arity: FxHashMap::default(),
            uses_arguments: FxHashSet::default(),
            functions: FxHashMap::default(),
            in_place: FxHashSet::default(),
            reshaped: FxHashSet::default(),
            setters: FxHashMap::default(),
            hook_states: FxHashMap::default(),
            module_arrays: FxHashSet::default(),
            local_arrays: FxHashSet::default(),
            classes: FxHashMap::default(),
            class_bindings: FxHashMap::default(),
            tag_references: FxHashMap::default(),
            hookable_objects: FxHashSet::default(),
            hookable_bindings: FxHashSet::default(),
            named_stores: FxHashSet::default(),
            literal_bindings: FxHashSet::default(),
            built_in_writes: FxHashMap::default(),
            patches_intrinsics: None,
            outside_let_goes: Vec::new(),
            primitive_consts: FxHashSet::default(),
            primitive_functions: FxHashSet::default(),
            keyed_stores: Vec::new(),
            rewrites_object: false,
            react_imports,
            uses: vec![0; scoping.symbols_len()],
            blind_calls: Vec::new(),
            unwritten: vec![0; scoping.symbols_len()],
            depth: 0,
        }
    }

    /// The `Use` bits of each binding's references (`uses`), every
    /// read-method call decided.
    fn decided_uses(&mut self) -> Vec<u8> {
        let mut uses = std::mem::take(&mut self.uses);
        for (symbol, name, call) in std::mem::take(&mut self.blind_calls) {
            let used = if self.callback_blind(name, call) { Use::Read } else { Use::Other };
            uses[symbol.index()] |= used.bit();
        }
        uses
    }

    /// Whether a reference to `symbol` may name an array or an import, a
    /// type-only one included (`sources` names it), whose uses `Arrays::of`
    /// reads: an array is a variable never written.
    fn may_hold_array(&mut self, symbol: SymbolId) -> bool {
        let flags = self.scoping.symbol_flags(symbol);
        if flags.intersects(SymbolFlags::Import | SymbolFlags::TypeImport | SymbolFlags::ConstVariable) {
            return true;
        }
        if !flags.intersects(SymbolFlags::Variable) {
            return false;
        }
        let known = &mut self.unwritten[symbol.index()];
        if *known == 0 {
            *known = if self.scoping.symbol_is_mutated(symbol) { 2 } else { 1 };
        }
        *known == 1
    }

    /// Whether the callback a read method `name` gets cannot see the array:
    /// a function the module declares, with no parameter at the array's
    /// position, no rest parameter and no use of `arguments`.
    fn callback_blind(&self, name: &str, call: &CallExpression<'_>) -> bool {
        let Some(&(_, position)) = ARRAY_CALLBACK_METHODS.iter().find(|(method, _)| *method == name) else { return true };
        let scope = match call.arguments.first().and_then(|argument| argument.as_expression()).map(unwrap_type_assertions) {
            None => return true,
            Some(Expression::Identifier(id)) => super::symbol_of(self.scoping, id)
                .filter(|symbol| !self.scoping.symbol_is_mutated(*symbol))
                .and_then(|symbol| self.functions.get(&symbol).copied()),
            Some(expression) => function_scope(expression),
        };
        scope.is_some_and(|scope| {
            let (count, rest) = self.arity.get(&scope).copied().unwrap_or((usize::MAX, true));
            count <= position && !rest && !self.uses_arguments.contains(&scope)
        })
    }

    fn symbol(&self, id: &IdentifierReference<'_>) -> Option<SymbolId> {
        super::symbol_of(self.scoping, id)
    }

    fn declare_params(&mut self, scope: ScopeId, params: &oxc::ast::ast::FormalParameters<'_>) {
        self.params.insert(scope, params.iter_bindings().flat_map(bindings).collect());
        self.param_inputs.insert(scope, param_inputs(params));
        self.arity.insert(scope, (params.items.len(), params.rest.is_some()));
    }

    /// Counts a JSX tag's reference to its binding.
    fn count_tag(&mut self, name: &JSXElementName<'_>) {
        if let JSXElementName::IdentifierReference(id) = name {
            if let Some(symbol) = self.symbol(id) {
                *self.tag_references.entry(symbol).or_default() += 1;
            }
        }
    }

    /// Whether the intrinsic prototype at `span`, a child of the last
    /// ancestor, is used other than to read a member of it, unwritten.
    fn reshapes(&self, span: Span) -> bool {
        let mut up = self.ancestors.iter().rev();
        match super::peel_wrappers(span, &mut up) {
            (current, Some(AstKind::StaticMemberExpression(member))) if member.object.span() == current => {
                matches!(super::member_effect(member.span, up), Some(MemberEffect::Assigned | MemberEffect::Deleted))
            }
            (current, Some(AstKind::ComputedMemberExpression(member))) if member.object.span() == current => {
                matches!(super::member_effect(member.span, up), Some(MemberEffect::Assigned | MemberEffect::Deleted))
            }
            _ => true,
        }
    }

    /// The member `name` (`None` when the code computes it) of `object`, at
    /// `span`, its key `computed` in brackets. A prototype reached by name
    /// (`Array.prototype`) or through a value (`[].__proto__`) is changed
    /// by any use but a member's read, and `getPrototypeOf` let go as a
    /// value reaches prototypes. A write is judged by `written_into`: by a
    /// bracketed key, whatever it names, it may set any built-in's method.
    fn member(&mut self, span: Span, object: &Expression<'_>, name: Option<&str>, computed: bool) {
        let prototype = match name {
            Some("prototype") => self.intrinsic(object),
            Some("__proto__") => true,
            Some("getPrototypeOf" | "setPrototypeOf") => {
                !self.module_binding(object) && !matches!(self.ancestors.last(), Some(AstKind::CallExpression(call)) if call.callee.span() == span)
            }
            _ => false,
        };
        // `eval` and `Function` read off the global object, or any
        // `constructor` called (a function's is `Function`), run strings; a
        // writer let go as a value (an alias, `.call`, `Reflect.apply`)
        // writes into targets the walk cannot see.
        let global = matches!(unwrap_type_assertions(object), Expression::Identifier(id) if GLOBAL_OBJECTS.contains(&id.name.as_str()) && self.symbol(id).is_none());
        let called = matches!(self.ancestors.last(), Some(AstKind::CallExpression(call)) if call.callee.span() == span)
            || matches!(self.ancestors.last(), Some(AstKind::NewExpression(call)) if call.callee.span() == span);
        let reflection = matches!(unwrap_type_assertions(object), Expression::Identifier(id) if self.symbol(id).is_none() && name.is_some_and(|name| writer(&id.name, name)));
        let unseen = match name {
            Some("eval" | "Function") => global,
            Some("constructor") => called,
            _ => reflection && !called,
        };
        if unseen {
            self.patch(span.start, if reflection && !called { "writer-let-go" } else { "string-code" });
        } else if prototype && self.reshapes(span) {
            self.patch(span.start, "prototype-use");
        } else if self.prototype_let_go(span, object, name) {
            self.patch(span.start, "prototype-let-go");
        }
        let effect = super::member_effect(span, self.ancestors.iter().rev());
        if matches!(effect, Some(MemberEffect::Assigned | MemberEffect::Deleted)) {
            // A value with no callable under a trusted key redirects no
            // built-in, except by a key the walk cannot read into an object
            // the module may not own.
            if !self.stores_no_trusted_callable(span) || (computed && !self.unshared(object)) {
                self.written_into(object, computed || name.is_some_and(|name| built_in_name(name) || trusted_global(name)));
            }
            // Whatever it stores, a store by a static key into an object that
            // may be a prototype every props object inherits counts where a
            // render reads that key.
            if let (Some(name), false, Some(MemberEffect::Assigned)) = (name, computed, effect) {
                if !self.unshared(object) && self.maybe_prototype(object) {
                    self.keyed_stores.push((span.start, name.to_string()));
                }
            }
        }
    }

    /// Whether `object` can be no prototype a store into it would change
    /// for other objects: a fresh literal, or a global or a static chain off
    /// one (`document.body.style`) that names no prototype or constructor on
    /// the way. A binding's writes are `written_into`'s.
    fn unshared(&self, object: &Expression<'_>) -> bool {
        match unwrap_type_assertions(object) {
            Expression::ObjectExpression(_)
            | Expression::ArrayExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::ClassExpression(_) => true,
            Expression::Identifier(_) | Expression::StaticMemberExpression(_) => self.platform(object),
            _ => false,
        }
    }

    /// Whether `object` may be a prototype by how the module reaches it: by
    /// a computed key, a prototype, constructor or `__proto__` link, or off
    /// anything but a binding. A binding, or a static chain off one, holds
    /// a prototype only where the module lets one go as a value
    /// (`prototype_let_go`), which leaves no usage proven already.
    fn maybe_prototype(&self, object: &Expression<'_>) -> bool {
        match unwrap_type_assertions(object) {
            Expression::Identifier(_) => false,
            Expression::StaticMemberExpression(member) => {
                matches!(member.property.name.as_str(), "prototype" | "constructor" | "__proto__") || self.maybe_prototype(&member.object)
            }
            _ => true,
        }
    }

    /// Whether the member at `span` hands a prototype on as a value: a
    /// `.prototype`, a member the walk cannot name off something that
    /// reaches prototypes (`Object[k]`), a call of a method off a prototype
    /// (`Object.prototype.valueOf()`, which may return it), or
    /// `getPrototypeOf` called through `call`, `bind` or `apply`.
    fn prototype_let_go(&self, span: Span, object: &Expression<'_>, name: Option<&str>) -> bool {
        let reaches = match name {
            Some("prototype") => true,
            None => self.reaches_prototypes(object),
            _ => false,
        };
        if reaches && self.let_go(span, 0) {
            return true;
        }
        let called = |call: &&CallExpression<'_>| call.callee.span() == span;
        match (name, self.ancestors.last()) {
            (_, Some(AstKind::CallExpression(call))) if called(call) && self.prototype_value(object) => self.let_go(call.span, 1),
            (Some("call" | "bind" | "apply"), _) => matches!(unwrap_type_assertions(object), Expression::StaticMemberExpression(member)
                if member.property.name == "getPrototypeOf" && !self.module_binding(&member.object)),
            _ => false,
        }
    }

    /// Whether `object` is the global `name` by its name (`Object`,
    /// `globalThis.Object`).
    fn named_global(&self, object: &Expression<'_>, name: &str) -> bool {
        match unwrap_type_assertions(object) {
            Expression::Identifier(id) => id.name == name && self.symbol(id).is_none(),
            Expression::StaticMemberExpression(member) => {
                member.property.name == name
                    && matches!(&member.object, Expression::Identifier(id) if GLOBAL_OBJECTS.contains(&id.name.as_str()) && self.symbol(id).is_none())
            }
            _ => false,
        }
    }

    /// Whether `expression` is a new array a built-in builds, whose methods
    /// are the built-in ones and whose elements no module put a prototype
    /// in: an array literal, `Object.keys`, `values` or `entries`,
    /// `Array.from` or `Array.of`, or a built-in array method that returns
    /// a new array called on one.
    fn fresh_array(&self, expression: &Expression<'_>) -> bool {
        match unwrap_type_assertions(expression) {
            Expression::ArrayExpression(_) => true,
            Expression::CallExpression(call) => match unwrap_type_assertions(&call.callee) {
                Expression::StaticMemberExpression(member) => match member.property.name.as_str() {
                    "keys" | "values" | "entries" => self.named_global(&member.object, "Object"),
                    "from" | "of" => self.named_global(&member.object, "Array"),
                    "filter" | "map" | "slice" | "concat" | "flat" | "flatMap" | "toSorted" | "toReversed" => self.fresh_array(&member.object),
                    _ => false,
                },
                _ => false,
            },
            _ => false,
        }
    }

    /// The accumulator of the function at `span`, when it only ever holds
    /// the literal it starts as: the function is the callback of a built-in
    /// `reduce` or `reduceRight` of a `fresh_array`, given an object or
    /// array literal to start, its first parameter a plain binding never
    /// reassigned, and each of its returns that binding, a literal or
    /// nothing.
    fn accumulator(
        &self,
        span: Span,
        params: &oxc::ast::ast::FormalParameters<'_>,
        body: ComponentBody<'_, '_>,
    ) -> Option<SymbolId> {
        let (current, Some(AstKind::CallExpression(call))) = super::peel_wrappers(span, &mut self.ancestors.iter().rev()) else {
            return None;
        };
        let reduces = matches!(unwrap_type_assertions(&call.callee), Expression::StaticMemberExpression(member)
            if matches!(member.property.name.as_str(), "reduce" | "reduceRight") && self.fresh_array(&member.object));
        let starts = call.arguments.get(1).and_then(|argument| argument.as_expression()).map(unwrap_type_assertions);
        if !reduces
            || call.arguments.len() != 2
            || call.arguments[0].span() != current
            || !matches!(starts, Some(Expression::ObjectExpression(_) | Expression::ArrayExpression(_)))
        {
            return None;
        }
        let parameter = params.items.first().filter(|parameter| parameter.initializer.is_none())?;
        let BindingPattern::BindingIdentifier(id) = &parameter.pattern else { return None };
        let symbol = id.symbol_id.get().filter(|symbol| !self.scoping.symbol_is_mutated(*symbol))?;
        let returned = |value: Option<&Expression<'_>>| match value.map(unwrap_type_assertions) {
            None | Some(Expression::ObjectExpression(_) | Expression::ArrayExpression(_)) => true,
            Some(Expression::Identifier(returned)) => self.symbol(returned) == Some(symbol),
            Some(_) => false,
        };
        every_return(body, &returned).then_some(symbol)
    }

    /// Whether `object` reaches prototypes by a member it reads: a built-in,
    /// the global object, or a chain through a prototype, constructor or
    /// `__proto__`.
    fn reaches_prototypes(&self, object: &Expression<'_>) -> bool {
        self.intrinsic(object)
            || matches!(unwrap_type_assertions(object), Expression::Identifier(id) if GLOBAL_OBJECTS.contains(&id.name.as_str()) && self.symbol(id).is_none())
            || Self::named_link(object)
    }

    /// Whether a static chain names a prototype, constructor or `__proto__`.
    fn named_link(object: &Expression<'_>) -> bool {
        match unwrap_type_assertions(object) {
            Expression::StaticMemberExpression(member) => {
                matches!(member.property.name.as_str(), "prototype" | "constructor" | "__proto__") || Self::named_link(&member.object)
            }
            Expression::ComputedMemberExpression(member) => Self::named_link(&member.object),
            _ => false,
        }
    }

    /// Whether `object` is a prototype by its last link (`X.prototype`,
    /// `x.__proto__`).
    fn prototype_value(&self, object: &Expression<'_>) -> bool {
        match unwrap_type_assertions(object) {
            Expression::StaticMemberExpression(member) => matches!(member.property.name.as_str(), "prototype" | "__proto__"),
            Expression::ComputedMemberExpression(member) => {
                member.static_property_name().is_some_and(|name| matches!(name.as_str(), "prototype" | "__proto__"))
            }
            _ => false,
        }
    }

    /// Whether `object` may be the global `Object` (`Object`,
    /// `globalThis.Object`, `globalThis[k]`).
    fn global_object_binding(&self, object: &Expression<'_>) -> bool {
        self.named_global(object, "Object")
            || matches!(unwrap_type_assertions(object), Expression::ComputedMemberExpression(member)
                if member.static_property_name().is_none_or(|name| name == "Object")
                    && matches!(&member.object, Expression::Identifier(id) if GLOBAL_OBJECTS.contains(&id.name.as_str()) && self.symbol(id).is_none()))
    }

    /// Whether `object` is a binding the module declares (not an import).
    fn module_binding(&self, object: &Expression<'_>) -> bool {
        matches!(unwrap_type_assertions(object), Expression::Identifier(id)
            if self.symbol(id).is_some_and(|symbol| !self.scoping.symbol_flags(symbol).intersects(SymbolFlags::Import)))
    }

    /// Whether the value at `span` (`skip` ancestors under the walk's
    /// position) is let go: stored, passed, returned or chosen. A member
    /// read, a call of it, a comparison, `typeof` and a write of it keep it.
    fn let_go(&self, span: Span, skip: usize) -> bool {
        match super::peel_wrappers(span, &mut self.ancestors.iter().rev().skip(skip)) {
            (_, Some(AstKind::StaticMemberExpression(_))) => false,
            (current, Some(AstKind::ComputedMemberExpression(member))) => member.object.span() != current,
            (current, Some(AstKind::CallExpression(call))) => call.callee.span() != current,
            (_, Some(AstKind::BinaryExpression(_) | AstKind::UnaryExpression(_))) => false,
            (current, Some(AstKind::AssignmentExpression(assignment))) => assignment.left.span() != current,
            _ => true,
        }
    }

    /// See `unshared`: a static chain off an unbound global.
    fn platform(&self, object: &Expression<'_>) -> bool {
        match unwrap_type_assertions(object) {
            Expression::Identifier(id) => self.symbol(id).is_none(),
            Expression::StaticMemberExpression(member) => {
                !matches!(member.property.name.as_str(), "prototype" | "constructor" | "__proto__") && self.platform(&member.object)
            }
            _ => false,
        }
    }

    /// Whether the member at `span` is assigned a value with no callable
    /// under a key trusted code calls by name: a primitive (a compound
    /// assignment or `++` stores one), an array literal, or an object
    /// literal of static keys whose trusted ones hold none. A built-in
    /// redirected so is never called, and the store itself runs only a
    /// setter the platform or the module (where it installs one) owns. What
    /// its key may change for a render is `keyed_stores`'.
    fn stores_no_trusted_callable(&self, span: Span) -> bool {
        use oxc::syntax::operator::AssignmentOperator;
        let mut up = self.ancestors.iter().rev();
        match super::peel_wrappers(span, &mut up) {
            (current, Some(AstKind::AssignmentExpression(assignment))) if assignment.left.span() == current => {
                match assignment.operator {
                    AssignmentOperator::Assign
                    | AssignmentOperator::LogicalOr
                    | AssignmentOperator::LogicalAnd
                    | AssignmentOperator::LogicalNullish => self.no_trusted_callable(&assignment.right),
                    _ => true,
                }
            }
            (_, Some(AstKind::UpdateExpression(_))) => true,
            _ => false,
        }
    }

    /// Whether `value` holds no callable under a trusted key: see
    /// `stores_no_trusted_callable`. A trusted key may hold a value that
    /// holds none itself (`{ count: 0 }`).
    fn no_trusted_callable(&self, value: &Expression<'_>) -> bool {
        match unwrap_type_assertions(value) {
            Expression::ArrayExpression(_) => true,
            Expression::ObjectExpression(object) => object.properties.iter().all(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    property.kind == PropertyKind::Init
                        && !property.computed
                        && property.key.static_name().is_some_and(|key| !trusted_name(&key) || self.no_trusted_callable(&property.value))
                }
                ObjectPropertyKind::SpreadProperty(_) => false,
            }),
            value => self.primitive(value),
        }
    }

    /// Whether `value` is provably primitive: a literal, `undefined`, `NaN`
    /// or `Infinity`, an untagged template, an operator's result, a
    /// conversion by `String`, `Number` or `Boolean`, an array literal's
    /// `join`, a call of one of `primitive_functions`, a `const` declared to
    /// one, or a choice among them.
    fn primitive(&self, value: &Expression<'_>) -> bool {
        self.primitive_by(value, true)
    }

    /// `primitive`, counting the calls of `primitive_functions` only where
    /// `calls`: what such a function returns is judged without them.
    fn primitive_by(&self, value: &Expression<'_>, calls: bool) -> bool {
        use oxc::syntax::operator::AssignmentOperator;
        let primitive = |value: &Expression<'_>| self.primitive_by(value, calls);
        match unwrap_type_assertions(value) {
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::UnaryExpression(_)
            | Expression::BinaryExpression(_)
            | Expression::PrivateInExpression(_)
            | Expression::UpdateExpression(_) => true,
            Expression::Identifier(id) => match self.symbol(id) {
                None => matches!(id.name.as_str(), "undefined" | "NaN" | "Infinity"),
                Some(symbol) => self.primitive_consts.contains(&symbol),
            },
            Expression::AssignmentExpression(assignment) => match assignment.operator {
                AssignmentOperator::Assign => primitive(&assignment.right),
                AssignmentOperator::LogicalOr | AssignmentOperator::LogicalAnd | AssignmentOperator::LogicalNullish => false,
                _ => true,
            },
            Expression::ConditionalExpression(conditional) => primitive(&conditional.consequent) && primitive(&conditional.alternate),
            Expression::LogicalExpression(logical) => primitive(&logical.left) && primitive(&logical.right),
            Expression::SequenceExpression(sequence) => sequence.expressions.last().is_some_and(primitive),
            Expression::CallExpression(call) => match unwrap_type_assertions(&call.callee) {
                Expression::Identifier(callee) => match self.symbol(callee) {
                    None => matches!(callee.name.as_str(), "String" | "Number" | "Boolean"),
                    Some(symbol) => calls && self.primitive_functions.contains(&symbol),
                },
                Expression::StaticMemberExpression(member) => {
                    member.property.name == "join" && matches!(unwrap_type_assertions(&member.object), Expression::ArrayExpression(_))
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// Whether the reference at `span` is only inspected: `typeof`'s
    /// operand, or the right of `instanceof`, which asks the native
    /// `Symbol.hasInstance`.
    fn only_inspected(&self, span: Span) -> bool {
        let mut up = self.ancestors.iter().rev();
        match super::peel_wrappers(span, &mut up) {
            (_, Some(AstKind::UnaryExpression(unary))) => unary.operator == UnaryOperator::Typeof,
            (current, Some(AstKind::BinaryExpression(binary))) => {
                binary.operator == BinaryOperator::Instanceof && binary.right.span() == current
            }
            _ => false,
        }
    }

    /// The import a call that gets the reference at `span` as an argument
    /// is rooted at (`z` in `z.string().transform(String)`): code the
    /// analysis may not read, which `FileFacts::outside_let_goes` decides.
    fn import_receiver(&self, span: Span) -> Option<SymbolId> {
        let (_, _, _, parent) = self.chain(span);
        let Some(AstKind::CallExpression(call)) = parent else { return None };
        let mut root = &call.callee;
        loop {
            root = match unwrap_type_assertions(root) {
                Expression::StaticMemberExpression(member) => &member.object,
                Expression::CallExpression(inner) => &inner.callee,
                Expression::Identifier(id) => {
                    let symbol = self.symbol(id)?;
                    return self.scoping.symbol_flags(symbol).intersects(SymbolFlags::Import).then_some(symbol);
                }
                _ => return None,
            };
        }
    }

    /// A write into `object`, one that may set a built-in's method or hook,
    /// or a trusted global where `object` is the global object, when
    /// `built_in`. Into an object the module does not own (`owned`),
    /// it may reach a built-in's prototype however the code got there. One
    /// that may set a built-in's method, into a binding, may too, unless the
    /// binding is declared to a literal (`Module::of` judges it).
    fn written_into(&mut self, object: &Expression<'_>, built_in: bool) {
        // A write into a choice of objects is a write into either.
        if let Expression::ConditionalExpression(conditional) = unwrap_type_assertions(object) {
            self.written_into(&conditional.consequent, built_in);
            self.written_into(&conditional.alternate, built_in);
            return;
        }
        let at = object.span().start;
        if self.global_object_binding(object) {
            self.rewrites_object = true;
        }
        if !self.owned(object) {
            self.patch(at, "unowned-write");
        } else if let (true, Expression::Identifier(id)) = (built_in, unwrap_type_assertions(object)) {
            if let Some(symbol) = self.symbol(id) {
                self.built_in_writes.entry(symbol).or_insert(at);
            }
        }
    }

    /// Records the first construct, at `at`, that leaves no usage proven.
    fn patch(&mut self, at: u32, rule: &'static str) {
        self.patches_intrinsics.get_or_insert(IntrinsicPatch { at, rule });
    }

    /// Whether `object` is `this` in a class's instance member, a binding the
    /// module declares (not an import), or a literal: an object the module owns rather than one it
    /// reached.
    fn owned(&self, object: &Expression<'_>) -> bool {
        match unwrap_type_assertions(object) {
            // Elsewhere `this` is whatever the caller gives.
            Expression::ThisExpression(_) => matches!(self.this_class(), Some((_, false))),
            Expression::ObjectExpression(_)
            | Expression::ArrayExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::ClassExpression(_) => true,
            Expression::Identifier(id) => {
                self.symbol(id).is_some_and(|symbol| !self.scoping.symbol_flags(symbol).intersects(SymbolFlags::Import))
            }
            _ => false,
        }
    }

    fn intrinsic(&self, expression: &Expression<'_>) -> bool {
        intrinsic(expression, |id| self.symbol(id).is_none())
    }

    /// The class whose `this` is at the visit's position, and whether the
    /// position is static, where `this` is the class itself: the nearest
    /// class, unless a non-arrow function that is not one of its members
    /// comes first.
    fn this_class(&self) -> Option<(u32, bool)> {
        let mut member: Option<bool> = None;
        for (index, kind) in self.ancestors.iter().enumerate().rev() {
            match kind {
                AstKind::Function(_) => match self.ancestors.get(index.wrapping_sub(1)) {
                    Some(AstKind::MethodDefinition(method)) => member = Some(method.r#static),
                    _ => return None,
                },
                AstKind::PropertyDefinition(property) => member = member.or(Some(property.r#static)),
                AstKind::StaticBlock(_) => member = Some(true),
                AstKind::Class(class) => return member.map(|statics| (class.span.start, statics)),
                _ => {}
            }
        }
        None
    }

    /// How the member chain from the reference at `span` (`a.b.c`) ends:
    /// how many members it reads, the first one's name (`None` for a
    /// computed one), whether it is called, and the position it ends in.
    fn chain(&self, span: Span) -> (usize, Option<&'r str>, bool, Option<&AstKind<'r>>) {
        let (mut members, mut first) = (0, None);
        let mut up = self.ancestors.iter().rev();
        let mut current = span;
        loop {
            let (at, parent) = super::peel_wrappers(current, &mut up);
            let member = match parent {
                Some(AstKind::StaticMemberExpression(member)) if member.object.span() == at => {
                    if members == 0 {
                        first = Some(member.property.name.as_str());
                    }
                    member.span
                }
                Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == at => {
                    if members == 0 {
                        first = member.static_property_name().map(|name| name.as_str());
                    }
                    member.span
                }
                Some(AstKind::CallExpression(call)) if call.callee.span() == at => return (members, first, true, parent),
                Some(AstKind::NewExpression(call)) if call.callee.span() == at => return (members, first, true, parent),
                parent => return (members, first, false, parent),
            };
            members += 1;
            current = member;
        }
    }

    /// Whether a trusted name, used itself as a value under `parent`, stays
    /// where the walk can see it: tested, compared, `typeof`, a base class,
    /// or handed to a built-in array method, a global function or React.
    fn harmless_value(&self, parent: Option<&AstKind<'r>>, span: Span) -> bool {
        match parent {
            None => true,
            Some(AstKind::UnaryExpression(unary)) => matches!(unary.operator, UnaryOperator::Typeof | UnaryOperator::LogicalNot),
            Some(AstKind::BinaryExpression(binary)) => {
                binary.operator.is_equality()
                    || (matches!(binary.operator, BinaryOperator::Instanceof | BinaryOperator::In) && binary.right.span() == span)
            }
            Some(AstKind::LogicalExpression(logical)) => {
                logical.operator == oxc::syntax::operator::LogicalOperator::And && logical.left.span() == span
            }
            Some(AstKind::IfStatement(_) | AstKind::ConditionalExpression(_) | AstKind::WhileStatement(_)) => true,
            Some(AstKind::Class(class)) => class.heritage.as_ref().is_some_and(|heritage| heritage.expression.span() == span),
            Some(AstKind::JSXOpeningElement(_) | AstKind::JSXClosingElement(_) | AstKind::JSXMemberExpression(_)) => true,
            Some(AstKind::CallExpression(call)) => match unwrap_type_assertions(&call.callee) {
                Expression::StaticMemberExpression(member) => {
                    ARRAY_READ_METHODS.contains(&member.property.name.as_str())
                        || matches!(&member.object, Expression::Identifier(object) if self.symbol(object).is_some_and(|symbol| self.react_imports.contains(&symbol)))
                }
                Expression::Identifier(callee) => match self.symbol(callee) {
                    None => true,
                    Some(symbol) => self.react_imports.contains(&symbol),
                },
                _ => false,
            },
            _ => false,
        }
    }

    /// Whether the reference `id`, to a global (any name the module does
    /// not bind) or a React import, could redirect what the allowlist
    /// trusts: a trusted global, the global object or a React import let go
    /// as a value, or a trusted global read off the global object
    /// (`window.Math`) and let go. A write into anything reached from it is
    /// `written_into`'s.
    fn redirects(&self, id: &IdentifierReference<'_>) -> bool {
        // A type is erased: it reaches nothing at run time.
        let value = id.reference_id.get().is_some_and(|reference| self.scoping.get_reference(reference).is_value());
        if !value {
            return false;
        }
        let name = id.name.as_str();
        let reached = match self.symbol(id) {
            None => !matches!(name, "undefined" | "NaN" | "Infinity" | "arguments"),
            Some(symbol) => self.react_imports.contains(&symbol),
        };
        if !reached {
            return false;
        }
        // A write into anything reached from it is a write into an object
        // the module does not own (`written_into`). An object React keeps
        // under a member (`Children`, its internals' hooks dispatcher) is
        // let go through that member, where a binding may then be written
        // into unseen: only React's functions and classes are not objects
        // whose members redirect React.
        let (members, first, called, parent) = self.chain(id.span);
        let react = self.symbol(id).is_some();
        let let_go = match members {
            _ if called => false,
            0 => react || trusted_global(name),
            1 if !react => GLOBAL_OBJECTS.contains(&name) && first.is_none_or(trusted_global),
            _ => react && first.is_none_or(|first| !react_value(first)),
        };
        let_go && !self.harmless_value(parent, id.span)
    }

}

/// What an object literal's properties can run.
struct LiteralShape {
    /// Data properties only, with no prototype it sets: a store of a
    /// property into it runs no code.
    plain: bool,
    /// A getter, a computed or spread property (which may
    /// be a conversion's or an iterator's), or a property named for a
    /// conversion, `then` or the prototype: see `Held::hookable`.
    hookable: bool,
}

impl LiteralShape {
    fn of(object: &oxc::ast::ast::ObjectExpression<'_>) -> Self {
        let mut shape = LiteralShape { plain: true, hookable: false };
        for property in &object.properties {
            match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    let name = property.key.static_name().filter(|_| !property.computed);
                    let sets_prototype = !property.shorthand && name.as_deref() == Some("__proto__");
                    shape.plain &= property.kind == PropertyKind::Init && !sets_prototype;
                    // A setter runs on a store with the object as `this`.
                    shape.hookable |= matches!(property.kind, PropertyKind::Get | PropertyKind::Set)
                        || property.computed
                        || name.is_some_and(|name| HOOK_KEYS.contains(&name.as_ref()));
                }
                ObjectPropertyKind::SpreadProperty(_) => shape.hookable = true,
            }
        }
        shape
    }
}

/// Whether `object.name` is a built-in that writes into its first argument.
fn writer(object: &str, name: &str) -> bool {
    match object {
        "Object" => matches!(name, "assign" | "defineProperty" | "defineProperties" | "setPrototypeOf"),
        "Reflect" => matches!(name, "set" | "defineProperty" | "deleteProperty" | "setPrototypeOf"),
        _ => false,
    }
}

/// The argument positions an array's read method `name` calls: its
/// callback's, for a method that takes one. Any other argument it converts
/// or compares.
fn array_calls(name: &str) -> &'static [usize] {
    if name == "toSorted" || ARRAY_CALLBACK_METHODS.iter().any(|(method, _)| *method == name) {
        &[0]
    } else {
        &[]
    }
}

/// Whether `name` is a method the allowlist trusts on a built-in's
/// prototype or namespace (`Math`, `console`, a static), or a hook a
/// built-in runs: written into the object, it would redirect it for every
/// use.
fn built_in_name(name: &str) -> bool {
    ARRAY_READ_METHODS.contains(&name)
        || ARRAY_WRITE_METHODS.contains(&name)
        || HOOK_KEYS.contains(&name)
        || MATH_METHODS.contains(&name)
        || CONSOLE_METHODS.contains(&name)
        || TRUSTED_STATICS.contains(&name)
        || matches!(name, "constructor" | "call" | "apply" | "bind")
}

/// Whether `expression` names a built-in whose prototype every value of its
/// kind shares, `unbound` saying which names no binding shadows: `Array`, or
/// `globalThis.Array`.
fn intrinsic(expression: &Expression<'_>, unbound: impl Fn(&IdentifierReference<'_>) -> bool) -> bool {
    match unwrap_type_assertions(expression) {
        Expression::Identifier(id) => INTRINSICS.contains(&id.name.as_str()) && unbound(id),
        Expression::StaticMemberExpression(member) => {
            INTRINSICS.contains(&member.property.name.as_str())
                && matches!(&member.object, Expression::Identifier(id) if GLOBAL_OBJECTS.contains(&id.name.as_str()) && unbound(id))
        }
        _ => false,
    }
}

/// Whether a store of `name` may redirect what the walk trusts by name: a
/// built-in's method or hook, React's functions, a writer, a prototype, or
/// a trusted global, which an object that may be the global object holds
/// (`document.defaultView`).
fn trusted_name(name: &str) -> bool {
    built_in_name(name)
        || trusted_global(name)
        || !matches!(react_function(name), Callee::Unknown)
        || writer("Object", name)
        || writer("Reflect", name)
        || matches!(name, "prototype" | "getPrototypeOf" | "Children" | "setState" | "forceUpdate")
}

/// Whether a React module's export `name` holds nothing whose members
/// redirect React: one of its functions, a component class, or `version`.
fn react_value(name: &str) -> bool {
    !matches!(react_function(name), Callee::Unknown) || matches!(name, "Component" | "PureComponent" | "version")
}

/// The call `expression` is, under type assertions.
fn current_call<'e, 'a>(expression: Option<&'e Expression<'a>>) -> Option<&'e CallExpression<'a>> {
    match expression.map(unwrap_type_assertions) {
        Some(Expression::CallExpression(call)) => Some(call),
        _ => None,
    }
}

/// Whether `class`, one of its members or a parameter of one of its
/// methods (the constructor's included) has a decorator.
fn decorated(class: &Class<'_>) -> bool {
    !class.decorators.is_empty()
        || class.body.body.iter().any(|element| match element {
            oxc::ast::ast::ClassElement::MethodDefinition(method) => {
                !method.decorators.is_empty() || method.value.params.items.iter().any(|parameter| !parameter.decorators.is_empty())
            }
            oxc::ast::ast::ClassElement::PropertyDefinition(property) => !property.decorators.is_empty(),
            oxc::ast::ast::ClassElement::AccessorProperty(property) => !property.decorators.is_empty(),
            _ => false,
        })
}

/// The scope of the nearest non-arrow function among `ancestors`, whose
/// `arguments` a reference there reads.
fn own_function(ancestors: &[AstKind<'_>]) -> Option<ScopeId> {
    ancestors.iter().rev().find_map(|kind| match kind {
        AstKind::Function(function) => function.scope_id.get(),
        _ => None,
    })
}

/// Whether `test` holds of every value a function returns: an arrow's
/// concise body, or each of its body's own `return`s, and `None` for
/// running off its end or a bare `return`.
fn every_return(body: ComponentBody<'_, '_>, test: &dyn Fn(Option<&Expression<'_>>) -> bool) -> bool {
    // A `return` is a statement outside any nested function or class, so
    // the walk skips expressions, and stops at the first that fails.
    struct Returns<'t> {
        test: &'t dyn Fn(Option<&Expression<'_>>) -> bool,
        every: bool,
    }
    impl<'a> Visit<'a> for Returns<'_> {
        fn visit_return_statement(&mut self, statement: &oxc::ast::ast::ReturnStatement<'a>) {
            self.every = self.every && (self.test)(statement.argument.as_ref());
        }
        fn visit_expression(&mut self, _expression: &Expression<'a>) {}
        fn visit_function(&mut self, _function: &Function<'a>, _flags: oxc::syntax::scope::ScopeFlags) {}
        fn visit_class(&mut self, _class: &Class<'a>) {}
    }
    if let ComponentBody::Arrow(body) = body {
        if let Some(value) = body.as_expression() {
            return test(Some(value));
        }
    }
    let mut returns = Returns { test, every: test(None) };
    body.visit(&mut returns);
    returns.every
}

/// The scope of a function written as `expression`.
fn function_scope(expression: &Expression<'_>) -> Option<ScopeId> {
    match expression {
        Expression::ArrowFunctionExpression(arrow) => arrow.scope_id.get(),
        Expression::FunctionExpression(function) => function.scope_id.get(),
        _ => None,
    }
}

impl<'a> Visit<'a> for Declarations<'a> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    // Once the walk has left a function bound to a name, the `const`s its
    // returns may name are known.
    fn leave_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.pop();
        let (id, body) = match kind {
            AstKind::Function(function) if !function.generator && !function.r#async => {
                (function.id.as_ref(), function.body.as_deref().map(ComponentBody::Function))
            }
            AstKind::VariableDeclarator(declarator) => match (&declarator.id, declarator.init.as_ref().map(unwrap_type_assertions)) {
                (BindingPattern::BindingIdentifier(id), Some(Expression::ArrowFunctionExpression(arrow))) if !arrow.r#async => {
                    (Some(&**id), Some(ComponentBody::Arrow(&arrow.body)))
                }
                (BindingPattern::BindingIdentifier(id), Some(Expression::FunctionExpression(function)))
                    if !function.generator && !function.r#async =>
                {
                    (Some(&**id), function.body.as_deref().map(ComponentBody::Function))
                }
                _ => return,
            },
            _ => return,
        };
        let (Some(symbol), Some(body)) = (id.and_then(|id| id.symbol_id.get()), body) else { return };
        if !self.scoping.symbol_is_mutated(symbol) && every_return(body, &|value| value.is_none_or(|value| self.primitive_by(value, false))) {
            self.primitive_functions.insert(symbol);
        }
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        let base = match class.heritage.as_ref().map(|heritage| unwrap_type_assertions(&heritage.expression)) {
            None => Base::None,
            Some(base) if self.react.names(self.scoping, base, &["Component", "PureComponent"], true) => Base::React,
            Some(Expression::Identifier(id)) => Base::Other(self.symbol(id).filter(|symbol| {
                self.scoping.symbol_scope_id(*symbol) == self.scoping.root_scope_id() && !self.scoping.symbol_is_mutated(*symbol)
            }).map(|_| id.name.to_string())),
            Some(_) => Base::Other(None),
        };
        let mut facts = ClassFacts {
            base,
            methods: FxHashMap::default(),
            members: FxHashSet::default(),
            accessors: FxHashSet::default(),
            written: FxHashSet::default(),
            this_escapes: false,
            sealed: false,
        };
        for element in &class.body.body {
            match element {
                oxc::ast::ast::ClassElement::MethodDefinition(method) if !method.r#static => {
                    let Some(name) = member_name(&method.key).filter(|_| !method.computed) else {
                        facts.this_escapes = true;
                        continue;
                    };
                    match method.kind {
                        MethodDefinitionKind::Method => match method.value.scope_id.get() {
                            // A second method of the name replaces the first.
                            Some(scope) if facts.methods.insert(name.clone(), scope).is_none() => {}
                            _ => {
                                facts.members.insert(name);
                            }
                        },
                        MethodDefinitionKind::Get | MethodDefinitionKind::Set => {
                            facts.accessors.insert(name.clone());
                            facts.members.insert(name);
                        }
                        MethodDefinitionKind::Constructor => {}
                    }
                }
                oxc::ast::ast::ClassElement::PropertyDefinition(property) if !property.r#static => {
                    match member_name(&property.key).filter(|_| !property.computed) {
                        Some(name) => {
                            facts.members.insert(name);
                        }
                        None => facts.this_escapes = true,
                    }
                }
                oxc::ast::ast::ClassElement::AccessorProperty(_) => facts.this_escapes = true,
                _ => {}
            }
        }
        self.classes.insert(class.span.start, facts);
        if let Some(symbol) = class.id.as_ref().and_then(|id| id.symbol_id.get()) {
            self.class_bindings.insert(symbol, class.span.start);
        }
        oxc::ast_visit::walk::walk_class(self, class);
    }

    fn visit_this_expression(&mut self, this: &oxc::ast::ast::ThisExpression) {
        let Some((class, statics)) = self.this_class() else { return };
        // `this` in a static block, field or method is the class itself,
        // whose prototype its code can reach.
        if statics {
            if let Some(facts) = self.classes.get_mut(&class) {
                facts.this_escapes = true;
            }
            return;
        }
        // The ancestors end at the parent of `this`.
        let mut up = self.ancestors.iter().rev();
        let (current, parent) = super::peel_wrappers(this.span, &mut up);
        let (member, name) = match parent {
            Some(AstKind::StaticMemberExpression(member)) if member.object.span() == current => {
                (member.span, Some(member.property.name.to_string()))
            }
            Some(AstKind::PrivateFieldExpression(member)) if member.object.span() == current => {
                (member.span, Some(format!("#{}", member.field.name)))
            }
            _ => (this.span, None),
        };
        let Some(facts) = self.classes.get_mut(&class) else { return };
        match name {
            // The class itself, whose prototype any code given it can change.
            Some(name) if name == "constructor" => facts.this_escapes = true,
            Some(name) => {
                if matches!(super::member_effect(member, up), Some(MemberEffect::Assigned | MemberEffect::Deleted)) {
                    facts.written.insert(name);
                }
            }
            None => facts.this_escapes = true,
        }
    }

    fn visit_jsx_opening_element(&mut self, opening: &oxc::ast::ast::JSXOpeningElement<'a>) {
        self.count_tag(&opening.name);
        oxc::ast_visit::walk::walk_jsx_opening_element(self, opening);
    }

    fn visit_jsx_closing_element(&mut self, closing: &oxc::ast::ast::JSXClosingElement<'a>) {
        self.count_tag(&closing.name);
        oxc::ast_visit::walk::walk_jsx_closing_element(self, closing);
    }

    // A destructuring that reads a prototype, `__proto__` or a computed key
    // may take a prototype into a binding, unless a function's binding no
    // code reads takes it (`const { [k]: _left, ...rest } = o`).
    fn visit_binding_property(&mut self, property: &oxc::ast::ast::BindingProperty<'a>) {
        let unread = matches!(&property.value, BindingPattern::BindingIdentifier(id) if id.symbol_id.get().is_some_and(|symbol| {
            self.scoping.symbol_scope_id(symbol) != self.scoping.root_scope_id() && self.scoping.get_resolved_reference_ids(symbol).is_empty()
        }));
        if (property.computed && !unread) || property.key.static_name().is_some_and(|key| matches!(key.as_ref(), "prototype" | "__proto__")) {
            self.patch(property.span.start, "prototype-let-go");
        }
        oxc::ast_visit::walk::walk_binding_property(self, property);
    }

    fn visit_assignment_target_property_property(&mut self, property: &oxc::ast::ast::AssignmentTargetPropertyProperty<'a>) {
        if property.computed || property.name.static_name().is_some_and(|key| matches!(key.as_ref(), "prototype" | "__proto__")) {
            self.patch(property.span.start, "prototype-let-go");
        }
        oxc::ast_visit::walk::walk_assignment_target_property_property(self, property);
    }

    fn visit_assignment_target_property_identifier(&mut self, property: &oxc::ast::ast::AssignmentTargetPropertyIdentifier<'a>) {
        if matches!(property.binding.name.as_str(), "prototype" | "__proto__") {
            self.patch(property.span.start, "prototype-let-go");
        }
        oxc::ast_visit::walk::walk_assignment_target_property_identifier(self, property);
    }

    fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
        self.member(member.span, &member.object, Some(member.property.name.as_str()), false);
        oxc::ast_visit::walk::walk_static_member_expression(self, member);
    }

    fn visit_computed_member_expression(&mut self, member: &oxc::ast::ast::ComputedMemberExpression<'a>) {
        self.member(member.span, &member.object, member.static_property_name().map(|name| name.as_str()), true);
        oxc::ast_visit::walk::walk_computed_member_expression(self, member);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let callee = unwrap_type_assertions(&call.callee).as_member_expression();
        // `__defineGetter__`, `__defineSetter__` and their kin write into the
        // object they are called on.
        if let Some(member) = callee.filter(|member| {
            member.static_property_name().is_some_and(|name| name.len() > 4 && name.starts_with("__") && name.ends_with("__"))
        }) {
            self.written_into(member.object(), true);
        }
        // `getPrototypeOf`'s result, off any root but a binding the module
        // declares, is a prototype.
        if callee.is_some_and(|member| member.static_property_name() == Some("getPrototypeOf") && !self.module_binding(member.object()))
            && self.reshapes(call.span)
        {
            self.patch(call.span.start, "prototype-use");
        }
        if let Some((Expression::Identifier(object), Some(name))) = callee.map(|member| (member.object(), member.static_property_name())) {
            if self.symbol(object).is_none() {
                // A built-in that writes into its first argument; a spread
                // first argument is a target the module does not own.
                // `Object.assign` writes exactly its sources' own keys: from
                // sources that can carry no callable under a trusted key, into
                // any target, it redirects nothing.
                if writer(&object.name, name) {
                    match call.arguments.first().map(|argument| argument.as_expression()) {
                        Some(Some(target))
                            if (object.name.as_str(), name) == ("Object", "assign")
                                && call.arguments.iter().skip(1).all(|source| source.as_expression().is_some_and(|source| self.no_trusted_callable(source))) =>
                        {
                            if !self.unshared(target) && self.maybe_prototype(target) {
                                for source in call.arguments.iter().skip(1).filter_map(|argument| argument.as_expression()) {
                                    if let Expression::ObjectExpression(literal) = unwrap_type_assertions(source) {
                                        let keys = literal.properties.iter().filter_map(|property| match property {
                                            ObjectPropertyKind::ObjectProperty(property) => property.key.static_name(),
                                            ObjectPropertyKind::SpreadProperty(_) => None,
                                        });
                                        self.keyed_stores.extend(keys.map(|key| (call.span.start, key.to_string())));
                                    }
                                }
                            }
                        }
                        Some(Some(target)) => self.written_into(target, true),
                        Some(None) => self.patch(call.span.start, "spread-target"),
                        None => {}
                    }
                }
            }
        }
        // React's `Component` hands the updater it gets the instance.
        if matches!(call.callee, Expression::Super(_)) && call.arguments.len() > 1 {
            if let Some((class, _)) = self.this_class() {
                if let Some(facts) = self.classes.get_mut(&class) {
                    facts.this_escapes = true;
                }
            }
        }
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }

    fn visit_object_expression(&mut self, object: &oxc::ast::ast::ObjectExpression<'a>) {
        if LiteralShape::of(object).hookable {
            self.hookable_objects.insert(object.span.start);
        }
        oxc::ast_visit::walk::walk_object_expression(self, object);
    }

    fn visit_assignment_expression(&mut self, assignment: &oxc::ast::ast::AssignmentExpression<'a>) {
        // A store by a computed key may set any property, a hook or the
        // prototype included; so may one by a hook's name. Into an array,
        // any named property may be one its built-ins run (`join`,
        // `constructor`).
        if let Some(member) = assignment.left.as_member_expression() {
            if let Expression::Identifier(object) = unwrap_type_assertions(member.object()) {
                if let Some(symbol) = self.symbol(object) {
                    match member {
                        oxc::ast::ast::MemberExpression::ComputedMemberExpression(computed) => {
                            if !matches!(computed.expression, Expression::NumericLiteral(_)) {
                                self.hookable_bindings.insert(symbol);
                            }
                        }
                        member => {
                            if member.static_property_name().is_some_and(|name| HOOK_KEYS.contains(&name)) {
                                self.hookable_bindings.insert(symbol);
                            } else {
                                self.named_stores.insert(symbol);
                            }
                        }
                    }
                }
            }
        }
        oxc::ast_visit::walk::walk_assignment_expression(self, assignment);
    }

    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        let symbol = self.symbol(id);
        if let Some(symbol) = symbol {
            let mut up = self.ancestors.iter().rev();
            let plain = match super::peel_wrappers(id.span, &mut up) {
                (current, Some(AstKind::JSXSpreadAttribute(spread))) => spread.argument.span() == current,
                (current, Some(AstKind::StaticMemberExpression(member))) => {
                    member.object.span() == current && super::member_effect(member.span, up).is_none()
                }
                _ => false,
            };
            if !plain {
                self.reshaped.insert(symbol);
                if !self.element_config(id.span) {
                    self.reshaped_beyond_clones.insert(symbol);
                }
            }
        }
        if let Some(symbol) = symbol.filter(|symbol| self.may_hold_array(*symbol)) {
            match array_use(&self.ancestors, id.span) {
                ArrayUse::Is(used) => self.uses[symbol.index()] |= used.bit(),
                ArrayUse::Callback(name, call) => self.blind_calls.push((symbol, name, call)),
            }
        }
        if id.name == "arguments" && symbol.is_none() {
            self.uses_arguments.extend(own_function(&self.ancestors));
        }
        // A type reference (`onClose: Function`) runs and hands on nothing.
        if !id.reference_id.get().is_some_and(|reference| self.scoping.get_reference(reference).is_value()) {
            return;
        }
        // Indirect `eval` and `Function` run strings the analysis cannot read.
        let runs_strings = matches!(id.name.as_str(), "eval" | "Function") && symbol.is_none();
        if runs_strings {
            if !self.only_inspected(id.span) {
                self.patch(id.span.start, "string-code");
            }
        } else if self.redirects(id) {
            if id.name == "Object" {
                self.rewrites_object = true;
            }
            match self.import_receiver(id.span) {
                Some(import) => self.outside_let_goes.push((id.span.start, import)),
                None => self.patch(id.span.start, "trusted-let-go"),
            }
        }
    }

    /// `new.target` in a class is the class itself, as `this.constructor` is.
    fn visit_new_target(&mut self, _target: &oxc::ast::ast::NewTarget) {
        if let Some((class, _)) = self.this_class() {
            if let Some(facts) = self.classes.get_mut(&class) {
                facts.this_escapes = true;
            }
        }
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: oxc::syntax::scope::ScopeFlags) {
        if let Some(scope) = function.scope_id.get() {
            self.declare_params(scope, &function.params);
            if let Some(symbol) = function.id.as_ref().and_then(|id| id.symbol_id.get()) {
                self.functions.insert(symbol, scope);
            }
        }
        if let Some(body) = &function.body {
            self.literal_bindings.extend(self.accumulator(function.span, &function.params, ComponentBody::Function(body)));
        }
        self.depth += 1;
        oxc::ast_visit::walk::walk_function(self, function, flags);
        self.depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &oxc::ast::ast::ArrowFunctionExpression<'a>) {
        if let Some(scope) = arrow.scope_id.get() {
            self.declare_params(scope, &arrow.params);
        }
        self.literal_bindings.extend(self.accumulator(arrow.span, &arrow.params, ComponentBody::Arrow(&arrow.body)));
        self.depth += 1;
        oxc::ast_visit::walk::walk_arrow_function_expression(self, arrow);
        self.depth -= 1;
    }

    fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
        if let Some(init) = &declarator.init {
            let init = unwrap_type_assertions(init);
            if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                if let Some(symbol) = id.symbol_id.get() {
                    self.functions.extend(function_scope(init).map(|scope| (symbol, scope)));
                    if let Expression::ClassExpression(class) = init {
                        self.class_bindings.insert(symbol, class.span.start);
                    }
                    let constant = !self.scoping.symbol_is_mutated(symbol);
                    let literal = matches!(init, Expression::ObjectExpression(_) | Expression::ClassExpression(_))
                        || function_scope(init).is_some()
                        || self.fresh_array(init);
                    if constant && literal {
                        self.literal_bindings.insert(symbol);
                    }
                    if constant && self.primitive(init) {
                        self.primitive_consts.insert(symbol);
                    }
                    match init {
                        Expression::ArrayExpression(_) if constant && self.depth == 0 => {
                            self.module_arrays.insert(symbol);
                        }
                        Expression::ArrayExpression(_) if constant => {
                            self.local_arrays.insert(symbol);
                        }
                        _ => {}
                    }
                    // A module binding is anyone's to read: only a function's
                    // own literal keeps what is stored in it. One declared to a
                    // literal with hooks holds them.
                    let plain = match init {
                        Expression::ArrayExpression(_) => true,
                        Expression::ObjectExpression(object) => {
                            let shape = LiteralShape::of(object);
                            if shape.hookable {
                                self.hookable_bindings.insert(symbol);
                            }
                            shape.plain
                        }
                        _ => false,
                    };
                    if self.depth > 0 && constant && plain {
                        self.in_place.insert(symbol);
                    }
                }
            }
            // React's own state setters: `const [state, set] = useState()`.
            if let (BindingPattern::ArrayPattern(pattern), Expression::CallExpression(call)) = (&declarator.id, init) {
                const STATE_HOOKS: [&str; 5] = ["useState", "useReducer", "useTransition", "useOptimistic", "useActionState"];
                if self.react.names(self.scoping, &call.callee, &STATE_HOOKS, true) {
                    let states: Vec<SymbolId> = pattern.elements.first().into_iter().flatten().flat_map(bindings).collect();
                    for element in pattern.elements.iter().skip(1).flatten() {
                        if let BindingPattern::BindingIdentifier(id) = element {
                            if let Some(symbol) = id.symbol_id.get() {
                                self.setters.insert(symbol, states.clone());
                            }
                        }
                    }
                    self.hook_states.insert(call.span.start, states);
                }
            }
        }
        oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
    }
}

/// The walk over one unit.
struct Walk<'m, 's, 'a> {
    module: &'m mut Module<'s>,
    /// Where the walk found each function, for walking it again alone.
    contexts: &'m mut FxHashMap<u32, Context<'a>>,
    /// The names the statement binds, which a forwarding record names.
    top: Rc<[String]>,
    ancestors: Vec<AstKind<'a>>,
    /// How many functions the visit is inside.
    depth: usize,
    /// The classes the visit is inside, innermost last, by span.
    class: Vec<u32>,
}

/// What a position does with the value that reaches it.
enum Place {
    /// The value is the parent's: climb on.
    Carry,
    /// The parent is this value: climb on with it.
    Becomes(Held),
    /// The value stays in place, for the reason given: the reason documents
    /// the allowlist and is read by nothing else.
    Kept(#[allow(dead_code)] InPlace),
    /// Code the analysis cannot see receives it.
    Handed,
}

impl<'m, 's, 'a> Walk<'m, 's, 'a> {
    fn new(
        module: &'m mut Module<'s>,
        contexts: &'m mut FxHashMap<u32, Context<'a>>,
        top: Rc<[String]>,
        ancestors: Vec<AstKind<'a>>,
        depth: usize,
        class: Vec<u32>,
    ) -> Self {
        Walk { module, contexts, top, ancestors, depth, class }
    }

    /// Records where `function` is, the first time the walk finds it, and
    /// makes it the unit the walk's reads belong to, returning the unit to
    /// restore after it.
    fn enter_unit(&mut self, start: u32, function: FunctionNode<'a>) -> Unit {
        if !self.contexts.contains_key(&start) {
            let context = Context { function, ancestors: self.ancestors.clone(), depth: self.depth, class: self.class.clone(), top: Rc::clone(&self.top) };
            self.contexts.insert(start, context);
        }
        std::mem::replace(&mut self.module.unit, Unit::Function(start))
    }
}

impl<'a> Walk<'_, '_, 'a> {
    fn sink(&mut self, at: u32, callee: Option<String>, value: &Held) {
        self.module.sink(at, callee, None, &self.top, value);
    }

    /// Adds `value`'s elements to what the statement's bindings hold, from
    /// the position at `at`.
    fn top_join(&mut self, at: u32, value: &Held) {
        self.declared_hooks(at, value);
        for name in self.top.iter() {
            self.module.top_join(name, value);
        }
    }

    /// A hookable value a top-level binding holds reaches whoever reads the
    /// binding, in any module, where the hook bit does not follow: it is
    /// handed outside where it is declared. (A store that makes a binding
    /// hookable reads a member of it, which hands what it holds already.)
    fn declared_hooks(&mut self, at: u32, value: &Held) {
        if value.hookable && !value.is_empty() {
            self.sink(at, None, value);
        }
    }

    /// Whether `callee` is one of React's functions: `useRef`,
    /// `React.useMemo`, `Children.map`, `React.Children.map`.
    fn react_callee(&self, callee: &Expression<'_>) -> bool {
        let root = match unwrap_type_assertions(callee) {
            Expression::StaticMemberExpression(member) => member.get_first_object(),
            callee => callee,
        };
        matches!(unwrap_type_assertions(root), Expression::Identifier(id) if self.module.react(id))
    }

    /// Whether a clone's props set nothing but what the caller wrote: the
    /// component's inputs, spread or named, and keys other than `ref`, `as`,
    /// `asChild` and `is` whose values hold no element.
    fn clone_props(&mut self, props: &Expression<'_>) -> bool {
        let mut inputs_only = |expression: &Expression<'_>| match unwrap_type_assertions(expression) {
            Expression::Identifier(id) => self.module.symbol(id).is_some_and(|symbol| {
                let held = self.module.read(symbol);
                !held.has_elements() && !held.hookable
            }),
            _ => false,
        };
        match unwrap_type_assertions(props) {
            Expression::Identifier(_) => inputs_only(props),
            Expression::ObjectExpression(object) => object.properties.iter().all(|property| match property {
                ObjectPropertyKind::SpreadProperty(spread) => inputs_only(&spread.argument),
                ObjectPropertyKind::ObjectProperty(property) => {
                    !property.computed
                        && property.kind == PropertyKind::Init
                        && property.key.static_name().is_some_and(|name| plain_key(&name))
                        && match unwrap_type_assertions(&property.value) {
                            Expression::Identifier(_) => inputs_only(&property.value),
                            Expression::StaticMemberExpression(member) => {
                                let mut root = &member.object;
                                while let Expression::StaticMemberExpression(inner) = unwrap_type_assertions(root) {
                                    root = &inner.object;
                                }
                                inputs_only(root)
                            }
                            Expression::StringLiteral(_)
                            | Expression::NumericLiteral(_)
                            | Expression::BooleanLiteral(_)
                            | Expression::NullLiteral(_)
                            | Expression::ArrowFunctionExpression(_)
                            | Expression::FunctionExpression(_) => true,
                            _ => false,
                        }
                }
            }),
            _ => false,
        }
    }

    /// Whether `call` clones the component's own `children` input with only
    /// what its caller wrote (`callers_only`), and if so whether only where
    /// the caller writes `asChild` (`as_child_gated`).
    fn child_clone(&mut self, call: &CallExpression<'_>) -> Option<bool> {
        if call.arguments.len() > 2 {
            return None;
        }
        let children = self.module.names.id("children");
        let held = match call.arguments.first()?.as_expression().map(unwrap_type_assertions)? {
            Expression::Identifier(id) => self.module.read(self.module.symbol(id)?),
            Expression::StaticMemberExpression(member) if member.property.name == "children" => {
                let Expression::Identifier(id) = unwrap_type_assertions(&member.object) else { return None };
                if !self.untouched(id, &self.module.props_params) && !self.untouched(id, &self.module.caller_params) {
                    return None;
                }
                self.module.read(self.module.symbol(id)?).member(children)
            }
            _ => return None,
        };
        let only_children = held.inputs == Inputs::named(BTreeSet::from([children])) && !held.has_elements() && !held.hookable;
        (only_children && call.arguments.get(1).is_none_or(|props| props.as_expression().is_some_and(|props| self.callers_only(props))))
            .then(|| self.as_child_gated(call.span))
    }

    /// The top-level component the walk is in clones its own children,
    /// `gated` where only its caller's `asChild` runs the clone.
    fn clones_children(&mut self, gated: bool) {
        let top = Rc::clone(&self.top);
        for name in top.iter() {
            let entry = self.module.child_cloners.entry(name.clone()).or_insert(gated);
            *entry &= gated;
        }
    }

    /// Whether the expression at `span` runs only where the component's
    /// caller writes `asChild`: in the branch a test of that input takes.
    fn as_child_gated(&self, span: Span) -> bool {
        // A read leaves the input as the caller wrote it.
        let as_child = |test: &Expression<'_>| match unwrap_type_assertions(test) {
            Expression::Identifier(id) => self.unchanged(id, &self.module.as_child_params),
            Expression::StaticMemberExpression(member) => {
                member.property.name == "asChild"
                    && matches!(unwrap_type_assertions(&member.object), Expression::Identifier(id) if self.untouched(id, &self.module.props_params))
            }
            _ => false,
        };
        let within = |outer: Span| outer.start <= span.start && span.end <= outer.end;
        for kind in self.ancestors.iter().rev() {
            match kind {
                AstKind::ConditionalExpression(conditional) if within(conditional.consequent.span()) && as_child(&conditional.test) => return true,
                AstKind::IfStatement(statement) if within(statement.consequent.span()) && as_child(&statement.test) => return true,
                AstKind::LogicalExpression(logical)
                    if logical.operator == oxc::syntax::operator::LogicalOperator::And && within(logical.right.span()) && as_child(&logical.left) =>
                {
                    return true;
                }
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
                _ => {}
            }
        }
        false
    }

    /// Whether `id` names one of `among`, which nothing reassigns or uses
    /// but to read a member, spread it into JSX or set an element's config.
    fn untouched(&self, id: &IdentifierReference<'_>, among: &FxHashSet<SymbolId>) -> bool {
        self.unchanged(id, among) && self.module.symbol(id).is_some_and(|symbol| !self.module.reshaped_beyond_clones.contains(&symbol))
    }

    /// Whether `props`, a clone's config, sets only what the component's
    /// caller wrote, never its `asChild`: a rest or a prop its parameters
    /// name with no default (`ParamInput::caller`), or a member of its props
    /// object, spread or under a plain key. A cloner's own value would set a
    /// prop the caller's child never wrote.
    fn callers_only(&self, props: &Expression<'_>) -> bool {
        let caller = |expression: &Expression<'_>| match unwrap_type_assertions(expression) {
            Expression::Identifier(id) => self.untouched(id, &self.module.caller_params),
            Expression::StaticMemberExpression(member) => {
                member.property.name != "asChild"
                    && matches!(unwrap_type_assertions(&member.object), Expression::Identifier(id) if self.untouched(id, &self.module.props_params))
            }
            _ => false,
        };
        match unwrap_type_assertions(props) {
            Expression::ObjectExpression(object) => object.properties.iter().all(|property| match property {
                ObjectPropertyKind::SpreadProperty(spread) => caller(&spread.argument),
                ObjectPropertyKind::ObjectProperty(property) => {
                    !property.computed
                        && property.kind == PropertyKind::Init
                        && property.key.static_name().is_some_and(|name| plain_key(&name))
                        && caller(&property.value)
                }
            }),
            props => caller(props),
        }
    }

    /// Whether `call` is Animus's `renderAsChild`, which reads what it gets
    /// as `cloneElement` does.
    fn renders_slot(&self, call: &CallExpression<'_>) -> bool {
        matches!(unwrap_type_assertions(&call.callee), Expression::Identifier(id)
            if self.module.symbol(id).is_some_and(|symbol| self.module.slot_renders.contains(&symbol)))
    }

    /// Whether `call` is React's function `name`.
    fn react_call(&self, call: &CallExpression<'_>, name: &str) -> bool {
        match unwrap_type_assertions(&call.callee) {
            Expression::Identifier(id) => self.module.react_name(id) == Some(name),
            Expression::StaticMemberExpression(member) => member.property.name == name && self.react_callee(&call.callee),
            _ => false,
        }
    }

    /// Whether `call` is React's `createElement`.
    fn creates_element(&self, call: &CallExpression<'_>) -> bool {
        self.react_call(call, "createElement")
    }

    /// Whether `expression`, an element's type, is the component's own `as`
    /// input or a host element's name: the element renders what its
    /// caller's site writes, which that site judges, or that host element.
    /// `Some(true)` where it may be the caller's `as`.
    fn caller_type(&self, expression: &Expression<'_>) -> Option<bool> {
        match unwrap_type_assertions(expression) {
            Expression::StringLiteral(name) => (!name.value.contains('-')).then_some(false),
            Expression::Identifier(id) => self.unchanged(id, &self.module.as_types).then_some(true),
            Expression::StaticMemberExpression(member) => (member.property.name == "as"
                && matches!(unwrap_type_assertions(&member.object), Expression::Identifier(id) if self.unchanged(id, &self.module.props_params)))
            .then_some(true),
            Expression::LogicalExpression(logical)
                if matches!(logical.operator, oxc::syntax::operator::LogicalOperator::Coalesce | oxc::syntax::operator::LogicalOperator::Or) =>
            {
                Some(self.caller_type(&logical.left)? | self.caller_type(&logical.right)?)
            }
            Expression::ConditionalExpression(conditional) => {
                Some(self.caller_type(&conditional.consequent)? | self.caller_type(&conditional.alternate)?)
            }
            _ => None,
        }
    }

    /// Whether `id` names one of `among`, which nothing reassigns.
    fn unchanged(&self, id: &IdentifierReference<'_>, among: &FxHashSet<SymbolId>) -> bool {
        self.module.symbol(id).is_some_and(|symbol| among.contains(&symbol) && !self.module.scoping.symbol_is_mutated(symbol))
    }

    /// An element of the caller's type at `at` renders what reaches it there
    /// or in a host element, and hands on only the `as` that chose it.
    fn hands_on_as(&mut self, at: u32) {
        let as_input = Held { inputs: Inputs::named(BTreeSet::from([self.module.names.id("as")])), ..Held::default() };
        self.sink(at, None, &as_input);
    }

    /// Whether `call` is React's `cloneElement`, or Animus's `renderAsChild`.
    fn clones(&self, call: &CallExpression<'_>) -> bool {
        self.react_call(call, "cloneElement") || self.renders_slot(call)
    }

    /// The innermost class the visit is inside.
    fn class_facts(&self) -> Option<&ClassFacts> {
        self.class.last().and_then(|class| self.module.classes.get(class))
    }

    /// Whether the visit is inside a class declared at the module's top.
    fn top_class(&self) -> bool {
        self.class.len() == 1 && self.depth == 0
    }

    /// Whether the function the visit is entering is one the statement
    /// declares: the statement itself, or a `const` initializer or an
    /// export, through type-only wrappers and React's `memo` and
    /// `forwardRef`, or a method of a top-level class. A function written as
    /// an argument of any other call is that call's.
    fn declared_root(&self) -> bool {
        if self.depth != 0 {
            return false;
        }
        self.ancestors.iter().rev().all(|kind| match kind {
            kind if is_erased_wrapper(kind) => true,
            AstKind::VariableDeclarator(_)
            | AstKind::VariableDeclaration(_)
            | AstKind::ExportDeclaration(_)
            | AstKind::ExportNamedDeclaration(_)
            | AstKind::ExportDefaultDeclaration(_) => true,
            AstKind::MethodDefinition(_) | AstKind::ClassBody(_) | AstKind::Class(_) => self.class.len() == 1,
            AstKind::CallExpression(call) => self.module.react.names(self.module.scoping, &call.callee, &["memo", "forwardRef"], true),
            _ => false,
        })
    }

    /// What the callee expression `callee` does with what a call's
    /// arguments carry.
    fn callee_of(&self, callee: &Expression<'_>) -> Callee {
        let module = &self.module;
        match unwrap_type_assertions(callee) {
            // A base class's constructor gets the arguments.
            Expression::Super(_) => match self.class_facts().map(|facts| &facts.base) {
                Some(Base::React) => Callee::Kept(InPlace::KeptByReact),
                Some(Base::Other(Some(name))) => Callee::Named(name.clone()),
                _ => Callee::Unknown,
            },
            Expression::Identifier(id) => match module.symbol(id) {
                None if READ_GLOBALS.contains(&id.name.as_str()) => Callee::Kept(InPlace::Builtin),
                None if CONVERTING_GLOBALS.contains(&id.name.as_str()) => Callee::Converts { callbacks: false },
                // The scheduling built-ins call the callbacks they get, with
                // any further arguments.
                None if SCHEDULING_GLOBALS.contains(&id.name.as_str()) => Callee::PassThrough { calls: &[0] },
                None => Callee::Unknown,
                Some(symbol) if module.scoping.symbol_is_mutated(symbol) => Callee::Unknown,
                Some(_) if module.react(id) => module.react_name(id).map_or(Callee::Unknown, react_function),
                Some(symbol) if module.setters.contains_key(&symbol) => Callee::State(module.setters[&symbol].clone()),
                Some(symbol) if module.slot_renders.contains(&symbol) => Callee::PassThrough { calls: &[] },
                Some(symbol) if module.sources.contains_key(&symbol) => Callee::Named(id.name.to_string()),
                Some(symbol) => match module.functions.get(&symbol) {
                    Some(scope) if !module.at_root(symbol) => Callee::Local(*scope),
                    Some(_) => Callee::Named(id.name.to_string()),
                    // A class or function declaration the module writes at its top.
                    None if module.at_root(symbol)
                        && module.scoping.symbol_flags(symbol).intersects(SymbolFlags::Function | SymbolFlags::Class) =>
                    {
                        Callee::Named(id.name.to_string())
                    }
                    None => Callee::Unknown,
                },
            },
            Expression::StaticMemberExpression(member) => {
                let name = member.property.name.as_str();
                // A function's own `bind` may be replaced like any property.
                if name == "bind" {
                    return Callee::Unknown;
                }
                if module.built_array(&member.object) {
                    if !ARRAY_WRITE_METHODS.contains(&name) {
                        return Callee::PassThrough { calls: array_calls(name) };
                    }
                    // A module array is anyone's to read, as a module binding is.
                    return match unwrap_type_assertions(&member.object) {
                        Expression::Identifier(id) => match module.symbol(id) {
                            Some(symbol) if module.at_root(symbol) => Callee::Unknown,
                            symbol => Callee::Stores(symbol),
                        },
                        _ => Callee::Stores(None),
                    };
                }
                if let Some((callee, array)) = self.held_array_method(member) {
                    return Callee::HeldArray { callee, array };
                }
                match unwrap_type_assertions(&member.object) {
                    Expression::ThisExpression(_) if matches!(name, "setState" | "forceUpdate") => {
                        if self.class_facts().is_some_and(ClassFacts::react_state) { Callee::ClassState } else { Callee::Unknown }
                    }
                    // A method its own class declares, which nothing replaces.
                    Expression::ThisExpression(_) => {
                        self.class_facts().and_then(|facts| facts.own_method(name)).map_or(Callee::Unknown, Callee::Local)
                    }
                    // A React DOM root renders what it gets.
                    Expression::CallExpression(root) => match unwrap_type_assertions(&root.callee) {
                        Expression::Identifier(id) if matches!(module.react_name(id), Some("createRoot" | "hydrateRoot")) => {
                            Callee::Kept(InPlace::KeptByReact)
                        }
                        _ => Callee::Unknown,
                    },
                    _ if module.children(&member.object) => Callee::PassThrough { calls: &[1] },
                    Expression::Identifier(object) if module.react_namespace(object) => react_function(name),
                    Expression::Identifier(object) if module.react(object) => Callee::Unknown,
                    Expression::Identifier(object) => match module.symbol(object) {
                        None if (object.name == "Math" && MATH_METHODS.contains(&name)) || (object.name == "console" && CONSOLE_METHODS.contains(&name)) => {
                            Callee::Converts { callbacks: false }
                        }
                        None if matches!((object.name.as_str(), name), ("JSON", "stringify")) => Callee::Converts { callbacks: true },
                        None if matches!((object.name.as_str(), name), ("Object", "is") | ("Array", "isArray") | ("Number", "isFinite" | "isNaN")) => {
                            Callee::Kept(InPlace::Builtin)
                        }
                        None if matches!((object.name.as_str(), name), ("Object", "keys" | "entries" | "values" | "fromEntries") | ("Array", "of")) => {
                            Callee::PassThrough { calls: &[] }
                        }
                        None if (object.name.as_str(), name) == ("Array", "from") => Callee::PassThrough { calls: &[1] },
                        None => Callee::Unknown,
                        Some(symbol) if module.namespaces.contains(&symbol) => Callee::Named(format!("{}.{name}", object.name)),
                        Some(_) => Callee::Unknown,
                    },
                    _ => Callee::Unknown,
                }
            }
            _ => Callee::Unknown,
        }
    }

    /// The position of the argument a call may give a function as its
    /// `this`, by the method's name alone: the `thisArg` of any method
    /// named for an array's callback method, and any `from`'s or
    /// `Children.map`'s third.
    fn this_position(&self, call: &CallExpression<'a>) -> Option<usize> {
        let Expression::StaticMemberExpression(member) = unwrap_type_assertions(&call.callee) else { return None };
        match member.property.name.as_str() {
            "from" => Some(2),
            "map" | "forEach" if self.module.children(&member.object) => Some(2),
            name if ARRAY_CALLBACK_METHODS.iter().any(|(method, _)| *method == name) && !name.starts_with("reduce") => Some(1),
            _ => None,
        }
    }

    /// `member`'s name and its array's, for the analysis to judge, when it
    /// is a read method of an array held here.
    fn held_array_method(&self, member: &StaticMemberExpression<'_>) -> Option<(String, String)> {
        let Expression::Identifier(object) = unwrap_type_assertions(&member.object) else { return None };
        let symbol = self.module.symbol(object)?;
        (self.module.arrays.held.contains(&symbol) && ARRAY_READ_METHODS.contains(&member.property.name.as_str()))
            .then(|| (format!("{}.{}", object.name, member.property.name), object.name.to_string()))
    }

    /// Hands `value` to the callbacks a call gets: a function the module
    /// declares receives it as its parameters, and one it names (at its top
    /// or as an import) is a callee the analysis judges by name; any other
    /// argument that may be a function at a position the call calls
    /// (`calls`) is unknown code that receives it.
    fn callbacks(&mut self, call: &CallExpression<'a>, current: Option<Span>, calls: &[usize], value: &Held) {
        for (position, argument) in call.arguments.iter().enumerate() {
            let higher = calls.contains(&position);
            let Some(expression) = argument.as_expression().map(unwrap_type_assertions) else {
                // A spread argument: what it holds is unknown here.
                if !calls.is_empty() {
                    self.sink(call.span.start, None, value);
                }
                continue;
            };
            if position == 0 && self.creates_element(call) {
                if let Some(caller_as) = self.caller_type(expression) {
                    if caller_as {
                        self.hands_on_as(call.span.start);
                    }
                    continue;
                }
            }
            match expression {
                // The argument the value came through: a callback's result
                // never reaches its own parameters.
                expression if Some(expression.span()) == current => {}
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                    if let Some(scope) = function_scope(expression) {
                        self.module.taint(scope, value);
                    }
                }
                Expression::Identifier(id) => match self.module.function_of(id) {
                    Some((name, scope)) => {
                        if let Some(scope) = scope {
                            self.module.taint(scope, value);
                        }
                        if name.is_some() {
                            self.sink(call.span.start, name, value);
                        }
                    }
                    None if higher && may_be_function(expression) => self.sink(call.span.start, None, value),
                    None => {}
                },
                expression if higher && may_be_function(expression) => self.sink(call.span.start, None, value),
                _ => {}
            }
        }
    }

    /// Climbs from the value `value` at `span` to where it stops.
    fn climb(&mut self, span: Span, value: &Held) {
        self.climb_from(self.ancestors.len(), span, false, value);
    }

    /// Climbs from the value `value` at `span`, a child of the ancestor
    /// before `at`, `returning` when the climb has passed a `return` since
    /// the last function.
    fn climb_from(&mut self, mut at: usize, span: Span, mut returning: bool, value: &Held) {
        if value.is_empty() {
            return;
        }
        let mut current = span;
        while at > 0 {
            at -= 1;
            let parent = self.ancestors[at];
            match self.place(at, parent, current, returning, value) {
                Place::Carry => current = parent.span(),
                Place::Becomes(next) => return self.climb_from(at, parent.span(), returning, &next),
                Place::Kept(_) => return,
                Place::Handed => {
                    self.sink(parent.span().start, None, value);
                    return;
                }
            }
            if self.returned(at, current, value).is_some() {
                return;
            }
            match parent {
                AstKind::ReturnStatement(_) => returning = true,
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => returning = false,
                _ => {}
            }
        }
    }

    /// When the climb has just reached a function from inside it, why it
    /// stops there: the function's result goes where its kind says. A
    /// function written in place climbs on, to whoever calls it.
    fn returned(&mut self, at: usize, current: Span, value: &Held) -> Option<InPlace> {
        let scope = match self.ancestors[at] {
            AstKind::Function(function) if function.span == current => function.scope_id.get()?,
            AstKind::ArrowFunctionExpression(arrow) if arrow.span == current => arrow.scope_id.get()?,
            _ => return None,
        };
        // A class method's result goes to its callers through `this`, and to
        // whoever holds the class, which can call any method; `render`'s
        // React also renders.
        let method = match at.checked_sub(1).and_then(|index| self.ancestors.get(index)) {
            Some(AstKind::MethodDefinition(method)) => Some(method.key.static_name().is_some_and(|name| name == "render")),
            _ => None,
        };
        // Either result reaches a top-level binding, where a hookable value
        // is handed outside (`declared_hooks`): React renders a result as at
        // an element.
        if let Some(render) = method {
            self.module.give_back(scope, value);
            self.top_join(current.start, value);
            return Some(if render { InPlace::Rendered } else { InPlace::Returned });
        }
        if self.module.roots.contains(&scope) {
            // React renders a component's result; a top-level helper's goes
            // to its callers, by name.
            self.top_join(current.start, value);
            return Some(InPlace::Rendered);
        }
        // A function bound to a local: its call sites carry the result.
        if self.module.bound.contains(&scope) {
            self.module.give_back(scope, value);
            return Some(InPlace::Returned);
        }
        None
    }

    /// A conversion of the value: its own runs, unless it may be hookable
    /// or be an input, whose caller may have given it any hook.
    fn converted(value: &Held) -> Place {
        if value.runs_hooks() {
            Place::Handed
        } else {
            Place::Kept(InPlace::Primitive)
        }
    }

    /// An iteration or an `await` of the value: as a conversion.
    fn iterated(value: &Held) -> Place {
        if value.runs_hooks() {
            Place::Handed
        } else {
            Place::Carry
        }
    }

    /// A read of the member `name` (at `span`, the ancestor `at`) off the
    /// value: the props object's member is that one prop, unless the member
    /// is called, which gives the call the whole object as `this`.
    fn member_read(&mut self, at: usize, span: Span, name: Option<&str>, value: &Held) -> Place {
        match (Self::read_through(value), name) {
            (Place::Carry, name) if matches!(value.inputs, Inputs::AllBut(_)) && !self.is_callee(at, span) => Place::Becomes(match name {
                Some(name) => value.member(self.module.names.id(name)),
                // A member no static key names may be any prop.
                None => Held { inputs: Inputs::Every, ..value.clone() },
            }),
            (place, _) => place,
        }
    }

    /// Whether the member at `span` (the ancestor `at`) is called, through
    /// parentheses or type assertions, which keep the object as `this`.
    fn is_callee(&self, at: usize, span: Span) -> bool {
        let mut span = span;
        let mut parent = at.wrapping_sub(1);
        while let Some(kind) = self.ancestors.get(parent).filter(|kind| is_erased_wrapper(kind)) {
            span = kind.span();
            parent = parent.wrapping_sub(1);
        }
        match self.ancestors.get(parent) {
            Some(AstKind::CallExpression(call)) => call.callee.span() == span,
            Some(AstKind::TaggedTemplateExpression(_)) => true,
            _ => false,
        }
    }

    /// A read or an iteration of the value: it runs hooks of a hookable one.
    fn read_through(value: &Held) -> Place {
        if value.hookable {
            Place::Handed
        } else {
            Place::Carry
        }
    }

    /// The allowlist: what the position `parent` (at `at` in the ancestors)
    /// does with the value that reaches it from `current`, `returning` when
    /// a `return` sits between them.
    fn place(&mut self, at: usize, parent: AstKind<'a>, current: Span, returning: bool, value: &Held) -> Place {
        match parent {
            // Statements a `return` sits in carry its value to the function.
            AstKind::IfStatement(_)
            | AstKind::BlockStatement(_)
            | AstKind::SwitchStatement(_)
            | AstKind::SwitchCase(_)
            | AstKind::LabeledStatement(_)
            | AstKind::TryStatement(_)
            | AstKind::CatchClause(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
                if returning =>
            {
                Place::Carry
            }
            kind if is_erased_wrapper(&kind) => Place::Carry,
            AstKind::ObjectProperty(property) if property.computed && property.key.span() == current => Self::converted(value),
            // An object literal with hooks is a hookable value.
            AstKind::ObjectExpression(object) if self.module.hookable_objects.contains(&object.span.start) && !value.hookable => {
                Place::Becomes(value.hooked())
            }
            // An async function's result is awaited.
            AstKind::Function(function) if function.r#async && value.runs_hooks() => Place::Handed,
            AstKind::ArrowFunctionExpression(arrow) if arrow.r#async && value.runs_hooks() => Place::Handed,
            AstKind::ChainExpression(_)
            | AstKind::ArrayExpression(_)
            | AstKind::ObjectExpression(_)
            | AstKind::ObjectProperty(_)
            | AstKind::LogicalExpression(_)
            | AstKind::JSXExpressionContainer(_)
            | AstKind::JSXAttribute(_)
            | AstKind::JSXOpeningElement(_)
            | AstKind::JSXFragment(_)
            | AstKind::FunctionBody(_)
            | AstKind::Function(_)
            | AstKind::ArrowFunctionExpression(_)
            // Climb to the function it returns from.
            | AstKind::ReturnStatement(_) => Place::Carry,
            // An object's spread reads its properties; an array's or an
            // argument's spread iterates.
            AstKind::SpreadElement(_) if matches!(self.ancestors.get(at.wrapping_sub(1)), Some(AstKind::ObjectExpression(_))) => {
                Self::read_through(value)
            }
            AstKind::JSXSpreadAttribute(_) => Self::read_through(value),
            AstKind::AwaitExpression(_) | AstKind::SpreadElement(_) | AstKind::JSXSpreadChild(_) => Self::iterated(value),
            // A member read: a getter of a hookable value runs.
            AstKind::StaticMemberExpression(member) if member.object.span() == current => {
                self.member_read(at, member.span, Some(member.property.name.as_str()), value)
            }
            AstKind::ComputedMemberExpression(member) if member.object.span() == current => {
                self.member_read(at, member.span, member.static_property_name().as_ref().map(|name| name.as_str()), value)
            }
            AstKind::PrivateFieldExpression(member) if member.object.span() == current => Self::read_through(value),
            // The value is a computed key.
            AstKind::ComputedMemberExpression(_) => Self::converted(value),
            AstKind::ConditionalExpression(conditional) if conditional.test.span() == current => Place::Kept(InPlace::Primitive),
            AstKind::ConditionalExpression(_) => Place::Carry,
            AstKind::SequenceExpression(sequence) => {
                if sequence.expressions.last().map(GetSpan::span) == Some(current) {
                    Place::Carry
                } else {
                    Place::Kept(InPlace::Discarded)
                }
            }
            AstKind::TemplateLiteral(_) => {
                // A tagged template hands its interpolations to its tag.
                if matches!(self.ancestors.get(at.wrapping_sub(1)), Some(AstKind::TaggedTemplateExpression(_))) {
                    Place::Handed
                } else {
                    Self::converted(value)
                }
            }
            AstKind::BinaryExpression(binary) => match binary.operator {
                // `value instanceof Other` hands the value to Other's
                // `Symbol.hasInstance`; a built-in's is `Function.prototype`'s,
                // which only reads the value's prototype chain.
                BinaryOperator::Instanceof if binary.left.span() == current => {
                    if intrinsic(&binary.right, |id| self.module.symbol(id).is_none()) {
                        Place::Kept(InPlace::Primitive)
                    } else {
                        Place::Handed
                    }
                }
                BinaryOperator::StrictEquality | BinaryOperator::StrictInequality => Place::Kept(InPlace::Primitive),
                BinaryOperator::In if binary.right.span() == current => Place::Kept(InPlace::Primitive),
                _ => Self::converted(value),
            },
            AstKind::UnaryExpression(unary) => match unary.operator {
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus | UnaryOperator::BitwiseNot => Self::converted(value),
                UnaryOperator::Delete => Place::Kept(InPlace::Discarded),
                _ => Place::Kept(InPlace::Primitive),
            },
            AstKind::UpdateExpression(_) => Self::converted(value),
            AstKind::PrivateInExpression(_)
            | AstKind::IfStatement(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::SwitchStatement(_)
            | AstKind::SwitchCase(_) => Place::Kept(InPlace::Primitive),
            AstKind::ExpressionStatement(_)
            | AstKind::BlockStatement(_)
            | AstKind::LabeledStatement(_)
            | AstKind::TryStatement(_)
            | AstKind::CatchClause(_) => Place::Kept(InPlace::Discarded),
            AstKind::ExportDefaultDeclaration(_) => {
                self.declared_hooks(current.start, value);
                self.module.top_join("default", value);
                Place::Kept(InPlace::Exported)
            }
            AstKind::ExportNamedDeclaration(_) | AstKind::ExportDeclaration(_) | AstKind::ExportSpecifier(_) => {
                Place::Kept(InPlace::Exported)
            }
            AstKind::JSXElement(element) => self.element(at, element, current, value),
            AstKind::CallExpression(call) => self.call(call, current, value),
            AstKind::VariableDeclarator(declarator) => {
                if declarator.init.as_ref().map(GetSpan::span) != Some(current) {
                    return Place::Kept(InPlace::Discarded);
                }
                // A `using` declaration disposes of what it holds, with it as
                // `this`; an array pattern iterates it.
                let using = matches!(self.ancestors.get(at.wrapping_sub(1)), Some(AstKind::VariableDeclaration(declaration)) if declaration.kind.is_using());
                // A pattern reads the value's members; an array pattern
                // iterates it, unless it is an array React's hook built.
                let read = match &declarator.id {
                    BindingPattern::BindingIdentifier(_) => Place::Carry,
                    BindingPattern::ArrayPattern(_)
                        if !matches!(current_call(declarator.init.as_ref()), Some(call) if self.react_callee(&call.callee)) =>
                    {
                        Self::iterated(value)
                    }
                    _ => Self::read_through(value),
                };
                if using || matches!(read, Place::Handed) {
                    return Place::Handed;
                }
                self.module.hold_pattern(&declarator.id, value);
                if self.depth == 0 {
                    self.top_join(current.start, value);
                }
                Place::Kept(InPlace::Bound)
            }
            AstKind::AssignmentPattern(pattern) => {
                if pattern.right.span() == current {
                    self.module.hold_pattern(&pattern.left, value);
                }
                Place::Kept(InPlace::Bound)
            }
            AstKind::FormalParameter(parameter) => {
                // A default value: the parameter may hold it.
                self.module.hold_pattern(&parameter.pattern, value);
                Place::Kept(InPlace::Bound)
            }
            AstKind::AssignmentExpression(assignment) => {
                let logical = assignment.operator == AssignmentOperator::Assign || assignment.operator.is_logical();
                if assignment.right.span() != current {
                    // A write into the value, or a compound assignment that
                    // converts it.
                    return if logical { Place::Kept(InPlace::Discarded) } else { Self::converted(value) };
                }
                if !logical {
                    return Self::converted(value);
                }
                self.store(&assignment.left, value)
            }
            AstKind::ForOfStatement(statement) if statement.right.span() == current => {
                if value.runs_hooks() {
                    return Place::Handed;
                }
                self.store_for(&statement.left, value)
            }
            AstKind::ForInStatement(statement) if statement.right.span() == current => Place::Kept(InPlace::Primitive),
            // A class's base receives every instance.
            AstKind::Class(class) if class.heritage.as_ref().is_some_and(|heritage| heritage.expression.span() == current) => {
                Place::Handed
            }
            AstKind::PropertyDefinition(property) if property.computed && property.key.span() == current => Self::converted(value),
            AstKind::MethodDefinition(method) if method.computed && method.key.span() == current => Self::converted(value),
            // A class field: an element in a static field (`defaultProps`)
            // reaches whoever holds the class, and in an instance field
            // whoever holds a ref to the instance; anything else is kept on
            // the instance React owns.
            AstKind::PropertyDefinition(_) if !self.class.is_empty() && value.has_elements() => Place::Handed,
            AstKind::PropertyDefinition(_) | AstKind::MethodDefinition(_) | AstKind::ClassBody(_) | AstKind::Class(_)
                if !self.class.is_empty() =>
            {
                Place::Kept(InPlace::Instance)
            }
            // A new object, a tagged template, a dynamic import, a thrown or
            // yielded value, a destructuring assignment, and every other
            // position.
            _ => Place::Handed,
        }
    }

    /// A store of `value` into `target`.
    fn store(&mut self, target: &AssignmentTarget<'a>, value: &Held) -> Place {
        match target {
            AssignmentTarget::AssignmentTargetIdentifier(id) => match self.module.symbol(id) {
                // A local: it holds the value.
                Some(symbol) if !self.module.at_root(symbol) => {
                    self.module.hold(symbol, value);
                    Place::Kept(InPlace::Bound)
                }
                // A binding of the module, or a global: any later reader.
                _ => Place::Handed,
            },
            target => {
                let Some(member) = target.as_member_expression() else {
                    // A destructuring assignment.
                    return Place::Handed;
                };
                let name = match member {
                    oxc::ast::ast::MemberExpression::PrivateFieldExpression(private) => Some(format!("#{}", private.field.name)),
                    member => member.static_property_name().map(str::to_string),
                };
                match unwrap_type_assertions(member.object()) {
                    // A plain store on an instance nothing can reshape.
                    Expression::ThisExpression(_)
                        if !value.has_elements()
                            && name.as_deref().is_some_and(|name| self.class_facts().is_some_and(|facts| facts.plain_store(name))) =>
                    {
                        Place::Kept(InPlace::Instance)
                    }
                    // A plain object or array the function owns holds it.
                    Expression::Identifier(id) => match self.module.symbol(id).filter(|symbol| self.module.in_place.contains(symbol)) {
                        Some(symbol) => {
                            self.module.hold(symbol, value);
                            Place::Kept(InPlace::Bound)
                        }
                        None => Place::Handed,
                    },
                    _ => Place::Handed,
                }
            }
        }
    }

    /// A `for…of` store of each value it iterates into its target.
    fn store_for(&mut self, left: &oxc::ast::ast::ForStatementLeft<'a>, value: &Held) -> Place {
        match left {
            oxc::ast::ast::ForStatementLeft::VariableDeclaration(declaration) => {
                if declaration.kind.is_using() {
                    return Place::Handed;
                }
                for declarator in &declaration.declarations {
                    self.module.hold_pattern(&declarator.id, value);
                }
                Place::Kept(InPlace::Bound)
            }
            target => match target.as_assignment_target() {
                Some(target) => self.store(target, value),
                None => Place::Handed,
            },
        }
    }

    /// A value reaching `element`: a host element and React's own
    /// components render it in place, and carry it on with themselves; a
    /// custom element's attributes are properties its own code sets; a
    /// context's provider hands its `value` to every consumer; any other
    /// component receives it, and its record judges it.
    fn element(&mut self, at: usize, element: &JSXElement<'a>, current: Span, value: &Held) -> Place {
        let opening = &element.opening_element;
        // The element's own tag name is no value it receives.
        if opening.name.span() == current || element.closing_element.as_ref().is_some_and(|closing| closing.name.span() == current) {
            return Place::Kept(InPlace::Discarded);
        }
        // The climb came through the opening element: which attribute.
        let through = match (self.ancestors.get(at + 1), self.ancestors.get(at + 2)) {
            (Some(AstKind::JSXOpeningElement(_)), Some(kind)) => Some(*kind),
            _ => None,
        };
        // A custom element (a name with `-`, or a host element given `is`)
        // takes its props as properties, handing them to its own code.
        let is = opening.attributes.iter().any(|attribute| {
            matches!(attribute, oxc::ast::ast::JSXAttributeItem::Attribute(attribute)
                if matches!(&attribute.name, oxc::ast::ast::JSXAttributeName::Identifier(name) if name.name == "is"))
        });
        let host = match &opening.name {
            JSXElementName::Identifier(id) => Some(id.name.contains('-') || is),
            JSXElementName::NamespacedName(_) => Some(is),
            _ => None,
        };
        // React converts, iterates or reads what a host element gets, and a
        // component's code what it does: the hooks of a hookable value run
        // there, out of its own module's sight.
        if value.hookable {
            return Place::Handed;
        }
        if let Some(custom) = host {
            if custom && through.is_some() {
                return Place::Handed;
            }
            return Place::Carry;
        }
        if matches!(&opening.name, JSXElementName::IdentifierReference(id) if self.unchanged(id, &self.module.as_types)) {
            self.hands_on_as(element.span.start);
            return Place::Carry;
        }
        let provider = matches!(&opening.name, JSXElementName::MemberExpression(member) if member.property.name == "Provider");
        let in_value = match through {
            Some(AstKind::JSXAttribute(attribute)) => {
                matches!(&attribute.name, oxc::ast::ast::JSXAttributeName::Identifier(name) if name.name == "value")
            }
            Some(AstKind::JSXSpreadAttribute(_)) => true,
            _ => false,
        };
        if provider && in_value {
            return Place::Handed;
        }
        // The element's own climb reads what its receiver gets
        // (`visit_jsx_element`).
        // The prop the value reaches the element through.
        let key = match through {
            Some(AstKind::JSXAttribute(attribute)) => match &attribute.name {
                oxc::ast::ast::JSXAttributeName::Identifier(name) => WalkProp::Named(self.module.names.id(&name.name)),
                oxc::ast::ast::JSXAttributeName::NamespacedName(name) => {
                    WalkProp::Named(self.module.names.id(&format!("{}:{}", name.namespace.name, name.name.name)))
                }
            },
            Some(AstKind::JSXSpreadAttribute(_)) => WalkProp::Spread,
            _ => WalkProp::Children,
        };
        if let Some(receiver) = self.module.receivers.get_mut(&element.span.start) {
            // Its climb reads only the whole record; `finish` reads each prop's.
            receiver.props.entry(key).or_default().join(value);
            if receiver.reached.held.join(value) {
                self.module.grew(Key::Receiver(element.span.start));
            }
            return Place::Kept(InPlace::Received);
        }
        let named = match &opening.name {
            JSXElementName::IdentifierReference(id) => Some((id.name.to_string(), Some(&**id))),
            JSXElementName::MemberExpression(member) => jsx_member_path(member).map(|path| (path, jsx_member_root(member))),
            _ => None,
        };
        let Some((tag, root)) = named else { return Place::Handed };
        // React's own components (`Fragment`, `Suspense`) render what they get.
        if root.is_some_and(|root| self.module.react(root)) {
            return Place::Carry;
        }
        let origin = root.map_or(TagOrigin::Nested, |root| tag_origin(self.module.scoping, root));
        let named_attribute = |names: &[&str]| {
            opening.attributes.iter().any(|attribute| match attribute {
                oxc::ast::ast::JSXAttributeItem::SpreadAttribute(_) => true,
                oxc::ast::ast::JSXAttributeItem::Attribute(attribute) => {
                    matches!(&attribute.name, oxc::ast::ast::JSXAttributeName::Identifier(name) if names.contains(&name.name.as_str()))
                }
            })
        };
        // An `as` of a static string renders that host element in place,
        // unless it names a custom element; `is` makes any element one.
        let polymorphic = opening
            .attributes
            .iter()
            .map(|attribute| match attribute {
                oxc::ast::ast::JSXAttributeItem::SpreadAttribute(_) => Polymorphic::Open,
                oxc::ast::ast::JSXAttributeItem::Attribute(attribute) => match &attribute.name {
                    oxc::ast::ast::JSXAttributeName::Identifier(name) if name.name == "as" => {
                        match crate::jsx_scan::eval_jsx_attribute_value(&attribute.value) {
                            crate::jsx_scan::PropValueResult::Static(serde_json::Value::String(tag)) if !tag.contains('-') => {
                                Polymorphic::Host
                            }
                            _ => Polymorphic::Open,
                        }
                    }
                    oxc::ast::ast::JSXAttributeName::Identifier(name) if name.name == "asChild" || name.name == "is" => Polymorphic::Open,
                    _ => Polymorphic::No,
                },
            })
            .max()
            .unwrap_or(Polymorphic::No);
        let site = self.site_shape(element);
        let exposed = named_attribute(&["ref"]);
        let reached = Reached { top: Rc::clone(&self.top), held: value.clone() };
        // An alias element renders each of its tags.
        let (tag, origin, also) = match self.module.aliases.get(&element.span.start) {
            Some(tags) if !tags.is_empty() => (tags[0].0.clone(), tags[0].1, tags[1..].to_vec()),
            _ => (tag, origin, Vec::new()),
        };
        let props = BTreeMap::from([(key, value.clone())]);
        self.module.receivers.insert(element.span.start, Receiver { tag, origin, also, polymorphic, site, exposed, reached, props });
        self.module.grew(Key::Receiver(element.span.start));
        Place::Kept(InPlace::Received)
    }

    /// What `element`'s attributes and children let an Animus string terminal
    /// render in its tag's place (`SiteShape`).
    fn site_shape(&self, element: &JSXElement<'a>) -> SiteShape {
        use oxc::ast::ast::{JSXAttributeItem, JSXAttributeName, JSXChild};
        let mut site = SiteShape::default();
        for attribute in &element.opening_element.attributes {
            match attribute {
                JSXAttributeItem::SpreadAttribute(spread) => site.spreads.push(self.spread_arg(&spread.argument)),
                JSXAttributeItem::Attribute(attribute) => match &attribute.name {
                    JSXAttributeName::Identifier(name) if name.name == "as" => {
                        let host = matches!(crate::jsx_scan::eval_jsx_attribute_value(&attribute.value),
                            crate::jsx_scan::PropValueResult::Static(serde_json::Value::String(tag)) if !tag.contains('-'));
                        site.as_open |= !host;
                    }
                    JSXAttributeName::Identifier(name) if name.name == "is" => site.as_open = true,
                    JSXAttributeName::Identifier(name) if name.name == "asChild" => {
                        // The one element child, as JSX passes children.
                        let child = match super::written_children(&element.children)[..] {
                            [JSXChild::Element(child)] => match &child.opening_element.name {
                                JSXElementName::Identifier(id) => Some(id.name.to_string()),
                                JSXElementName::IdentifierReference(id) => Some(id.name.to_string()),
                                JSXElementName::MemberExpression(member) => jsx_member_path(member),
                                _ => None,
                            },
                            _ => None,
                        };
                        site.as_child = Some(child);
                    }
                    _ => {}
                },
            }
        }
        site.own_children = self.own_children(element);
        site
    }

    /// Whether `element`'s children are none, or exactly the `children` the
    /// enclosing top-level component destructures from its props and never
    /// reassigns, and it writes no `children` attribute.
    fn own_children(&self, element: &JSXElement<'a>) -> bool {
        use oxc::ast::ast::{JSXAttributeItem, JSXAttributeName, JSXChild, JSXExpression};
        // A `children` attribute is what the element renders instead.
        let attribute = element.opening_element.attributes.iter().any(|attribute| {
            matches!(attribute, JSXAttributeItem::Attribute(attribute) if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "children"))
        });
        if attribute {
            return false;
        }
        let child = match super::written_children(&element.children)[..] {
            [] => return true,
            [JSXChild::ExpressionContainer(container)] => &container.expression,
            _ => return false,
        };
        let (JSXExpression::Identifier(id), Some(BindingPattern::ObjectPattern(object))) = (child, self.own_param()) else {
            return false;
        };
        let Some(symbol) = self.module.symbol(id) else { return false };
        !self.module.scoping.symbol_is_mutated(symbol)
            && object.properties.iter().any(|property| {
                !property.computed
                    && property.key.static_name().is_some_and(|key| key == "children")
                    && matches!(&property.value, BindingPattern::BindingIdentifier(binding) if binding.symbol_id.get() == Some(symbol))
            })
    }

    /// The first parameter of the top-level function the walk is in.
    fn own_param(&self) -> Option<&'a BindingPattern<'a>> {
        self.ancestors.iter().find_map(|kind| {
            let (scope, params) = match kind {
                AstKind::Function(function) => (function.scope_id.get()?, &function.params),
                AstKind::ArrowFunctionExpression(arrow) => (arrow.scope_id.get()?, &arrow.params),
                _ => return None,
            };
            if !self.module.roots.contains(&scope) {
                return None;
            }
            Some(&params.items.first()?.pattern)
        })
    }

    /// What a spread of `argument` can carry: listed literal keys, the
    /// enclosing top-level component's own props or rest, or anything.
    fn spread_arg(&self, argument: &Expression<'a>) -> SpreadArg {
        /// `undefined` names the global only where nothing binds it.
        type Unbound<'f> = &'f dyn Fn(&IdentifierReference<'_>) -> bool;
        fn keys(expression: &Expression<'_>, into: &mut Vec<String>, unbound: Unbound<'_>) -> bool {
            match unwrap_type_assertions(expression) {
                Expression::ObjectExpression(object) => object.properties.iter().all(|property| match property {
                    ObjectPropertyKind::ObjectProperty(property) if !property.computed => {
                        property.key.static_name().map(|name| into.push(name.to_string())).is_some()
                    }
                    _ => false,
                }),
                Expression::ConditionalExpression(conditional) => {
                    keys(&conditional.consequent, into, unbound) && keys(&conditional.alternate, into, unbound)
                }
                Expression::LogicalExpression(logical) => keys(&logical.right, into, unbound) && keys(&logical.left, into, unbound),
                Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => true,
                Expression::Identifier(id) => id.name == "undefined" && unbound(id),
                _ => false,
            }
        }
        let mut listed = Vec::new();
        if keys(argument, &mut listed, &|id| self.module.symbol(id).is_none()) {
            return SpreadArg::Keys(listed);
        }
        let Expression::Identifier(id) = unwrap_type_assertions(argument) else { return SpreadArg::Other };
        let Some(symbol) = self.module.symbol(id) else { return SpreadArg::Other };
        // The parameter, or its rest, of the top-level function the element
        // is in.
        let own = self.own_param().and_then(|pattern| match pattern {
            BindingPattern::BindingIdentifier(binding) => binding.symbol_id.get(),
            BindingPattern::ObjectPattern(object) => super::object_rest(object).and_then(|(_, rest)| rest.symbol_id.get()),
            _ => None,
        });
        match (own, self.top.as_ref()) {
            // Only a binding nothing reassigns, writes through or hands on
            // holds the props its callers wrote.
            (Some(own), [name]) if own == symbol && !self.module.reshaped.contains(&symbol) => SpreadArg::Props(name.clone()),
            _ => SpreadArg::Other,
        }
    }

    /// A value reaching `call` from `current`, its callee or an argument.
    fn call(&mut self, call: &CallExpression<'a>, current: Span, value: &Held) -> Place {
        if self.module.chain_spans.iter().any(|(start, end)| *start <= call.span.start && call.span.end <= *end) {
            return Place::Kept(InPlace::Builder);
        }
        if call.callee.span() == current {
            return self.called(call, value);
        }
        let callee = self.callee_of(&call.callee);
        let position = call.arguments.iter().position(|argument| argument.span() == current);
        // Animus's `renderAsChild` sets its config on the element it clones,
        // which no usage lists: only a clone of the component's own
        // `children` with what its caller wrote renders it as the caller's
        // site writes it, which each site judges (`Records::child_cloners`).
        if self.renders_slot(call) {
            match self.child_clone(call) {
                Some(gated) => self.clones_children(gated),
                None => return Place::Handed,
            }
        }
        // An element's config that sets nothing but what the caller wrote, a
        // spread of it included, holds no getter: React and `renderAsChild`
        // read its own keys, and run none of its code.
        let config = position == Some(1)
            && (self.clones(call) || self.creates_element(call))
            && call.arguments.get(1).and_then(|argument| argument.as_expression()).is_some_and(|props| self.clone_props(props));
        // A built-in reads, iterates or converts what it gets: a hookable
        // value runs its hooks, and an input those its caller gave it, at
        // any position the built-in does not call. React reads inputs as it
        // does at an element, where a hookable value is handed outside.
        if value.hookable
            && !config
            && matches!(callee, Callee::Kept(_) | Callee::PassThrough { .. } | Callee::Converts { .. } | Callee::State(_) | Callee::ClassState)
        {
            return Place::Handed;
        }
        // React's `Component` keeps its props; the context and the updater
        // it also takes are code the class hands its instance.
        if matches!(call.callee, Expression::Super(_)) && position.is_some_and(|position| position > 0) {
            return Place::Handed;
        }
        let converts = match &callee {
            Callee::PassThrough { calls } => position.is_some_and(|position| !calls.contains(&position)),
            Callee::HeldArray { callee, .. } => {
                let name = callee.rsplit('.').next().unwrap_or_default();
                position.is_some_and(|position| !array_calls(name).contains(&position))
            }
            Callee::Converts { callbacks } => !(*callbacks && position == Some(1)),
            _ => false,
        };
        if converts && value.inputs.any() && !self.react_callee(&call.callee) && !self.renders_slot(call) {
            return Place::Handed;
        }
        // `cloneElement` with props that may set a `ref` gives the element a
        // new receiver: whoever the ref reaches reads its props. One that may
        // set `as`, `asChild` or `is` gives it another target.
        if position == Some(0) && self.clones(call) {
            let literal = call.arguments.get(1).is_none_or(|props| {
                matches!(props.as_expression().map(unwrap_type_assertions), Some(Expression::ObjectExpression(object))
                    if object.properties.iter().all(|property| matches!(property, ObjectPropertyKind::ObjectProperty(property)
                        if !property.computed && property.key.static_name().is_some_and(|name| plain_key(&name)))))
            });
            let callers = call.arguments.len() <= 2
                && call.arguments.get(1).is_none_or(|props| props.as_expression().is_some_and(|props| self.clone_props(props)));
            if !literal && !callers {
                return Place::Handed;
            }
        }
        // What a call may give a function as its `this` is handed outside.
        if self.this_position(call).is_some_and(|this| call.arguments.get(this).is_some_and(|argument| argument.span() == current)) {
            return Place::Handed;
        }
        match callee {
            Callee::Kept(reason) => Place::Kept(reason),
            Callee::Unknown => Place::Handed,
            Callee::Converts { callbacks } => {
                if callbacks {
                    self.callbacks(call, Some(current), &[1], value);
                }
                Place::Kept(InPlace::Primitive)
            }
            Callee::Named(name) => {
                self.sink(call.span.start, Some(name), value);
                Place::Carry
            }
            Callee::Local(scope) => {
                self.module.taint(scope, value);
                Place::Carry
            }
            Callee::PassThrough { calls } => {
                self.callbacks(call, Some(current), calls, value);
                // The element built from such a config is no hookable object.
                if config && value.hookable {
                    Place::Becomes(Held { hookable: false, ..value.clone() })
                } else {
                    Place::Carry
                }
            }
            // React hands what the setter gets back as the state (an updater
            // it gets sees the state: `visit_call_expression`).
            Callee::State(states) => {
                for symbol in &states {
                    self.module.hold(*symbol, value);
                }
                Place::Kept(InPlace::KeptByReact)
            }
            // `setState` keeps what it gets as the state.
            Callee::ClassState => Place::Kept(InPlace::KeptByReact),
            Callee::HeldArray { callee, array } => self.array_method(call, current, Some((callee, array)), value),
            Callee::Stores(array) => {
                if let Some(symbol) = array {
                    self.module.hold(symbol, value);
                }
                Place::Carry
            }
        }
    }

    /// A built-in array method's call, the value reaching it from
    /// `current`: its callbacks receive it, and its result carries it on.
    /// A held array's method is named for the analysis to judge.
    fn array_method(&mut self, call: &CallExpression<'a>, current: Span, held: Option<(String, String)>, value: &Held) -> Place {
        let name = match unwrap_type_assertions(&call.callee) {
            Expression::StaticMemberExpression(member) => member.property.name.as_str(),
            _ => "",
        };
        self.callbacks(call, Some(current), array_calls(name), value);
        if let Some((callee, array)) = held {
            self.module.sink(call.span.start, Some(callee), Some(array), &self.top, value);
        }
        Place::Carry
    }

    /// The value is the callee of `call`, or what a member of it is read
    /// from: the receiver the method gets as `this`.
    fn called(&mut self, call: &CallExpression<'a>, value: &Held) -> Place {
        let callee = unwrap_type_assertions(&call.callee);
        let Expression::StaticMemberExpression(member) = callee else {
            // A computed or private member's call gets the object as
            // `this`, whatever the key.
            if callee.is_member_expression() {
                return Place::Handed;
            }
            // A function value is called: what it gets reaches it as its
            // arguments, each judged where it is, and the call's result
            // carries what the value holds (`InPlace::Returned`).
            return Place::Carry;
        };
        let this = matches!(member.object, Expression::ThisExpression(_));
        match member.property.name.as_str() {
            "setState" | "forceUpdate" if this && self.class_facts().is_some_and(ClassFacts::react_state) => {
                return Place::Kept(InPlace::KeptByReact);
            }
            // A method its own class declares, which nothing replaces: it
            // reads `this` where it is, and its result through what it
            // returns.
            name if this && self.class_facts().and_then(|facts| facts.own_method(name)).is_some() => {
                return Place::Kept(InPlace::Instance);
            }
            _ => {}
        }
        // An array's conversion converts each element.
        if matches!(member.property.name.as_str(), "join" | "toString" | "toLocaleString") && value.runs_hooks() {
            return Place::Handed;
        }
        // A method of an array built in place is a built-in's: its callbacks
        // receive what it holds.
        if self.module.built_array(&member.object) {
            return self.array_method(call, member.object.span(), None, value);
        }
        if let Some(held) = self.held_array_method(member) {
            return self.array_method(call, member.object.span(), Some(held), value);
        }
        // Any other method gets the value as `this`.
        Place::Handed
    }

    fn enter_function(&mut self, scope: Option<ScopeId>) {
        // A declared function's parameters are its inputs.
        if let Some(scope) = scope.filter(|_| self.declared_root()) {
            if self.module.roots.insert(scope) {
                self.module.seed_inputs(scope);
            }
        }
        self.depth += 1;
    }
}

/// Whether `expression` may evaluate to a function: anything but a literal,
/// a template, an object, array or element literal, an operator's result,
/// or `undefined`.
fn may_be_function(expression: &Expression<'_>) -> bool {
    !matches!(
        expression,
        Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::ArrayExpression(_)
            | Expression::ObjectExpression(_)
            | Expression::JSXElement(_)
            | Expression::JSXFragment(_)
            | Expression::UnaryExpression(_)
            | Expression::BinaryExpression(_)
            | Expression::UpdateExpression(_)
    ) && !matches!(expression, Expression::Identifier(id) if id.name == "undefined")
}

/// What a React function does with what it gets, by the name React exports
/// it under: its signature, with the positions where it calls a function
/// it gets with what it holds. A name not listed is unknown code, as is
/// `useImperativeHandle`, whose handle the parent reads through its ref.
fn react_function(name: &str) -> Callee {
    match name {
        "createPortal" | "render" | "hydrate" | "hydrateRoot" | "renderToString" | "renderToStaticMarkup"
        | "renderToPipeableStream" | "renderToReadableStream" => Callee::Kept(InPlace::KeptByReact),
        // The reducer gets the state and each action, the initializer the
        // initial argument.
        "useReducer" => Callee::PassThrough { calls: &[0, 2] },
        "useOptimistic" | "useDebugValue" => Callee::PassThrough { calls: &[1] },
        "useActionState" | "useFormState" => Callee::PassThrough { calls: &[0] },
        // A component it gets renders with the props.
        "createElement" | "forwardRef" | "lazy" => Callee::PassThrough { calls: &[0] },
        // `memo` calls its comparison too.
        "memo" => Callee::PassThrough { calls: &[0, 1] },
        // These call what they get with nothing of the caller's, or call
        // nothing.
        "useState" | "useRef" | "useContext" | "useMemo" | "useCallback" | "useEffect" | "useLayoutEffect"
        | "useInsertionEffect" | "useId" | "useDeferredValue" | "useTransition" | "useSyncExternalStore"
        | "useFormStatus" | "startTransition" | "flushSync" | "createContext" | "createRef" | "cloneElement"
        | "isValidElement" | "use" | "createRoot" | "Fragment" | "StrictMode" | "Suspense" => {
            Callee::PassThrough { calls: &[] }
        }
        _ => Callee::Unknown,
    }
}

impl<'a> Visit<'a> for Walk<'_, '_, 'a> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: oxc::syntax::scope::ScopeFlags) {
        let node = FunctionNode::Function(self.alloc(function), flags);
        let outer = self.enter_unit(function.span.start, node);
        self.enter_function(function.scope_id.get());
        oxc::ast_visit::walk::walk_function(self, function, flags);
        self.depth -= 1;
        self.module.unit = outer;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &oxc::ast::ast::ArrowFunctionExpression<'a>) {
        let outer = self.enter_unit(arrow.span.start, FunctionNode::Arrow(self.alloc(arrow)));
        self.enter_function(arrow.scope_id.get());
        oxc::ast_visit::walk::walk_arrow_function_expression(self, arrow);
        self.depth -= 1;
        self.module.unit = outer;
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        self.class.push(class.span.start);
        // A base other than React's receives every instance: its code runs
        // with the props as `this.props`.
        if self.top_class() {
            if let Some(Base::Other(name)) = self.class_facts().map(|facts| facts.base.clone()) {
                self.sink(class.span.start, name, &Held::INPUTS);
            }
        }
        // A decorator receives the class, or a member, whose code runs with
        // the props.
        if decorated(class) {
            self.sink(class.span.start, None, &Held::INPUTS);
        }
        oxc::ast_visit::walk::walk_class(self, class);
        self.class.pop();
    }

    fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
        // A declarator of a top-level statement names only its own binding:
        // a bundle declares thousands in one `var`.
        let top_level = self.ancestors.iter().all(|kind| {
            matches!(kind, AstKind::VariableDeclaration(_) | AstKind::ExportNamedDeclaration(_) | AstKind::ExportDeclaration(_))
        });
        if !top_level {
            oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
            return;
        }
        let own: Rc<[String]> = match &declarator.id {
            BindingPattern::BindingIdentifier(id) => Rc::from([id.name.to_string()]),
            _ => Rc::from([]),
        };
        let statement = std::mem::replace(&mut self.top, own);
        oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
        self.top = statement;
    }

    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        // An element's tag name is no value it reads: React renders the
        // component it names. What a context tag gives on (its value, to a
        // `Consumer`'s function) reaches code only through the element, and a
        // `Consumer` is no ordinary tag, so the element hands it outside.
        let tag = match self.ancestors.last() {
            Some(AstKind::JSXOpeningElement(opening)) => opening.name.span() == id.span,
            Some(AstKind::JSXClosingElement(_) | AstKind::JSXMemberExpression(_)) => true,
            _ => false,
        };
        if tag {
            return;
        }
        let Some(reference) = id.reference_id.get().map(|reference| self.module.scoping.get_reference(reference)) else { return };
        if !reference.is_read() {
            return;
        }
        let value = match reference.symbol_id() {
            // A function bound to a local carries what it returns to whoever
            // calls it.
            Some(symbol) => {
                let mut value = self.module.read(symbol);
                if let Some(scope) = self.module.functions.get(&symbol).copied() {
                    if let Some(returns) = self.module.returned_by(scope) {
                        value.join(&returns);
                    }
                }
                Some(value)
            }
            // `arguments`: what the calls of the function it is in pass it.
            None if id.name == "arguments" => {
                own_function(&self.ancestors).and_then(|scope| {
                    self.module.note_read(Key::Arguments(scope));
                    self.module.arguments.get(&scope).cloned()
                })
            }
            None => None,
        };
        if let Some(value) = value {
            self.climb(id.span, &value);
        }
    }

    fn visit_this_expression(&mut self, this: &oxc::ast::ast::ThisExpression) {
        if !self.class.is_empty() {
            self.climb(this.span, &Held::INPUTS);
        }
    }

    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        let component = self.module.is_component_tag(&element.opening_element.name);
        oxc::ast_visit::walk::walk_jsx_element(self, element);
        // The element is a value that holds every component element in it
        // and whatever reached its children and attributes: whoever gets it
        // can read and clone them.
        if component {
            if !self.module.element_tags.contains_key(&element.span.start) {
                let mut tags = ElementTags { module: &*self.module, tags: BTreeSet::new() };
                tags.visit_jsx_element(element);
                let tags = tags.tags.iter().map(|tag| self.module.names.id(tag)).collect();
                self.module.element_tags.insert(element.span.start, tags);
            }
            let mut value = Held { tags: self.module.element_tags[&element.span.start].clone(), ..Held::default() };
            self.module.note_read(Key::Receiver(element.span.start));
            if let Some(receiver) = self.module.receivers.get(&element.span.start) {
                value.join(&receiver.reached.held);
            }
            self.climb(element.span, &value);
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        oxc::ast_visit::walk::walk_call_expression(self, call);
        // A state hook's reducer and initializer, and a setter's updater,
        // see the state; `setState`'s updater sees the state and the props.
        let (states, calls): (Option<Vec<SymbolId>>, &[usize]) = match unwrap_type_assertions(&call.callee) {
            Expression::Identifier(id) => match self.module.symbol(id) {
                Some(symbol) if self.module.setters.contains_key(&symbol) && !self.module.scoping.symbol_is_mutated(symbol) => {
                    (Some(self.module.setters[&symbol].clone()), &[0])
                }
                _ => (None, &[]),
            },
            Expression::StaticMemberExpression(member)
                if matches!(member.object, Expression::ThisExpression(_))
                    && member.property.name == "setState"
                    && self.class_facts().is_some_and(ClassFacts::react_state) =>
            {
                self.callbacks(call, None, &[0], &Held::INPUTS);
                (None, &[])
            }
            _ => (None, &[]),
        };
        // A state hook gets its reducer and initializer at its signature's
        // positions.
        let (states, calls) = match (states, self.module.hook_states.get(&call.span.start)) {
            (None, Some(states)) => match self.callee_of(&call.callee) {
                Callee::PassThrough { calls } => (Some(states.clone()), calls),
                _ => (None, &[][..]),
            },
            other => (other.0, calls),
        };
        if let Some(states) = states {
            let mut state = Held::default();
            for symbol in states {
                state.join(&self.module.read(symbol));
            }
            if !state.is_empty() {
                self.callbacks(call, None, calls, &state);
            }
        }
        // A call of a class's own method carries what it returns, inputs
        // included. (A function's value, which its call carries, holds what
        // the function returns.)
        let scope = match unwrap_type_assertions(&call.callee) {
            Expression::StaticMemberExpression(member) if matches!(member.object, Expression::ThisExpression(_)) => {
                self.class_facts().and_then(|facts| facts.own_method(&member.property.name))
            }
            _ => None,
        };
        if let Some(returns) = scope.and_then(|scope| self.module.returned_by(scope)) {
            self.climb(call.span, &returns);
        }
    }
}

/// The arrays whose methods the walk knows, from how every reference uses
/// them.
struct Arrays {
    /// `const`s built as an array literal that the module keeps to itself,
    /// whose methods are the built-in ones.
    built: FxHashSet<SymbolId>,
    /// Exported module `const` arrays and imports that every reference
    /// here reads in place: the analysis judges their methods.
    held: FxHashSet<SymbolId>,
    /// The exported ones of `held`, and the imports outside it, by name.
    held_names: BTreeSet<String>,
    misused_imports: BTreeSet<String>,
}

impl Arrays {
    fn of(
        scoping: &Scoping,
        declarations: &Declarations<'_>,
        uses: &[u8],
        sources: &FxHashMap<SymbolId, String>,
        namespaces: &FxHashSet<SymbolId>,
        exported: &FxHashSet<&str>,
    ) -> Self {
        let imports: Vec<SymbolId> = sources.keys().copied().filter(|symbol| !namespaces.contains(symbol)).collect();
        // A direct `eval` leaves no usage proven (`FileFacts::direct_eval`).
        let name = |symbol: &SymbolId| scoping.symbol_name(*symbol).to_string();
        let allowed = |symbol: &SymbolId, kinds: &[Use]| uses[symbol.index()] & !kinds.iter().fold(0, |bits, kind| bits | kind.bit()) == 0;
        let (exported_arrays, private_arrays): (Vec<SymbolId>, Vec<SymbolId>) =
            declarations.module_arrays.iter().partition(|symbol| exported.contains(scoping.symbol_name(**symbol)));
        // A module array outlives every call, so only what keeps it where it
        // is leaves its methods the built-in ones; a function's own array is
        // also returned before anyone else can change it.
        let built = private_arrays
            .into_iter()
            .filter(|symbol| allowed(symbol, &[Use::Read, Use::Write, Use::Rendered]))
            .chain(declarations.local_arrays.iter().copied().filter(|symbol| allowed(symbol, &[Use::Read, Use::Write, Use::Rendered, Use::Returned])))
            .collect();
        // Another module may read an exported array or an import: each must
        // read it in place, and the analysis checks them all.
        let held: FxHashSet<SymbolId> =
            exported_arrays.iter().chain(&imports).copied().filter(|symbol| allowed(symbol, &[Use::Read])).collect();
        Arrays {
            built,
            held_names: exported_arrays.iter().filter(|symbol| held.contains(symbol)).map(name).collect(),
            misused_imports: imports.iter().filter(|symbol| !held.contains(symbol)).map(name).collect(),
            held,
        }
    }
}

/// How a reference uses the array it names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Use {
    /// A read method's call whose callback cannot see the array, `length`,
    /// an index, a spread, a `for…of` or an export specifier.
    Read,
    /// A write method's call (`ARRAY_WRITE_METHODS`): the walk holds what
    /// it stores.
    Write,
    /// A child of a host element, which React renders.
    Rendered,
    /// What a `return` gives back.
    Returned,
    /// Anything else, which may change its methods.
    Other,
}

impl Use {
    /// The use's bit in `Declarations::uses`.
    fn bit(self) -> u8 {
        1 << self as u8
    }
}

/// How a reference uses the array it names, or the callback-taking
/// read-method call whose callback decides it (`Declarations::callback_blind`).
enum ArrayUse<'a> {
    Is(Use),
    Callback(&'a str, &'a CallExpression<'a>),
}

/// How the reference at `span`, under `ancestors`, uses the array it names.
fn array_use<'a>(ancestors: &[AstKind<'a>], span: Span) -> ArrayUse<'a> {
    let mut up = ancestors.iter().rev();
    let (current, parent) = super::peel_wrappers(span, &mut up);
    ArrayUse::Is(match parent {
        Some(AstKind::ExportSpecifier(_) | AstKind::SpreadElement(_)) => Use::Read,
        Some(AstKind::ForOfStatement(statement)) if statement.right.span() == current => Use::Read,
        Some(AstKind::StaticMemberExpression(member)) if member.object.span() == current => {
            let name = member.property.name.as_str();
            let mut call = up.clone();
            match super::member_effect(member.span, up) {
                None if name == "length" => Use::Read,
                Some(MemberEffect::Method) if ARRAY_READ_METHODS.contains(&name) => {
                    match super::peel_wrappers(member.span, &mut call) {
                        (_, Some(AstKind::CallExpression(call))) if ARRAY_CALLBACK_METHODS.iter().any(|(method, _)| *method == name) => {
                            return ArrayUse::Callback(name, call);
                        }
                        (_, Some(AstKind::CallExpression(_))) => Use::Read,
                        _ => Use::Other,
                    }
                }
                Some(MemberEffect::Method) if ARRAY_WRITE_METHODS.contains(&name) => Use::Write,
                _ => Use::Other,
            }
        }
        Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == current => {
            if super::member_effect(member.span, up).is_none() {
                Use::Read
            } else {
                Use::Other
            }
        }
        Some(AstKind::JSXExpressionContainer(_)) => match up.next() {
            Some(AstKind::JSXElement(element))
                if matches!(element.opening_element.name, JSXElementName::Identifier(_) | JSXElementName::NamespacedName(_)) =>
            {
                Use::Rendered
            }
            _ => Use::Other,
        },
        Some(AstKind::ReturnStatement(_)) => Use::Returned,
        _ => Use::Other,
    })
}

/// The component tags of the elements inside an element, its own included.
struct ElementTags<'m, 's> {
    module: &'m Module<'s>,
    tags: BTreeSet<String>,
}

impl<'a> Visit<'a> for ElementTags<'_, '_> {
    fn visit_jsx_opening_element(&mut self, opening: &oxc::ast::ast::JSXOpeningElement<'a>) {
        match self.module.aliases.get(&opening.span.start) {
            Some(tags) => self.tags.extend(tags.iter().map(|(tag, _)| tag.clone())),
            None => self.tags.extend(self.module.component_tag(&opening.name).map(|(tag, _)| tag)),
        }
        oxc::ast_visit::walk::walk_jsx_opening_element(self, opening);
    }
}

/// React's own modules, whose functions `react_function` lists: React's
/// runtimes (`REACT_RUNTIMES` in usage_facts.rs), React DOM's entries, and
/// the automatic JSX runtimes (`AUTOMATIC_RUNTIMES`).
const REACT_MODULES: [&str; 8] = [
    "react", "preact", "preact/compat", "react-dom", "react-dom/client", "react-dom/server", "react/jsx-runtime",
    "react/jsx-dev-runtime",
];

/// The names a top-level statement binds, for parameter forwarding: a
/// function, class or simple `const`, and `default` for a default export.
fn top_level_names(statement: &Statement<'_>) -> Vec<String> {
    use oxc::ast::ast::{BindingPattern, Declaration, ExportDefaultDeclarationKind};
    let declaration = match statement {
        Statement::ExportDeclaration(export) => Some(&export.declaration),
        Statement::ExportDefaultDeclaration(export) => {
            let id = match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => function.id.as_ref(),
                ExportDefaultDeclarationKind::ClassDeclaration(class) => class.id.as_ref(),
                _ => None,
            };
            return id.map(|id| id.name.to_string()).into_iter().chain(["default".to_string()]).collect();
        }
        statement => statement.as_declaration(),
    };
    match declaration {
        Some(Declaration::FunctionDeclaration(function)) => function.id.iter().map(|id| id.name.to_string()).collect(),
        Some(Declaration::ClassDeclaration(class)) => class.id.iter().map(|id| id.name.to_string()).collect(),
        Some(Declaration::VariableDeclaration(variables)) => variables
            .declarations
            .iter()
            .filter_map(|declarator| match &declarator.id {
                BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Which input a function's parameter binding holds: its first parameter
/// is the props object (`Props`), so a binding its destructuring names by a
/// static key holds that prop and a rest all but the keys named before it;
/// a second is the `ref` a forwarding component gets; any other binding
/// holds every input by a route whose members are no props.
#[derive(Debug, Clone)]
enum ParamInput {
    Props,
    Every,
    /// A prop its destructuring names, `bare` where no default fills it.
    Named { key: String, bare: bool },
    Rest(Vec<String>),
    /// The `as` prop, with no default or a host element's name: an element
    /// of it renders the caller's `as` or that host element.
    AsType,
    /// The `asChild` prop, with no default or `false`: true only where the
    /// caller's site writes it.
    AsChild,
}

impl ParamInput {
    /// Whether the binding holds only what the component's caller wrote, and
    /// never its `asChild`: its rest beside a named `asChild`, or a prop but
    /// `asChild` named with no default.
    fn caller(&self) -> bool {
        match self {
            ParamInput::Named { key, bare } => *bare && key != "asChild",
            ParamInput::Rest(named) => named.iter().any(|key| key == "asChild"),
            _ => false,
        }
    }
}

/// The bindings of a function's parameters, each with the input it holds
/// (`ParamInput`).
fn param_inputs(params: &oxc::ast::ast::FormalParameters<'_>) -> Vec<(SymbolId, ParamInput)> {
    fn first(pattern: &BindingPattern<'_>, into: &mut Vec<(SymbolId, ParamInput)>) {
        match pattern {
            BindingPattern::ObjectPattern(object) => {
                let mut named = Vec::new();
                for property in &object.properties {
                    let input = match (property.computed, property.key.static_name()) {
                        (false, Some(key)) => {
                            named.push(key.to_string());
                            let host_default = match &property.value {
                                BindingPattern::BindingIdentifier(_) => true,
                                BindingPattern::AssignmentPattern(assignment) => {
                                    matches!(&assignment.left, BindingPattern::BindingIdentifier(_))
                                        && matches!(&assignment.right, Expression::StringLiteral(name) if !name.value.contains('-'))
                                }
                                _ => false,
                            };
                            let false_default = match &property.value {
                                BindingPattern::BindingIdentifier(_) => true,
                                BindingPattern::AssignmentPattern(assignment) => {
                                    matches!(&assignment.left, BindingPattern::BindingIdentifier(_))
                                        && matches!(&assignment.right, Expression::BooleanLiteral(literal) if !literal.value)
                                }
                                _ => false,
                            };
                            if key == "as" && host_default {
                                ParamInput::AsType
                            } else if key == "asChild" && false_default {
                                ParamInput::AsChild
                            } else {
                                ParamInput::Named { key: key.to_string(), bare: matches!(&property.value, BindingPattern::BindingIdentifier(_)) }
                            }
                        }
                        _ => ParamInput::Every,
                    };
                    into.extend(bindings(&property.value).into_iter().map(|symbol| (symbol, input.clone())));
                }
                if let Some(rest) = &object.rest {
                    into.extend(bindings(&rest.argument).into_iter().map(|symbol| (symbol, ParamInput::Rest(named.clone()))));
                }
            }
            BindingPattern::AssignmentPattern(assignment) => first(&assignment.left, into),
            BindingPattern::BindingIdentifier(_) => into.extend(bindings(pattern).into_iter().map(|symbol| (symbol, ParamInput::Props))),
            pattern => into.extend(bindings(pattern).into_iter().map(|symbol| (symbol, ParamInput::Every))),
        }
    }
    let mut inputs = Vec::new();
    for (index, parameter) in params.items.iter().enumerate() {
        let input = match index {
            0 => {
                first(&parameter.pattern, &mut inputs);
                continue;
            }
            1 => ParamInput::Named { key: "ref".to_string(), bare: false },
            _ => ParamInput::Every,
        };
        inputs.extend(bindings(&parameter.pattern).into_iter().map(|symbol| (symbol, input.clone())));
    }
    if let Some(rest) = &params.rest {
        inputs.extend(bindings(&rest.rest.argument).into_iter().map(|symbol| (symbol, ParamInput::Every)));
    }
    inputs
}

/// Whether a config's key `name` sets a plain prop: not a `ref`, which
/// gives the element a new receiver, nor `as`, `asChild` or `is`, which give
/// it another target.
fn plain_key(name: &str) -> bool {
    !matches!(name, "ref" | "as" | "asChild" | "is")
}

/// The bindings a pattern declares.
fn bindings(pattern: &BindingPattern<'_>) -> Vec<SymbolId> {
    let mut bound = Vec::new();
    super::bound_symbols(pattern, &mut bound);
    bound
}
