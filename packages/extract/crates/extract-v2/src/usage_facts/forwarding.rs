//! What a module's components hand to code the analysis cannot see.
//!
//! One walk follows two kinds of value: a top-level function's inputs (its
//! parameters and what derives from them, `this` in a class, `arguments`)
//! and the elements the module builds, each carrying the component tags it
//! holds. From every occurrence of such a value the walk climbs the syntax
//! tree. Each position it reaches is judged by `Walk::place`, the one list
//! of what keeps a value where React renders it ([`InPlace`]), carries it on
//! to its parent, binds it, or hands it to a receiving element, whose own
//! record judges it. Any other position, an expression shape the walk does
//! not know included, hands the value to unknown code: a forwarding record.

use oxc::ast::ast::{
    AssignmentTarget, BindingPattern, CallExpression, Class, Expression, Function, IdentifierReference,
    ImportDeclarationSpecifier, JSXElement, JSXElementName, Program, Statement, StaticMemberExpression,
};
use oxc::ast::AstKind;
use oxc::ast_visit::Visit;
use oxc::semantic::{ScopeId, Scoping, SymbolFlags, SymbolId};
use oxc::span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::{BTreeMap, BTreeSet};

use super::{
    is_erased_wrapper, jsx_member_path, jsx_member_root, tag_origin, ElementConst, OpaqueCall, OpaqueTag, TagOrigin,
};
use crate::chain_walk::{unwrap_type_assertions, ChainDescriptor};

/// The positions that keep a value where React renders it, or with code
/// the analysis reads, each with why. A position not listed hands the
/// value to unknown code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InPlace {
    /// What the component returns, with the host elements (`<div>`) in it
    /// carrying their children, attributes and spreads: React renders it,
    /// React DOM sets attributes, and an event handler receives an event,
    /// not the value.
    Rendered,
    /// What a function bound to a local returns, or any function value the
    /// component calls: each call of it carries the result on from where
    /// it is.
    Returned,
    /// What a class method other than `render` returns: each call through
    /// `this` carries the result on from where it is.
    MethodResult,
    /// A test, comparison, arithmetic, `typeof`, `!`, `delete`, a template
    /// literal or a computed key: the result is a primitive, never the
    /// value.
    Primitive,
    /// A statement that discards the value, or a write into it: nothing
    /// receives it.
    Discarded,
    /// A function React's own runtime defines that keeps what it gets in
    /// React (a state setter, `setState`, `createPortal`, a DOM root's
    /// `render`), a pure built-in (`String`, `Object.keys`, `Math.*`), or
    /// `console`, which prints what it gets.
    KeptByReact,
    /// A call inside an Animus builder chain, which the engine reads.
    Builder,
    /// An export: a module that imports it is analysed, or is outside the
    /// analysis as the module's escapes say.
    Exported,
    /// A class field or method body of a class component, kept on the
    /// instance React owns. An element stored on the instance is not: a
    /// ref to the instance reads it.
    Instance,
    /// A child or attribute of a component element: the element's own
    /// record (`OpaqueTag`) judges whether its receiver keeps it in place.
    Received,
}

/// What a value may carry: the component's inputs, the component tags of
/// the elements it holds, and the imports it reads, which may hold more
/// elements (`ElementConst`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Held {
    inputs: bool,
    tags: BTreeSet<String>,
    imports: BTreeSet<String>,
}

impl Held {
    fn is_empty(&self) -> bool {
        !self.inputs && !self.has_elements()
    }

    fn has_elements(&self) -> bool {
        !self.tags.is_empty() || !self.imports.is_empty()
    }

    /// Adds `other`, saying whether anything was new.
    fn join(&mut self, other: &Held) -> bool {
        let mut grew = !self.inputs && other.inputs;
        self.inputs |= other.inputs;
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
        Held { inputs: false, tags: self.tags.clone(), imports: self.imports.clone() }
    }
}

/// Adds `value` to what `map` holds at `key`, saying whether it grew.
fn join_into<K: std::hash::Hash + Eq>(map: &mut FxHashMap<K, Held>, key: K, value: &Held) -> bool {
    map.entry(key).or_default().join(value)
}

/// What a call does with what its arguments carry.
enum Callee {
    /// Keeps it in place.
    Kept(InPlace),
    /// Returns what it gets: React's functions and hooks, a built-in array
    /// method on an array built in place, `Object.entries`, `.bind`. The
    /// result carries the arguments on, and a callback written in place
    /// receives them. One that calls the callbacks it gets with them
    /// (`higher`: an array method, `Children.map`, `Array.from`) makes any
    /// callback not written in place unknown code that receives them.
    PassThrough { higher: bool },
    /// A function or class the module declares at the top, or an import:
    /// the analysis judges it by name, and its result may carry them on.
    Named(String),
    /// A function a component body declares and never reassigns, whose
    /// parameters receive them and whose result carries them on.
    Local(ScopeId),
    /// A read method of an exported or imported `const` array that every
    /// reference here reads in place, named for the analysis to judge: a
    /// built-in, as `PassThrough { higher: true }`, while the array is held
    /// (`FileFacts::held_arrays`), and unknown code otherwise.
    HeldArray(String),
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

/// The array methods that store what they get in the array.
const ARRAY_WRITE_METHODS: [&str; 4] = ["push", "unshift", "splice", "fill"];

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
}

/// The forwarding records, receiving elements, element-holding top-level
/// bindings and held arrays of `program`, whose `exported` locals other
/// modules may read.
pub(super) fn forwarding(
    program: &Program<'_>,
    scoping: &Scoping,
    chains: &[&ChainDescriptor],
    exported: &FxHashSet<&str>,
) -> Records {
    let mut module = Module::of(program, scoping, chains, exported);
    let tops: Vec<Vec<String>> = program.body.iter().map(top_level_names).collect();
    let mut ancestors = Vec::new();
    // Each pass adds to what bindings hold, until nothing grows.
    loop {
        module.grew = false;
        for (statement, top) in program.body.iter().zip(&tops) {
            let mut walk = Walk { module: &mut module, top: top.clone(), ancestors, depth: 0, class: None };
            walk.visit_statement(statement);
            ancestors = walk.ancestors;
        }
        if !module.grew {
            break;
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
    /// `const`s built as an array literal that the module keeps to itself,
    /// whose methods are the built-in ones (`Arrays::of`).
    built_arrays: FxHashSet<SymbolId>,
    /// Exported module `const` arrays and imports that every reference
    /// here reads in place (`Arrays::of`): the analysis judges their methods.
    held_arrays: FxHashSet<SymbolId>,
    /// See `FileFacts::held_arrays` and `FileFacts::misused_imports`.
    held_array_names: BTreeSet<String>,
    misused_imports: BTreeSet<String>,
    /// Each function's parameter bindings, by its scope.
    params: FxHashMap<ScopeId, Vec<SymbolId>>,
    /// The function a binding is declared to.
    functions: FxHashMap<SymbolId, ScopeId>,
    /// Bindings a function body declares to an object or array literal it
    /// builds in place.
    in_place: FxHashSet<SymbolId>,
    /// React's state setters (`const [s, set] = useState()`).
    setters: FxHashSet<SymbolId>,
    /// The scopes of the functions bound to a name, whose call sites carry
    /// what they return.
    bound: FxHashSet<ScopeId>,
    /// Each top-level class's methods, by class span and name.
    methods: FxHashMap<(u32, String), ScopeId>,
    /// What each binding may hold.
    held: FxHashMap<SymbolId, Held>,
    /// What each function bound to a name, or class method other than
    /// `render`, returns to its callers, by scope.
    returns: FxHashMap<ScopeId, Held>,
    /// The component tags inside each component element, by span: syntax
    /// alone gives them, once.
    element_tags: FxHashMap<u32, BTreeSet<String>>,
    /// The functions whose parameters receive the component's inputs.
    tainted: FxHashSet<ScopeId>,
    /// The functions a top-level statement declares (a component, a helper,
    /// a class method): their parameters are inputs, and React or the
    /// module's callers receive what they return.
    roots: FxHashSet<ScopeId>,
    grew: bool,
    /// Forwarding records: by site, callee and whether it is a held
    /// array's method, what reaches it.
    sinks: BTreeMap<(u32, Option<String>, bool), Reached>,
    /// Receiving elements, by span.
    receivers: BTreeMap<u32, Receiver>,
    /// The elements a default export holds, which no binding names.
    default: Held,
}

/// What reaches a forwarding record, and the top-level bindings around it.
struct Reached {
    top: Vec<String>,
    held: Held,
}

/// A receiving element's record: its tag, origin and polymorphism, and
/// what reaches its children and attributes.
struct Receiver {
    tag: String,
    origin: TagOrigin,
    polymorphic: bool,
    reached: Reached,
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
        let mut declarations = Declarations::new(scoping, &react);
        declarations.visit_program(program);
        let arrays = Arrays::of(program, scoping, &declarations, &sources, &namespaces, exported);
        let Declarations { params, functions, in_place, setters, methods, .. } = declarations;
        Module {
            scoping,
            sources,
            namespaces,
            react,
            chain_spans: chains.iter().map(|chain| chain.span).collect(),
            built_arrays: arrays.built,
            held_arrays: arrays.held,
            held_array_names: arrays.held_names,
            misused_imports: arrays.misused_imports,
            params,
            bound: functions.values().copied().collect(),
            functions,
            in_place,
            setters,
            methods,
            held,
            returns: FxHashMap::default(),
            element_tags: FxHashMap::default(),
            tainted: FxHashSet::default(),
            roots: FxHashSet::default(),
            grew: false,
            sinks: BTreeMap::new(),
            receivers: BTreeMap::new(),
            default: Held::default(),
        }
    }

    fn hold(&mut self, symbol: SymbolId, value: &Held) {
        self.grew |= join_into(&mut self.held, symbol, value);
    }

    /// Holds `value` in every binding `pattern` declares.
    fn hold_pattern(&mut self, pattern: &BindingPattern<'_>, value: &Held) {
        for symbol in bindings(pattern) {
            self.hold(symbol, value);
        }
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

    /// Whether `object` is an array whose methods are the built-in ones: a
    /// literal, or a binding of one (`built_arrays`).
    fn built_array(&self, object: &Expression<'_>) -> bool {
        match unwrap_type_assertions(object) {
            Expression::ArrayExpression(_) => true,
            Expression::Identifier(id) => self.symbol(id).is_some_and(|symbol| self.built_arrays.contains(&symbol)),
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

    fn taint(&mut self, scope: ScopeId, value: &Held) {
        // `arguments` reads whether a function is tainted.
        self.grew |= self.tainted.insert(scope);
        for symbol in self.params.get(&scope).cloned().unwrap_or_default() {
            self.hold(symbol, value);
        }
    }

    fn sink(&mut self, at: u32, callee: Option<String>, held_array: bool, top: &[String], value: &Held) {
        let entry = self.sinks.entry((at, callee, held_array)).or_insert_with(|| Reached { top: top.to_vec(), held: Held::default() });
        entry.held.join(value);
    }

    fn symbol(&self, id: &IdentifierReference<'_>) -> Option<SymbolId> {
        id.reference_id.get().and_then(|reference| self.scoping.get_reference(reference).symbol_id())
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
    fn react_namespace(&self, id: &IdentifierReference<'_>) -> bool {
        match self.symbol(id) {
            Some(symbol) => self.react.namespaces.contains(&symbol),
            None => id.name == "React",
        }
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
            .map(|Receiver { tag, origin, polymorphic, reached }| {
                let (tags, imported_args, forwards_from) = record(reached);
                OpaqueTag { tag, origin, polymorphic, tags, imported_args, forwards_from }
            })
            .collect();
        // The module's own top-level bindings that hold elements, by name.
        let root = self.scoping.root_scope_id();
        let element_const = |held: &Held| ElementConst { tags: held.tags.clone(), imports: held.imports.iter().cloned().collect() };
        let mut element_consts: BTreeMap<String, ElementConst> = self
            .held
            .iter()
            .filter(|(symbol, held)| {
                held.has_elements() && self.scoping.symbol_scope_id(**symbol) == root && !self.sources.contains_key(*symbol)
            })
            .map(|(symbol, held)| (self.scoping.symbol_name(*symbol).to_string(), element_const(held)))
            .collect();
        if self.default.has_elements() {
            element_consts.insert("default".to_string(), element_const(&self.default));
        }
        Records { calls, tags, element_consts, held_arrays: self.held_array_names, misused_imports: self.misused_imports }
    }
}

/// The declarations the walk needs before it starts: every function's
/// parameters, the bindings declared to a function, an object or array
/// built in place, or React's state setters, and array `const`s.
struct Declarations<'r> {
    scoping: &'r Scoping,
    react: &'r super::ReactImports,
    params: FxHashMap<ScopeId, Vec<SymbolId>>,
    functions: FxHashMap<SymbolId, ScopeId>,
    in_place: FxHashSet<SymbolId>,
    setters: FxHashSet<SymbolId>,
    /// `const`s declared to an array literal: at the module's top, and in a
    /// function.
    module_arrays: FxHashSet<SymbolId>,
    local_arrays: FxHashSet<SymbolId>,
    /// Each top-level class's methods, by the class's span and the method's
    /// name.
    methods: FxHashMap<(u32, String), ScopeId>,
    class: Option<u32>,
    depth: usize,
}

impl<'r> Declarations<'r> {
    fn new(scoping: &'r Scoping, react: &'r super::ReactImports) -> Self {
        Declarations {
            scoping,
            react,
            params: FxHashMap::default(),
            functions: FxHashMap::default(),
            in_place: FxHashSet::default(),
            setters: FxHashSet::default(),
            module_arrays: FxHashSet::default(),
            local_arrays: FxHashSet::default(),
            methods: FxHashMap::default(),
            class: None,
            depth: 0,
        }
    }
}

/// The scope of a function written as `expression`.
fn function_scope(expression: &Expression<'_>) -> Option<ScopeId> {
    match expression {
        Expression::ArrowFunctionExpression(arrow) => arrow.scope_id.get(),
        Expression::FunctionExpression(function) => function.scope_id.get(),
        _ => None,
    }
}

impl<'a> Visit<'a> for Declarations<'_> {
    fn visit_class(&mut self, class: &Class<'a>) {
        let top = self.depth == 0 && self.class.is_none();
        if top {
            self.class = Some(class.span.start);
        }
        oxc::ast_visit::walk::walk_class(self, class);
        if top {
            self.class = None;
        }
    }

    fn visit_method_definition(&mut self, method: &oxc::ast::ast::MethodDefinition<'a>) {
        if let (Some(class), Some(name), Some(scope)) = (self.class, method.key.static_name(), method.value.scope_id.get()) {
            if self.depth == 0 {
                self.methods.insert((class, name.to_string()), scope);
            }
        }
        oxc::ast_visit::walk::walk_method_definition(self, method);
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: oxc::syntax::scope::ScopeFlags) {
        if let Some(scope) = function.scope_id.get() {
            self.params.insert(scope, function.params.iter_bindings().flat_map(bindings).collect());
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
            self.params.insert(scope, arrow.params.iter_bindings().flat_map(bindings).collect());
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
                    let constant = !self.scoping.symbol_is_mutated(symbol);
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
                    // own literal keeps what is stored in it.
                    if self.depth > 0 && matches!(init, Expression::ObjectExpression(_) | Expression::ArrayExpression(_)) {
                        self.in_place.insert(symbol);
                    }
                }
            }
            // React's own state setters: `const [state, set] = useState()`.
            if let (BindingPattern::ArrayPattern(pattern), Expression::CallExpression(call)) = (&declarator.id, init) {
                const STATE_HOOKS: [&str; 5] = ["useState", "useReducer", "useTransition", "useOptimistic", "useActionState"];
                if self.react.calls(self.scoping, &call.callee, &STATE_HOOKS) {
                    for element in pattern.elements.iter().skip(1).flatten() {
                        if let BindingPattern::BindingIdentifier(id) = element {
                            self.setters.extend(id.symbol_id.get());
                        }
                    }
                }
            }
        }
        oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
    }
}

/// The walk over one top-level statement.
struct Walk<'m, 's, 'a> {
    module: &'m mut Module<'s>,
    /// The names the statement binds, which a forwarding record names.
    top: Vec<String>,
    ancestors: Vec<AstKind<'a>>,
    /// How many functions the visit is inside.
    depth: usize,
    /// The top-level class the visit is inside, by span.
    class: Option<u32>,
}

/// What a position does with the value that reaches it.
enum Place {
    /// The value is the parent's: climb on.
    Carry,
    /// The value stays in place, for the reason given: the reason documents
    /// the allowlist and is read by nothing else.
    Kept(#[allow(dead_code)] InPlace),
    /// Code the analysis cannot see receives it.
    Handed,
}

impl<'a> Walk<'_, '_, 'a> {
    fn sink(&mut self, at: u32, callee: Option<String>, value: &Held) {
        self.module.sink(at, callee, false, &self.top, value);
    }

    /// Adds `value`'s elements to what the statement's bindings hold.
    fn top_join(&mut self, value: &Held) {
        for name in &self.top {
            self.module.top_join(name, value);
        }
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
            AstKind::MethodDefinition(_) | AstKind::ClassBody(_) | AstKind::Class(_) => self.class.is_some(),
            AstKind::CallExpression(call) => match unwrap_type_assertions(&call.callee) {
                Expression::Identifier(id) => matches!(self.module.react_name(id), Some("memo" | "forwardRef")),
                Expression::StaticMemberExpression(member) => {
                    matches!(&member.object, Expression::Identifier(object) if self.module.react_namespace(object))
                        && matches!(member.property.name.as_str(), "memo" | "forwardRef")
                }
                _ => false,
            },
            _ => false,
        })
    }

    /// What `callee` does with what its arguments carry.
    fn callee(&self, call: &CallExpression<'_>) -> Callee {
        const SAFE_GLOBALS: [&str; 10] = [
            "String", "Number", "Boolean", "isNaN", "isFinite", "parseInt", "parseFloat", "encodeURIComponent",
            "decodeURIComponent", "Symbol",
        ];
        let module = &self.module;
        match unwrap_type_assertions(&call.callee) {
            Expression::Super(_) => Callee::Kept(InPlace::KeptByReact),
            Expression::Identifier(id) => match module.symbol(id) {
                None if SAFE_GLOBALS.contains(&id.name.as_str()) => Callee::Kept(InPlace::KeptByReact),
                // The scheduling built-ins call the callbacks they get, with
                // any further arguments.
                None if matches!(id.name.as_str(), "setTimeout" | "setInterval" | "queueMicrotask" | "requestAnimationFrame" | "requestIdleCallback") => {
                    Callee::PassThrough { higher: true }
                }
                None => Callee::Unknown,
                Some(_) if module.react(id) => module.react_name(id).map_or(Callee::Unknown, react_function),
                Some(symbol) if module.setters.contains(&symbol) => Callee::Kept(InPlace::KeptByReact),
                Some(symbol) if module.sources.contains_key(&symbol) => Callee::Named(id.name.to_string()),
                Some(symbol) if module.scoping.symbol_is_mutated(symbol) => Callee::Unknown,
                Some(symbol) => match module.functions.get(&symbol) {
                    Some(scope) if module.scoping.symbol_scope_id(symbol) != module.scoping.root_scope_id() => Callee::Local(*scope),
                    Some(_) => Callee::Named(id.name.to_string()),
                    // A class or function declaration the module writes at its top.
                    None if module.scoping.symbol_scope_id(symbol) == module.scoping.root_scope_id()
                        && module.scoping.symbol_flags(symbol).intersects(SymbolFlags::Function | SymbolFlags::Class) =>
                    {
                        Callee::Named(id.name.to_string())
                    }
                    None => Callee::Unknown,
                },
            },
            Expression::StaticMemberExpression(member) => {
                let name = member.property.name.as_str();
                if name == "bind" {
                    return Callee::PassThrough { higher: false };
                }
                if module.built_array(&member.object) {
                    return Callee::PassThrough { higher: true };
                }
                if let Some(name) = self.held_array_method(member) {
                    return Callee::HeldArray(name);
                }
                match unwrap_type_assertions(&member.object) {
                    Expression::ThisExpression(_) if matches!(name, "setState" | "forceUpdate") => Callee::Kept(InPlace::KeptByReact),
                    // A method its own class declares.
                    Expression::ThisExpression(_) => match self.class.and_then(|class| module.methods.get(&(class, name.to_string()))) {
                        Some(scope) => Callee::Local(*scope),
                        None => Callee::Unknown,
                    },
                    // A React DOM root renders what it gets.
                    Expression::CallExpression(root) => match unwrap_type_assertions(&root.callee) {
                        Expression::Identifier(id) if matches!(module.react_name(id), Some("createRoot" | "hydrateRoot")) => {
                            Callee::Kept(InPlace::KeptByReact)
                        }
                        _ => Callee::Unknown,
                    },
                    Expression::Identifier(object) if module.react_name(object) == Some("Children") => Callee::PassThrough { higher: true },
                    Expression::Identifier(object) if module.react_namespace(object) => react_function(name),
                    Expression::Identifier(object) if module.react(object) => Callee::Unknown,
                    Expression::Identifier(object) => match module.symbol(object) {
                        None if object.name == "Math"
                            || object.name == "console"
                            || matches!((object.name.as_str(), name), ("Object", "keys" | "is") | ("JSON", "stringify") | ("Array", "isArray") | ("Number", "isFinite" | "isNaN")) =>
                        {
                            Callee::Kept(InPlace::KeptByReact)
                        }
                        None if matches!((object.name.as_str(), name), ("Object", "entries" | "values" | "fromEntries") | ("Array", "of")) => {
                            Callee::PassThrough { higher: false }
                        }
                        None if (object.name.as_str(), name) == ("Array", "from") => Callee::PassThrough { higher: true },
                        None => Callee::Unknown,
                        Some(symbol) if module.namespaces.contains(&symbol) => Callee::Named(format!("{}.{name}", object.name)),
                        Some(_) => Callee::Unknown,
                    },
                    // `React.Children.map`
                    Expression::StaticMemberExpression(inner) => match &inner.object {
                        Expression::Identifier(object) if module.react_namespace(object) && inner.property.name == "Children" => {
                            Callee::PassThrough { higher: true }
                        }
                        _ => Callee::Unknown,
                    },
                    _ => Callee::Unknown,
                }
            }
            _ => Callee::Unknown,
        }
    }

    /// `member`'s name for the analysis to judge, when it is a read method
    /// of an array held here.
    fn held_array_method(&self, member: &StaticMemberExpression<'_>) -> Option<String> {
        let Expression::Identifier(object) = unwrap_type_assertions(&member.object) else { return None };
        let symbol = self.module.symbol(object)?;
        (self.module.held_arrays.contains(&symbol) && ARRAY_READ_METHODS.contains(&member.property.name.as_str()))
            .then(|| format!("{}.{}", object.name, member.property.name))
    }

    /// Hands `value` to the callbacks a call gets: one written in place
    /// receives it as its parameters; when the call calls the callbacks it
    /// gets (`higher`), any other callback is unknown code.
    fn callbacks(&mut self, call: &CallExpression<'a>, current: Span, higher: bool, value: &Held) {
        for argument in &call.arguments {
            let Some(expression) = argument.as_expression().map(unwrap_type_assertions) else {
                // A spread argument: what it holds is unknown here.
                if higher {
                    self.sink(call.span.start, None, value);
                }
                continue;
            };
            match expression {
                // The argument the value came through: a callback's result
                // never reaches its own parameters.
                expression if expression.span() == current => {}
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                    if let Some(scope) = function_scope(expression) {
                        self.module.taint(scope, value);
                    }
                }
                Expression::Identifier(id) => {
                    let local = self.module.symbol(id).and_then(|symbol| {
                        (!self.module.scoping.symbol_is_mutated(symbol)).then(|| self.module.functions.get(&symbol).copied()).flatten()
                    });
                    match local {
                        Some(scope) => self.module.taint(scope, value),
                        None if higher => self.sink(call.span.start, None, value),
                        None => {}
                    }
                }
                _ if higher => self.sink(call.span.start, None, value),
                _ => {}
            }
        }
    }

    /// Climbs from the value `value` at `span` to where it stops.
    fn climb(&mut self, span: Span, value: &Held) {
        self.climb_from(self.ancestors.len(), span, value);
    }

    /// Climbs from the value `value` at `span`, a child of the ancestor
    /// before `at`.
    fn climb_from(&mut self, mut at: usize, span: Span, value: &Held) {
        if value.is_empty() {
            return;
        }
        let mut current = span;
        while at > 0 {
            at -= 1;
            let parent = self.ancestors[at];
            match self.place(at, parent, current, value) {
                Place::Carry => current = parent.span(),
                Place::Kept(_) => return,
                Place::Handed => {
                    self.sink(parent.span().start, None, value);
                    return;
                }
            }
            if self.returned(at, current, value).is_some() {
                return;
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
        // A class method's result: `render`'s React renders; any other's
        // goes to its callers through `this`.
        if let (Some(_), Some(AstKind::MethodDefinition(method))) = (self.class, at.checked_sub(1).and_then(|index| self.ancestors.get(index))) {
            if method.key.static_name().is_some_and(|name| name == "render") {
                return Some(InPlace::Rendered);
            }
            self.module.grew |= join_into(&mut self.module.returns, scope, value);
            return Some(InPlace::MethodResult);
        }
        if self.module.roots.contains(&scope) {
            // React renders a component's result; a top-level helper's goes
            // to its callers, by name.
            self.top_join(value);
            return Some(InPlace::Rendered);
        }
        // A function bound to a local: its call sites carry the result.
        if self.module.bound.contains(&scope) {
            self.module.grew |= join_into(&mut self.module.returns, scope, value);
            return Some(InPlace::Returned);
        }
        None
    }

    /// The allowlist: what the position `parent` (at `at` in the ancestors)
    /// does with the value that reaches it from `current`.
    fn place(&mut self, at: usize, parent: AstKind<'a>, current: Span, value: &Held) -> Place {
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
                if self.returning(at) =>
            {
                Place::Carry
            }
            kind if is_erased_wrapper(&kind) => Place::Carry,
            AstKind::ObjectProperty(property) if property.computed && property.key.span() == current => {
                Place::Kept(InPlace::Primitive)
            }
            AstKind::ChainExpression(_)
            | AstKind::AwaitExpression(_)
            | AstKind::ArrayExpression(_)
            | AstKind::ObjectExpression(_)
            | AstKind::ObjectProperty(_)
            | AstKind::SpreadElement(_)
            | AstKind::LogicalExpression(_)
            | AstKind::JSXExpressionContainer(_)
            | AstKind::JSXAttribute(_)
            | AstKind::JSXSpreadAttribute(_)
            | AstKind::JSXSpreadChild(_)
            | AstKind::JSXOpeningElement(_)
            | AstKind::JSXFragment(_)
            | AstKind::FunctionBody(_)
            | AstKind::Function(_)
            | AstKind::ArrowFunctionExpression(_)
            // Climb to the function it returns from.
            | AstKind::ReturnStatement(_) => Place::Carry,
            AstKind::StaticMemberExpression(member) if member.object.span() == current => Place::Carry,
            AstKind::ComputedMemberExpression(member) if member.object.span() == current => Place::Carry,
            AstKind::ComputedMemberExpression(_) | AstKind::StaticMemberExpression(_) | AstKind::PrivateFieldExpression(_) => {
                Place::Kept(InPlace::Primitive)
            }
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
                    Place::Kept(InPlace::Primitive)
                }
            }
            AstKind::BinaryExpression(binary) => {
                // `value instanceof Other` hands the value to Other's
                // `Symbol.hasInstance`.
                if binary.operator == oxc::syntax::operator::BinaryOperator::Instanceof && binary.left.span() == current {
                    Place::Handed
                } else {
                    Place::Kept(InPlace::Primitive)
                }
            }
            AstKind::UnaryExpression(_)
            | AstKind::UpdateExpression(_)
            | AstKind::PrivateInExpression(_)
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
                self.module.top_join("default", value);
                Place::Kept(InPlace::Exported)
            }
            AstKind::ExportNamedDeclaration(_) | AstKind::ExportDeclaration(_) | AstKind::ExportSpecifier(_) => {
                Place::Kept(InPlace::Exported)
            }
            AstKind::JSXElement(element) => self.element(at, element, current, value),
            AstKind::CallExpression(call) => self.call(at, call, current, value),
            AstKind::VariableDeclarator(declarator) => {
                if declarator.init.as_ref().map(GetSpan::span) == Some(current) {
                    self.module.hold_pattern(&declarator.id, value);
                    if self.depth == 0 {
                        self.top_join(value);
                    }
                }
                Place::Kept(InPlace::Discarded)
            }
            AstKind::AssignmentPattern(pattern) => {
                if pattern.right.span() == current {
                    self.module.hold_pattern(&pattern.left, value);
                }
                Place::Kept(InPlace::Discarded)
            }
            AstKind::FormalParameter(parameter) => {
                // A default value: the parameter may hold it.
                self.module.hold_pattern(&parameter.pattern, value);
                Place::Kept(InPlace::Discarded)
            }
            AstKind::AssignmentExpression(assignment) => {
                if assignment.right.span() != current {
                    // A write into the value.
                    return Place::Kept(InPlace::Discarded);
                }
                self.store(&assignment.left, value)
            }
            AstKind::ForOfStatement(statement) if statement.right.span() == current => {
                self.store_pattern(&statement.left, value);
                Place::Kept(InPlace::Discarded)
            }
            AstKind::ForInStatement(statement) if statement.right.span() == current => Place::Kept(InPlace::Primitive),
            // A class field: an element in a static field (`defaultProps`)
            // reaches whoever holds the class, and in an instance field
            // whoever holds a ref to the instance; anything else is kept on
            // the instance React owns.
            AstKind::PropertyDefinition(_) if self.class.is_some() && value.has_elements() => Place::Handed,
            AstKind::PropertyDefinition(_) | AstKind::MethodDefinition(_) | AstKind::ClassBody(_) | AstKind::Class(_)
                if self.class.is_some() =>
            {
                Place::Kept(InPlace::Instance)
            }
            // A new object, a tagged template, a dynamic import, a thrown or
            // yielded value, and every other position.
            _ => Place::Handed,
        }
    }

    /// Whether the climb is between a `return` and its function.
    fn returning(&self, at: usize) -> bool {
        self.ancestors[at + 1..]
            .iter()
            .take_while(|kind| !matches!(kind, AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)))
            .any(|kind| matches!(kind, AstKind::ReturnStatement(_)))
    }

    /// A store of `value` into `target`.
    fn store(&mut self, target: &AssignmentTarget<'a>, value: &Held) -> Place {
        match target {
            AssignmentTarget::AssignmentTargetIdentifier(id) => match self.module.symbol(id) {
                // A local: it holds the value.
                Some(symbol) if self.module.scoping.symbol_scope_id(symbol) != self.module.scoping.root_scope_id() => {
                    self.module.hold(symbol, value);
                    Place::Kept(InPlace::Discarded)
                }
                // A binding of the module, or a global: any later reader.
                _ => Place::Handed,
            },
            target => {
                let Some(member) = target.as_member_expression() else {
                    // A destructuring assignment.
                    return Place::Handed;
                };
                let mut object = member.object();
                while let Some(inner) = unwrap_type_assertions(object).as_member_expression() {
                    object = inner.object();
                }
                match unwrap_type_assertions(object) {
                    // An element on the instance reaches whoever holds a ref
                    // to it.
                    Expression::ThisExpression(_) if self.class.is_some() && !value.has_elements() => Place::Kept(InPlace::Instance),
                    // An object or array the component built in place holds it.
                    Expression::Identifier(id) => match self.module.symbol(id).filter(|symbol| self.module.in_place.contains(symbol)) {
                        Some(symbol) => {
                            self.module.hold(symbol, value);
                            Place::Kept(InPlace::Discarded)
                        }
                        None => Place::Handed,
                    },
                    _ => Place::Handed,
                }
            }
        }
    }

    fn store_pattern(&mut self, left: &oxc::ast::ast::ForStatementLeft<'a>, value: &Held) {
        let symbols: Vec<SymbolId> = match left {
            oxc::ast::ast::ForStatementLeft::VariableDeclaration(declaration) => {
                declaration.declarations.iter().flat_map(|declarator| bindings(&declarator.id)).collect()
            }
            target => match target.as_assignment_target() {
                Some(AssignmentTarget::AssignmentTargetIdentifier(id)) => self.module.symbol(id).into_iter().collect(),
                _ => Vec::new(),
            },
        };
        for symbol in symbols {
            self.module.hold(symbol, value);
        }
    }

    /// A value reaching `element`: a host element and React's own
    /// components render it in place, and carry it on with themselves; a
    /// context's provider hands its `value` to every consumer; any other
    /// component receives it, and its record judges it.
    fn element(&mut self, at: usize, element: &JSXElement<'a>, current: Span, value: &Held) -> Place {
        let opening = &element.opening_element;
        // The element's own tag name is no value it receives.
        if opening.name.span() == current || element.closing_element.as_ref().is_some_and(|closing| closing.name.span() == current) {
            return Place::Kept(InPlace::Discarded);
        }
        let host = matches!(&opening.name, JSXElementName::Identifier(_) | JSXElementName::NamespacedName(_));
        if host {
            return Place::Carry;
        }
        let named = match &opening.name {
            JSXElementName::IdentifierReference(id) => Some((id.name.to_string(), Some(&**id))),
            JSXElementName::MemberExpression(member) => jsx_member_path(member).map(|path| (path, jsx_member_root(member))),
            _ => None,
        };
        let Some((tag, root)) = named else { return Place::Handed };
        if root.is_some_and(|root| self.module.react(root)) {
            return Place::Carry;
        }
        // The climb came through the opening element's attributes: which.
        let attribute = match (self.ancestors.get(at + 1), self.ancestors.get(at + 2)) {
            (Some(AstKind::JSXOpeningElement(_)), Some(AstKind::JSXAttribute(attribute))) => Some(*attribute),
            _ => None,
        };
        let provider = matches!(&opening.name, JSXElementName::MemberExpression(member) if member.property.name == "Provider");
        let in_value = attribute.is_some_and(|attribute| {
            matches!(&attribute.name, oxc::ast::ast::JSXAttributeName::Identifier(name) if name.name == "value")
        });
        if provider && in_value {
            return Place::Handed;
        }
        let origin = root.map_or(TagOrigin::Nested, |root| tag_origin(self.module.scoping, root));
        let polymorphic = opening.attributes.iter().any(|attribute| match attribute {
            oxc::ast::ast::JSXAttributeItem::SpreadAttribute(_) => true,
            oxc::ast::ast::JSXAttributeItem::Attribute(attribute) => {
                matches!(&attribute.name, oxc::ast::ast::JSXAttributeName::Identifier(name) if name.name == "as" || name.name == "asChild")
            }
        });
        let top = &self.top;
        let receiver = self.module.receivers.entry(element.span.start).or_insert_with(|| Receiver {
            tag,
            origin,
            polymorphic,
            reached: Reached { top: top.clone(), held: Held::default() },
        });
        // The element's own climb reads it (`visit_jsx_element`).
        receiver.reached.held.join(value);
        Place::Kept(InPlace::Received)
    }

    /// A value reaching `call` (at `at` in the ancestors) from `current`,
    /// its callee or an argument.
    fn call(&mut self, at: usize, call: &CallExpression<'a>, current: Span, value: &Held) -> Place {
        if self.module.chain_spans.iter().any(|(start, end)| *start <= call.span.start && call.span.end <= *end) {
            return Place::Kept(InPlace::Builder);
        }
        if call.callee.span() == current {
            return self.called(at, call, value);
        }
        // A write method of an array built in place stores what it gets in
        // the array.
        if let Expression::StaticMemberExpression(member) = unwrap_type_assertions(&call.callee) {
            if let Expression::Identifier(id) = unwrap_type_assertions(&member.object) {
                let writes = ARRAY_WRITE_METHODS.contains(&member.property.name.as_str());
                if let Some(symbol) = self.module.symbol(id).filter(|_| writes && self.module.built_array(&member.object)) {
                    self.module.hold(symbol, value);
                }
            }
        }
        match self.callee(call) {
            Callee::Kept(reason) => Place::Kept(reason),
            Callee::Unknown => Place::Handed,
            Callee::Named(name) => {
                self.sink(call.span.start, Some(name), value);
                Place::Carry
            }
            Callee::Local(scope) => {
                self.module.taint(scope, value);
                Place::Carry
            }
            Callee::PassThrough { higher } => {
                self.callbacks(call, current, higher, value);
                Place::Carry
            }
            Callee::HeldArray(name) => self.array_method(call, current, Some(name), value),
        }
    }

    /// A built-in array method's call, the value reaching it from
    /// `current`: its callbacks receive it, and its result carries it on.
    /// A held array's method is named for the analysis to judge.
    fn array_method(&mut self, call: &CallExpression<'a>, current: Span, held: Option<String>, value: &Held) -> Place {
        self.callbacks(call, current, true, value);
        if let Some(name) = held {
            self.module.sink(call.span.start, Some(name), true, &self.top, value);
        }
        Place::Carry
    }

    /// The value is the callee of `call` (at `at` in the ancestors), or what
    /// a member of it is read from.
    fn called(&mut self, at: usize, call: &CallExpression<'a>, value: &Held) -> Place {
        let callee = unwrap_type_assertions(&call.callee);
        let Expression::StaticMemberExpression(member) = callee else {
            // A function value is called: what it gets reaches it as its
            // arguments, each judged where it is, and the call's result
            // carries the elements it returns.
            if value.has_elements() {
                self.climb_from(at, call.span, &value.elements());
            }
            return Place::Kept(InPlace::Returned);
        };
        match member.property.name.as_str() {
            "bind" => return Place::Carry,
            "setState" | "forceUpdate" if matches!(member.object, Expression::ThisExpression(_)) => {
                return Place::Kept(InPlace::KeptByReact);
            }
            // A method its own class declares: its arguments are judged
            // where they are, its result through what it returns.
            name if matches!(member.object, Expression::ThisExpression(_))
                && self.class.is_some_and(|class| self.module.methods.contains_key(&(class, name.to_string()))) =>
            {
                return Place::Kept(InPlace::Instance);
            }
            _ => {}
        }
        // A method of an array built in place is a built-in's: its callbacks
        // receive what it holds.
        if self.module.built_array(&member.object) {
            return self.array_method(call, member.object.span(), None, value);
        }
        if let Some(name) = self.held_array_method(member) {
            return self.array_method(call, member.object.span(), Some(name), value);
        }
        // A method of any other value is that value's own code: the
        // component's inputs are the caller's to hand it, and the elements
        // the component built reach unknown code.
        if value.has_elements() {
            Place::Handed
        } else {
            Place::Kept(InPlace::Discarded)
        }
    }

    fn enter_function(&mut self, scope: Option<ScopeId>) {
        // A declared function's parameters are its inputs.
        if let Some(scope) = scope.filter(|_| self.declared_root()) {
            self.module.roots.insert(scope);
            self.module.taint(scope, &Held { inputs: true, ..Held::default() });
        }
        self.depth += 1;
    }
}

/// What a React function does with what it gets, by name.
fn react_function(name: &str) -> Callee {
    match name {
        "createPortal" => Callee::Kept(InPlace::KeptByReact),
        // A handle the parent reads through its ref.
        "useImperativeHandle" => Callee::Unknown,
        _ => Callee::PassThrough { higher: false },
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
        self.enter_function(function.scope_id.get());
        oxc::ast_visit::walk::walk_function(self, function, flags);
        self.depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &oxc::ast::ast::ArrowFunctionExpression<'a>) {
        self.enter_function(arrow.scope_id.get());
        oxc::ast_visit::walk::walk_arrow_function_expression(self, arrow);
        self.depth -= 1;
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        let top = self.depth == 0 && self.class.is_none();
        if top {
            self.class = Some(class.span.start);
        }
        oxc::ast_visit::walk::walk_class(self, class);
        if top {
            self.class = None;
        }
    }

    fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
        // A declarator of a top-level statement names only its own binding:
        // a bundle declares thousands in one `var`.
        let top_level = self
            .ancestors
            .iter()
            .all(|kind| matches!(kind, AstKind::VariableDeclaration(_) | AstKind::ExportNamedDeclaration(_)));
        if !top_level {
            oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
            return;
        }
        let own = match &declarator.id {
            BindingPattern::BindingIdentifier(id) => vec![id.name.to_string()],
            _ => Vec::new(),
        };
        let statement = std::mem::replace(&mut self.top, own);
        oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
        self.top = statement;
    }

    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        // An element's tag name is no value it reads.
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
                let mut value = self.module.held.get(&symbol).cloned().unwrap_or_default();
                if let Some(returns) = self.module.functions.get(&symbol).and_then(|scope| self.module.returns.get(scope)) {
                    value.join(returns);
                }
                Some(value)
            }
            // `arguments`: the parameters of the function it is in.
            None if id.name == "arguments" => {
                let scope = self.ancestors.iter().rev().find_map(|kind| match kind {
                    AstKind::Function(function) => function.scope_id.get(),
                    _ => None,
                });
                scope.filter(|scope| self.module.tainted.contains(scope)).map(|_| Held { inputs: true, ..Held::default() })
            }
            None => None,
        };
        if let Some(value) = value {
            self.climb(id.span, &value);
        }
    }

    fn visit_this_expression(&mut self, this: &oxc::ast::ast::ThisExpression) {
        if self.class.is_some() {
            self.climb(this.span, &Held { inputs: true, ..Held::default() });
        }
    }

    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        let component = self.module.component_tag(&element.opening_element.name).is_some();
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
            if let Some(receiver) = self.module.receivers.get(&element.span.start) {
                value.join(&receiver.reached.held);
            }
            self.climb(element.span, &value);
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        oxc::ast_visit::walk::walk_call_expression(self, call);
        // A call of a class's own method, or of a function bound to a local,
        // carries what it returns, inputs included.
        let scope = match unwrap_type_assertions(&call.callee) {
            Expression::StaticMemberExpression(member) if matches!(member.object, Expression::ThisExpression(_)) => {
                self.class.and_then(|class| self.module.methods.get(&(class, member.property.name.to_string())))
            }
            Expression::Identifier(id) => self.module.symbol(id).and_then(|symbol| self.module.functions.get(&symbol)),
            _ => None,
        };
        if let Some(returns) = scope.and_then(|scope| self.module.returns.get(scope)).cloned() {
            self.climb(call.span, &returns);
        }
    }
}

/// The arrays whose methods the walk knows, from how every reference uses
/// them.
struct Arrays {
    /// See `Module::built_arrays`.
    built: FxHashSet<SymbolId>,
    /// See `Module::held_arrays`.
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
        let mut uses = ArrayUses { scoping, candidates: &candidates, ancestors: Vec::new(), uses: FxHashMap::default() };
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
    /// A read method's call, `length`, an index, a spread, a `for…of` or an
    /// export specifier.
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
struct ArrayUses<'s, 'a> {
    scoping: &'s Scoping,
    candidates: &'s FxHashSet<SymbolId>,
    ancestors: Vec<AstKind<'a>>,
    uses: FxHashMap<SymbolId, BTreeSet<Use>>,
}

impl<'a> Visit<'a> for ArrayUses<'_, 'a> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        let Some(symbol) = id.reference_id.get().and_then(|reference| self.scoping.get_reference(reference).symbol_id()) else {
            return;
        };
        if self.candidates.contains(&symbol) {
            self.uses.entry(symbol).or_default().insert(array_use(id.span, &self.ancestors));
        }
    }
}

/// How the reference at `span`, under `ancestors` (root first), uses the
/// array it names.
fn array_use(span: Span, ancestors: &[AstKind<'_>]) -> Use {
    use super::MemberEffect;
    let mut up = ancestors.iter().rev();
    let (current, parent) = super::peel_wrappers(span, &mut up);
    match parent {
        Some(AstKind::ExportSpecifier(_) | AstKind::SpreadElement(_)) => Use::Read,
        Some(AstKind::ForOfStatement(statement)) if statement.right.span() == current => Use::Read,
        Some(AstKind::StaticMemberExpression(member)) if member.object.span() == current => {
            let name = member.property.name.as_str();
            match super::member_effect(member.span, up) {
                None if name == "length" => Use::Read,
                Some(MemberEffect::Method) if ARRAY_READ_METHODS.contains(&name) => Use::Read,
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

/// React's own modules: their functions render or clone elements only as
/// usage facts record.
const REACT_MODULES: [&str; 6] =
    ["react", "react-dom", "react-dom/client", "react-dom/server", "react/jsx-runtime", "react/jsx-dev-runtime"];

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
    pattern.get_binding_identifiers().iter().filter_map(|id| id.symbol_id.get()).collect()
}
