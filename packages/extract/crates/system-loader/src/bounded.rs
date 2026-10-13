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
use oxc::span::SourceType;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::module_table::{ExportLookup, Import, ImportName, ModuleRecord, ModuleTable, OpeningReason, Request, Terminal};
use crate::{
    absent_relative_candidates, asset_import_reason, is_runtime_stub_specifier, looks_like_commonjs, module_export_name,
    real_path_string, resolution, resolve_bare_specifier_observed, resolve_relative, strip_typescript_module, stub_key,
    type_only_export_names, LoadReads, RelativeMiss, ResolutionContext,
};

/// What a load selected: the modules to run and the routes their imports
/// take.
pub(crate) struct Selection {
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
    pub manifests: FxHashSet<String>,
    pub type_exports: FxHashMap<String, FxHashSet<String>>,
    /// The names of each retained module asked beyond its local exports: the
    /// entry's system and companions, and every name of a namespace the
    /// system uses whole.
    pub asked: FxHashMap<String, FxHashSet<String>>,
    /// Each global style registration's declaring module and export, by its
    /// registered name, where the registration names a binding.
    pub global_origins: FxHashMap<String, (String, String)>,
}

/// What a request resolved to.
#[derive(Clone)]
enum Target {
    Module(String),
    Stub(String),
    /// Resolved to nothing usable, with why: fatal only for a reached import.
    Failed(String),
}

struct Module {
    retained: bool,
    /// The source as read.
    raw: String,
    /// The source as linked: stripped once retained.
    source: String,
    record: ModuleRecord<String, String>,
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
    /// An object literal: not a system unless its binding is written later.
    Object,
    Unknown(String),
}

const PENDING: &str = "\u{0}pending:";
const FAILED: &str = "\u{0}failed:";

pub(crate) struct Loader<'c> {
    context: &'c ResolutionContext,
    reads: LoadReads,
    modules: FxHashMap<String, Module>,
    targets: FxHashMap<(String, String), Target>,
    /// Each module a bare specifier outside Animus resolved to, by that
    /// specifier: a CommonJS one is refused.
    external: FxHashMap<String, String>,
    manifests: FxHashSet<String>,
    stub_exports: FxHashMap<String, FxHashSet<String>>,
    type_exports: FxHashMap<String, FxHashSet<String>>,
    asked: FxHashMap<String, FxHashSet<String>>,
    table: Option<Linked>,
    /// The nearest `package.json` name of each directory asked.
    package_names: FxHashMap<std::path::PathBuf, Option<String>>,
    /// The owner package directories, once the audit has asked.
    owners: Option<FxHashSet<std::path::PathBuf>>,
}

/// The table over every acquired module, with its key order.
struct Linked {
    table: ModuleTable<String>,
    keys: Vec<String>,
    index: FxHashMap<String, usize>,
}

impl<'c> Loader<'c> {
    pub fn new(context: &'c ResolutionContext) -> Self {
        Self {
            context,
            reads: LoadReads::default(),
            modules: FxHashMap::default(),
            targets: FxHashMap::default(),
            external: FxHashMap::default(),
            manifests: FxHashSet::default(),
            stub_exports: FxHashMap::default(),
            type_exports: FxHashMap::default(),
            asked: FxHashMap::default(),
            table: None,
            package_names: FxHashMap::default(),
            owners: None,
        }
    }

    /// What the load read and looked for, whether or not it succeeded.
    pub fn into_reads(self) -> LoadReads {
        self.reads
    }

    /// Selects what the system exported from `entry` reaches: `export_name`,
    /// or the export root inference names.
    pub fn select(&mut self, entry: &str, export_name: Option<&str>) -> Result<Selection, String> {
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
        // In rounds: retain what is due, then answer every waiting question
        // against one table, then read every module an answer waits on,
        // together. One round per depth of route, not per module read.
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
        self.audit(entry, &root);
        self.selection(entry, root)
    }

    /// The selection, with every request of every acquired module resolved
    /// to the key the linker registers it by.
    fn selection(&mut self, entry: &str, root: String) -> Result<Selection, String> {
        let mut specifier_map = FxHashMap::default();
        let mut retained = FxHashMap::default();
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
            let module = &self.modules[&path];
            if module.retained {
                retained.insert(path.clone(), module.source.clone());
            } else {
                routed.insert(path.clone(), module.record.clone());
            }
        }
        Ok(Selection {
            entry: entry.to_string(),
            root,
            retained,
            routed,
            specifier_map,
            stub_exports: std::mem::take(&mut self.stub_exports),
            manifests: std::mem::take(&mut self.manifests),
            type_exports: std::mem::take(&mut self.type_exports),
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
            let source = self.modules[&path].raw.clone();
            let allocator = Allocator::default();
            let program = Parser::new(&allocator, &source, source_type(&path)).parse().program;
            let semantic = SemanticBuilder::new().with_build_nodes(true).build(&program).semantic;
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
                    || !self.animus_value(&path, &program, member.object(), 0)?
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
                    let origin = self.declared_export(&path, &program, &value.name, &name)?;
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
            Some(Decl::Import { spec, name: Some(name) }) => match self.target(module, &spec) {
                Target::Module(path) => {
                    self.acquire(&path)?;
                    match self.terminal(&path, &name)? {
                        Some(terminal) => terminal,
                        None => return Ok(None),
                    }
                }
                _ => return Ok(None),
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
        // strip erases it, so it links to nothing and fails nothing. A
        // routed module's types are read from its source as written.
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
                self.reads.read.insert(manifest.clone());
                self.manifests.insert(manifest);
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
        let record = record_of(&raw, path);
        self.modules.insert(path.to_string(), Module { retained: false, source: raw.clone(), raw, record });
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
        let raw = self.modules[path].raw.clone();
        let source = if is_typescript(path) {
            let types = type_only_export_names(&raw, path);
            if !types.is_empty() {
                self.type_exports.insert(path.to_string(), types);
            }
            strip_typescript_module(&raw, path)?
        } else {
            raw
        };
        let module = self.modules.get_mut(path).expect("acquired above");
        module.record = record_of(&source, path);
        module.source = source;
        module.retained = true;
        self.table = None;
        Ok(())
    }

    /// The imports a retained module's body reads: each named or default
    /// import it references, and each namespace import by the members it
    /// reads, or whole when it uses the namespace otherwise. A reached import
    /// that resolves to nothing usable fails the load; a bare import and an
    /// import the body never reads are not followed.
    fn reached_imports(&mut self, path: &str) -> Result<Vec<Need>, String> {
        let source = self.modules[path].source.clone();
        let allocator = Allocator::default();
        let program = Parser::new(&allocator, &source, source_type(path)).parse().program;
        let semantic = SemanticBuilder::new().with_build_nodes(true).build(&program).semantic;
        let scoping = semantic.scoping();
        refuse_unsupported(&semantic, &source, path)?;
        let mut needs = Vec::new();
        for stmt in &program.body {
            let Statement::ImportDeclaration(decl) = stmt else { continue };
            if decl.import_kind.is_type() {
                continue;
            }
            let spec = decl.source.value.as_str();
            for specifier in decl.specifiers.iter().flatten() {
                let local = specifier.local();
                let references: Vec<_> = scoping.get_resolved_references(local.symbol_id()).collect();
                if references.is_empty() {
                    continue;
                }
                let name = match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(named) => {
                        if named.import_kind.is_type() {
                            continue;
                        }
                        Some(module_export_name(&named.imported))
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => Some("default".to_string()),
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => None,
                };
                let target = match self.target(path, spec) {
                    Target::Failed(reason) => return Err(reason),
                    Target::Stub(key) => {
                        self.stub_exports.entry(key).or_default().extend(name);
                        continue;
                    }
                    Target::Module(target) => target,
                };
                self.acquire(&target)?;
                if package_dir(Path::new(&target)) != package_dir(Path::new(path)) {
                    needs.push(Need::Companions(target.clone()));
                }
                match name {
                    Some(name) => needs.push(Need::Ask { importer: path.to_string(), module: target, name }),
                    None => {
                        // A namespace read only by static member reads reaches
                        // those members; any other use needs it whole.
                        let members: Option<Vec<String>> = references
                            .iter()
                            .map(|reference| static_member(&semantic, reference.node_id()))
                            .collect();
                        match members {
                            Some(members) => needs.extend(members.into_iter().map(|name| Need::Ask {
                                importer: path.to_string(),
                                module: target.clone(),
                                name,
                            })),
                            None => needs.push(Need::Namespace(target)),
                        }
                    }
                }
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
                let record = self.modules[key].record.clone();
                let mut requests: Vec<Request> = Vec::with_capacity(record.requests.len());
                for spec in &record.requests {
                    requests.push(match self.target(key, spec) {
                        Target::Module(path) => match index.get(&path) {
                            Some(&at) => Request::Module(at),
                            None => Request::Unresolved(format!("{PENDING}{path}")),
                        },
                        Target::Stub(stub) => Request::Outside(stub),
                        Target::Failed(reason) => Request::Unresolved(format!("{FAILED}{reason}")),
                    });
                }
                records.push(ModuleRecord {
                    requests,
                    imports: record.imports,
                    local_exports: record.local_exports,
                    indirect_exports: record.indirect_exports,
                    namespace_exports: record.namespace_exports,
                    star_exports: record.star_exports,
                    default_cells: record.default_cells,
                });
            }
            self.table = Some(Linked { table: ModuleTable::new(records), keys, index });
        }
        self.table.as_ref().expect("built above")
    }

    /// Export `name` of `module`, reading each module the answer waits on
    /// until no route is pending. A star of a stub supplies the name when no
    /// analysed branch does.
    fn lookup(&mut self, module: &str, name: &str) -> Result<ExportLookup<String>, String> {
        loop {
            match self.lookup_now(module, name) {
                Ok(lookup) => return Ok(lookup),
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
            return Ok(close_stub_stars(known, openings, name));
        }
        Err(pending)
    }

    /// Every export name of `module`, reading star targets until the list is
    /// closed.
    fn exported_names(&mut self, module: &str) -> Result<Vec<String>, String> {
        loop {
            match self.names_now(module) {
                Ok(names) => return Ok(names),
                Err(pending) => {
                    for path in pending {
                        self.acquire(&path)?;
                    }
                }
            }
        }
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
        // `theme` and `tokens` are the companions: the loader requires each to
        // be a built theme beside a separate system, so neither is one.
        for name in names.into_iter().filter(|name| name != "theme" && name != "tokens") {
            match self.class_of_export(entry, &name, 0)? {
                Class::System(origin) => match candidates.iter_mut().find(|(at, _)| *at == origin) {
                    Some((_, names)) => names.push(name),
                    None => candidates.push((origin, vec![name])),
                },
                Class::NotSystem | Class::Object => {}
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

    /// The class of binding `local` declared in `module`.
    fn class_of_binding(&mut self, module: &str, local: &str, depth: usize) -> Result<Class, String> {
        let source = self.modules[module].raw.clone();
        let allocator = Allocator::default();
        let program = Parser::new(&allocator, &source, source_type(module)).parse().program;
        let class = match declaration(&program, local) {
            None => Class::Unknown(format!("no declaration of '{local}'")),
            Some(Decl::NotSystem) => Class::NotSystem,
            Some(Decl::Init(init)) => self.class_of_expression(module, &program, init, depth)?,
            Some(Decl::Assigned(values)) if values.len() == 1 => self.class_of_expression(module, &program, values[0], depth)?,
            Some(Decl::Assigned(_)) => Class::Unknown(format!("'{local}' is assigned more than once")),
            Some(Decl::Destructured { key, from }) => {
                if non_sealing_method(&key) && self.animus_value(module, &program, from, depth)? {
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
        if class == Class::Object && written_after(&program, local) {
            return Ok(Class::Unknown(format!("'{local}' is an object written after its declaration")));
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
            | Expression::UnaryExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::ClassExpression(_)
            | Expression::JSXElement(_)
            | Expression::JSXFragment(_)
            | Expression::ArrayExpression(_) => Class::NotSystem,
            Expression::ObjectExpression(object) => {
                let key = |property: &PropertyKey<'_>| property.static_name().map(|name| name.to_string());
                let mut class = Class::Object;
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
        Ok(if class == Class::Object { Class::NotSystem } else { class })
    }

    /// Whether `local`, called, is an Animus non-sealing function: an import
    /// of one from `@animus-ui/system`, or a method destructured from an
    /// Animus value.
    fn animus_callable(&mut self, module: &str, program: &Program<'_>, local: &str, depth: usize) -> Result<bool, String> {
        Ok(match declaration(program, local) {
            Some(Decl::Import { spec, name: Some(name) }) => {
                non_sealing_function(&name) && self.animus_module(module, &spec)?
                    || non_sealing_method(&name) && {
                        match self.target(module, &spec) {
                            Target::Module(path) => {
                                self.acquire(&path)?;
                                match self.terminal(&path, &name)? {
                                    Some((at, binding)) => self.animus_binding_destructured(&at, &binding, depth + 1)?,
                                    None => false,
                                }
                            }
                            _ => false,
                        }
                    }
            }
            Some(Decl::Destructured { key, from }) => non_sealing_method(&key) && self.animus_value(module, program, from, depth)?,
            _ => false,
        })
    }

    /// Whether `binding` in `module` is a method destructured from an Animus
    /// value.
    fn animus_binding_destructured(&mut self, module: &str, binding: &str, depth: usize) -> Result<bool, String> {
        let source = self.modules[module].raw.clone();
        let allocator = Allocator::default();
        let program = Parser::new(&allocator, &source, source_type(module)).parse().program;
        Ok(match declaration(&program, binding) {
            Some(Decl::Destructured { key, from }) => non_sealing_method(&key) && self.animus_value(module, &program, from, depth)?,
            _ => false,
        })
    }

    /// Whether binding `local` of `module` holds an Animus value.
    fn animus_binding(&mut self, module: &str, local: &str, depth: usize) -> Result<bool, String> {
        let source = self.modules[module].raw.clone();
        let allocator = Allocator::default();
        let program = Parser::new(&allocator, &source, source_type(module)).parse().program;
        self.animus_local(module, &program, local, depth)
    }

    /// Whether property `key` of the object literal `binding` of `module`
    /// holds an Animus value.
    fn animus_property(&mut self, module: &str, binding: &str, key: &str, depth: usize) -> Result<bool, String> {
        let source = self.modules[module].raw.clone();
        let allocator = Allocator::default();
        let program = Parser::new(&allocator, &source, source_type(module)).parse().program;
        let value = match declaration(&program, binding) {
            Some(Decl::Init(Expression::ObjectExpression(literal))) => literal.properties.iter().find_map(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) if !property.computed && property.key.static_name().as_deref() == Some(key) => {
                    Some(&property.value)
                }
                _ => None,
            }),
            _ => None,
        };
        match value {
            Some(value) => self.animus_value(module, &program, value, depth + 1),
            None => self.animus_local(module, &program, binding, depth + 1),
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
                if self.animus_module(module, &spec)? {
                    true
                } else if let (Target::Module(path), Some(name)) = (self.target(module, &spec), name) {
                    self.acquire(&path)?;
                    match self.terminal(&path, &name)? {
                        Some((at, binding)) => self.animus_binding(&at, &binding, depth + 1)?,
                        None => false,
                    }
                } else {
                    false
                }
            }
            Some(Decl::NotSystem) | None => false,
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
                        Expression::Identifier(object) => match declaration(program, &object.name) {
                            Some(Decl::Init(Expression::ObjectExpression(literal))) => literal.properties.iter().find_map(|property| match property {
                                ObjectPropertyKind::ObjectProperty(property)
                                    if !property.computed && property.key.static_name().as_deref() == Some(key) =>
                                {
                                    Some(&property.value)
                                }
                                _ => None,
                            }),
                            _ => None,
                        },
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
                                Some((spec, name, key)) => match self.target(module, &spec) {
                                    Target::Module(path) => {
                                        self.acquire(&path)?;
                                        match self.terminal(&path, &name)? {
                                            Some((at, binding)) => self.animus_property(&at, &binding, &key, depth + 1)?,
                                            None => false,
                                        }
                                    }
                                    _ => false,
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
        let owners = self.owner_dirs(entry);
        let runs = |modules: &FxHashMap<String, Module>, path: &str| modules.get(path).is_some_and(|module| module.retained);
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
            if !seen.insert(path.clone()) || runs(&self.modules, &path) || !self.owned(&path, &owners) {
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
    /// builder; unproved when it sits in a function or its receiver cannot be
    /// traced. A same-named method of a third-party value is not one.
    fn audit_source(&mut self, path: &str, source: &str, root: &str) {
        const REGISTRATIONS: [&str; 2] = ["registerGlobalStyles", "registerKeyframes"];
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, source_type(path)).parse();
        if !parsed.diagnostics.is_empty() {
            self.incomplete(path, "it does not parse");
            return;
        }
        let program = parsed.program;
        let semantic = SemanticBuilder::new().with_build_nodes(true).build(&program).semantic;
        let scoping = semantic.scoping();
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
            if receiver.is_some_and(|receiver| self.third_party(path, &program, receiver)) {
                continue;
            }
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
        let _ = scoping;
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

    /// Whether a receiver's root binding is imported from a third-party
    /// package: one neither owned nor `@animus-ui/system`.
    fn third_party(&mut self, path: &str, program: &Program<'_>, receiver: &Expression<'_>) -> bool {
        let mut root = receiver.get_inner_expression();
        loop {
            root = match root {
                Expression::CallExpression(call) => match call.callee.get_inner_expression().as_member_expression() {
                    Some(member) => member.object().get_inner_expression(),
                    None => return false,
                },
                expression => match expression.as_member_expression() {
                    Some(member) => member.object().get_inner_expression(),
                    None => break,
                },
            };
        }
        let Expression::Identifier(identifier) = root else { return false };
        let Some(Decl::Import { spec, .. }) = declaration(program, &identifier.name) else { return false };
        if spec.starts_with('.') || spec.starts_with('/') {
            return false;
        }
        let Target::Module(target) = self.target(path, &spec) else { return false };
        let owners = self.owners.clone().unwrap_or_default();
        !self.owned(&target, &owners) && self.package_name(Path::new(&target)).as_deref() != Some("@animus-ui/system")
    }

    /// The package directories whose code is owned: the entry's package and
    /// the session's declared workspaces.
    fn owner_dirs(&mut self, entry: &str) -> FxHashSet<std::path::PathBuf> {
        let mut owners: FxHashSet<std::path::PathBuf> = self
            .context
            .workspaces
            .values()
            .map(|dir| std::fs::canonicalize(dir).unwrap_or_else(|_| dir.clone()))
            .collect();
        owners.extend(package_dir(Path::new(entry)));
        self.owners = Some(owners.clone());
        owners
    }

    /// Whether `path` is owned code: in an owner package, or in a source kit
    /// (a package declaring the `animus` source condition), wherever it is
    /// installed. Each manifest that decides it is read evidence.
    fn owned(&mut self, path: &str, owners: &FxHashSet<std::path::PathBuf>) -> bool {
        let Some(dir) = package_dir(Path::new(path)) else { return false };
        self.reads.read.insert(dir.join("package.json").to_string_lossy().to_string());
        owners.contains(&dir) || crate::declares_kit_source(&dir)
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

    fn package_name(&mut self, file: &Path) -> Option<String> {
        let mut dir = file.parent()?.to_path_buf();
        let mut walked = Vec::new();
        let name = loop {
            if let Some(name) = self.package_names.get(&dir) {
                break name.clone();
            }
            walked.push(dir.clone());
            let manifest = dir.join("package.json");
            if let Ok(text) = std::fs::read_to_string(&manifest) {
                break serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|json| json.get("name").and_then(|name| name.as_str()).map(str::to_string));
            }
            if !dir.pop() {
                break None;
            }
        };
        for dir in walked {
            self.package_names.insert(dir, name.clone());
        }
        name
    }
}

/// Refuses, with its location, construction a retained module cannot run
/// as selected: direct `eval` and `with`, which read bindings the selection
/// cannot see, and top-level `await`, which the loader does not run.
fn refuse_unsupported(semantic: &oxc::semantic::Semantic<'_>, source: &str, path: &str) -> Result<(), String> {
    use oxc::span::GetSpan;
    let at = |offset: u32| {
        let before = &source[..offset as usize];
        let line = before.matches('\n').count() + 1;
        let column = before.rsplit('\n').next().map_or(0, |text| text.chars().count()) + 1;
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
    matches!(name, "createTheme" | "createSystem" | "createTransform" | "createGlobalStyles" | "createKeyframes" | "compose")
}

/// How a module declares a binding, as root inference reads it.
enum Decl<'a, 'p> {
    Init(&'a Expression<'p>),
    /// `let x;` then `x = …` at module level.
    Assigned(Vec<&'a Expression<'p>>),
    Destructured { key: String, from: &'a Expression<'p> },
    Import { spec: String, name: Option<String> },
    /// A function, class or enum, or a binding with no value to classify.
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
                    if function.id.as_ref().is_some_and(|id| id.name == local) =>
                {
                    return Some(Decl::NotSystem)
                }
                ExportDefaultDeclarationKind::ClassDeclaration(class) if class.id.as_ref().is_some_and(|id| id.name == local) => {
                    return Some(Decl::NotSystem)
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
                            return Some(match &declarator.init {
                                Some(init) => Decl::Init(init),
                                None => Decl::Assigned(assignments(program, local)),
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
                return Some(Decl::NotSystem)
            }
            Declaration::ClassDeclaration(class) if class.id.as_ref().is_some_and(|id| id.name == local) => {
                return Some(Decl::NotSystem)
            }
            Declaration::TSEnumDeclaration(enumeration) if enumeration.id.name == local => return Some(Decl::NotSystem),
            _ => {}
        }
    }
    None
}

/// The values `local` is assigned at module level.
fn assignments<'a, 'p>(program: &'a Program<'p>, local: &str) -> Vec<&'a Expression<'p>> {
    program
        .body
        .iter()
        .filter_map(|stmt| match stmt {
            Statement::ExpressionStatement(statement) => match &statement.expression {
                Expression::AssignmentExpression(assignment)
                    if assignment.left.get_identifier_name().is_some_and(|name| name == local) =>
                {
                    Some(&assignment.right)
                }
                _ => None,
            },
            _ => None,
        })
        .collect()
}

/// Whether `program` writes a member of `local` at module level, or passes
/// it first to `Object.assign`, `defineProperty`, `defineProperties` or
/// `setPrototypeOf`.
fn written_after(program: &Program<'_>, local: &str) -> bool {
    let semantic = SemanticBuilder::new().with_build_nodes(true).build(program).semantic;
    let named = |expression: &Expression<'_>| matches!(expression, Expression::Identifier(id) if id.name == local);
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

/// An open answer with no pending route: a star of a stub supplies the name
/// when no analysed branch has it.
fn close_stub_stars(mut known: Vec<Terminal<String>>, openings: Vec<crate::module_table::Opening>, name: &str) -> ExportLookup<String> {
    let failed = openings
        .iter()
        .any(|opening| matches!(&opening.reason, OpeningReason::UnresolvedRequest(marker) if marker.starts_with(FAILED)));
    if failed && known.is_empty() {
        return ExportLookup::Incomplete { known, openings };
    }
    if known.is_empty() {
        if let Some(stub) = openings.iter().find_map(|opening| match &opening.reason {
            OpeningReason::OutsideStar(stub) => Some(stub.clone()),
            OpeningReason::UnresolvedRequest(_) => None,
        }) {
            known.push(Terminal::External { module: stub, export: Some(name.to_string()) });
        }
    }
    match known.len() {
        0 => ExportLookup::Absent,
        1 => ExportLookup::Resolved(known.remove(0)),
        _ => ExportLookup::Ambiguous(known),
    }
}

/// The directory of the nearest `package.json` above `file`.
fn package_dir(file: &Path) -> Option<std::path::PathBuf> {
    let mut dir = file.parent()?.to_path_buf();
    loop {
        if dir.join("package.json").is_file() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
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

fn source_type(path: &str) -> SourceType {
    SourceType::from_path(Path::new(path)).unwrap_or_else(|_| SourceType::mjs()).with_module(true)
}

/// A module's runtime imports and exports from its syntax, requests by
/// specifier in source order. Type-only declarations, and local exports of a
/// name only a type declares, are left out: they name no runtime binding.
fn record_of(source: &str, path: &str) -> ModuleRecord<String, String> {
    let allocator = Allocator::default();
    let program = Parser::new(&allocator, source, source_type(path)).parse().program;
    let mut record = ModuleRecord {
        requests: Vec::new(),
        imports: Vec::new(),
        local_exports: Vec::new(),
        indirect_exports: Vec::new(),
        namespace_exports: Vec::new(),
        star_exports: Vec::new(),
        default_cells: Vec::new(),
    };
    let mut request = |requests: &mut Vec<String>, spec: &str| match requests.iter().position(|seen| seen == spec) {
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
                if decl.import_kind.is_type() {
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
