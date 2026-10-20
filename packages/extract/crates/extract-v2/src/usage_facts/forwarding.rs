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
    is_erased_wrapper, jsx_member_path, jsx_member_root, tag_origin, ElementConst, IntrinsicPatch, MemberEffect, OpaqueCall,
    OpaqueTag, Polymorphic, TagOrigin,
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
    inputs: bool,
    /// The value may be an object this module built whose own properties
    /// hold code that converting, iterating, reading, awaiting or disposing
    /// of it runs, with the object as `this`: a getter, a computed or
    /// spread property, a property named for a conversion or `then`, or a
    /// prototype it sets (`Declarations::hookable_objects`), or one a
    /// computed or hook-named store reached, or into an array any named
    /// store (`hookable_bindings`, `named_stores`).
    hookable: bool,
    tags: BTreeSet<String>,
    imports: BTreeSet<String>,
}

impl Held {
    /// Whether it carries nothing a receiver could read.
    fn is_empty(&self) -> bool {
        !self.inputs && !self.has_elements()
    }

    fn has_elements(&self) -> bool {
        !self.tags.is_empty() || !self.imports.is_empty()
    }

    /// Adds `other`, saying whether anything was new.
    fn join(&mut self, other: &Held) -> bool {
        let mut grew = (!self.inputs && other.inputs) || (!self.hookable && other.hookable);
        self.inputs |= other.inputs;
        self.hookable |= other.hookable;
        for (into, from) in [(&mut self.tags, &other.tags), (&mut self.imports, &other.imports)] {
            for name in from {
                if !into.contains(name) {
                    into.insert(name.clone());
                    grew = true;
                }
            }
        }
        grew
    }

    /// The elements alone, as a function's result carries them to its
    /// callers, without the inputs of the function they came from.
    fn elements(&self) -> Held {
        Held { inputs: false, hookable: self.hookable, tags: self.tags.clone(), imports: self.imports.clone() }
    }

    fn hooked(&self) -> Held {
        Held { hookable: true, ..self.clone() }
    }

    /// Whether converting, iterating or awaiting it may run hooks: of an
    /// object this module built (`hookable`), or of an input, whose caller
    /// may have put any key on it, the props object React builds included.
    fn runs_hooks(&self) -> bool {
        self.hookable || self.inputs
    }

    const INPUTS: Held = Held { inputs: true, hookable: false, tags: BTreeSet::new(), imports: BTreeSet::new() };
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
) -> Records {
    let mut module = Module::of(program, scoping, chains, exported);
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
    /// The function a binding is declared to.
    functions: FxHashMap<SymbolId, ScopeId>,
    /// Bindings a function body declares, and never reassigns, to an array
    /// literal or to an object literal of plain data properties (no
    /// accessor, no `__proto__`): a store of a property into one runs no
    /// code, unless a store made it hookable (`Held::hookable`), which
    /// hands it on at every member (`Walk::read_through`).
    in_place: FxHashSet<SymbolId>,
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
    element_tags: FxHashMap<u32, BTreeSet<String>>,
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
    /// The module's top-level class bindings, declared or `const X = class`.
    class_names: BTreeSet<String>,
}

/// What reaches a forwarding record, and the top-level bindings around it.
struct Reached {
    top: Vec<String>,
    held: Held,
}

/// A receiving element's record: its tag, origin and polymorphism, whether
/// a ref can read the instance it renders, and what reaches its children
/// and attributes.
struct Receiver {
    tag: String,
    origin: TagOrigin,
    polymorphic: Polymorphic,
    exposed: bool,
    reached: Reached,
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
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else { continue };
            for specifier in import.specifiers.iter().flatten() {
                let Some(symbol) = specifier.local().symbol_id.get() else { continue };
                let source = import.source.value.as_str();
                sources.insert(symbol, source.to_string());
                if matches!(specifier, ImportDeclarationSpecifier::ImportNamespaceSpecifier(_)) {
                    namespaces.insert(symbol);
                }
                // An import may hold elements its module builds.
                if !REACT_MODULES.contains(&source) {
                    let imports = BTreeSet::from([specifier.local().name.to_string()]);
                    held.insert(symbol, Held { imports, ..Held::default() });
                }
            }
        }
        let react = super::ReactImports::from(program, scoping, &REACT_MODULES);
        let react_imports = sources.iter().filter(|(_, source)| REACT_MODULES.contains(&source.as_str())).map(|(symbol, _)| *symbol).collect();
        let mut declarations = Declarations::new(scoping, &react, react_imports);
        declarations.visit_program(program);
        let arrays = Arrays::of(program, scoping, &declarations, &sources, &namespaces, exported);
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
        let patches_intrinsics = declarations
            .patches_intrinsics
            .or(reexports_react.map(|at| IntrinsicPatch { at, rule: "react-reexport" }))
            .or(redirected.map(|at| IntrinsicPatch { at, rule: "prototype-name-write" }));
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
        let Declarations { params, functions, in_place, setters, hook_states, classes, hookable_objects, .. } = declarations;
        Module {
            scoping,
            sources,
            namespaces,
            react,
            chain_spans: chains.iter().map(|chain| chain.span).collect(),
            arrays,
            params,
            bound: functions.values().copied().collect(),
            functions,
            in_place,
            setters,
            hook_states,
            classes,
            hookable_objects,
            held,
            returns: FxHashMap::default(),
            arguments: FxHashMap::default(),
            element_tags: FxHashMap::default(),
            roots: FxHashSet::default(),
            unit: Unit::Statement(0),
            reads: FxHashMap::default(),
            changed: Vec::new(),
            clock: 0,
            sinks: BTreeMap::new(),
            receivers: BTreeMap::new(),
            default: Held::default(),
            patches_intrinsics,
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

    /// Holds `value` in every binding `pattern` declares.
    fn hold_pattern(&mut self, pattern: &BindingPattern<'_>, value: &Held) {
        for symbol in bindings(pattern) {
            self.hold(symbol, value);
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

    fn sink(&mut self, at: u32, callee: Option<String>, held_array: Option<String>, top: &[String], value: &Held) {
        let entry = self.sinks.entry((at, callee, held_array)).or_insert_with(|| Reached { top: top.to_vec(), held: Held::default() });
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
        let record = |Reached { top, held }: Reached| {
            let forwards_from = if held.inputs { top } else { Vec::new() };
            (held.tags, held.imports.into_iter().collect::<Vec<_>>(), forwards_from)
        };
        let calls = self
            .sinks
            .into_iter()
            .filter(|(_, reached)| !reached.held.is_empty())
            .map(|((_, callee, held_array), reached)| {
                let (tags, imported_args, forwards_from) = record(reached);
                OpaqueCall { callee, held_array, tags, imported_args, forwards_from }
            })
            .collect();
        let tags = self
            .receivers
            .into_values()
            .filter(|receiver| !receiver.reached.held.is_empty())
            .map(|Receiver { tag, origin, polymorphic, exposed, reached }| {
                let (tags, imported_args, forwards_from) = record(reached);
                OpaqueTag { tag, origin, polymorphic, exposed, tags, imported_args, forwards_from }
            })
            .collect();
        // The module's own top-level bindings that hold elements, by name.
        let (scoping, sources) = (self.scoping, &self.sources);
        let element_const = |held: &Held| ElementConst { tags: held.tags.clone(), imports: held.imports.iter().cloned().collect() };
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
    /// Each function's parameter count and whether it has a rest
    /// parameter, by scope.
    arity: FxHashMap<ScopeId, (usize, bool)>,
    /// The functions that read their own `arguments`.
    uses_arguments: FxHashSet<ScopeId>,
    functions: FxHashMap<SymbolId, ScopeId>,
    in_place: FxHashSet<SymbolId>,
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
    /// Bindings declared to a literal, a function or a class, never
    /// reassigned: none holds a built-in's prototype.
    literal_bindings: FxHashSet<SymbolId>,
    /// Bindings written by a built-in's method or hook name, or by a
    /// bracketed key (`written_into`), with the first such write.
    built_in_writes: FxHashMap<SymbolId, u32>,
    /// See `FileFacts::patches_intrinsics`.
    patches_intrinsics: Option<IntrinsicPatch>,
    /// The bindings importing from React's modules, written or not.
    react_imports: FxHashSet<SymbolId>,
    depth: usize,
}

// `Declarations` borrows the program for its ancestors; the lifetime of the
// scoping reference stands in for both.
impl<'r> Declarations<'r> {
    fn new(scoping: &'r Scoping, react: &'r super::ReactImports, react_imports: FxHashSet<SymbolId>) -> Self {
        Declarations {
            scoping,
            react,
            ancestors: Vec::new(),
            params: FxHashMap::default(),
            arity: FxHashMap::default(),
            uses_arguments: FxHashSet::default(),
            functions: FxHashMap::default(),
            in_place: FxHashSet::default(),
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
            react_imports,
            depth: 0,
        }
    }

    fn symbol(&self, id: &IdentifierReference<'_>) -> Option<SymbolId> {
        super::symbol_of(self.scoping, id)
    }

    fn declare_params(&mut self, scope: ScopeId, params: &oxc::ast::ast::FormalParameters<'_>) {
        self.params.insert(scope, params.iter_bindings().flat_map(bindings).collect());
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
                matches!(unwrap_type_assertions(object), Expression::Identifier(id) if matches!(id.name.as_str(), "Object" | "Reflect") && self.symbol(id).is_none())
                    && !matches!(self.ancestors.last(), Some(AstKind::CallExpression(call)) if call.callee.span() == span)
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
        }
        if matches!(super::member_effect(span, self.ancestors.iter().rev()), Some(MemberEffect::Assigned | MemberEffect::Deleted)) {
            self.written_into(object, computed || name.is_some_and(built_in_name));
        }
    }

    /// A write into `object`, one that may set a built-in's method or hook
    /// when `built_in`. Into an object the module does not own (`owned`),
    /// it may reach a built-in's prototype however the code got there. One
    /// that may set a built-in's method, into a binding, may too, unless the
    /// binding is declared to a literal (`Module::of` judges it).
    fn written_into(&mut self, object: &Expression<'_>, built_in: bool) {
        let at = object.span().start;
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

    /// Whether `expression` names a built-in whose prototype every value of
    /// its kind shares: `Array`, or `globalThis.Array`.
    fn intrinsic(&self, expression: &Expression<'_>) -> bool {
        match unwrap_type_assertions(expression) {
            Expression::Identifier(id) => INTRINSICS.contains(&id.name.as_str()) && self.symbol(id).is_none(),
            Expression::StaticMemberExpression(member) => {
                INTRINSICS.contains(&member.property.name.as_str())
                    && matches!(&member.object, Expression::Identifier(id)
                        if GLOBAL_OBJECTS.contains(&id.name.as_str()) && self.symbol(id).is_none())
            }
            _ => false,
        }
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
                binary.operator.is_equality() || (binary.operator == BinaryOperator::Instanceof && binary.right.span() == span)
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
        // the module does not own (`written_into`).
        let (members, first, called, parent) = self.chain(id.span);
        let let_go = match members {
            _ if called => false,
            0 => self.symbol(id).is_some() || trusted_global(name),
            1 => GLOBAL_OBJECTS.contains(&name) && first.is_none_or(trusted_global),
            _ => false,
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

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
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
        if let Some((Expression::Identifier(object), Some(name))) = callee.map(|member| (member.object(), member.static_property_name())) {
            if self.symbol(object).is_none() {
                let reflects = matches!(object.name.as_str(), "Object" | "Reflect") && name == "getPrototypeOf";
                if reflects && self.reshapes(call.span) {
                    self.patch(call.span.start, "prototype-use");
                }
                // A built-in that writes into its first argument; a spread
                // first argument is a target the module does not own.
                if writer(&object.name, name) {
                    match call.arguments.first().map(|argument| argument.as_expression()) {
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
        if id.name == "arguments" && self.symbol(id).is_none() {
            self.uses_arguments.extend(own_function(&self.ancestors));
        }
        // Indirect `eval` and `Function` run strings the analysis cannot read.
        let runs_strings = matches!(id.name.as_str(), "eval" | "Function") && self.symbol(id).is_none();
        if runs_strings {
            self.patch(id.span.start, "string-code");
        } else if self.redirects(id) {
            self.patch(id.span.start, "trusted-let-go");
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
        self.depth += 1;
        oxc::ast_visit::walk::walk_function(self, function, flags);
        self.depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &oxc::ast::ast::ArrowFunctionExpression<'a>) {
        if let Some(scope) = arrow.scope_id.get() {
            self.declare_params(scope, &arrow.params);
        }
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
                    let literal = matches!(init, Expression::ArrayExpression(_) | Expression::ObjectExpression(_) | Expression::ClassExpression(_))
                        || function_scope(init).is_some();
                    if constant && literal {
                        self.literal_bindings.insert(symbol);
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

    /// Whether `call` is React's `cloneElement`.
    fn clones(&self, call: &CallExpression<'_>) -> bool {
        match unwrap_type_assertions(&call.callee) {
            Expression::Identifier(id) => self.module.react_name(id) == Some("cloneElement"),
            Expression::StaticMemberExpression(member) => member.property.name == "cloneElement" && self.react_callee(&call.callee),
            _ => false,
        }
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
            AstKind::StaticMemberExpression(member) if member.object.span() == current => Self::read_through(value),
            AstKind::ComputedMemberExpression(member) if member.object.span() == current => Self::read_through(value),
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
                // `Symbol.hasInstance`.
                BinaryOperator::Instanceof if binary.left.span() == current => Place::Handed,
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
        if let Some(receiver) = self.module.receivers.get_mut(&element.span.start) {
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
        let exposed = named_attribute(&["ref"]);
        let reached = Reached { top: self.top.to_vec(), held: value.clone() };
        self.module.receivers.insert(element.span.start, Receiver { tag, origin, polymorphic, exposed, reached });
        self.module.grew(Key::Receiver(element.span.start));
        Place::Kept(InPlace::Received)
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
        // A built-in reads, iterates or converts what it gets: a hookable
        // value runs its hooks, and an input those its caller gave it, at
        // any position the built-in does not call. React reads inputs as it
        // does at an element, where a hookable value is handed outside.
        if value.hookable && matches!(callee, Callee::Kept(_) | Callee::PassThrough { .. } | Callee::Converts { .. } | Callee::State(_) | Callee::ClassState) {
            return Place::Handed;
        }
        let position = call.arguments.iter().position(|argument| argument.span() == current);
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
        if converts && value.inputs && !self.react_callee(&call.callee) {
            return Place::Handed;
        }
        // `cloneElement` with props that may set a `ref` gives the element a
        // new receiver: whoever the ref reaches reads its props.
        if position == Some(0) && self.clones(call) {
            let plain = call.arguments.get(1).is_none_or(|props| {
                matches!(props.as_expression().map(unwrap_type_assertions), Some(Expression::ObjectExpression(object))
                    if object.properties.iter().all(|property| matches!(property, ObjectPropertyKind::ObjectProperty(property)
                        if !property.computed && property.key.static_name().is_some_and(|name| name != "ref"))))
            });
            if !plain {
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
                Place::Carry
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
            self.module.roots.insert(scope);
            self.module.taint(scope, &Held::INPUTS);
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
                let tags = tags.tags;
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
        program: &Program<'_>,
        scoping: &Scoping,
        declarations: &Declarations<'_>,
        sources: &FxHashMap<SymbolId, String>,
        namespaces: &FxHashSet<SymbolId>,
        exported: &FxHashSet<&str>,
    ) -> Self {
        let imports: Vec<SymbolId> = sources.keys().copied().filter(|symbol| !namespaces.contains(symbol)).collect();
        // A direct `eval` leaves no usage proven (`FileFacts::direct_eval`).
        let name = |symbol: &SymbolId| scoping.symbol_name(*symbol).to_string();
        let candidates: FxHashSet<SymbolId> =
            declarations.module_arrays.iter().chain(&declarations.local_arrays).chain(&imports).copied().collect();
        let mut uses = ArrayUses { scoping, declarations, candidates: &candidates, ancestors: Vec::new(), uses: FxHashMap::default() };
        if !candidates.is_empty() {
            uses.visit_program(program);
        }
        let uses = uses.uses;
        let allowed = |symbol: &SymbolId, kinds: &[Use]| uses.get(symbol).is_none_or(|used| used.iter().all(|kind| kinds.contains(kind)));
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

/// The uses of the `candidates` arrays.
struct ArrayUses<'s, 'd, 'a> {
    scoping: &'s Scoping,
    declarations: &'d Declarations<'d>,
    candidates: &'s FxHashSet<SymbolId>,
    ancestors: Vec<AstKind<'a>>,
    uses: FxHashMap<SymbolId, BTreeSet<Use>>,
}

impl<'a> Visit<'a> for ArrayUses<'_, '_, 'a> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        let Some(symbol) = super::symbol_of(self.scoping, id) else { return };
        if self.candidates.contains(&symbol) {
            let used = self.array_use(id.span);
            self.uses.entry(symbol).or_default().insert(used);
        }
    }
}

impl ArrayUses<'_, '_, '_> {
    /// How the reference at `span` uses the array it names.
    fn array_use(&self, span: Span) -> Use {
        let mut up = self.ancestors.iter().rev();
        let (current, parent) = super::peel_wrappers(span, &mut up);
        match parent {
            Some(AstKind::ExportSpecifier(_) | AstKind::SpreadElement(_)) => Use::Read,
            Some(AstKind::ForOfStatement(statement)) if statement.right.span() == current => Use::Read,
            Some(AstKind::StaticMemberExpression(member)) if member.object.span() == current => {
                let name = member.property.name.as_str();
                let mut call = up.clone();
                match super::member_effect(member.span, up) {
                    None if name == "length" => Use::Read,
                    Some(MemberEffect::Method) if ARRAY_READ_METHODS.contains(&name) => {
                        match super::peel_wrappers(member.span, &mut call) {
                            (_, Some(AstKind::CallExpression(call))) if self.callback_blind(name, call) => Use::Read,
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
        }
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
                .and_then(|symbol| self.declarations.functions.get(&symbol).copied()),
            Some(expression) => function_scope(expression),
        };
        scope.is_some_and(|scope| {
            let (count, rest) = self.declarations.arity.get(&scope).copied().unwrap_or((usize::MAX, true));
            count <= position && !rest && !self.declarations.uses_arguments.contains(&scope)
        })
    }
}

/// The component tags of the elements inside an element, its own included.
struct ElementTags<'m, 's> {
    module: &'m Module<'s>,
    tags: BTreeSet<String>,
}

impl<'a> Visit<'a> for ElementTags<'_, '_> {
    fn visit_jsx_opening_element(&mut self, opening: &oxc::ast::ast::JSXOpeningElement<'a>) {
        self.tags.extend(self.module.component_tag(&opening.name).map(|(tag, _)| tag));
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

/// The bindings a pattern declares.
fn bindings(pattern: &BindingPattern<'_>) -> Vec<SymbolId> {
    let mut bound = Vec::new();
    super::bound_symbols(pattern, &mut bound);
    bound
}
