//! Records of components a module uses only by identity: it iterates them,
//! compares the components they hold, and keys Maps and Sets with those
//! components, reading the keys back only to look up. Nothing such a module
//! does can render, call, spread or hand on a component it took from the
//! record, so the record's references hand none of them over.
//!
//! The shape is an allowlist; anything it does not list keeps the record
//! open:
//!
//! ```ts
//! const exported = { Alert, Box, AvatarParts };      // a module `const`, not exported
//! function spellings(entries) {                      // a module function nothing writes
//!   const names = new Map();                         // a genuine Map
//!   for (const entry of entries)                     // iteration yields the components
//!     for (const [key, value] of Object.entries(entry)) {
//!       if (typeof value !== 'function' && value === null) continue;  // tests and comparisons
//!       names.set(value, [...(names.get(value) ?? []), key]);         // a key, looked up
//!     }
//!   return names;                                    // returned to calls this pass follows
//! }
//! let cache = null;
//! export function partName(type) {
//!   cache ??= new Map([...spellings([exported])].map(([value, names]) => [value, names[0]]));
//!   return cache.get(type);                          // a key read back only to look up
//! }
//! ```
//!
//! Each value a record reaches has a kind: a component (or an object
//! holding components, which `Object.entries` and member reads yield
//! components of), a list of some kind, a tuple, or a Map whose keys and
//! values each have one. A value of any of those may be bound, compared
//! (`===`, `!==`, `== null`, `in`, `instanceof` a built-in, `typeof`, `!`),
//! iterated by `for…of`, spread into an array, passed to a parameter of a
//! function the module declares and nothing writes, returned to the calls
//! of such a function, or given to a built-in that keeps it by identity:
//! `Object.entries`, `values` and `keys`; `new Map` and `new Set`; a genuine
//! Map's or Set's `get`, `has`, `delete`, `set` and `add`; a genuine array's
//! `includes`, `indexOf`, `find`, `filter`, `some`, `every`, `forEach` and
//! `map`. A callback such a method calls receives the items and may return
//! a component only to `map`. A genuine receiver is one the module builds
//! there, or a binding that only ever holds one and whose methods nothing
//! can replace: the passes judge every use of a binding holding the
//! record's values, and every other read of a lookup's receiver calls one
//! of those methods, reads `length` or `size`, or iterates it. Everything
//! else keeps the record open: a JSX element, a call of a component or of
//! its members, a call the module cannot see, a store, a conversion to a
//! string or a key, an export, a Map or list whose components reach any of
//! those, and a function holding one that reads `arguments`.

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, AssignmentOperator, AssignmentTarget, BinaryOperator, BindingPattern, CallExpression,
    Expression, ForStatementLeft, FormalParameters, ObjectPropertyKind, Program, PropertyKind, Statement, UnaryOperator,
    VariableDeclarationKind,
};
use oxc::ast::AstKind;
use oxc::ast_visit::Visit;
use oxc::semantic::{ScopeId, Scoping, SymbolId};
use oxc::syntax::module_record::{ExportLocalName, ModuleRecord};
use oxc::span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use super::{is_erased_wrapper, symbol_of};
use crate::chain_walk::unwrap_type_assertions;

/// The module-scope bindings the reads of which hand no component over
/// (see the module): each record proven, and each module binding its proof
/// judged every use of.
pub(super) fn identity_records(program: &Program<'_>, scoping: &Scoping, module: &ModuleRecord<'_>) -> FxHashSet<SymbolId> {
    // Only module code is strict and has a scope of its own: a classic
    // script's block function assigns its var binding (Annex B), and another
    // script may assign its global functions.
    if !module.has_module_syntax {
        return FxHashSet::default();
    }
    // The bindings other modules may read: each an export names, declared
    // with it or not (`export const m`, `export { m }`, `export default function f`).
    let exported: FxHashSet<SymbolId> = module
        .local_export_entries
        .iter()
        .filter_map(|entry| match &entry.local_name {
            ExportLocalName::Name(local) | ExportLocalName::Default(local) => scoping.get_root_binding(local.name.as_str().into()),
            ExportLocalName::Null => None,
        })
        .collect();
    let candidates: Vec<SymbolId> = program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::VariableDeclaration(declaration) if declaration.kind == VariableDeclarationKind::Const => Some(declaration),
            _ => None,
        })
        .flat_map(|declaration| &declaration.declarations)
        .filter_map(|declarator| {
            let BindingPattern::BindingIdentifier(id) = &declarator.id else { return None };
            let symbol = id.symbol_id.get()?;
            (!exported.contains(&symbol) && declarator.init.as_ref().is_some_and(|init| record_literal(init, scoping))).then_some(symbol)
        })
        .collect();
    if candidates.is_empty() {
        return FxHashSet::default();
    }
    let module = ModuleFacts::of(program, scoping, exported);
    if module.with {
        return FxHashSet::default();
    }
    let mut skipped = FxHashSet::default();
    for record in candidates {
        let mut proof = Proof::new(&module, record);
        if proof.run(program) {
            let root = scoping.root_scope_id();
            skipped.extend(proof.env.into_keys().filter(|symbol| scoping.symbol_scope_id(*symbol) == root));
        }
    }
    skipped
}

/// An object literal of components: every property a plain one whose value
/// names a binding or a member of one, and at least one of them a possible
/// component (a capitalized name).
fn record_literal(init: &Expression<'_>, scoping: &Scoping) -> bool {
    let Expression::ObjectExpression(object) = unwrap_type_assertions(init) else { return false };
    let mut components = false;
    let plain = object.properties.iter().all(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else { return false };
        if property.kind != PropertyKind::Init || property.method || property.computed {
            return false;
        }
        let mut value = unwrap_type_assertions(&property.value);
        while let Expression::StaticMemberExpression(member) = value {
            value = unwrap_type_assertions(&member.object);
        }
        let Expression::Identifier(id) = value else { return false };
        components |= id.name.starts_with(|c: char| c.is_ascii_uppercase());
        symbol_of(scoping, id).is_some()
    });
    plain && components
}

/// What a value a record reaches holds.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Kind {
    /// Nothing the record holds.
    Plain,
    /// A component, or an object holding components.
    Component,
    /// A list whose items are of a kind.
    List(Box<Kind>),
    /// An array literal: each position's kind.
    Tuple(Vec<Kind>),
    /// A Map's (or a Set's, its values plain) keys and values.
    Map(Box<Kind>, Box<Kind>),
}

/// How deep a kind may nest before it is only "holds a component".
const DEPTH: usize = 4;

/// A genuine array's methods whose first argument is a callback the passes
/// give the items to.
const CALLBACK_METHODS: [&str; 8] = ["map", "filter", "find", "findLast", "findIndex", "some", "every", "forEach"];

/// Every method of a genuine Map, Set or array the passes trust: a
/// receiver's read calling one of these leaves its methods the built-ins.
const BUILT_IN_METHODS: [&str; 22] = [
    "get", "has", "delete", "set", "add", "includes", "indexOf", "lastIndexOf", "push", "unshift", "slice", "at", "keys",
    "values", "entries", "map", "filter", "find", "findLast", "findIndex", "some", "every",
];

impl Kind {
    fn list(item: Kind) -> Kind {
        if item == Kind::Plain { Kind::Plain } else { Kind::List(Box::new(item)) }
    }

    fn map(key: Kind, value: Kind) -> Kind {
        if key == Kind::Plain && value == Kind::Plain { Kind::Plain } else { Kind::Map(Box::new(key), Box::new(value)) }
    }

    fn tuple(items: Vec<Kind>) -> Kind {
        if items.iter().all(|item| *item == Kind::Plain) { Kind::Plain } else { Kind::Tuple(items) }
    }

    /// What iterating a value of this kind yields, or `None` where it is no
    /// iterable the module built.
    fn item(&self) -> Option<Kind> {
        match self {
            Kind::Plain => Some(Kind::Plain),
            Kind::Component => None,
            Kind::List(item) => Some((**item).clone()),
            Kind::Tuple(items) => Some(items.iter().cloned().fold(Kind::Plain, Kind::join)),
            Kind::Map(key, value) => Some(Kind::tuple(vec![(**key).clone(), (**value).clone()])),
        }
    }

    /// What the own properties of a value of this kind hold.
    fn values(&self) -> Option<Kind> {
        match self {
            Kind::Plain => Some(Kind::Plain),
            Kind::Component => Some(Kind::Component),
            Kind::List(_) | Kind::Tuple(_) => self.item(),
            Kind::Map(..) => None,
        }
    }

    /// What `value[key]` holds, or `None` where the read may hand on what
    /// the value holds.
    fn index(self, key: &Expression<'_>) -> Option<Kind> {
        match self {
            Kind::Plain => Some(Kind::Plain),
            Kind::Component => Some(Kind::Component),
            Kind::Tuple(items) => match key {
                Expression::NumericLiteral(index) => Some(items.get(index.value as usize).cloned().unwrap_or(Kind::Plain)),
                _ => Kind::Tuple(items).item(),
            },
            Kind::List(item) => Some(*item),
            Kind::Map(..) => None,
        }
    }

    /// What `Object.<name>(value)` returns for a value of this kind, or
    /// `None` for any other static method.
    fn of_object(&self, name: &str) -> Option<Kind> {
        let values = || self.values().unwrap_or(Kind::Component);
        match name {
            "entries" => Some(Kind::list(Kind::tuple(vec![Kind::Plain, values()]))),
            "values" => Some(Kind::list(values())),
            "keys" | "is" => Some(Kind::Plain),
            _ => None,
        }
    }

    fn join(self, other: Kind) -> Kind {
        let joined = match (self, other) {
            (Kind::Plain, other) | (other, Kind::Plain) => other,
            (a, b) if a == b => a,
            (Kind::List(a), Kind::List(b)) => Kind::list(a.join(*b)),
            (Kind::Tuple(a), Kind::Tuple(b)) if a.len() == b.len() => {
                Kind::tuple(a.into_iter().zip(b).map(|(a, b)| a.join(b)).collect())
            }
            (list @ (Kind::List(_) | Kind::Tuple(_)), other @ (Kind::List(_) | Kind::Tuple(_))) => {
                let (Some(a), Some(b)) = (list.item(), other.item()) else { return Kind::Component };
                Kind::list(a.join(b))
            }
            (Kind::Map(ak, av), Kind::Map(bk, bv)) => Kind::map(ak.join(*bk), av.join(*bv)),
            _ => Kind::Component,
        };
        if joined.depth() > DEPTH { Kind::Component } else { joined }
    }

    fn depth(&self) -> usize {
        match self {
            Kind::Plain | Kind::Component => 0,
            Kind::List(item) => 1 + item.depth(),
            Kind::Tuple(items) => 1 + items.iter().map(Kind::depth).max().unwrap_or(0),
            Kind::Map(key, value) => 1 + key.depth().max(value.depth()),
        }
    }
}

/// Joins `kind` into `key`'s entry; whether it grew.
fn grow<K: Eq + std::hash::Hash>(map: &mut FxHashMap<K, Kind>, key: K, kind: Kind) -> bool {
    if kind == Kind::Plain || map.get(&key) == Some(&kind) {
        return false;
    }
    let old = map.get(&key).cloned().unwrap_or(Kind::Plain);
    let new = old.clone().join(kind);
    let grew = new != old;
    if grew {
        map.insert(key, new);
    }
    grew
}

/// A function: its scope, which keys what it returns, its parameters, and
/// its span.
#[derive(Clone, Copy)]
struct Function<'a> {
    scope: ScopeId,
    params: &'a FormalParameters<'a>,
    span: Span,
}

impl<'a> Function<'a> {
    /// The arrow or function expression `expression` is.
    fn of_expression(expression: &'a Expression<'a>) -> Option<Self> {
        match unwrap_type_assertions(expression) {
            Expression::ArrowFunctionExpression(arrow) => Some(Self { scope: arrow.scope_id.get()?, params: &arrow.params, span: arrow.span }),
            Expression::FunctionExpression(function) => {
                Some(Self { scope: function.scope_id.get()?, params: &function.params, span: function.span })
            }
            _ => None,
        }
    }
}

/// What the passes read of the module once: the functions it declares
/// under bindings nothing writes, the bindings that only ever hold genuine
/// Maps, Sets or arrays, the bindings other modules may read, and where
/// `arguments` is read.
struct ModuleFacts<'a, 's> {
    scoping: &'s Scoping,
    functions: FxHashMap<SymbolId, Function<'a>>,
    /// Each function's scope's bindings, written or not.
    declared: FxHashMap<ScopeId, Vec<SymbolId>>,
    /// Bindings declared to a genuine Map, Set or array (or nothing) and
    /// only ever assigned one.
    genuine: FxHashSet<SymbolId>,
    /// Bindings some read of which may reach their methods: one that is no
    /// call of a method the passes trust, no `length` or `size`, and no
    /// iteration.
    exposed: FxHashSet<SymbolId>,
    /// The module bindings other modules may read.
    exported: FxHashSet<SymbolId>,
    arguments: Vec<Span>,
    /// Whether a `with` statement may supply any name the passes resolve.
    with: bool,
    ancestors: Vec<AstKind<'a>>,
}

impl<'a, 's> ModuleFacts<'a, 's> {
    fn of(program: &Program<'a>, scoping: &'s Scoping, exported: FxHashSet<SymbolId>) -> Self {
        let mut facts = Self {
            scoping,
            functions: FxHashMap::default(),
            declared: FxHashMap::default(),
            genuine: FxHashSet::default(),
            exposed: FxHashSet::default(),
            exported,
            arguments: Vec::new(),
            with: false,
            ancestors: Vec::new(),
        };
        let mut writes: FxHashMap<SymbolId, usize> = FxHashMap::default();
        let mut inits = FxHashSet::default();
        facts.collect(program, &mut writes, &mut inits);
        // Another module may replace an exported receiver's methods, and a
        // second declaration (`var seen = []; var seen = { includes }`) may
        // give it others.
        facts.genuine = inits
            .into_iter()
            .filter(|symbol| {
                let all = scoping.get_resolved_references(*symbol).filter(|reference| reference.is_write()).count();
                all == writes.get(symbol).copied().unwrap_or(0) && declared_once(scoping, *symbol) && !facts.exported.contains(symbol)
            })
            .collect();
        facts.functions.retain(|symbol, _| !crate::identity::reassigned(scoping, *symbol));
        facts
    }

    fn collect(&mut self, program: &Program<'a>, writes: &mut FxHashMap<SymbolId, usize>, inits: &mut FxHashSet<SymbolId>) {
        let mut collector = Collector { facts: self, writes, inits };
        collector.visit_program(program);
    }

    /// The function a binding nothing writes declares.
    fn function(&self, symbol: SymbolId) -> Option<Function<'a>> {
        self.functions.get(&symbol).copied()
    }

    /// Whether other modules may read `symbol`.
    fn exported(&self, symbol: SymbolId) -> bool {
        self.exported.contains(&symbol)
    }

    fn reads_arguments(&self, span: Span) -> bool {
        self.arguments.iter().any(|at| span.start <= at.start && at.end <= span.end)
    }
}

/// The walk `ModuleFacts::of` makes.
struct Collector<'f, 'a, 's> {
    facts: &'f mut ModuleFacts<'a, 's>,
    writes: &'f mut FxHashMap<SymbolId, usize>,
    inits: &'f mut FxHashSet<SymbolId>,
}

impl<'a> Collector<'_, 'a, '_> {
    /// Whether the declarator being entered is in the head of a `for…of` or
    /// `for…in` (its declaration is the loop's `left`).
    fn in_loop_head(&self) -> bool {
        let ancestors = &self.facts.ancestors;
        let (Some(AstKind::VariableDeclaration(declaration)), Some(statement)) =
            (ancestors.last(), ancestors.len().checked_sub(2).map(|index| ancestors[index]))
        else {
            return false;
        };
        match statement {
            AstKind::ForOfStatement(statement) => statement.left.span() == declaration.span,
            AstKind::ForInStatement(statement) => statement.left.span() == declaration.span,
            _ => false,
        }
    }

    /// Whether the read at `span` only calls a trusted method, reads
    /// `length` or `size`, or iterates.
    fn plain_read(&self, span: Span) -> bool {
        let ancestors = &self.facts.ancestors;
        let mut index = ancestors.len();
        let mut current = span;
        while let Some(previous) = index.checked_sub(1) {
            match ancestors[previous] {
                kind if transparent(&kind) => current = kind.span(),
                AstKind::StaticMemberExpression(member) if member.object.span() == current => {
                    let name = member.property.name.as_str();
                    let parent = previous.checked_sub(1).map(|i| ancestors[i]);
                    return match parent {
                        Some(AstKind::CallExpression(call)) if call.callee.span() == member.span => BUILT_IN_METHODS.contains(&name),
                        Some(AstKind::AssignmentExpression(_) | AstKind::UpdateExpression(_)) => false,
                        Some(AstKind::UnaryExpression(unary)) if unary.operator == UnaryOperator::Delete => false,
                        _ => matches!(name, "length" | "size"),
                    };
                }
                AstKind::ForOfStatement(statement) => return statement.right.span() == current,
                AstKind::SpreadElement(_) => {
                    return matches!(previous.checked_sub(1).map(|i| ancestors[i]), Some(AstKind::ArrayExpression(_)));
                }
                _ => return false,
            }
            index = previous;
        }
        false
    }
}

impl<'a> Visit<'a> for Collector<'_, 'a, '_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        let scoping = self.facts.scoping;
        match kind {
            AstKind::WithStatement(_) => self.facts.with = true,
            // An ambient declaration or overload signature runs nothing: the
            // name holds whatever a runtime declaration, or the global, holds.
            AstKind::Function(function) if function.body.is_some() && !function.declare => {
                if let (Some(symbol), Some(scope)) = (function.id.as_ref().and_then(|id| id.symbol_id.get()), function.scope_id.get()) {
                    self.facts.functions.insert(symbol, Function { scope, params: &function.params, span: function.span });
                    self.facts.declared.entry(scope).or_default().push(symbol);
                }
            }
            AstKind::VariableDeclarator(declarator) => {
                if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                    if let Some(symbol) = id.symbol_id.get() {
                        // A `for…of` or `for…in` head binds each item, whatever it is.
                        let iterated = self.in_loop_head();
                        if !iterated && declarator.init.as_ref().is_none_or(|init| genuine_expression(init, scoping)) {
                            self.inits.insert(symbol);
                        }
                        if let Some(function) = declarator.init.as_ref().and_then(Function::of_expression) {
                            self.facts.functions.insert(symbol, function);
                            self.facts.declared.entry(function.scope).or_default().push(symbol);
                        }
                    }
                }
            }
            AstKind::AssignmentExpression(assignment) => {
                if let AssignmentTarget::AssignmentTargetIdentifier(id) = &assignment.left {
                    let fresh = matches!(
                        assignment.operator,
                        AssignmentOperator::Assign | AssignmentOperator::LogicalNullish | AssignmentOperator::LogicalOr
                    ) && genuine_expression(&assignment.right, scoping);
                    if let (true, Some(symbol)) = (fresh, symbol_of(scoping, id)) {
                        *self.writes.entry(symbol).or_default() += 1;
                    }
                }
            }
            _ => {}
        }
        self.facts.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.facts.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, id: &oxc::ast::ast::IdentifierReference<'a>) {
        let scoping = self.facts.scoping;
        let Some(symbol) = symbol_of(scoping, id) else {
            if id.name == "arguments" {
                self.facts.arguments.push(id.span);
            }
            return;
        };
        let read = id.reference_id.get().is_some_and(|reference| scoping.get_reference(reference).is_read());
        if read && !self.plain_read(id.span) {
            self.facts.exposed.insert(symbol);
        }
    }
}

/// Whether `symbol` has one declaration, runtime or ambient.
fn declared_once(scoping: &Scoping, symbol: SymbolId) -> bool {
    scoping.symbol_redeclarations(symbol).len() <= 1
}

/// Parentheses, type syntax and optional chains: the expression inside is
/// what an enclosing node uses.
fn transparent(kind: &AstKind<'_>) -> bool {
    is_erased_wrapper(kind) || matches!(kind, AstKind::ChainExpression(_))
}

/// An expression whose value is a Map, Set or array the module builds there
/// (or nothing).
fn genuine_expression(expression: &Expression<'_>, scoping: &Scoping) -> bool {
    match unwrap_type_assertions(expression) {
        Expression::ArrayExpression(_) | Expression::NullLiteral(_) => true,
        Expression::NewExpression(new) => global(&new.callee, scoping, &["Map", "Set"]).is_some(),
        Expression::CallExpression(call) => builtin(call, scoping).is_some_and(|name| matches!(name, "entries" | "values" | "keys")),
        expression => global(expression, scoping, &["undefined"]).is_some(),
    }
}

/// The name of the global among `names` that `expression` reads.
fn global<'e>(expression: &'e Expression<'_>, scoping: &Scoping, names: &[&str]) -> Option<&'e str> {
    let Expression::Identifier(id) = unwrap_type_assertions(expression) else { return None };
    (names.contains(&id.name.as_str()) && symbol_of(scoping, id).is_none()).then_some(id.name.as_str())
}

/// The name of `Object`'s static method a call calls, `Object` being the
/// global.
fn builtin<'c>(call: &'c CallExpression<'_>, scoping: &Scoping) -> Option<&'c str> {
    let Expression::StaticMemberExpression(member) = unwrap_type_assertions(&call.callee) else { return None };
    global(&member.object, scoping, &["Object"]).map(|_| member.property.name.as_str())
}

/// The first argument of a call or `new`, where it is no spread.
fn first<'b, 'a>(arguments: &'b [Argument<'a>]) -> Option<&'b Expression<'a>> {
    arguments.first().and_then(Argument::as_expression)
}

/// One record's proof: the kind each binding, parameter and function
/// return reaches, grown pass by pass until nothing grows.
struct Proof<'p, 'a, 's> {
    scoping: &'s Scoping,
    module: &'p ModuleFacts<'a, 's>,
    env: FxHashMap<SymbolId, Kind>,
    returns: FxHashMap<ScopeId, Kind>,
    /// The bindings a method was called on with a record's value, or a
    /// callback returning one: each must end up judged by the passes, or
    /// never read but to call a trusted method (`genuine_receiver`).
    receivers: FxHashSet<SymbolId>,
    grew: bool,
    open: bool,
    ancestors: Vec<AstKind<'a>>,
}

/// How many passes a proof takes before it gives up.
const PASSES: usize = 16;

impl<'p, 'a, 's> Proof<'p, 'a, 's> {
    fn new(module: &'p ModuleFacts<'a, 's>, record: SymbolId) -> Self {
        let env = FxHashMap::from_iter([(record, Kind::Component)]);
        Self {
            scoping: module.scoping,
            module,
            env,
            returns: FxHashMap::default(),
            receivers: FxHashSet::default(),
            grew: false,
            open: false,
            ancestors: Vec::new(),
        }
    }

    /// Whether the record stays closed once every reach has grown.
    fn run(&mut self, program: &Program<'a>) -> bool {
        for _ in 0..PASSES {
            self.grew = false;
            self.visit_program(program);
            if self.open {
                return false;
            }
            if !self.grew {
                return self.receivers.iter().all(|symbol| self.env.contains_key(symbol) || !self.module.exposed.contains(symbol));
            }
        }
        false
    }

    fn bind_symbol(&mut self, symbol: SymbolId, kind: Kind) {
        if kind == Kind::Plain {
            return;
        }
        if self.module.exported(symbol) {
            return self.open = true;
        }
        self.grew |= grow(&mut self.env, symbol, kind);
    }

    fn give_back(&mut self, scope: ScopeId, kind: Kind) {
        self.grew |= grow(&mut self.returns, scope, kind);
    }

    fn bind(&mut self, pattern: &BindingPattern<'_>, kind: Kind) {
        if kind == Kind::Plain {
            return;
        }
        match pattern {
            BindingPattern::BindingIdentifier(id) => match id.symbol_id.get() {
                Some(symbol) => self.bind_symbol(symbol, kind),
                None => self.open = true,
            },
            BindingPattern::AssignmentPattern(pattern) => self.bind(&pattern.left, kind),
            BindingPattern::ArrayPattern(array) => {
                let Some(item) = kind.item() else { return self.open = true };
                for (position, element) in array.elements.iter().enumerate() {
                    let Some(element) = element else { continue };
                    let at = match &kind {
                        Kind::Tuple(items) => items.get(position).cloned().unwrap_or(Kind::Plain),
                        _ => item.clone(),
                    };
                    self.bind(element, at);
                }
                if let Some(rest) = &array.rest {
                    self.bind(&rest.argument, Kind::list(item));
                }
            }
            BindingPattern::ObjectPattern(object) => {
                if kind != Kind::Component {
                    return self.open = true;
                }
                for property in &object.properties {
                    if property.computed {
                        return self.open = true;
                    }
                    self.bind(&property.value, Kind::Component);
                }
                if let Some(rest) = &object.rest {
                    self.bind(&rest.argument, Kind::Component);
                }
            }
        }
    }

    /// Gives the `position`th parameter of `function` what a call passes it.
    fn bind_param(&mut self, function: Function<'_>, position: usize, kind: Kind) {
        if kind == Kind::Plain {
            return;
        }
        if self.module.reads_arguments(function.span) {
            return self.open = true;
        }
        let params = function.params;
        match params.items.get(position) {
            Some(param) => self.bind(&param.pattern, kind),
            None => {
                if let Some(rest) = &params.rest {
                    let mut items = vec![Kind::Plain; position - params.items.len()];
                    items.push(kind);
                    self.bind(&rest.rest.argument, Kind::tuple(items));
                }
            }
        }
    }

    /// The function a callback argument is: inline, or one the module
    /// declares under a binding nothing writes.
    fn callback(&self, callback: &'a Expression<'a>) -> Option<Function<'a>> {
        match unwrap_type_assertions(callback) {
            Expression::Identifier(id) => symbol_of(self.scoping, id).and_then(|symbol| self.module.function(symbol)),
            _ => Function::of_expression(callback),
        }
    }

    /// What `expression` evaluates to, as far as the passes know; where an
    /// expression this does not read holds a record's value, that value's
    /// own reference judges the expression.
    fn kind_of(&self, expression: &'a Expression<'a>) -> Kind {
        match unwrap_type_assertions(expression) {
            Expression::Identifier(id) => symbol_of(self.scoping, id).and_then(|symbol| self.env.get(&symbol)).cloned().unwrap_or(Kind::Plain),
            Expression::ArrayExpression(array) => self.kind_of_array(array, None),
            Expression::CallExpression(call) => {
                if let Some(name) = builtin(call, self.scoping) {
                    let argument = first(&call.arguments).map_or(Kind::Plain, |argument| self.kind_of(argument));
                    return argument.of_object(name).unwrap_or(Kind::Component);
                }
                match unwrap_type_assertions(&call.callee) {
                    Expression::Identifier(callee) => symbol_of(self.scoping, callee)
                        .and_then(|symbol| self.module.function(symbol))
                        .and_then(|function| self.returns.get(&function.scope))
                        .cloned()
                        .unwrap_or(Kind::Plain),
                    Expression::StaticMemberExpression(member) => {
                        let receiver = self.kind_of(&member.object);
                        self.method_result(&receiver, member.property.name.as_str(), call).unwrap_or(Kind::Component)
                    }
                    _ => Kind::Plain,
                }
            }
            Expression::NewExpression(new) => match global(&new.callee, self.scoping, &["Map", "Set"]) {
                Some(name) => {
                    let argument = first(&new.arguments).map_or(Kind::Plain, |argument| self.kind_of(argument));
                    Self::constructed(name == "Set", argument).unwrap_or(Kind::Component)
                }
                None => Kind::Plain,
            },
            Expression::ConditionalExpression(conditional) => self.kind_of(&conditional.consequent).join(self.kind_of(&conditional.alternate)),
            Expression::LogicalExpression(logical) => self.kind_of(&logical.left).join(self.kind_of(&logical.right)),
            Expression::StaticMemberExpression(member) => match self.kind_of(&member.object) {
                Kind::Component => Kind::Component,
                _ => Kind::Plain,
            },
            Expression::ComputedMemberExpression(member) => self.kind_of(&member.object).index(&member.expression).unwrap_or(Kind::Component),
            _ => Kind::Plain,
        }
    }

    /// What `new Map(argument)` or `new Set(argument)` holds, or `None`
    /// where the argument is no list of entries the module built.
    fn constructed(set: bool, argument: Kind) -> Option<Kind> {
        let item = argument.item()?;
        // A Set's `values`, `forEach` and `entries` yield its items as its
        // `keys` do.
        if set {
            return Some(Kind::map(item.clone(), item));
        }
        match item {
            Kind::Plain => Some(Kind::Plain),
            Kind::Tuple(entry) => Some(Kind::map(entry.first().cloned().unwrap_or(Kind::Plain), entry.get(1).cloned().unwrap_or(Kind::Plain))),
            _ => None,
        }
    }

    /// What calling `name` on a receiver of kind `receiver` returns, or
    /// `None` where the call may hand what the receiver holds outside.
    fn method_result(&self, receiver: &Kind, name: &str, call: &'a CallExpression<'a>) -> Option<Kind> {
        let callback = || {
            first(&call.arguments)
                .and_then(|callback| self.callback(callback))
                .and_then(|function| self.returns.get(&function.scope))
                .cloned()
                .unwrap_or(Kind::Plain)
        };
        match receiver {
            Kind::Plain => Some(Kind::Plain),
            Kind::Component => None,
            Kind::List(_) | Kind::Tuple(_) => {
                let item = receiver.item()?;
                match name {
                    "map" => Some(Kind::list(callback())),
                    "filter" | "slice" => Some(Kind::list(item)),
                    "find" | "findLast" | "at" => Some(item),
                    "some" | "every" | "includes" | "indexOf" | "lastIndexOf" | "findIndex" | "forEach" => Some(Kind::Plain),
                    _ => None,
                }
            }
            Kind::Map(key, value) => match name {
                "get" => Some((**value).clone()),
                "has" | "delete" | "forEach" => Some(Kind::Plain),
                "set" | "add" => Some(receiver.clone()),
                "keys" => Some(Kind::list((**key).clone())),
                "values" => Some(Kind::list((**value).clone())),
                "entries" => Some(Kind::list(Kind::tuple(vec![(**key).clone(), (**value).clone()]))),
                _ => None,
            },
        }
    }

    /// Whether a method call on `receiver` runs the built-in a genuine Map,
    /// Set or array has, where it is handed a record's value or a callback
    /// returning one: a receiver the module builds there, or a binding that
    /// only ever holds one. Such a binding's methods must be ones nothing
    /// can replace, which `run` checks once the passes settle: the passes
    /// judge its every use, or every read of it calls a trusted method. A
    /// receiver a call stores the value into becomes one the passes judge.
    fn genuine_receiver(&mut self, receiver: &Expression<'_>) -> bool {
        match unwrap_type_assertions(receiver) {
            Expression::Identifier(id) => match symbol_of(self.scoping, id) {
                Some(symbol) if self.module.genuine.contains(&symbol) => {
                    self.receivers.insert(symbol);
                    true
                }
                _ => false,
            },
            Expression::CallExpression(call) => {
                genuine_expression(receiver, self.scoping)
                    || matches!(unwrap_type_assertions(&call.callee), Expression::StaticMemberExpression(member)
                        if matches!(member.property.name.as_str(), "map" | "filter" | "slice" | "keys" | "values" | "entries") && self.genuine_receiver(&member.object))
            }
            expression => genuine_expression(expression, self.scoping),
        }
    }

    /// Gives the callback of a method of a genuine receiver what it holds:
    /// an array's callback its items, a Map's its values and keys.
    fn call_back(&mut self, receiver: &Kind, call: &'a CallExpression<'a>) {
        let Some(callback) = first(&call.arguments) else { return };
        let Some(function) = self.callback(callback) else { return self.open = true };
        let (first, second) = match receiver {
            Kind::Map(key, value) => ((**value).clone(), (**key).clone()),
            receiver => (receiver.item().unwrap_or(Kind::Component), Kind::Plain),
        };
        let reads_receiver = function.params.items.len() > 2 || function.params.rest.is_some();
        self.bind_param(function, 0, first);
        self.bind_param(function, 1, second);
        if reads_receiver {
            self.bind_param(function, 2, receiver.clone());
        }
    }

    /// Judges the record's value of kind `kind` at `span`, whose parent is
    /// `self.ancestors[at - 1]`: climbs while each position keeps it, and
    /// opens the record where one may hand it on.
    fn judge(&mut self, mut at: usize, mut current: Span, mut kind: Kind) {
        loop {
            if kind == Kind::Plain || self.open {
                return;
            }
            let Some(parent) = at.checked_sub(1).map(|index| self.ancestors[index]) else { return self.open = true };
            at -= 1;
            match parent {
                parent if transparent(&parent) => current = parent.span(),
                AstKind::StaticMemberExpression(member) if member.object.span() == current => {
                    if let Some((index, call)) = self.call_of(at, member.span) {
                        let name = member.property.name.as_str();
                        let Some(result) = self.method_result(&kind, name, call) else { return self.open = true };
                        // A callback gets the receiver's items; one that
                        // returns a record's value needs the built-in
                        // (`returned`).
                        if CALLBACK_METHODS.contains(&name) {
                            self.call_back(&kind, call);
                        }
                        (at, current, kind) = (index, call.span, result);
                        continue;
                    }
                    if self.assigned(at) {
                        return self.open = true;
                    }
                    kind = match (&kind, member.property.name.as_str()) {
                        (Kind::Component, _) => Kind::Component,
                        (Kind::List(_) | Kind::Tuple(_), "length") | (Kind::Map(..), "size") => Kind::Plain,
                        _ => return self.open = true,
                    };
                    current = member.span;
                }
                AstKind::ComputedMemberExpression(member) if member.object.span() == current => {
                    if self.call_of(at, member.span).is_some() || self.assigned(at) {
                        return self.open = true;
                    }
                    let Some(indexed) = kind.index(&member.expression) else { return self.open = true };
                    (current, kind) = (member.span, indexed);
                }
                AstKind::CallExpression(call) => {
                    let Some(position) = call.arguments.iter().position(|argument| argument.span() == current && argument.as_expression().is_some()) else {
                        // Called, or spread into the arguments.
                        return self.open = true;
                    };
                    if let Some(name) = builtin(call, self.scoping) {
                        let Some(result) = kind.of_object(name) else { return self.open = true };
                        (current, kind) = (call.span, result);
                        continue;
                    }
                    return self.argument(call, position, kind);
                }
                AstKind::NewExpression(new) => {
                    let first = new.arguments.first().is_some_and(|argument| argument.span() == current && argument.as_expression().is_some());
                    let constructed = match global(&new.callee, self.scoping, &["Map", "Set"]) {
                        Some(name) if first => Self::constructed(name == "Set", kind),
                        _ => None,
                    };
                    let Some(constructed) = constructed else { return self.open = true };
                    (current, kind) = (new.span, constructed);
                }
                AstKind::SpreadElement(spread) => {
                    if !matches!(at.checked_sub(1).map(|index| self.ancestors[index]), Some(AstKind::ArrayExpression(_))) || kind.item().is_none() {
                        return self.open = true;
                    }
                    // The array's step reads the spread's items.
                    current = spread.span;
                }
                AstKind::ArrayExpression(array) => {
                    let element = array.elements.iter().map(GetSpan::span).find(|span| *span == current);
                    let Some(element) = element else { return self.open = true };
                    (current, kind) = (array.span, self.kind_of_array(array, Some((element, &kind))));
                }
                AstKind::VariableDeclarator(declarator) => {
                    if declarator.init.as_ref().map(GetSpan::span) != Some(current) {
                        return self.open = true;
                    }
                    return self.bind(&declarator.id, kind);
                }
                AstKind::AssignmentExpression(assignment) => {
                    if assignment.left.span() == current {
                        // The read a logical assignment tests.
                        if !assignment.operator.is_logical() {
                            self.open = true;
                        }
                        return;
                    }
                    let AssignmentTarget::AssignmentTargetIdentifier(id) = &assignment.left else { return self.open = true };
                    if !matches!(assignment.operator, AssignmentOperator::Assign) && !assignment.operator.is_logical() {
                        return self.open = true;
                    }
                    let Some(symbol) = symbol_of(self.scoping, id) else { return self.open = true };
                    self.bind_symbol(symbol, kind.clone());
                    current = assignment.span;
                }
                AstKind::ReturnStatement(_) => return self.returned(at, kind),
                AstKind::ExpressionStatement(_) => return,
                // An arrow's expression body is what it returns.
                AstKind::ArrowFunctionExpression(arrow) if arrow.body.span() == current => return self.returned(at, kind),
                AstKind::ForOfStatement(statement) if statement.right.span() == current && !statement.r#await => {
                    let Some(item) = kind.item() else { return self.open = true };
                    return self.bind_for(&statement.left, item);
                }
                AstKind::ForInStatement(statement) if statement.right.span() == current => return,
                AstKind::BinaryExpression(binary) => {
                    let other = if binary.left.span() == current { &binary.right } else { &binary.left };
                    let nullish = matches!(unwrap_type_assertions(other), Expression::NullLiteral(_))
                        || global(other, self.scoping, &["undefined"]).is_some();
                    let keeps = match binary.operator {
                        BinaryOperator::StrictEquality | BinaryOperator::StrictInequality => true,
                        BinaryOperator::Equality | BinaryOperator::Inequality => nullish,
                        BinaryOperator::In => binary.right.span() == current,
                        BinaryOperator::Instanceof => {
                            binary.left.span() == current && global(&binary.right, self.scoping, &["Object", "Function", "Array", "Map", "Set"]).is_some()
                        }
                        _ => false,
                    };
                    if !keeps {
                        self.open = true;
                    }
                    return;
                }
                AstKind::UnaryExpression(unary) => {
                    if !matches!(unary.operator, UnaryOperator::Typeof | UnaryOperator::LogicalNot | UnaryOperator::Void) {
                        self.open = true;
                    }
                    return;
                }
                AstKind::LogicalExpression(_) => current = parent.span(),
                AstKind::ConditionalExpression(conditional) => {
                    if conditional.test.span() == current {
                        return;
                    }
                    current = conditional.span;
                }
                AstKind::SequenceExpression(sequence) => {
                    if sequence.expressions.last().map(GetSpan::span) != Some(current) {
                        return;
                    }
                    current = sequence.span;
                }
                AstKind::IfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::ForStatement(_) => return,
                _ => return self.open = true,
            }
        }
    }

    /// The record's value of kind `kind` passed as a call's `position`th
    /// argument: to a function the module declares, or to a method of a
    /// genuine receiver that keeps it by identity or stores it.
    fn argument(&mut self, call: &'a CallExpression<'a>, position: usize, kind: Kind) {
        match unwrap_type_assertions(&call.callee) {
            Expression::Identifier(callee) => match symbol_of(self.scoping, callee).and_then(|symbol| self.module.function(symbol)) {
                // The call's result is judged where the callee is read.
                Some(function) => self.bind_param(function, position, kind),
                None => self.open = true,
            },
            Expression::StaticMemberExpression(member) => {
                if !self.genuine_receiver(&member.object) {
                    return self.open = true;
                }
                let stored = match (member.property.name.as_str(), position) {
                    ("get" | "has" | "delete" | "includes" | "indexOf" | "lastIndexOf", 0) => return,
                    ("set", 1) => Kind::map(Kind::Plain, kind),
                    ("set", 0) => Kind::map(kind, Kind::Plain),
                    // A Set's item is its value as well as its key.
                    ("add", 0) => Kind::map(kind.clone(), kind),
                    ("push" | "unshift", _) => Kind::list(kind),
                    _ => return self.open = true,
                };
                // The receiver holds it now, and its own reference judges
                // what `set` returns.
                match unwrap_type_assertions(&member.object) {
                    Expression::Identifier(id) => match symbol_of(self.scoping, id) {
                        Some(symbol) => self.bind_symbol(symbol, stored),
                        None => self.open = true,
                    },
                    _ => self.open = true,
                }
            }
            _ => self.open = true,
        }
    }

    /// The array literal `array`'s kind, each element's as the passes know,
    /// and the element at `climbed`'s span (a spread or not) as the climb
    /// that reached it knows it.
    fn kind_of_array(&self, array: &'a oxc::ast::ast::ArrayExpression<'a>, climbed: Option<(Span, &Kind)>) -> Kind {
        let mut tuple = Vec::new();
        let mut spread = None;
        for element in &array.elements {
            let climbed = climbed.filter(|(span, _)| *span == element.span()).map(|(_, kind)| kind.clone());
            match element {
                ArrayExpressionElement::SpreadElement(spread_element) => {
                    let iterated = climbed.unwrap_or_else(|| self.kind_of(&spread_element.argument));
                    let item = iterated.item().unwrap_or(Kind::Component);
                    spread = Some(spread.take().unwrap_or(Kind::Plain).join(item));
                }
                ArrayExpressionElement::Elision(_) => tuple.push(Kind::Plain),
                element => {
                    let known = element.as_expression().map_or(Kind::Plain, |element| self.kind_of(element));
                    tuple.push(match climbed {
                        Some(climbed) => climbed.join(known),
                        None => known,
                    });
                }
            }
        }
        match spread {
            Some(spread) => Kind::list(tuple.into_iter().fold(spread, Kind::join)),
            None => Kind::tuple(tuple),
        }
    }

    /// The call `self.ancestors[at - 1]` is, where the member at `span` is
    /// its callee, and its index.
    fn call_of(&self, at: usize, span: Span) -> Option<(usize, &'a CallExpression<'a>)> {
        let mut index = at;
        let mut current = span;
        while let Some(previous) = index.checked_sub(1) {
            match self.ancestors[previous] {
                kind if transparent(&kind) => current = kind.span(),
                AstKind::CallExpression(call) if call.callee.span() == current => return Some((previous, call)),
                _ => return None,
            }
            index = previous;
        }
        None
    }

    /// Whether the member at `self.ancestors[at]` is written: an assignment's
    /// target, updated, or deleted.
    fn assigned(&self, at: usize) -> bool {
        let span = self.ancestors[at].span();
        match at.checked_sub(1).map(|index| self.ancestors[index]) {
            Some(AstKind::AssignmentExpression(assignment)) => assignment.left.span() == span,
            Some(AstKind::UpdateExpression(_)) => true,
            Some(AstKind::UnaryExpression(unary)) => unary.operator == UnaryOperator::Delete,
            _ => false,
        }
    }

    fn bind_for(&mut self, left: &ForStatementLeft<'_>, item: Kind) {
        match left {
            ForStatementLeft::VariableDeclaration(declaration) if !declaration.kind.is_using() => {
                for declarator in &declaration.declarations {
                    self.bind(&declarator.id, item.clone());
                }
            }
            ForStatementLeft::AssignmentTargetIdentifier(id) => match symbol_of(self.scoping, id) {
                Some(symbol) => self.bind_symbol(symbol, item),
                None => self.open = true,
            },
            _ => self.open = true,
        }
    }

    /// The record's value of kind `kind` returned by the function around
    /// `self.ancestors[at]`: a function the module declares returns it to
    /// the calls its reads judge; a callback to a genuine array's `map`
    /// returns it into the list that call builds; any other function hands
    /// it to whoever calls it.
    fn returned(&mut self, at: usize, kind: Kind) {
        let Some((index, scope, span)) = (0..=at).rev().find_map(|index| match self.ancestors[index] {
            AstKind::Function(function) => Some((index, function.scope_id.get()?, function.span)),
            AstKind::ArrowFunctionExpression(arrow) => Some((index, arrow.scope_id.get()?, arrow.span)),
            _ => None,
        }) else {
            return self.open = true;
        };
        self.give_back(scope, kind);
        if let Some(symbols) = self.module.declared.get(&scope) {
            // Its reads judge its calls; a function under a binding written
            // or exported (any of them: `const a = function b() {}`) has
            // calls they cannot see.
            if symbols.iter().any(|symbol| self.module.exported(*symbol) || self.module.function(*symbol).is_none()) {
                self.open = true;
            }
            return;
        }
        // An inline callback: the call it is the first argument of.
        let Some(AstKind::CallExpression(call)) = index.checked_sub(1).map(|i| self.ancestors[i]) else { return self.open = true };
        let first = call.arguments.first().is_some_and(|argument| argument.span() == span);
        let Expression::StaticMemberExpression(member) = unwrap_type_assertions(&call.callee) else { return self.open = true };
        let name = member.property.name.as_str();
        if !first || !CALLBACK_METHODS.contains(&name) || !self.genuine_receiver(&member.object) {
            return self.open = true;
        }
        // `map` builds a list of what it returns; the rest read it only for
        // truth, or not at all.
        if name == "map" {
            let returned = self.returns.get(&scope).cloned().unwrap_or(Kind::Plain);
            self.judge(index - 1, call.span, Kind::list(returned));
        }
    }
}

impl<'a> Visit<'a> for Proof<'_, 'a, '_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_statement(&mut self, statement: &Statement<'a>) {
        // An open record stays open: the rest of the pass can tell nothing.
        if !self.open {
            oxc::ast_visit::walk::walk_statement(self, statement);
        }
    }

    fn visit_identifier_reference(&mut self, id: &oxc::ast::ast::IdentifierReference<'a>) {
        if self.open {
            return;
        }
        let Some(symbol) = symbol_of(self.scoping, id) else { return };
        if !id.reference_id.get().is_some_and(|reference| self.scoping.get_reference(reference).is_read()) {
            return;
        }
        let at = self.ancestors.len();
        if let Some(kind) = self.env.get(&symbol).cloned() {
            return self.judge(at, id.span, kind);
        }
        // A function returning the record's values: only its calls read them.
        let Some(function) = self.module.function(symbol) else { return };
        let Some(returned) = self.returns.get(&function.scope).cloned() else { return };
        if self.module.exported(symbol) {
            return self.open = true;
        }
        match self.call_of(at, id.span) {
            Some((index, call)) => self.judge(index, call.span, returned),
            None => self.open = true,
        }
    }
}
