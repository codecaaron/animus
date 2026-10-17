//! Bounded loading: a load reads and runs only the modules the exported
//! system value reaches (the owner's contract for the system loader).
//!
//! A module is acquired at the level a question needs. It is *resolved* when
//! a request names it, *routed* when an export name's route passes through it
//! (read and parsed once, never run), and *retained* when it declares a
//! binding the system reaches (stripped, linked whole and run). A retained
//! module reaches the imports its body references; a bare import, or one its
//! body never reads, is not followed. The system is the entry export a
//! static classification names, or the export the host selects.

use std::collections::VecDeque;
use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::{
    BindingPattern, Declaration, ExportDefaultDeclarationKind, Expression, ImportDeclarationSpecifier, ObjectPropertyKind,
    Program, PropertyKey, Statement,
};
use oxc::ast::AstKind;
use oxc::parser::Parser;
use oxc::semantic::SemanticBuilder;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::module_table::{ExportLookup, Import, ImportName, ModuleRecord, ModuleTable, OpeningReason, Request, Terminal};
use crate::linked::source_type;
use crate::{
    absent_relative_candidates, asset_import_reason, is_runtime_stub_specifier, looks_like_commonjs, module_export_name,
    real_path_string, resolution, resolve_bare_specifier_observed, resolve_relative, strip_typescript_module, stub_key,
    type_only_export_names, LoadReads, RelativeMiss, ResolutionContext,
};

/// What a load selected: the modules to run and the routes their imports
/// take.
pub(crate) struct Selection<'c> {
    /// Each retained module's linked source, parsed and analysed once, in
    /// the load's arena: linking reads it rather than parsing it again.
    pub analyses: FxHashMap<String, Analysis<'c>>,
    pub entry: String,
    /// The system's export name on the entry.
    pub root: String,
    /// Each retained module's source as linked: stripped for TypeScript.
    pub retained: FxHashMap<String, String>,
    /// Each routed module's record, its requests resolved to module keys:
    /// read for its routes and its place in evaluation order, never run.
    pub routed: FxHashMap<String, ModuleRecord<String, String>>,
    pub specifier_map: FxHashMap<(String, String), String>,
    pub stub_exports: FxHashMap<String, FxHashSet<String>>,
    /// The names of each retained module asked beyond its local exports: the
    /// entry's system and companions, and every name of a namespace the
    /// system uses whole.
    pub asked: FxHashMap<String, FxHashSet<String>>,
    /// Each global style registration's declaring module and export, by its
    /// registered name, where the registration names a binding.
    pub global_origins: FxHashMap<String, (String, String)>,
}

impl std::fmt::Debug for Selection<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Selection").field("entry", &self.entry).field("root", &self.root).finish_non_exhaustive()
    }
}

/// A module's linked source, parsed, with its semantic analysis.
pub(crate) struct Analysis<'c> {
    pub source: &'c str,
    pub program: &'c Program<'c>,
    pub semantic: oxc::semantic::Semantic<'c>,
}

/// What a request resolved to.
#[derive(Clone)]
enum Target {
    Module(String),
    Stub(String),
    /// Resolved to nothing usable, with why: fatal only for a reached import.
    Failed(String),
}

struct Module<'c> {
    retained: bool,
    /// The source as read.
    raw: String,
    /// The source as linked: stripped once retained.
    source: String,
    record: ModuleRecord<String, String>,
    /// What its body reads of its imports, once read from what runs: at once
    /// for plain JavaScript, on retaining for TypeScript.
    usage: Option<Usage>,
    /// What runs, parsed and analysed, once read.
    analysis: Option<Analysis<'c>>,
}

/// What a module's body reads of its imports, by request, and the first
/// construction the loader cannot run as selected, if any.
#[derive(Clone)]
struct Usage {
    reads: Vec<(String, Read)>,
    refused: Option<String>,
}

/// How a body reads one import binding.
#[derive(Clone)]
enum Read {
    /// A named or default import, by the name its module exports.
    Name(String),
    /// A namespace read only through these static members.
    Members(Vec<String>),
    /// A namespace used whole.
    Whole,
}

/// One unit of work: a module to retain, an export to resolve and retain
/// the binding of, or a namespace to build whole.
enum Need {
    Retain(String),
    /// The theme companions of a module another package's import names: its
    /// `theme` and `tokens`, the token-ownership evidence of the package
    /// whose system the lineage reads.
    Companions(String),
    Ask { importer: String, module: String, name: String },
    Namespace(String),
}

/// A value export's class, for root inference.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Class {
    /// A system, by the declaration that creates it (`module#binding`), so
    /// `const` aliases of one system are one candidate.
    System(String),
    NotSystem,
    /// A value that holds no system as written (an object, array, function,
    /// class or element): not a system unless something writes the protocol
    /// onto it, through its binding or an alias.
    Value,
    Unknown(String),
}

const PENDING: &str = "\u{0}pending:";
const FAILED: &str = "\u{0}failed:";

pub(crate) struct Loader<'c> {
    context: &'c ResolutionContext,
    /// The load's arena: each module's source as read is parsed into it once.
    arena: &'c Allocator,
    programs: FxHashMap<String, &'c Program<'c>>,
    reads: LoadReads,
    modules: FxHashMap<String, Module<'c>>,
    targets: FxHashMap<(String, String), Target>,
    /// Each module a bare specifier outside Animus resolved to, by that
    /// specifier: a CommonJS one is refused.
    external: FxHashMap<String, String>,
    stub_exports: FxHashMap<String, FxHashSet<String>>,
    type_exports: FxHashMap<String, FxHashSet<String>>,
    asked: FxHashMap<String, FxHashSet<String>>,
    table: Option<Linked>,
    /// The nearest `package.json` of each directory asked: its directory and
    /// name.
    packages: FxHashMap<std::path::PathBuf, (Option<std::path::PathBuf>, Option<String>)>,
    /// The owner package directories, once the audit has found them.
    owners: FxHashSet<std::path::PathBuf>,
    /// The root of the monorepo the entry's package belongs to, at its real
    /// path: every module below it outside `node_modules` is owned too.
    workspace: Option<std::path::PathBuf>,
    /// Whether the audit is running: it reads no third-party package.
    auditing: bool,
    /// Each binding's class, as root inference found it.
    classes: FxHashMap<(String, String), Class>,
    /// Whether each binding holds an Animus value, as traced.
    traced: FxHashMap<(String, String), bool>,
}

/// The table over every acquired module, with its key order.
struct Linked {
    table: ModuleTable<String>,
    keys: Vec<String>,
    index: FxHashMap<String, usize>,
}

impl<'c> Loader<'c> {
    pub fn new(context: &'c ResolutionContext, arena: &'c Allocator) -> Self {
        Self {
            context,
            arena,
            programs: FxHashMap::default(),
            reads: LoadReads::default(),
            modules: FxHashMap::default(),
            targets: FxHashMap::default(),
            external: FxHashMap::default(),
            stub_exports: FxHashMap::default(),
            type_exports: FxHashMap::default(),
            asked: FxHashMap::default(),
            table: None,
            packages: FxHashMap::default(),
            owners: FxHashSet::default(),
            workspace: None,
            auditing: false,
            classes: FxHashMap::default(),
            traced: FxHashMap::default(),
        }
    }

    /// What the load read and looked for, whether or not it succeeded.
    pub fn into_reads(self) -> LoadReads {
        self.reads
    }

    /// Selects what the system exported from `entry` reaches: `export_name`,
    /// or the export root inference names.
    pub fn select(&mut self, entry: &str, export_name: Option<&str>) -> Result<Selection<'c>, String> {
        let selected = self.select_reached(entry, export_name);
        // A failed load still reports what it found in the owned code it read.
        if selected.is_err() {
            self.audit(entry, export_name.unwrap_or("the system"));
        }
        selected
    }

    fn select_reached(&mut self, entry: &str, export_name: Option<&str>) -> Result<Selection<'c>, String> {
        self.retain(entry)?;
        let root = match export_name {
            Some(name) => name.to_string(),
            None => self.infer_root(entry)?,
        };
        let mut work: VecDeque<Need> = VecDeque::new();
        work.extend(self.reached_imports(entry)?);
        let entry_names = self.exported_names(entry)?;
        if !entry_names.contains(&root) {
            return Err(format!("export '{root}' not found on the system entry '{entry}'"));
        }
        for name in std::iter::once(root.as_str()).chain(["theme", "tokens"]) {
            if entry_names.iter().any(|exported| exported == name) {
                self.asked.entry(entry.to_string()).or_default().insert(name.to_string());
                work.push_back(Need::Ask { importer: entry.to_string(), module: entry.to_string(), name: name.to_string() });
            }
        }
        self.run(work)?;
        self.audit(entry, &root);
        self.selection(entry, root)
    }

    /// Answers every need: retains what is due, then answers every waiting
    /// question against one table, then reads every module an answer waits
    /// on, together, in rounds: one round per depth of route, not per module.
    fn run(&mut self, mut work: VecDeque<Need>) -> Result<(), String> {
        let mut namespaces: FxHashSet<String> = FxHashSet::default();
        let mut companions: FxHashSet<String> = FxHashSet::default();
        let (mut asks, mut spaces): (Vec<(String, String, String)>, Vec<String>) = (Vec::new(), Vec::new());
        loop {
            while let Some(need) = work.pop_front() {
                match need {
                    Need::Retain(path) => {
                        if !self.modules.get(&path).is_some_and(|module| module.retained) {
                            self.retain(&path)?;
                            work.extend(self.reached_imports(&path)?);
                        }
                    }
                    Need::Ask { importer, module, name } => asks.push((importer, module, name)),
                    Need::Companions(path) => {
                        if companions.insert(path.clone()) {
                            for name in self.exported_names(&path)? {
                                if name == "theme" || name == "tokens" {
                                    asks.push((path.clone(), path.clone(), name));
                                }
                            }
                        }
                    }
                    Need::Namespace(path) => {
                        if namespaces.insert(path.clone()) {
                            work.push_back(Need::Retain(path.clone()));
                            spaces.push(path);
                        }
                    }
                }
            }
            if asks.is_empty() && spaces.is_empty() {
                break;
            }
            let mut pending: FxHashSet<String> = FxHashSet::default();
            let mut waiting_spaces = Vec::new();
            for path in std::mem::take(&mut spaces) {
                match self.names_now(&path) {
                    Ok(names) => {
                        for name in names {
                            self.asked.entry(path.clone()).or_default().insert(name.clone());
                            asks.push((path.clone(), path.clone(), name));
                        }
                    }
                    Err(wait) => {
                        pending.extend(wait);
                        waiting_spaces.push(path);
                    }
                }
            }
            let mut waiting = Vec::new();
            for (importer, module, name) in std::mem::take(&mut asks) {
                match self.lookup_now(&module, &name) {
                    Ok(ExportLookup::Resolved(Terminal::Local { module: at, .. })) => work.push_back(Need::Retain(self.key(at))),
                    Ok(ExportLookup::Resolved(Terminal::Namespace(at))) => work.push_back(Need::Namespace(self.key(at))),
                    Ok(ExportLookup::Resolved(Terminal::External { module: stub, export })) => {
                        self.stub_exports.entry(stub).or_default().extend(export);
                    }
                    Ok(lookup) => self.unlinked(&importer, &module, &name, lookup)?,
                    Err(wait) => {
                        pending.extend(wait);
                        waiting.push((importer, module, name));
                    }
                }
            }
            for path in pending {
                self.acquire(&path)?;
            }
            asks = waiting;
            spaces = waiting_spaces;
        }
        Ok(())
    }

    /// Everything the entry's own imports reach, with no system root: the
    /// selection a module graph's tests read.
    #[cfg(test)]
    pub(crate) fn reach_all(&mut self, entry: &str) -> Result<Selection<'c>, String> {
        self.retain(entry)?;
        let work: VecDeque<Need> = self.reached_imports(entry)?.into();
        self.run(work)?;
        self.selection(entry, String::new())
    }

    /// The selection, with every request of every acquired module resolved
    /// to the key the linker registers it by.
    fn selection(&mut self, entry: &str, root: String) -> Result<Selection<'c>, String> {
        let mut specifier_map = FxHashMap::default();
        let mut retained = FxHashMap::default();
        let mut analyses = FxHashMap::default();
        let mut routed = FxHashMap::default();
        let paths: Vec<String> = self.modules.keys().cloned().collect();
        for path in paths {
            let specs = self.modules[&path].record.requests.clone();
            for spec in &specs {
                if let Target::Module(target) = self.target(&path, spec) {
                    if self.modules.contains_key(&target) {
                        specifier_map.insert((path.clone(), spec.clone()), target);
                    }
                }
            }
            let module = self.modules.get_mut(&path).expect("listed above");
            if module.retained {
                retained.insert(path.clone(), module.source.clone());
                if let Some(analysis) = module.analysis.take() {
                    analyses.insert(path.clone(), analysis);
                }
            } else {
                routed.insert(path.clone(), module.record.clone());
            }
        }
        Ok(Selection {
            analyses,
            entry: entry.to_string(),
            root,
            retained,
            routed,
            specifier_map,
            stub_exports: std::mem::take(&mut self.stub_exports),
            asked: std::mem::take(&mut self.asked),
            global_origins: self.global_origins()?,
        })
    }

    /// Where each registered global style block is declared: for every
    /// `registerGlobalStyles({ name: binding })` a retained module makes on an
    /// Animus value, the module that declares the binding and its export of
    /// it (the one named like the registration, else the first). A name two
    /// registrations give different origins is left to content.
    fn global_origins(&mut self) -> Result<FxHashMap<String, (String, String)>, String> {
        let mut origins: FxHashMap<String, Option<(String, String)>> = FxHashMap::default();
        let mut retained: Vec<String> = self.modules.iter().filter(|(_, module)| module.retained).map(|(path, _)| path.clone()).collect();
        retained.sort();
        for path in retained {
            // A module that never names the method makes no registration.
            if !self.modules[&path].raw.contains("registerGlobalStyles") {
                continue;
            }
            let program = self.program(&path);
            let semantic = SemanticBuilder::new().with_build_nodes(true).build(program).semantic;
            let calls: Vec<&oxc::ast::ast::CallExpression<'_>> = semantic
                .nodes()
                .iter()
                .filter_map(|node| match node.kind() {
                    AstKind::CallExpression(call) => Some(call),
                    _ => None,
                })
                .collect();
            for call in calls {
                let Some(member) = call.callee.get_inner_expression().as_member_expression() else { continue };
                if member.static_property_name() != Some("registerGlobalStyles")
                    || !self.animus_value(&path, program, member.object(), 0)?
                {
                    continue;
                }
                let Some(Expression::ObjectExpression(argument)) = call.arguments.first().and_then(|a| a.as_expression()) else {
                    continue;
                };
                for property in &argument.properties {
                    let ObjectPropertyKind::ObjectProperty(property) = property else { continue };
                    let (Some(name), Expression::Identifier(value)) = (property.key.static_name(), property.value.get_inner_expression())
                    else {
                        continue;
                    };
                    let origin = self.declared_export(&path, program, &value.name, &name)?;
                    let slot = origins.entry(name.to_string()).or_insert_with(|| origin.clone());
                    if *slot != origin {
                        *slot = None;
                    }
                }
            }
        }
        Ok(origins.into_iter().filter_map(|(name, origin)| origin.map(|origin| (name, origin))).collect())
    }

    /// The module that declares `local` of `module`, through imports, and its
    /// export of that binding: the one named `prefer`, else the first.
    fn declared_export(&mut self, module: &str, program: &Program<'_>, local: &str, prefer: &str) -> Result<Option<(String, String)>, String> {
        let (declaring, binding) = match declaration(program, local) {
            Some(Decl::Import { spec, name: Some(name) }) => match self.imported(module, &spec, &name)? {
                Some(terminal) => terminal,
                None => return Ok(None),
            },
            Some(Decl::Import { .. }) | None => return Ok(None),
            Some(_) => (module.to_string(), local.to_string()),
        };
        let exports = &self.modules[&declaring].record.local_exports;
        let export = exports
            .iter()
            .find(|(exported, bound)| exported == prefer && *bound == binding)
            .or_else(|| exports.iter().find(|(_, bound)| *bound == binding))
            .map(|(exported, _)| exported.clone());
        Ok(export.map(|export| (declaring, export)))
    }

    /// Fails a reached import or export that links to nothing, as Node
    /// fails to link it.
    fn unlinked(&mut self, importer: &str, module: &str, name: &str, lookup: ExportLookup<String>) -> Result<(), String> {
        use crate::module_table::{LINK_ABSENT_IMPORT, LINK_AMBIGUOUS_IMPORT};
        // A type a TypeScript module exports, imported without `type`: the
        // strip erases it, so it links to nothing and fails nothing. Its
        // types are read from its source as written.
        if matches!(lookup, ExportLookup::Absent) && is_typescript(module) {
            if !self.type_exports.contains_key(module) {
                let types = type_only_export_names(&self.modules[module].raw, module);
                self.type_exports.insert(module.to_string(), types);
            }
            if self.type_exports[module].contains(name) {
                return Ok(());
            }
        }
        let (code, problem) = match lookup {
            ExportLookup::Ambiguous(_) => (LINK_AMBIGUOUS_IMPORT, "which resolves it ambiguously through `export *`"),
            ExportLookup::Incomplete { openings, .. } => {
                // A request that resolved to nothing usable: its own reason.
                if let Some(reason) = openings.iter().find_map(|opening| match &opening.reason {
                    OpeningReason::UnresolvedRequest(marker) => marker.strip_prefix(FAILED),
                    OpeningReason::OutsideStar(_) => None,
                }) {
                    return Err(reason.to_string());
                }
                (LINK_ABSENT_IMPORT, "which does not export it")
            }
            _ => (LINK_ABSENT_IMPORT, "which does not export it"),
        };
        // A name the module re-exports fails at that re-export, as Node
        // names it.
        if self.modules[module].record.indirect_exports.iter().any(|(exported, ..)| exported == name) {
            let problem = if code == LINK_ABSENT_IMPORT { "which resolves to no binding" } else { problem };
            return Err(format!(
                "module '{module}' re-exports '{name}', {problem} ({code}); the system loader links this module graph \
                 as Node does, and Node rejects this too"
            ));
        }
        Err(format!(
            "module '{importer}' imports '{name}' from '{module}', {problem} ({code}); the system loader links this \
             module graph as Node does, and Node rejects this too"
        ))
    }

    fn key(&self, at: usize) -> String {
        self.table.as_ref().map(|linked| linked.keys[at].clone()).expect("a lookup built the table")
    }

    /// What `spec`, written in `importer`, resolves to; recorded once.
    fn target(&mut self, importer: &str, spec: &str) -> Target {
        let key = (importer.to_string(), spec.to_string());
        if let Some(target) = self.targets.get(&key) {
            return target.clone();
        }
        let target = self.resolve(importer, spec);
        self.targets.insert(key, target.clone());
        target
    }

    fn resolve(&mut self, importer: &str, spec: &str) -> Target {
        let dir = Path::new(importer).parent().unwrap_or_else(|| Path::new("."));
        // Crawling an asset import yields an exports-less module whose
        // `.default` is undefined — the least debuggable failure there is.
        if let Some(reason) = asset_import_reason(spec) {
            return Target::Failed(format!(
                "asset import '{spec}' in '{importer}' cannot traverse system evaluation ({reason}); reference \
                 package-owned assets with asset('<specifier>') from @animus-ui/system, or use a literal URL string \
                 (e.g. '/fonts/inter.woff2') — the host bundler's asset pipeline owns resolution"
            ));
        }
        if spec.starts_with('.') || spec.starts_with('/') {
            let resolution = resolve_relative(dir, spec, &self.context.extensions);
            self.reads.missing.extend(absent_relative_candidates(
                dir,
                spec,
                &self.context.extensions,
                resolution.as_ref().ok().map(String::as_str),
            ));
            return match resolution {
                Ok(resolved) => Target::Module(real_path_string(resolved.into())),
                Err(RelativeMiss::CaseMismatch(reason)) => Target::Failed(reason),
                Err(RelativeMiss::Absent) => Target::Failed(format!(
                    "relative import '{spec}' in '{importer}' names no file, and the module evaluates it (it is \
                     not a type-only import), so the system cannot load — check the path and the file's extension"
                )),
            };
        }
        if spec.starts_with("node:") {
            return Target::Failed(format!(
                "Node builtin '{spec}' imported by '{importer}' is not available in the system loader sandbox; \
                 system modules must evaluate without Node APIs — move this dependency out of the system entry's \
                 module graph"
            ));
        }
        if is_runtime_stub_specifier(spec) {
            return Target::Stub(stub_key(spec));
        }
        match resolve_bare_specifier_observed(spec, &dir.to_string_lossy(), self.context, &mut self.reads) {
            Ok((resolved, manifest)) => {
                let canonical = real_path_string(resolved.into());
                let manifest = real_path_string(manifest);
                self.reads.read.insert(manifest);
                if !spec.starts_with("@animus-ui/") {
                    self.external.insert(canonical.clone(), spec.to_string());
                }
                Target::Module(canonical)
            }
            Err(e) => Target::Failed(format!(
                "failed to resolve package '{spec}' imported by '{importer}': {e}. Is the package built? (run bun \
                 run build:ts) If it is not needed to evaluate the system, add it to the runtime stub list \
                 (RUNTIME_STUB_SPECIFIERS in the system loader)."
            )),
        }
    }

    /// Reads `path` for its routes: parsed once, never run.
    fn acquire(&mut self, path: &str) -> Result<(), String> {
        if self.modules.contains_key(path) {
            return Ok(());
        }
        self.reads.read.insert(path.to_string());
        let raw = resolution::read_source(path).map_err(|e| format!("failed to read '{path}': {e}"))?;
        if let Some(spec) = self.external.get(path) {
            if looks_like_commonjs(&raw, path) {
                return Err(format!(
                    "CommonJS module '{spec}' (resolved to '{path}') cannot be evaluated in the system loader; add \
                     it to the runtime stub list or use an ESM entry"
                ));
            }
        }
        // Plain JavaScript runs as read, so one reading serves its routes and
        // its reach.
        let (record, usage, analysis) =
            if is_typescript(path) { (record_of(&raw, path), None, None) } else { self.analyse(&raw, path) };
        self.modules.insert(path.to_string(), Module { retained: false, source: raw.clone(), raw, record, usage, analysis });
        self.table = None;
        Ok(())
    }

    /// Reads `path` whole, to run it: stripped, its record taken from what
    /// runs.
    fn retain(&mut self, path: &str) -> Result<(), String> {
        self.acquire(path)?;
        if self.modules[path].retained {
            return Ok(());
        }
        // Plain JavaScript runs as read, so its record stands.
        if is_typescript(path) {
            let source = strip_typescript_module(&self.modules[path].raw, path)?;
            let (record, usage, analysis) = self.analyse(&source, path);
            let module = self.modules.get_mut(path).expect("acquired above");
            module.record = record;
            module.usage = usage;
            module.analysis = analysis;
            module.source = source;
        }
        self.modules.get_mut(path).expect("acquired above").retained = true;
        self.table = None;
        Ok(())
    }

    /// The imports a retained module's body reads: each named or default
    /// import it references, and each namespace import by the members it
    /// reads, or whole when it uses the namespace otherwise. A reached import
    /// that resolves to nothing usable fails the load; a bare import and an
    /// import the body never reads are not followed.
    fn reached_imports(&mut self, path: &str) -> Result<Vec<Need>, String> {
        let usage = self.modules[path].usage.clone().expect("a retained module's usage is read");
        if let Some(refused) = usage.refused {
            return Err(refused);
        }
        let mut needs = Vec::new();
        for (spec, read) in usage.reads {
            let target = match self.target(path, &spec) {
                Target::Failed(reason) => return Err(reason),
                Target::Stub(key) => {
                    let names = self.stub_exports.entry(key).or_default();
                    if let Read::Name(name) = read {
                        names.insert(name);
                    }
                    continue;
                }
                Target::Module(target) => target,
            };
            self.acquire(&target)?;
            if self.package_dir(Path::new(&target)) != self.package_dir(Path::new(path)) {
                needs.push(Need::Companions(target.clone()));
            }
            let ask = |name: String| Need::Ask { importer: path.to_string(), module: target.clone(), name };
            match read {
                Read::Name(name) => needs.push(ask(name)),
                Read::Members(members) => needs.extend(members.into_iter().map(ask)),
                Read::Whole => needs.push(Need::Namespace(target)),
            }
        }
        Ok(needs)
    }

    /// The table over every acquired module, rebuilt when a module was read.
    fn linked(&mut self) -> &Linked {
        if self.table.is_none() {
            let mut keys: Vec<String> = self.modules.keys().cloned().collect();
            keys.sort();
            let index: FxHashMap<String, usize> = keys.iter().enumerate().map(|(at, key)| (key.clone(), at)).collect();
            let mut records = Vec::with_capacity(keys.len());
            for key in &keys {
                let specs = self.modules[key].record.requests.clone();
                let mut targets = specs.iter().map(|spec| self.target(key, spec)).collect::<Vec<_>>().into_iter();
                records.push(self.modules[key].record.resolved(|_| match targets.next().expect("one target per request") {
                    Target::Module(path) => match index.get(&path) {
                        Some(&at) => Request::Module(at),
                        None => Request::Unresolved(format!("{PENDING}{path}")),
                    },
                    Target::Stub(stub) => Request::Outside(stub),
                    Target::Failed(reason) => Request::Unresolved(format!("{FAILED}{reason}")),
                }));
            }
            self.table = Some(Linked { table: ModuleTable::new(records), keys, index });
        }
        self.table.as_ref().expect("built above")
    }

    /// Export `name` of `module`, reading each module the answer waits on
    /// until no route is pending. A star of a stub supplies the name when no
    /// analysed branch does.
    fn lookup(&mut self, module: &str, name: &str) -> Result<ExportLookup<String>, String> {
        self.settle(|loader| loader.lookup_now(module, name))
    }

    /// `answer`, asked again after reading each module it waits on, until it
    /// waits on none.
    fn settle<T>(&mut self, mut answer: impl FnMut(&mut Self) -> Result<T, Vec<String>>) -> Result<T, String> {
        loop {
            match answer(self) {
                Ok(answered) => return Ok(answered),
                Err(pending) => {
                    for path in pending {
                        self.acquire(&path)?;
                    }
                }
            }
        }
    }

    /// Export `name` of `module` against the table as read so far, or the
    /// modules the answer waits on.
    fn lookup_now(&mut self, module: &str, name: &str) -> Result<ExportLookup<String>, Vec<String>> {
        let linked = self.linked();
        let lookup = linked.table.resolve_export(linked.index[module], name);
        let ExportLookup::Incomplete { known, openings } = lookup else { return Ok(lookup) };
        let pending = pending_of(&openings);
        if pending.is_empty() {
            return Ok(close_stub_stars(known, openings, name, &self.stub_exports));
        }
        Err(pending)
    }

    /// Every export name of `module`, reading star targets until the list is
    /// closed.
    fn exported_names(&mut self, module: &str) -> Result<Vec<String>, String> {
        self.settle(|loader| loader.names_now(module))
    }

    /// Every export name of `module` against the table as read so far, or
    /// the modules the list waits on.
    fn names_now(&mut self, module: &str) -> Result<Vec<String>, Vec<String>> {
        let linked = self.linked();
        let names = linked.table.exported_names(linked.index[module]);
        let pending = pending_of(&names.openings);
        if pending.is_empty() { Ok(names.names) } else { Err(pending) }
    }

    /// The (module, binding) export `name` of `module` declares, if it
    /// resolves to a local binding.
    fn terminal(&mut self, module: &str, name: &str) -> Result<Option<(String, String)>, String> {
        Ok(match self.lookup(module, name)? {
            ExportLookup::Resolved(Terminal::Local { module: at, binding }) => Some((self.key(at), binding)),
            _ => None,
        })
    }

    /// The entry's system export: the one export whose terminal is an Animus
    /// `.seal()`, when every other value export is provably not a system.
    /// Any other outcome is a located error asking for the export by name.
    fn infer_root(&mut self, entry: &str) -> Result<String, String> {
        let names = self.exported_names(entry)?;
        let mut candidates: Vec<(String, Vec<String>)> = Vec::new();
        let mut unknown: Vec<String> = Vec::new();
        for name in names {
            match self.class_of_export(entry, &name, 0)? {
                Class::System(origin) => match candidates.iter_mut().find(|(at, _)| *at == origin) {
                    Some((_, names)) => names.push(name),
                    None => candidates.push((origin, vec![name])),
                },
                Class::NotSystem | Class::Value => {}
                Class::Unknown(why) => unknown.push(format!("'{name}' ({why})")),
            }
        }
        if candidates.len() == 1 && unknown.is_empty() {
            return Ok(candidates.remove(0).1.remove(0));
        }
        let found = if candidates.is_empty() {
            "no export is a sealed system (`.seal()`)".to_string()
        } else {
            let names: Vec<String> = candidates.iter().map(|(_, names)| format!("'{}'", names.join("' = '"))).collect();
            format!("the sealed system candidates are {}", names.join(", "))
        };
        let unknown =
            if unknown.is_empty() { String::new() } else { format!(", and these exports may be one: {}", unknown.join(", ")) };
        Err(format!(
            "the system entry '{entry}' does not name its system: {found}{unknown}. Name the system's export with \
             the `systemExport` option (animus.system.export-uncertain)"
        ))
    }

    /// The class of export `name` of `module`.
    fn class_of_export(&mut self, module: &str, name: &str, depth: usize) -> Result<Class, String> {
        if depth > 64 {
            return Ok(Class::Unknown("too deep a route".to_string()));
        }
        Ok(match self.lookup(module, name)? {
            ExportLookup::Resolved(Terminal::Local { module: at, binding }) => {
                let key = self.key(at);
                self.class_of_binding(&key, &binding, depth + 1)?
            }
            ExportLookup::Resolved(Terminal::Namespace(_)) => Class::NotSystem,
            ExportLookup::Resolved(Terminal::External { .. }) => Class::NotSystem,
            _ => Class::Unknown("an export that does not resolve".to_string()),
        })
    }

    /// The class of binding `local` declared in `module`, once per load.
    fn class_of_binding(&mut self, module: &str, local: &str, depth: usize) -> Result<Class, String> {
        let key = (module.to_string(), local.to_string());
        if let Some(class) = self.classes.get(&key) {
            return Ok(class.clone());
        }
        let class = self.parsed(module, |loader, program| loader.classify_binding(module, program, local, depth))?;
        self.classes.insert(key, class.clone());
        Ok(class)
    }

    fn classify_binding(&mut self, module: &str, program: &Program<'_>, local: &str, depth: usize) -> Result<Class, String> {
        let class = match declaration(program, local) {
            None => Class::Unknown(format!("no declaration of '{local}'")),
            Some(Decl::NotSystem) => Class::NotSystem,
            Some(Decl::Rebound) => Class::Unknown(format!("'{local}' is reassigned where the loader cannot read its value")),
            Some(Decl::Value) => Class::Value,
            Some(Decl::Class(class)) => class_shape(class),
            Some(Decl::Init(init)) => self.class_of_expression(module, program, init, depth)?,
            Some(Decl::Assigned(values)) if values.len() == 1 => self.class_of_expression(module, program, values[0], depth)?,
            Some(Decl::Assigned(_)) => Class::Unknown(format!("'{local}' is assigned more than once")),
            Some(Decl::Destructured { key, from }) => {
                if non_sealing_method(&key) && self.animus_value(module, program, from, depth)? {
                    Class::NotSystem
                } else {
                    Class::Unknown(format!("'{local}' is destructured from a value not traced to Animus"))
                }
            }
            Some(Decl::Import { spec, name }) => match self.target(module, &spec) {
                Target::Module(path) => {
                    self.acquire(&path)?;
                    match name {
                        Some(name) => self.class_of_export(&path, &name, depth + 1)?,
                        None => Class::NotSystem,
                    }
                }
                Target::Stub(_) => Class::NotSystem,
                Target::Failed(_) => Class::Unknown(format!("'{local}' is imported from an unresolved module")),
            },
        };
        // A value is no system only when nothing writes the protocol onto it:
        // no member write or `Object.assign`-like call through its binding
        // or a `const` alias of it.
        if class == Class::Value {
            return Ok(if written_after(program, local) {
                Class::Unknown(format!("'{local}' is written after its declaration, directly or through an alias"))
            } else {
                Class::NotSystem
            });
        }
        // A system created here is known by this declaration; one an alias
        // reads keeps the declaration that created it.
        Ok(match class {
            Class::System(origin) if origin.is_empty() => Class::System(format!("{module}#{local}")),
            class => class,
        })
    }

    fn class_of_expression(
        &mut self,
        module: &str,
        program: &Program<'_>,
        expression: &Expression<'_>,
        depth: usize,
    ) -> Result<Class, String> {
        let expression = expression.get_inner_expression();
        Ok(match expression {
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::BinaryExpression(_)
            | Expression::UnaryExpression(_) => Class::NotSystem,
            Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::JSXElement(_)
            | Expression::JSXFragment(_)
            | Expression::ArrayExpression(_) => Class::Value,
            Expression::ClassExpression(class) => class_shape(class),
            Expression::ObjectExpression(object) => {
                let key = |property: &PropertyKey<'_>| property.static_name().map(|name| name.to_string());
                let mut class = Class::Value;
                for property in &object.properties {
                    match property {
                        ObjectPropertyKind::ObjectProperty(property) => {
                            if property.computed {
                                return Ok(Class::Unknown("an object with a computed key".to_string()));
                            }
                            match key(&property.key).as_deref() {
                                Some("toConfig" | "getVocabularyRecord") => class = Class::System(String::new()),
                                Some("__proto__") => return Ok(Class::Unknown("an object with `__proto__`".to_string())),
                                _ => {}
                            }
                        }
                        // A spread brings no protocol key when its source is an
                        // Animus non-sealing value.
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            if self.class_of_value(module, program, &spread.argument, depth + 1)? != Class::NotSystem {
                                return Ok(Class::Unknown("an object spreading a value not traced to Animus".to_string()));
                            }
                        }
                    }
                }
                class
            }
            Expression::Identifier(identifier) => self.class_of_binding(module, &identifier.name, depth + 1)?,
            Expression::CallExpression(call) => match call.callee.get_inner_expression() {
                // `(() => expr)()`, as an IIFE builds a value.
                Expression::ArrowFunctionExpression(arrow) if call.arguments.is_empty() => match arrow.get_expression() {
                    Some(body) => self.class_of_expression(module, program, body, depth + 1)?,
                    None => Class::Unknown("a function call".to_string()),
                },
                callee => match callee.as_member_expression() {
                    Some(member) => {
                        let Some(method) = member.static_property_name() else {
                            return Ok(Class::Unknown("a computed method call".to_string()));
                        };
                        if builtin_array(program, expression) {
                            return Ok(Class::Value);
                        }
                        if !self.animus_value(module, program, member.object(), depth + 1)? {
                            Class::Unknown(format!("a call of `.{method}()` on a value not traced to Animus"))
                        } else if method == "seal" {
                            Class::System(String::new())
                        } else if non_sealing_method(method) {
                            Class::NotSystem
                        } else {
                            Class::Unknown(format!("a call of `.{method}()`"))
                        }
                    }
                    None => match callee {
                        Expression::Identifier(identifier) => {
                            if self.animus_callable(module, program, &identifier.name, depth + 1)? {
                                Class::NotSystem
                            } else {
                                Class::Unknown(format!("a call of `{}()`", identifier.name))
                            }
                        }
                        _ => Class::Unknown("a call".to_string()),
                    },
                },
            },
            _ => Class::Unknown("an expression the loader cannot classify".to_string()),
        })
    }

    /// The class of a value spread into an object: an identifier's binding,
    /// or the expression itself.
    fn class_of_value(&mut self, module: &str, program: &Program<'_>, expression: &Expression<'_>, depth: usize) -> Result<Class, String> {
        let class = self.class_of_expression(module, program, expression, depth)?;
        Ok(if class == Class::Value { Class::NotSystem } else { class })
    }

    /// Whether `local`, called, is an Animus non-sealing function: an import
    /// of one from `@animus-ui/system`, or a method destructured from an
    /// Animus value.
    fn animus_callable(&mut self, module: &str, program: &Program<'_>, local: &str, depth: usize) -> Result<bool, String> {
        Ok(match declaration(program, local) {
            Some(Decl::Import { spec, name: Some(name) }) => {
                non_sealing_function(&name) && self.animus_module(module, &spec)?
                    || non_sealing_method(&name) && {
                        match self.imported(module, &spec, &name)? {
                            Some((at, binding)) => self.parsed(&at, |loader, program| match declaration(program, &binding) {
                                Some(Decl::Destructured { key, from }) => {
                                    Ok(non_sealing_method(&key) && loader.animus_value(&at, program, from, depth + 1)?)
                                }
                                _ => Ok(false),
                            })?,
                            None => false,
                        }
                    }
            }
            Some(Decl::Destructured { key, from }) => non_sealing_method(&key) && self.animus_value(module, program, from, depth)?,
            _ => false,
        })
    }

    /// Whether binding `local` of `module` holds an Animus value, once per
    /// load.
    fn animus_binding(&mut self, module: &str, local: &str, depth: usize) -> Result<bool, String> {
        let key = (module.to_string(), local.to_string());
        if let Some(&traced) = self.traced.get(&key) {
            return Ok(traced);
        }
        let traced = self.parsed(module, |loader, program| loader.animus_local(module, program, local, depth))?;
        self.traced.insert(key, traced);
        Ok(traced)
    }

    /// [`analysed`], into the load's arena.
    fn analyse(&self, source: &str, path: &str) -> (ModuleRecord<String, String>, Option<Usage>, Option<Analysis<'c>>) {
        analysed(self.arena, source, path)
    }

    /// `run` over `module`'s source as read, parsed.
    fn parsed<T>(&mut self, module: &str, run: impl FnOnce(&mut Self, &Program<'_>) -> Result<T, String>) -> Result<T, String> {
        let program = self.program(module);
        run(self, program)
    }

    /// `module`'s source as read, parsed once per load.
    fn program(&mut self, module: &str) -> &'c Program<'c> {
        if let Some(program) = self.programs.get(module) {
            return program;
        }
        let source = self.arena.alloc_str(&self.modules[module].raw);
        let program: &'c Program<'c> = self.arena.alloc(Parser::new(self.arena, source, source_type(module)).parse().program);
        self.programs.insert(module.to_string(), program);
        program
    }

    /// The (module, binding) an import of `name` from `spec`, written in
    /// `module`, reads, when it resolves to a local binding.
    fn imported(&mut self, module: &str, spec: &str, name: &str) -> Result<Option<(String, String)>, String> {
        match self.target(module, spec) {
            // The audit reads no third-party package: what such an import
            // holds stays untraced.
            Target::Module(path)
                if self.auditing
                    && !self.owned(&path)
                    && self.package_name(Path::new(&path)).as_deref() != Some("@animus-ui/system") =>
            {
                Ok(None)
            }
            Target::Module(path) => {
                self.acquire(&path)?;
                self.terminal(&path, name)
            }
            _ => Ok(None),
        }
    }

    /// Whether `local`, declared in `program`, holds an Animus value.
    fn animus_local(&mut self, module: &str, program: &Program<'_>, local: &str, depth: usize) -> Result<bool, String> {
        Ok(match declaration(program, local) {
            Some(Decl::Init(init)) => self.animus_value(module, program, init, depth + 1)?,
            Some(Decl::Assigned(values)) => {
                let mut all = !values.is_empty();
                for value in values {
                    all = all && self.animus_value(module, program, value, depth + 1)?;
                }
                all
            }
            Some(Decl::Destructured { from, .. }) => self.animus_value(module, program, from, depth + 1)?,
            Some(Decl::Import { spec, name }) => {
                self.animus_module(module, &spec)?
                    || match name {
                        Some(name) => match self.imported(module, &spec, &name)? {
                            Some((at, binding)) => self.animus_binding(&at, &binding, depth + 1)?,
                            None => false,
                        },
                        None => false,
                    }
            }
            Some(Decl::NotSystem | Decl::Value | Decl::Class(_) | Decl::Rebound) | None => false,
        })
    }

    /// Whether an expression's value traces to Animus: a call chain rooted at
    /// a function `@animus-ui/system` exports, or a binding holding one.
    fn animus_value(&mut self, module: &str, program: &Program<'_>, expression: &Expression<'_>, depth: usize) -> Result<bool, String> {
        if depth > 512 {
            return Ok(false);
        }
        Ok(match expression.get_inner_expression() {
            Expression::CallExpression(call) => match call.callee.get_inner_expression() {
                Expression::Identifier(identifier) => match declaration(program, &identifier.name) {
                    Some(Decl::Import { spec, .. }) => self.animus_module(module, &spec)?,
                    _ => false,
                },
                callee => match callee.as_member_expression() {
                    Some(member) => self.animus_value(module, program, member.object(), depth + 1)?,
                    None => false,
                },
            },
            Expression::Identifier(identifier) => self.animus_local(module, program, &identifier.name, depth + 1)?,
            // A member of an Animus value (a kit's `.system`), or a property of
            // a module-level object literal that holds one.
            expression => match expression.as_member_expression() {
                Some(member) => {
                    let property = member.static_property_name().and_then(|key| match member.object().get_inner_expression() {
                        Expression::Identifier(object) => literal_property(program, &object.name, key),
                        _ => None,
                    });
                    match property {
                        Some(value) => self.animus_value(module, program, value, depth + 1)?,
                        None => {
                            // An imported object's property, traced in its module.
                            let imported = match (member.static_property_name(), member.object().get_inner_expression()) {
                                (Some(key), Expression::Identifier(object)) => match declaration(program, &object.name) {
                                    Some(Decl::Import { spec, name: Some(name) }) => Some((spec, name, key.to_string())),
                                    _ => None,
                                },
                                _ => None,
                            };
                            match imported {
                                Some((spec, name, key)) => match self.imported(module, &spec, &name)? {
                                    Some((at, binding)) => self.parsed(&at, |loader, program| match literal_property(program, &binding, &key) {
                                        Some(value) => loader.animus_value(&at, program, value, depth + 1),
                                        None => loader.animus_local(&at, program, &binding, depth + 1),
                                    })?,
                                    None => false,
                                },
                                None => self.animus_value(module, program, member.object(), depth + 1)?,
                            }
                        }
                    }
                }
                None => false,
            },
        })
    }

    /// Reports each registration in owned code the load did not run: the
    /// targets of a retained module's requests that do not run, the routed
    /// modules whose bodies never run, and, transitively, owned modules they
    /// import. Third-party code is not read. An audit never fails the load.
    fn audit(&mut self, entry: &str, root: &str) {
        self.find_owners(entry);
        self.auditing = true;
        let runs = |modules: &FxHashMap<String, Module<'_>>, path: &str| modules.get(path).is_some_and(|module| module.retained);
        let mut queue: VecDeque<String> = VecDeque::new();
        let mut paths: Vec<String> = self.modules.keys().cloned().collect();
        paths.sort();
        for path in &paths {
            if runs(&self.modules, path) {
                for spec in self.modules[path].record.requests.clone() {
                    if let Target::Module(target) = self.target(path, &spec) {
                        queue.push_back(target);
                    }
                }
            } else {
                queue.push_back(path.clone());
            }
        }
        let mut seen: FxHashSet<String> = FxHashSet::default();
        while let Some(path) = queue.pop_front() {
            if !seen.insert(path.clone()) || runs(&self.modules, &path) || !self.owned(&path) {
                continue;
            }
            let source = match self.modules.get(&path) {
                Some(module) => module.raw.clone(),
                None => {
                    self.reads.read.insert(path.clone());
                    match resolution::read_source(&path) {
                        Ok(source) => source,
                        Err(error) => {
                            self.incomplete(&path, &format!("it could not be read ({error})"));
                            continue;
                        }
                    }
                }
            };
            self.audit_source(&path, &source, root);
            for spec in record_of(&source, &path).requests {
                if let Target::Module(target) = self.target(&path, &spec) {
                    queue.push_back(target);
                }
            }
        }
    }

    /// The registrations `source` makes, as findings: proved when the call
    /// runs as its module evaluates and its receiver traces to an Animus
    /// builder; unproved when it sits in a function, its receiver cannot be
    /// traced (a third-party value's included), or the method is read where
    /// the audit cannot follow it to a call (bound, passed or stored).
    fn audit_source(&mut self, path: &str, source: &str, root: &str) {
        const REGISTRATIONS: [&str; 4] =
            ["registerGlobalStyles", "registerKeyframes", "registerPositionTry", "registerViewTransitions"];
        // A module that never names a registration method, even through an
        // escape in an identifier, makes none.
        if !REGISTRATIONS.iter().any(|method| source.contains(method)) && !source.contains("\\u") {
            return;
        }
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, source_type(path)).parse();
        if !parsed.diagnostics.is_empty() {
            self.incomplete(path, "it does not parse");
            return;
        }
        let program = parsed.program;
        let semantic = SemanticBuilder::new().with_build_nodes(true).build(&program).semantic;
        for node in semantic.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else { continue };
            // The method and the value it is called on, as far as the call
            // shows them: `x.register…()`, `x.register….call()`, or a
            // destructured or imported `register…()`.
            let callee = call.callee.get_inner_expression();
            let found: Option<(String, Option<&Expression<'_>>)> = match callee.as_member_expression() {
                Some(member) => match member.static_property_name() {
                    Some(name) if REGISTRATIONS.contains(&name) => Some((name.to_string(), Some(member.object()))),
                    Some("call" | "apply") => member.object().as_member_expression().and_then(|inner| {
                        inner
                            .static_property_name()
                            .filter(|name| REGISTRATIONS.contains(name))
                            .map(|name| (name.to_string(), Some(inner.object())))
                    }),
                    _ => None,
                },
                None => match callee {
                    Expression::Identifier(identifier) => match declaration(&program, &identifier.name) {
                        Some(Decl::Destructured { key, from }) if REGISTRATIONS.contains(&key.as_str()) => Some((key, Some(from))),
                        Some(Decl::Import { name: Some(name), .. }) if REGISTRATIONS.contains(&name.as_str()) => Some((name, None)),
                        _ => None,
                    },
                    _ => None,
                },
            };
            let Some((method, receiver)) = found else { continue };
            let at_top = semantic.nodes().ancestor_kinds(node.id()).all(|kind| !kind.is_function_like());
            let traced = match receiver {
                Some(receiver) => self.animus_value(path, &program, receiver, 0).unwrap_or(false),
                None => false,
            };
            let (line, column) = line_column(source, call.span.start);
            let place = format!("{path}:{line}:{column}");
            let finding = if at_top && traced {
                crate::LoadFinding {
                    code: crate::REGISTRATION_UNREACHED,
                    severity: "error",
                    reason: format!(
                        "{method} at {place} runs when its module is imported, but the exported system '{root}' \
                         does not reach that module, so the load did not apply it: a registration outside the \
                         system's chain is ignored. Register it in the chain '{root}' is sealed from \
                         ({REGISTRATION_UNREACHED})",
                        REGISTRATION_UNREACHED = crate::REGISTRATION_UNREACHED
                    ),
                    file: path.to_string(),
                    line,
                    column,
                    method,
                }
            } else {
                let why = if at_top { "its receiver is not traced to an Animus builder" } else { "it sits in a function" };
                crate::LoadFinding {
                    code: crate::REGISTRATION_UNPROVED,
                    severity: "warn",
                    reason: format!(
                        "{method} at {place} is in code the exported system '{root}' does not reach, so the load \
                         did not run it ({why}). If it registers into the system, register it in the chain '{root}' \
                         is sealed from ({REGISTRATION_UNPROVED})",
                        REGISTRATION_UNPROVED = crate::REGISTRATION_UNPROVED
                    ),
                    file: path.to_string(),
                    line,
                    column,
                    method,
                }
            };
            self.reads.findings.push(finding);
        }
        // A registration method read anywhere but as the callee of a call (or
        // of its `.call`/`.apply`): bound, passed or stored, it may still be
        // called, where the audit cannot follow.
        let nodes = semantic.nodes();
        let callee_of = |id: oxc::semantic::NodeId, span: oxc::span::Span| -> bool {
            use oxc::span::GetSpan;
            match nodes.parent_kind(id) {
                AstKind::CallExpression(call) => call.callee.span() == span,
                AstKind::StaticMemberExpression(outer)
                    if outer.object.span() == span && matches!(outer.property.name.as_str(), "call" | "apply") =>
                {
                    let outer_id = nodes.parent_id(id);
                    matches!(nodes.parent_kind(outer_id), AstKind::CallExpression(call) if call.callee.span() == outer.span)
                }
                _ => false,
            }
        };
        for node in nodes.iter() {
            let (method, span) = match node.kind() {
                AstKind::StaticMemberExpression(member) if REGISTRATIONS.contains(&member.property.name.as_str()) => {
                    (member.property.name.to_string(), member.span)
                }
                AstKind::ComputedMemberExpression(member) => match &member.expression {
                    Expression::StringLiteral(key) if REGISTRATIONS.contains(&key.value.as_str()) => (key.value.to_string(), member.span),
                    _ => continue,
                },
                AstKind::IdentifierReference(reference) => match declaration(&program, &reference.name) {
                    Some(Decl::Destructured { key, .. }) if REGISTRATIONS.contains(&key.as_str()) => (key, reference.span),
                    Some(Decl::Import { name: Some(name), .. }) if REGISTRATIONS.contains(&name.as_str()) => (name, reference.span),
                    _ => continue,
                },
                _ => continue,
            };
            if callee_of(node.id(), span) {
                continue;
            }
            let (line, column) = line_column(source, span.start);
            self.reads.findings.push(crate::LoadFinding {
                code: crate::REGISTRATION_UNPROVED,
                severity: "warn",
                reason: format!(
                    "{method} at {path}:{line}:{column} is read in code the exported system '{root}' does not reach, \
                     and the load cannot follow it to a call, so it did not run it. If it registers into the system, \
                     register it in the chain '{root}' is sealed from ({})",
                    crate::REGISTRATION_UNPROVED
                ),
                file: path.to_string(),
                line,
                column,
                method,
            });
        }
    }

    fn incomplete(&mut self, path: &str, why: &str) {
        self.reads.findings.push(crate::LoadFinding {
            code: crate::AUDIT_INCOMPLETE,
            severity: "warn",
            file: path.to_string(),
            line: 0,
            column: 0,
            method: String::new(),
            reason: format!(
                "the load could not check {path} for registrations the system does not reach: {why} ({})",
                crate::AUDIT_INCOMPLETE
            ),
        });
    }

    /// What code is owned: the entry's package, the session's declared
    /// workspaces, and the monorepo the entry's package belongs to.
    fn find_owners(&mut self, entry: &str) {
        let mut owners: FxHashSet<std::path::PathBuf> =
            self.context.workspaces.values().map(|dir| resolution::real_path(dir.clone())).collect();
        let package = self.package_dir(Path::new(entry));
        owners.extend(package.clone());
        self.owners = owners;
        self.workspace = package.and_then(|package| self.find_workspace(&package));
    }

    /// The monorepo root above `package`: the nearest directory, from the
    /// package up, whose `package.json` has a `workspaces` field or that
    /// holds a `pnpm-workspace.yaml`, never above the repository the package
    /// is in (a directory holding `.git`). The declarations only mark the
    /// root; which packages they name is not read. Each file probed is read
    /// evidence, or watched for its creation where absent.
    fn find_workspace(&mut self, package: &Path) -> Option<std::path::PathBuf> {
        let mut dir = package.to_path_buf();
        loop {
            let manifest = dir.join("package.json");
            let declares = if manifest.is_file() {
                self.reads.read.insert(manifest.to_string_lossy().to_string());
                std::fs::read_to_string(&manifest)
                    .ok()
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                    .is_some_and(|json| json.get("workspaces").is_some())
            } else {
                self.reads.missing.insert(manifest.to_string_lossy().to_string());
                false
            };
            let pnpm = dir.join("pnpm-workspace.yaml");
            let pnpm_declares = pnpm.is_file();
            if pnpm_declares {
                self.reads.read.insert(pnpm.to_string_lossy().to_string());
            } else {
                self.reads.missing.insert(pnpm.to_string_lossy().to_string());
            }
            if declares || pnpm_declares {
                return Some(resolution::real_path(dir));
            }
            // The repository boundary, a directory or a worktree's file: its
            // removal moves the boundary, so it is read evidence too.
            let git = dir.join(".git");
            if git.exists() {
                self.reads.read.insert(git.to_string_lossy().to_string());
                return None;
            }
            self.reads.missing.insert(git.to_string_lossy().to_string());
            if !dir.pop() {
                return None;
            }
        }
    }

    /// Whether `path` is owned code: in an owner package, below the entry's
    /// monorepo root in no `node_modules`, or in a source kit (a package
    /// declaring the `animus` source condition), wherever it is installed.
    /// Each manifest that decides it is read evidence.
    fn owned(&mut self, path: &str) -> bool {
        let Some(dir) = self.package_dir(Path::new(path)) else { return false };
        self.reads.read.insert(dir.join("package.json").to_string_lossy().to_string());
        self.owners.contains(&dir) || self.in_workspace(path) || crate::declares_kit_source(&dir)
    }

    /// Whether the module at `path` lies below the monorepo root, by its own
    /// real path, in no `node_modules`.
    fn in_workspace(&self, path: &str) -> bool {
        let Some(root) = &self.workspace else { return false };
        let real = resolution::real_path(std::path::PathBuf::from(path));
        real.strip_prefix(root).is_ok_and(|relative| !relative.iter().any(|segment| segment == "node_modules"))
    }

    /// Whether `spec`, written in `module`, names the `@animus-ui/system`
    /// package: by the package its resolved file belongs to, so a subpath and
    /// an in-repo relative import of its source count.
    fn animus_module(&mut self, module: &str, spec: &str) -> Result<bool, String> {
        if spec == "@animus-ui/system" || spec.starts_with("@animus-ui/system/") {
            return Ok(true);
        }
        let Target::Module(path) = self.target(module, spec) else { return Ok(false) };
        Ok(self.package_name(Path::new(&path)).as_deref() == Some("@animus-ui/system"))
    }

    /// The name in the nearest `package.json` above `file`.
    fn package_name(&mut self, file: &Path) -> Option<String> {
        self.package_of(file).1
    }

    /// The directory of the nearest `package.json` above `file`.
    fn package_dir(&mut self, file: &Path) -> Option<std::path::PathBuf> {
        self.package_of(file).0
    }

    /// The nearest `package.json` above `file`: its directory and name, each
    /// directory walked once per load, every manifest probed recorded.
    fn package_of(&mut self, file: &Path) -> (Option<std::path::PathBuf>, Option<String>) {
        let Some(start) = file.parent() else { return (None, None) };
        let mut dir = start.to_path_buf();
        let mut walked = Vec::new();
        let found = loop {
            if let Some(found) = self.packages.get(&dir) {
                break found.clone();
            }
            walked.push(dir.clone());
            let manifest = dir.join("package.json");
            // Each manifest probed decides ownership and identity: one found is
            // read evidence, one absent is watched for its creation.
            let probed = manifest.to_string_lossy().to_string();
            if !manifest.is_file() {
                self.reads.missing.insert(probed);
            } else {
                self.reads.read.insert(probed);
            }
            if manifest.is_file() {
                let name = std::fs::read_to_string(&manifest)
                    .ok()
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                    .and_then(|json| json.get("name").and_then(|name| name.as_str()).map(str::to_string));
                break (Some(dir.clone()), name);
            }
            if !dir.pop() {
                break (None, None);
            }
        };
        for dir in walked {
            self.packages.insert(dir, found.clone());
        }
        found
    }
}

/// Refuses, with its location, construction a retained module cannot run
/// as selected: direct `eval` and `with`, which read bindings the selection
/// cannot see, and top-level `await`, which the loader does not run.
fn refuse_unsupported(semantic: &oxc::semantic::Semantic<'_>, source: &str, path: &str) -> Result<(), String> {
    use oxc::span::GetSpan;
    let at = |offset: u32| {
        let (line, column) = line_column(source, offset);
        format!("{path}:{line}:{column}")
    };
    let scoping = semantic.scoping();
    for node in semantic.nodes().iter() {
        let refused = match node.kind() {
            AstKind::CallExpression(call) => match &call.callee {
                // Direct when `eval` names no binding the module declares.
                Expression::Identifier(callee)
                    if callee.name == "eval" && scoping.get_reference(callee.reference_id()).symbol_id().is_none() =>
                {
                    Some(("direct `eval`", call.span.start))
                }
                _ => None,
            },
            AstKind::WithStatement(with) => Some(("a `with` statement", with.span.start)),
            AstKind::AwaitExpression(await_expression)
                if semantic.nodes().ancestor_kinds(node.id()).all(|kind| !kind.is_function_like()) =>
            {
                Some(("top-level `await`", await_expression.span().start))
            }
            _ => None,
        };
        if let Some((what, offset)) = refused {
            return Err(format!(
                "{} uses {what}, which the system loader cannot run: it loads only what the system reaches, and \
                 this reads bindings or runs work it cannot see. Move it out of the module the system reads \
                 (animus.system.unsupported-construction)",
                at(offset)
            ));
        }
    }
    Ok(())
}

/// Whether `expression` is an array the language builds: an array literal,
/// `Object.keys`, `values` or `entries`, `Array.from` or `of`, or an array
/// method that returns an array, called on one. `Object` and `Array` count
/// only where the module does not rebind them.
fn builtin_array(program: &Program<'_>, expression: &Expression<'_>) -> bool {
    const RETURNS_ARRAY: [&str; 12] =
        ["sort", "map", "filter", "slice", "concat", "flat", "flatMap", "reverse", "toSorted", "toReversed", "toSpliced", "with"];
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => true,
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else { return false };
            let Some(method) = member.static_property_name() else { return false };
            match member.object().get_inner_expression() {
                Expression::Identifier(global) if declaration(program, &global.name).is_none() => {
                    matches!((global.name.as_str(), method), ("Object", "keys" | "values" | "entries") | ("Array", "from" | "of"))
                }
                object => RETURNS_ARRAY.contains(&method) && builtin_array(program, object),
            }
        }
        _ => false,
    }
}

/// A class as a value: unknown when a static member may carry the protocol
/// (named `toConfig` or `getVocabularyRecord`, or computed), or when it
/// extends another class, whose statics it inherits unread; a value
/// otherwise.
fn class_shape(class: &oxc::ast::ast::Class<'_>) -> Class {
    use oxc::ast::ast::ClassElement;
    if class.heritage.is_some() {
        return Class::Unknown("a class that extends another, whose statics it inherits".to_string());
    }
    let carries = class.body.body.iter().any(|element| {
        let (is_static, key, computed) = match element {
            ClassElement::MethodDefinition(method) => (method.r#static, &method.key, method.computed),
            ClassElement::PropertyDefinition(property) => (property.r#static, &property.key, property.computed),
            ClassElement::AccessorProperty(accessor) => (accessor.r#static, &accessor.key, accessor.computed),
            ClassElement::StaticBlock(_) => return true,
            ClassElement::TSIndexSignature(_) => return false,
        };
        is_static && (computed || matches!(key.static_name().as_deref(), Some("toConfig" | "getVocabularyRecord")))
    });
    if carries { Class::Unknown("a class whose static members may carry the system protocol".to_string()) } else { Class::Value }
}

/// A builder method that never seals: its result is not a system.
fn non_sealing_method(name: &str) -> bool {
    matches!(
        name,
        "build" | "extend" | "asElement" | "asComponent" | "asClass" | "styles" | "variant" | "compound" | "states" | "groups"
            | "props" | "system"
    ) || ["add", "register", "create"].iter().any(|prefix| {
        name.strip_prefix(prefix).is_some_and(|rest| rest.chars().next().is_some_and(char::is_uppercase))
    })
}

/// A function `@animus-ui/system` exports that never returns a system.
fn non_sealing_function(name: &str) -> bool {
    matches!(
        name,
        "createTheme" | "createSystem" | "createTransform" | "createGlobalStyles" | "createKeyframes" | "compose" | "firstThatWorks"
    )
}

/// How a module declares a binding, as root inference reads it.
enum Decl<'a, 'p> {
    Init(&'a Expression<'p>),
    /// `let x;` then `x = …` at module level.
    Assigned(Vec<&'a Expression<'p>>),
    Destructured { key: String, from: &'a Expression<'p> },
    Import { spec: String, name: Option<String> },
    /// A function or enum: a value, which a later write may still make one.
    Value,
    /// A class, by its body: a static member may carry the protocol.
    Class(&'a oxc::ast::ast::Class<'p>),
    /// A `let` or `var` written where its value cannot be read.
    Rebound,
    /// A binding with no value to classify.
    NotSystem,
}

/// The module-level declaration of `local` in `program`.
fn declaration<'a, 'p>(program: &'a Program<'p>, local: &str) -> Option<Decl<'a, 'p>> {
    for stmt in &program.body {
        let declaration = match stmt {
            Statement::ImportDeclaration(import) => {
                for specifier in import.specifiers.iter().flatten() {
                    if specifier.local().name == local {
                        let name = match specifier {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => Some(module_export_name(&named.imported)),
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => Some("default".to_string()),
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => None,
                        };
                        return Some(Decl::Import { spec: import.source.value.to_string(), name });
                    }
                }
                continue;
            }
            Statement::ExportDeclaration(export) => &export.declaration,
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function)
                    if local == "default" || function.id.as_ref().is_some_and(|id| id.name == local) =>
                {
                    return Some(Decl::Value)
                }
                ExportDefaultDeclarationKind::ClassDeclaration(class)
                    if local == "default" || class.id.as_ref().is_some_and(|id| id.name == local) =>
                {
                    return Some(Decl::Class(class))
                }
                kind if local == "default" => {
                    return kind.as_expression().map(Decl::Init).or(Some(Decl::NotSystem));
                }
                _ => continue,
            },
            other => match other.as_declaration() {
                Some(declaration) => declaration,
                None => continue,
            },
        };
        match declaration {
            Declaration::VariableDeclaration(variables) => {
                for declarator in &variables.declarations {
                    match &declarator.id {
                        BindingPattern::BindingIdentifier(id) if id.name == local => {
                            // A `let` or `var` written again holds each value it
                            // is given, in turn.
                            let later = if variables.kind.is_const() { Vec::new() } else { assignments(program, local) };
                            if !variables.kind.is_const() && rebound(program, local, later.len()) {
                                return Some(Decl::Rebound);
                            }
                            return Some(match (&declarator.init, later.is_empty()) {
                                (Some(init), true) => Decl::Init(init),
                                (init, _) => Decl::Assigned(init.iter().chain(later).collect()),
                            });
                        }
                        BindingPattern::ObjectPattern(pattern) => {
                            for property in &pattern.properties {
                                if let BindingPattern::BindingIdentifier(id) = &property.value {
                                    if id.name == local {
                                        let key = property.key.static_name().map(|name| name.to_string()).unwrap_or_default();
                                        return declarator.init.as_ref().map(|from| Decl::Destructured { key, from });
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            Declaration::FunctionDeclaration(function) if function.id.as_ref().is_some_and(|id| id.name == local) => {
                return Some(Decl::Value)
            }
            Declaration::ClassDeclaration(class) if class.id.as_ref().is_some_and(|id| id.name == local) => {
                return Some(Decl::Class(class))
            }
            Declaration::TSEnumDeclaration(enumeration) if enumeration.id.name == local => return Some(Decl::Value),
            _ => {}
        }
    }
    None
}

/// Property `key` of the module-level object literal `binding`.
fn literal_property<'a, 'p>(program: &'a Program<'p>, binding: &str, key: &str) -> Option<&'a Expression<'p>> {
    match declaration(program, binding) {
        Some(Decl::Init(Expression::ObjectExpression(literal))) => literal.properties.iter().find_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property) if !property.computed && property.key.static_name().as_deref() == Some(key) => {
                Some(&property.value)
            }
            _ => None,
        }),
        _ => None,
    }
}

/// The values `local` is assigned at module level.
fn assignments<'a, 'p>(program: &'a Program<'p>, local: &str) -> Vec<&'a Expression<'p>> {
    program
        .body
        .iter()
        .filter_map(|stmt| match stmt {
            Statement::ExpressionStatement(statement) => match &statement.expression {
                Expression::AssignmentExpression(assignment)
                    if assignment.operator.is_assign()
                        && assignment.left.get_identifier_name().is_some_and(|name| name == local) =>
                {
                    Some(&assignment.right)
                }
                _ => None,
            },
            _ => None,
        })
        .collect()
}

/// Whether the module-level binding `local` is written anywhere other than
/// by the `read` plain assignments at module level: in a function, by a
/// compound or update operator, or as a destructuring target.
fn rebound(program: &Program<'_>, local: &str, read: usize) -> bool {
    let semantic = SemanticBuilder::new().build(program).semantic;
    let scoping = semantic.scoping();
    let Some(symbol) = scoping.get_root_binding(local.into()) else { return false };
    scoping.get_resolved_references(symbol).filter(|reference| reference.is_write()).count() > read
}

/// Whether `program` writes a member of `local` at module level, or passes
/// it first to `Object.assign`, `defineProperty`, `defineProperties` or
/// `setPrototypeOf`.
fn written_after(program: &Program<'_>, local: &str) -> bool {
    let semantic = SemanticBuilder::new().with_build_nodes(true).build(program).semantic;
    // `local` and each binding that aliases it: `const alias = local`, at any
    // depth, and aliases of those.
    let mut aliases: FxHashSet<String> = FxHashSet::from_iter([local.to_string()]);
    loop {
        let before = aliases.len();
        for node in semantic.nodes().iter() {
            if let AstKind::VariableDeclarator(declarator) = node.kind() {
                if let (BindingPattern::BindingIdentifier(id), Some(Expression::Identifier(init))) =
                    (&declarator.id, declarator.init.as_ref().map(Expression::get_inner_expression))
                {
                    if aliases.contains(init.name.as_str()) {
                        aliases.insert(id.name.to_string());
                    }
                }
            }
        }
        if aliases.len() == before {
            break;
        }
    }
    let named = |expression: &Expression<'_>| matches!(expression, Expression::Identifier(id) if aliases.contains(id.name.as_str()));
    let found = semantic.nodes().iter().any(|node| match node.kind() {
        AstKind::AssignmentExpression(assignment) => assignment.left.as_member_expression().is_some_and(|member| {
            let mut object = member.object();
            while let Some(inner) = object.as_member_expression() {
                object = inner.object();
            }
            named(object)
        }),
        AstKind::CallExpression(call) => call.callee.as_member_expression().is_some_and(|member| {
            matches!(member.object(), Expression::Identifier(id) if id.name == "Object")
                && matches!(member.static_property_name(), Some("assign" | "defineProperty" | "defineProperties" | "setPrototypeOf"))
                && call.arguments.first().and_then(|argument| argument.as_expression()).is_some_and(named)
        }),
        _ => false,
    });
    found
}

/// The member a reference to a namespace reads, when it reads one by a
/// static name and does not write it.
fn static_member(semantic: &oxc::semantic::Semantic<'_>, node: oxc::semantic::NodeId) -> Option<String> {
    let nodes = semantic.nodes();
    match nodes.parent_kind(node) {
        // A write through a namespace throws at runtime, as ESM throws.
        AstKind::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        AstKind::ComputedMemberExpression(member) => match &member.expression {
            Expression::StringLiteral(literal) => Some(literal.value.to_string()),
            _ => None,
        },
        AstKind::JSXMemberExpression(member) => Some(member.property.name.to_string()),
        _ => None,
    }
}

/// The modules a set of openings waits on: requests to modules not yet read.
fn pending_of(openings: &[crate::module_table::Opening]) -> Vec<String> {
    openings
        .iter()
        .filter_map(|opening| match &opening.reason {
            OpeningReason::UnresolvedRequest(marker) => marker.strip_prefix(PENDING).map(str::to_string),
            OpeningReason::OutsideStar(_) => None,
        })
        .collect()
}

/// An open answer with no pending route, its stub stars closed as the
/// linker closes them. A request that resolved to nothing usable keeps it
/// open, for its reason, whatever another branch knows: Node fails to link
/// a star of a missing module.
fn close_stub_stars(
    known: Vec<Terminal<String>>,
    openings: Vec<crate::module_table::Opening>,
    name: &str,
    stubs: &FxHashMap<String, FxHashSet<String>>,
) -> ExportLookup<String> {
    let failed = openings
        .iter()
        .any(|opening| matches!(&opening.reason, OpeningReason::UnresolvedRequest(marker) if marker.starts_with(FAILED)));
    if failed {
        return ExportLookup::Incomplete { known, openings };
    }
    crate::linked::close_stub_stars(known, openings, name, |stub| stubs.get(stub).is_some_and(|names| names.contains(name)))
}

/// A byte offset's 1-based line and column (in characters).
fn line_column(source: &str, offset: u32) -> (usize, usize) {
    let before = &source[..offset as usize];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |text| text.chars().count()) + 1;
    (line, column)
}

fn is_typescript(path: &str) -> bool {
    [".ts", ".tsx", ".mts", ".cts", ".jsx"].iter().any(|extension| path.ends_with(extension))
}

/// A module's runtime imports and exports from its syntax, requests by
/// specifier in source order. Type-only declarations, and local exports of a
/// name only a type declares, are left out: they name no runtime binding.
pub(crate) fn record_of(source: &str, path: &str) -> ModuleRecord<String, String> {
    let allocator = Allocator::default();
    record_from(&Parser::new(&allocator, source, source_type(path)).parse().program)
}

/// A module's record and what its body reads of its imports, from one
/// reading: each named or default import it references, and each namespace
/// import by the members it reads, or whole when it uses it otherwise. An
/// import the body never reads is left out.
fn analysed<'c>(arena: &'c Allocator, source: &str, path: &str) -> (ModuleRecord<String, String>, Option<Usage>, Option<Analysis<'c>>) {
    let source: &'c str = arena.alloc_str(source);
    let program: &'c Program<'c> = arena.alloc(Parser::new(arena, source, source_type(path)).parse().program);
    let semantic = SemanticBuilder::new().with_build_nodes(true).build(program).semantic;
    let scoping = semantic.scoping();
    let mut reads = Vec::new();
    for stmt in &program.body {
        let Statement::ImportDeclaration(decl) = stmt else { continue };
        if decl.import_kind.is_type() {
            continue;
        }
        for specifier in decl.specifiers.iter().flatten() {
            let references: Vec<_> = scoping.get_resolved_references(specifier.local().symbol_id()).collect();
            if references.is_empty() {
                continue;
            }
            let read = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) if named.import_kind.is_type() => continue,
                ImportDeclarationSpecifier::ImportSpecifier(named) => Read::Name(module_export_name(&named.imported)),
                ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => Read::Name("default".to_string()),
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => references
                    .iter()
                    .map(|reference| static_member(&semantic, reference.node_id()))
                    .collect::<Option<Vec<String>>>()
                    .map_or(Read::Whole, Read::Members),
            };
            reads.push((decl.source.value.to_string(), read));
        }
    }
    let refused = refuse_unsupported(&semantic, source, path).err();
    (record_from(program), Some(Usage { reads, refused }), Some(Analysis { source, program, semantic }))
}

fn record_from(program: &Program<'_>) -> ModuleRecord<String, String> {
    let mut record = ModuleRecord {
        requests: Vec::new(),
        imports: Vec::new(),
        local_exports: Vec::new(),
        indirect_exports: Vec::new(),
        namespace_exports: Vec::new(),
        star_exports: Vec::new(),
        default_cells: Vec::new(),
    };
    let request = |requests: &mut Vec<String>, spec: &str| match requests.iter().position(|seen| seen == spec) {
        Some(at) => at,
        None => {
            requests.push(spec.to_string());
            requests.len() - 1
        }
    };
    // Names only a type declares, and each imported binding.
    let mut types: FxHashSet<String> = FxHashSet::default();
    let mut values: FxHashSet<String> = FxHashSet::default();
    let mut imported: FxHashMap<String, (usize, ImportName)> = FxHashMap::default();
    for stmt in &program.body {
        let declaration = match stmt {
            Statement::ExportDeclaration(export) => Some(&export.declaration),
            other => other.as_declaration(),
        };
        if let Some(declaration) = declaration {
            match declaration {
                Declaration::TSInterfaceDeclaration(it) => {
                    types.insert(it.id.name.to_string());
                }
                Declaration::TSTypeAliasDeclaration(it) => {
                    types.insert(it.id.name.to_string());
                }
                declaration if declaration.declare() => {}
                declaration => {
                    let mut names = Vec::new();
                    crate::linked::collect_declaration_export_names(declaration, &mut names);
                    values.extend(names.into_iter().map(|(name, _)| name));
                }
            }
        }
    }
    for stmt in &program.body {
        match stmt {
            Statement::ImportDeclaration(decl) => {
                // `import type`, and `import { type A }` with no value
                // specifier, are erased with their request; a bare
                // `import 'x'` keeps its.
                let values = decl.specifiers.iter().flatten().filter(|specifier| {
                    !matches!(specifier, ImportDeclarationSpecifier::ImportSpecifier(named) if named.import_kind.is_type())
                });
                if decl.import_kind.is_type() || (decl.specifiers.as_ref().is_some_and(|all| !all.is_empty()) && values.count() == 0) {
                    continue;
                }
                let at = request(&mut record.requests, &decl.source.value);
                for specifier in decl.specifiers.iter().flatten() {
                    let name = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(named) if named.import_kind.is_type() => continue,
                        ImportDeclarationSpecifier::ImportSpecifier(named) => ImportName::Name(module_export_name(&named.imported)),
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => ImportName::Name("default".to_string()),
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => ImportName::Namespace,
                    };
                    let local = specifier.local().name.to_string();
                    imported.insert(local.clone(), (at, name.clone()));
                    record.imports.push(Import { local, request: at, name });
                }
            }
            Statement::ExportDeclaration(decl) => {
                let declaration = &decl.declaration;
                if !matches!(declaration, Declaration::TSInterfaceDeclaration(_) | Declaration::TSTypeAliasDeclaration(_))
                    && !declaration.declare()
                {
                    crate::linked::collect_declaration_export_names(declaration, &mut record.local_exports);
                }
            }
            Statement::ExportFromDeclaration(decl) => {
                if decl.export_kind.is_type() {
                    continue;
                }
                let at = request(&mut record.requests, &decl.source.value);
                for specifier in &decl.specifiers {
                    if !specifier.export_kind.is_type() {
                        let local = module_export_name(&specifier.local);
                        record.indirect_exports.push((module_export_name(&specifier.exported), at, local));
                    }
                }
            }
            Statement::ExportNamedDeclaration(decl) => {
                if decl.export_kind.is_type() {
                    continue;
                }
                for specifier in &decl.specifiers {
                    if specifier.export_kind.is_type() {
                        continue;
                    }
                    let exported = module_export_name(&specifier.exported);
                    let local = module_export_name(&specifier.local);
                    match imported.get(&local) {
                        Some((at, ImportName::Name(name))) => record.indirect_exports.push((exported, *at, name.clone())),
                        Some((at, ImportName::Namespace)) => record.namespace_exports.push((exported, *at)),
                        None if types.contains(&local) && !values.contains(&local) => {}
                        None => record.local_exports.push((exported, local)),
                    }
                }
            }
            Statement::ExportDefaultDeclaration(decl) => {
                let local = match &decl.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                        function.id.as_ref().map(|id| id.name.to_string())
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => class.id.as_ref().map(|id| id.name.to_string()),
                    ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => continue,
                    _ => None,
                };
                record.local_exports.push(("default".to_string(), local.unwrap_or_else(|| "default".to_string())));
            }
            Statement::ExportAllDeclaration(decl) => {
                if decl.export_kind.is_type() {
                    continue;
                }
                let at = request(&mut record.requests, &decl.source.value);
                match &decl.exported {
                    Some(exported) => record.namespace_exports.push((module_export_name(exported), at)),
                    None => record.star_exports.push(at),
                }
            }
            _ => {}
        }
    }
    record
}

#[cfg(test)]
mod tests {
    //! The bounded loader's contract: a load runs only what the exported
    //! system reaches, reports registrations in owned code it did not run,
    //! and keeps Node's evaluation order among what it runs.

    use std::fs;
    use std::path::{Path, PathBuf};

    use crate::{load_system_module, load_system_module_reading, LoadReads, ResolutionContext, SystemConfig};

    /// A stand-in `@animus-ui/system`: the loader knows Animus by package
    /// identity, so this package is Animus to it.
    const FAKE_SYSTEM: &str = "\
        const sealed = (globals, keyframes) => ({\n\
          toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }),\n\
          getVocabularyRecord: () => ({ version: 1, keyframes, globalStyles: globals, collisions: [], legacyVerbs: [] }),\n\
        });\n\
        const bundle = (globals, keyframes) => ({\n\
          createGlobalStyles: (styles) => ({ __brand: 'GlobalStyleBlock', styles }),\n\
          createKeyframes: (frames) => ({ __brand: 'Keyframes', frames }),\n\
          registerGlobalStyles: (blocks) => bundle([...globals, ...Object.entries(blocks).map(([name, block]) => ({ name, styles: block.styles }))], keyframes),\n\
          registerKeyframes: (sets) => bundle(globals, [...keyframes, ...Object.entries(sets).map(([name, set]) => ({ name, frames: set.frames }))]),\n\
          seal: () => sealed(globals, keyframes),\n\
        });\n\
        export const createSystem = () => ({ build: () => bundle([], []) });\n\
        export const createTheme = () => ({\n\
          tokens: {},\n\
          addColors(colors) { Object.assign(this.tokens, colors); return this; },\n\
          build() { const manifest = { tokenMap: { ...this.tokens } }; return { manifest, serialize: () => ({ scalesJson: JSON.stringify(manifest.tokenMap), variableMapJson: '{}', variableCss: '', contextualVarsJson: '{}' }) }; },\n\
        });\n";

    /// A scratch project: its files, a `package.json`, and the stand-in
    /// system package.
    fn project(label: &str, files: &[(&str, &str)]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("animus-bounded-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let write = |path: &Path, contents: &str| {
            fs::create_dir_all(path.parent().expect("a file has a parent")).expect("create fixture dir");
            fs::write(path, contents).expect("write fixture");
        };
        write(&dir.join("package.json"), "{\"name\":\"app\",\"type\":\"module\"}");
        write(&dir.join("node_modules/@animus-ui/system/package.json"), "{\"name\":\"@animus-ui/system\",\"type\":\"module\",\"exports\":\"./index.js\"}");
        write(&dir.join("node_modules/@animus-ui/system/index.js"), FAKE_SYSTEM);
        for (path, contents) in files {
            write(&dir.join(path), contents);
        }
        fs::canonicalize(&dir).expect("canonical fixture")
    }

    fn load(dir: &Path, entry: &str, export: Option<&str>) -> Result<SystemConfig, String> {
        let result = load_system_module(&dir.join(entry).to_string_lossy(), &dir.to_string_lossy(), export, &ResolutionContext::default());
        let _ = fs::remove_dir_all(dir);
        result
    }

    fn findings(config: &SystemConfig) -> Vec<(String, String, usize)> {
        let json: serde_json::Value = serde_json::from_str(config.load_findings_json.as_deref().unwrap_or("[]")).expect("findings parse");
        json.as_array()
            .expect("an array")
            .iter()
            .map(|finding| {
                let file = finding["file"].as_str().unwrap_or_default();
                let file = Path::new(file).file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
                (finding["code"].as_str().unwrap_or_default().to_string(), file, finding["line"].as_u64().unwrap_or(0) as usize)
            })
            .collect()
    }

    const STATE: &str = "import { createSystem, createTheme } from '@animus-ui/system';\n\
        export const theme = createTheme().addColors({ ink: '#123456' }).build();\n\
        export const holder = { bundle: createSystem().build() };\n";
    const SYSTEM: &str = "import { holder } from './state';\nimport './side';\nexport { theme } from './state';\nexport const ds = holder.bundle.seal();\n";

    /// Contract (owner ruling): a registration made by importing a module
    /// the system does not reach is not applied, and the load reports it
    /// where it is written; so is a keyframe registration.
    #[test]
    fn a_registration_the_system_does_not_reach_is_reported_not_applied() {
        for (label, side, expected) in [
            (
                "global",
                "import { holder } from './state';\nholder.bundle = holder.bundle.registerGlobalStyles({ rogue: holder.bundle.createGlobalStyles({ body: { color: 'red' } }) });\n",
                "globals",
            ),
            (
                "keyframes",
                "import { holder } from './state';\nholder.bundle = holder.bundle.registerKeyframes({ rogue: holder.bundle.createKeyframes({ pulse: { name: 'k', frames: { from: { opacity: 0 } } } }) });\n",
                "keyframes",
            ),
        ] {
            let dir = project(&format!("unreached-{label}"), &[("state.ts", STATE), ("system.ts", SYSTEM), ("side.ts", side)]);
            let config = load(&dir, "system.ts", None).expect("the system loads");
            let applied = if expected == "globals" { &config.global_style_blocks } else { &config.keyframes_blocks };
            assert!(applied.as_deref().is_none_or(|json| !json.contains("rogue")), "{label}: {applied:?}");
            assert_eq!(findings(&config), [(crate::REGISTRATION_UNREACHED.to_string(), "side.ts".to_string(), 2)], "{label}");
        }
    }

    /// Contract (owner ruling): a module that mutates the theme's tokens is
    /// not run when the system does not reach it, and is not reported.
    #[test]
    fn token_mutation_from_another_module_is_not_applied_or_reported() {
        let side = "import { theme } from './state';\ntheme.manifest.tokenMap.ink = '#654321';\n";
        let dir = project("token-mutation", &[("state.ts", STATE), ("system.ts", SYSTEM), ("side.ts", side)]);
        let config = load(&dir, "system.ts", None).expect("the system loads");
        assert_eq!(config.scales_json, r##"{"ink":"#123456"}"##);
        assert_eq!(config.load_findings_json, None);
    }

    /// Contract (owner ruling): an import the system does not read is not
    /// followed, so code it names that cannot load here (Intl, a missing
    /// file, a Node builtin) does not fail the load.
    #[test]
    fn an_import_the_system_does_not_read_does_not_fail_the_load() {
        let system = "import { holder } from './state';\nimport './intl';\nimport './missing';\nimport 'node:fs';\nexport { theme } from './state';\nexport const ds = holder.bundle.seal();\n";
        let dir = project("ignored-imports", &[("state.ts", STATE), ("system.ts", system), ("intl.js", "export const c = new Intl.Collator();\n")]);
        load(&dir, "system.ts", None).expect("unread imports fail nothing");
    }

    /// Contract: code a reached module runs that the loader cannot run as
    /// selected fails the load with its location.
    #[test]
    fn retained_code_the_loader_cannot_run_fails_with_its_location() {
        for (label, helper, expected) in [
            ("eval", "export const t = 1;\neval('t');\n", "helper.js:2:1 uses direct `eval`"),
            ("with", "export const t = 1;\nwith ({}) {}\n", "helper.js:2:1 uses a `with` statement"),
            ("await", "export const t = await Promise.resolve(1);\n", "helper.js:1:18 uses top-level `await`"),
        ] {
            let system = "import { createSystem } from '@animus-ui/system';\nimport { t } from './helper.js';\nexport const ds = createSystem().build().seal();\nexport const theme = { serialize: () => ({ scalesJson: String(t), variableMapJson: '{}', variableCss: '', contextualVarsJson: '{}' }) };\n";
            let dir = project(&format!("refuse-{label}"), &[("system.js", system), ("helper.js", helper)]);
            let error = load(&dir, "system.js", None).expect_err("refused");
            assert!(error.contains(expected), "{label}: {error}");
        }
    }

    /// Contract: the system export is inferred only when certain: exactly
    /// one sealed system, counted by the declaration that creates it, and no
    /// export that may be one. Anything else asks for the export by name.
    #[test]
    fn the_system_export_is_inferred_only_when_certain() {
        let sealed = "import { createSystem, createTheme } from '@animus-ui/system';\nexport const theme = createTheme().build();\n";
        for (label, rest, expected) in [
            ("helper-built", "const makeDs = () => createSystem().build().seal();\nexport const ds = makeDs();\n", Err("Name the system's export with the `systemExport` option")),
            ("proto-alias", "export const ds = createSystem().build().seal();\nexport const other = { __proto__: ds };\n", Err("'other' (an object with `__proto__`)")),
            ("later-write", "export const ds = createSystem().build().seal();\nexport const late = {};\nlate.toConfig = ds.toConfig;\n", Err("'late' is written after its declaration")),
            ("aliases", "export const ds = createSystem().build().seal();\nexport default ds;\nexport { ds as system };\n", Ok(())),
            ("default", "export default createSystem().build().seal();\n", Ok(())),
            ("iife", "export const ds = /* @__PURE__ */ (() => createSystem().build().seal())();\n", Ok(())),
            ("builtin-array", "export const ds = createSystem().build().seal();\nexport const scale = Object.values({ a: 2, b: 1 }).sort();\n", Ok(())),
        ] {
            let dir = project(&format!("root-{label}"), &[("system.js", &format!("{sealed}{rest}"))]);
            match (load(&dir, "system.js", None), expected) {
                (Ok(_), Ok(())) => {}
                (Err(error), Err(expected)) => assert!(error.contains(expected), "{label}: {error}"),
                (result, expected) => panic!("{label}: {:?} for {expected:?}", result.map(|_| ())),
            }
        }
        // A star-forwarded system, and a helper-built one named explicitly.
        let dir = project("root-star", &[("system.js", "export * from './inner.js';\n"), ("inner.js", &format!("{sealed}export const ds = createSystem().build().seal();\n"))]);
        load(&dir, "system.js", None).expect("a star-forwarded system infers");
        let dir = project("root-named", &[("system.js", &format!("{sealed}const makeDs = () => createSystem().build().seal();\nexport const ds = makeDs();\n"))]);
        load(&dir, "system.js", Some("ds")).expect("the named export loads");
    }

    /// Contract: modules behind barrels run in Node's order, though the
    /// barrels never run: Node gives `{"a":2,"b":1,"ran":["barrel"]}`, and
    /// the bounded load the same order without the barrel's own code.
    #[test]
    fn modules_behind_a_barrel_run_in_node_order() {
        let theme = "export const theme = { serialize: () => ({ scalesJson: JSON.stringify(data), variableMapJson: '{}', variableCss: '', contextualVarsJson: '{}' }) };\n";
        let dir = project(
            "barrel-order",
            &[
                ("shared.js", "export let count = 0;\nexport const next = () => ++count;\nexport const ran = [];\n"),
                ("a.js", "import { next } from './shared.js';\nexport const a = next();\n"),
                ("b.js", "import { next } from './shared.js';\nexport const b = next();\n"),
                ("barrel.js", "import { ran } from './shared.js';\nran.push('barrel');\nexport { b } from './b.js';\nexport { a } from './a.js';\n"),
                ("system.js", &format!("import {{ createSystem }} from '@animus-ui/system';\nimport {{ a }} from './barrel.js';\nimport {{ b }} from './b.js';\nimport {{ ran }} from './shared.js';\nconst data = {{ a, b, ran }};\nexport const ds = createSystem().build().seal();\n{theme}")),
            ],
        );
        let config = load(&dir, "system.js", None).expect("loads");
        assert_eq!(config.scales_json, r#"{"a":2,"b":1,"ran":[]}"#);
    }

    /// Contract: a cycle among reached modules keeps Node's order: `b` runs
    /// first, its function hoisted, as Node runs it (Node:
    /// `{"first":"a","b":"a","a":"afunction"}`).
    #[test]
    fn a_cycle_among_reached_modules_keeps_node_order() {
        let theme = "export const theme = { serialize: () => ({ scalesJson: JSON.stringify(data), variableMapJson: '{}', variableCss: '', contextualVarsJson: '{}' }) };\n";
        let dir = project(
            "cycle",
            &[
                ("a.js", "import { b } from './b.js';\nexport const order = [];\norder.push('a');\nexport const a = 'a' + typeof b;\n"),
                ("b.js", "import { order } from './a.js';\nexport function b() { return order[0]; }\n"),
                ("system.js", &format!("import {{ createSystem }} from '@animus-ui/system';\nimport {{ a, order }} from './a.js';\nimport {{ b }} from './b.js';\nconst data = {{ first: order[0], b: b(), a }};\nexport const ds = createSystem().build().seal();\n{theme}")),
            ],
        );
        let config = load(&dir, "system.js", None).expect("loads");
        assert_eq!(config.scales_json, r#"{"first":"a","b":"a","a":"afunction"}"#);
    }

    /// Contract: a namespace read only by member reaches those members; one
    /// used whole is a module namespace with every name, in code-unit order.
    #[test]
    fn a_namespace_reaches_what_its_use_reads() {
        let theme = "export const theme = { serialize: () => ({ scalesJson: JSON.stringify(data), variableMapJson: '{}', variableCss: '', contextualVarsJson: '{}' }) };\n";
        let dir = project(
            "namespace",
            &[
                ("parts.js", "export const zeta = 1;\nexport const alpha = 2;\nexport * from './more.js';\n"),
                ("more.js", "export const Mid = 3;\n"),
                ("unread.js", "throw new Error('runs only when its namespace is whole');\nexport const x = 1;\n"),
                ("member.js", "export * as unread from './unread.js';\nexport const own = 4;\n"),
                ("system.js", &format!("import {{ createSystem }} from '@animus-ui/system';\nimport * as parts from './parts.js';\nimport * as member from './member.js';\nconst data = {{ keys: Object.keys(parts), own: member.own }};\nexport const ds = createSystem().build().seal();\n{theme}")),
            ],
        );
        let config = load(&dir, "system.js", None).expect("loads");
        assert_eq!(config.scales_json, r#"{"keys":["Mid","alpha","zeta"],"own":4}"#);
    }

    /// Contract: a name only a type declares routes nowhere, so a star target
    /// exporting `interface ds` beside one exporting a real `ds` is not
    /// ambiguous.
    #[test]
    fn a_type_only_name_does_not_make_a_route_ambiguous() {
        let dir = project(
            "type-shadow",
            &[
                ("types.ts", "export interface ds { a: 1 }\n"),
                ("real.ts", "import { createSystem } from '@animus-ui/system';\nexport const ds = createSystem().build().seal();\n"),
                ("both.ts", "export * from './types';\nexport * from './real';\n"),
                ("system.ts", "import { createTheme } from '@animus-ui/system';\nexport { ds } from './both';\nexport const theme = createTheme().build();\n"),
            ],
        );
        load(&dir, "system.ts", None).expect("the type routes nowhere");
    }

    /// Contract: the theme manifests name each built theme where main's
    /// whole-graph load named it: through a barrel that never runs, through a
    /// re-export of a module that runs, and in a kit whose system the app
    /// extends.
    #[test]
    fn theme_manifests_keep_routed_and_kit_themes() {
        let dir = project(
            "theme-manifests",
            &[
                ("themes/leaf.ts", "import { createTheme } from '@animus-ui/system';\nexport const theme = createTheme().addColors({ ink: '#123456' }).build();\n"),
                ("themes/index.ts", "export { theme } from './leaf';\n"),
                ("node_modules/kit/package.json", "{\"name\":\"kit\",\"type\":\"module\",\"exports\":{\".\":{\"animus\":\"./src/index.ts\"}}}"),
                ("node_modules/kit/src/index.ts", "export { ds as system } from './system';\nexport { referenceTokens as theme } from './theme';\n"),
                ("node_modules/kit/src/system.ts", "import { createSystem } from '@animus-ui/system';\nexport const ds = createSystem().build().seal();\n"),
                ("node_modules/kit/src/theme.ts", "import { createTheme } from '@animus-ui/system';\nexport const referenceTokens = createTheme().addColors({ kit: '#000' }).build();\n"),
                ("mixed.ts", "export const mixed = 1;\nexport { theme as mixedTheme } from './themes/leaf';\n"),
                ("system.ts", "import { createSystem } from '@animus-ui/system';\nimport { system as kit } from 'kit';\nimport { mixed } from './mixed';\nexport { theme } from './themes';\nexport const ds = createSystem().build().seal();\nexport const uses = [kit, mixed];\n"),
            ],
        );
        let config = load(&dir, "system.ts", None).expect("loads");
        let manifests: serde_json::Value = serde_json::from_str(config.source_theme_manifests.as_deref().expect("manifests")).unwrap();
        let named: Vec<String> = manifests
            .as_object()
            .unwrap()
            .iter()
            .flat_map(|(path, themes)| {
                let tail = path.rsplit("/node_modules/").next().unwrap_or(path).rsplit(std::path::MAIN_SEPARATOR).take(2).collect::<Vec<_>>().join("<");
                themes.as_object().unwrap().keys().map(move |name| format!("{tail}:{name}")).collect::<Vec<_>>()
            })
            .collect();
        for expected in ["leaf.ts<themes:theme", "index.ts<themes:theme", "theme.ts<src:referenceTokens", "index.ts<src:theme", "mixed.ts", "system.ts<"] {
            assert!(named.iter().any(|name| name.starts_with(expected)), "{expected} in {named:?}");
        }
    }

    /// Contract (intended change): a registered block names the module that
    /// declares the binding its registration names, even when another module
    /// exports a block of equal content.
    #[test]
    fn a_registered_block_names_the_module_declaring_its_binding() {
        let dir = project(
            "global-origin",
            &[
                ("base.ts", "import { createSystem } from '@animus-ui/system';\nexport const bundle = createSystem().build();\nexport const reset = bundle.createGlobalStyles({ body: { margin: 0 } });\n"),
                ("copy.ts", "import { bundle } from './base';\nexport const reset = bundle.createGlobalStyles({ body: { margin: 0 } });\n"),
                ("system.ts", "import { createTheme } from '@animus-ui/system';\nimport { bundle, reset } from './base';\nimport { reset as same } from './copy';\nexport const theme = createTheme().build();\nexport const both = [same];\nexport const ds = bundle.registerGlobalStyles({ reset }).seal();\n"),
            ],
        );
        let config = load(&dir, "system.ts", None).expect("loads");
        let blocks: serde_json::Value = serde_json::from_str(config.global_style_blocks.as_deref().expect("globals")).unwrap();
        assert_eq!(blocks["reset"]["source"], "base.ts", "{blocks}");
        assert_eq!(blocks["reset"]["sourceExport"], "reset", "{blocks}");
    }

    /// Contract: the audit reports what it can prove as an omission, and what
    /// it cannot as unproved, a call on a third-party value included; it
    /// never reads a third-party package.
    #[test]
    fn the_audit_proves_what_it_reports() {
        let side = "import { holder } from './state';\nimport { tracker } from 'analytics';\n\
            const { registerGlobalStyles } = holder.bundle;\n\
            holder.bundle = registerGlobalStyles({ a: holder.bundle.createGlobalStyles({}) });\n\
            export function later() { holder.bundle.registerKeyframes({}); }\n\
            tracker.registerKeyframes('page');\n";
        let dir = project(
            "audit",
            &[
                ("state.ts", STATE),
                ("system.ts", SYSTEM),
                ("side.ts", side),
                ("node_modules/analytics/package.json", "{\"name\":\"analytics\",\"type\":\"module\",\"exports\":\"./index.js\"}"),
                ("node_modules/analytics/index.js", "import { holder } from '../../state.ts';\nexport const tracker = { registerKeyframes() {} };\n"),
            ],
        );
        let config = load(&dir, "system.ts", None).expect("loads");
        assert_eq!(
            findings(&config),
            [
                (crate::REGISTRATION_UNREACHED.to_string(), "side.ts".to_string(), 4),
                (crate::REGISTRATION_UNPROVED.to_string(), "side.ts".to_string(), 5),
                (crate::REGISTRATION_UNPROVED.to_string(), "side.ts".to_string(), 6),
            ]
        );
        assert!(!config.dependencies.iter().any(|path| path.ends_with("analytics/index.js")), "{:?}", config.dependencies);
    }

    /// Contract (C8): a kit named in the context's instances is evaluated
    /// from the host's instance, from every importer, so an aliased kit's
    /// vocabulary is the one the bundle renders; Animus's own package is
    /// never redirected, whatever the map holds.
    #[test]
    fn a_kit_is_evaluated_from_the_hosts_instance_and_never_the_system_package() {
        let kit = |ink: &str| {
            format!("import {{ createTheme }} from '@animus-ui/system';\nexport const theme = createTheme().addColors({{ ink: '{ink}' }}).build();\n")
        };
        let installed = kit("#111111");
        let aliased = kit("#222222");
        let dir = project(
            "instances",
            &[
                ("node_modules/kit/package.json", "{\"name\":\"kit\",\"type\":\"module\",\"exports\":\"./index.js\"}"),
                ("node_modules/kit/index.js", installed.as_str()),
                ("alt/kit/package.json", "{\"name\":\"kit\",\"type\":\"module\",\"exports\":\"./index.js\"}"),
                ("alt/kit/index.js", aliased.as_str()),
                ("alt/system/package.json", "{\"name\":\"@animus-ui/system\",\"type\":\"module\",\"exports\":\"./index.js\"}"),
                ("alt/system/index.js", "throw new Error('the aliased system package evaluated');\n"),
                ("system.ts", "import { createSystem } from '@animus-ui/system';\nexport { theme } from 'kit';\nexport const ds = createSystem().build().seal();\n"),
            ],
        );
        let entry = dir.join("system.ts").to_string_lossy().to_string();
        let root = dir.to_string_lossy().to_string();
        let own = load_system_module(&entry, &root, None, &ResolutionContext::default());
        let hosted = load_system_module(
            &entry,
            &root,
            None,
            &ResolutionContext {
                instances: [("kit", "alt/kit"), ("@animus-ui/system", "alt/system")]
                    .into_iter()
                    .map(|(name, path)| (name.to_string(), dir.join(path)))
                    .collect(),
                ..ResolutionContext::default()
            },
        );
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(own.expect("the installed kit loads").scales_json, r##"{"ink":"#111111"}"##);
        assert_eq!(hosted.expect("the host's instance loads").scales_json, r##"{"ink":"#222222"}"##);
    }

    /// Contract: the audit owns the code of the repository's monorepo: every
    /// module the system imports from below the nearest root declared by a
    /// `workspaces` field or a `pnpm-workspace.yaml`, in no `node_modules`,
    /// whatever the declaration lists, and never past the repository's
    /// `.git`. An unreached registration there is reported, as in the app;
    /// one in a dependency, or claimed only by an unrelated parent
    /// repository, is not. The declaring file is watched.
    #[test]
    fn the_audit_owns_the_repositorys_monorepo() {
        const SIDE: &str =
            "import { holder } from './state';\nholder.bundle = holder.bundle.registerGlobalStyles({ rogue: holder.bundle.createGlobalStyles({ body: { color: 'red' } }) });\n";
        const DEP_SIDE: &str =
            "import { holder } from '../../src/state.ts';\nholder.bundle = holder.bundle.registerGlobalStyles({ rogue: holder.bundle.createGlobalStyles({ body: { color: 'red' } }) });\n";
        let monorepo = |declaration: &[(&'static str, &'static str)], index: &'static str, extra: &[(&'static str, &'static str)]| {
            let mut files: Vec<(&str, &str)> = declaration.to_vec();
            files.extend([
                ("apps/web/package.json", "{\"name\":\"web\",\"type\":\"module\"}"),
                ("apps/web/system.ts", "import { holder } from '@acme/styles';\nexport { theme } from '@acme/styles';\nexport const ds = holder.bundle.seal();\n"),
                ("packages/styles/package.json", "{\"name\":\"@acme/styles\",\"type\":\"module\",\"exports\":\"./src/index.ts\"}"),
                ("packages/styles/src/index.ts", index),
                ("packages/styles/src/state.ts", STATE),
                ("packages/styles/src/side.ts", SIDE),
            ]);
            files.extend(extra.iter().copied());
            files
        };
        let unreached = |file: &str| vec![(crate::REGISTRATION_UNREACHED.to_string(), file.to_string(), 2)];
        /// A layout, the load root, the findings expected, and the declaring
        /// file the load must watch.
        type Case<'a> = (&'a str, Vec<(&'a str, &'a str)>, &'a str, Vec<(String, String, usize)>, Option<&'a str>);
        let cases: Vec<Case> = vec![
            (
                "gamut",
                monorepo(&[("package.json", "{\"name\":\"monorepo\",\"private\":true,\"workspaces\":[\"apps/*\",\"packages/*\"]}")], "export * from './state';\nimport './side';\n", &[]),
                "apps/web",
                unreached("side.ts"),
                Some("package.json"),
            ),
            (
                "pnpm-inline",
                monorepo(&[("pnpm-workspace.yaml", "packages: ['apps/*', \"packages/*\"]\n")], "export * from './state';\nimport './side';\n", &[]),
                "apps/web",
                unreached("side.ts"),
                Some("pnpm-workspace.yaml"),
            ),
            (
                "pnpm-and-manifest",
                monorepo(
                    &[
                        ("package.json", "{\"name\":\"monorepo\",\"workspaces\":{\"nohoist\":[\"**\"]}}"),
                        ("pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n"),
                    ],
                    "export * from './state';\nimport './side';\n",
                    &[],
                ),
                "apps/web",
                unreached("side.ts"),
                Some("pnpm-workspace.yaml"),
            ),
            (
                "manifest-free-dependency",
                monorepo(
                    &[("package.json", "{\"name\":\"monorepo\",\"workspaces\":[\"apps/*\",\"packages/*\"]}")],
                    "export * from './state';\nimport '../node_modules/dep/side.js';\n",
                    &[("packages/styles/node_modules/dep/side.js", DEP_SIDE)],
                ),
                "apps/web",
                Vec::new(),
                None,
            ),
            (
                "unrelated-parent",
                vec![
                    ("package.json", "{\"name\":\"parent\",\"workspaces\":[\"**\"]}"),
                    ("child/.git/HEAD", "ref: refs/heads/main\n"),
                    ("child/package.json", "{\"name\":\"child\",\"type\":\"module\"}"),
                    ("child/system.ts", "import { holder } from './lib/src/index.ts';\nexport { theme } from './lib/src/index.ts';\nexport const ds = holder.bundle.seal();\n"),
                    ("child/lib/package.json", "{\"name\":\"lib\",\"type\":\"module\"}"),
                    ("child/lib/src/index.ts", "export * from './state';\nimport './side';\n"),
                    ("child/lib/src/state.ts", STATE),
                    ("child/lib/src/side.ts", SIDE),
                ],
                "child",
                Vec::new(),
                None,
            ),
        ];
        for (label, files, root, expected, watched) in cases {
            let dir = project(&format!("monorepo-{label}"), &files);
            if root == "apps/web" {
                fs::create_dir_all(dir.join("node_modules/@acme")).expect("scope dir");
                std::os::unix::fs::symlink(dir.join("packages/styles"), dir.join("node_modules/@acme/styles")).expect("link the workspace");
            }
            let app = dir.join(root);
            let config = load_system_module(
                &app.join("system.ts").to_string_lossy(),
                &app.to_string_lossy(),
                None,
                &ResolutionContext::default(),
            );
            let _ = fs::remove_dir_all(&dir);
            let config = config.unwrap_or_else(|error| panic!("{label}: the system loads: {error}"));
            assert_eq!(findings(&config), expected, "{label}");
            if let Some(watched) = watched {
                let declaring = dir.join(watched).to_string_lossy().to_string();
                assert!(config.dependencies.contains(&declaring), "{label}: {declaring} in {:?}", config.dependencies);
            }
        }
    }

    /// Contract: the repository boundary that stops the monorepo walk is
    /// watched, whether `.git` is a directory or a worktree's file: removing
    /// it lets an enclosing monorepo claim the code, so the load that
    /// depended on it reloads and then reports what that root owns.
    #[test]
    fn the_repository_boundary_is_watched() {
        for (label, boundary) in [("directory", "child/.git/HEAD"), ("worktree-file", "child/.git")] {
            let dir = project(
                &format!("git-boundary-{label}"),
                &[
                    ("package.json", "{\"name\":\"parent\",\"workspaces\":[\"**\"]}"),
                    (boundary, "gitdir: ../.git/worktrees/child\n"),
                    ("child/package.json", "{\"name\":\"child\",\"type\":\"module\"}"),
                    ("child/system.ts", "import { holder } from './lib/src/index.ts';\nexport { theme } from './lib/src/index.ts';\nexport const ds = holder.bundle.seal();\n"),
                    ("child/lib/package.json", "{\"name\":\"lib\",\"type\":\"module\"}"),
                    ("child/lib/src/index.ts", "export * from './state';\nimport './side';\n"),
                    ("child/lib/src/state.ts", STATE),
                    (
                        "child/lib/src/side.ts",
                        "import { holder } from './state';\nholder.bundle = holder.bundle.registerGlobalStyles({ rogue: holder.bundle.createGlobalStyles({}) });\n",
                    ),
                ],
            );
            let child = dir.join("child");
            let load = || {
                load_system_module(&child.join("system.ts").to_string_lossy(), &child.to_string_lossy(), None, &ResolutionContext::default())
                    .unwrap_or_else(|error| panic!("{label}: the system loads: {error}"))
            };
            let git = child.join(".git");
            let bounded = load();
            assert_eq!(findings(&bounded), [], "{label}");
            assert!(bounded.dependencies.contains(&git.to_string_lossy().to_string()), "{label}: {:?}", bounded.dependencies);
            if git.is_dir() {
                fs::remove_dir_all(&git).expect("remove the boundary");
            } else {
                fs::remove_file(&git).expect("remove the boundary");
            }
            let unbounded = load();
            let _ = fs::remove_dir_all(&dir);
            assert_eq!(findings(&unbounded), [(crate::REGISTRATION_UNREACHED.to_string(), "side.ts".to_string(), 2)], "{label}");
        }
    }

    /// Contract: what a load reads is what it watches: the modules it ran,
    /// routed through or audited, never a module nothing reaches; and a
    /// failed load keeps its reads and its findings.
    #[test]
    fn a_load_watches_what_it_read_and_keeps_findings_on_failure() {
        let dir = project(
            "watch",
            &[
                ("state.ts", STATE),
                ("system.ts", SYSTEM),
                ("side.ts", "import { holder } from './state';\nholder.bundle = holder.bundle.registerGlobalStyles({});\nimport './deeper';\n"),
                ("deeper.ts", "export const deeper = 1;\n"),
                ("unread/icon.js", "export const icon = 1;\n"),
            ],
        );
        let entry = dir.join("system.ts");
        let config = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default()).expect("loads");
        let read: Vec<&str> = config.dependencies.iter().filter_map(|path| path.strip_prefix(dir.to_str().unwrap())).collect();
        for expected in ["/system.ts", "/state.ts", "/side.ts", "/deeper.ts"] {
            assert!(read.contains(&expected), "{expected} in {read:?}");
        }
        assert!(!read.iter().any(|path| path.contains("unread")), "{read:?}");
        // The system now reads a module that fails: the load fails, keeping
        // what it read and the finding it made.
        fs::write(dir.join("state.ts"), format!("{STATE}import {{ nope }} from './absent-module';\nexport const uses = nope;\n")).unwrap();
        let mut reads = LoadReads::default();
        let failed = load_system_module_reading(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default(), &mut reads);
        let _ = fs::remove_dir_all(&dir);
        assert!(failed.is_err());
        assert!(reads.read.iter().any(|path| path.ends_with("/state.ts")), "{:?}", reads.read);
        assert!(reads.findings.iter().any(|finding| finding.file.ends_with("/side.ts")), "{:?}", reads.findings);
        assert!(reads.missing.iter().any(|path| path.contains("absent-module")), "{:?}", reads.missing);
    }

    /// Contract: root inference counts an export as no system only when it
    /// proves the protocol absent, and a reassigned binding is no proof.
    #[test]
    fn root_inference_proves_absence_or_asks() {
        let head = "import { createSystem, createTheme } from '@animus-ui/system';\n";
        for (label, rest) in [
            ("sealed-theme", "export const tokens = createTheme().build();\nexport const theme = createSystem().build().seal();\nexport const ds = createSystem().build().seal();\n"),
            ("assigned-array", "export const ds = createSystem().build().seal();\nexport const arr = [];\nObject.assign(arr, { toConfig: ds.toConfig });\n"),
            ("from-array", "export const ds = createSystem().build().seal();\nexport const arr = Array.from([]);\narr.toConfig = ds.toConfig;\n"),
            ("static-class", "export const ds = createSystem().build().seal();\nexport class Other { static toConfig() { return ds.toConfig(); } }\n"),
            ("inherited-static", "export const ds = createSystem().build().seal();\nclass Base { static toConfig = ds.toConfig; static getVocabularyRecord = ds.getVocabularyRecord; }\nexport class Other extends Base {}\n"),
            ("alias-write", "export const ds = createSystem().build().seal();\nexport const other = {};\nconst alias = other;\nalias.toConfig = ds.toConfig;\n"),
            ("reassigned", "const first = createSystem().build().seal();\nconst second = createSystem().build().seal();\nexport let ds = first;\nexport default ds;\nds = second;\nexport const theme = createTheme().build();\n"),
        ] {
            let dir = project(&format!("absence-{label}"), &[("system.js", &format!("{head}{rest}"))]);
            let error = load(&dir, "system.js", None).map(|_| ()).expect_err(label);
            assert!(error.contains("animus.system.export-uncertain"), "{label}: {error}");
        }
    }

    /// Contract: a star of a module that cannot be found keeps the route
    /// open, as Node fails to link it, even when another star has the name.
    #[test]
    fn a_missing_star_branch_fails_the_route() {
        let dir = project(
            "missing-star",
            &[
                ("barrel.js", "export * from './missing.js';\nexport * from './real.js';\n"),
                ("real.js", "export const value = 1;\n"),
                ("system.js", "import { createSystem, createTheme } from '@animus-ui/system';\nimport { value } from './barrel.js';\nexport const theme = createTheme().build();\nexport const ds = createSystem().build().seal();\nexport const uses = [value];\n"),
            ],
        );
        let error = load(&dir, "system.js", None).map(|_| ()).expect_err("Node refuses this link");
        assert!(error.contains("missing.js"), "{error}");
    }

    /// Contract: a registration method the audit cannot follow to a call,
    /// bound or spelled with an escape, is reported unproved, never omitted.
    #[test]
    fn an_unfollowed_registration_is_unproved_not_omitted() {
        for (label, side) in [
            ("bound", "import { holder } from './state';\nconst register = holder.bundle.registerGlobalStyles.bind(holder.bundle);\nholder.bundle = register({});\n"),
            ("escaped", "import { holder } from './state';\nholder.bundle = holder.bundle.\\u0072egisterGlobalStyles({});\n"),
        ] {
            let dir = project(&format!("unfollowed-{label}"), &[("state.ts", STATE), ("system.ts", SYSTEM), ("side.ts", side)]);
            let config = load(&dir, "system.ts", None).expect("loads");
            let found = findings(&config);
            assert!(!found.is_empty() && found.iter().all(|(_, file, line)| file == "side.ts" && *line == 2), "{label}: {found:?}");
        }
    }

    /// Contract: each manifest the ownership walk probes is watched: a
    /// nearer `package.json` created later changes ownership and findings.
    #[test]
    fn a_missing_nearer_manifest_is_watched() {
        let dir = project(
            "nearer-manifest",
            &[("state.ts", STATE), ("system.ts", "import { holder } from './state';\nimport './sub/side';\nexport { theme } from './state';\nexport const ds = holder.bundle.seal();\n"), ("sub/side.ts", "import { holder } from '../state';\nholder.bundle = holder.bundle.registerGlobalStyles({});\n")],
        );
        let config = load(&dir, "system.ts", None).expect("loads");
        assert!(config.missing.iter().any(|path| path.ends_with("/sub/package.json")), "{:?}", config.missing);
    }

}
