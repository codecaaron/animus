//! Compose family member tags (`<Card.Body>`) resolved through the
//! consuming file's own bindings: the families it declares, the names it
//! imports (aliased, default or through re-exports and barrels) and its
//! namespace imports. Two families that share a name in different modules
//! stay apart.

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use rustc_hash::{FxHashMap, FxHashSet};

use crate::analyze_css::{
    declared_export, namespace_path_module, resolve_declaration, resolve_import_source, CssInputs,
};
use crate::facts::{FacadeEntry, FileFacts};
use crate::flow::{AbsenceQuery, ChangeKind, Coverage, FlowBuilder, ObjectId, ReasonId, Region, RegionAtom, ValueEffects};
use animus_system_loader::module_table::{ExportLookup, ImportName, OpeningReason, Request, Terminal};

/// Every compose family, keyed by the names its module gives it.
pub(crate) struct FamilyIndex {
    /// (module, local binding) → position in `members`, for the module's own
    /// member tags.
    locals: FxHashMap<(String, String), usize>,
    /// (module, exported name) → position in `members`, for importers; an
    /// export alias never renames the family inside its own module.
    exports: FxHashMap<(String, String), usize>,
    /// Binding name → every family bound to it. Imports the analysis cannot
    /// resolve fall back to it, and to `by_export`.
    by_binding: FxHashMap<String, Vec<usize>>,
    /// Exported name → every family some analysed module exports under it,
    /// through aliases, barrels and default exports: built at the first
    /// import the analysis cannot resolve.
    by_export: std::cell::OnceCell<FxHashMap<String, Vec<usize>>>,
    /// Per family, each slot name with the component it renders.
    members: Vec<Vec<(String, String)>>,
    /// Per family, whether it may hold members `members` does not list.
    open: Vec<bool>,
    /// Per family, the members an `Object.assign` adds, each with the
    /// binding it holds in the family's module (`ComposeFamilyInfo::extras`).
    extras: Vec<Vec<(String, String)>>,
    /// Per family, its declaration: the module and the binding that holds
    /// it, or the module's default cell for `export default compose(…)`.
    declarations: Vec<(String, String)>,
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
            by_export: std::cell::OnceCell::new(),
            members: Vec::new(),
            open: Vec::new(),
            extras: Vec::new(),
            declarations: Vec::new(),
        };
        for (file, ff) in files {
            for family in &ff.compose {
                let id = index.members.len();
                let mut members: Vec<(String, String)> =
                    family.slots.iter().map(|(slot, binding)| (slot.clone(), slot_component(file, binding))).collect();
                // An added member that is an Animus component renders it; an
                // ordinary one is `ObjectMembers::ordinary_member`'s.
                for (member, binding) in &family.extras {
                    let component = slot_component(file, binding);
                    if component != *binding {
                        members.push((member.clone(), component));
                    }
                }
                index.members.push(members);
                index.open.push(family.open);
                index.extras.push(family.extras.clone());
                // A family no binding holds and no default export names is
                // keyed by its position, apart from any binding.
                let declared = match (&family.family_binding, family.default_export) {
                    (Some(binding), _) => binding.clone(),
                    (None, true) => "default".to_string(),
                    (None, false) => format!("<family {id}>"),
                };
                index.declarations.push((file.clone(), declared));
                if let Some(binding) = &family.family_binding {
                    index.locals.insert((file.clone(), binding.clone()), id);
                    index.by_binding.entry(binding.clone()).or_default().push(id);
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
    /// `ui.Card.Body`), each mapped to the component its slot renders. A tag
    /// an unresolved import may give several families maps to the first,
    /// with every candidate in `ambiguous`.
    pub(crate) fn members_for(
        &self,
        file: &str,
        ff: &FileFacts,
        files: &BTreeMap<String, FileFacts>,
        inputs: &CssInputs,
        links: &crate::link::ProjectLinks,
        ambiguous: &mut FxHashMap<String, Vec<String>>,
    ) -> FxHashMap<String, String> {
        let mut members = FxHashMap::default();
        let mut add_all = |prefix: &str, ids: &[usize]| {
            for &id in ids {
                for (slot, component) in &self.members[id] {
                    let tag = format!("{prefix}.{slot}");
                    if ids.len() > 1 {
                        ambiguous.entry(tag.clone()).or_default().push(component.clone());
                    }
                    members.entry(tag).or_insert_with(|| component.clone());
                }
            }
        };
        for binding in ff.compose.iter().filter_map(|f| f.family_binding.as_ref()) {
            if let Some(&id) = self.locals.get(&(file.to_string(), binding.clone())) {
                add_all(binding, &[id]);
            }
        }
        for import in &ff.imports {
            let ids = match resolve_import_source(file, &import.source, files, inputs) {
                Some(module) => self.exported(&module, import.imported.clone(), files, links).into_iter().collect(),
                // A default import is named by its local binding too.
                None if import.imported == "default" => self.candidates(&["default", &import.local], files, links),
                None => self.candidates(&[&import.imported], files, links),
            };
            add_all(&import.local, &ids);
        }
        for (namespace, source) in &ff.namespace_imports {
            let Some(module) = resolve_import_source(file, source, files, inputs) else {
                let names: BTreeSet<&String> = self.by_binding.keys().chain(self.exported_names(files, links).keys()).collect();
                for name in names {
                    add_all(&format!("{namespace}.{name}"), &self.candidates(&[name], files, links));
                }
                continue;
            };
            for name in module_export_names(&module, links) {
                if let Some(id) = self.exported(&module, name.clone(), files, links) {
                    add_all(&format!("{namespace}.{name}"), &[id]);
                }
            }
        }
        members
    }

    /// Every family an import the analysis cannot resolve may name by
    /// `names`: those bound to one, and those an analysed module exports
    /// under one.
    fn candidates(&self, names: &[&str], files: &BTreeMap<String, FileFacts>, links: &crate::link::ProjectLinks) -> Vec<usize> {
        let exported = self.exported_names(files, links);
        let ids: BTreeSet<usize> = names
            .iter()
            .flat_map(|name| self.by_binding.get(*name).into_iter().flatten().chain(exported.get(*name).into_iter().flatten()))
            .copied()
            .collect();
        ids.into_iter().collect()
    }

    /// See `by_export`.
    fn exported_names(&self, files: &BTreeMap<String, FileFacts>, links: &crate::link::ProjectLinks) -> &FxHashMap<String, Vec<usize>> {
        self.by_export.get_or_init(|| {
            let mut by_export: FxHashMap<String, Vec<usize>> = FxHashMap::default();
            for module in files.keys() {
                for name in module_export_names(module, links) {
                    if let Some(id) = self.exported(module, name.clone(), files, links) {
                        by_export.entry(name).or_default().push(id);
                    }
                }
            }
            by_export
        })
    }

    /// The family `module` exports as `name`, following re-exports and
    /// barrels.
    /// The family `module`'s export `name` declares, as the module table
    /// resolves it: an ambiguous or open export declares none.
    fn exported(
        &self,
        module: &str,
        name: String,
        files: &BTreeMap<String, FileFacts>,
        links: &crate::link::ProjectLinks,
    ) -> Option<usize> {
        let (declaring, exported, declared) = declared_export(module, name, files, links)?;
        self.exports.get(&(declaring.clone(), exported)).or_else(|| self.locals.get(&(declaring, declared))).copied()
    }
}

/// The objects a use reaches, and the openings through which it may reach
/// more.
#[derive(Default)]
struct Reach {
    objects: Vec<Object>,
    openings: Vec<(ReasonId, Region)>,
}

impl Reach {
    fn of(objects: Vec<Object>) -> Self {
        Self { objects, openings: Vec::new() }
    }

    /// Every exported object, through an opening for `reason`.
    fn anywhere(reason: ReasonId) -> Self {
        Self { objects: Vec::new(), openings: vec![(reason, Region::of(RegionAtom::AllExports))] }
    }

    fn extend(&mut self, more: Reach) {
        self.objects.extend(more.objects);
        self.openings.extend(more.openings);
    }

    /// Records the use as a change to each object it reaches and to the
    /// facades built on it, then each of its openings, said as `reason`.
    fn record(self, flow: &mut FlowBuilder, families: &FamilyIndex, facades: Vec<Object>, reason: &str) {
        for object in self.objects.into_iter().chain(facades) {
            flow.change(object_id(&object, families), Vec::new(), ChangeKind::Escape, reason.to_string());
        }
        for (why, region) in self.openings {
            flow.open(why, region, reason.to_string());
        }
    }
}

/// An object as the changed relation names it: by its declaration, the
/// module and binding that hold it.
fn object_id(object: &Object, families: &FamilyIndex) -> ObjectId {
    match object {
        Object::Facade(module, binding) | Object::Context(module, binding) => ObjectId::new(module, binding),
        Object::Family(index) => {
            let (module, binding) = &families.declarations[*index];
            ObjectId::new(module, binding)
        }
    }
}

/// A namespace import of a module the analysis does not read.
enum UnreadNamespace {
    Missing,
    /// A package, by the identity the analysis names it with.
    Package(String),
}

/// An object whose members a member tag reads.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Object {
    Family(usize),
    /// A facade: (module, binding) of its declaration.
    Facade(String, String),
    /// A context React's `createContext` builds, whose `Provider` a tag
    /// reads: (module, binding) of its declaration. Its member table is open.
    Context(String, String),
}

/// What one member of an object holds once the object is built.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Member {
    /// A value that names no component.
    Other,
    /// A binding of a module, as written there, that names no component,
    /// such as a function component that forwards its props.
    Bound { module: String, binding: String },
    /// The component the member names; nothing the analysis sees can have
    /// changed the object since.
    Stable(String),
    /// The component the member named when the object was built, and the
    /// use that may have changed the object since, as a clause.
    Unstable(String, String),
}

impl Member {
    fn component(&self) -> Option<&String> {
        match self {
            Self::Other | Self::Bound { .. } => None,
            Self::Stable(component) | Self::Unstable(component, _) => Some(component),
        }
    }
}

/// Whether `binding` is a private spread wrapper that object members hold.
fn is_held_wrapper(ff: &FileFacts, binding: &str) -> bool {
    ff.spread_wrappers.get(binding).is_some_and(|wrapper| wrapper.held > 0)
}

/// An object's members once it is built. An open table may also hold
/// members no write the analysis reads names.
#[derive(Default)]
struct MemberTable {
    members: BTreeMap<String, Member>,
    open: bool,
}

/// Member tags written through an object the family index does not resolve
/// through: an object of components, a facade copying a compose family
/// (`const Nav = { ...Family, Item }`), or an alias of a family or facade.
/// Each member is a snapshot of what the object held when built, stable
/// while nothing in the analysed modules can have changed that object or a
/// source it copied since: no member write, method call or hand-off to code
/// the analysis does not follow, through any binding of it, and no runtime
/// load or namespace re-export of a module exporting it.
pub(crate) struct ObjectMembers<'f> {
    files: &'f BTreeMap<String, FileFacts>,
    inputs: &'f CssInputs,
    links: &'f crate::link::ProjectLinks,
    families: &'f FamilyIndex,
    /// The one component a binding of a module names, if any.
    component: &'f dyn Fn(&str, &str) -> Option<String>,
    /// The components the analysis extracts.
    evaluated: &'f FxHashSet<String>,
    objects: FxHashMap<(String, String), Option<Object>>,
    tables: FxHashMap<Object, Rc<MemberTable>>,
    building: FxHashSet<Object>,
    /// What the uses in the analysed modules may change, closed once, on
    /// the first question.
    changed: Option<ValueEffects>,
}

impl<'f> ObjectMembers<'f> {
    pub(crate) fn new(
        files: &'f BTreeMap<String, FileFacts>,
        inputs: &'f CssInputs,
        links: &'f crate::link::ProjectLinks,
        families: &'f FamilyIndex,
        component: &'f dyn Fn(&str, &str) -> Option<String>,
        evaluated: &'f FxHashSet<String>,
    ) -> Self {
        Self {
            files,
            inputs,
            links,
            families,
            component,
            evaluated,
            objects: FxHashMap::default(),
            tables: FxHashMap::default(),
            building: FxHashSet::default(),
            changed: None,
        }
    }

    /// What `tag`, written in `file`, reads: `Nav.Root` through a binding of
    /// the file, `ui.Nav.Root` and `ui.sub.Nav.Root` through a namespace.
    pub(crate) fn member(&mut self, file: &str, tag: &str) -> Option<Member> {
        let (path, slot) = tag.rsplit_once('.')?;
        let object = self.object_at(file, path)?;
        self.table(&object).members.get(slot).cloned()
    }

    /// What `tag`, written in `file`, renders: as a member tag (`member`),
    /// or as a facade's own tag.
    pub(crate) fn of_tag(&mut self, file: &str, tag: &str, member: bool) -> Option<Member> {
        if member { self.member(file, tag) } else { self.root(file, tag) }
    }

    /// What `tag`, written in `file`, renders when it names a facade built
    /// with `Object.assign(T, …)`. The call returns the object `T` holds, so
    /// `<X>` renders it whatever is written onto it later: `T`'s component,
    /// stable unless `T` is a member of an object that may have changed
    /// before the facade was built.
    pub(crate) fn root(&mut self, file: &str, tag: &str) -> Option<Member> {
        let Object::Facade(module, binding) = self.object_at(file, tag)? else { return None };
        let target = self.files.get(&module)?.assigned_targets.get(&binding)?.clone();
        match target.contains('.') {
            true => self.member(&module, &target),
            false => (self.component)(&module, &target).map(Member::Stable),
        }
    }

    /// The assigned facades built onto what `name`, used in `module`, names:
    /// a binding or member path of the module (`Root`, `Fam.Root`), or one it
    /// imports.
    fn facades_on(&self, module: &str, ff: &FileFacts, name: &str) -> Vec<Object> {
        let (root, rest) = name.split_once('.').map_or((name, None), |(root, rest)| (root, Some(rest)));
        let declared = match ff.import_of(root) {
            Some(import) => resolve_import_source(module, &import.source, self.files, self.inputs)
                .and_then(|source| declared_export(&source, import.imported.clone(), self.files, self.links))
                .map(|(declaring, _, binding)| (declaring, binding)),
            None => Some((module.to_string(), root.to_string())),
        };
        let Some((declaring, binding)) = declared else { return Vec::new() };
        let target = match rest {
            Some(rest) => format!("{binding}.{rest}"),
            None => binding,
        };
        self.files.get(&declaring).map_or_else(Vec::new, |declared| {
            declared
                .assigned_targets
                .iter()
                .filter(|(_, other)| **other == target)
                .map(|(facade, _)| Object::Facade(declaring.clone(), facade.clone()))
                .collect()
        })
    }

    /// The private spread wrapper `tag`, written in `file`, renders, with
    /// the module declaring it: the object's own initializer holds it at that
    /// key, nothing later sets the key, and nothing may have changed the
    /// object since.
    pub(crate) fn held_wrapper(&mut self, file: &str, tag: &str) -> Option<(String, String)> {
        let (module, wrapper, None) = self.member_entry(file, tag)? else { return None };
        is_held_wrapper(self.files.get(&module)?, &wrapper).then_some((module, wrapper))
    }

    /// What `object` holds at `key`, as its last write of the key set it: the
    /// module that names the value, the binding, and the member read from it
    /// (`Trigger: ArkMenu.Trigger`).
    fn member_read(&self, object: &Object, key: &str) -> Option<(String, String, Option<String>)> {
        let Object::Facade(module, binding) = object else { return None };
        let last = self.files.get(module)?.facades.get(binding)?.iter().rev().find(|entry| match entry {
            FacadeEntry::Member { key: set, .. }
            | FacadeEntry::Other(set)
            | FacadeEntry::Written { key: set, .. }
            | FacadeEntry::Code(Some(set)) => set == key,
            FacadeEntry::Copy(_) | FacadeEntry::Unknown | FacadeEntry::Code(None) => true,
        })?;
        match last {
            FacadeEntry::Member { binding, member, .. } => Some((module.clone(), binding.clone(), member.clone())),
            _ => None,
        }
    }

    /// The binding `object` holds at `key` as a whole, with the module that
    /// names it.
    fn member_binding(&self, object: &Object, key: &str) -> Option<(String, String)> {
        match self.member_read(object, key)? {
            (module, binding, None) => Some((module, binding)),
            _ => None,
        }
    }

    /// The wrapper `object` holds at `key`, as its last write of the key set
    /// it.
    fn holds(&self, object: &Object, key: &str) -> Option<(String, String)> {
        let (module, wrapper) = self.member_binding(object, key)?;
        let held = is_held_wrapper(self.files.get(&module)?, &wrapper);
        held.then_some((module, wrapper))
    }

    /// The ordinary function component `tag`, written in `file`, renders as
    /// a member of an object (`<Dialog.Root>` for `const Dialog = { Root }`):
    /// its declaring module and binding. The object's last write of the key
    /// names it, through an import too, and nothing may have changed the
    /// object since.
    pub(crate) fn ordinary_member(&mut self, file: &str, tag: &str) -> Option<(String, String)> {
        let (module, binding) = match self.member_entry(file, tag) {
            Some((module, binding, None)) => (module, binding),
            Some(_) => return None,
            // A member an `Object.assign` adds to a family holds its binding.
            None => {
                let (path, key) = tag.rsplit_once('.')?;
                let family = self.object_at(file, path)?;
                let Object::Family(id) = family else { return None };
                if self.table(&family).open || self.instability(&family).is_some() {
                    return None;
                }
                let (_, binding) = self.families.extras[id].iter().find(|(member, _)| member == key)?;
                (self.families.declarations[id].0.clone(), binding.clone())
            }
        };
        let ff = self.files.get(&module)?;
        let (declaring, declared, _) = resolve_declaration(&module, ff, &binding, self.files, self.inputs, self.links)?;
        crate::analyze_css::ordinary_declaration(&declaring, &declared, self.files, self.inputs, self.links)
    }

    /// Every wrapper `object`'s initializer holds, whatever came later.
    fn wrappers_of(&self, object: &Object) -> Vec<(String, String)> {
        let Object::Facade(module, binding) = object else { return Vec::new() };
        let Some(ff) = self.files.get(module) else { return Vec::new() };
        let held = |entry: &FacadeEntry| match entry {
            FacadeEntry::Member { binding: wrapper, member: None, .. }
                if is_held_wrapper(ff, wrapper) =>
            {
                Some((module.clone(), wrapper.clone()))
            }
            _ => None,
        };
        ff.facades.get(binding).into_iter().flatten().filter_map(held).collect()
    }

    /// The held wrappers an escaping `name` hands over: each one the object
    /// it names holds, or the one member it reads.
    pub(crate) fn escaped_wrappers(&mut self, file: &str, name: &str) -> Vec<(String, String)> {
        if let Some(object) = self.object_at(file, name) {
            return self.wrappers_of(&object);
        }
        let Some((path, key)) = name.rsplit_once('.') else { return Vec::new() };
        self.object_at(file, path).and_then(|object| self.holds(&object, key)).into_iter().collect()
    }

    /// The facade `name`, written in `file`, names: its module and binding.
    pub(crate) fn facade_at(&mut self, file: &str, name: &str) -> Option<(String, String)> {
        match self.object_at(file, name)? {
            Object::Facade(module, binding) => Some((module, binding)),
            Object::Family(_) | Object::Context(..) => None,
        }
    }

    /// Whether nothing may have changed the facade `binding` of `module`
    /// since it was built.
    pub(crate) fn facade_stable(&mut self, module: &str, binding: &str) -> bool {
        let object = Object::Facade(module.to_string(), binding.to_string());
        !self.table(&object).open && self.instability(&object).is_none()
    }

    /// The held wrappers some render of which no member tag shows: those of
    /// an object something may have changed, and of an object another one
    /// copies (`{ ...Code }`), whose members render them too.
    pub(crate) fn unproven_wrappers(&mut self) -> Vec<(String, String)> {
        let files = self.files;
        let mut found = Vec::new();
        for (module, ff) in files {
            for (binding, entries) in &ff.facades {
                let object = Object::Facade(module.clone(), binding.clone());
                let wrappers = self.wrappers_of(&object);
                if !wrappers.is_empty() && (self.table(&object).open || self.instability(&object).is_some()) {
                    found.extend(wrappers);
                }
                for entry in entries {
                    if let FacadeEntry::Copy(name) = entry {
                        if let Some(source) = self.local_object(module, name) {
                            found.extend(self.wrappers_of(&source));
                        }
                    }
                }
            }
        }
        found
    }

    /// What `tag`, written in `file`, reads from an object nothing may have
    /// changed since it was built: the module naming the value, the binding
    /// the object's last write of the key names, and the member read from it
    /// (`Trigger: ArkMenu.Trigger`).
    pub(crate) fn member_entry(&mut self, file: &str, tag: &str) -> Option<(String, String, Option<String>)> {
        let (path, key) = tag.rsplit_once('.')?;
        let object = self.object_at(file, path)?;
        let entry = self.member_read(&object, key)?;
        if self.table(&object).open || self.instability(&object).is_some() {
            return None;
        }
        Some(entry)
    }

    /// The components an escaping `name` hands over: every component the
    /// object it names holds, or the one member it reads, followed through
    /// members that hold objects (`outer.inner.Root`).
    pub(crate) fn escaped_components(&mut self, file: &str, name: &str) -> Vec<String> {
        let mut prefix = name;
        let mut rest = Vec::new();
        let mut object = loop {
            if let Some(object) = self.object_at(file, prefix) {
                break object;
            }
            let Some((shorter, segment)) = prefix.rsplit_once('.') else { return Vec::new() };
            rest.push(segment);
            prefix = shorter;
        };
        while let Some(segment) = rest.pop() {
            match self.table(&object).members.get(segment) {
                Some(Member::Bound { module, binding }) => match self.local_object(module, binding) {
                    Some(inner) => object = inner,
                    None => return Vec::new(),
                },
                Some(member) if rest.is_empty() => return member.component().cloned().into_iter().collect(),
                _ => return Vec::new(),
            }
        }
        self.held_components(object)
    }

    /// Every component `object` holds, through members that hold other
    /// objects (`{ inner: box }`) too.
    fn held_components(&mut self, object: Object) -> Vec<String> {
        let mut held = Vec::new();
        let mut seen = FxHashSet::default();
        let mut pending = vec![object];
        while let Some(object) = pending.pop() {
            if !seen.insert(object.clone()) {
                continue;
            }
            for member in self.table(&object).members.values() {
                match member {
                    Member::Stable(component) | Member::Unstable(component, _) => held.push(component.clone()),
                    Member::Bound { module, binding } => pending.extend(self.local_object(module, binding)),
                    Member::Other => {}
                }
            }
        }
        held
    }

    /// Whether every read the facade literal `holder` of `module` holds once
    /// built (`FollowedReads`), each copy and member read, names a family or
    /// facade whose table is closed and holds only components the analysis
    /// extracts: then the escape scan's reads of it (`Deferral::FacadeRead`)
    /// hand nothing over. One read that is not leaves the facade's table
    /// without what the others read, so none of them is proven.
    pub(crate) fn facade_proven(&mut self, module: &str, holder: &str) -> bool {
        let files = self.files;
        let Some(entries) = files.get(module).and_then(|ff| ff.facades.get(holder)) else { return false };
        // The facade itself holds plain data: members and copies only. A
        // method, accessor or function value runs with it as `this` and can
        // hand a member anywhere; a value no binding names (a call's) may be
        // such a function; a computed key, an expression's spread or a
        // later write may set any member.
        let plain = entries.iter().all(|entry| matches!(entry, FacadeEntry::Member { .. } | FacadeEntry::Copy(_)));
        if !plain || !self.facade_stable(module, holder) {
            return false;
        }
        let reads = crate::facts::FollowedReads::of(entries);
        let own = Object::Facade(module.to_string(), holder.to_string());
        let members = reads.members.values().filter_map(|(source, member)| Some((source, Some(member.as_deref()?))));
        let copies = reads.copies.iter().map(|copied| (copied, None));
        members.chain(copies).all(|(source, member)| self.proven_read(module, &own, source, member))
    }

    /// Whether `member` of what `source` names in `module`, or every member
    /// of it, is a component the analysis extracts, read from a family or
    /// facade other than `own` whose table is closed.
    fn proven_read(&mut self, module: &str, own: &Object, source: &str, member: Option<&str>) -> bool {
        let Some(object) = self.local_object(module, source) else { return false };
        if object == *own || matches!(object, Object::Context(..)) {
            return false;
        }
        let table = self.table(&object);
        let extracted = |held: &Member| held.component().is_some_and(|component| self.evaluated.contains(component));
        !table.open
            && match member {
                Some(member) => table.members.get(member).is_some_and(extracted),
                None => table.members.values().all(extracted),
            }
    }

    /// The components a compose family's slots render, where `name` (a
    /// binding of `file` or a namespace path) names one, through `const`
    /// aliases, imports and re-exports; empty for anything else.
    pub(crate) fn family_slots(&mut self, file: &str, name: &str) -> Vec<String> {
        match self.object_at(file, name) {
            Some(family @ Object::Family(_)) => {
                self.table(&family).members.values().filter_map(Member::component).cloned().collect()
            }
            _ => Vec::new(),
        }
    }

    /// The object a binding of `file` or a namespace path names.
    fn object_at(&mut self, file: &str, path: &str) -> Option<Object> {
        let files = self.files;
        match path.rsplit_once('.') {
            Some((namespace, name)) => {
                let module = namespace_path_module(file, files.get(file)?, namespace, files, self.inputs, self.links)?;
                self.exported_object(&module, name)
            }
            None => self.local_object(file, path),
        }
    }

    /// The object `name` holds in `module`: a family, facade or context it
    /// declares, one a `const` alias names, or one it imports.
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
        if ff.context_consts.contains(name) {
            return Some(Object::Context(module.to_string(), name.to_string()));
        }
        if let Some(target) = ff.aliases.get(name) {
            return self.local_object(module, target);
        }
        let import = ff.import_of(name)?;
        let source = resolve_import_source(module, &import.source, files, self.inputs)?;
        self.exported_object(&source, &import.imported)
    }

    /// The object `module` exports as `name`, followed through re-exports
    /// and barrels.
    fn exported_object(&mut self, module: &str, name: &str) -> Option<Object> {
        let (declaring, exported, declared) =
            declared_export(module, name.to_string(), self.files, self.links)?;
        if let Some(&id) = self.families.exports.get(&(declaring.clone(), exported)) {
            return Some(Object::Family(id));
        }
        self.local_object(&declaring, &declared)
    }

    fn table(&mut self, object: &Object) -> Rc<MemberTable> {
        if let Some(table) = self.tables.get(object) {
            return Rc::clone(table);
        }
        let mut table = match object {
            Object::Family(id) => MemberTable {
                members: self.families.members[*id]
                    .iter()
                    .map(|(slot, component)| (slot.clone(), Member::Stable(component.clone())))
                    .collect(),
                open: self.families.open[*id],
            },
            Object::Facade(module, binding) => {
                self.building.insert(object.clone());
                let table = self.build(module, binding);
                self.building.remove(object);
                table
            }
            // Nothing proves which members a context holds.
            Object::Context(..) => MemberTable { open: true, ..MemberTable::default() },
        };
        // What changed the object may also have added members.
        if let Some(reason) = self.instability(object) {
            table.open = true;
            for member in table.members.values_mut() {
                if let Member::Stable(component) = member {
                    *member = Member::Unstable(std::mem::take(component), reason.clone());
                }
            }
        }
        let table = Rc::new(table);
        self.tables.insert(object.clone(), Rc::clone(&table));
        table
    }

    /// A facade's members after each of its writes in source order: a later
    /// write replaces an earlier one, and one that may set any member leaves
    /// none known. A copied member keeps its source's verdict.
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
                    let value = match member {
                        Some(member) => match self.local_object(module, binding) {
                            Some(source) if !self.building.contains(&source) => {
                                self.table(&source).members.get(member).cloned()
                            }
                            _ => None,
                        },
                        None => Some((self.component)(module, binding).map_or_else(
                            || Member::Bound { module: module.to_string(), binding: binding.clone() },
                            Member::Stable,
                        )),
                    };
                    table.members.insert(key.clone(), value.unwrap_or(Member::Other));
                }
                // A component function the literal holds forwards as a
                // binding does, under the key `X.key` (`collect_props_forwarding`).
                FacadeEntry::Other(key) => {
                    let held = format!("{binding}.{key}");
                    let value = if files.get(module).is_some_and(|ff| ff.props_forwarding.contains_key(&held)) {
                        Member::Bound { module: module.to_string(), binding: held }
                    } else {
                        Member::Other
                    };
                    table.members.insert(key.clone(), value);
                }
                FacadeEntry::Code(Some(key)) => {
                    table.members.insert(key.clone(), Member::Other);
                }
                // The write replaces a component the member named with a value
                // the analysis does not follow.
                FacadeEntry::Written { key, line } => {
                    let written = match table.members.get(key).and_then(Member::component) {
                        Some(component) => Member::Unstable(
                            component.clone(),
                            format!("{binding} has its member {key} assigned in {module} on line {line}"),
                        ),
                        None => Member::Other,
                    };
                    table.members.insert(key.clone(), written);
                }
                FacadeEntry::Unknown | FacadeEntry::Code(None) => {
                    table = MemberTable { open: true, ..MemberTable::default() };
                }
            }
        }
        table
    }

    /// What the uses in the analysed modules may change, closed once, on
    /// the first question.
    pub(crate) fn changes(&mut self) -> &ValueEffects {
        if self.changed.is_none() {
            let changed = self.changed();
            self.changed = Some(changed);
        }
        self.changed.as_ref().expect("closed above")
    }

    /// The first use in the analysed modules that may change `object`, said
    /// as a clause, or `None` when there is none.
    fn instability(&mut self, object: &Object) -> Option<String> {
        let query = AbsenceQuery::SlotsNotWritten(object_id(object, self.families));
        if let Coverage::Exposed(exposures) = self.changes().covers(&query) {
            return Some(exposures[0].cause().to_string());
        }
        let Object::Facade(module, binding) = object else { return None };
        // A facade built onto an object (`Object.assign(Root, …)`) is that
        // object, which another write may change.
        let ff = &self.files[module];
        if let Some(target) = ff.assigned_targets.get(binding) {
            let root = target.split('.').next().unwrap_or(target);
            if ff.imports.iter().any(|import| import.local == root) || ff.namespace_imports.contains_key(root) {
                return Some(format!(
                    "{binding} in {module} is built onto {target}, which the module imports, so another module may change it"
                ));
            }
            if ff.assigned_targets.values().filter(|other| *other == target).count() > 1 {
                return Some(format!("{target} in {module} is the target of more than one Object.assign()"));
            }
        }
        let code = ff.facades[binding].iter().any(|entry| matches!(entry, FacadeEntry::Code(_)));
        code.then(|| {
            format!("{binding} in {module} has a method or accessor, which runs with the object as `this`")
        })
    }

    /// The changes a use in the analysed modules may make to an object, in
    /// module and source order: a use of a binding that holds it, a use that
    /// may write through a package's namespace, a namespace re-export of a
    /// module exporting it, a runtime load of one, or code run from a
    /// string. Every such use may rebind any member. The objects are facades,
    /// families and the contexts React's `createContext` builds, whose
    /// `Provider` a tag reads.
    fn changed(&mut self) -> ValueEffects {
        let files = self.files;
        let inputs = self.inputs;
        let mut flow = FlowBuilder::new();
        crate::analyze_css::note_build_chunks(files, inputs);
        // Each object a module exports, under each name it exports it as.
        let modules: Vec<String> = files.keys().cloned().collect();
        for module in &modules {
            let mut names = module_export_names(module, self.links);
            // `export default compose(…)` binds no name to list.
            names.insert("default".to_string());
            for name in &names {
                if let Some(object) = self.exported_object(module, name) {
                    flow.export(object_id(&object, self.families), module, name);
                }
            }
        }
        let mut by_name: Option<FxHashMap<String, Vec<Object>>> = None;
        // A config file runs in its tool, never in the app (`config_files`).
        let config_files = crate::analyze_css::config_files(files, inputs);
        for (module, ff) in files.iter().filter(|(module, _)| !config_files.contains(*module)) {
            for (name, used) in ff.changing_uses(module, self.evaluated) {
                let reason = used.said(name, module);
                let reach: Reach = match name.split_once('.') {
                    // A member of a namespace import.
                    // A module the analysis cannot find may re-export any
                    // object under any name: a write through a member of its
                    // namespace may reach any of them. A package's namespace
                    // is followed below.
                    Some((namespace, member)) => match self.unread_namespace(module, ff, namespace) {
                        Some(UnreadNamespace::Missing) => Reach::anywhere(ReasonId::UnresolvedSpecifier),
                        Some(UnreadNamespace::Package(_)) => Reach::default(),
                        None => match ff
                            .namespace_imports
                            .get(namespace)
                            .and_then(|spec| resolve_import_source(module, spec, files, inputs))
                        {
                            Some(target) => match self.exported_object(&target, member) {
                                Some(object) => Reach::of(vec![object]),
                                None => self.opened_export(&target, member),
                            },
                            None => Reach::default(),
                        },
                    },
                    None => match ff.namespace_imports.get(name) {
                        Some(spec) => match self.unread_namespace(module, ff, name) {
                            Some(UnreadNamespace::Package(_)) => Reach::default(),
                            Some(UnreadNamespace::Missing) => Reach::anywhere(ReasonId::UnresolvedSpecifier),
                            None => resolve_import_source(module, spec, files, inputs)
                                .map(|target| self.namespace_reach(&target))
                                .unwrap_or_default(),
                        },
                        None => match self.unresolved_import(module, ff, name) {
                            // An import the analysis cannot follow may be any
                            // object its name names.
                            Some(imported) => Reach::of(
                                by_name
                                    .get_or_insert_with(|| self.objects_by_name())
                                    .get(imported)
                                    .cloned()
                                    .unwrap_or_default(),
                            ),
                            None => match self.local_object(module, name) {
                                Some(object) => Reach::of(vec![object]),
                                None => self.opened_import(module, ff, name),
                            },
                        },
                    },
                };
                // A write to an assigned facade's target changes the facade.
                let facades = self.facades_on(module, ff, name);
                reach.record(&mut flow, self.families, facades, &reason);
            }
            // A package may re-export our objects (a linked workspace
            // package) under any name: a use that may write through its
            // namespace may reach any of them.
            for (namespace, (subject, used)) in &ff.written_namespaces {
                let Some(UnreadNamespace::Package(identity)) = self.unread_namespace(module, ff, namespace) else {
                    continue;
                };
                let reason = used.said(subject, module);
                if let Some(unread) = crate::link::unread_package(&identity, files, inputs) {
                    let opening =
                        |opened| crate::link::UnreadOpening::namespace_write(module, used.line, namespace, &identity, opened);
                    crate::link::open_unread(&mut flow, unread, &reason, inputs, opening, &mut |flow, target, reason| {
                        self.namespace_reach(target).record(flow, self.families, Vec::new(), reason)
                    });
                }
            }
            crate::link::record_module_openings(module, ff, files, inputs, &mut flow, &mut |flow, target, reason| {
                self.namespace_reach(target).record(flow, self.families, Vec::new(), reason)
            });
        }
        let changed = flow.close();
        #[cfg(test)]
        crate::engine::note_openings("member tables", &changed);
        changed
    }

    /// What `module`'s namespace may hold: each object it exports and,
    /// where an open route leaves an export or the module's names
    /// incomplete, every exported object.
    fn namespace_reach(&mut self, module: &str) -> Reach {
        let mut reach = Reach::default();
        let Some(index) = self.links.module(module) else { return reach };
        reach.openings.push((ReasonId::OpaqueEffect, Region::of(RegionAtom::ExportsOf(module.to_string()))));
        let names = self.links.table.exported_names(index);
        for name in &names.names {
            reach.extend(self.opened_export(module, name));
        }
        if !names.complete() {
            reach.openings.push((ReasonId::OpaqueStar, Region::of(RegionAtom::AllExports)));
        }
        reach
    }

    /// What an import binding of `module` may hold when an open route
    /// leaves the export it imports incomplete.
    fn opened_import(&mut self, module: &str, ff: &FileFacts, local: &str) -> Reach {
        let Some(import) = ff.import_of(local) else { return Reach::default() };
        let Some(source) = resolve_import_source(module, &import.source, self.files, self.inputs) else {
            return Reach::default();
        };
        self.opened_export(&source, &import.imported)
    }

    /// What `module`'s export `name` may hold when an open route leaves the
    /// answer incomplete: each object the answer knows, and every exported
    /// object, since the module the route passes is one the analysis does
    /// not read and may re-export any object under any name. Nothing for a
    /// complete answer.
    fn opened_export(&mut self, module: &str, name: &str) -> Reach {
        let mut reach = Reach::default();
        let Some(index) = self.links.module(module) else { return reach };
        let ExportLookup::Incomplete { known, openings } = self.links.table.resolve_export(index, name) else {
            return reach;
        };
        for terminal in known {
            if let Terminal::Local { module: declaring, binding } = terminal {
                let (path, local) = crate::analyze_css::binding_name(self.links, self.files, declaring, binding);
                reach.objects.extend(self.local_object(&path, &local));
            }
        }
        for opening in openings {
            let reason = match opening.reason {
                OpeningReason::OutsideStar(_) => ReasonId::OpaqueStar,
                OpeningReason::UnresolvedRequest(_) => ReasonId::UnresolvedSpecifier,
            };
            reach.openings.push((reason, Region::of(RegionAtom::AllExports)));
        }
        reach
    }

    /// Whether `module` imports `local` as the namespace of a module the
    /// analysis does not read: one it cannot find, or a package.
    fn unread_namespace(&self, module: &str, ff: &FileFacts, local: &str) -> Option<UnreadNamespace> {
        let (index, binding) = (self.links.module(module)?, ff.bindings.module_binding(local)?);
        let record = self.links.table.record(index);
        let import = record
            .imports
            .iter()
            .find(|import| import.local == binding && import.name == ImportName::Namespace)?;
        match &record.requests[import.request] {
            Request::Unresolved(_) => Some(UnreadNamespace::Missing),
            Request::Outside(identity) if crate::link::is_node_builtin(identity) => None,
            Request::Outside(identity) => Some(UnreadNamespace::Package(identity.clone())),
            Request::Module(_) => None,
        }
    }

    /// The name an import binding of `module` imports, when its source is
    /// no analysed module; a default import is named by its local binding.
    fn unresolved_import<'n>(&self, module: &str, ff: &'n FileFacts, local: &str) -> Option<&'n str> {
        let import = ff.import_of(local)?;
        if resolve_import_source(module, &import.source, self.files, self.inputs).is_some() {
            return None;
        }
        Some(if import.imported == "default" { &import.local } else { &import.imported })
    }

    /// Every object, keyed by each name a module declares or exports it as.
    fn objects_by_name(&mut self) -> FxHashMap<String, Vec<Object>> {
        let files = self.files;
        let mut by_name: FxHashMap<String, Vec<Object>> = FxHashMap::default();
        for (module, ff) in files {
            let declared = ff
                .facades
                .keys()
                .chain(ff.aliases.keys())
                .chain(ff.compose.iter().filter_map(|family| family.family_binding.as_ref()));
            let exported = ff.exports.iter().filter(|export| export.source.is_none()).map(|export| &export.exported);
            for name in declared.chain(exported) {
                if let Some(object) = self.exported_object(module, name).or_else(|| self.local_object(module, name)) {
                    let objects = by_name.entry(name.clone()).or_default();
                    if !objects.contains(&object) {
                        objects.push(object);
                    }
                }
            }
        }
        by_name
    }
}

/// The module `module` exports as the namespace `name`, as the module
/// table resolves it: a module namespace, or a binding that holds one
/// (`import * as ns …; export default ns`). An absent, ambiguous or open
/// answer, and any other binding, are no namespace.
pub(crate) fn namespace_export(
    module: String,
    name: String,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    links: &crate::link::ProjectLinks,
) -> Option<String> {
    match links.resolve_export(&module, &name)? {
        ExportLookup::Resolved(Terminal::Namespace(target)) => Some(links.paths[target].clone()),
        ExportLookup::Resolved(Terminal::Local { module: declaring, binding }) => {
            let (path, held) = crate::analyze_css::binding_name(links, files, declaring, binding);
            held_namespace(&path, files.get(&path)?, &held, files, inputs)
        }
        _ => None,
    }
}

/// The module the binding `binding` of `file` holds as a namespace import.
pub(crate) fn held_namespace(
    file: &str,
    ff: &FileFacts,
    binding: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> Option<String> {
    resolve_import_source(file, ff.namespace_imports.get(binding)?, files, inputs)
}

/// The module a local binding of `file` holds as a namespace: a namespace
/// import, or a named import of a namespace another module exports, as the
/// module table resolves it, directly or through top-level `const` aliases
/// (`const r = ui`).
pub(crate) fn local_namespace(
    file: &str,
    ff: &FileFacts,
    local: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    links: &crate::link::ProjectLinks,
) -> Option<String> {
    let mut local = local;
    let mut seen = BTreeSet::new();
    while let Some(target) = ff.aliases.get(local) {
        // A cycle of aliases holds nothing.
        if !seen.insert(local) {
            return None;
        }
        local = target;
    }
    if ff.namespace_imports.contains_key(local) {
        return held_namespace(file, ff, local, files, inputs);
    }
    let import = ff.import_of(local)?;
    imported_namespace(file, import, files, inputs, links)
}

/// The module the named import `import` of `file` binds as a namespace
/// another module exports, as `local_namespace` finds it for that import.
pub(crate) fn imported_namespace(
    file: &str,
    import: &crate::usage_facts::ImportFact,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    links: &crate::link::ProjectLinks,
) -> Option<String> {
    let module = resolve_import_source(file, &import.source, files, inputs)?;
    namespace_export(module, import.imported.clone(), files, inputs, links)
}

/// Every name `module` exports, including through its `export *` sources,
/// which never carry a default export.
pub(crate) fn module_export_names(module: &str, links: &crate::link::ProjectLinks) -> BTreeSet<String> {
    // A module outside the analysis exports nothing it can name.
    links.module(module).map_or_else(BTreeSet::new, |index| links.table.exported_names(index).names.into_iter().collect())
}
