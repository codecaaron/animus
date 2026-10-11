//! Which binding an export of a module names, as ECMA-262's ResolveExport
//! and GetExportedNames find it, over owned module records. It holds no
//! parser type, so the extractor and this loader link through the same
//! table.
//!
//! A module outside the analysed set is known only by its identity: an
//! import or re-export through it names its export without proving that the
//! export exists, and an `export *` of it is an opening, never an absence.

use std::collections::{BTreeSet, HashSet};

/// A module's position in the table.
pub type ModuleIndex = usize;

/// A request's position in its module's record.
pub type RequestId = usize;

/// What a module request names once resolved.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Request {
    Module(ModuleIndex),
    /// Outside the analysed set, by its resolved identity.
    Outside(String),
    /// Resolved to nothing, by the specifier as written: any export may be
    /// there.
    Unresolved(String),
}

/// The name an import or indirect export reads; `default` is a name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportName {
    Name(String),
    Namespace,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Import<B> {
    pub local: B,
    pub request: RequestId,
    pub name: ImportName,
}

/// One module's runtime imports and exports, its requests as written (`R`
/// is the specifier) or resolved (`Request`). Type-only declarations are
/// left out by whoever copies the record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModuleRecord<B, R = Request> {
    pub requests: Vec<R>,
    pub imports: Vec<Import<B>>,
    /// Export name and the local binding it reads.
    pub local_exports: Vec<(String, B)>,
    /// Export name, and the request and name it re-exports.
    pub indirect_exports: Vec<(String, RequestId, String)>,
    /// Export name and the request whose namespace it is: `export * as ns
    /// from`, and `export { ns }` of `import * as ns`.
    pub namespace_exports: Vec<(String, RequestId)>,
    pub star_exports: Vec<RequestId>,
    /// The cells `export default` of an expression or an anonymous function
    /// or class writes, which hold the value it had then.
    pub default_cells: Vec<B>,
}

impl<B, R> ModuleRecord<B, R> {
    /// The record with each request resolved by `resolve`.
    pub fn resolved<T>(&self, mut resolve: impl FnMut(&R) -> T) -> ModuleRecord<B, T>
    where
        B: Clone,
    {
        ModuleRecord {
            requests: self.requests.iter().map(&mut resolve).collect(),
            imports: self.imports.clone(),
            local_exports: self.local_exports.clone(),
            indirect_exports: self.indirect_exports.clone(),
            namespace_exports: self.namespace_exports.clone(),
            star_exports: self.star_exports.clone(),
            default_cells: self.default_cells.clone(),
        }
    }
}

/// What an export name resolves to.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Terminal<B> {
    Local { module: ModuleIndex, binding: B },
    Namespace(ModuleIndex),
    /// An export of a module outside the analysed set, or its namespace
    /// (`export: None`). It addresses the export without proving it exists.
    External { module: String, export: Option<String> },
}

/// Why an answer cannot be closed.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum OpeningReason {
    /// `export *` of a module outside the analysed set: any name may come
    /// through it.
    OutsideStar(String),
    /// A request that resolved to nothing.
    UnresolvedRequest(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Opening {
    /// The module whose star is open.
    pub module: ModuleIndex,
    pub reason: OpeningReason,
}

/// The answer to "which binding does export `name` of a module name?".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExportLookup<B> {
    Resolved(Terminal<B>),
    /// No export by that name, with every route closed.
    Absent,
    /// `export *` brings in distinct terminals; the name is not exported.
    Ambiguous(Vec<Terminal<B>>),
    /// An open star may bring in the name, or another terminal for it.
    Incomplete { known: Vec<Terminal<B>>, openings: Vec<Opening> },
}

/// A module's exported names, each once, and whether an open star may add
/// more.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Names {
    pub names: Vec<String>,
    pub openings: Vec<Opening>,
}

impl Names {
    pub fn complete(&self) -> bool {
        self.openings.is_empty()
    }
}

/// Whether a module namespace has a `then` member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NamespaceThen<B> {
    /// Closed: no route brings in `then`, or the routes that do disagree.
    Absent,
    Present(Terminal<B>),
    Incomplete(Vec<Opening>),
}

pub const LINK_ABSENT_IMPORT: &str = "LINK_ABSENT_IMPORT";
pub const LINK_AMBIGUOUS_IMPORT: &str = "LINK_AMBIGUOUS_IMPORT";

/// An import or indirect export that names no export, or an ambiguous one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkError {
    pub code: &'static str,
    pub module: ModuleIndex,
    pub request: RequestId,
    pub name: String,
}

/// How far an opening's unanalysed code can reach.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Exposure {
    Modules(BTreeSet<ModuleIndex>),
    AllImportableCapturedModules,
}

/// An opening with its exposure, and the modules whose exported names
/// depend on it through `export *`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModuleOpening {
    pub opening: Opening,
    pub exposure: Exposure,
    pub unknown_outside_world: bool,
    pub dependents: BTreeSet<ModuleIndex>,
}

/// The linked records of every analysed module.
#[derive(Debug, Clone)]
pub struct ModuleTable<B> {
    modules: Vec<ModuleRecord<B>>,
    /// For each module, the modules that import, re-export or star it.
    dependents: Vec<BTreeSet<ModuleIndex>>,
}

impl<B: Clone + Eq + Ord> ModuleTable<B> {
    pub fn new(modules: Vec<ModuleRecord<B>>) -> Self {
        let mut dependents = vec![BTreeSet::new(); modules.len()];
        for (index, record) in modules.iter().enumerate() {
            for request in &record.requests {
                if let Request::Module(target) = request {
                    dependents[*target].insert(index);
                }
            }
        }
        Self { modules, dependents }
    }

    pub fn record(&self, module: ModuleIndex) -> &ModuleRecord<B> {
        &self.modules[module]
    }

    /// The modules that import, re-export or star `module`.
    pub fn dependents(&self, module: ModuleIndex) -> &BTreeSet<ModuleIndex> {
        &self.dependents[module]
    }

    /// ResolveExport for export `name` of `module`.
    pub fn resolve_export(&self, module: ModuleIndex, name: &str) -> ExportLookup<B> {
        self.resolve(module, name, &mut HashSet::new())
    }

    /// ResolveExport through `module`'s request `request`, as an import or
    /// indirect export of `name` reads it.
    pub fn resolve_request(&self, module: ModuleIndex, request: RequestId, name: &ImportName) -> ExportLookup<B> {
        match (&self.modules[module].requests[request], name) {
            (Request::Module(target), ImportName::Name(name)) => self.resolve_export(*target, name),
            (Request::Module(target), ImportName::Namespace) => ExportLookup::Resolved(Terminal::Namespace(*target)),
            (Request::Outside(identity), ImportName::Name(name)) => {
                ExportLookup::Resolved(Terminal::External { module: identity.clone(), export: Some(name.clone()) })
            }
            (Request::Outside(identity), ImportName::Namespace) => {
                ExportLookup::Resolved(Terminal::External { module: identity.clone(), export: None })
            }
            (Request::Unresolved(specifier), _) => unresolved(module, specifier),
        }
    }

    /// One `set` of (module, name) pairs serves the whole query, forwarded
    /// through every branch: a pair met again resolves to null there, and
    /// null is `Absent`.
    fn resolve(&self, module: ModuleIndex, name: &str, set: &mut HashSet<(ModuleIndex, String)>) -> ExportLookup<B> {
        if !set.insert((module, name.to_string())) {
            return ExportLookup::Absent;
        }
        let record = &self.modules[module];
        let through = |request: RequestId| &record.requests[request];
        if let Some((_, binding)) = record.local_exports.iter().find(|(exported, _)| exported == name) {
            return ExportLookup::Resolved(Terminal::Local { module, binding: binding.clone() });
        }
        if let Some((_, request, imported)) = record.indirect_exports.iter().find(|(exported, ..)| exported == name) {
            return match through(*request) {
                Request::Module(target) => self.resolve(*target, imported, set),
                Request::Outside(identity) => {
                    ExportLookup::Resolved(Terminal::External { module: identity.clone(), export: Some(imported.clone()) })
                }
                Request::Unresolved(specifier) => unresolved(module, specifier),
            };
        }
        if let Some((_, request)) = record.namespace_exports.iter().find(|(exported, _)| exported == name) {
            return match through(*request) {
                Request::Module(target) => ExportLookup::Resolved(Terminal::Namespace(*target)),
                Request::Outside(identity) => {
                    ExportLookup::Resolved(Terminal::External { module: identity.clone(), export: None })
                }
                Request::Unresolved(specifier) => unresolved(module, specifier),
            };
        }
        if name == "default" {
            return ExportLookup::Absent;
        }
        let mut known: Vec<Terminal<B>> = Vec::new();
        let mut openings: Vec<Opening> = Vec::new();
        for &star in &record.star_exports {
            match through(star) {
                Request::Outside(identity) => {
                    openings.push(Opening { module, reason: OpeningReason::OutsideStar(identity.clone()) });
                }
                Request::Unresolved(specifier) => {
                    openings.push(Opening { module, reason: OpeningReason::UnresolvedRequest(specifier.clone()) });
                }
                Request::Module(target) => match self.resolve(*target, name, set) {
                    ExportLookup::Absent => {}
                    ExportLookup::Ambiguous(terminals) => return ExportLookup::Ambiguous(terminals),
                    ExportLookup::Resolved(terminal) => add_terminal(&mut known, terminal),
                    ExportLookup::Incomplete { known: more, openings: open } => {
                        for terminal in more {
                            add_terminal(&mut known, terminal);
                        }
                        openings.extend(open);
                    }
                },
            }
            // Two distinct terminals are ambiguous whatever an open star adds.
            if known.len() > 1 {
                return ExportLookup::Ambiguous(known);
            }
        }
        if !openings.is_empty() {
            openings.sort();
            openings.dedup();
            return ExportLookup::Incomplete { known, openings };
        }
        known.pop().map_or(ExportLookup::Absent, ExportLookup::Resolved)
    }

    /// GetExportedNames for `module`: each name once, `default` never
    /// through a star, with the open stars that may add more.
    pub fn exported_names(&self, module: ModuleIndex) -> Names {
        let mut names = Names { names: Vec::new(), openings: Vec::new() };
        self.collect_names(module, &mut HashSet::new(), &mut HashSet::new(), &mut names, true);
        names
    }

    fn collect_names<'t>(
        &'t self,
        module: ModuleIndex,
        stars: &mut HashSet<ModuleIndex>,
        seen: &mut HashSet<&'t str>,
        out: &mut Names,
        own: bool,
    ) {
        if !stars.insert(module) {
            return;
        }
        let record = &self.modules[module];
        let own_names = record
            .local_exports
            .iter()
            .map(|(name, _)| name)
            .chain(record.indirect_exports.iter().map(|(name, ..)| name))
            .chain(record.namespace_exports.iter().map(|(name, _)| name));
        for name in own_names {
            if (own || name != "default") && seen.insert(name) {
                out.names.push(name.clone());
            }
        }
        for &star in &record.star_exports {
            match &record.requests[star] {
                Request::Outside(identity) => out
                    .openings
                    .push(Opening { module, reason: OpeningReason::OutsideStar(identity.clone()) }),
                Request::Unresolved(specifier) => out
                    .openings
                    .push(Opening { module, reason: OpeningReason::UnresolvedRequest(specifier.clone()) }),
                Request::Module(target) => self.collect_names(*target, stars, seen, out, false),
            }
        }
    }

    /// The members a namespace of `module` has: each exported name that
    /// resolves, with its terminal. Ambiguous and absent names are left out.
    pub fn namespace_members(&self, module: ModuleIndex) -> (Vec<(String, Terminal<B>)>, Vec<Opening>) {
        let Names { names, mut openings } = self.exported_names(module);
        let mut members = Vec::new();
        for name in names {
            match self.resolve_export(module, &name) {
                ExportLookup::Resolved(terminal) => members.push((name, terminal)),
                ExportLookup::Incomplete { openings: open, .. } => openings.extend(open),
                ExportLookup::Absent | ExportLookup::Ambiguous(_) => {}
            }
        }
        openings.sort();
        openings.dedup();
        (members, openings)
    }

    /// Whether `module`'s namespace has a `then` member.
    pub fn namespace_has_then(&self, module: ModuleIndex) -> NamespaceThen<B> {
        match self.resolve_export(module, "then") {
            ExportLookup::Resolved(terminal) => NamespaceThen::Present(terminal),
            ExportLookup::Absent | ExportLookup::Ambiguous(_) => NamespaceThen::Absent,
            ExportLookup::Incomplete { openings, .. } => NamespaceThen::Incomplete(openings),
        }
    }

    /// Each import and indirect export of `module` that names no export of
    /// an analysed module, or an ambiguous one. Outside modules and open
    /// stars fail nothing.
    pub fn link_errors(&self, module: ModuleIndex) -> Vec<LinkError> {
        let record = &self.modules[module];
        let imports = record.imports.iter().filter_map(|import| match &import.name {
            ImportName::Name(name) => Some((import.request, name)),
            ImportName::Namespace => None,
        });
        let reexports = record.indirect_exports.iter().map(|(_, request, name)| (*request, name));
        imports
            .chain(reexports)
            .filter_map(|(request, name)| {
                let Request::Module(target) = &record.requests[request] else { return None };
                let code = match self.resolve_export(*target, name) {
                    ExportLookup::Absent => LINK_ABSENT_IMPORT,
                    ExportLookup::Ambiguous(_) => LINK_AMBIGUOUS_IMPORT,
                    ExportLookup::Resolved(_) | ExportLookup::Incomplete { .. } => return None,
                };
                Some(LinkError { code, module, request, name: name.clone() })
            })
            .collect()
    }

    /// Every open star and unresolved request, with its exposure: with no
    /// captured restriction, unanalysed code may reach every importable
    /// module and the outside world. Its dependents are the modules that
    /// reach it through `export *`, as a fixpoint over star cycles.
    pub fn module_openings(&self) -> Vec<ModuleOpening> {
        let mut star_dependents = vec![BTreeSet::new(); self.modules.len()];
        for (index, record) in self.modules.iter().enumerate() {
            for &star in &record.star_exports {
                if let Request::Module(target) = &record.requests[star] {
                    star_dependents[*target].insert(index);
                }
            }
        }
        let mut out = Vec::new();
        for (module, record) in self.modules.iter().enumerate() {
            let mut closure: Option<BTreeSet<ModuleIndex>> = None;
            let open_stars = record.star_exports.iter().filter_map(|&star| match &record.requests[star] {
                Request::Outside(identity) => Some(OpeningReason::OutsideStar(identity.clone())),
                _ => None,
            });
            let unresolved = record.requests.iter().filter_map(|request| match request {
                Request::Unresolved(specifier) => Some(OpeningReason::UnresolvedRequest(specifier.clone())),
                _ => None,
            });
            for reason in open_stars.chain(unresolved) {
                let dependents = closure
                    .get_or_insert_with(|| {
                        let mut dependents = BTreeSet::from([module]);
                        let mut pending = vec![module];
                        while let Some(next) = pending.pop() {
                            for &dependent in &star_dependents[next] {
                                if dependents.insert(dependent) {
                                    pending.push(dependent);
                                }
                            }
                        }
                        dependents
                    })
                    .clone();
                out.push(ModuleOpening {
                    opening: Opening { module, reason },
                    exposure: Exposure::AllImportableCapturedModules,
                    unknown_outside_world: true,
                    dependents,
                });
            }
        }
        out
    }
}

/// The answer through a request that resolved to nothing: open.
fn unresolved<B>(module: ModuleIndex, specifier: &str) -> ExportLookup<B> {
    let reason = OpeningReason::UnresolvedRequest(specifier.to_string());
    ExportLookup::Incomplete { known: Vec::new(), openings: vec![Opening { module, reason }] }
}

fn add_terminal<B: PartialEq>(known: &mut Vec<Terminal<B>>, terminal: Terminal<B>) {
    if !known.contains(&terminal) {
        known.push(terminal);
    }
}
