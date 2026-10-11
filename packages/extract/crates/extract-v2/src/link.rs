//! Which binding an export of an analysed module names: each module's owned
//! record of its runtime imports and exports, linked across the analysed
//! set by the shared ECMA-262 table.

use std::collections::BTreeMap;

use animus_system_loader::module_table::{
    ExportLookup, Import, ImportName, ModuleIndex, ModuleRecord, ModuleTable, Request, RequestId,
};
use oxc::syntax::module_record::{
    ExportExportName, ExportImportName, ExportLocalName, ImportImportName, ModuleRecord as ParsedRecord,
};

use crate::analyze_css::{resolve_import_source, CssInputs};
use crate::facts::FileFacts;
use crate::identity::{BindingTable, DefaultExport, LocalId};

/// A module's record with its requests as written.
pub type OwnedModuleRecord = ModuleRecord<LocalId, String>;

/// Copies the parser's record of `module`, leaving out type-only entries.
/// Bindings are the table's; an entry whose binding a failed parse never
/// declared is left out.
pub(crate) fn copy_module_record(parsed: &ParsedRecord<'_>, bindings: &BindingTable) -> OwnedModuleRecord {
    let mut record = OwnedModuleRecord {
        requests: Vec::new(),
        imports: Vec::new(),
        local_exports: Vec::new(),
        indirect_exports: Vec::new(),
        namespace_exports: Vec::new(),
        star_exports: Vec::new(),
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
                    record.local_exports.push((exported, binding));
                }
            }
            ExportLocalName::Default(_) => {
                if let Some(DefaultExport::Snapshot(cell) | DefaultExport::Declaration(cell)) = bindings.default_export {
                    record.local_exports.push((exported, cell));
                }
            }
            ExportLocalName::Null => {}
        }
    }

    for entry in parsed.indirect_export_entries.iter().filter(|entry| !entry.is_type) {
        let (Some(exported), Some(specifier)) = (export_name(&entry.export_name), &entry.module_request) else {
            continue;
        };
        let request = intern(&mut record.requests, specifier.name.as_str());
        match &entry.import_name {
            ExportImportName::Name(name) => {
                // The parser names an exported default import by its local
                // name; ECMA reads `default` there.
                let from_default_import = parsed.import_entries.iter().any(|import| {
                    import.statement_span == entry.statement_span
                        && import.local_name.name == name.name
                        && matches!(import.import_name, ImportImportName::Default(_))
                });
                let imported = if from_default_import { "default".to_string() } else { name.name.to_string() };
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
        let paths: Vec<String> = files.keys().cloned().collect();
        let index: BTreeMap<String, ModuleIndex> =
            paths.iter().enumerate().map(|(position, path)| (path.clone(), position)).collect();
        let records = files
            .iter()
            .map(|(path, ff)| {
                ff.module_record.resolved(|specifier| {
                    match resolve_import_source(path, specifier, files, inputs) {
                        Some(target) => match index.get(&target) {
                            Some(&module) => Request::Module(module),
                            // A package entry the analysis does not hold.
                            None => Request::Outside(target),
                        },
                        None if specifier.starts_with('.') => Request::Outside(format!("{path}::{specifier}")),
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
        // A star of an unanalysed module is open, never absent.
        let ExportLookup::Incomplete { known, openings } = resolve("open.js", "x") else {
            panic!("an open star leaves the answer open");
        };
        assert_eq!(known, [local("leaf.js", "x")]);
        assert_eq!(openings[0].reason, OpeningReason::OutsideStar("react".into()));
        assert!(matches!(links.table.namespace_has_then(module("open.js")), NamespaceThen::Incomplete(_)));
        assert_eq!(links.table.namespace_has_then(module("leaf.js")), NamespaceThen::Absent);
    }
}
