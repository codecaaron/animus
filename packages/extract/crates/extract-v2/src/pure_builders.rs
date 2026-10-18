//! Where a module's Animus builder chains take a `/* @__PURE__ */`
//! annotation, so a bundler may drop a system or theme no runtime code
//! reads, and with it the builder. Without the annotation a bundler keeps a
//! chain it cannot prove pure, such as an app system's
//! `createSystem().extend(kit).build().seal()`, and that keeps every builder
//! member and the kit it extends.
//!
//! A mark lets a bundler discard the whole call, its arguments included, so
//! it is placed only where discarding changes nothing a program can
//! observe. An unmarked chain costs bytes; a wrongly marked one changes
//! behaviour, so every rule here refuses what it cannot prove.
//!
//! - The chain starts at a call of `createSystem()` or `createTheme()`
//!   imported by name from `@animus-ui/system`, at a factory destructured
//!   from a bundle, or at a top-level `const` such a chain initializes.
//! - Each step is a method [`step`] lists for the receiver's kind: one that
//!   copies its arguments into a fresh result and calls none of them.
//!   `extendScale`, which runs its callback, is not listed.
//! - A bundle's `register…` and `seal` record on the bundle that it was
//!   consumed. On a shared `const` bundle one such step is allowed, and only
//!   where its result is kept in a `const`; a bare statement, a second
//!   consuming step, or a bundle that escapes withdraws the proof.
//! - Every argument is passive data ([`Walk::passive`]): primitives, object
//!   and array literals of passive data with plain keys, and functions only
//!   where a step stores them. A name is passive when it is a local `const`
//!   of passive data or a proven value declared by an earlier statement, or
//!   an import whose export its own module's proof keeps ([`resolve`]).
//! - Every runtime reference to a tracked `const` or import must be one the
//!   proof accepted: a step's receiver, a passive argument, a factory call,
//!   a destructuring read, or an export. Any other reference (a property
//!   write, a hand-off to a function, a read before the declaration) may
//!   change what the chain reads, so it withdraws the binding's proof.
//!
//! A destructuring of a bundle, `const { createKeyframes } = bundle`, reads
//! a property, which no annotation can mark, so it is rewritten as one
//! annotated read per name: `const createKeyframes = /* @__PURE__ */ (() =>
//! (bundle).createKeyframes)()`, the initializer parenthesized as written so
//! a type assertion on it stays an assertion on the object.

use std::collections::{BTreeMap, BTreeSet};

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, BindingPattern, CallExpression, Declaration, ExportDefaultDeclarationKind,
    Expression, IdentifierReference, ModuleExportName, ObjectPropertyKind, Program, PropertyKey, PropertyKind,
    Statement, UnaryOperator, VariableDeclaration, VariableDeclarationKind,
};
use oxc::semantic::{ReferenceId, Scoping, SymbolId};
use oxc::span::GetSpan;
use oxc::syntax::module_record::{ImportImportName, ModuleRecord};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::analyze_css::{resolve_import_source, CssInputs};
use crate::facts::FileFacts;
use crate::link::ProjectLinks;

/// The bundle's factories: each returns a fresh value and reads nothing of
/// the bundle's state.
const FACTORIES: [&str; 4] = ["createGlobalStyles", "createKeyframes", "createPositionTry", "createViewTransitions"];

/// The marker a bundler reads as "this call has no effect beyond its
/// value", so an unread result may be dropped.
const PURE: &str = "/* @__PURE__ */ ";

/// What a proven value is, which decides the steps it takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// `createSystem()`'s builder.
    System,
    /// What `build()` returns: factories, `register…` and `seal`.
    Bundle,
    /// A sealed system.
    Sealed,
    /// `createTheme()`'s builder.
    Theme,
    /// A built theme.
    Built,
    /// What a factory returns: a plain collection of references.
    Ref,
}

impl Kind {
    /// Whether an argument may carry it: a finished value, never a builder.
    fn passes(self) -> bool {
        matches!(self, Kind::Sealed | Kind::Built | Kind::Ref)
    }
}

/// What a step does: the kind it returns, whether it records consumption on
/// its receiver, and whether its arguments may hold functions it stores.
struct Step {
    returns: Kind,
    consumes: bool,
    stores_functions: bool,
}

/// The steps a receiver of `kind` takes. Each copies its arguments into a
/// fresh result, calls none of them, and changes nothing else, except that a
/// bundle's `register…` and `seal` record consumption on the bundle.
fn step(kind: Kind, method: &str) -> Option<Step> {
    let plain = |returns| Some(Step { returns, consumes: false, stores_functions: false });
    match (kind, method) {
        (Kind::System, "extend" | "addSelectors" | "addConditions") => plain(Kind::System),
        // A prop's `transform` is stored, read only for its name and source.
        (Kind::System, "addGroup" | "addProps") => {
            Some(Step { returns: Kind::System, consumes: false, stores_functions: true })
        }
        (Kind::System, "build") => plain(Kind::Bundle),
        (
            Kind::Bundle,
            "registerKeyframes" | "registerPositionTry" | "registerViewTransitions" | "registerGlobalStyles",
        ) => Some(Step { returns: Kind::Bundle, consumes: true, stores_functions: false }),
        (Kind::Bundle, "seal") => Some(Step { returns: Kind::Sealed, consumes: true, stores_functions: false }),
        (Kind::Bundle, name) if FACTORIES.contains(&name) => plain(Kind::Ref),
        (
            Kind::Theme,
            "extend" | "addBreakpoints" | "addColors" | "addColorModes" | "addScale" | "addDeclarationScale"
            | "declareContextualVars",
        ) => plain(Kind::Theme),
        (Kind::Theme, "build") => plain(Kind::Built),
        _ => None,
    }
}

/// A module's builder proof before its imports are resolved: the marks, each
/// with the imports it needs proven, and the proven values another module
/// may import.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct BuilderProof {
    /// `(start, end, text)` replacing `start..end`, in source order, and the
    /// indexes into `imports` the mark needs proven.
    marks: Vec<((u32, u32, String), BTreeSet<usize>)>,
    /// Each top-level `const` holding a value an argument may carry, by
    /// name, with the indexes into `imports` its proof needs.
    values: Vec<(String, Kind, BTreeSet<usize>)>,
    /// Named imports a mark or value needs: specifier, imported name, and
    /// whether a use reads a member of it, which needs a factory's
    /// references rather than any finished value.
    imports: Vec<(String, String, bool)>,
    /// Named imports with a reference here the proof did not accept: this
    /// module may change the value through it, so no module's proof may
    /// read it. Other modules' writes are `FileFacts::written_bindings`.
    unaccounted: Vec<(String, String)>,
}

/// The module's proof, or `None` where it imports no builder.
pub(crate) fn prove(program: &Program<'_>, module: &ModuleRecord<'_>, scoping: &Scoping) -> Option<BuilderProof> {
    let named = |names: &[&str]| crate::usage_facts::animus_named_imports(module, scoping, names);
    let roots = Roots {
        system: named(&["createSystem"]),
        theme: named(&["createTheme"]),
        helpers: named(&["firstThatWorks", "marker"]),
        asset: named(&["asset"]),
        transform: named(&["createTransform"]),
    };
    if roots.system.is_empty() && roots.theme.is_empty() {
        return None;
    }
    // Named imports, by local binding: another module's, which its own
    // proof must keep, and Animus's data (`@animus-ui/system/groups`' prop
    // groups, its transforms), plain values no module may write into.
    let mut imported: FxHashMap<SymbolId, usize> = FxHashMap::default();
    let mut imports: Vec<(String, String)> = Vec::new();
    let builders = [&roots.system, &roots.theme, &roots.helpers, &roots.asset, &roots.transform];
    for entry in &module.import_entries {
        let specifier = entry.module_request.name.as_str();
        if let ImportImportName::Name(name) = &entry.import_name {
            if let Some(symbol) = scoping.get_root_binding(entry.local_name.name.as_str().into()) {
                if builders.iter().any(|set| set.contains(&symbol)) {
                    continue;
                }
                imported.insert(symbol, imports.len());
                imports.push((specifier.to_string(), name.name.to_string()));
            }
        }
    }
    let exports = export_references(program);
    let animus_imports: FxHashSet<usize> = imports
        .iter()
        .enumerate()
        .filter(|(_, (specifier, _))| crate::usage_facts::is_animus_system_specifier(specifier))
        .map(|(index, _)| index)
        .collect();

    // A binding whose references the proof cannot account for is withdrawn,
    // and the module is walked again without it, until nothing changes.
    let mut withdrawn: FxHashSet<SymbolId> = FxHashSet::default();
    loop {
        let mut walk = Walk {
            source: program.source_text,
            scoping,
            roots: &roots,
            imported: &imported,
            animus_imports: &animus_imports,
            withdrawn: &withdrawn,
            values: FxHashMap::default(),
            factories: FxHashMap::default(),
            data: FxHashMap::default(),
            used_imports: BTreeMap::new(),
            pending: Pending::default(),
            accepted: FxHashMap::default(),
            consumed: FxHashMap::default(),
            bare_consumed: FxHashSet::default(),
            marks: Vec::new(),
            exported: FxHashSet::default(),
        };
        walk.statements(program);
        let newly = walk.unaccounted(&exports);
        if !newly.is_empty() {
            withdrawn.extend(newly);
            continue;
        }
        // Import indexes renumbered to those a kept statement uses.
        let used: Vec<usize> = walk.used_imports.keys().copied().collect();
        let renumber = |deps: &BTreeSet<usize>| -> BTreeSet<usize> {
            deps.iter().map(|dep| used.binary_search(dep).expect("a dependency is a used import")).collect()
        };
        let unaccounted = imported
            .iter()
            .filter(|(symbol, _)| withdrawn.contains(*symbol) || !walk.all_accounted(**symbol, &exports))
            .map(|(_, &index)| imports[index].clone())
            .collect();
        let values = walk
            .values
            .iter()
            .filter(|(_, value)| value.kind.passes())
            .map(|(&symbol, value)| (scoping.symbol_name(symbol).to_string(), value.kind, renumber(&value.deps)))
            .collect();
        return Some(BuilderProof {
            marks: walk.marks.iter().map(|(edit, deps)| (edit.clone(), renumber(deps))).collect(),
            values,
            imports: walk
                .used_imports
                .iter()
                .map(|(&index, &member)| (imports[index].0.clone(), imports[index].1.clone(), member))
                .collect(),
            unaccounted,
        });
    }
}

/// The references an export reads: `export { name }` and `export default
/// name`. Every other export of a binding declares it.
fn export_references(program: &Program<'_>) -> FxHashSet<ReferenceId> {
    let mut found = FxHashSet::default();
    for statement in &program.body {
        match statement {
            Statement::ExportNamedDeclaration(export) => {
                for specifier in &export.specifiers {
                    if let ModuleExportName::IdentifierReference(local) = &specifier.local {
                        found.extend(local.reference_id.get());
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let ExportDefaultDeclarationKind::Identifier(local) = &export.declaration {
                    found.extend(local.reference_id.get());
                }
            }
            _ => {}
        }
    }
    found
}

/// The module's locals bound to `@animus-ui/system` exports a proof reads.
struct Roots {
    system: FxHashSet<SymbolId>,
    theme: FxHashSet<SymbolId>,
    /// `firstThatWorks` and `marker`: fresh values of primitive arguments.
    helpers: FxHashSet<SymbolId>,
    /// `asset`: a string of its argument.
    asset: FxHashSet<SymbolId>,
    /// `createTransform(name, fn)`: stores `fn`, read only for its name and
    /// source.
    transform: FxHashSet<SymbolId>,
}

struct Value {
    kind: Kind,
    deps: BTreeSet<usize>,
}

/// What the statement being proven has accepted so far, kept only if the
/// whole statement proves.
#[derive(Default)]
struct Pending {
    references: Vec<(SymbolId, ReferenceId)>,
    deps: BTreeSet<usize>,
    /// Shared bundles a step consumed.
    consumed: Vec<SymbolId>,
    /// Imports used, and whether as a member read's object.
    imports: Vec<(usize, bool)>,
}

struct Walk<'s> {
    source: &'s str,
    scoping: &'s Scoping,
    roots: &'s Roots,
    imported: &'s FxHashMap<SymbolId, usize>,
    /// The indexes of `imported` that are Animus's data.
    animus_imports: &'s FxHashSet<usize>,
    withdrawn: &'s FxHashSet<SymbolId>,
    /// Top-level `const`s a proven chain initializes.
    values: FxHashMap<SymbolId, Value>,
    /// Top-level `const`s destructured from a bundle by a factory's name.
    factories: FxHashMap<SymbolId, BTreeSet<usize>>,
    /// Top-level `const`s of passive data, and whether the value is a
    /// primitive, which no reference can change.
    data: FxHashMap<SymbolId, (BTreeSet<usize>, bool)>,
    /// Imports a kept statement uses, and whether any use reads a member.
    used_imports: BTreeMap<usize, bool>,
    pending: Pending,
    accepted: FxHashMap<SymbolId, FxHashSet<ReferenceId>>,
    /// Consuming steps on each shared bundle.
    consumed: FxHashMap<SymbolId, u32>,
    /// Shared bundles a bare statement consumed.
    bare_consumed: FxHashSet<SymbolId>,
    marks: Vec<((u32, u32, String), BTreeSet<usize>)>,
    /// Bindings an `export` declaration declares.
    exported: FxHashSet<SymbolId>,
}

impl Walk<'_> {
    fn statements(&mut self, program: &Program<'_>) {
        for statement in &program.body {
            match statement {
                Statement::VariableDeclaration(declaration) => self.declaration(declaration),
                Statement::ExportDeclaration(export) => {
                    if let Declaration::VariableDeclaration(declaration) = &export.declaration {
                        for declarator in &declaration.declarations {
                            self.exported.extend(declarator.id.get_binding_identifiers().iter().filter_map(|binding| binding.symbol_id.get()));
                        }
                        self.declaration(declaration);
                    }
                }
                Statement::ExpressionStatement(statement) => {
                    self.pending = Pending::default();
                    let proven = self.chain(&statement.expression).is_some();
                    if !self.pending.consumed.is_empty() {
                        // A bare consuming step on a shared bundle exists
                        // only for its effect on the bundle.
                        self.bare_consumed.extend(self.pending.consumed.iter().copied());
                        self.settle_failed();
                    } else if proven {
                        let pending = std::mem::take(&mut self.pending);
                        let mark = self.annotate(statement.expression.span().start);
                        self.commit(pending, mark);
                    } else {
                        self.settle_failed();
                    }
                }
                _ => {}
            }
        }
    }

    fn declaration(&mut self, declaration: &VariableDeclaration<'_>) {
        if declaration.kind != VariableDeclarationKind::Const {
            return;
        }
        for declarator in &declaration.declarations {
            let Some(init) = &declarator.init else { continue };
            if declarator.type_annotation.is_some() {
                continue;
            }
            self.pending = Pending::default();
            match &declarator.id {
                BindingPattern::BindingIdentifier(binding) => {
                    let Some(symbol) = binding.symbol_id.get() else { continue };
                    if self.withdrawn.contains(&symbol) {
                        continue;
                    }
                    if let Some(kind) = self.chain(init) {
                        let pending = std::mem::take(&mut self.pending);
                        let deps = pending.deps.clone();
                        let mark = self.annotate(init.span().start);
                        self.commit(pending, mark);
                        self.values.insert(symbol, Value { kind, deps });
                        continue;
                    }
                    self.settle_failed();
                    let primitive = self.primitive(init);
                    if primitive || self.passive(init, false) {
                        let pending = std::mem::take(&mut self.pending);
                        let deps = pending.deps.clone();
                        self.commit(pending, None);
                        self.data.insert(symbol, (deps, primitive));
                    } else {
                        self.settle_failed();
                    }
                }
                BindingPattern::ObjectPattern(pattern) if pattern.rest.is_none() => {
                    let Expression::Identifier(object) = init.get_inner_expression() else { continue };
                    let Some((symbol, Kind::Bundle, deps)) = self.value(object) else { continue };
                    // Each name a plain key binds as it is: no default, no
                    // computed key, no nested pattern.
                    let names: Option<Vec<(&str, &str, SymbolId)>> = pattern
                        .properties
                        .iter()
                        .map(|property| match (&property.key, &property.value) {
                            (PropertyKey::StaticIdentifier(key), BindingPattern::BindingIdentifier(binding))
                                if !property.computed =>
                            {
                                Some((key.name.as_str(), binding.name.as_str(), binding.symbol_id.get()?))
                            }
                            _ => None,
                        })
                        .collect();
                    let Some(names) = names.filter(|names| !names.is_empty()) else { continue };
                    self.accept(symbol, object);
                    self.pending.deps.extend(deps.iter().copied());
                    let written = &self.source[init.span().start as usize..init.span().end as usize];
                    let reads: Vec<String> = names
                        .iter()
                        .map(|(key, local, _)| format!("{local} = {PURE}(() => ({written}).{key})()"))
                        .collect();
                    // Its line breaks stay, so every later line keeps its number.
                    let breaks = "\n".repeat(
                        self.source[declarator.span.start as usize..declarator.span.end as usize].matches('\n').count(),
                    );
                    let pending = std::mem::take(&mut self.pending);
                    self.commit(pending, Some((declarator.span.start, declarator.span.end, reads.join(", ") + &breaks)));
                    for (key, _, local) in names {
                        if FACTORIES.contains(&key) && !self.withdrawn.contains(&local) {
                            self.factories.insert(local, deps.clone());
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// Keeps what a statement that did not prove accepted before it failed:
    /// its reads are still Animus's alone, and a step it reached still
    /// consumes its bundle when the statement runs. It has no mark.
    fn settle_failed(&mut self) {
        let pending = std::mem::take(&mut self.pending);
        for (symbol, reference) in pending.references {
            self.accepted.entry(symbol).or_default().insert(reference);
        }
        for symbol in pending.consumed {
            *self.consumed.entry(symbol).or_default() += 1;
        }
    }

    /// Keeps what a proven statement accepted, with its mark if it has one.
    fn commit(&mut self, pending: Pending, mark: Option<(u32, u32, String)>) {
        for (symbol, reference) in pending.references {
            self.accepted.entry(symbol).or_default().insert(reference);
        }
        for symbol in pending.consumed {
            *self.consumed.entry(symbol).or_default() += 1;
        }
        for (index, member) in pending.imports {
            *self.used_imports.entry(index).or_default() |= member;
        }
        if let Some(mark) = mark {
            self.marks.push((mark, pending.deps));
        }
    }

    /// The annotation before the expression at `at`, as a replacement of its
    /// first character.
    fn annotate(&self, at: u32) -> Option<(u32, u32, String)> {
        let first = self.source.get(at as usize..)?.chars().next()?;
        Some((at, at + first.len_utf8() as u32, format!("{PURE}{first}")))
    }

    fn symbol(&self, ident: &IdentifierReference<'_>) -> Option<SymbolId> {
        ident.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id())
    }

    fn bound(&self, ident: &IdentifierReference<'_>, symbols: &FxHashSet<SymbolId>) -> bool {
        self.symbol(ident).is_some_and(|symbol| symbols.contains(&symbol))
    }

    fn accept(&mut self, symbol: SymbolId, ident: &IdentifierReference<'_>) {
        if let Some(reference) = ident.reference_id.get() {
            self.pending.references.push((symbol, reference));
        }
    }

    /// The proven value `ident` reads, with its kind and the imports it needs.
    fn value(&self, ident: &IdentifierReference<'_>) -> Option<(SymbolId, Kind, BTreeSet<usize>)> {
        let symbol = self.symbol(ident)?;
        let value = self.values.get(&symbol)?;
        Some((symbol, value.kind, value.deps.clone()))
    }

    /// The kind of value a proven chain returns.
    fn chain(&mut self, expression: &Expression<'_>) -> Option<Kind> {
        let Expression::CallExpression(call) = expression.get_inner_expression() else { return None };
        if call.optional {
            return None;
        }
        match call.callee.get_inner_expression() {
            Expression::Identifier(callee) => {
                let symbol = self.symbol(callee)?;
                // `createSystem`'s config only reads its sources;
                // `createTheme` takes none.
                if self.roots.system.contains(&symbol) {
                    return self.arguments(call, false).then_some(Kind::System);
                }
                if self.roots.theme.contains(&symbol) {
                    return call.arguments.is_empty().then_some(Kind::Theme);
                }
                let deps = self.factories.get(&symbol)?.clone();
                self.accept(symbol, callee);
                self.pending.deps.extend(deps);
                self.arguments(call, false).then_some(Kind::Ref)
            }
            Expression::StaticMemberExpression(member) if !member.optional => {
                let (kind, shared) = match member.object.get_inner_expression() {
                    Expression::Identifier(object) => {
                        let (symbol, kind, deps) = self.value(object)?;
                        // Accepted only as the receiver of a listed step.
                        step(kind, member.property.name.as_str())?;
                        self.accept(symbol, object);
                        self.pending.deps.extend(deps);
                        (kind, Some(symbol))
                    }
                    object => (self.chain(object)?, None),
                };
                let step = step(kind, member.property.name.as_str())?;
                if step.consumes {
                    self.pending.consumed.extend(shared);
                }
                self.arguments(call, step.stores_functions).then_some(step.returns)
            }
            _ => None,
        }
    }

    fn arguments(&mut self, call: &CallExpression<'_>, functions: bool) -> bool {
        call.arguments.iter().all(|argument| match argument {
            Argument::SpreadElement(_) => false,
            _ => argument.as_expression().is_some_and(|expression| self.passive(expression, functions)),
        })
    }

    /// Whether `expression` is a primitive whose reading runs no hook: a
    /// literal, a template of primitives, a negated number, `undefined`,
    /// `asset(…)` of a primitive, or a `const` holding one.
    fn primitive(&self, expression: &Expression<'_>) -> bool {
        match expression.get_inner_expression() {
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::BigIntLiteral(_) => true,
            Expression::TemplateLiteral(template) => template.expressions.iter().all(|part| self.primitive(part)),
            Expression::UnaryExpression(unary) => {
                matches!(unary.operator, UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus)
                    && matches!(unary.argument.get_inner_expression(), Expression::NumericLiteral(_))
            }
            Expression::Identifier(ident) => match self.symbol(ident) {
                None => ident.name == "undefined",
                Some(symbol) => self.data.get(&symbol).is_some_and(|(_, primitive)| *primitive),
            },
            Expression::CallExpression(call) => {
                !call.optional
                    && matches!(call.callee.get_inner_expression(), Expression::Identifier(callee)
                        if self.bound(callee, &self.roots.asset))
                    && call.arguments.len() == 1
                    && call.arguments[0].as_expression().is_some_and(|argument| self.primitive(argument))
            }
            _ => false,
        }
    }

    /// Whether `expression` is passive data: evaluating it runs no code but
    /// Animus's, and a step reading it runs none either. `functions` admits a
    /// function the step stores.
    fn passive(&mut self, expression: &Expression<'_>, functions: bool) -> bool {
        if self.primitive(expression) {
            return true;
        }
        match expression.get_inner_expression() {
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => functions,
            Expression::Identifier(ident) => {
                let Some(symbol) = self.symbol(ident) else { return false };
                if let Some((deps, _)) = self.data.get(&symbol) {
                    let deps = deps.clone();
                    self.accept(symbol, ident);
                    self.pending.deps.extend(deps);
                    return true;
                }
                if let Some((symbol, kind, deps)) = self.value(ident) {
                    if !kind.passes() {
                        return false;
                    }
                    self.accept(symbol, ident);
                    self.pending.deps.extend(deps);
                    return true;
                }
                self.import(symbol, ident, false)
            }
            // A member of a factory's references: a plain object's own data.
            Expression::StaticMemberExpression(member) if !member.optional => {
                let Expression::Identifier(object) = member.object.get_inner_expression() else { return false };
                let Some(symbol) = self.symbol(object) else { return false };
                if let Some((symbol, kind, deps)) = self.value(object) {
                    if kind != Kind::Ref {
                        return false;
                    }
                    self.accept(symbol, object);
                    self.pending.deps.extend(deps);
                    return true;
                }
                self.import(symbol, object, true)
            }
            Expression::ObjectExpression(object) => object.properties.iter().all(|property| {
                let property = match property {
                    ObjectPropertyKind::ObjectProperty(property) => property,
                    // Spreading plain data reads only its own values.
                    ObjectPropertyKind::SpreadProperty(spread) => return self.spreadable(&spread.argument),
                };
                let key = match &property.key {
                    PropertyKey::StaticIdentifier(key) => key.name.as_str(),
                    PropertyKey::StringLiteral(key) => key.value.as_str(),
                    PropertyKey::NumericLiteral(_) => "",
                    _ => return false,
                };
                let function = matches!(
                    property.value.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                );
                property.kind == PropertyKind::Init
                    && !property.computed
                    // `__proto__: x` sets the prototype, whose accessors a
                    // read would run.
                    && key != "__proto__"
                    && !(function && matches!(key, "toString" | "valueOf" | "toJSON"))
                    && self.passive(&property.value, functions)
            }),
            Expression::ArrayExpression(array) => array.elements.iter().all(|element| match element {
                ArrayExpressionElement::SpreadElement(_) => false,
                ArrayExpressionElement::Elision(_) => true,
                _ => element.as_expression().is_some_and(|expression| self.passive(expression, functions)),
            }),
            Expression::CallExpression(call) => {
                if call.optional {
                    return false;
                }
                let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                    return self.chain(expression).is_some_and(Kind::passes);
                };
                if self.bound(callee, &self.roots.helpers) {
                    return call.arguments.iter().all(|argument| {
                        argument.as_expression().is_some_and(|argument| self.primitive(argument))
                    });
                }
                if self.bound(callee, &self.roots.transform) {
                    return self.arguments(call, true);
                }
                self.chain(expression).is_some_and(Kind::passes)
            }
            _ => false,
        }
    }

    /// Whether spreading `expression` reads plain data alone: a local `const`
    /// of passive data or one of Animus's data imports.
    fn spreadable(&mut self, expression: &Expression<'_>) -> bool {
        let Expression::Identifier(ident) = expression.get_inner_expression() else { return false };
        let Some(symbol) = self.symbol(ident) else { return false };
        let animus = self.imported.get(&symbol).is_some_and(|&index| self.animus_imports.contains(&index));
        let data = self.data.get(&symbol).is_some_and(|(_, primitive)| !primitive);
        (animus || data) && self.passive(expression, false)
    }

    /// Whether `symbol` is a named import an argument may carry, if the
    /// module it names proves it.
    fn import(&mut self, symbol: SymbolId, ident: &IdentifierReference<'_>, member: bool) -> bool {
        if self.withdrawn.contains(&symbol) {
            return false;
        }
        let Some(&index) = self.imported.get(&symbol) else { return false };
        self.accept(symbol, ident);
        self.pending.deps.insert(index);
        self.pending.imports.push((index, member));
        true
    }

    /// Whether every runtime reference to `symbol` is one the proof accepted
    /// or an export.
    fn all_accounted(&self, symbol: SymbolId, exports: &FxHashSet<ReferenceId>) -> bool {
        let accepted = self.accepted.get(&symbol);
        self.scoping.get_resolved_reference_ids(symbol).iter().all(|&id| {
            !self.scoping.get_reference(id).is_value()
                || exports.contains(&id)
                || accepted.is_some_and(|accepted| accepted.contains(&id))
        })
    }

    /// The tracked bindings the proof cannot keep: one with a reference it did
    /// not account for, and a shared bundle consumed where that may be
    /// observed.
    fn unaccounted(&self, exports: &FxHashSet<ReferenceId>) -> Vec<SymbolId> {
        let escapes = |symbol: SymbolId| {
            self.exported.contains(&symbol)
                || self.scoping.get_resolved_reference_ids(symbol).iter().any(|id| exports.contains(id))
        };
        let tracked = self
            .values
            .keys()
            .chain(self.factories.keys())
            .chain(self.data.iter().filter(|(_, (_, primitive))| !primitive).map(|(symbol, _)| symbol))
            .chain(self.imported.keys().filter(|symbol| self.accepted.contains_key(*symbol)));
        let mut found: Vec<SymbolId> =
            tracked.copied().filter(|&symbol| !self.all_accounted(symbol, exports)).collect();
        for (&symbol, value) in &self.values {
            if value.kind != Kind::Bundle {
                continue;
            }
            let consumed = self.consumed.get(&symbol).copied().unwrap_or(0);
            if self.bare_consumed.contains(&symbol) || consumed > 1 || (consumed > 0 && escapes(symbol)) {
                found.push(symbol);
            }
        }
        found
    }
}

/// Settles each analysed module's marks. A mark that needs an import is
/// kept only where the import resolves, within the analysis, to a value its
/// own module's proof keeps, no analysed module may write into that value
/// through an import of it (`FileFacts::written_bindings`, and
/// `written_namespaces` for any export of a module imported as a
/// namespace), and the two modules import each other in no cycle (a cycle
/// can read the value before it is initialized).
pub(crate) fn resolve(files: &mut BTreeMap<String, FileFacts>, links: &ProjectLinks, inputs: &CssInputs) {
    let proofs: BTreeMap<String, BuilderProof> =
        files.iter_mut().filter_map(|(path, facts)| Some((path.clone(), facts.builder_proof.take()?))).collect();
    if proofs.is_empty() {
        return;
    }
    // The declaring module and binding name an import names; Animus's data
    // by its specifier.
    let declared = |path: &str, specifier: &str, name: &str| -> Option<(String, String)> {
        if crate::usage_facts::is_animus_system_specifier(specifier) {
            return Some((specifier.to_string(), name.to_string()));
        }
        let target = resolve_import_source(path, specifier, files, inputs)?;
        let (module, local) = links.declared(&target, name)?;
        let declaring = links.paths[module].clone();
        let binding = files.get(&declaring)?.bindings.binding(local).name.clone();
        Some((declaring, binding))
    };
    // Values an importer may change, and modules any export of may change.
    let mut changed: BTreeSet<(String, String)> = BTreeSet::new();
    let mut open: BTreeSet<String> = BTreeSet::new();
    for (path, facts) in files.iter() {
        match proofs.get(path) {
            // A builder module's own proof accounts for its imports.
            Some(proof) => {
                changed.extend(proof.unaccounted.iter().filter_map(|(specifier, name)| declared(path, specifier, name)))
            }
            None => {
                for import in facts.imports.iter().filter(|import| facts.written_bindings.contains_key(&import.local)) {
                    changed.extend(declared(path, &import.source, &import.imported));
                }
            }
        }
        for (local, specifier) in &facts.namespace_imports {
            if facts.written_namespaces.contains_key(local) {
                open.extend(resolve_import_source(path, specifier, files, inputs));
            }
        }
    }
    // Whether `to` reaches `from` through its imports.
    let cyclic = |from: &str, to: &str| -> bool {
        if crate::usage_facts::is_animus_system_specifier(to) {
            return false;
        }
        let (Some(start), Some(goal)) = (links.module(to), links.module(from)) else { return true };
        let mut seen = FxHashSet::default();
        let mut queue = vec![start];
        while let Some(module) = queue.pop() {
            if module == goal {
                return true;
            }
            if !seen.insert(module) {
                continue;
            }
            for request in &links.table.record(module).requests {
                if let animus_system_loader::module_table::Request::Module(next) = request {
                    queue.push(*next);
                }
            }
        }
        false
    };
    // Each import's declaring module and binding, and whether a use reads a
    // member of it, where an importer may read it.
    type Target = Option<(String, String, bool)>;
    let targets: BTreeMap<(&str, usize), Target> = proofs
        .iter()
        .flat_map(|(path, proof)| {
            let (declared, open, changed, cyclic) = (&declared, &open, &changed, &cyclic);
            proof.imports.iter().enumerate().map(move |(index, (specifier, name, member))| {
                let target = declared(path, specifier, name).filter(|(declaring, binding)| {
                    !open.contains(declaring)
                        && !changed.contains(&(declaring.clone(), binding.clone()))
                        && !cyclic(path, declaring)
                });
                ((path.as_str(), index), target.map(|(declaring, binding)| (declaring, binding, *member)))
            })
        })
        .collect();
    // The least set of proven values: those whose imports are all proven.
    let satisfied = |proven: &FxHashSet<(String, String)>, path: &str, deps: &BTreeSet<usize>| {
        deps.iter().all(|&index| {
            targets[&(path, index)].as_ref().is_some_and(|(declaring, binding, member)| {
                if crate::usage_facts::is_animus_system_specifier(declaring) {
                    return !member;
                }
                proven.contains(&(declaring.clone(), binding.clone()))
                    && (!member
                        || proofs[declaring].values.iter().any(|(name, kind, _)| name == binding && *kind == Kind::Ref))
            })
        })
    };
    let mut proven: FxHashSet<(String, String)> = FxHashSet::default();
    loop {
        let mut grew = false;
        for (path, proof) in &proofs {
            for (name, _, deps) in &proof.values {
                let key = (path.clone(), name.clone());
                if !proven.contains(&key) && satisfied(&proven, path, deps) {
                    proven.insert(key);
                    grew = true;
                }
            }
        }
        if !grew {
            break;
        }
    }
    for (path, proof) in &proofs {
        let edits: Vec<(u32, u32, String)> = proof
            .marks
            .iter()
            .filter(|(_, deps)| satisfied(&proven, path, deps))
            .map(|(edit, _)| edit.clone())
            .collect();
        if let Some(facts) = files.get_mut(path) {
            facts.pure_builder_edits = edits;
        }
    }
}
