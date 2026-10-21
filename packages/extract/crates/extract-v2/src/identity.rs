//! One owned identity for every binding and reference of a module, read from
//! one semantic build. A module-scope binding is `Module`, a binding of any
//! inner scope is `Nested`, and a name no binding declares is `Global`, so a
//! parameter or block binding never reads as a module-scope name, and a
//! shadowed `Object` or `React` never reads as the global one.
//!
//! Ordinals come from source order, never from the parser's numbering or the
//! order files are analysed in, and no parser type leaves this module.

use std::cell::Cell;
use std::sync::Arc;

use oxc::ast::ast::{ExportDefaultDeclarationKind, IdentifierReference, ModuleDeclaration, Program};
use oxc::ast_visit::Visit;
use oxc::semantic::{ScopeFlags, ScopeId as ParserScopeId, Scoping, SymbolId};
use oxc::syntax::module_record::{ImportImportName, ModuleRecord};
use rustc_hash::FxHashMap;

/// A module, named by its path in the analysed set.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ModuleId(Arc<str>);

impl ModuleId {
    pub fn new(path: &str) -> Self {
        Self(Arc::from(path))
    }

    pub fn path(&self) -> &str {
        &self.0
    }
}

/// A binding's ordinal in its module: declarations in source order, then the
/// synthetic default cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct LocalId(pub u32);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BindingId {
    pub module: ModuleId,
    pub local: LocalId,
}

/// A scope's ordinal in its module, in the order the source opens scopes;
/// the module scope is 0.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ScopeId {
    pub module: ModuleId,
    pub ordinal: u32,
}

/// An operation site's ordinal in its module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SiteId(pub u32);

/// A value an operation creates: its site and which of the site's results.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ValueId {
    pub module: ModuleId,
    pub site: SiteId,
    pub result: u16,
}

/// The realm a global name is read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Realm {
    /// The global object every analysed module shares.
    Shared,
}

/// What a reference, or a binding, is.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Identity {
    Module(BindingId),
    Nested { scope: ScopeId, local: LocalId },
    Global { realm: Realm, name: String },
    /// A key read from one frontend provider map. Reserved: no frontend
    /// records provider sites yet.
    #[allow(dead_code)]
    Provided { scope: ScopeId, provider: ValueId, key: String },
    /// A value with no binding. Reserved for the operation records.
    #[allow(dead_code)]
    Anonymous(ValueId),
}

/// The module binding an import declares, as written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportBinding {
    Named { specifier: String, imported: String },
    Default { specifier: String },
    Namespace { specifier: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BindingKind {
    /// Declared in the module's own source.
    Declared,
    Import(ImportBinding),
    /// The cell `export default <expression>` writes once, when the module
    /// evaluates; a later write to a binding it read leaves it unchanged.
    DefaultCell,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub name: String,
    pub span: (u32, u32),
    /// `None` for the module scope.
    pub scope: Option<ScopeId>,
    pub kind: BindingKind,
    /// Whether it holds a value at runtime: false for a type, an interface,
    /// a namespace with no runtime member and an ambient (`declare`)
    /// declaration.
    pub value: bool,
}

/// What the module exports as `default`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DefaultExport {
    /// `export default <expression>`, `export default x` included: a
    /// synthetic cell holding the value it had then, and the module binding
    /// the expression names when it is one (through type assertions).
    Snapshot { cell: LocalId, of: Option<LocalId> },
    /// `export { x as default }`: the live binding `x`.
    Alias(LocalId),
    /// `export default function` or `class`: the declared binding, or a
    /// synthetic cell when the declaration has no name.
    Declaration(LocalId),
}

/// Every binding and reference of one module, keyed by identity.
#[derive(Debug)]
pub struct BindingTable {
    pub module: ModuleId,
    /// Indexed by `LocalId`.
    pub bindings: Vec<Binding>,
    module_names: FxHashMap<String, LocalId>,
    /// The parser's import entries by local name. A parse that gave up keeps
    /// the entries it read, with no binding for them.
    imports: FxHashMap<String, ImportBinding>,
    /// Every identifier reference, in source order, by span.
    references: Vec<((u32, u32), Identity)>,
    pub default_export: Option<DefaultExport>,
}

/// What one module's binding table is prepared from: one parse and the one
/// semantic build over it.
pub(crate) struct IdentityInput<'s, 'a> {
    pub module: ModuleId,
    pub program: &'s Program<'a>,
    pub module_record: &'s ModuleRecord<'a>,
    /// Built over `program` with nothing built over it since: the program's
    /// reference cells hold this build's numbering, which `prepare` checks.
    pub scoping: &'s Scoping,
}

impl BindingTable {
    /// Prepares the table. Panics when the build breaks its own invariants,
    /// or the program's cells hold another build's numbering: two bindings
    /// one name in one scope, two references at one span, a reference cell
    /// naming another binding, or a reference the walk misses.
    pub(crate) fn prepare(input: IdentityInput<'_, '_>) -> Self {
        let IdentityInput { module, program, module_record, scoping } = input;
        let mut walk = SourceWalk { scoping, module: &module, scopes: FxHashMap::default(), references: Vec::new() };
        walk.visit_program(program);
        if walk.references.len() != scoping.references_len() {
            panic!(
                "{}: the walk read {} references of the build's {}",
                module.path(),
                walk.references.len(),
                scoping.references_len()
            );
        }

        let root = scoping.root_scope_id();
        let scope_of = |symbol: SymbolId| {
            let scope = scoping.symbol_scope_id(symbol);
            (scope != root).then(|| ScopeId {
                module: module.clone(),
                ordinal: *walk.scopes.get(&scope).unwrap_or_else(|| {
                    panic!("{}: '{}' is declared in a scope the walk never opened", module.path(), scoping.symbol_name(symbol))
                }),
            })
        };

        let mut imports: FxHashMap<String, ImportBinding> = FxHashMap::default();
        for entry in &module_record.import_entries {
            let specifier = entry.module_request.name.to_string();
            let binding = match &entry.import_name {
                ImportImportName::Name(name) => ImportBinding::Named { specifier, imported: name.name.to_string() },
                ImportImportName::Default(_) => ImportBinding::Default { specifier },
                ImportImportName::NamespaceObject => ImportBinding::Namespace { specifier },
            };
            // A repeated local keeps its first declaration, as lookups by name do.
            imports.entry(entry.local_name.name.to_string()).or_insert(binding);
        }

        // Bindings in the order the source declares them.
        let mut symbols: Vec<SymbolId> = scoping.symbol_ids().collect();
        symbols.sort_by_key(|&symbol| {
            let span = scoping.symbol_span(symbol);
            (span.start, span.end, symbol.index())
        });
        let mut locals = vec![LocalId(0); symbols.len()];
        let mut bindings = Vec::with_capacity(symbols.len() + 1);
        let mut scope_names: FxHashMap<(Option<u32>, &str), LocalId> = FxHashMap::default();
        for (index, &symbol) in symbols.iter().enumerate() {
            let name = scoping.symbol_name(symbol);
            let scope = scope_of(symbol);
            let local = local_id(index);
            locals[symbol.index()] = local;
            if scope_names.insert((scope.as_ref().map(|scope| scope.ordinal), name), local).is_some() {
                panic!("{}: two bindings named '{name}' in one scope", module.path());
            }
            let import = scope.is_none().then(|| imports.get(name)).flatten();
            let kind = import.map_or(BindingKind::Declared, |import| BindingKind::Import(import.clone()));
            let span = scoping.symbol_span(symbol);
            let value = runtime_value(scoping, symbol);
            bindings.push(Binding { name: name.to_string(), span: (span.start, span.end), scope, kind, value });
        }
        let module_names: FxHashMap<String, LocalId> = scope_names
            .into_iter()
            .filter(|((scope, _), _)| scope.is_none())
            .map(|((_, name), local)| (name.to_string(), local))
            .collect();

        let default_export = default_export(program, &module_names, &mut bindings);

        let mut references: Vec<((u32, u32), Identity)> = walk
            .references
            .into_iter()
            .map(|(span, read)| {
                let identity = match read {
                    Read::Global(name) => Identity::Global { realm: Realm::Shared, name },
                    Read::Binding(symbol) => {
                        let local = locals[symbol.index()];
                        match &bindings[local.0 as usize].scope {
                            None => Identity::Module(BindingId { module: module.clone(), local }),
                            Some(scope) => Identity::Nested { scope: scope.clone(), local },
                        }
                    }
                };
                (span, identity)
            })
            .collect();
        references.sort_by_key(|(span, _)| *span);
        if let Some(pair) = references.windows(2).find(|pair| pair[0].0 == pair[1].0) {
            panic!("{}: two references at {:?}", module.path(), pair[0].0);
        }

        Self { module, bindings, module_names, imports, references, default_export }
    }

    pub fn binding(&self, local: LocalId) -> &Binding {
        &self.bindings[local.0 as usize]
    }

    /// The binding whose value `local` holds: for `export default X`'s
    /// cell, X, whose object the cell shares; otherwise `local` itself.
    pub fn held(&self, local: LocalId) -> LocalId {
        match self.default_export {
            Some(DefaultExport::Snapshot { cell, of: Some(of) }) if cell == local => of,
            _ => local,
        }
    }

    /// The module-scope binding `name` declares, if any.
    pub fn module_binding(&self, name: &str) -> Option<LocalId> {
        self.module_names.get(name).copied()
    }

    /// The import that declares the module-scope `name`, if one does.
    pub fn module_import(&self, name: &str) -> Option<&ImportBinding> {
        self.imports.get(name)
    }

    /// The identity of the identifier reference at `span`.
    pub fn reference(&self, span: (u32, u32)) -> Option<&Identity> {
        self.references
            .binary_search_by_key(&span, |(at, _)| *at)
            .ok()
            .map(|index| &self.references[index].1)
    }
}

fn local_id(index: usize) -> LocalId {
    LocalId(u32::try_from(index).expect("fewer than 2^32 bindings in one module"))
}

/// What an identifier reference reads, by the build's numbering.
enum Read {
    Binding(SymbolId),
    Global(String),
}

/// Records each scope in the order the source opens it, and each identifier
/// reference with what the build resolved it to.
struct SourceWalk<'s> {
    scoping: &'s Scoping,
    module: &'s ModuleId,
    scopes: FxHashMap<ParserScopeId, u32>,
    references: Vec<((u32, u32), Read)>,
}

impl<'a> Visit<'a> for SourceWalk<'_> {
    fn enter_scope(&mut self, _flags: ScopeFlags, scope_id: &Cell<Option<ParserScopeId>>) {
        if let Some(scope) = scope_id.get() {
            let next = u32::try_from(self.scopes.len()).expect("fewer than 2^32 scopes in one module");
            self.scopes.entry(scope).or_insert(next);
        }
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        let span = (ident.span.start, ident.span.end);
        let reference = ident.reference_id.get().unwrap_or_else(|| {
            panic!("{}: the reference at {span:?} was never numbered", self.module.path());
        });
        let read = match self.scoping.get_reference(reference).symbol_id() {
            Some(symbol) if self.scoping.symbol_name(symbol) == ident.name.as_str() => Read::Binding(symbol),
            Some(_) => panic!("{}: the reference at {span:?} holds another build's numbering", self.module.path()),
            None => Read::Global(ident.name.to_string()),
        };
        self.references.push((span, read));
    }
}

/// The module's default export, adding the synthetic cell one needs.
fn default_export(
    program: &Program<'_>,
    module_names: &FxHashMap<String, LocalId>,
    bindings: &mut Vec<Binding>,
) -> Option<DefaultExport> {
    let mut synthetic = |span: oxc::span::Span| {
        let local = local_id(bindings.len());
        bindings.push(Binding {
            name: "default".to_string(),
            span: (span.start, span.end),
            scope: None,
            kind: BindingKind::DefaultCell,
            value: true,
        });
        local
    };
    for statement in &program.body {
        let Some(declaration) = statement.as_module_declaration() else { continue };
        match declaration {
            ModuleDeclaration::ExportDefaultDeclaration(export) => {
                let id = match &export.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => function.id.as_ref(),
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => class.id.as_ref(),
                    // An interface is a type: no runtime default.
                    ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => return None,
                    _ => {
                        let named = export.declaration.as_expression().and_then(|expression| {
                            match crate::chain_walk::unwrap_type_assertions(expression) {
                                oxc::ast::ast::Expression::Identifier(id) => module_names.get(id.name.as_str()).copied(),
                                _ => None,
                            }
                        });
                        return Some(DefaultExport::Snapshot { cell: synthetic(export.span), of: named });
                    }
                };
                let named = id.and_then(|id| module_names.get(id.name.as_str()).copied());
                return Some(DefaultExport::Declaration(named.unwrap_or_else(|| synthetic(export.span))));
            }
            ModuleDeclaration::ExportNamedDeclaration(export) if !export.export_kind.is_type() => {
                let alias = export.specifiers.iter().find(|specifier| {
                    !specifier.export_kind.is_type() && specifier.exported.name() == "default"
                });
                if let Some(local) = alias.and_then(|specifier| module_names.get(specifier.local.name().as_str())) {
                    return Some(DefaultExport::Alias(*local));
                }
            }
            _ => {}
        }
    }
    None
}

/// Whether `symbol` is a runtime value: a symbol's flags union its merged
/// declarations, and it is one when any one of them is a runtime value
/// declaration rather than an ambient one.
pub(crate) fn runtime_value(scoping: &Scoping, symbol: SymbolId) -> bool {
    let runtime = |flags: oxc::semantic::SymbolFlags| flags.is_value() && !flags.is_ambient();
    runtime(scoping.symbol_flags(symbol)) || scoping.symbol_redeclarations(symbol).iter().any(|declaration| runtime(declaration.flags))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owned_ast::{OwnedAst, ParseCounter};

    fn table_of(path: &str, source: &str) -> Arc<BindingTable> {
        let ast = OwnedAst::parse(path.into(), source.into(), &ParseCounter::new(0));
        crate::facts::extract_file_facts(&ast).bindings
    }

    /// The identity of each reference spelled `name`, in source order.
    fn references(table: &BindingTable, source: &str, name: &str) -> Vec<Identity> {
        source
            .match_indices(name)
            .filter_map(|(start, _)| table.reference((start as u32, (start + name.len()) as u32)).cloned())
            .collect()
    }

    fn module(table: &BindingTable, name: &str) -> Identity {
        let local = table.module_binding(name).expect("a module-scope binding");
        Identity::Module(BindingId { module: table.module.clone(), local })
    }

    #[test]
    fn a_reference_is_exactly_one_of_module_nested_or_global_and_no_nested_binding_reads_as_a_module_name() {
        let source = "import React from 'react';
import { a as b } from './m';
const x = 0;
function one() { const x = 1; return x; }
function two(x) { return x; }
function three(Object, React) { return [Object, React]; }
export const uses = [x, b, Object, React];
";
        let table = table_of("a.tsx", source);

        let [Identity::Nested { scope: first_scope, local: first }, Identity::Nested { scope: second_scope, local: second }, top]: [Identity; 3] =
            references(&table, source, "x").try_into().expect("three references to x")
        else {
            panic!("the two inner references to x are nested");
        };
        assert_ne!((first_scope, first), (second_scope, second));
        assert_eq!(top, module(&table, "x"));
        assert!(![first, second].contains(&table.module_binding("x").unwrap()));

        let [shadowed, global]: [Identity; 2] = references(&table, source, "Object").try_into().expect("two references to Object");
        assert!(matches!(shadowed, Identity::Nested { .. }));
        assert_eq!(global, Identity::Global { realm: Realm::Shared, name: "Object".into() });

        let [shadowed, imported]: [Identity; 2] = references(&table, source, "React").try_into().expect("two references to React");
        assert!(matches!(shadowed, Identity::Nested { .. }));
        assert_eq!(imported, module(&table, "React"));
        assert_eq!(table.module_import("React"), Some(&ImportBinding::Default { specifier: "react".into() }));

        assert_eq!(references(&table, source, "b"), [module(&table, "b")]);
        assert_eq!(
            table.module_import("b"),
            Some(&ImportBinding::Named { specifier: "./m".into(), imported: "a".into() })
        );

        // Two modules each number their first binding 0, and stay apart.
        let snapshot = table_of("b.ts", "let y = 1; export default y;");
        let alias = table_of("c.ts", "let y = 1; export { y as default };");
        assert_eq!((snapshot.module_binding("y"), alias.module_binding("y")), (Some(LocalId(0)), Some(LocalId(0))));
        assert_ne!(module(&snapshot, "y"), module(&alias, "y"));

        // `export default y` holds y's value then; `export { y as default }` is y.
        let Some(DefaultExport::Snapshot { cell, of }) = snapshot.default_export else {
            panic!("a default expression is a snapshot: {:?}", snapshot.default_export);
        };
        assert_ne!(cell, LocalId(0));
        assert_eq!(of, Some(LocalId(0)));
        assert_eq!(snapshot.binding(cell).kind, BindingKind::DefaultCell);
        assert_eq!(alias.default_export, Some(DefaultExport::Alias(LocalId(0))));
    }
}
