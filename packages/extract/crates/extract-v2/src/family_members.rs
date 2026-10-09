//! Compose family member tags (`<Card.Body>`) resolved through the
//! consuming file's own bindings: the families it declares, the names it
//! imports (aliased, default or through re-exports and barrels) and its
//! namespace imports. Two families that share a name in different modules
//! stay apart.

use std::collections::{BTreeMap, BTreeSet};

use rustc_hash::{FxHashMap, FxHashSet};

use crate::analyze_css::{resolve_import_source, CssInputs};
use crate::facts::FileFacts;

/// Every compose family, keyed by the names its module gives it.
pub(crate) struct FamilyIndex {
    /// (module, local binding) → position in `members`, for the module's own
    /// member tags.
    locals: FxHashMap<(String, String), usize>,
    /// (module, exported name) → position in `members`, for importers; an
    /// export alias never renames the family inside its own module.
    exports: FxHashMap<(String, String), usize>,
    /// Binding name → the only family with it, or `None` when several share
    /// it. Imports the analysis cannot resolve fall back to it.
    by_binding: FxHashMap<String, Option<usize>>,
    /// Per family, each slot name with the component it renders.
    members: Vec<Vec<(String, String)>>,
}

impl FamilyIndex {
    /// `slot_component` names the component a slot binding renders, read in
    /// the module that composed the family.
    pub(crate) fn build(
        files: &BTreeMap<String, FileFacts>,
        mut slot_component: impl FnMut(&str, &str) -> String,
    ) -> Self {
        let mut index = Self {
            locals: FxHashMap::default(),
            exports: FxHashMap::default(),
            by_binding: FxHashMap::default(),
            members: Vec::new(),
        };
        for (file, ff) in files {
            for family in &ff.compose {
                let id = index.members.len();
                index.members.push(
                    family
                        .slots
                        .iter()
                        .map(|(slot, binding)| (slot.clone(), slot_component(file, binding)))
                        .collect(),
                );
                if let Some(binding) = &family.family_binding {
                    index.locals.insert((file.clone(), binding.clone()), id);
                    index
                        .by_binding
                        .entry(binding.clone())
                        .and_modify(|only| *only = None)
                        .or_insert(Some(id));
                }
                if family.default_export {
                    index
                        .exports
                        .insert((file.clone(), "default".to_string()), id);
                }
            }
            for export in &ff.exports {
                let (None, Some(local)) = (&export.source, &export.local) else {
                    continue;
                };
                if let Some(&id) = index.locals.get(&(file.clone(), local.clone())) {
                    index
                        .exports
                        .insert((file.clone(), export.exported.clone()), id);
                }
            }
        }
        index
    }

    /// The member tags `file` can write, as written there (`Panel.Body`,
    /// `ui.Card.Body`), each mapped to the component its slot renders.
    pub(crate) fn members_for(
        &self,
        file: &str,
        ff: &FileFacts,
        files: &BTreeMap<String, FileFacts>,
        inputs: &CssInputs,
    ) -> FxHashMap<String, String> {
        let mut members = FxHashMap::default();
        let mut add = |prefix: &str, id: usize| {
            for (slot, component) in &self.members[id] {
                members.insert(format!("{prefix}.{slot}"), component.clone());
            }
        };
        for binding in ff.compose.iter().filter_map(|f| f.family_binding.as_ref()) {
            if let Some(&id) = self.locals.get(&(file.to_string(), binding.clone())) {
                add(binding, id);
            }
        }
        for import in &ff.imports {
            let id = match resolve_import_source(file, &import.source, files, inputs) {
                Some(module) => self.exported(module, import.imported.clone(), files, inputs),
                // A default import is named by its local binding.
                None if import.imported == "default" => self.only(&import.local),
                None => self.only(&import.imported),
            };
            if let Some(id) = id {
                add(&import.local, id);
            }
        }
        for (namespace, source) in &ff.namespace_imports {
            let Some(module) = resolve_import_source(file, source, files, inputs) else {
                for (binding, id) in &self.by_binding {
                    if let Some(id) = id {
                        add(&format!("{namespace}.{binding}"), *id);
                    }
                }
                continue;
            };
            for name in module_export_names(&module, files, inputs) {
                if let Some(id) = self.exported(module.clone(), name.clone(), files, inputs) {
                    add(&format!("{namespace}.{name}"), id);
                }
            }
        }
        members
    }

    /// The family `module` exports as `name`, following re-exports and
    /// barrels.
    fn exported(
        &self,
        module: String,
        name: String,
        files: &BTreeMap<String, FileFacts>,
        inputs: &CssInputs,
    ) -> Option<usize> {
        let key = follow_exports(module, name, files, inputs)?;
        self.exports.get(&key).copied()
    }

    /// The only family bound to `binding` anywhere in the analysis.
    fn only(&self, binding: &str) -> Option<usize> {
        self.by_binding.get(binding).copied().flatten()
    }
}

/// The module that declares the name `module` exports as `name`, and the
/// name it declares there: `export { X as Y } from '…'`, `export * from '…'`
/// (every source is tried, in order), and an imported name exported again
/// (`import { X } from '…'; export { X }` or `export default X`). `None` when
/// no route reaches a declaration.
pub(crate) fn follow_exports(
    module: String,
    name: String,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> Option<(String, String)> {
    resolve_export(module, name, files, inputs, &mut FxHashSet::default())
}

fn resolve_export(
    file: String,
    name: String,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    visited: &mut FxHashSet<(String, String)>,
) -> Option<(String, String)> {
    if !visited.insert((file.clone(), name.clone())) {
        return None;
    }
    let ff = files.get(&file)?;
    // An imported name exported again leads on to its module.
    let reexported_import = |local: &str, visited: &mut FxHashSet<(String, String)>| {
        let import = ff.imports.iter().find(|import| import.local == local)?;
        let next = resolve_import_source(&file, &import.source, files, inputs)?;
        resolve_export(next, import.imported.clone(), files, inputs, visited)
    };
    if let Some(export) = ff.exports.iter().find(|e| e.exported == name) {
        return match (&export.source, &export.original, &export.local) {
            (Some(spec), Some(original), _) => {
                let next = resolve_import_source(&file, spec, files, inputs)?;
                resolve_export(next, original.clone(), files, inputs, visited)
            }
            (None, _, Some(local)) if ff.imports.iter().any(|import| import.local == *local) => {
                reexported_import(local, visited)
            }
            _ => Some((file.clone(), name.clone())),
        };
    }
    if name == "default" {
        return match &ff.default_export_binding {
            Some(local) if ff.imports.iter().any(|import| import.local == *local) => {
                reexported_import(local, visited)
            }
            _ => Some((file.clone(), name.clone())),
        };
    }
    // `export *` never carries a default export.
    ff.star_exports
        .iter()
        .filter_map(|spec| resolve_import_source(&file, spec, files, inputs))
        .find_map(|module| resolve_export(module, name.clone(), files, inputs, visited))
}

/// Every name `module` exports, including through its `export *` sources,
/// which never carry a default export.
pub(crate) fn module_export_names(
    module: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    let mut seen: FxHashSet<String> = FxHashSet::default();
    let mut stack = vec![(module.to_string(), true)];
    while let Some((file, direct)) = stack.pop() {
        if !seen.insert(file.clone()) {
            continue;
        }
        let Some(ff) = files.get(&file) else { continue };
        names.extend(
            ff.exports
                .iter()
                .filter(|e| direct || e.exported != "default")
                .map(|e| e.exported.clone()),
        );
        stack.extend(
            ff.star_exports
                .iter()
                .filter_map(|spec| resolve_import_source(&file, spec, files, inputs))
                .map(|next| (next, false)),
        );
    }
    names
}
