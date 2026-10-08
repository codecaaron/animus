//! Compose family member tags (`<Card.Body>`) resolved through the
//! consuming file's own bindings: the families it declares, the names it
//! imports (aliased, default or through re-exports) and its namespace
//! imports. Two families that share a name in different modules stay apart.

use std::collections::BTreeMap;

use rustc_hash::FxHashMap;

use crate::analyze_css::{follow_reexports, resolve_import_source, CssInputs};
use crate::facts::FileFacts;

/// Every compose family, keyed by the names its module gives it.
pub(crate) struct FamilyIndex {
    /// (module, local or exported name) → position in `members`.
    by_name: FxHashMap<(String, String), usize>,
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
            by_name: FxHashMap::default(),
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
                    index.by_name.insert((file.clone(), binding.clone()), id);
                }
                if family.default_export {
                    index
                        .by_name
                        .insert((file.clone(), "default".to_string()), id);
                }
            }
            for export in &ff.exports {
                let (None, Some(local)) = (&export.source, &export.local) else {
                    continue;
                };
                if let Some(&id) = index.by_name.get(&(file.clone(), local.clone())) {
                    index
                        .by_name
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
            if let Some(&id) = self.by_name.get(&(file.to_string(), binding.clone())) {
                add(binding, id);
            }
        }
        for import in &ff.imports {
            let Some(module) = resolve_import_source(file, &import.source, files, inputs) else {
                continue;
            };
            if let Some(id) = self.exported(module, import.imported.clone(), files, inputs) {
                add(&import.local, id);
            }
        }
        for (namespace, source) in &ff.namespace_imports {
            let Some(module) = resolve_import_source(file, source, files, inputs) else {
                continue;
            };
            let Some(module_facts) = files.get(&module) else {
                continue;
            };
            for export in &module_facts.exports {
                let name = export.exported.clone();
                if let Some(id) = self.exported(module.clone(), name, files, inputs) {
                    add(&format!("{namespace}.{}", export.exported), id);
                }
            }
        }
        members
    }

    /// The family `module` exports as `name`, following re-exports.
    fn exported(
        &self,
        module: String,
        name: String,
        files: &BTreeMap<String, FileFacts>,
        inputs: &CssInputs,
    ) -> Option<usize> {
        let key = follow_reexports(module, name, files, inputs);
        self.by_name.get(&key).copied()
    }
}
