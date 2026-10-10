//! Module graphs with an import cycle, which the topological bundle cannot
//! order. Each module still evaluates once, in Node's order: depth first from
//! the entry, each module after the modules it imports, in source order. A
//! module in a cycle is linked before any module of its cycle evaluates: its
//! exports become getters over its own bindings, so function declarations
//! are readable at once and `let`, `const` and `class` bindings throw until
//! they are initialized, and each import from another module reads that
//! module's exports when it runs, as a live binding does.

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

/// Defines each export of `source` the target lacks as a getter reading
/// `source`, for `export * from`.
pub(crate) const STAR_HELPER: &str = "const __star = (target, source) => { if (!source) return; \
for (const key of Object.keys(source)) { if (key !== 'default' && \
!Object.prototype.hasOwnProperty.call(target, key)) Object.defineProperty(target, key, \
{ enumerable: true, get: () => source[key] }); } };\n";

/// Evaluation order and the cycles a cyclic graph holds.
pub(crate) struct CyclicOrder {
    /// Every module, each after the modules it imports unless they are in
    /// its cycle: depth-first post-order from the entry, then any module
    /// not reached, in path order.
    pub order: Vec<String>,
    /// Each cycle's modules in path order, a module importing itself
    /// included.
    pub cycles: Vec<Vec<String>>,
}

fn source_type(path: &str) -> SourceType {
    SourceType::from_path(Path::new(path))
        .unwrap_or_else(|_| SourceType::mjs())
        .with_module(true)
}

/// The modules `path` imports or re-exports from, in source order.
fn requests(
    path: &str,
    source: &str,
    specifier_map: &HashMap<(String, String), String>,
    source_map: &HashMap<String, String>,
) -> Vec<String> {
    let allocator = Allocator::default();
    let ParserReturn { program, .. } = Parser::new(&allocator, source, source_type(path)).parse();
    program
        .body
        .iter()
        .filter_map(|stmt| match stmt {
            Statement::ImportDeclaration(decl) => Some(decl.source.value.as_str()),
            Statement::ExportNamedDeclaration(decl) => decl.source.as_ref().map(|s| s.value.as_str()),
            Statement::ExportAllDeclaration(decl) => Some(decl.source.value.as_str()),
            _ => None,
        })
        .filter_map(|spec| specifier_map.get(&(path.to_string(), spec.to_string())))
        .filter(|target| source_map.contains_key(target.as_str()))
        .cloned()
        .collect()
}

pub(crate) fn cyclic_order(
    specifier_map: &HashMap<(String, String), String>,
    source_map: &HashMap<String, String>,
    entry_path: &str,
) -> CyclicOrder {
    let mut paths: Vec<&String> = source_map.keys().collect();
    paths.sort();
    let edges: HashMap<&str, Vec<String>> = paths
        .iter()
        .map(|path| (path.as_str(), requests(path, &source_map[*path], specifier_map, source_map)))
        .collect();

    // Iterative depth-first post-order, so a deep graph cannot overflow.
    let post_order = |roots: &mut dyn Iterator<Item = &str>, next: &dyn Fn(&str) -> Vec<String>| {
        let mut seen: HashSet<String> = HashSet::new();
        let mut out: Vec<String> = Vec::new();
        for root in roots {
            if !seen.insert(root.to_string()) {
                continue;
            }
            let mut stack: Vec<(String, Vec<String>, usize)> = vec![(root.to_string(), next(root), 0)];
            while let Some((node, children, index)) = stack.last_mut() {
                if let Some(child) = children.get(*index).cloned() {
                    *index += 1;
                    if seen.insert(child.clone()) {
                        let grandchildren = next(&child);
                        stack.push((child, grandchildren, 0));
                    }
                } else {
                    out.push(node.clone());
                    stack.pop();
                }
            }
        }
        out
    };

    let forward = |node: &str| edges.get(node).cloned().unwrap_or_default();
    let mut roots = std::iter::once(entry_path).chain(paths.iter().map(|path| path.as_str()));
    let order = post_order(&mut roots, &forward);

    // Kosaraju: modules a reverse walk reaches from each, in reverse finish
    // order, share its cycle.
    let mut reverse: HashMap<&str, Vec<String>> = HashMap::new();
    for (from, targets) in &edges {
        for target in targets {
            reverse.entry(target.as_str()).or_default().push(from.to_string());
        }
    }
    for sources in reverse.values_mut() {
        sources.sort();
    }
    let backward = |node: &str| reverse.get(node).cloned().unwrap_or_default();
    let mut assigned: HashSet<String> = HashSet::new();
    let mut cycles: Vec<Vec<String>> = Vec::new();
    for node in order.iter().rev() {
        if assigned.contains(node) {
            continue;
        }
        let mut component: Vec<String> = post_order(&mut std::iter::once(node.as_str()), &|n: &str| {
            backward(n).into_iter().filter(|m| !assigned.contains(m)).collect()
        });
        assigned.extend(component.iter().cloned());
        let self_import = edges.get(node.as_str()).is_some_and(|targets| targets.contains(node));
        if component.len() > 1 || self_import {
            component.sort();
            cycles.push(component);
        }
    }
    cycles.sort();
    CyclicOrder { order, cycles }
}

/// A module of a cycle, rewritten for linking.
pub(crate) struct LinkedModule {
    /// Getter definitions of its exports on `__exports`.
    pub link: String,
    /// Require literals of its `export * from` modules.
    pub stars: Vec<String>,
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
    let require_literal = |spec: &str| {
        js_quoted(
            &specifier_map
                .get(&(canonical_path.to_string(), spec.to_string()))
                .cloned()
                .unwrap_or_else(|| stub_key(spec)),
        )
    };

    let mut edits: Vec<Edit> = Vec::new();
    let mut removed: Vec<(usize, usize)> = Vec::new();
    // Each imported binding, by symbol, as the read of its module's export.
    let mut imported = HashMap::new();
    let mut imported_by_name: HashMap<String, String> = HashMap::new();
    let mut getters: Vec<(String, String)> = Vec::new();
    let mut stars: Vec<String> = Vec::new();
    let mut remove = |edits: &mut Vec<Edit>, start: u32, end: u32, text: String| {
        removed.push((start as usize, end as usize));
        edits.push(Edit { start: start as usize, end: end as usize, text });
    };

    for stmt in &program.body {
        match stmt {
            Statement::ImportDeclaration(decl) => {
                let literal = require_literal(&decl.source.value);
                let mut text = String::new();
                for specifier in decl.specifiers.iter().flatten() {
                    let export = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => module_export_name(&named.imported),
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => "default".to_string(),
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                            let _ = write!(text, "const {} = __require('{}');", namespace.local.name, literal);
                            continue;
                        }
                    };
                    // `(0, …)`: a read in any expression position, and a call
                    // through it gets no `this`, as an imported function's does.
                    let read = format!("(0, __require('{}')['{}'])", literal, js_quoted(&export));
                    let local = specifier.local();
                    imported_by_name.insert(local.name.to_string(), read.clone());
                    imported.insert(local.symbol_id(), read);
                }
                remove(&mut edits, decl.span.start, decl.span.end, text);
            }
            Statement::ExportNamedDeclaration(decl) => {
                if let Some(source_literal) = &decl.source {
                    let literal = require_literal(&source_literal.value);
                    for es in &decl.specifiers {
                        getters.push((
                            module_export_name(&es.exported),
                            format!("__require('{}')['{}']", literal, js_quoted(&module_export_name(&es.local))),
                        ));
                    }
                    remove(&mut edits, decl.span.start, decl.span.end, String::new());
                } else if let Some(declaration) = &decl.declaration {
                    edits.push(Edit {
                        start: decl.span.start as usize,
                        end: declaration.span().start as usize,
                        text: String::new(),
                    });
                    let mut names = Vec::new();
                    collect_declaration_export_names(declaration, &mut names);
                    getters.extend(names);
                } else {
                    for es in &decl.specifiers {
                        getters.push((module_export_name(&es.exported), module_export_name(&es.local)));
                    }
                    remove(&mut edits, decl.span.start, decl.span.end, String::new());
                }
            }
            Statement::ExportDefaultDeclaration(decl) => {
                let start = decl.declaration.span().start;
                let named = match &decl.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => function.id.as_ref(),
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => class.id.as_ref(),
                    _ => None,
                };
                if let Some(id) = named {
                    edits.push(Edit { start: decl.span.start as usize, end: start as usize, text: String::new() });
                    getters.push(("default".to_string(), id.name.to_string()));
                } else {
                    edits.push(Edit {
                        start: decl.span.start as usize,
                        end: start as usize,
                        text: "const __default = ".to_string(),
                    });
                    if matches!(
                        decl.declaration,
                        ExportDefaultDeclarationKind::FunctionDeclaration(_)
                            | ExportDefaultDeclarationKind::ClassDeclaration(_)
                    ) {
                        edits.push(Edit { start: decl.span.end as usize, end: decl.span.end as usize, text: ";".to_string() });
                    }
                    getters.push(("default".to_string(), "__default".to_string()));
                }
            }
            Statement::ExportAllDeclaration(decl) => {
                let literal = require_literal(&decl.source.value);
                match &decl.exported {
                    Some(exported) => getters.push((module_export_name(exported), format!("__require('{}')", literal))),
                    None => stars.push(literal),
                }
                remove(&mut edits, decl.span.start, decl.span.end, String::new());
            }
            _ => {}
        }
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

    let mut link = String::new();
    for (exported, local) in &getters {
        let read = imported_by_name.get(local).cloned().unwrap_or_else(|| local.clone());
        let _ = writeln!(
            link,
            "Object.defineProperty(__exports, '{}', {{ enumerable: true, get: () => {} }});",
            js_quoted(exported),
            read
        );
    }
    Ok(LinkedModule { link, stars, body })
}
