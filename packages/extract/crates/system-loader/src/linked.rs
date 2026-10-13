//! A system's modules evaluate as Node evaluates them. Every module's
//! export object exists first. Each module is then linked: its exports become getters over
//! its own bindings, so a function declaration is readable at once and a
//! `let`, `const` or `class` binding throws until it is initialized, and each
//! name `export *` brings in is resolved now, as Node resolves it. Modules
//! then evaluate once each, depth first from the entry, each after the
//! modules it imports in source order. Every import reads the exporting
//! module when it runs, as a live binding does. An import of a name its
//! module does not export, or exports ambiguously, fails the load.

use std::fmt::Write as _;
use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::{ExportDefaultDeclarationKind, Expression, ImportDeclarationSpecifier, Statement};
use oxc::ast::AstKind;
use oxc::parser::{Parser, ParserReturn};
use oxc::semantic::SemanticBuilder;
use oxc::span::{GetSpan, SourceType};
use rustc_hash::{FxHashMap, FxHashSet};

use super::{js_quoted, module_export_name, stub_key};

fn source_type(path: &str) -> SourceType {
    SourceType::from_path(Path::new(path))
        .unwrap_or_else(|_| SourceType::mjs())
        .with_module(true)
}

/// The registry key a specifier of `path` names: a module's canonical path,
/// or a stub's key.
fn module_key(path: &str, spec: &str, specifier_map: &FxHashMap<(String, String), String>) -> String {
    specifier_map
        .get(&(path.to_string(), spec.to_string()))
        .cloned()
        .unwrap_or_else(|| stub_key(spec))
}

/// Each analysed module's place in `__modules['#']`, the registry's
/// non-enumerable list of module objects, by key: a read through it names a
/// module in a few characters where its key is a whole path.
pub(crate) type ModuleRefs = FxHashMap<String, usize>;

/// The expression for the module object registered as `key`.
pub(crate) fn module_ref(refs: &ModuleRefs, key: &str) -> String {
    match refs.get(key) {
        Some(at) => format!("__modules['#'][{at}]"),
        None => format!("__modules['{}']", js_quoted(key)),
    }
}

/// The read of export `name` of the module registered as `key`.
fn export_read(refs: &ModuleRefs, key: &str, name: &str) -> String {
    format!("{}['{}']", module_ref(refs, key), js_quoted(name))
}

/// Every module in evaluation order: depth-first post-order from the entry,
/// following imports and re-exports in source order, then any module not
/// reached, in path order.
pub(crate) fn evaluation_order(modules: &FxHashMap<String, LinkedModule>, entry_path: &str) -> Vec<String> {
    let requests = |path: &str| -> Vec<String> {
        modules[path].requests.iter().filter(|target| modules.contains_key(*target)).cloned().collect()
    };
    let mut paths: Vec<&String> = modules.keys().collect();
    paths.sort();
    let mut seen: FxHashSet<String> = FxHashSet::default();
    let mut order: Vec<String> = Vec::new();
    // Iterative, so a deep graph cannot overflow the stack.
    for root in std::iter::once(entry_path).chain(paths.iter().map(|path| path.as_str())) {
        if !modules.contains_key(root) || !seen.insert(root.to_string()) {
            continue;
        }
        let mut stack: Vec<(String, Vec<String>, usize)> = vec![(root.to_string(), requests(root), 0)];
        while let Some((node, children, index)) = stack.last_mut() {
            if let Some(child) = children.get(*index).cloned() {
                *index += 1;
                if seen.insert(child.clone()) {
                    let grandchildren = requests(&child);
                    stack.push((child, grandchildren, 0));
                }
            } else {
                order.push(node.clone());
                stack.pop();
            }
        }
    }
    order
}

/// What one of a module's own export names reads.
#[derive(Clone)]
pub(crate) enum ExportTarget {
    /// A binding the module declares.
    Local(String),
    /// Export `name` of the module registered as `from`: a re-export, or an
    /// export of an imported binding.
    Indirect { from: String, name: String },
    /// The namespace of the module registered as `from`.
    Namespace { from: String },
}

/// Bundle code that runs before any module: `__modules['#import'](read).value`
/// is an imported binding as an assignment target. Reading it reads the
/// binding, so a compound or logical assignment, an update and a
/// destructuring read and short-circuit as Node does, and only the write
/// itself throws. The key names no module, and it is not enumerable, so
/// scans over `__modules` skip it.
///
/// The other keys hold what the bundle writes as data, which QuickJS reads
/// far faster than it compiles the same statements: `'#fields'` splits a
/// string of length-prefixed fields ([`push_field`]), `'#register'` registers
/// each module's export object, and `'#reads'` defines export getters that
/// each read a module's export or export object ([`ModuleReads`]). `'#run'`
/// holds each module's generator, by its place in `__modules['#']`.
pub(crate) const PRELUDE: &str = "Object.defineProperty(__modules, '#import', { value: (read) => ({ get value() { return read(); }, \
     set value(_) { throw new TypeError('Assignment to constant variable.'); } }) });\n\
     Object.defineProperty(__modules, '#fields', { value: (data) => { const fields = []; \
     for (let at = 0; at < data.length;) { const colon = data.indexOf(':', at); \
     const end = colon + 1 + Number(data.slice(at, colon)); fields.push(data.slice(colon + 1, end)); at = end; } \
     return fields; } });\n\
     Object.defineProperty(__modules, '#register', { value: (places, data) => { const keys = __modules['#fields'](data); \
     for (let i = 0; i < places.length; i++) __modules['#'][places[i]] = __modules[keys[i]] = {}; } });\n\
     Object.defineProperty(__modules, '#reads', { value: (ns, data) => { const fields = __modules['#fields'](data); \
     for (let i = 0; i < fields.length; i += 4) { const kind = fields[i + 1], read = fields[i + 3]; \
     const at = kind[0] === '#' ? Number(fields[i + 2]) : fields[i + 2]; \
     const get = kind[0] === '#' \
     ? (kind[1] === '*' ? () => __modules['#'][at] : () => __modules['#'][at][read]) \
     : (kind[1] === '*' ? () => __modules[at] : () => __modules[at][read]); \
     Object.defineProperty(ns, fields[i], { enumerable: true, get }); } } });\n\
     Object.defineProperty(__modules, '#run', { value: [] });\n";

/// Appends `field` to a `'#fields'` string: its length in UTF-16 code units,
/// as JavaScript counts it, a colon, then the field. No character needs
/// escaping, so a field may hold any name or path.
pub(crate) fn push_field(data: &mut String, field: &str) {
    let _ = write!(data, "{}:{}", field.encode_utf16().count(), field);
}

/// What an export getter returns.
pub(crate) enum Getter {
    /// A binding the module declares, which only its own scope can read.
    Local(String),
    /// Export `name` of the module registered as `module`, or with no name
    /// that module's export object.
    Module { module: String, name: Option<String> },
}

/// A run of [`Getter::Module`] getters for one export object, as the data a
/// `'#reads'` call takes: four fields each, the export name, a kind (`#` for
/// a module named by its place in `__modules['#']`, `@` for one named by its
/// key, then `.` to read an export or `*` for the export object), the module
/// and the export it reads.
#[derive(Default)]
pub(crate) struct ModuleReads(String);

impl ModuleReads {
    pub fn push(&mut self, refs: &ModuleRefs, export: &str, module: &str, name: Option<&str>) {
        let place = refs.get(module).map(|at| at.to_string());
        let kind = match (&place, name) {
            (Some(_), Some(_)) => "#.",
            (Some(_), None) => "#*",
            (None, Some(_)) => "@.",
            (None, None) => "@*",
        };
        push_field(&mut self.0, export);
        push_field(&mut self.0, kind);
        push_field(&mut self.0, place.as_deref().unwrap_or(module));
        push_field(&mut self.0, name.unwrap_or(""));
    }

    /// Writes the run as one `'#reads'` call on `exports`, an export object
    /// expression, and starts a new run.
    pub fn flush(&mut self, bundle: &mut String, exports: &str) {
        if !self.0.is_empty() {
            let _ = writeln!(bundle, "__modules['#reads']({exports}, '{}');", js_quoted(&self.0));
            self.0.clear();
        }
    }
}

/// A name for the module's own binding of its default export that the
/// module neither declares nor reads: a name it uses may not be taken.
fn default_binding_name(scoping: &oxc::semantic::Scoping) -> String {
    let taken: FxHashSet<&str> =
        scoping.symbol_names().chain(scoping.root_unresolved_references().keys().map(|name| name.as_str())).collect();
    std::iter::once("__default".to_string())
        .chain((1..).map(|n| format!("__default{n}")))
        .find(|name| !taken.contains(name.as_str()))
        .expect("an unbounded sequence holds a free name")
}

/// A module rewritten for linking: its exports, stars and imports link every
/// graph; its link code and body make the bundle.
pub(crate) struct LinkedModule {
    /// Its own export names, in source order.
    pub exports: Vec<(String, ExportTarget)>,
    /// The modules its `export *` declarations name, in source order.
    pub stars: Vec<String>,
    /// Each named or default import: its module and the name.
    pub imports: Vec<(String, String)>,
    /// The module each import and re-export declaration names, in source
    /// order: the edges evaluation order follows.
    pub requests: Vec<String>,
    /// Statements that run at link time, before the export getters: an
    /// anonymous default function's name.
    pub link: String,
    /// Its code with imports and export syntax removed and each read of an
    /// imported binding reading the exporting module.
    pub body: String,
    /// The range in `body` of each reference to an imported binding, and the
    /// local name the module refers to it by.
    pub import_refs: Vec<(usize, usize, String)>,
}

struct Edit {
    start: usize,
    end: usize,
    text: String,
}

/// Where a named import reads: the module and export name a route through
/// re-exports ends at, when the import should read there rather than
/// through the module it names.
pub(crate) type Retarget<'r> = &'r dyn Fn(&str, &str) -> Option<(String, String)>;

pub(crate) fn rewrite_module_for_linking(
    source: &str,
    canonical_path: &str,
    specifier_map: &FxHashMap<(String, String), String>,
    refs: &ModuleRefs,
    retarget: Retarget<'_>,
) -> Result<LinkedModule, String> {
    let allocator = Allocator::default();
    let ParserReturn { program, .. } =
        Parser::new(&allocator, source, source_type(canonical_path)).parse();
    let semantic = SemanticBuilder::new().with_build_nodes(true).build(&program).semantic;
    let scoping = semantic.scoping();
    let key = |spec: &str| module_key(canonical_path, spec, specifier_map);
    // The loader reads exports and imports through `__modules`: a module may
    // declare it only in a scope where it reads no import.
    let reserved = |what: &str| {
        Err(format!(
            "module '{canonical_path}' declares `__modules`{what}, which the system loader reserves for \
             the modules it links; rename the binding"
        ))
    };
    let cells: Vec<oxc::semantic::ScopeId> = scoping
        .symbol_ids()
        .filter(|&symbol| scoping.symbol_name(symbol) == "__modules")
        .map(|symbol| scoping.symbol_scope_id(symbol))
        .collect();
    if cells.contains(&scoping.root_scope_id()) {
        return reserved("");
    }

    let mut edits: Vec<Edit> = Vec::new();
    let mut removed: Vec<(usize, usize)> = Vec::new();
    // Each imported binding, by symbol, as the module export it reads, and
    // by local name, as what exporting it exports.
    let mut imported = FxHashMap::default();
    let mut import_targets: FxHashMap<String, ExportTarget> = FxHashMap::default();
    let mut module = LinkedModule {
        exports: Vec::new(),
        stars: Vec::new(),
        imports: Vec::new(),
        requests: program
            .body
            .iter()
            .filter_map(|stmt| match stmt {
                Statement::ImportDeclaration(decl) => Some(decl.source.value.as_str()),
                Statement::ExportFromDeclaration(decl) => Some(decl.source.value.as_str()),
                Statement::ExportAllDeclaration(decl) => Some(decl.source.value.as_str()),
                _ => None,
            })
            .map(key)
            .collect(),
        link: String::new(),
        body: String::new(),
        import_refs: Vec::new(),
    };
    let mut local_exports: Vec<(String, String)> = Vec::new();
    let default_name = default_binding_name(scoping);
    let mut remove = |edits: &mut Vec<Edit>, start: u32, end: u32| {
        removed.push((start as usize, end as usize));
        edits.push(Edit { start: start as usize, end: end as usize, text: String::new() });
    };

    for stmt in &program.body {
        match stmt {
            Statement::ImportDeclaration(decl) => {
                let from = key(&decl.source.value);
                for specifier in decl.specifiers.iter().flatten() {
                    let name = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => module_export_name(&named.imported),
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => "default".to_string(),
                        // The namespace object is the module's export object;
                        // a call through it keeps it as `this`.
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                            let local = &namespace.local;
                            import_targets.insert(local.name.to_string(), ExportTarget::Namespace { from: from.clone() });
                            imported.insert(local.symbol_id(), module_ref(refs, &from));
                            continue;
                        }
                    };
                    let local = specifier.local();
                    module.imports.push((from.clone(), name.clone()));
                    import_targets.insert(
                        local.name.to_string(),
                        ExportTarget::Indirect { from: from.clone(), name: name.clone() },
                    );
                    let read = match retarget(&from, &name) {
                        Some((module, export)) => export_read(refs, &module, &export),
                        None => export_read(refs, &from, &name),
                    };
                    imported.insert(local.symbol_id(), read);
                }
                remove(&mut edits, decl.span.start, decl.span.end);
            }
            Statement::ExportFromDeclaration(decl) => {
                let from = key(&decl.source.value);
                for es in &decl.specifiers {
                    module.exports.push((
                        module_export_name(&es.exported),
                        ExportTarget::Indirect { from: from.clone(), name: module_export_name(&es.local) },
                    ));
                }
                remove(&mut edits, decl.span.start, decl.span.end);
            }
            Statement::ExportDeclaration(decl) => {
                edits.push(Edit {
                    start: decl.span.start as usize,
                    end: decl.declaration.span().start as usize,
                    text: String::new(),
                });
                collect_declaration_export_names(&decl.declaration, &mut local_exports);
            }
            Statement::ExportNamedDeclaration(decl) => {
                for es in &decl.specifiers {
                    local_exports.push((module_export_name(&es.exported), module_export_name(&es.local)));
                }
                remove(&mut edits, decl.span.start, decl.span.end);
            }
            Statement::ExportDefaultDeclaration(decl) => {
                let start = decl.declaration.span().start;
                let prefix = Edit { start: decl.span.start as usize, end: start as usize, text: String::new() };
                match &decl.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => match &function.id {
                        Some(id) => local_exports.push(("default".to_string(), id.name.to_string())),
                        // Still a hoisted declaration, under a name of its own.
                        None => {
                            edits.push(Edit {
                                start: function.params.span.start as usize,
                                end: function.params.span.start as usize,
                                text: format!(" {default_name}"),
                            });
                            let _ = writeln!(
                                module.link,
                                "Object.defineProperty({default_name}, 'name', {{ value: 'default', configurable: true }});"
                            );
                            local_exports.push(("default".to_string(), default_name.clone()));
                        }
                    },
                    ExportDefaultDeclarationKind::ClassDeclaration(class) if class.id.is_some() => {
                        let id = class.id.as_ref().map(|id| id.name.to_string()).unwrap_or_default();
                        local_exports.push(("default".to_string(), id));
                    }
                    kind => {
                        // An anonymous function or class takes the name
                        // `default`, as an export default names it: a
                        // property key names it so too.
                        let anonymous = match kind {
                            ExportDefaultDeclarationKind::ClassDeclaration(_) => true,
                            kind => kind.as_expression().is_some_and(|expr| match expr.get_inner_expression() {
                                Expression::ArrowFunctionExpression(_) => true,
                                Expression::FunctionExpression(function) => function.id.is_none(),
                                Expression::ClassExpression(class) => class.id.is_none(),
                                _ => false,
                            }),
                        };
                        let opening = if anonymous { "{ default: " } else { "" };
                        edits.push(Edit { text: format!("const {default_name} = {opening}"), ..prefix });
                        if anonymous {
                            let end = decl.declaration.span().end as usize;
                            edits.push(Edit { start: end, end, text: " }.default".to_string() });
                        }
                        if matches!(kind, ExportDefaultDeclarationKind::ClassDeclaration(_)) {
                            edits.push(Edit {
                                start: decl.span.end as usize,
                                end: decl.span.end as usize,
                                text: ";".to_string(),
                            });
                        }
                        local_exports.push(("default".to_string(), default_name.clone()));
                        continue;
                    }
                }
                edits.push(prefix);
            }
            Statement::ExportAllDeclaration(decl) => {
                let from = key(&decl.source.value);
                match &decl.exported {
                    Some(exported) => {
                        module.exports.push((module_export_name(exported), ExportTarget::Namespace { from }))
                    }
                    None => module.stars.push(from),
                }
                remove(&mut edits, decl.span.start, decl.span.end);
            }
            _ => {}
        }
    }
    // An export of an imported binding re-exports that module's export, or
    // its namespace.
    for (exported, local) in local_exports {
        let target = import_targets.get(&local).cloned().unwrap_or(ExportTarget::Local(local));
        module.exports.push((exported, target));
    }

    // Each import reference's edit, and the local name it refers to.
    let mut refs: FxHashMap<(usize, usize), &str> = FxHashMap::default();
    for (&symbol, cell) in &imported {
        for reference in scoping.get_resolved_references(symbol) {
            let at = reference.scope_id();
            if cells.iter().any(|&scope| at == scope || scoping.scope_is_descendant_of(at, scope)) {
                return reserved(" where it reads an import");
            }
            let node = reference.node_id();
            let span = semantic.nodes().get_node(node).span();
            let (start, end) = (span.start as usize, span.end as usize);
            if removed.iter().any(|&(s, e)| s <= start && end <= e) {
                continue;
            }
            // An imported binding is read-only: writing it throws when the
            // write runs, as Node throws, and the module still loads.
            // `(0, …)`: a read in any expression position, and a call through
            // it gets no `this`, as an imported function's does.
            let read = if reference.is_write() {
                format!("__modules['#import'](() => {cell}).value")
            } else {
                format!("(0, {cell})")
            };
            // A shorthand property's span is its name's.
            let text = match semantic.nodes().parent_kind(node) {
                AstKind::ObjectProperty(property) if property.shorthand => format!("{}: {}", &source[start..end], read),
                AstKind::AssignmentTargetPropertyIdentifier(_) => format!("{}: {}", &source[start..end], read),
                _ => read,
            };
            let edit = Edit { start, end, text };
            refs.insert((start, end), scoping.symbol_name(symbol));
            edits.push(edit);
        }
    }

    // Edits never overlap; at one offset an insertion lands ahead of a
    // replacement there.
    edits.sort_by_key(|edit| (edit.start, edit.end));
    let mut at = 0;
    for edit in &edits {
        module.body.push_str(&source[at..edit.start]);
        let start = module.body.len();
        module.body.push_str(&edit.text);
        if let Some(local) = refs.get(&(edit.start, edit.end)) {
            module.import_refs.push((start, module.body.len(), (*local).to_string()));
        }
        at = edit.end;
    }
    module.body.push_str(&source[at..]);
    Ok(module)
}

pub(crate) fn collect_declaration_export_names(
    declaration: &oxc::ast::ast::Declaration<'_>,
    exports: &mut Vec<(String, String)>,
) {
    match declaration {
        oxc::ast::ast::Declaration::VariableDeclaration(var_decl) => {
            for declarator in &var_decl.declarations {
                collect_binding_names(&declarator.id, exports);
            }
        }
        oxc::ast::ast::Declaration::FunctionDeclaration(fn_decl) => {
            if let Some(id) = &fn_decl.id {
                let name = id.name.to_string();
                exports.push((name.clone(), name));
            }
        }
        oxc::ast::ast::Declaration::ClassDeclaration(class_decl) => {
            if let Some(id) = &class_decl.id {
                let name = id.name.to_string();
                exports.push((name.clone(), name));
            }
        }
        _ => {}
    }
}

fn collect_binding_names(
    pattern: &oxc::ast::ast::BindingPattern<'_>,
    exports: &mut Vec<(String, String)>,
) {
    match pattern {
        oxc::ast::ast::BindingPattern::BindingIdentifier(id) => {
            let name = id.name.to_string();
            exports.push((name.clone(), name));
        }
        oxc::ast::ast::BindingPattern::ObjectPattern(obj) => {
            for prop in &obj.properties {
                collect_binding_names(&prop.value, exports);
            }
        }
        oxc::ast::ast::BindingPattern::ArrayPattern(arr) => {
            for elem in arr.elements.iter().flatten() {
                collect_binding_names(elem, exports);
            }
        }
        oxc::ast::ast::BindingPattern::AssignmentPattern(assign) => {
            collect_binding_names(&assign.left, exports);
        }
    }
}

/// The export relation of a system's modules, cyclic or not, answered by the shared
/// module table. A stub is a module outside the graph: an import of it names
/// its export without proving it, and `export *` of it is open. The loader
/// builds each stub's object, so it closes that opening itself: a star of a
/// stub brings in the stub's own names, each reading the stub's property, and
/// supplies any other name only when no analysed branch or other stub does.
pub(crate) struct Linker<'a> {
    table: crate::module_table::ModuleTable<String>,
    keys: Vec<String>,
    index: FxHashMap<String, crate::module_table::ModuleIndex>,
    stubs: &'a FxHashMap<String, FxHashSet<String>>,
    /// Each TypeScript module's type-only export names, which its stripped
    /// record no longer holds.
    type_exports: &'a FxHashMap<String, FxHashSet<String>>,
}

impl<'a> Linker<'a> {
    pub fn new(
        modules: &FxHashMap<String, LinkedModule>,
        stubs: &'a FxHashMap<String, FxHashSet<String>>,
        type_exports: &'a FxHashMap<String, FxHashSet<String>>,
    ) -> Self {
        Self::with_routes(modules, &FxHashMap::default(), stubs, type_exports)
    }

    /// The linker over `modules`, which run, and `routed`, which are read
    /// only for their routes: their records link, their bodies never run.
    pub fn with_routes(
        modules: &FxHashMap<String, LinkedModule>,
        routed: &FxHashMap<String, LinkedModule>,
        stubs: &'a FxHashMap<String, FxHashSet<String>>,
        type_exports: &'a FxHashMap<String, FxHashSet<String>>,
    ) -> Self {
        let modules: FxHashMap<&String, &LinkedModule> = modules.iter().chain(routed.iter()).collect();
        use crate::module_table::{Import, ImportName, ModuleRecord, ModuleTable, Request};
        let mut keys: Vec<String> = modules.keys().map(|key| (*key).clone()).collect();
        keys.sort();
        let index: FxHashMap<String, usize> = keys.iter().enumerate().map(|(at, key)| (key.clone(), at)).collect();
        let mut records: Vec<ModuleRecord<String>> = Vec::with_capacity(keys.len());
        for key in &keys {
            let linked = modules[key];
            let mut requests: Vec<Request> = Vec::new();
            // Each distinct request once, numbered in first-seen order.
            let mut numbered: FxHashMap<Request, usize> = FxHashMap::default();
            let mut request = |from: &str| {
                let target = match index.get(from) {
                    Some(&at) => Request::Module(at),
                    None if stubs.contains_key(from) => Request::Outside(from.to_string()),
                    None => Request::Unresolved(from.to_string()),
                };
                *numbered.entry(target).or_insert_with_key(|target| {
                    requests.push(target.clone());
                    requests.len() - 1
                })
            };
            let mut record = ModuleRecord {
                requests: Vec::new(),
                imports: Vec::new(),
                local_exports: Vec::new(),
                indirect_exports: Vec::new(),
                namespace_exports: Vec::new(),
                star_exports: Vec::new(),
                default_cells: Vec::new(),
            };
            for (exported, target) in &linked.exports {
                match target {
                    ExportTarget::Local(local) => record.local_exports.push((exported.clone(), local.clone())),
                    ExportTarget::Indirect { from, name } => {
                        record.indirect_exports.push((exported.clone(), request(from), name.clone()));
                    }
                    ExportTarget::Namespace { from } => record.namespace_exports.push((exported.clone(), request(from))),
                }
            }
            for star in &linked.stars {
                record.star_exports.push(request(star));
            }
            for (from, name) in &linked.imports {
                record.imports.push(Import { local: String::new(), request: request(from), name: ImportName::Name(name.clone()) });
            }
            record.requests = requests;
            records.push(record);
        }
        Self { table: ModuleTable::new(records), keys, index, stubs, type_exports }
    }

    /// Export `name` of `module`, with each open star of a stub closed: the
    /// stub supplies `name` when it has that name, or when neither an analysed
    /// branch nor another stub has it. One terminal resolves, two are
    /// ambiguous.
    pub(crate) fn resolve(&self, module: usize, name: &str) -> crate::module_table::ExportLookup<String> {
        use crate::module_table::{ExportLookup, OpeningReason, Terminal};
        match self.table.resolve_export(module, name) {
            ExportLookup::Incomplete { mut known, openings } => {
                let has = |stub: &String| self.stubs[stub].contains(name);
                let provided = !known.is_empty()
                    || openings.iter().any(|opening| matches!(&opening.reason, OpeningReason::OutsideStar(stub) if has(stub)));
                for opening in openings {
                    match opening.reason {
                        OpeningReason::OutsideStar(stub) if provided && !has(&stub) => {}
                        OpeningReason::OutsideStar(stub) => {
                            let terminal = Terminal::External { module: stub, export: Some(name.to_string()) };
                            if !known.contains(&terminal) {
                                known.push(terminal);
                            }
                        }
                        OpeningReason::UnresolvedRequest(_) => {}
                    }
                }
                match known.len() {
                    0 => ExportLookup::Absent,
                    1 => ExportLookup::Resolved(known.remove(0)),
                    _ => ExportLookup::Ambiguous(known),
                }
            }
            lookup => lookup,
        }
    }

    /// What reads `terminal` directly: a module's own getter for the binding
    /// (the export name it was asked for, when that name reads it), a
    /// namespace's export object, or a stub's property.
    pub(crate) fn read(&self, terminal: &crate::module_table::Terminal<String>, asked: &str) -> Option<Getter> {
        use crate::module_table::Terminal;
        match terminal {
            Terminal::Local { module, binding } => {
                let exports = &self.table.record(*module).local_exports;
                let name = exports
                    .iter()
                    .find(|(exported, local)| exported == asked && local == binding)
                    .or_else(|| exports.iter().find(|(_, local)| local == binding))
                    .map(|(exported, _)| exported)?;
                Some(Getter::Module { module: self.keys[*module].clone(), name: Some(name.clone()) })
            }
            Terminal::Namespace(module) => Some(Getter::Module { module: self.keys[*module].clone(), name: None }),
            Terminal::External { module, export } => Some(Getter::Module { module: module.clone(), name: export.clone() }),
        }
    }

    /// The module index of `key`, when the linker holds it.
    pub(crate) fn index_of(&self, key: &str) -> Option<usize> {
        self.index.get(key).copied()
    }

    /// The getters `module`'s export object gets at link time: each export
    /// name and the expression its getter returns. A local export reads its
    /// binding; every other name, re-exported or brought in by `export *`,
    /// reads the binding it resolves to directly, never through another
    /// module's forwarding getter. An ambiguous name is left out, as Node
    /// leaves it out of the namespace.
    pub fn getters(&self, module: &str) -> Vec<(String, Getter)> {
        use crate::module_table::{ExportLookup, OpeningReason};
        let at = self.index[module];
        let record = self.table.record(at);
        let exported = self.table.exported_names(at);
        let mut names = exported.names;
        for opening in &exported.openings {
            if let OpeningReason::OutsideStar(stub) = &opening.reason {
                let mut stub_names: Vec<&String> = self.stubs[stub].iter().filter(|name| *name != "default").collect();
                stub_names.sort();
                for name in stub_names {
                    if !names.contains(name) {
                        names.push(name.clone());
                    }
                }
            }
        }
        let mut getters = Vec::new();
        for name in names {
            if let Some((_, local)) = record.local_exports.iter().find(|(exported, _)| *exported == name) {
                getters.push((name, Getter::Local(local.clone())));
            } else if let ExportLookup::Resolved(terminal) = self.resolve(at, &name) {
                if let Some(read) = self.read(&terminal, &name) {
                    getters.push((name, read));
                }
            }
        }
        // A module namespace lists its names in code-unit order, as Node
        // lists them.
        getters.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
        getters
    }

    /// Fails as Node fails to link: an import of a name its module does not
    /// export, or exports ambiguously through `export *`, a re-export that
    /// does not resolve, and either through a module the graph does not hold.
    pub fn check_links(&self, module: &str) -> Result<(), String> {
        use crate::module_table::{ExportLookup, ImportName, Request, LINK_ABSENT_IMPORT, LINK_AMBIGUOUS_IMPORT};
        let at = self.index[module];
        let record = self.table.record(at);
        // A re-export is named by the name it exports, as Node names it.
        let reexports =
            record.indirect_exports.iter().map(|(exported, request, name)| ("re-exports", exported.as_str(), *request, name.as_str()));
        let imports = record.imports.iter().filter_map(|import| match &import.name {
            ImportName::Name(name) => Some(("imports", name.as_str(), import.request, name.as_str())),
            ImportName::Namespace => None,
        });
        for (verb, shown, request, name) in imports.chain(reexports) {
            let (from, lookup) = match &record.requests[request] {
                Request::Module(target) => (self.keys[*target].clone(), self.resolve(*target, name)),
                // A stub's object answers any name.
                Request::Outside(_) => continue,
                Request::Unresolved(key) => (key.clone(), ExportLookup::Absent),
            };
            // A type a TypeScript module exports, imported or re-exported
            // without `type`: the strip erased it, and a bundler without
            // isolated modules erases the import too, so it links to nothing
            // and fails nothing.
            let erased_type = || self.type_exports.get(&from).is_some_and(|types| types.contains(name));
            let (code, problem) = match lookup {
                ExportLookup::Resolved(_) => continue,
                ExportLookup::Absent if erased_type() => continue,
                ExportLookup::Ambiguous(_) => (LINK_AMBIGUOUS_IMPORT, "which resolves it ambiguously through `export *`"),
                _ if verb == "re-exports" => (LINK_ABSENT_IMPORT, "which resolves to no binding"),
                _ => (LINK_ABSENT_IMPORT, "which does not export it"),
            };
            let target = if verb == "re-exports" { String::new() } else { format!(" from '{from}'") };
            return Err(format!(
                "module '{module}' {verb} '{shown}'{target}, {problem} ({code}); the system loader links this \
                 module graph as Node does, and Node rejects this too"
            ));
        }
        Ok(())
    }
}

/// A routed module as the linker reads it: its record's exports, stars,
/// imports and requests by module key, and no body, since it never runs.
pub(crate) fn routed_module(
    record: &crate::module_table::ModuleRecord<String, String>,
    path: &str,
    specifier_map: &FxHashMap<(String, String), String>,
) -> LinkedModule {
    use crate::module_table::ImportName;
    let key = |request: usize| module_key(path, &record.requests[request], specifier_map);
    let mut exports: Vec<(String, ExportTarget)> =
        record.local_exports.iter().map(|(name, local)| (name.clone(), ExportTarget::Local(local.clone()))).collect();
    exports.extend(
        record
            .indirect_exports
            .iter()
            .map(|(name, request, imported)| (name.clone(), ExportTarget::Indirect { from: key(*request), name: imported.clone() })),
    );
    exports.extend(
        record.namespace_exports.iter().map(|(name, request)| (name.clone(), ExportTarget::Namespace { from: key(*request) })),
    );
    LinkedModule {
        exports,
        stars: record.star_exports.iter().map(|&request| key(request)).collect(),
        imports: record
            .imports
            .iter()
            .filter_map(|import| match &import.name {
                ImportName::Name(name) => Some((key(import.request), name.clone())),
                ImportName::Namespace => None,
            })
            .collect(),
        requests: (0..record.requests.len()).map(key).collect(),
        link: String::new(),
        body: String::new(),
        import_refs: Vec::new(),
    }
}
