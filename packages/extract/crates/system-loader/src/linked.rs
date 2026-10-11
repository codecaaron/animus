//! Module graphs with an import cycle, which the topological bundle cannot
//! order, evaluate as Node evaluates them. Every module's export object
//! exists first. Each module is then linked: its exports become getters over
//! its own bindings, so a function declaration is readable at once and a
//! `let`, `const` or `class` binding throws until it is initialized, and each
//! name `export *` brings in is resolved now, as Node resolves it. Modules
//! then evaluate once each, depth first from the entry, each after the
//! modules it imports in source order. Every import reads the exporting
//! module when it runs, as a live binding does. An import of a name its
//! module does not export, or exports ambiguously, fails the load.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::{ExportDefaultDeclarationKind, ImportDeclarationSpecifier, Statement};
use oxc::ast::AstKind;
use oxc::parser::{Parser, ParserReturn};
use oxc::semantic::SemanticBuilder;
use oxc::span::{GetSpan, SourceType};

use super::{collect_declaration_export_names, js_quoted, module_export_name, stub_key};

fn source_type(path: &str) -> SourceType {
    SourceType::from_path(Path::new(path))
        .unwrap_or_else(|_| SourceType::mjs())
        .with_module(true)
}

/// The registry key a specifier of `path` names: a module's canonical path,
/// or a stub's key.
fn module_key(path: &str, spec: &str, specifier_map: &HashMap<(String, String), String>) -> String {
    specifier_map
        .get(&(path.to_string(), spec.to_string()))
        .cloned()
        .unwrap_or_else(|| stub_key(spec))
}

/// The read of export `name` of the module registered as `key`.
fn export_read(key: &str, name: &str) -> String {
    format!("__modules['{}']['{}']", js_quoted(key), js_quoted(name))
}

/// Every module in evaluation order: depth-first post-order from the entry,
/// following imports and re-exports in source order, then any module not
/// reached, in path order.
pub(crate) fn evaluation_order(
    specifier_map: &HashMap<(String, String), String>,
    source_map: &HashMap<String, String>,
    entry_path: &str,
) -> Vec<String> {
    let requests = |path: &str| -> Vec<String> {
        let allocator = Allocator::default();
        let ParserReturn { program, .. } =
            Parser::new(&allocator, &source_map[path], source_type(path)).parse();
        program
            .body
            .iter()
            .filter_map(|stmt| match stmt {
                Statement::ImportDeclaration(decl) => Some(decl.source.value.as_str()),
                Statement::ExportNamedDeclaration(decl) => decl.source.as_ref().map(|s| s.value.as_str()),
                Statement::ExportAllDeclaration(decl) => Some(decl.source.value.as_str()),
                _ => None,
            })
            .map(|spec| module_key(path, spec, specifier_map))
            .filter(|target| source_map.contains_key(target))
            .collect()
    };
    let mut paths: Vec<&String> = source_map.keys().collect();
    paths.sort();
    let mut seen: HashSet<String> = HashSet::new();
    let mut order: Vec<String> = Vec::new();
    // Iterative, so a deep graph cannot overflow the stack.
    for root in std::iter::once(entry_path).chain(paths.iter().map(|path| path.as_str())) {
        if !source_map.contains_key(root) || !seen.insert(root.to_string()) {
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
pub(crate) enum ExportTarget {
    /// A binding the module declares.
    Local(String),
    /// Export `name` of the module registered as `from`: a re-export, or an
    /// export of an imported binding.
    Indirect { from: String, name: String },
    /// The namespace of the module registered as `from`.
    Namespace { from: String },
}

/// A module of a cyclic graph, rewritten for linking.
pub(crate) struct LinkedModule {
    /// Its own export names, in source order.
    pub exports: Vec<(String, ExportTarget)>,
    /// The modules its `export *` declarations name, in source order.
    pub stars: Vec<String>,
    /// Each named or default import: its module and the name.
    pub imports: Vec<(String, String)>,
    /// Statements that run at link time, before the export getters: each
    /// namespace import's binding, and an anonymous default function's name.
    pub link: String,
    /// Its code with imports and export syntax removed and each read of an
    /// imported binding reading the exporting module.
    pub body: String,
}

struct Edit {
    start: usize,
    end: usize,
    text: String,
}

pub(crate) fn rewrite_module_for_linking(
    source: &str,
    canonical_path: &str,
    specifier_map: &HashMap<(String, String), String>,
) -> Result<LinkedModule, String> {
    let allocator = Allocator::default();
    let ParserReturn { program, .. } =
        Parser::new(&allocator, source, source_type(canonical_path)).parse();
    let semantic = SemanticBuilder::new().with_build_nodes(true).build(&program).semantic;
    let scoping = semantic.scoping();
    let key = |spec: &str| module_key(canonical_path, spec, specifier_map);

    let mut edits: Vec<Edit> = Vec::new();
    let mut removed: Vec<(usize, usize)> = Vec::new();
    // Each imported binding, by symbol, as the read of its module's export.
    let mut imported = HashMap::new();
    let mut imported_by_name: HashMap<String, (String, String)> = HashMap::new();
    let mut module = LinkedModule {
        exports: Vec::new(),
        stars: Vec::new(),
        imports: Vec::new(),
        link: String::new(),
        body: String::new(),
    };
    let mut local_exports: Vec<(String, String)> = Vec::new();
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
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                            let _ = writeln!(
                                module.link,
                                "const {} = __modules['{}'];",
                                namespace.local.name,
                                js_quoted(&from)
                            );
                            continue;
                        }
                    };
                    let local = specifier.local();
                    module.imports.push((from.clone(), name.clone()));
                    imported_by_name.insert(local.name.to_string(), (from.clone(), name.clone()));
                    // `(0, …)`: a read in any expression position, and a call
                    // through it gets no `this`, as an imported function's does.
                    imported.insert(local.symbol_id(), format!("(0, {})", export_read(&from, &name)));
                }
                remove(&mut edits, decl.span.start, decl.span.end);
            }
            Statement::ExportNamedDeclaration(decl) => {
                if let Some(source_literal) = &decl.source {
                    let from = key(&source_literal.value);
                    for es in &decl.specifiers {
                        module.exports.push((
                            module_export_name(&es.exported),
                            ExportTarget::Indirect { from: from.clone(), name: module_export_name(&es.local) },
                        ));
                    }
                    remove(&mut edits, decl.span.start, decl.span.end);
                } else if let Some(declaration) = &decl.declaration {
                    edits.push(Edit {
                        start: decl.span.start as usize,
                        end: declaration.span().start as usize,
                        text: String::new(),
                    });
                    collect_declaration_export_names(declaration, &mut local_exports);
                } else {
                    for es in &decl.specifiers {
                        local_exports.push((module_export_name(&es.exported), module_export_name(&es.local)));
                    }
                    remove(&mut edits, decl.span.start, decl.span.end);
                }
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
                                text: " __default".to_string(),
                            });
                            module.link.push_str(
                                "Object.defineProperty(__default, 'name', { value: 'default', configurable: true });\n",
                            );
                            local_exports.push(("default".to_string(), "__default".to_string()));
                        }
                    },
                    ExportDefaultDeclarationKind::ClassDeclaration(class) if class.id.is_some() => {
                        let id = class.id.as_ref().map(|id| id.name.to_string()).unwrap_or_default();
                        local_exports.push(("default".to_string(), id));
                    }
                    kind => {
                        edits.push(Edit { text: "const __default = ".to_string(), ..prefix });
                        if matches!(kind, ExportDefaultDeclarationKind::ClassDeclaration(_)) {
                            edits.push(Edit {
                                start: decl.span.end as usize,
                                end: decl.span.end as usize,
                                text: ";".to_string(),
                            });
                        }
                        local_exports.push(("default".to_string(), "__default".to_string()));
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
    // An export of an imported binding re-exports that module's export.
    for (exported, local) in local_exports {
        let target = match imported_by_name.get(&local) {
            Some((from, name)) => ExportTarget::Indirect { from: from.clone(), name: name.clone() },
            None => ExportTarget::Local(local),
        };
        module.exports.push((exported, target));
    }

    for (&symbol, read) in &imported {
        for reference in scoping.get_resolved_references(symbol) {
            let node = reference.node_id();
            let span = semantic.nodes().get_node(node).span();
            let (start, end) = (span.start as usize, span.end as usize);
            if removed.iter().any(|&(s, e)| s <= start && end <= e) {
                continue;
            }
            let edit = match semantic.nodes().parent_kind(node) {
                AstKind::ObjectProperty(property) if property.shorthand => Edit {
                    start: property.span.start as usize,
                    end: property.span.end as usize,
                    text: format!("{}: {}", &source[start..end], read),
                },
                _ => Edit { start, end, text: read.clone() },
            };
            edits.push(edit);
        }
    }

    // Reverse order keeps pending offsets valid; at one offset a replacement
    // runs before an insertion there.
    edits.sort_by_key(|edit| std::cmp::Reverse((edit.start, edit.end)));
    let mut body = source.to_string();
    for edit in &edits {
        body.replace_range(edit.start..edit.end, &edit.text);
    }
    module.body = body;
    Ok(module)
}

/// The export relation of a cyclic graph's modules, answered by the shared
/// module table. A stub is a module outside the graph: an import of it names
/// its export without proving it, and `export *` of it is open. The loader
/// builds each stub's object, so it closes that opening itself: a star of a
/// stub brings in the stub's own names, each reading the stub's property, and
/// supplies any other name only when no analysed branch or other stub does.
pub(crate) struct Linker<'a> {
    table: crate::module_table::ModuleTable<String>,
    keys: Vec<String>,
    index: HashMap<String, crate::module_table::ModuleIndex>,
    stubs: &'a HashMap<String, HashSet<String>>,
}

impl<'a> Linker<'a> {
    pub fn new(modules: &HashMap<String, LinkedModule>, stubs: &'a HashMap<String, HashSet<String>>) -> Self {
        use crate::module_table::{Import, ImportName, ModuleRecord, ModuleTable, Request};
        let mut keys: Vec<String> = modules.keys().cloned().collect();
        keys.sort();
        let index: HashMap<String, usize> = keys.iter().enumerate().map(|(at, key)| (key.clone(), at)).collect();
        let mut records: Vec<ModuleRecord<String>> = Vec::with_capacity(keys.len());
        for key in &keys {
            let linked = &modules[key];
            let mut requests: Vec<Request> = Vec::new();
            let mut request = |from: &str| {
                let target = match index.get(from) {
                    Some(&at) => Request::Module(at),
                    None if stubs.contains_key(from) => Request::Outside(from.to_string()),
                    None => Request::Unresolved(from.to_string()),
                };
                requests.iter().position(|known| *known == target).unwrap_or_else(|| {
                    requests.push(target);
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
        Self { table: ModuleTable::new(records), keys, index, stubs }
    }

    /// Export `name` of `module`, with each open star of a stub closed: the
    /// stub supplies `name` when it has that name, or when neither an analysed
    /// branch nor another stub has it. One terminal resolves, two are
    /// ambiguous.
    fn resolve(&self, module: usize, name: &str) -> crate::module_table::ExportLookup<String> {
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

    /// The expression that reads `terminal` directly: a module's own getter
    /// for the binding (the export name it was asked for, when that name
    /// reads it), a namespace's export object, or a stub's property.
    fn read(&self, terminal: &crate::module_table::Terminal<String>, asked: &str) -> Option<String> {
        use crate::module_table::Terminal;
        match terminal {
            Terminal::Local { module, binding } => {
                let exports = &self.table.record(*module).local_exports;
                let name = exports
                    .iter()
                    .find(|(exported, local)| exported == asked && local == binding)
                    .or_else(|| exports.iter().find(|(_, local)| local == binding))
                    .map(|(exported, _)| exported)?;
                Some(export_read(&self.keys[*module], name))
            }
            Terminal::Namespace(module) => Some(format!("__modules['{}']", js_quoted(&self.keys[*module]))),
            Terminal::External { module, export: Some(name) } => Some(export_read(module, name)),
            Terminal::External { module, export: None } => Some(format!("__modules['{}']", js_quoted(module))),
        }
    }

    /// The getters `module`'s export object gets at link time: each export
    /// name and the expression its getter returns. A local export reads its
    /// binding; every other name, re-exported or brought in by `export *`,
    /// reads the binding it resolves to directly, never through another
    /// module's forwarding getter. An ambiguous name is left out, as Node
    /// leaves it out of the namespace.
    pub fn getters(&self, module: &str) -> Vec<(String, String)> {
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
                getters.push((name, local.clone()));
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
        use crate::module_table::{ExportLookup, ImportName, Request};
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
            let problem = match lookup {
                ExportLookup::Resolved(_) => continue,
                ExportLookup::Ambiguous(_) => "which resolves it ambiguously through `export *`",
                _ if verb == "re-exports" => "which resolves to no binding",
                _ => "which does not export it",
            };
            let target = if verb == "re-exports" { String::new() } else { format!(" from '{from}'") };
            return Err(format!(
                "module '{module}' {verb} '{shown}'{target}, {problem}; the system loader links this cyclic \
                 module graph as Node does, and Node rejects this too"
            ));
        }
        Ok(())
    }
}
