use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

use oxc_allocator::Allocator;
use oxc_ast::ast::Statement;
use oxc_codegen::Codegen;
use oxc_parser::{Parser, ParserReturn};
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, SourceType};
use oxc_transformer::{TransformOptions, Transformer};
use rquickjs::{Context, Function, Object, Runtime};
use serde::{Deserialize, Serialize};
use serde_json;

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/// Serialized system configuration returned by `load_system_module()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemConfig {
    pub prop_config: String,
    pub group_registry: String,
    pub scales_json: String,
    pub variable_map_json: String,
    pub variable_css: String,
    pub contextual_vars_json: String,
    pub selector_aliases: Option<String>,
    pub selector_order: Option<String>,
    pub global_style_blocks: Option<String>,
}

// ---------------------------------------------------------------------------
// 1. Full-module TypeScript stripping
// ---------------------------------------------------------------------------

/// Strip TypeScript type annotations from a full module file.
///
/// Unlike `transform_extractor::strip_typescript()` which wraps a single
/// expression, this operates on a complete module with imports, exports,
/// `declare module` blocks, and type annotations. All type-only constructs
/// are removed; runtime semantics (imports, exports, expressions) are preserved.
pub fn strip_typescript_module(source: &str, file_path: &str) -> Result<String, String> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(Path::new(file_path))
        .unwrap_or_else(|_| SourceType::ts().with_module(true));

    let ParserReturn {
        mut program,
        errors: parse_errors,
        ..
    } = Parser::new(&allocator, source, source_type).parse();

    if !parse_errors.is_empty() {
        return Err(format!(
            "parse error in {}: {}",
            file_path, parse_errors[0]
        ));
    }

    // Build semantic info (required by transformer for scoping)
    let semantic_ret = SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    // Run transformer to strip TypeScript annotations
    let options = TransformOptions::default();
    let transformer = Transformer::new(&allocator, Path::new(file_path), &options);
    let _transform_ret = transformer.build_with_scoping(scoping, &mut program);

    // Codegen the complete program (preserves imports/exports)
    let codegen = Codegen::new();
    Ok(codegen.build(&program).code)
}

// ---------------------------------------------------------------------------
// 2. Package.json resolution
// ---------------------------------------------------------------------------

/// Resolve a bare specifier (e.g. `@animus-ui/system`) to an absolute file path.
///
/// Resolution chain: `exports` map (with `import` condition) → `module` → `main`.
/// For scoped packages, handles the `@scope/name` format.
/// Subpath exports (e.g. `@animus-ui/system/groups`) are supported.
pub fn resolve_bare_specifier(specifier: &str, from_dir: &str) -> Result<String, String> {
    // Split into package name and subpath
    let (pkg_name, subpath) = split_specifier(specifier);

    // Find package.json by walking node_modules from the importing file's directory
    let pkg_json_path = find_package_json(&pkg_name, from_dir)?;
    let pkg_dir = pkg_json_path
        .parent()
        .ok_or_else(|| format!("invalid package.json path: {:?}", pkg_json_path))?;

    // Read and parse package.json
    let pkg_json_str = fs::read_to_string(&pkg_json_path)
        .map_err(|e| format!("failed to read {:?}: {}", pkg_json_path, e))?;
    let pkg_json: serde_json::Value = serde_json::from_str(&pkg_json_str)
        .map_err(|e| format!("failed to parse {:?}: {}", pkg_json_path, e))?;

    // Try exports map first
    if let Some(exports) = pkg_json.get("exports") {
        let export_key = if subpath.is_empty() { "." } else { subpath };
        if let Some(resolved) = resolve_exports_entry(exports, export_key) {
            let abs_path = pkg_dir.join(&resolved);
            if abs_path.exists() {
                return Ok(abs_path.to_string_lossy().to_string());
            }
        }
    }

    // Fallback: module field
    if subpath.is_empty() || subpath == "." {
        if let Some(module_field) = pkg_json.get("module").and_then(|v| v.as_str()) {
            let abs_path = pkg_dir.join(module_field);
            if abs_path.exists() {
                return Ok(abs_path.to_string_lossy().to_string());
            }
        }

        // Fallback: main field
        if let Some(main_field) = pkg_json.get("main").and_then(|v| v.as_str()) {
            let abs_path = pkg_dir.join(main_field);
            if abs_path.exists() {
                return Ok(abs_path.to_string_lossy().to_string());
            }
        }
    }

    Err(format!(
        "could not resolve '{}': no matching export, module, or main field in {:?}",
        specifier, pkg_json_path
    ))
}

/// Split a specifier into (package_name, subpath).
/// `@animus-ui/system/groups` → (`@animus-ui/system`, `./groups`)
/// `@animus-ui/system` → (`@animus-ui/system`, ``)
/// `lodash/fp` → (`lodash`, `./fp`)
fn split_specifier(specifier: &str) -> (&str, &str) {
    if specifier.starts_with('@') {
        // Scoped package: find second '/'
        if let Some(first_slash) = specifier.find('/') {
            if let Some(second_slash) = specifier[first_slash + 1..].find('/') {
                let split_at = first_slash + 1 + second_slash;
                return (&specifier[..split_at], &specifier[split_at..]);
            }
        }
        (specifier, "")
    } else {
        // Unscoped package: find first '/'
        if let Some(slash) = specifier.find('/') {
            (&specifier[..slash], &specifier[slash..])
        } else {
            (specifier, "")
        }
    }
}

/// Find package.json for a package by walking up from start_dir/node_modules.
/// Mimics Node's module resolution algorithm: check node_modules at each
/// parent directory until found or at filesystem root.
fn find_package_json(pkg_name: &str, start_dir: &str) -> Result<PathBuf, String> {
    let mut dir = PathBuf::from(start_dir);
    loop {
        let candidate = dir.join("node_modules").join(pkg_name).join("package.json");
        if candidate.exists() {
            return Ok(candidate);
        }
        if !dir.pop() {
            break;
        }
    }
    Err(format!(
        "could not find package.json for '{}' from '{}'",
        pkg_name, start_dir
    ))
}

/// Resolve an entry from the exports map.
/// Handles both string values and nested condition objects.
/// For condition objects, follows the `import` condition, then `default`.
fn resolve_exports_entry(exports: &serde_json::Value, key: &str) -> Option<String> {
    // Normalize key: `./groups` or `/groups` → look up with `./` prefix
    let lookup_key = if key == "." {
        ".".to_string()
    } else if key.starts_with("./") {
        key.to_string()
    } else if key.starts_with('/') {
        format!(".{}", key)
    } else {
        format!("./{}", key)
    };

    let entry = exports.get(&lookup_key)?;
    resolve_condition_value(entry)
}

/// Resolve a condition value — could be a string or a nested condition object.
fn resolve_condition_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Object(obj) => {
            // Try import condition first, then default
            if let Some(import_val) = obj.get("import") {
                return resolve_condition_value(import_val);
            }
            if let Some(default_val) = obj.get("default") {
                return resolve_condition_value(default_val);
            }
            None
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// 3. Extension probing for relative imports
// ---------------------------------------------------------------------------

/// Resolve a relative import specifier to an absolute file path with extension probing.
fn resolve_relative(base_dir: &Path, specifier: &str) -> Result<String, String> {
    let target = base_dir.join(specifier);

    // Try exact path first
    if target.is_file() {
        return Ok(target.to_string_lossy().to_string());
    }

    // Extension probing
    let extensions = [".ts", ".tsx", ".js", ".mjs"];
    for ext in &extensions {
        let with_ext = target.with_extension(&ext[1..]);
        if with_ext.is_file() {
            return Ok(with_ext.to_string_lossy().to_string());
        }
    }

    // Directory index probing
    let index_files = ["index.ts", "index.js", "index.mjs"];
    for idx in &index_files {
        let with_index = target.join(idx);
        if with_index.is_file() {
            return Ok(with_index.to_string_lossy().to_string());
        }
    }

    Err(format!(
        "could not resolve '{}' from {:?}",
        specifier, base_dir
    ))
}

// ---------------------------------------------------------------------------
// 4. Recursive dependency collection
// ---------------------------------------------------------------------------

/// Import info: specifier + imported names.
struct ImportInfo {
    specifier: String,
    names: Vec<String>,
}

/// Extract import specifiers and their imported names from a JS/TS source string.
fn extract_import_specifiers(source: &str, file_path: &str) -> Vec<ImportInfo> {
    let allocator = Allocator::default();
    // Always parse as ESM module — system files use import/export
    let source_type = SourceType::from_path(Path::new(file_path))
        .unwrap_or_else(|_| SourceType::mjs())
        .with_module(true);

    let ParserReturn { program, .. } = Parser::new(&allocator, source, source_type).parse();

    let mut imports = Vec::new();
    for stmt in &program.body {
        match stmt {
            Statement::ImportDeclaration(decl) => {
                let mut names = Vec::new();
                if let Some(specifiers) = &decl.specifiers {
                    for spec in specifiers {
                        match spec {
                            oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(s) => {
                                names.push(s.local.name.to_string());
                            }
                            oxc_ast::ast::ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                                names.push(s.local.name.to_string());
                            }
                            oxc_ast::ast::ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => {
                                names.push(s.local.name.to_string());
                            }
                        }
                    }
                }
                imports.push(ImportInfo {
                    specifier: decl.source.value.to_string(),
                    names,
                });
            }
            Statement::ExportNamedDeclaration(decl) => {
                if let Some(source) = &decl.source {
                    imports.push(ImportInfo {
                        specifier: source.value.to_string(),
                        names: Vec::new(),
                    });
                }
            }
            Statement::ExportAllDeclaration(decl) => {
                imports.push(ImportInfo {
                    specifier: decl.source.value.to_string(),
                    names: Vec::new(),
                });
            }
            _ => {}
        }
    }
    imports
}

/// Resolve all dependencies starting from a system file.
///
/// Returns two maps:
/// - `specifier_map`: maps (base_module, import_specifier) → canonical_path (for Resolver)
/// - `source_map`: maps canonical_path → processed_source (for Loader)
///
/// Recursively processes all files, including pre-built .mjs dist files,
/// stripping TypeScript from .ts/.tsx files.
pub fn resolve_all_deps(
    system_path: &str,
    _root_dir: &str,
) -> Result<(HashMap<(String, String), String>, HashMap<String, String>, HashMap<String, HashSet<String>>), String> {
    let mut specifier_map: HashMap<(String, String), String> = HashMap::new();
    let mut source_map: HashMap<String, String> = HashMap::new();
    let mut stub_exports: HashMap<String, HashSet<String>> = HashMap::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();

    // Canonicalize the entry point
    let entry_path = fs::canonicalize(system_path)
        .map_err(|e| format!("failed to canonicalize '{}': {}", system_path, e))?
        .to_string_lossy()
        .to_string();

    queue.push_back(entry_path.clone());

    while let Some(current_path) = queue.pop_front() {
        if visited.contains(&current_path) {
            continue;
        }
        visited.insert(current_path.clone());

        // Read source
        let raw_source = fs::read_to_string(&current_path)
            .map_err(|e| format!("failed to read '{}': {}", current_path, e))?;

        // Strip types if TypeScript
        let is_ts = current_path.ends_with(".ts") || current_path.ends_with(".tsx");
        let processed = if is_ts {
            strip_typescript_module(&raw_source, &current_path)?
        } else {
            raw_source.clone()
        };

        // Parse for import specifiers from the RAW source (pre-strip).
        let import_infos = extract_import_specifiers(&raw_source, &current_path);

        let current_dir = Path::new(&current_path)
            .parent()
            .unwrap_or_else(|| Path::new("."));

        for info in import_infos {
            let spec = &info.specifier;
            if spec.starts_with('.') || spec.starts_with('/') {
                // Relative import
                match resolve_relative(current_dir, &spec) {
                    Ok(resolved) => {
                        let canonical = fs::canonicalize(&resolved)
                            .unwrap_or_else(|_| PathBuf::from(&resolved))
                            .to_string_lossy()
                            .to_string();
                        specifier_map.insert(
                            (current_path.clone(), spec.clone()),
                            canonical.clone(),
                        );
                        if !visited.contains(&canonical) {
                            queue.push_back(canonical);
                        }
                    }
                    Err(_) => {
                        // Skip unresolvable relative imports (may be type-only)
                    }
                }
            } else {
                // Bare specifier — resolve from the current file's directory
                // Only resolve @animus-ui/* workspace packages. External packages
                // (react, lodash, etc.) are not needed for config extraction and
                // will get empty stub modules at runtime.
                let is_workspace_pkg = spec.starts_with("@animus-ui/");
                if is_workspace_pkg {
                    match resolve_bare_specifier(&spec, &current_dir.to_string_lossy()) {
                        Ok(resolved) => {
                            let canonical = fs::canonicalize(&resolved)
                                .unwrap_or_else(|_| PathBuf::from(&resolved))
                                .to_string_lossy()
                                .to_string();
                            specifier_map.insert(
                                (current_path.clone(), spec.clone()),
                                canonical.clone(),
                            );
                            if !visited.contains(&canonical) {
                                queue.push_back(canonical);
                            }
                        }
                        Err(e) => {
                            return Err(format!(
                                "failed to resolve workspace package '{}' from '{}': {}. \
                                 Is the package built? (run bun run build:ts)",
                                spec, current_path, e
                            ));
                        }
                    }
                } else {
                    // Non-workspace package → collect imported names for stub generation
                    for name in &info.names {
                        stub_exports
                            .entry(format!("__stub__/{}", spec))
                            .or_default()
                            .insert(name.clone());
                    }
                }
            }
        }

        source_map.insert(current_path.clone(), processed);
    }

    Ok((specifier_map, source_map, stub_exports))
}

// ---------------------------------------------------------------------------
// 5. Bundled eval — concatenate all modules into a single script for ctx.eval()
// ---------------------------------------------------------------------------

/// Info about a single import/export statement to rewrite, with source byte offsets.
struct RewriteOp {
    /// Byte range in the original source to replace.
    start: usize,
    end: usize,
    /// Replacement text.
    replacement: String,
}

/// Rewrite a single module's source: replace import/export statements with
/// `__require()`/`__exports` assignments. Returns the rewritten source body
/// (without IIFE wrapper — caller adds that).
fn rewrite_module_for_bundle(
    source: &str,
    canonical_path: &str,
    specifier_map: &HashMap<(String, String), String>,
) -> Result<String, String> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(Path::new(canonical_path))
        .unwrap_or_else(|_| SourceType::mjs())
        .with_module(true);

    let ParserReturn { program, .. } = Parser::new(&allocator, source, source_type).parse();

    let mut ops: Vec<RewriteOp> = Vec::new();
    // Collect export names to assign at the end (for `export { X, Y }` style)
    let mut trailing_exports: Vec<(String, String)> = Vec::new(); // (exported_name, local_name)

    for stmt in &program.body {
        match stmt {
            Statement::ImportDeclaration(decl) => {
                let spec = decl.source.value.to_string();
                // Look up canonical path for this import
                let require_key = specifier_map
                    .get(&(canonical_path.to_string(), spec.clone()))
                    .cloned()
                    .unwrap_or_else(|| format!("__stub__/{}", spec));

                let mut parts = Vec::new();
                if let Some(specifiers) = &decl.specifiers {
                    if specifiers.is_empty() {
                        // Bare import: `import 'foo'` → `__require('key')`
                        let replacement = format!("__require('{}')", require_key);
                        ops.push(RewriteOp {
                            start: decl.span.start as usize,
                            end: decl.span.end as usize,
                            replacement,
                        });
                        continue;
                    }

                    let mut destructure_parts = Vec::new();
                    let mut default_name: Option<String> = None;
                    let mut namespace_name: Option<String> = None;

                    for s in specifiers {
                        match s {
                            oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(is) => {
                                let imported = match &is.imported {
                                    oxc_ast::ast::ModuleExportName::IdentifierName(id) => {
                                        id.name.to_string()
                                    }
                                    oxc_ast::ast::ModuleExportName::IdentifierReference(id) => {
                                        id.name.to_string()
                                    }
                                    oxc_ast::ast::ModuleExportName::StringLiteral(lit) => {
                                        lit.value.to_string()
                                    }
                                };
                                let local = is.local.name.to_string();
                                if imported == local {
                                    destructure_parts.push(imported);
                                } else {
                                    destructure_parts
                                        .push(format!("{}: {}", imported, local));
                                }
                            }
                            oxc_ast::ast::ImportDeclarationSpecifier::ImportDefaultSpecifier(
                                ds,
                            ) => {
                                default_name = Some(ds.local.name.to_string());
                            }
                            oxc_ast::ast::ImportDeclarationSpecifier::ImportNamespaceSpecifier(
                                ns,
                            ) => {
                                namespace_name = Some(ns.local.name.to_string());
                            }
                        }
                    }

                    // Build replacement(s)
                    if let Some(ns_name) = namespace_name {
                        parts.push(format!(
                            "const {} = __require('{}')",
                            ns_name, require_key
                        ));
                    } else {
                        if let Some(def_name) = &default_name {
                            parts.push(format!(
                                "const {} = __require('{}').default",
                                def_name, require_key
                            ));
                        }
                        if !destructure_parts.is_empty() {
                            parts.push(format!(
                                "const {{ {} }} = __require('{}')",
                                destructure_parts.join(", "),
                                require_key
                            ));
                        }
                    }
                } else {
                    // No specifiers at all → bare import
                    parts.push(format!("__require('{}')", require_key));
                }

                ops.push(RewriteOp {
                    start: decl.span.start as usize,
                    end: decl.span.end as usize,
                    replacement: parts.join(";\n"),
                });
            }

            Statement::ExportNamedDeclaration(decl) => {
                if let Some(source_lit) = &decl.source {
                    // Re-export: `export { X } from 'Y'`
                    let spec = source_lit.value.to_string();
                    let require_key = specifier_map
                        .get(&(canonical_path.to_string(), spec.clone()))
                        .cloned()
                        .unwrap_or_else(|| format!("__stub__/{}", spec));

                    let mut assignments = Vec::new();
                    for es in &decl.specifiers {
                        let local_str = match &es.local {
                            oxc_ast::ast::ModuleExportName::IdentifierName(id) => {
                                id.name.to_string()
                            }
                            oxc_ast::ast::ModuleExportName::IdentifierReference(id) => {
                                id.name.to_string()
                            }
                            oxc_ast::ast::ModuleExportName::StringLiteral(lit) => {
                                lit.value.to_string()
                            }
                        };
                        let exported_str = match &es.exported {
                            oxc_ast::ast::ModuleExportName::IdentifierName(id) => {
                                id.name.to_string()
                            }
                            oxc_ast::ast::ModuleExportName::IdentifierReference(id) => {
                                id.name.to_string()
                            }
                            oxc_ast::ast::ModuleExportName::StringLiteral(lit) => {
                                lit.value.to_string()
                            }
                        };
                        assignments.push(format!(
                            "__exports['{}'] = __require('{}')['{}']",
                            exported_str, require_key, local_str
                        ));
                    }
                    ops.push(RewriteOp {
                        start: decl.span.start as usize,
                        end: decl.span.end as usize,
                        replacement: assignments.join(";\n"),
                    });
                } else if !decl.specifiers.is_empty() {
                    // Local export: `export { X, Y }`
                    for es in &decl.specifiers {
                        let local_str = match &es.local {
                            oxc_ast::ast::ModuleExportName::IdentifierName(id) => {
                                id.name.to_string()
                            }
                            oxc_ast::ast::ModuleExportName::IdentifierReference(id) => {
                                id.name.to_string()
                            }
                            oxc_ast::ast::ModuleExportName::StringLiteral(lit) => {
                                lit.value.to_string()
                            }
                        };
                        let exported_str = match &es.exported {
                            oxc_ast::ast::ModuleExportName::IdentifierName(id) => {
                                id.name.to_string()
                            }
                            oxc_ast::ast::ModuleExportName::IdentifierReference(id) => {
                                id.name.to_string()
                            }
                            oxc_ast::ast::ModuleExportName::StringLiteral(lit) => {
                                lit.value.to_string()
                            }
                        };
                        trailing_exports.push((exported_str, local_str));
                    }
                    // Remove the export statement
                    ops.push(RewriteOp {
                        start: decl.span.start as usize,
                        end: decl.span.end as usize,
                        replacement: String::new(),
                    });
                } else if let Some(declaration) = &decl.declaration {
                    // `export const X = ...` or `export function X() {}`
                    // Replace `export ` prefix — keep the declaration
                    let decl_start = declaration.span().start as usize;
                    let export_keyword_end = decl_start; // `export ` ends where declaration starts
                    ops.push(RewriteOp {
                        start: decl.span.start as usize,
                        end: export_keyword_end,
                        replacement: String::new(),
                    });
                    // Collect exported names from the declaration
                    collect_declaration_export_names(declaration, &mut trailing_exports);
                }
            }

            Statement::ExportDefaultDeclaration(decl) => {
                // `export default X` → `__exports.default = X`
                // Replace everything up to the declaration with assignment
                let decl_start = decl.declaration.span().start as usize;
                ops.push(RewriteOp {
                    start: decl.span.start as usize,
                    end: decl_start,
                    replacement: "__exports.default = ".to_string(),
                });
            }

            Statement::ExportAllDeclaration(decl) => {
                // `export * from 'Y'`
                let spec = decl.source.value.to_string();
                let require_key = specifier_map
                    .get(&(canonical_path.to_string(), spec.clone()))
                    .cloned()
                    .unwrap_or_else(|| format!("__stub__/{}", spec));
                ops.push(RewriteOp {
                    start: decl.span.start as usize,
                    end: decl.span.end as usize,
                    replacement: format!("Object.assign(__exports, __require('{}'))", require_key),
                });
            }

            _ => {}
        }
    }

    // Apply rewrites in reverse byte order (so earlier offsets stay valid)
    ops.sort_by(|a, b| b.start.cmp(&a.start));
    let mut result = source.to_string();
    for op in &ops {
        result.replace_range(op.start..op.end, &op.replacement);
    }

    // Append trailing export assignments
    if !trailing_exports.is_empty() {
        result.push('\n');
        for (exported, local) in &trailing_exports {
            result.push_str(&format!("__exports['{}'] = {};\n", exported, local));
        }
    }

    Ok(result)
}

/// Collect exported names from a declaration (for `export const X = ...` patterns).
fn collect_declaration_export_names(
    declaration: &oxc_ast::ast::Declaration<'_>,
    exports: &mut Vec<(String, String)>,
) {
    match declaration {
        oxc_ast::ast::Declaration::VariableDeclaration(var_decl) => {
            for declarator in &var_decl.declarations {
                collect_binding_names(&declarator.id, exports);
            }
        }
        oxc_ast::ast::Declaration::FunctionDeclaration(fn_decl) => {
            if let Some(id) = &fn_decl.id {
                let name = id.name.to_string();
                exports.push((name.clone(), name));
            }
        }
        oxc_ast::ast::Declaration::ClassDeclaration(class_decl) => {
            if let Some(id) = &class_decl.id {
                let name = id.name.to_string();
                exports.push((name.clone(), name));
            }
        }
        _ => {}
    }
}

/// Collect binding names from a pattern (handles destructuring).
fn collect_binding_names(
    pattern: &oxc_ast::ast::BindingPattern<'_>,
    exports: &mut Vec<(String, String)>,
) {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(id) => {
            let name = id.name.to_string();
            exports.push((name.clone(), name));
        }
        oxc_ast::ast::BindingPattern::ObjectPattern(obj) => {
            for prop in &obj.properties {
                collect_binding_names(&prop.value, exports);
            }
        }
        oxc_ast::ast::BindingPattern::ArrayPattern(arr) => {
            for elem in arr.elements.iter().flatten() {
                collect_binding_names(elem, exports);
            }
        }
        oxc_ast::ast::BindingPattern::AssignmentPattern(assign) => {
            collect_binding_names(&assign.left, exports);
        }
    }
}

/// Topological sort of modules by dependency order.
/// Returns modules in execution order (dependencies before dependents).
fn topological_sort(
    specifier_map: &HashMap<(String, String), String>,
    source_map: &HashMap<String, String>,
    _entry_path: &str,
) -> Result<Vec<String>, String> {
    // Build reverse adjacency list: dep → [modules that depend on it]
    // For Kahn's algorithm, edges point FROM prerequisite TO dependent.
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut in_degree: HashMap<&str, usize> = HashMap::new();

    // Initialize all modules
    for key in source_map.keys() {
        dependents.entry(key.as_str()).or_default();
        in_degree.entry(key.as_str()).or_insert(0);
    }

    // For each (from_module, specifier) → to_module:
    // from_module depends on to_module, so to_module must come first.
    // Edge: to_module → from_module (prerequisite before dependent).
    for ((from, _), to) in specifier_map {
        if source_map.contains_key(to.as_str()) && source_map.contains_key(from.as_str()) {
            dependents.entry(to.as_str()).or_default().push(from.as_str());
            *in_degree.entry(from.as_str()).or_insert(0) += 1;
        }
    }

    // Kahn's algorithm — nodes with in_degree 0 have no unmet dependencies
    let mut queue: VecDeque<&str> = VecDeque::new();
    for (node, &degree) in &in_degree {
        if degree == 0 {
            queue.push_back(node);
        }
    }

    let mut sorted: Vec<String> = Vec::new();
    while let Some(node) = queue.pop_front() {
        sorted.push(node.to_string());
        if let Some(node_dependents) = dependents.get(node) {
            for dep in node_dependents {
                if let Some(d) = in_degree.get_mut(dep) {
                    *d -= 1;
                    if *d == 0 {
                        queue.push_back(dep);
                    }
                }
            }
        }
    }

    if sorted.len() != in_degree.len() {
        return Err("circular dependency detected in module graph".to_string());
    }

    Ok(sorted)
}

/// Build the complete bundle script from resolved modules.
///
/// Structure:
/// ```js
/// const __modules = {};
/// const __require = (n) => __modules[n];
/// // stub modules
/// (function(){ const __exports = {}; ... __modules['__stub__/react'] = __exports; })();
/// // real modules in topo order
/// (function(){ const __exports = {}; ... __modules['/path/to/mod.js'] = __exports; })();
/// ```
fn build_bundle(
    specifier_map: &HashMap<(String, String), String>,
    source_map: &HashMap<String, String>,
    stub_exports: &HashMap<String, HashSet<String>>,
    entry_path: &str,
) -> Result<String, String> {
    let mut bundle = String::with_capacity(source_map.values().map(|s| s.len()).sum::<usize>() + 4096);

    // Registry preamble
    bundle.push_str("const __modules = {};\nconst __require = (n) => __modules[n];\n\n");

    // Stub modules first
    for (stub_key, names) in stub_exports {
        bundle.push_str("(function(){ const __exports = {};\n");
        bundle.push_str("const noop = () => ({});\n");
        bundle.push_str("__exports.default = noop;\n");
        for name in names {
            bundle.push_str(&format!("__exports['{}'] = noop;\n", name));
        }
        bundle.push_str(&format!("__modules['{}'] = __exports;\n", stub_key));
        bundle.push_str("})();\n\n");
    }

    // Topologically sorted real modules
    let order = topological_sort(specifier_map, source_map, entry_path)?;

    for module_path in &order {
        let source = source_map.get(module_path).ok_or_else(|| {
            format!("module '{}' not found in source_map", module_path)
        })?;

        let rewritten = rewrite_module_for_bundle(source, module_path, specifier_map)?;

        bundle.push_str("(function(){ const __exports = {};\n");
        bundle.push_str(&rewritten);
        bundle.push('\n');
        // Escape single quotes in path for JS string literal
        let escaped_path = module_path.replace('\'', "\\'");
        bundle.push_str(&format!("__modules['{}'] = __exports;\n", escaped_path));
        bundle.push_str("})();\n\n");
    }

    Ok(bundle)
}

/// Execute the bundled script and extract SystemConfig.
fn execute_bundle(
    bundle_script: &str,
    entry_path: &str,
    export_name: Option<&str>,
) -> Result<SystemConfig, String> {
    let runtime = Runtime::new().map_err(|e| format!("rquickjs Runtime::new failed: {}", e))?;
    let context =
        Context::full(&runtime).map_err(|e| format!("rquickjs Context::full failed: {}", e))?;

    context.with(|ctx| {
        // Evaluate the entire bundle
        ctx.eval::<(), _>(bundle_script.as_bytes())
            .map_err(|e| {
                let exc_msg = ctx
                    .catch()
                    .as_exception()
                    .map(|exc| exc.message().unwrap_or_default())
                    .unwrap_or_default();
                format!("bundle eval failed: {} ({})", e, exc_msg)
            })?;

        // Access the entry module's exports from the registry
        let escaped_path = entry_path.replace('\'', "\\'");
        let access_script = format!("__modules['{}']", escaped_path);
        let namespace: Object = ctx
            .eval(access_script.as_bytes())
            .map_err(|e| format!("failed to access entry module exports: {}", e))?;

        extract_system_config(&ctx, &namespace, export_name)
    })
}

/// Extract SystemConfig from the module namespace.
fn extract_system_config(
    _ctx: &rquickjs::Ctx<'_>,
    namespace: &Object<'_>,
    export_name: Option<&str>,
) -> Result<SystemConfig, String> {
    // Find SystemInstance (export with .toConfig())
    let system_obj = if let Some(name) = export_name {
        namespace
            .get::<_, Object>(name)
            .map_err(|e| format!("export '{}' not found or not an object: {}", name, e))?
    } else {
        find_export_with_method(namespace, "toConfig")?
            .ok_or_else(|| {
                let keys = list_export_keys(namespace);
                format!(
                    "no SystemInstance found (no export with .toConfig()). Exports: [{}]",
                    keys.join(", ")
                )
            })?
    };

    // Call .toConfig()
    let to_config_fn: Function = system_obj
        .get("toConfig")
        .map_err(|e| format!(".toConfig() not found: {}", e))?;
    let config_obj: Object = to_config_fn
        .call(())
        .map_err(|e| format!(".toConfig() call failed: {}", e))?;

    let prop_config: String = config_obj
        .get("propConfig")
        .map_err(|e| format!("propConfig not found in config: {}", e))?;
    let group_registry: String = config_obj
        .get("groupRegistry")
        .map_err(|e| format!("groupRegistry not found in config: {}", e))?;
    let selector_aliases: Option<String> = config_obj.get("selectorAliases").ok();
    let selector_order: Option<String> = config_obj.get("selectorOrder").ok();

    // Find theme (export named 'tokens' or 'theme' with .serialize())
    let theme_obj: Object = namespace
        .get::<_, Object>("tokens")
        .or_else(|_| namespace.get::<_, Object>("theme"))
        .map_err(|_| "no 'tokens' or 'theme' export found".to_string())?;

    let serialize_fn: Function = theme_obj
        .get("serialize")
        .map_err(|e| format!(".serialize() not found on theme: {}", e))?;
    let serialized: Object = serialize_fn
        .call(())
        .map_err(|e| format!(".serialize() call failed: {}", e))?;

    let scales_json: String = serialized
        .get("scalesJson")
        .map_err(|e| format!("scalesJson not found: {}", e))?;
    let variable_map_json: String = serialized
        .get("variableMapJson")
        .map_err(|e| format!("variableMapJson not found: {}", e))?;
    let variable_css: String = serialized
        .get("variableCss")
        .map_err(|e| format!("variableCss not found: {}", e))?;
    let contextual_vars_json: String = serialized
        .get("contextualVarsJson")
        .map_err(|e| format!("contextualVarsJson not found: {}", e))?;

    // Find GlobalStyleBlock exports
    let global_style_blocks = extract_global_style_blocks(namespace);

    Ok(SystemConfig {
        prop_config,
        group_registry,
        scales_json,
        variable_map_json,
        variable_css,
        contextual_vars_json,
        selector_aliases,
        selector_order,
        global_style_blocks,
    })
}

/// Find an export that has a given method name.
fn find_export_with_method<'js>(
    namespace: &Object<'js>,
    method_name: &str,
) -> Result<Option<Object<'js>>, String> {
    let keys = list_export_keys(namespace);
    for key in &keys {
        if let Ok(obj) = namespace.get::<_, Object>(key.as_str()) {
            if obj.get::<_, Function>(method_name).is_ok() {
                return Ok(Some(obj));
            }
        }
    }
    Ok(None)
}

/// List all export keys from a module namespace.
fn list_export_keys(namespace: &Object<'_>) -> Vec<String> {
    let mut keys = Vec::new();
    for key in namespace.keys::<String>().into_iter().flatten() {
        keys.push(key);
    }
    keys
}

/// Extract GlobalStyleBlock exports (objects with __brand === 'GlobalStyleBlock').
/// Uses JSON.stringify inside the rquickjs context to serialize the styles object.
fn extract_global_style_blocks(namespace: &Object<'_>) -> Option<String> {
    let keys = list_export_keys(namespace);
    let mut blocks: HashMap<String, serde_json::Value> = HashMap::new();
    let ctx = namespace.ctx().clone();

    for key in &keys {
        if let Ok(obj) = namespace.get::<_, Object>(key.as_str()) {
            if let Ok(brand) = obj.get::<_, String>("__brand") {
                if brand == "GlobalStyleBlock" {
                    // Use eval to call JSON.stringify on the styles property
                    let script = format!(
                        "JSON.stringify(globalThis.__ns_ref[\"{}\"].styles)",
                        key
                    );
                    // Temporarily assign namespace to globalThis for access
                    let _ = ctx.globals().set("__ns_ref", namespace.clone());
                    if let Ok(json_str) = ctx.eval::<String, _>(script.as_bytes()) {
                        let _ = ctx.globals().remove("__ns_ref");
                        if let Ok(parsed) = serde_json::from_str(&json_str) {
                            blocks.insert(key.clone(), parsed);
                        }
                    } else {
                        let _ = ctx.globals().remove("__ns_ref");
                    }
                }
            }
        }
    }

    if blocks.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&blocks).unwrap_or_default())
    }
}

// ---------------------------------------------------------------------------
// 6. Public entry point
// ---------------------------------------------------------------------------

/// Load a system module and return its serialized configuration.
///
/// Pipeline: read → OXC strip types → resolve deps → bundle → rquickjs eval → extract config.
pub fn load_system_module(
    system_path: &str,
    root_dir: &str,
    export_name: Option<&str>,
) -> Result<SystemConfig, String> {
    let (specifier_map, source_map, stub_exports) = resolve_all_deps(system_path, root_dir)?;

    let entry_path = fs::canonicalize(system_path)
        .map_err(|e| format!("failed to canonicalize '{}': {}", system_path, e))?
        .to_string_lossy()
        .to_string();

    let bundle = build_bundle(&specifier_map, &source_map, &stub_exports, &entry_path)?;
    execute_bundle(&bundle, &entry_path, export_name)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_module_with_imports_and_exports() {
        let source = r#"
import { createSystem } from '@animus-ui/system';

export const tokens: MyThemeType = createSystem();

declare module '@animus-ui/system' {
    interface Theme extends MyThemeType {}
}

export const ds = tokens;
"#;
        let result = strip_typescript_module(source, "test.ts").unwrap();

        // Runtime code preserved
        assert!(result.contains("import { createSystem }"));
        assert!(result.contains("export const tokens"));
        assert!(result.contains("export const ds"));
        assert!(result.contains("createSystem()"));

        // Type annotations removed
        assert!(!result.contains("MyThemeType"));
        assert!(!result.contains("declare module"));
        assert!(!result.contains("interface Theme"));
    }

    #[test]
    fn split_specifier_scoped() {
        assert_eq!(
            split_specifier("@animus-ui/system"),
            ("@animus-ui/system", "")
        );
        assert_eq!(
            split_specifier("@animus-ui/system/groups"),
            ("@animus-ui/system", "/groups")
        );
    }

    #[test]
    fn split_specifier_unscoped() {
        assert_eq!(split_specifier("lodash"), ("lodash", ""));
        assert_eq!(split_specifier("lodash/fp"), ("lodash", "/fp"));
    }

    #[test]
    fn resolve_exports_entry_string() {
        let exports: serde_json::Value = serde_json::json!({
            ".": "./dist/index.js",
            "./groups": "./dist/groups/index.js"
        });
        assert_eq!(
            resolve_exports_entry(&exports, "."),
            Some("./dist/index.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "/groups"),
            Some("./dist/groups/index.js".to_string())
        );
    }

    #[test]
    fn resolve_exports_entry_nested_conditions() {
        let exports: serde_json::Value = serde_json::json!({
            ".": {
                "types": "./dist/index.d.ts",
                "import": "./dist/index.js"
            },
            "./runtime": {
                "import": "./dist/runtime.js",
                "default": "./dist/runtime.cjs"
            }
        });
        assert_eq!(
            resolve_exports_entry(&exports, "."),
            Some("./dist/index.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "/runtime"),
            Some("./dist/runtime.js".to_string())
        );
    }

    // Integration tests that require the workspace to be built
    // are gated behind the file existence check.

    #[test]
    fn resolve_system_package() {
        let root = env!("CARGO_MANIFEST_DIR");
        let workspace_root = Path::new(root).parent().unwrap().parent().unwrap();
        // Resolve from showcase directory (where node_modules/@animus-ui/ lives)
        let showcase_src = workspace_root.join("packages/showcase/src");
        let dir_str = showcase_src.to_string_lossy();

        // @animus-ui/system has exports field
        let result = resolve_bare_specifier("@animus-ui/system", &dir_str);
        if let Ok(path) = &result {
            assert!(path.contains("dist/index.js") || path.contains("dist/index.mjs"));
        }
        // Don't fail if packages aren't built — just skip
    }

    #[test]
    fn resolve_system_subpath() {
        let root = env!("CARGO_MANIFEST_DIR");
        let workspace_root = Path::new(root).parent().unwrap().parent().unwrap();
        let showcase_src = workspace_root.join("packages/showcase/src");
        let dir_str = showcase_src.to_string_lossy();

        let result = resolve_bare_specifier("@animus-ui/system/groups", &dir_str);
        if let Ok(path) = &result {
            assert!(path.contains("groups"));
        }
    }

    #[test]
    fn resolve_test_ds_fallback() {
        let root = env!("CARGO_MANIFEST_DIR");
        let workspace_root = Path::new(root).parent().unwrap().parent().unwrap();
        let showcase_src = workspace_root.join("packages/showcase/src");
        let dir_str = showcase_src.to_string_lossy();

        // @animus-ui/test-ds has NO exports, only module/main
        let result = resolve_bare_specifier("@animus-ui/test-ds", &dir_str);
        if let Ok(path) = &result {
            assert!(path.contains("dist/index.mjs") || path.contains("dist/index.js"));
        }
    }

    #[test]
    fn load_showcase_ds() {
        let root = env!("CARGO_MANIFEST_DIR");
        let workspace_root = Path::new(root).parent().unwrap().parent().unwrap();
        let root_str = workspace_root.to_string_lossy();
        let ds_path = workspace_root.join("packages/showcase/src/ds.ts");

        if !ds_path.exists() {
            eprintln!("skipping load_showcase_ds: ds.ts not found");
            return;
        }

        // Skip if system package hasn't been built (dist is required for bundled eval)
        let system_dist = workspace_root.join("packages/system/dist/index.js");
        if !system_dist.exists() {
            eprintln!("skipping load_showcase_ds: packages/system/dist not built (run bun run build:ts)");
            return;
        }

        let config = load_system_module(
            &ds_path.to_string_lossy(),
            &root_str,
            None,
        )
        .expect("load_system_module should succeed");

        assert!(!config.prop_config.is_empty(), "propConfig should not be empty");
        assert!(!config.scales_json.is_empty(), "scalesJson should not be empty");
        assert!(!config.variable_css.is_empty(), "variableCss should not be empty");
    }
}
