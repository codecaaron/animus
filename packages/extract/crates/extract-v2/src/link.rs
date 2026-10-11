//! Which binding an export of an analysed module names: each module's owned
//! record of its runtime imports and exports, linked across the analysed
//! set by the shared ECMA-262 table.

use std::collections::BTreeMap;

use animus_system_loader::module_table::{
    ExportLookup, Import, ImportName, ModuleIndex, ModuleRecord, ModuleTable, Request, RequestId, Terminal,
};
use oxc::ast::ast::{Program, Statement};
use oxc::syntax::module_record::{
    ExportEntry, ExportExportName, ExportImportName, ExportLocalName, ImportImportName, ModuleRecord as ParsedRecord,
};

use crate::analyze_css::{expand_alias, resolve_import_source, CssInputs};
use crate::facts::FileFacts;
use crate::identity::{BindingKind, BindingTable, IdentityInput, LocalId, ModuleId};
use oxc::semantic::{Scoping, SemanticBuilder};
use rustc_hash::FxHashSet;

/// A module's record with its requests as written.
pub type OwnedModuleRecord = ModuleRecord<LocalId, String>;

/// One file's Lower output: its identity table, owned module record,
/// module loads, parameter readings and how it runs code from a string, and
/// the semantic build all but the loads were read from, which fact
/// extraction reuses rather than building again.
pub(crate) struct Lowered {
    pub(crate) scoping: Scoping,
    pub(crate) bindings: std::sync::Arc<BindingTable>,
    pub(crate) record: std::sync::Arc<OwnedModuleRecord>,
    pub(crate) loads: Vec<crate::loads::Load>,
    /// How each of the module's functions treats an object passed to it.
    pub(crate) readings: crate::usage_facts::ParamReadings,
    /// How the module runs code from a string, if it does.
    pub(crate) dynamic_code: Option<&'static str>,
}

impl Lowered {
    pub(crate) fn of(ast: &crate::owned_ast::OwnedAst) -> Self {
        Self::from_parts(ModuleId::new(&ast.path), ast.program(), ast.module_record())
    }

    /// Lowers `program` with one semantic build. The table is read straight
    /// after it, while the program's reference cells hold its numbering.
    pub(crate) fn from_parts(module: ModuleId, program: &Program<'_>, module_record: &ParsedRecord<'_>) -> Self {
        let scoping = SemanticBuilder::new().build(program).semantic.into_scoping();
        let bindings = BindingTable::prepare(IdentityInput { module, program, module_record, scoping: &scoping });
        let record = copy_module_record(module_record, &bindings, program.source_text, program);
        let readings = std::sync::Arc::new(crate::usage_facts::function_param_readings(program, &scoping));
        let dynamic_code = crate::usage_facts::dynamic_code(program, &scoping);
        Self {
            scoping,
            bindings: std::sync::Arc::new(bindings),
            record: std::sync::Arc::new(record),
            loads: crate::loads::collect(program),
            readings,
            dynamic_code,
        }
    }
}

/// Copies the parser's record of `module`, whose text is `source`, leaving
/// out type-only entries. Bindings are the table's; an entry whose binding a
/// failed parse never declared is left out.
pub(crate) fn copy_module_record(
    parsed: &ParsedRecord<'_>,
    bindings: &BindingTable,
    source: &str,
    program: &Program<'_>,
) -> OwnedModuleRecord {
    let mut record = OwnedModuleRecord {
        requests: Vec::new(),
        imports: Vec::new(),
        local_exports: Vec::new(),
        indirect_exports: Vec::new(),
        namespace_exports: Vec::new(),
        star_exports: Vec::new(),
        default_cells: bindings
            .bindings
            .iter()
            .enumerate()
            .filter(|(_, binding)| binding.kind == BindingKind::DefaultCell)
            .map(|(index, _)| LocalId(u32::try_from(index).expect("fewer than 2^32 bindings in one module")))
            .collect(),
    };
    for entry in parsed.import_entries.iter().filter(|entry| !entry.is_type) {
        let Some(local) = bindings.module_binding(entry.local_name.name.as_str()) else { continue };
        let name = match &entry.import_name {
            ImportImportName::Name(name) => ImportName::Name(name.name.to_string()),
            ImportImportName::Default(_) => ImportName::Name("default".to_string()),
            ImportImportName::NamespaceObject => ImportName::Namespace,
        };
        let request = intern(&mut record.requests, entry.module_request.name.as_str());
        record.imports.push(Import { local, request, name });
    }
    let namespace_import = |local: &str| {
        let local = bindings.module_binding(local)?;
        record.imports.iter().find(|import| import.local == local && import.name == ImportName::Namespace)
    };

    for entry in parsed.local_export_entries.iter().filter(|entry| !entry.is_type) {
        let Some(exported) = export_name(&entry.export_name) else { continue };
        match &entry.local_name {
            ExportLocalName::Name(local) => {
                // `export { ns }` of `import * as ns` re-exports a namespace.
                if let Some(import) = namespace_import(local.name.as_str()) {
                    record.namespace_exports.push((exported, import.request));
                } else if let Some(binding) = bindings.module_binding(local.name.as_str()) {
                    // A declared type exports nothing at runtime.
                    let declared = bindings.binding(binding);
                    if declared.value || declared.kind != BindingKind::Declared {
                        record.local_exports.push((exported, binding));
                    }
                }
            }
            // `export default` of an expression, or of an anonymous function
            // or class, exports the module's default cell.
            ExportLocalName::Default(_) | ExportLocalName::Null if exported == "default" => {
                if let Some(&cell) = record.default_cells.first() {
                    record.local_exports.push((exported, cell));
                }
            }
            ExportLocalName::Default(_) | ExportLocalName::Null => {}
        }
    }

    // The parser marks an exported import with the import's type-only flag,
    // not the export's: `import { d } …; export { type d }` and
    // `export type { d }` are type-only exports all the same.
    let type_only = type_only_export_specifiers(program);
    let exported_as_type = |entry: &ExportEntry<'_>| type_only.contains(&(entry.span.start, entry.span.end));
    for entry in parsed.indirect_export_entries.iter().filter(|entry| !entry.is_type && !exported_as_type(entry)) {
        let (Some(exported), Some(specifier)) = (export_name(&entry.export_name), &entry.module_request) else {
            continue;
        };
        let request = intern(&mut record.requests, specifier.name.as_str());
        match &entry.import_name {
            ExportImportName::Name(name) => {
                let imported = reexported_import(parsed, entry, source).unwrap_or_else(|| name.name.to_string());
                record.indirect_exports.push((exported, request, imported));
            }
            ExportImportName::All => record.namespace_exports.push((exported, request)),
            ExportImportName::AllButDefault | ExportImportName::Null => {}
        }
    }

    for entry in parsed.star_export_entries.iter().filter(|entry| !entry.is_type) {
        if let Some(specifier) = &entry.module_request {
            let request = intern(&mut record.requests, specifier.name.as_str());
            record.star_exports.push(request);
        }
    }
    record
}

/// The name an `export { x }` of an imported binding `x` re-exports, as
/// ECMA's ParseModule reads it: the import's own name, `default` for a
/// default import. The parser turns such an export into an indirect one
/// carrying the import's statement span and, for a default import, its
/// local name, so the export's own local name is read from the export
/// specifier's span and matched to the import that declares it. `None` for
/// an indirect export written with `from`.
fn reexported_import(parsed: &ParsedRecord<'_>, entry: &ExportEntry<'_>, source: &str) -> Option<String> {
    if !parsed.import_entries.iter().any(|import| import.statement_span == entry.statement_span) {
        return None;
    }
    let text = source.get(entry.span.start as usize..entry.span.end as usize)?.trim_start();
    let end = text.find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$')).unwrap_or(text.len());
    let local = &text[..end];
    let import = parsed.import_entries.iter().find(|import| import.local_name.name == local)?;
    match &import.import_name {
        ImportImportName::Name(name) => Some(name.name.to_string()),
        ImportImportName::Default(_) => Some("default".to_string()),
        ImportImportName::NamespaceObject => None,
    }
}

/// The spans of the export specifiers a local `export { … }` declares
/// type-only: every specifier of `export type { … }`, and each `type x`.
fn type_only_export_specifiers(program: &Program<'_>) -> FxHashSet<(u32, u32)> {
    let mut spans = FxHashSet::default();
    for statement in &program.body {
        let Statement::ExportNamedDeclaration(export) = statement else { continue };
        if export.source.is_some() {
            continue;
        }
        for specifier in &export.specifiers {
            if export.export_kind.is_type() || specifier.export_kind.is_type() {
                spans.insert((specifier.span.start, specifier.span.end));
            }
        }
    }
    spans
}

/// The position of `specifier` in `requests`, added when new.
fn intern(requests: &mut Vec<String>, specifier: &str) -> RequestId {
    requests.iter().position(|known| known == specifier).unwrap_or_else(|| {
        requests.push(specifier.to_string());
        requests.len() - 1
    })
}

fn export_name(name: &ExportExportName<'_>) -> Option<String> {
    match name {
        ExportExportName::Name(name) => Some(name.name.to_string()),
        ExportExportName::Default(_) => Some("default".to_string()),
        ExportExportName::Null => None,
    }
}

/// Every analysed module's record, linked: modules in path order, each
/// request resolved as the analysis resolves specifiers.
pub struct ProjectLinks {
    pub table: ModuleTable<LocalId>,
    pub paths: Vec<String>,
    index: BTreeMap<String, ModuleIndex>,
}

impl ProjectLinks {
    pub fn link(files: &BTreeMap<String, FileFacts>, inputs: &CssInputs) -> Self {
        Self::of_records(files, |ff| &ff.module_record, inputs)
    }

    /// The links of each file's record, `record` reading it from the file's
    /// entry.
    pub(crate) fn of_records<T>(
        files: &BTreeMap<String, T>,
        record: impl Fn(&T) -> &OwnedModuleRecord,
        inputs: &CssInputs,
    ) -> Self {
        let paths: Vec<String> = files.keys().cloned().collect();
        let index: BTreeMap<String, ModuleIndex> =
            paths.iter().enumerate().map(|(position, path)| (path.clone(), position)).collect();
        let records = files
            .iter()
            .map(|(path, file)| {
                record(file).resolved(|specifier| {
                    match resolve_import_source(path, specifier, files, inputs) {
                        Some(target) => match index.get(&target) {
                            Some(&module) => Request::Module(module),
                            // A package entry the analysis does not hold.
                            None => Request::Outside(target),
                        },
                        // A path, written or through an alias, that names no
                        // file the analysis holds resolved to nothing.
                        None if specifier.starts_with('.') || expand_alias(specifier, &inputs.path_aliases).is_some() => {
                            Request::Unresolved(format!("{path}::{specifier}"))
                        }
                        // A package the analysis does not hold.
                        None => Request::Outside(specifier.clone()),
                    }
                })
            })
            .collect();
        Self { table: ModuleTable::new(records), paths, index }
    }

    pub fn module(&self, path: &str) -> Option<ModuleIndex> {
        self.index.get(path).copied()
    }

    /// ResolveExport for export `name` of the module at `path`.
    pub fn resolve_export(&self, path: &str, name: &str) -> Option<ExportLookup<LocalId>> {
        Some(self.table.resolve_export(self.module(path)?, name))
    }

    /// The declaring module and binding export `name` of the module at
    /// `path` resolves to. `None` for any other answer: absent, ambiguous,
    /// open, a namespace, an export of a module outside the analysis, or a
    /// module the analysis does not hold.
    pub fn declared(&self, path: &str, name: &str) -> Option<(ModuleIndex, LocalId)> {
        match self.resolve_export(path, name)? {
            ExportLookup::Resolved(Terminal::Local { module, binding }) => Some((module, binding)),
            _ => None,
        }
    }

    /// The names `module` exports its binding `binding` as.
    pub fn exported_as(&self, module: ModuleIndex, binding: LocalId) -> impl Iterator<Item = &str> + '_ {
        let exports = &self.table.record(module).local_exports;
        exports.iter().filter(move |(_, exported)| *exported == binding).map(|(name, _)| name.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owned_ast::{OwnedAst, ParseCounter};
    use animus_system_loader::module_table::{NamespaceThen, OpeningReason, Terminal, LINK_ABSENT_IMPORT, LINK_AMBIGUOUS_IMPORT};

    fn link(sources: &[(&str, &str)]) -> (ProjectLinks, BTreeMap<String, FileFacts>) {
        let counter = ParseCounter::new(0);
        let files: BTreeMap<String, FileFacts> = sources
            .iter()
            .map(|(path, source)| {
                let ast = OwnedAst::parse(path.to_string(), source.to_string(), &counter);
                (path.to_string(), crate::facts::extract_file_facts(&ast))
            })
            .collect();
        (ProjectLinks::link(&files, &CssInputs::default()), files)
    }

    #[test]
    fn resolve_export_matches_ecma_262_on_the_witness_forms() {
        let (links, files) = link(&[
            ("leaf.js", "export let x = 1; export function change() { x = 2; } export { x as alias };"),
            ("left.js", "export { x } from './leaf.js';"),
            ("right.js", "export { alias as x } from './leaf.js';"),
            ("diamond.js", "export * from './left.js'; export * from './right.js';"),
            ("one.js", "export const y = 1;"),
            ("two.js", "export const y = 2;"),
            ("both.js", "export * from './one.js'; export * from './two.js';"),
            ("importer.js", "import { y } from './both.js'; import { nope } from './leaf.js'; export { y as z } from './both.js';"),
            ("cycle.js", "export * from './back.js'; export * from './leaf.js';"),
            ("back.js", "export * from './cycle.js';"),
            ("star-ns.js", "export * as ns from './leaf.js';"),
            ("import-ns.js", "import * as ns from './leaf.js'; export { ns };"),
            ("alias.js", "let x = 1; export { x as default };"),
            ("snapshot.js", "let x = 1; export default x;"),
            ("through.js", "export * from './alias.js';"),
            ("default-import.js", "import d from './snapshot.js'; export { d };"),
            ("types.ts", "export type T = 1; export interface I {} export const v = 1; export type { v as w };"),
            ("open.js", "export * from 'react'; export * from './leaf.js';"),
            ("expression.js", "export default { a: 1 };"),
            ("anonymous.js", "export default function () {}"),
            ("reexport-default.js", "export { default } from './expression.js';"),
            ("named.js", "export default 'default'; export const d = 'named';"),
            ("collision.js", "import d, { d as x } from './named.js'; export { x };"),
            ("dangling.js", "export { y } from './missing.js'; export * from './gone.js';"),
            ("thenable.js", "export const then = () => {};"),
            ("namespaces.ts", "export namespace Types { export type X = 1; } export namespace Values { export const v = 1; } type T = 1; export { T };"),
            ("typed-reexports.ts", "import { v } from './types';\nexport { type v as tv };\nexport type { v as tv2 };\nexport { v as rv };"),
            (
                "ambient.ts",
                "declare const q: number;\ndeclare function g(): void;\ndeclare class C {}\ndeclare enum E { A }\ndeclare namespace D { export const d: number; }\nexport { q, g, C, E, D };\nexport const real = 1;",
            ),
            (
                "merged.ts",
                "function f() {}\ndeclare namespace f { export type T = 1; }\ndeclare namespace N { export function fn(): void; }\nnamespace N { export const v = 1; }\nexport { f, N };",
            ),
        ]);
        let module = |path: &str| links.module(path).unwrap();
        let local = |path: &str, name: &str| Terminal::Local {
            module: module(path),
            binding: files[path].bindings.module_binding(name).unwrap(),
        };
        let resolve = |path: &str, name: &str| links.resolve_export(path, name).unwrap();

        // Two routes to one binding, under two export names, are one terminal.
        assert_eq!(resolve("diamond.js", "x"), ExportLookup::Resolved(local("leaf.js", "x")));
        // Two stars bring in distinct bindings: ambiguous, so not a member.
        assert!(matches!(resolve("both.js", "y"), ExportLookup::Ambiguous(terminals) if terminals.len() == 2));
        let (members, _) = links.table.namespace_members(module("both.js"));
        assert!(members.is_empty());
        let codes: Vec<(&str, String)> =
            links.table.link_errors(module("importer.js")).into_iter().map(|error| (error.code, error.name)).collect();
        assert_eq!(
            codes,
            [(LINK_AMBIGUOUS_IMPORT, "y".to_string()), (LINK_ABSENT_IMPORT, "nope".to_string()), (LINK_AMBIGUOUS_IMPORT, "y".to_string())]
        );
        // A cycle resolves to null on its own branch; the other star resolves.
        assert_eq!(resolve("cycle.js", "x"), ExportLookup::Resolved(local("leaf.js", "x")));
        // Namespaces.
        assert_eq!(resolve("star-ns.js", "ns"), ExportLookup::Resolved(Terminal::Namespace(module("leaf.js"))));
        assert_eq!(resolve("import-ns.js", "ns"), ExportLookup::Resolved(Terminal::Namespace(module("leaf.js"))));
        // `export { x as default }` is x; `export default x` is its own cell;
        // `default` never comes through a star.
        assert_eq!(resolve("alias.js", "default"), ExportLookup::Resolved(local("alias.js", "x")));
        let ExportLookup::Resolved(Terminal::Local { binding: cell, .. }) = resolve("snapshot.js", "default") else {
            panic!("a default expression resolves to a local cell");
        };
        assert_ne!(cell, files["snapshot.js"].bindings.module_binding("x").unwrap());
        assert_eq!(resolve("through.js", "default"), ExportLookup::Absent);
        assert_eq!(resolve("default-import.js", "d"), resolve("snapshot.js", "default"));
        // Type-only declarations export nothing at runtime.
        assert_eq!(resolve("types.ts", "T"), ExportLookup::Absent);
        assert_eq!(resolve("types.ts", "I"), ExportLookup::Absent);
        assert_eq!(resolve("types.ts", "w"), ExportLookup::Absent);
        assert_eq!(links.table.exported_names(module("types.ts")).names, ["v"]);
        assert_eq!(links.table.exported_names(module("namespaces.ts")).names, ["Values"]);
        // An imported binding exported as a type, either way, exports
        // nothing at runtime; nor does an ambient declaration.
        assert_eq!(links.table.exported_names(module("typed-reexports.ts")).names, ["rv"]);
        assert_eq!(resolve("typed-reexports.ts", "rv"), ExportLookup::Resolved(local("types.ts", "v")));
        assert_eq!(links.table.exported_names(module("ambient.ts")).names, ["real"]);
        // A runtime declaration merged with an ambient one is a value.
        assert_eq!(links.table.exported_names(module("merged.ts")).names, ["f", "N"]);
        // A star of an unanalysed module is open, never absent.
        let ExportLookup::Incomplete { known, openings } = resolve("open.js", "x") else {
            panic!("an open star leaves the answer open");
        };
        assert_eq!(known, [local("leaf.js", "x")]);
        assert_eq!(openings[0].reason, OpeningReason::OutsideStar("react".into()));
        assert!(matches!(links.table.namespace_has_then(module("open.js")), NamespaceThen::Incomplete(_)));
        assert_eq!(links.table.namespace_has_then(module("leaf.js")), NamespaceThen::Absent);
        assert_eq!(links.table.namespace_has_then(module("thenable.js")), NamespaceThen::Present(local("thenable.js", "then")));
        // A default expression and an anonymous default declaration export
        // the module's default cell, and `export { default } from` reaches it.
        for path in ["expression.js", "anonymous.js"] {
            let ExportLookup::Resolved(Terminal::Local { binding, .. }) = resolve(path, "default") else {
                panic!("{path} exports a default");
            };
            assert_eq!(files[path].bindings.binding(binding).kind, BindingKind::DefaultCell);
        }
        assert_eq!(resolve("reexport-default.js", "default"), resolve("expression.js", "default"));
        // `export { x }` of `{ d as x }` re-exports `d`, beside a default import named d.
        assert_eq!(resolve("collision.js", "x"), ExportLookup::Resolved(local("named.js", "d")));
        // A request that resolves to nothing leaves the answer open, never absent.
        for name in ["y", "z"] {
            let ExportLookup::Incomplete { known, openings } = resolve("dangling.js", name) else {
                panic!("an unresolved request leaves {name} open");
            };
            assert!(known.is_empty());
            assert!(matches!(&openings[0].reason, OpeningReason::UnresolvedRequest(_)));
        }
    }
}
