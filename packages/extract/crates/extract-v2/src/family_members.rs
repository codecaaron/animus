//! Compose family member tags (`<Card.Body>`) resolved through the
//! consuming file's own bindings: the families it declares, the names it
//! imports (aliased, default or through re-exports and barrels) and its
//! namespace imports. Two families that share a name in different modules
//! stay apart.

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use rustc_hash::{FxHashMap, FxHashSet};

use crate::analyze_css::{declared_export, namespace_path_module, resolve_import_source, CssInputs};
use crate::facts::{FacadeEntry, FileFacts};

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

/// An object whose members a member tag reads.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Object {
    Family(usize),
    /// A facade: (module, binding) of its declaration.
    Facade(String, String),
}

/// An object's members once it is built: each member's component, `None`
/// for a value that names none. An open table may also hold members no
/// write the analysis reads names.
#[derive(Default)]
struct MemberTable {
    members: BTreeMap<String, Option<String>>,
    open: bool,
}

/// Traces a member tag written through an object the family index does not
/// resolve through (an object of components, a facade copying a compose
/// family, `const Nav = { ...Family, Item }`, or an alias of a family or
/// facade) to the component that member names when the object is built.
pub(crate) struct ObjectMembers<'f> {
    files: &'f BTreeMap<String, FileFacts>,
    inputs: &'f CssInputs,
    families: &'f FamilyIndex,
    /// The one component a binding of a module names, if any.
    component: &'f dyn Fn(&str, &str) -> Option<String>,
    objects: FxHashMap<(String, String), Option<Object>>,
    tables: FxHashMap<Object, Rc<MemberTable>>,
    building: FxHashSet<Object>,
}

impl<'f> ObjectMembers<'f> {
    pub(crate) fn new(
        files: &'f BTreeMap<String, FileFacts>,
        inputs: &'f CssInputs,
        families: &'f FamilyIndex,
        component: &'f dyn Fn(&str, &str) -> Option<String>,
    ) -> Self {
        Self {
            files,
            inputs,
            families,
            component,
            objects: FxHashMap::default(),
            tables: FxHashMap::default(),
            building: FxHashSet::default(),
        }
    }

    /// The component `tag`, written in `file`, names: `Nav.Root` through a
    /// binding of the file, `ui.Nav.Root` and `ui.sub.Nav.Root` through a
    /// namespace.
    pub(crate) fn traced(&mut self, file: &str, tag: &str) -> Option<String> {
        let files = self.files;
        let (path, slot) = tag.rsplit_once('.')?;
        let object = match path.rsplit_once('.') {
            Some((namespace, name)) => {
                let module = namespace_path_module(file, files.get(file)?, namespace, files, self.inputs)?;
                self.exported_object(&module, name)?
            }
            None => self.local_object(file, path)?,
        };
        self.table(&object).members.get(slot)?.clone()
    }

    /// The object `name` holds in `module`: a family or facade it declares,
    /// one a `const` alias names, or one it imports.
    fn local_object(&mut self, module: &str, name: &str) -> Option<Object> {
        let key = (module.to_string(), name.to_string());
        if let Some(found) = self.objects.get(&key) {
            return found.clone();
        }
        // A cycle of aliases and imports holds nothing.
        self.objects.insert(key.clone(), None);
        let found = self.resolve_local(module, name);
        self.objects.insert(key, found.clone());
        found
    }

    fn resolve_local(&mut self, module: &str, name: &str) -> Option<Object> {
        let files = self.files;
        let ff = files.get(module)?;
        if let Some(&id) = self.families.locals.get(&(module.to_string(), name.to_string())) {
            return Some(Object::Family(id));
        }
        if ff.facades.contains_key(name) {
            return Some(Object::Facade(module.to_string(), name.to_string()));
        }
        if let Some(target) = ff.aliases.get(name) {
            return self.local_object(module, target);
        }
        let import = ff.imports.iter().find(|import| import.local == name)?;
        let source = resolve_import_source(module, &import.source, files, self.inputs)?;
        self.exported_object(&source, &import.imported)
    }

    /// The object `module` exports as `name`, followed through re-exports
    /// and barrels.
    fn exported_object(&mut self, module: &str, name: &str) -> Option<Object> {
        let (declaring, exported, declared) =
            declared_export(module, name.to_string(), self.files, self.inputs)?;
        if let Some(&id) = self.families.exports.get(&(declaring.clone(), exported)) {
            return Some(Object::Family(id));
        }
        self.local_object(&declaring, &declared)
    }

    fn table(&mut self, object: &Object) -> Rc<MemberTable> {
        if let Some(table) = self.tables.get(object) {
            return Rc::clone(table);
        }
        let table = match object {
            Object::Family(id) => MemberTable {
                members: self.families.members[*id]
                    .iter()
                    .map(|(slot, component)| (slot.clone(), Some(component.clone())))
                    .collect(),
                open: false,
            },
            Object::Facade(module, binding) => {
                self.building.insert(object.clone());
                let table = self.build(module, binding);
                self.building.remove(object);
                table
            }
        };
        let table = Rc::new(table);
        self.tables.insert(object.clone(), Rc::clone(&table));
        table
    }

    /// A facade's members after each of its writes in source order: a later
    /// write replaces an earlier one, and one that may set any member leaves
    /// none known.
    fn build(&mut self, module: &str, binding: &str) -> MemberTable {
        let files = self.files;
        let mut table = MemberTable::default();
        let Some(entries) = files.get(module).and_then(|ff| ff.facades.get(binding)) else {
            return table;
        };
        for entry in entries {
            match entry {
                FacadeEntry::Copy(name) => match self.local_object(module, name) {
                    Some(source) if !self.building.contains(&source) => {
                        let source = self.table(&source);
                        if source.open {
                            table = MemberTable { open: true, ..MemberTable::default() };
                        }
                        table.members.extend(source.members.iter().map(|(k, v)| (k.clone(), v.clone())));
                    }
                    // A source the analysis cannot read, or one that copies
                    // this object back, may set any member.
                    _ => table = MemberTable { open: true, ..MemberTable::default() },
                },
                FacadeEntry::Member { key, binding, member } => {
                    let component = match member {
                        Some(member) => match self.local_object(module, binding) {
                            Some(source) if !self.building.contains(&source) => {
                                self.table(&source).members.get(member).cloned().flatten()
                            }
                            _ => None,
                        },
                        None => (self.component)(module, binding),
                    };
                    table.members.insert(key.clone(), component);
                }
                FacadeEntry::Other(key) => {
                    table.members.insert(key.clone(), None);
                }
                FacadeEntry::Unknown => table = MemberTable { open: true, ..MemberTable::default() },
            }
        }
        table
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

/// The module `module` exports as the namespace `name`:
/// `export * as name from '…'`, or a namespace import exported again
/// (`import * as name from '…'; export { name }`), followed through
/// re-exports and barrels. `None` when `name` is no namespace there.
pub(crate) fn namespace_export(
    module: String,
    name: String,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> Option<String> {
    resolve_namespace(module, name, files, inputs, &mut FxHashSet::default())
}

fn resolve_namespace(
    file: String,
    name: String,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    visited: &mut FxHashSet<(String, String)>,
) -> Option<String> {
    if !visited.insert((file.clone(), name.clone())) {
        return None;
    }
    let ff = files.get(&file)?;
    if let Some(spec) = ff.namespace_exports.get(&name) {
        return resolve_import_source(&file, spec, files, inputs);
    }
    if let Some(export) = ff.exports.iter().find(|e| e.exported == name) {
        return match (&export.source, &export.original, &export.local) {
            (Some(spec), Some(original), _) => {
                let next = resolve_import_source(&file, spec, files, inputs)?;
                resolve_namespace(next, original.clone(), files, inputs, visited)
            }
            (None, _, Some(local)) => local_namespace(&file, ff, local, files, inputs, visited),
            _ => None,
        };
    }
    if name == "default" {
        let local = ff.default_export_binding.as_deref()?;
        return local_namespace(&file, ff, local, files, inputs, visited);
    }
    ff.star_exports
        .iter()
        .filter_map(|spec| resolve_import_source(&file, spec, files, inputs))
        .find_map(|module| resolve_namespace(module, name.clone(), files, inputs, visited))
}

/// The module a local binding of `file` holds as a namespace: a namespace
/// import, or a named import of a namespace another module exports.
pub(crate) fn local_namespace(
    file: &str,
    ff: &FileFacts,
    local: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    visited: &mut FxHashSet<(String, String)>,
) -> Option<String> {
    if let Some(spec) = ff.namespace_imports.get(local) {
        return resolve_import_source(file, spec, files, inputs);
    }
    let import = ff.imports.iter().find(|import| import.local == local)?;
    let next = resolve_import_source(file, &import.source, files, inputs)?;
    resolve_namespace(next, import.imported.clone(), files, inputs, visited)
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
                .map(|e| &e.exported)
                .chain(ff.namespace_exports.keys())
                .filter(|exported| direct || *exported != "default")
                .cloned(),
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
