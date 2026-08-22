//! Engine-neutral TypeScript system-module loader shared by both NAPI bindings.

use std::collections::{HashMap, HashSet, VecDeque};
// Appending via `write!` rather than `push_str(&format!(..))` drops one
// intermediate String per call. Output bytes are identical, which matters:
// `marker_offsets` records `bundle.len()` at points in the generated bundle
// and those offsets are later mapped back to module line numbers.
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use oxc::allocator::Allocator;
use oxc::ast::ast::Statement;
use oxc::codegen::Codegen;
use oxc::parser::{Parser, ParserReturn};
use oxc::semantic::SemanticBuilder;
use oxc::span::{GetSpan, SourceType};
use oxc::transformer::{TransformOptions, Transformer};
use rquickjs::{Context, Function, Object, Runtime};
use serde::{Deserialize, Serialize};

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
    /// Condition alias map JSON (the `conditionAliases` field): alias →
    /// `{ value, order, kind }`. `None` when the system registers no
    /// condition aliases, keeping every existing manifest byte-identical.
    pub condition_aliases: Option<String>,
    /// Transform source texts (`{ transformName: sourceText }` JSON) captured
    /// during system evaluation. The build-time evaluator can only be seeded
    /// from source text, and `prop_config` serializes `transform` as a bare
    /// name; without this, transforms shipped inside a package (as opposed to
    /// declared in a `createTransform()` call the extractor parses out of a
    /// project file) are unresolvable and their props fall back to the raw
    /// value. `None` against a system built by an older @animus-ui/system.
    pub transform_sources: Option<String>,
    pub global_style_blocks: Option<String>,
    /// Keyframes exports — collections produced by the top-level `keyframes()`
    /// factory (objects with `__brand === 'Keyframes'`). JSON shape:
    /// `{ exportName: { keyName: { name, frames } } }`. `name` is the runtime-
    /// generated stable hash (`animus-kf-<hash>`); `frames` is the percent-stop
    /// style map ready for theme resolution via the existing `@keyframes`
    /// resolver path. The nested (exportName → keyName) structure preserves
    /// collection identity so the extractor can substitute
    /// `motion.ember`-style member-expression references against it.
    pub keyframes_blocks: Option<String>,
    /// Vocabulary collision witnesses from the sealed system's registration
    /// record (vocabulary-registration): JSON array of `{ code, name,
    /// winner, loser }` entries with the stable code
    /// `animus.vocabulary.collision`. The record — not the evaluation
    /// host's console (shimmed to a no-op) — is the witness channel; hosts
    /// surface these as diagnostics. `None` when the record carries no
    /// collisions or the system predates the record.
    pub vocabulary_collisions: Option<String>,
    /// Canonical absolute paths of every module evaluated for this system —
    /// the entry plus its transitive graph, excluding runtime stubs (which
    /// have no path). Sorted. Plugins use this as the geological-reset
    /// membership set so transitive system edits invalidate correctly.
    pub dependencies: Vec<String>,
    /// Per-module built-theme token manifests captured during the one
    /// evaluation this load already performs (extraction-diagnostics: the
    /// source-token witness for the cross-source correlation diagnostic).
    /// JSON shape: `{ modulePath: { exportName: [variableMap token paths] } }`,
    /// keyed by the same canonical paths as `dependencies`. `None` when no
    /// evaluated module exports a built theme. Capture never triggers extra
    /// evaluation, resolution, or filesystem access.
    pub source_theme_manifests: Option<String>,
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
        diagnostics: parse_errors,
        ..
    } = Parser::new(&allocator, source, source_type).parse();

    if !parse_errors.is_empty() {
        return Err(format!("parse error in {}: {}", file_path, parse_errors[0]));
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
    let pkg_json_path = find_package_json(pkg_name, from_dir)?;
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
///
/// Subpath keys are matched Node's way: an exact key first, then the
/// `"./*"` wildcard patterns, whose matched segment is substituted into the
/// resolved target. A subpath that matches nothing returns `None`, so
/// `resolve_bare_specifier` keeps falling through to `module`/`main`.
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

    // An exact key is Node's first branch and answers alone — a declared key
    // whose target resolves to nothing is a blocked subpath, not an invitation
    // to try the patterns.
    if let Some(entry) = exports.get(&lookup_key) {
        return resolve_condition_value(entry);
    }

    resolve_exports_pattern(exports.as_object()?, &lookup_key)
}

/// Match `lookup_key` against the `"./*"` subpath patterns in an exports map.
///
/// Node's specificity rule (PATTERN_KEY_COMPARE): the pattern with the longest
/// literal prefix before `*` wins, ties broken by the longest literal suffix
/// after it. The matched segment then replaces every `*` in the target.
fn resolve_exports_pattern(
    exports: &serde_json::Map<String, serde_json::Value>,
    lookup_key: &str,
) -> Option<String> {
    let mut best: Option<(&str, &str, &serde_json::Value)> = None;

    for (pattern, value) in exports {
        // Exactly one `*`, in a subpath key: anything else is not a pattern.
        let Some((prefix, suffix)) = pattern.split_once('*') else {
            continue;
        };
        if !prefix.starts_with("./") || suffix.contains('*') {
            continue;
        }
        if !lookup_key.starts_with(prefix) || !lookup_key.ends_with(suffix) {
            continue;
        }
        if lookup_key.len() < prefix.len() + suffix.len() {
            continue;
        }
        let more_specific = match best {
            None => true,
            Some((best_prefix, best_suffix, _)) => {
                prefix.len() > best_prefix.len()
                    || (prefix.len() == best_prefix.len() && suffix.len() > best_suffix.len())
            }
        };
        if more_specific {
            best = Some((prefix, suffix, value));
        }
    }

    let (prefix, suffix, value) = best?;
    let matched = &lookup_key[prefix.len()..lookup_key.len() - suffix.len()];
    Some(resolve_condition_value(value)?.replace('*', matched))
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

/// Import info: specifier + the export names the importing module needs from it.
///
/// `names` are the names as they exist in the *imported* module (`space` for
/// `import { space as dsSpace }`, `X` for `export { X as Y } from 'pkg'`) —
/// exactly what a stub module must define, because the bundle rewrite
/// destructures `{ imported: local }`. Default imports are omitted: every stub
/// defines `default` unconditionally. Namespace imports bind the whole exports
/// object and need no named export.
struct ImportInfo {
    specifier: String,
    names: Vec<String>,
}

/// Stringify an `import`/`export` clause name (identifier or string literal).
fn module_export_name(name: &oxc::ast::ast::ModuleExportName<'_>) -> String {
    match name {
        oxc::ast::ast::ModuleExportName::IdentifierName(id) => id.name.to_string(),
        oxc::ast::ast::ModuleExportName::IdentifierReference(id) => id.name.to_string(),
        oxc::ast::ast::ModuleExportName::StringLiteral(literal) => literal.value.to_string(),
    }
}

/// Non-code asset extensions that carry no module semantics in the sandbox.
const ASSET_EXTENSIONS: &[&str] = &[
    ".woff2", ".woff", ".ttf", ".otf", ".eot", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
    ".svg", ".ico", ".mp4", ".webm", ".mp3", ".wasm", ".pdf",
];

/// Why a specifier is a bundler asset import (None for ordinary modules).
fn asset_import_reason(specifier: &str) -> Option<&'static str> {
    if let Some((_, query)) = specifier.split_once('?') {
        if matches!(query, "url" | "raw" | "inline" | "no-inline") {
            return Some("bundler asset query suffix");
        }
    }
    let path = specifier.split('?').next().unwrap_or(specifier);
    let lower = path.to_ascii_lowercase();
    if ASSET_EXTENSIONS.iter().any(|ext| lower.ends_with(ext)) {
        return Some("binary asset extension");
    }
    None
}

/// Bundle registry key for a stubbed runtime package.
fn stub_key(specifier: &str) -> String {
    format!("__stub__/{}", specifier)
}

/// Escape a value for embedding in a SINGLE-QUOTED JS string literal in the
/// generated bundle. Canonical paths and bare specifiers may legally contain
/// `'` or `\` (`/Users/dev/Bob's Projects`, `import x from "it's-a-module"`),
/// and an unescaped one ends the literal early — a QuickJS syntax error that
/// kills the WHOLE bundle, not just the offending module.
///
/// Every registry write (`__modules['…']`) and every lookup (`__require('…')`)
/// must go through this: the escaping is value-preserving, so an escaped key
/// still compares equal to an escaped lookup at runtime, but a half-applied fix
/// would silently miss the registry. Backslash is escaped FIRST — reversing the
/// order would re-escape the backslash this function just introduced.
fn js_quoted(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

/// Packages that are deliberately replaced by noop stubs instead of being
/// evaluated. Matching is exact (package or subpath), never by prefix: a system
/// module never needs React at runtime, but every other bare specifier is a
/// real dependency that must resolve or fail the load.
const RUNTIME_STUB_SPECIFIERS: [&str; 4] = [
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-dom",
];

/// True when a bare specifier is on the enumerated runtime stub list.
fn is_runtime_stub_specifier(specifier: &str) -> bool {
    RUNTIME_STUB_SPECIFIERS.contains(&specifier)
}

/// True when a module body contains any ESM import/export statement.
fn has_esm_syntax(source: &str, file_path: &str) -> bool {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(Path::new(file_path))
        .unwrap_or_else(|_| SourceType::mjs())
        .with_module(true);

    let ParserReturn { program, .. } = Parser::new(&allocator, source, source_type).parse();

    program.body.iter().any(|stmt| {
        matches!(
            stmt,
            Statement::ImportDeclaration(_)
                | Statement::ExportNamedDeclaration(_)
                | Statement::ExportAllDeclaration(_)
                | Statement::ExportDefaultDeclaration(_)
        )
    })
}

/// Conservative CommonJS detection: a module with no ESM syntax at all that
/// still mentions `module.exports` or `require(`. The bundle rewrites ESM into
/// IIFEs, so a CJS body would evaluate against an undefined `module`/`require`
/// and fail far from its cause — better to reject it at resolution time.
fn looks_like_commonjs(source: &str, file_path: &str) -> bool {
    if has_esm_syntax(source, file_path) {
        return false;
    }
    source.contains("module.exports") || source.contains("require(")
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
                // Type-only imports are erased by the TypeScript strip, so they
                // must not drive resolution: a types-only package (csstype and
                // friends) has no runtime entry to resolve to, and failing the
                // load over an annotation would be absurd.
                if decl.import_kind.is_type() {
                    continue;
                }

                let mut names = Vec::new();
                let mut specifier_count = 0usize;
                let mut value_count = 0usize;
                if let Some(specifiers) = &decl.specifiers {
                    for spec in specifiers {
                        specifier_count += 1;
                        match spec {
                            oxc::ast::ast::ImportDeclarationSpecifier::ImportSpecifier(s) => {
                                if s.import_kind.is_type() {
                                    continue;
                                }
                                value_count += 1;
                                // Record the IMPORTED name, not the local binding
                                // — the bundle rewrite destructures
                                // `{ imported: local }`, so a stub keyed on the
                                // local name would bind `undefined`.
                                names.push(module_export_name(&s.imported));
                            }
                            _ => value_count += 1,
                        }
                    }
                }

                // `import { type A } from 'x'` leaves no value binding and is
                // erased too. Only a truly bare `import 'x'` keeps its side effect.
                if specifier_count > 0 && value_count == 0 {
                    continue;
                }

                imports.push(ImportInfo {
                    specifier: decl.source.value.to_string(),
                    names,
                });
            }
            Statement::ExportNamedDeclaration(decl) => {
                if decl.export_kind.is_type() {
                    continue;
                }
                if let Some(source) = &decl.source {
                    // `export { X as Y } from 'pkg'` reads `X` out of 'pkg'.
                    let names: Vec<String> = decl
                        .specifiers
                        .iter()
                        .filter(|es| !es.export_kind.is_type())
                        .map(|es| module_export_name(&es.local))
                        .collect();
                    if !decl.specifiers.is_empty() && names.is_empty() {
                        continue;
                    }
                    imports.push(ImportInfo {
                        specifier: source.value.to_string(),
                        names,
                    });
                }
            }
            Statement::ExportAllDeclaration(decl) => {
                if decl.export_kind.is_type() {
                    continue;
                }
                // `export * from 'pkg'` needs the module object to exist; the
                // individual names are unknowable without evaluating 'pkg'.
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
type DependencyResolution = (
    HashMap<(String, String), String>,
    HashMap<String, String>,
    HashMap<String, HashSet<String>>,
);

pub fn resolve_all_deps(
    system_path: &str,
    _root_dir: &str,
) -> Result<DependencyResolution, String> {
    let mut specifier_map: HashMap<(String, String), String> = HashMap::new();
    let mut source_map: HashMap<String, String> = HashMap::new();
    let mut stub_exports: HashMap<String, HashSet<String>> = HashMap::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    // canonical path → the bare specifier that pulled in a non-workspace
    // package, so the CommonJS guard can name the import that failed.
    let mut external_modules: HashMap<String, String> = HashMap::new();

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

        // Fail closed on CommonJS entry points pulled in from node_modules —
        // the bundle has no `module`/`require` to evaluate them against.
        if let Some(spec) = external_modules.get(&current_path) {
            if looks_like_commonjs(&raw_source, &current_path) {
                return Err(format!(
                    "CommonJS module '{}' (resolved to '{}') cannot be evaluated in the system \
                     loader; add it to the runtime stub list or use an ESM entry",
                    spec, current_path
                ));
            }
        }

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
            // Bundler asset imports cannot traverse system evaluation: a
            // query-suffixed specifier (?url/?raw/?inline) or a binary asset
            // extension has no module semantics in the sandbox — crawling it
            // yields an exports-less module whose `.default` is undefined,
            // the least debuggable failure this loader can produce. Fail
            // loud, name the specifier, and point at the supported form.
            if let Some(reason) = asset_import_reason(spec) {
                return Err(format!(
                    "asset import '{}' in '{}' cannot traverse system \
                     evaluation ({}); reference package-owned assets with \
                     asset('<specifier>') from @animus-ui/system, or use a \
                     literal URL string (e.g. '/fonts/inter.woff2') — the \
                     host bundler's asset pipeline owns resolution",
                    spec, current_path, reason
                ));
            }
            if spec.starts_with('.') || spec.starts_with('/') {
                // Relative import
                match resolve_relative(current_dir, spec) {
                    Ok(resolved) => {
                        let canonical = fs::canonicalize(&resolved)
                            .unwrap_or_else(|_| PathBuf::from(&resolved))
                            .to_string_lossy()
                            .to_string();
                        specifier_map
                            .insert((current_path.clone(), spec.clone()), canonical.clone());
                        if !visited.contains(&canonical) {
                            queue.push_back(canonical);
                        }
                    }
                    Err(_) => {
                        // Skip unresolvable relative imports (may be type-only)
                    }
                }
            } else if spec.starts_with("node:") {
                // Node builtins do not exist in the QuickJS sandbox. Fail with
                // the real reason instead of a misleading package-resolution
                // error ("Is the package built?").
                return Err(format!(
                    "Node builtin '{}' imported by '{}' is not available in the \
                     system loader sandbox; system modules must evaluate without \
                     Node APIs — move this dependency out of the system entry's \
                     module graph",
                    spec, current_path
                ));
            } else if is_runtime_stub_specifier(spec) {
                // Enumerated runtime package → noop stub module. Register the
                // module even when no names are imported, so bare `import 'react'`
                // and `export * from 'react'` still find an object at runtime.
                let stub = stub_exports.entry(stub_key(spec)).or_default();
                for name in &info.names {
                    stub.insert(name.clone());
                }
            } else {
                // Every other bare specifier is a real dependency: resolve it and
                // crawl it, or fail the load. There is no generic stub fallback —
                // a silent stub turns a missing package into "X is not a function"
                // thrown from deep inside an unrelated module.
                match resolve_bare_specifier(spec, &current_dir.to_string_lossy()) {
                    Ok(resolved) => {
                        let canonical = fs::canonicalize(&resolved)
                            .unwrap_or_else(|_| PathBuf::from(&resolved))
                            .to_string_lossy()
                            .to_string();
                        specifier_map
                            .insert((current_path.clone(), spec.clone()), canonical.clone());
                        if !spec.starts_with("@animus-ui/") {
                            external_modules.insert(canonical.clone(), spec.clone());
                        }
                        if !visited.contains(&canonical) {
                            queue.push_back(canonical);
                        }
                    }
                    Err(e) => {
                        return Err(format!(
                            "failed to resolve package '{}' imported by '{}': {}. \
                             Is the package built? (run bun run build:ts) If it is not needed \
                             to evaluate the system, add it to the runtime stub list \
                             (RUNTIME_STUB_SPECIFIERS in the system loader).",
                            spec, current_path, e
                        ));
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

/// `require_literal` is the registry key ALREADY escaped by `js_quoted` — it is
/// spliced straight into `__require('…')` and must never be used as a map key.
fn rewrite_import_specifiers(
    specifiers: &[oxc::ast::ast::ImportDeclarationSpecifier<'_>],
    require_literal: &str,
) -> String {
    let mut destructure_parts = Vec::new();
    let mut default_name: Option<String> = None;
    let mut namespace_name: Option<String> = None;

    for specifier in specifiers {
        match specifier {
            oxc::ast::ast::ImportDeclarationSpecifier::ImportSpecifier(import) => {
                let imported = module_export_name(&import.imported);
                let local = import.local.name.to_string();
                if imported == local {
                    destructure_parts.push(imported);
                } else {
                    destructure_parts.push(format!("{}: {}", imported, local));
                }
            }
            oxc::ast::ast::ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                default_name = Some(default.local.name.to_string());
            }
            oxc::ast::ast::ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                namespace_name = Some(namespace.local.name.to_string());
            }
        }
    }

    let mut parts = Vec::new();
    if let Some(namespace_name) = namespace_name {
        parts.push(format!(
            "const {} = __require('{}')",
            namespace_name, require_literal
        ));
    } else {
        if let Some(default_name) = default_name {
            parts.push(format!(
                "const {} = __require('{}').default",
                default_name, require_literal
            ));
        }
        if !destructure_parts.is_empty() {
            parts.push(format!(
                "const {{ {} }} = __require('{}')",
                destructure_parts.join(", "),
                require_literal
            ));
        }
    }
    parts.join(";\n")
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
                let require_literal = js_quoted(
                    &specifier_map
                        .get(&(canonical_path.to_string(), spec.clone()))
                        .cloned()
                        .unwrap_or_else(|| stub_key(&spec)),
                );

                let replacement = match &decl.specifiers {
                    Some(specifiers) if !specifiers.is_empty() => {
                        rewrite_import_specifiers(specifiers, &require_literal)
                    }
                    _ => format!("__require('{}')", require_literal),
                };

                ops.push(RewriteOp {
                    start: decl.span.start as usize,
                    end: decl.span.end as usize,
                    replacement,
                });
            }

            Statement::ExportNamedDeclaration(decl) => {
                if let Some(source_lit) = &decl.source {
                    // Re-export: `export { X } from 'Y'`
                    let spec = source_lit.value.to_string();
                    let require_literal = js_quoted(
                        &specifier_map
                            .get(&(canonical_path.to_string(), spec.clone()))
                            .cloned()
                            .unwrap_or_else(|| stub_key(&spec)),
                    );

                    let mut assignments = Vec::new();
                    for es in &decl.specifiers {
                        // Arbitrary module namespace names (`export { v as "it's" }`)
                        // are legal ES2022, so export names take the same escape.
                        let local_str = js_quoted(&module_export_name(&es.local));
                        let exported_str = js_quoted(&module_export_name(&es.exported));
                        assignments.push(format!(
                            "__exports['{}'] = __require('{}')['{}']",
                            exported_str, require_literal, local_str
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
                        trailing_exports.push((
                            module_export_name(&es.exported),
                            module_export_name(&es.local),
                        ));
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
                // `export * from 'Y'` / `export * as ns from 'Y'`
                let spec = decl.source.value.to_string();
                let require_literal = js_quoted(
                    &specifier_map
                        .get(&(canonical_path.to_string(), spec.clone()))
                        .cloned()
                        .unwrap_or_else(|| stub_key(&spec)),
                );
                // `|| {}` guards the case where the registry has no entry for the
                // key: `Object.assign(target, undefined)` is a no-op in spec terms
                // but the surrounding code then reads exports that never appear.
                let replacement = match &decl.exported {
                    // Namespace form binds the whole module object to one name.
                    Some(exported) => format!(
                        "__exports['{}'] = __require('{}') || {{}}",
                        js_quoted(&module_export_name(exported)),
                        require_literal
                    ),
                    None => format!(
                        "Object.assign(__exports, __require('{}') || {{}})",
                        require_literal
                    ),
                };
                ops.push(RewriteOp {
                    start: decl.span.start as usize,
                    end: decl.span.end as usize,
                    replacement,
                });
            }

            _ => {}
        }
    }

    // Apply rewrites in reverse byte order (so earlier offsets stay valid)
    ops.sort_by_key(|op| std::cmp::Reverse(op.start));
    let mut result = source.to_string();
    for op in &ops {
        result.replace_range(op.start..op.end, &op.replacement);
    }

    // Append trailing export assignments
    if !trailing_exports.is_empty() {
        result.push('\n');
        for (exported, local) in &trailing_exports {
            // `local` is a JS binding identifier (emitted bare); `exported` is a
            // module namespace name, which may be an arbitrary string literal.
            let _ = writeln!(result, "__exports['{}'] = {};", js_quoted(exported), local);
        }
    }

    Ok(result)
}

/// Collect exported names from a declaration (for `export const X = ...` patterns).
fn collect_declaration_export_names(
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

/// Collect binding names from a pattern (handles destructuring).
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
            dependents
                .entry(to.as_str())
                .or_default()
                .push(from.as_str());
            *in_degree.entry(from.as_str()).or_insert(0) += 1;
        }
    }

    // Deterministic traversal: HashMap iteration order is unspecified, so seed
    // the queue and every adjacency list in path order. Without this, modules
    // with no ordering constraint between them can be emitted in a different
    // sequence on each run and the bundle stops being byte-stable.
    for node_dependents in dependents.values_mut() {
        node_dependents.sort_unstable();
    }

    // Kahn's algorithm — nodes with in_degree 0 have no unmet dependencies
    let mut roots: Vec<&str> = in_degree
        .iter()
        .filter(|(_, &degree)| degree == 0)
        .map(|(node, _)| *node)
        .collect();
    roots.sort_unstable();
    let mut queue: VecDeque<&str> = roots.into_iter().collect();

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

/// Marker comment emitted before each module's IIFE. Bundle-line-to-module
/// attribution keys off these; the text is also what a human reads when
/// dumping the generated bundle.
const MODULE_MARKER_PREFIX: &str = "// __module__: ";

/// Host shim evaluated before any module.
///
/// `Context::full` installs the ECMAScript intrinsics only — there is no host
/// `console` — so a single top-level `console.log` anywhere in the system or
/// its dependencies would abort the whole load with a ReferenceError. Pure JS
/// on purpose: no new Rust API, no NAPI change.
const CONSOLE_SHIM: &str = "globalThis.console = globalThis.console || (function(){\n\
const noop = function(){};\n\
return { log: noop, warn: noop, error: noop, info: noop, debug: noop, trace: noop, \
dir: noop, group: noop, groupEnd: noop, table: noop, assert: noop, count: noop, \
time: noop, timeEnd: noop, timeLog: noop };\n\
})();\n";

/// Line-indexed provenance for a generated bundle.
///
/// The bundle is evaluated as a single script, so a QuickJS backtrace only ever
/// names one line number. `module_starts` maps the 1-based line of each module
/// marker to the module it introduces, which turns that bare line number back
/// into the owning file. `stub_specifiers` lists the packages replaced by noop
/// stubs, so an "X is not a function" failure can be traced to the stubbing
/// decision that produced it.
#[derive(Default)]
struct BundleLayout {
    module_starts: Vec<(usize, String)>,
    stub_specifiers: Vec<String>,
}

impl BundleLayout {
    /// Module owning a 1-based bundle line — the last marker at or before it.
    fn module_for_line(&self, line: usize) -> Option<&str> {
        self.module_starts
            .iter()
            .rev()
            .find(|(start, _)| *start <= line)
            .map(|(_, module)| module.as_str())
    }
}

/// Convert ascending byte offsets into 1-based line numbers in a single pass.
fn offsets_to_line_numbers(bundle: &str, offsets: Vec<(usize, String)>) -> Vec<(usize, String)> {
    let bytes = bundle.as_bytes();
    let mut cursor = 0usize;
    let mut line = 1usize;

    offsets
        .into_iter()
        .map(|(offset, label)| {
            while cursor < offset && cursor < bytes.len() {
                if bytes[cursor] == b'\n' {
                    line += 1;
                }
                cursor += 1;
            }
            (line, label)
        })
        .collect()
}

/// Build the complete bundle script from resolved modules.
///
/// Structure:
/// ```js
/// globalThis.console = globalThis.console || ...;  // host shim
/// const __modules = {};
/// const __require = (n) => __modules[n];
/// // __module__: __stub__/react
/// (function(){ const __exports = {}; ... __modules['__stub__/react'] = __exports; })();
/// // __module__: /path/to/mod.js
/// (function(){ const __exports = {}; ... __modules['/path/to/mod.js'] = __exports; })();
/// ```
///
/// Returns the script together with the [`BundleLayout`] needed to attribute an
/// eval failure back to the module that caused it.
fn build_bundle(
    specifier_map: &HashMap<(String, String), String>,
    source_map: &HashMap<String, String>,
    stub_exports: &HashMap<String, HashSet<String>>,
    entry_path: &str,
) -> Result<(String, BundleLayout), String> {
    let mut bundle =
        String::with_capacity(source_map.values().map(|s| s.len()).sum::<usize>() + 4096);
    // (byte offset of the marker, module label) — ascending by construction.
    let mut marker_offsets: Vec<(usize, String)> = Vec::new();

    // Host shim + registry preamble
    bundle.push_str(CONSOLE_SHIM);
    bundle.push_str("const __modules = {};\nconst __require = (n) => __modules[n];\n\n");

    // Stub modules first, emitted in sorted key order (and with sorted export
    // names) so the same inputs always produce the same bytes.
    let mut stub_modules: Vec<(&String, &HashSet<String>)> = stub_exports.iter().collect();
    stub_modules.sort_by(|a, b| a.0.cmp(b.0));

    let mut stub_specifiers: Vec<String> = Vec::with_capacity(stub_modules.len());
    for (key, names) in stub_modules {
        stub_specifiers.push(key.strip_prefix("__stub__/").unwrap_or(key).to_string());

        marker_offsets.push((bundle.len(), key.clone()));
        let _ = writeln!(bundle, "{}{}", MODULE_MARKER_PREFIX, key);
        bundle.push_str("(function(){ const __exports = {};\n");
        bundle.push_str("const noop = () => ({});\n");
        bundle.push_str("__exports.default = noop;\n");
        let mut sorted_names: Vec<&String> = names.iter().collect();
        sorted_names.sort();
        for name in sorted_names {
            let _ = writeln!(bundle, "__exports['{}'] = noop;", js_quoted(name));
        }
        let _ = writeln!(bundle, "__modules['{}'] = __exports;", js_quoted(key));
        bundle.push_str("})();\n\n");
    }

    // Topologically sorted real modules
    let order = topological_sort(specifier_map, source_map, entry_path)?;

    for module_path in &order {
        let source = source_map
            .get(module_path)
            .ok_or_else(|| format!("module '{}' not found in source_map", module_path))?;

        let rewritten = rewrite_module_for_bundle(source, module_path, specifier_map)?;

        marker_offsets.push((bundle.len(), module_path.clone()));
        let _ = writeln!(bundle, "{}{}", MODULE_MARKER_PREFIX, module_path);
        bundle.push_str("(function(){ const __exports = {};\n");
        bundle.push_str(&rewritten);
        bundle.push('\n');
        let _ = writeln!(
            bundle,
            "__modules['{}'] = __exports;",
            js_quoted(module_path)
        );
        bundle.push_str("})();\n\n");
    }

    let module_starts = offsets_to_line_numbers(&bundle, marker_offsets);
    Ok((
        bundle,
        BundleLayout {
            module_starts,
            stub_specifiers,
        },
    ))
}

/// Line number of the innermost bundle frame in a QuickJS backtrace.
///
/// rquickjs evaluates with the script name `eval_script`, so frames read
/// `    at <eval> (eval_script:42)` (a `:column` suffix, when present, is
/// ignored). Returns `None` for a stack that never entered the bundle.
fn bundle_line_from_stack(stack: &str) -> Option<usize> {
    const MARKER: &str = "eval_script:";
    let start = stack.find(MARKER)? + MARKER.len();
    let digits: String = stack[start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// Describe a bundle eval failure with the module that owns the failing line
/// and the stubbing decisions in force, so "X is not a function" is traceable.
fn describe_eval_failure(
    ctx: &rquickjs::Ctx<'_>,
    layout: &BundleLayout,
    error: &rquickjs::Error,
) -> String {
    let caught = ctx.catch();
    let exception = caught.as_exception();
    let message = exception.and_then(|exc| exc.message()).unwrap_or_default();
    let stack = exception.and_then(|exc| exc.stack()).unwrap_or_default();

    let mut description = format!("bundle eval failed: {} ({})", error, message);

    if let Some(line) = bundle_line_from_stack(&stack) {
        match layout.module_for_line(line) {
            Some(module) => {
                let _ = write!(description, " in module '{}' (bundle line {})", module, line);
            }
            None => {
                let _ = write!(description, " at bundle line {}", line);
            }
        }
    }

    if !layout.stub_specifiers.is_empty() {
        let _ = write!(
            description,
            "; stubbed specifiers: [{}]",
            layout.stub_specifiers.join(", ")
        );
    }

    let trimmed_stack = stack.trim();
    if !trimmed_stack.is_empty() {
        let _ = write!(description, "; stack: {}", trimmed_stack.replace('\n', " | "));
    }

    description
}

/// Execute the bundled script and extract SystemConfig.
fn execute_bundle(
    bundle_script: &str,
    layout: &BundleLayout,
    entry_path: &str,
    export_name: Option<&str>,
) -> Result<SystemConfig, String> {
    let runtime = Runtime::new().map_err(|e| format!("rquickjs Runtime::new failed: {}", e))?;
    let context =
        Context::full(&runtime).map_err(|e| format!("rquickjs Context::full failed: {}", e))?;

    context.with(|ctx| {
        // Evaluate the entire bundle
        ctx.eval::<(), _>(bundle_script.as_bytes())
            .map_err(|e| describe_eval_failure(&ctx, layout, &e))?;

        // Access the entry module's exports from the registry — the same escape
        // the registration used, so the two keys still match.
        let access_script = format!("__modules['{}']", js_quoted(entry_path));
        let namespace: Object = ctx
            .eval(access_script.as_bytes())
            .map_err(|e| format!("failed to access entry module exports: {}", e))?;

        let mut config = extract_system_config(&ctx, &namespace, export_name)?;
        config.source_theme_manifests = extract_source_theme_manifests(&ctx);
        Ok(config)
    })
}

/// Capture per-module built-theme token manifests from the already-evaluated
/// module registry (the source-token witness for the cross-source correlation
/// diagnostic). A built theme is recognized by its non-enumerable `manifest`
/// object carrying `tokenMap` (or legacy `variableMap`); only the token PATHS
/// (keys) are captured.
/// A library bundle export (`{ system, theme }`, with `tokens` accepted as
/// the legacy spelling — recognized exactly as the builders do, by
/// `system.toConfig` being callable) contributes its theme half: a kit whose
/// only export is the bundle would otherwise yield no
/// witness and silently lose the correlation diagnostic. Pure registry walk —
/// no additional evaluation, resolution, or filesystem access happens here.
fn extract_source_theme_manifests(ctx: &rquickjs::Ctx<'_>) -> Option<String> {
    let script = r#"(() => {
  const out = {};
  const themeTokens = (v) => {
    if (
      v && typeof v === 'object' &&
      v.manifest && typeof v.manifest === 'object' &&
      (
        v.manifest.tokenMap && typeof v.manifest.tokenMap === 'object' ||
        v.manifest.variableMap && typeof v.manifest.variableMap === 'object'
      )
    ) {
      const map = v.manifest.tokenMap && typeof v.manifest.tokenMap === 'object'
        ? v.manifest.tokenMap
        : v.manifest.variableMap;
      return Object.keys(map);
    }
    return null;
  };
  for (const path in __modules) {
    const ns = __modules[path];
    if (!ns || typeof ns !== 'object') continue;
    const themes = {};
    for (const key of Object.keys(ns)) {
      try {
        const v = ns[key];
        let tokens = themeTokens(v);
        // Bundle discriminator mirrors isLibraryBundle in
        // packages/system/src/SystemBuilder.ts (this sandbox cannot import
        // TS) — keep the two in sync.
        if (
          tokens === null &&
          v && typeof v === 'object' &&
          v.system && typeof v.system.toConfig === 'function'
        ) {
          tokens = themeTokens(v.theme);
          if (tokens === null) tokens = themeTokens(v.tokens);
        }
        if (tokens !== null) themes[key] = tokens;
      } catch (_e) {}
    }
    if (Object.keys(themes).length > 0) out[path] = themes;
  }
  return JSON.stringify(out);
})()"#;
    let json: String = ctx.eval(script.as_bytes()).ok()?;
    if json == "{}" {
        None
    } else {
        Some(json)
    }
}

/// Extract SystemConfig from the module namespace.
fn extract_system_config<'js>(
    ctx: &rquickjs::Ctx<'js>,
    namespace: &Object<'js>,
    export_name: Option<&str>,
) -> Result<SystemConfig, String> {
    // Find SystemInstance (export with .toConfig()). Without an explicit
    // export name, MORE THAN ONE distinct system-like export is a load
    // error naming every candidate (vocabulary-registration ambiguity
    // guard; precedent: the dual-built-theme identity check below) — never
    // an enumeration-order first-pick, which would silently load a system
    // with no registrations during a migration.
    let system_obj = if let Some(name) = export_name {
        namespace
            .get::<_, Object>(name)
            .map_err(|e| format!("export '{}' not found or not an object: {}", name, e))?
    } else {
        let candidates = find_exports_with_method(namespace, "toConfig");
        match candidates.len() {
            0 => {
                let keys = list_export_keys(namespace);
                return Err(format!(
                    "no SystemInstance found (no export with .toConfig()). Exports: [{}]",
                    keys.join(", ")
                ));
            }
            1 => candidates.into_iter().next().map(|(_, obj)| obj).unwrap(),
            _ => {
                let is_same: Function = ctx
                    .eval(b"(a, b) => a === b" as &[u8])
                    .map_err(|e| format!("system export identity check failed: {}", e))?;
                let first = candidates[0].1.clone();
                let mut distinct = false;
                for (_, obj) in candidates.iter().skip(1) {
                    let same: bool = is_same
                        .call((first.clone(), obj.clone()))
                        .map_err(|e| format!("system export identity check failed: {}", e))?;
                    if !same {
                        distinct = true;
                        break;
                    }
                }
                if distinct {
                    let keys: Vec<&str> =
                        candidates.iter().map(|(key, _)| key.as_str()).collect();
                    return Err(format!(
                        "ambiguous system exports: [{}] each carry .toConfig() but are not \
                         the same object; the loader selects exactly one system — export a \
                         single (sealed) instance or pass an explicit export name",
                        keys.join(", ")
                    ));
                }
                first
            }
        }
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
    let condition_aliases: Option<String> = config_obj.get("conditionAliases").ok();
    // `{ transformName: sourceText }` — the only channel by which transforms
    // shipped inside a package reach the build-time evaluator (the extractor's
    // other seed is `createTransform()` calls parsed out of project files).
    // `None` against a system built by an older @animus-ui/system.
    let transform_sources: Option<String> = config_obj.get("transformSources").ok();

    // Find theme (export named 'theme' with .serialize(), 'tokens' accepted
    // as a fallback — public naming standardizes on 'theme'). When both
    // names are exported and each is a built theme (callable .serialize()),
    // they must be the SAME object — two distinct built themes make the
    // serialized winner ambiguous, so the load fails naming both exports.
    // Reference equality is judged inside the QuickJS context; serialized
    // output is never compared.
    let theme_export = namespace.get::<_, Object>("theme").ok();
    let tokens_export = namespace.get::<_, Object>("tokens").ok();

    let is_built_theme = |obj: &Object<'_>| obj.get::<_, Function>("serialize").is_ok();
    if let (Some(theme), Some(tokens)) = (&theme_export, &tokens_export) {
        if is_built_theme(theme) && is_built_theme(tokens) {
            let same_object: bool = ctx
                .eval::<Function, _>(b"(a, b) => a === b" as &[u8])
                .and_then(|is_same| is_same.call((theme.clone(), tokens.clone())))
                .map_err(|e| format!("theme export identity check failed: {}", e))?;
            if !same_object {
                return Err(
                    "both 'theme' and 'tokens' exports are built themes but not the same \
                     object; the loader serializes exactly one theme — alias them (e.g. \
                     `export const tokens = theme`) or remove one"
                        .to_string(),
                );
            }
        }
    }

    // Selection with diagnosis — never a silent drop. A `theme` export that
    // is a ThemeBuilder missing its trailing .build() is the closest-miss
    // authoring error the 'theme'/'tokens' migration window invites: falling
    // through to a
    // legacy `tokens` export would extract a configuration the author did
    // not edit, and reporting "no export found" would deny an export that is
    // plainly present. Only a NON-builder `theme` value (an unrelated object
    // that happens to use the name) still falls back to built `tokens`.
    let is_theme_builder = |obj: &Object<'_>| {
        obj.get::<_, Function>("build").is_ok() && obj.get::<_, Function>("addScale").is_ok()
    };
    let built_theme = theme_export.clone().filter(|theme| is_built_theme(theme));
    let built_tokens = tokens_export.clone().filter(|tokens| is_built_theme(tokens));
    let theme_obj: Object = if let Some(theme) = built_theme {
        theme
    } else if theme_export.as_ref().is_some_and(is_theme_builder) {
        return Err(
            "'theme' export is a ThemeBuilder that was never built — add the trailing \
             .build() (`export const theme = createTheme()/* ... */.build()`); refusing \
             to fall back to any 'tokens' export"
                .to_string(),
        );
    } else if let Some(tokens) = built_tokens {
        tokens
    } else if tokens_export.as_ref().is_some_and(is_theme_builder) {
        return Err(
            "'tokens' export is a ThemeBuilder that was never built — add the trailing \
             .build() (`export const tokens = createTheme()/* ... */.build()`)"
                .to_string(),
        );
    } else {
        let present = match (theme_export.is_some(), tokens_export.is_some()) {
            (true, true) => Some("'theme' and 'tokens' exports are present but neither is"),
            (true, false) => Some("'theme' export is present but it is not"),
            (false, true) => Some("'tokens' export is present but it is not"),
            (false, false) => None,
        };
        return Err(match present {
            Some(what) => format!(
                "{} a built theme (no callable .serialize()) — export a built theme: \
                 `export const theme = createTheme()/* ... */.build()`",
                what
            ),
            None => "no 'theme' or 'tokens' export found".to_string(),
        });
    };

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

    // Find GlobalStyleBlock exports (registration conformance for global
    // styles is a later increment — export scan stays their channel here).
    let global_style_blocks = extract_global_style_blocks(namespace);

    // Keyframe collections (vocabulary-registration): a sealed system's
    // registration record is the ONLY source — an exported-but-unregistered
    // collection does not carry. A system WITHOUT the record accessor falls
    // back to the export scan so un-migrated systems keep loading; the
    // migration increment deletes that fallback and makes record absence
    // the loud version-skew error.
    let has_record = system_obj
        .get::<_, Function>("getVocabularyRecord")
        .is_ok();
    let (keyframes_blocks, vocabulary_collisions) = if has_record {
        extract_vocabulary_record(ctx, &system_obj)?
    } else {
        (extract_keyframes_blocks(namespace), None)
    };

    Ok(SystemConfig {
        prop_config,
        group_registry,
        scales_json,
        variable_map_json,
        variable_css,
        contextual_vars_json,
        selector_aliases,
        selector_order,
        condition_aliases,
        transform_sources,
        global_style_blocks,
        keyframes_blocks,
        vocabulary_collisions,
        // Populated by load_system_module from the resolved module graph;
        // execute_bundle only sees the assembled bundle text.
        dependencies: Vec::new(),
        // Populated by execute_bundle after config extraction (the registry
        // walk needs the live rquickjs context, not the namespace alone).
        source_theme_manifests: None,
    })
}

/// Find every export that has a given method name, with its export key.
fn find_exports_with_method<'js>(
    namespace: &Object<'js>,
    method_name: &str,
) -> Vec<(String, Object<'js>)> {
    let mut found = Vec::new();
    for key in list_export_keys(namespace) {
        if let Ok(obj) = namespace.get::<_, Object>(key.as_str()) {
            if obj.get::<_, Function>(method_name).is_ok() {
                found.push((key, obj));
            }
        }
    }
    found
}

/// Read the sealed system's vocabulary record (vocabulary-registration).
/// Returns `(keyframes_blocks, vocabulary_collisions)`: the record's
/// declaration-ordered `keyframes` array becomes the unchanged
/// `{ exportName: { keyName: { name, frames } } }` wire (insertion order
/// preserved end to end — `Object.fromEntries` + `JSON.stringify` in the
/// evaluation context, `preserve_order` on the Rust side), and its
/// `collisions` entries carry verbatim as the host-facing witness. An
/// incompatible version marker fails the load loud.
fn extract_vocabulary_record<'js>(
    ctx: &rquickjs::Ctx<'js>,
    system_obj: &Object<'js>,
) -> Result<(Option<String>, Option<String>), String> {
    let script = r#"(() => {
  const record = globalThis.__sys_ref.getVocabularyRecord();
  if (!record || typeof record !== 'object') {
    return JSON.stringify({ invalid: 'getVocabularyRecord() did not return an object' });
  }
  if (record.version !== 1) {
    return JSON.stringify({ skew: String(record.version) });
  }
  const keyframes = Array.isArray(record.keyframes) ? record.keyframes : [];
  const collisions = Array.isArray(record.collisions) ? record.collisions : [];
  return JSON.stringify({
    keyframeCount: keyframes.length,
    keyframes: Object.fromEntries(keyframes.map((entry) => [entry.name, entry.frames])),
    collisions,
  });
})()"#;
    let _ = ctx.globals().set("__sys_ref", system_obj.clone());
    let result = ctx.eval::<String, _>(script.as_bytes());
    let _ = ctx.globals().remove("__sys_ref");
    let json =
        result.map_err(|e| format!("getVocabularyRecord() evaluation failed: {}", e))?;
    let parsed: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| format!("vocabulary record serialization failed: {}", e))?;

    if let Some(skew) = parsed.get("skew").and_then(|v| v.as_str()) {
        return Err(format!(
            "system vocabulary record version {} is not supported by this loader \
             (expected 1) — the system was built by a mismatched @animus-ui/system; \
             rebuild against a matching version instead of loading with empty \
             collections",
            skew
        ));
    }
    if let Some(invalid) = parsed.get("invalid").and_then(|v| v.as_str()) {
        return Err(format!("system vocabulary record invalid: {}", invalid));
    }

    let count = parsed
        .get("keyframeCount")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let keyframes_blocks = if count == 0 {
        None
    } else {
        parsed
            .get("keyframes")
            .map(|v| serde_json::to_string(v).unwrap_or_default())
    };
    let vocabulary_collisions = match parsed.get("collisions").and_then(|v| v.as_array()) {
        Some(list) if !list.is_empty() => {
            Some(serde_json::to_string(list).unwrap_or_default())
        }
        _ => None,
    };
    Ok((keyframes_blocks, vocabulary_collisions))
}

/// List all export keys from a module namespace.
fn list_export_keys(namespace: &Object<'_>) -> Vec<String> {
    let mut keys = Vec::new();
    for key in namespace.keys::<String>().flatten() {
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
                    // Wrapped form: selector map plus the block's typed
                    // font-face descriptors (global-styles-system). The
                    // extractor renders fontFaces ahead of selector rules.
                    let script = format!(
                        "JSON.stringify({{styles: globalThis.__ns_ref[\"{key}\"].styles, fontFaces: globalThis.__ns_ref[\"{key}\"].fontFaces || []}})"
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

/// Extract Keyframes collection exports (objects with `__brand === 'Keyframes'`).
///
/// Each collection carries `__frames: { keyName: { name, frames } }` — the raw
/// payload the extractor needs to both emit `@keyframes <name>` blocks and
/// resolve `motion.ember`-style member-expression references in component
/// styles. The returned JSON preserves this nested shape: `{ exportName:
/// { keyName: { name, frames } } }`, keyed by the collection's export name.
fn extract_keyframes_blocks(namespace: &Object<'_>) -> Option<String> {
    let keys = list_export_keys(namespace);
    let mut blocks: HashMap<String, serde_json::Value> = HashMap::new();
    let ctx = namespace.ctx().clone();

    for key in &keys {
        if let Ok(obj) = namespace.get::<_, Object>(key.as_str()) {
            if let Ok(brand) = obj.get::<_, String>("__brand") {
                if brand == "Keyframes" {
                    // Serialize the full `__frames` record via JSON.stringify.
                    // Yields `{ keyName: { name, frames } }` per collection.
                    let script =
                        format!("JSON.stringify(globalThis.__ns_ref[\"{}\"].__frames)", key);
                    let _ = ctx.globals().set("__ns_ref", namespace.clone());
                    if let Ok(json_str) = ctx.eval::<String, _>(script.as_bytes()) {
                        let _ = ctx.globals().remove("__ns_ref");
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_str) {
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

/// Scan a module entry for named `Keyframes` collection exports WITHOUT
/// extracting any system configuration. External package entries contribute
/// keyframes only — the consumer's configured system stays the singular
/// authority for themes, scales, selectors, conditions, and props
/// (openspec: external-package-file-discovery carve-out). Same
/// read → strip → resolve → bundle → eval pipeline as a system load; the
/// namespace walk reads nothing but `__brand === 'Keyframes'` exports.
/// Returns the `{ exportName: { keyName: { name, frames } } }` JSON shape.
pub fn scan_keyframes_exports(
    entry_path: &str,
    root_dir: &str,
) -> Result<Option<String>, String> {
    let (specifier_map, source_map, stub_exports) = resolve_all_deps(entry_path, root_dir)?;

    let entry_canon = fs::canonicalize(entry_path)
        .map_err(|e| format!("failed to canonicalize '{}': {}", entry_path, e))?
        .to_string_lossy()
        .to_string();

    let (bundle, layout) = build_bundle(&specifier_map, &source_map, &stub_exports, &entry_canon)?;

    let runtime = Runtime::new().map_err(|e| format!("rquickjs Runtime::new failed: {}", e))?;
    let context =
        Context::full(&runtime).map_err(|e| format!("rquickjs Context::full failed: {}", e))?;

    context.with(|ctx| {
        ctx.eval::<(), _>(bundle.as_bytes())
            .map_err(|e| describe_eval_failure(&ctx, &layout, &e))?;

        let access_script = format!("__modules['{}']", js_quoted(&entry_canon));
        let namespace: Object = ctx
            .eval(access_script.as_bytes())
            .map_err(|e| format!("failed to access entry module exports: {}", e))?;

        Ok(extract_keyframes_blocks(&namespace))
    })
}

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

    let (bundle, layout) = build_bundle(&specifier_map, &source_map, &stub_exports, &entry_path)?;
    let mut config = execute_bundle(&bundle, &layout, &entry_path, export_name)?;

    // Every module evaluated for this system (entry included, stubs excluded):
    // the invalidation set for HMR classification. Sorted for deterministic
    // output.
    let mut dependencies: Vec<String> = source_map.keys().cloned().collect();
    dependencies.sort();
    config.dependencies = dependencies;

    Ok(config)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace_root() -> PathBuf {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = manifest
            .ancestors()
            .nth(4)
            .expect("system-loader crate must remain under packages/extract/crates/<name>")
            .to_path_buf();
        assert!(
            root.join("packages/showcase/src").is_dir(),
            "computed workspace root is invalid: {}",
            root.display()
        );
        root
    }

    fn built_artifact_available(path: &Path, label: &str) -> bool {
        if path.is_file() {
            true
        } else {
            eprintln!("skipping {label}: {} is not built", path.display());
            false
        }
    }

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

    /// Evaluate a generated bundle in a bare rquickjs context — the same engine
    /// setup `execute_bundle` uses, minus the SystemConfig extraction.
    fn eval_bundle(bundle: &str) -> Result<(), String> {
        let runtime = Runtime::new().expect("rquickjs runtime");
        let context = Context::full(&runtime).expect("rquickjs context");
        context.with(|ctx| {
            ctx.eval::<(), _>(bundle.as_bytes())
                .map_err(|e| describe_eval_failure(&ctx, &BundleLayout::default(), &e))
        })
    }

    fn single_module(path: &str, source: &str) -> HashMap<String, String> {
        HashMap::from([(path.to_string(), source.to_string())])
    }

    #[test]
    fn import_rewrite_preserves_existing_output_matrix() {
        // Only the enumerated runtime packages reach the stub path now; every
        // other bare specifier resolves in `resolve_all_deps` or fails the load.
        let stub_map = HashMap::new();

        assert_eq!(
            rewrite_module_for_bundle("import 'react';", "/entry.ts", &stub_map).unwrap(),
            "__require('__stub__/react')"
        );
        assert_eq!(
            rewrite_module_for_bundle("import {} from 'react';", "/entry.ts", &stub_map,).unwrap(),
            "__require('__stub__/react')"
        );
        assert_eq!(
            rewrite_module_for_bundle(
                "import { same, source as local } from 'react-dom';",
                "/entry.ts",
                &stub_map,
            )
            .unwrap(),
            "const { same, source: local } = __require('__stub__/react-dom')"
        );
        assert_eq!(
            rewrite_module_for_bundle(
                "import Default, { same, source as local } from 'react';",
                "/entry.ts",
                &stub_map,
            )
            .unwrap(),
            "const Default = __require('__stub__/react').default;\nconst { same, source: local } = __require('__stub__/react')"
        );
        assert_eq!(
            rewrite_module_for_bundle(
                "import * as namespace from 'react/jsx-runtime';",
                "/entry.ts",
                &stub_map,
            )
            .unwrap(),
            "const namespace = __require('__stub__/react/jsx-runtime')"
        );
        assert_eq!(
            rewrite_module_for_bundle(
                "import Default, * as namespace from 'react';",
                "/entry.ts",
                &stub_map,
            )
            .unwrap(),
            "const namespace = __require('__stub__/react')"
        );

        let resolved_map = HashMap::from([(
            ("/entry.ts".to_string(), "pkg".to_string()),
            "/canonical/pkg.ts".to_string(),
        )]);
        assert_eq!(
            rewrite_module_for_bundle("import { same } from 'pkg';", "/entry.ts", &resolved_map,)
                .unwrap(),
            "const { same } = __require('/canonical/pkg.ts')"
        );
    }

    #[test]
    fn runtime_stub_list_matches_exactly_not_by_prefix() {
        for specifier in [
            "react",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
            "react-dom",
        ] {
            assert!(
                is_runtime_stub_specifier(specifier),
                "{specifier} must be stubbed"
            );
        }
        for specifier in [
            "react-router",
            "react-dom/client",
            "reactive",
            "@animus-ui/system",
            "preact",
        ] {
            assert!(
                !is_runtime_stub_specifier(specifier),
                "{specifier} must resolve rather than stub"
            );
        }
    }

    #[test]
    fn console_shim_keeps_top_level_logging_from_throwing() {
        let source_map = single_module(
            "/entry.js",
            "console.log('hello');\nconsole.warn('warned');\nconsole.error('erred');\n",
        );
        let (bundle, _) =
            build_bundle(&HashMap::new(), &source_map, &HashMap::new(), "/entry.js").unwrap();

        assert!(bundle.starts_with("globalThis.console"));
        eval_bundle(&bundle).expect("top-level console calls must not abort the bundle");
    }

    #[test]
    fn aliased_stub_import_binds_the_noop() {
        // `extract_import_specifiers` must report the IMPORTED name so the stub
        // and the `{ imported: local }` destructure agree.
        let infos =
            extract_import_specifiers("import { space as dsSpace } from 'react';", "/entry.ts");
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0].specifier, "react");
        assert_eq!(infos[0].names, vec!["space".to_string()]);

        let stub_exports =
            HashMap::from([(stub_key("react"), HashSet::from(["space".to_string()]))]);
        let source_map = single_module(
            "/entry.js",
            "import { space as dsSpace } from 'react';\nconst applied = dsSpace();\n",
        );
        let (bundle, _) =
            build_bundle(&HashMap::new(), &source_map, &stub_exports, "/entry.js").unwrap();

        assert!(bundle.contains("__exports['space'] = noop;"), "{bundle}");
        assert!(
            bundle.contains("const { space: dsSpace } = __require('__stub__/react')"),
            "{bundle}"
        );
        eval_bundle(&bundle).expect("aliased stub import must bind a callable noop");
    }

    #[test]
    fn re_export_from_stub_registers_the_source_name() {
        let infos = extract_import_specifiers(
            "export { space as dsSpace } from 'react';\nexport * from 'react-dom';",
            "/entry.ts",
        );
        assert_eq!(infos.len(), 2);
        assert_eq!(infos[0].specifier, "react");
        assert_eq!(infos[0].names, vec!["space".to_string()]);
        assert_eq!(infos[1].specifier, "react-dom");
        assert!(infos[1].names.is_empty());

        let stub_exports = HashMap::from([
            (stub_key("react"), HashSet::from(["space".to_string()])),
            (stub_key("react-dom"), HashSet::new()),
        ]);
        let source_map = single_module(
            "/entry.js",
            "export { space as dsSpace } from 'react';\nexport * from 'react-dom';\n",
        );
        let (bundle, _) =
            build_bundle(&HashMap::new(), &source_map, &stub_exports, "/entry.js").unwrap();

        assert!(
            bundle.contains("__exports['dsSpace'] = __require('__stub__/react')['space']"),
            "{bundle}"
        );
        eval_bundle(&bundle).expect("re-export from a stub must not read a property of undefined");
    }

    #[test]
    fn export_star_never_assigns_undefined() {
        // No stub registered at all — the registry lookup yields `undefined`.
        let source_map = single_module("/entry.js", "export * from 'react';\n");
        let (bundle, _) =
            build_bundle(&HashMap::new(), &source_map, &HashMap::new(), "/entry.js").unwrap();

        assert!(
            bundle.contains("Object.assign(__exports, __require('__stub__/react') || {})"),
            "{bundle}"
        );
        eval_bundle(&bundle).expect("`export *` from an unregistered module must not throw");
    }

    #[test]
    fn export_star_as_namespace_binds_the_name() {
        // Resolved module: the namespace object is the whole module's exports.
        let resolved_map = HashMap::from([(
            ("/entry.ts".to_string(), "pkg".to_string()),
            "/canonical/pkg.ts".to_string(),
        )]);
        assert_eq!(
            rewrite_module_for_bundle("export * as ns from 'pkg';", "/entry.ts", &resolved_map)
                .unwrap(),
            "__exports['ns'] = __require('/canonical/pkg.ts') || {}"
        );

        // Stub module: the namespace binds the stub's exports object, and the
        // bare `export *` spread form is unaffected.
        let stub_exports =
            HashMap::from([(stub_key("react"), HashSet::from(["space".to_string()]))]);
        let source_map = single_module("/entry.js", "export * as R from 'react';\n");
        let (bundle, _) =
            build_bundle(&HashMap::new(), &source_map, &stub_exports, "/entry.js").unwrap();
        assert!(
            bundle.contains("__exports['R'] = __require('__stub__/react') || {}"),
            "{bundle}"
        );
        assert!(
            !bundle.contains("Object.assign(__exports, __require('__stub__/react')"),
            "namespace form must not spread into __exports: {bundle}"
        );
        eval_bundle(&bundle).expect("`export * as ns` from a stub must bind an object");
    }

    #[test]
    fn module_paths_with_quotes_stay_valid_js() {
        // A checkout under a directory whose name contains an apostrophe (or a
        // backslash — both are legal path bytes on macOS/Linux) reaches the
        // bundler as a canonical path that is interpolated into single-quoted JS
        // string literals. Unescaped, `__require('…Bob's…')` terminates the
        // literal early and the WHOLE system load dies with a QuickJS syntax
        // error that names nothing recognizable.
        let dir = "/Users/dev/Bob's \\ Projects";
        let dep = format!("{}/dep.js", dir);
        let entry = format!("{}/entry.js", dir);

        let specifier_map = HashMap::from([((entry.clone(), "./dep.js".to_string()), dep.clone())]);
        let source_map = HashMap::from([
            (dep.clone(), "export const v = 1;\n".to_string()),
            (
                entry.clone(),
                "import { v } from './dep.js';\nif (v !== 1) throw new Error('require key did not match the registry key');\n"
                    .to_string(),
            ),
        ]);

        let (bundle, _) =
            build_bundle(&specifier_map, &source_map, &HashMap::new(), &entry).unwrap();

        // Registration and lookup must escape IDENTICALLY, or the require finds
        // no module and the destructure throws on undefined.
        eval_bundle(&bundle).expect("a quoted module path must produce an evaluable bundle");
    }

    #[test]
    fn stub_specifiers_with_quotes_stay_valid_js() {
        // `import x from "it's-a-module"` is legal TS; an unresolved specifier
        // becomes a stub key that is registered AND required as a JS literal.
        let stub_exports = HashMap::from([(stub_key("it's-a-module"), HashSet::new())]);
        let source_map = single_module("/entry.js", "import x from \"it's-a-module\";\n");
        let (bundle, _) =
            build_bundle(&HashMap::new(), &source_map, &stub_exports, "/entry.js").unwrap();

        eval_bundle(&bundle).expect("a quoted stub specifier must produce an evaluable bundle");
    }

    #[test]
    fn arbitrary_module_namespace_names_stay_valid_js() {
        // ES2022 allows any string as an export name. It reaches the same
        // single-quoted literal the module keys do.
        let source_map = single_module("/entry.js", "const v = 1;\nexport { v as \"it's\" };\n");
        let (bundle, _) =
            build_bundle(&HashMap::new(), &source_map, &HashMap::new(), "/entry.js").unwrap();

        eval_bundle(&bundle).expect("a quoted export name must produce an evaluable bundle");
    }

    #[test]
    fn bundle_output_is_stable_across_equal_inputs() {
        let names_react = HashSet::from(["useMemo".to_string(), "createElement".to_string()]);
        let names_dom = HashSet::from(["render".to_string()]);
        let names_jsx = HashSet::from(["jsx".to_string()]);

        // Two maps with identical content but different insertion orders — each
        // HashMap instance gets its own hasher, so iteration order differs.
        let mut first_stubs = HashMap::new();
        first_stubs.insert(stub_key("react"), names_react.clone());
        first_stubs.insert(stub_key("react-dom"), names_dom.clone());
        first_stubs.insert(stub_key("react/jsx-runtime"), names_jsx.clone());

        let mut second_stubs = HashMap::new();
        second_stubs.insert(stub_key("react/jsx-runtime"), names_jsx);
        second_stubs.insert(stub_key("react-dom"), names_dom);
        second_stubs.insert(stub_key("react"), names_react);

        let source_map = single_module("/entry.js", "const value = 1;\n");
        let (first, layout) =
            build_bundle(&HashMap::new(), &source_map, &first_stubs, "/entry.js").unwrap();
        let (second, _) =
            build_bundle(&HashMap::new(), &source_map, &second_stubs, "/entry.js").unwrap();

        assert_eq!(first, second, "stub emission must not depend on map order");
        assert_eq!(
            layout.stub_specifiers,
            vec!["react", "react-dom", "react/jsx-runtime"]
        );
        // Export names inside a stub are sorted too.
        assert!(
            first.find("__exports['createElement']").unwrap()
                < first.find("__exports['useMemo']").unwrap(),
            "{first}"
        );
    }

    #[test]
    fn eval_failure_names_owning_module_and_stub_list() {
        let source_map = HashMap::from([
            ("/a.js".to_string(), "const first = 1;\n".to_string()),
            (
                "/b.js".to_string(),
                "const before = 1;\nmissingFunction();\n".to_string(),
            ),
        ]);
        // Force /a.js ahead of /b.js so the failure lands in the second module.
        let specifier_map = HashMap::from([(
            ("/b.js".to_string(), "./a.js".to_string()),
            "/a.js".to_string(),
        )]);
        let stub_exports = HashMap::from([(stub_key("react"), HashSet::new())]);

        let (bundle, layout) =
            build_bundle(&specifier_map, &source_map, &stub_exports, "/b.js").unwrap();
        let error = execute_bundle(&bundle, &layout, "/b.js", None)
            .expect_err("a throwing bundle must fail the load");

        assert!(error.starts_with("bundle eval failed:"), "{error}");
        assert!(error.contains("in module '/b.js'"), "{error}");
        assert!(error.contains("stubbed specifiers: [react]"), "{error}");
    }

    #[test]
    fn bundle_line_from_stack_reads_quickjs_frames() {
        assert_eq!(
            bundle_line_from_stack("    at <eval> (eval_script:42)\n"),
            Some(42)
        );
        assert_eq!(
            bundle_line_from_stack(
                "    at fn (eval_script:7:15)\n    at <eval> (eval_script:99)\n"
            ),
            Some(7)
        );
        assert_eq!(bundle_line_from_stack("    at native\n"), None);
    }

    /// Temp scratch directory scoped to a single test.
    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "animus-system-loader-{}-{}",
            std::process::id(),
            label
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    fn write_fixture(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create fixture parent");
        }
        fs::write(path, contents).expect("write fixture");
    }

    #[test]
    fn scan_keyframes_exports_reads_only_branded_collections() {
        let dir = scratch_dir("kf-scan");
        let entry = dir.join("index.ts");
        write_fixture(
            &entry,
            "export const motion = { __brand: 'Keyframes', __frames: { pulse: { name: 'animus-kf-testhash', frames: { from: { opacity: 0.4 }, to: { opacity: 1 } } } } };\n\
             export const notKeyframes = { __brand: 'Other', __frames: {} };\n\
             export const plain = 42;\n",
        );

        let result = scan_keyframes_exports(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let json = result
            .expect("scan must succeed")
            .expect("a Keyframes export must be discovered");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        let obj = parsed.as_object().unwrap();
        assert_eq!(obj.len(), 1, "{json}");
        assert_eq!(
            parsed["motion"]["pulse"]["name"],
            serde_json::Value::String("animus-kf-testhash".into())
        );
        assert!(parsed["motion"]["pulse"]["frames"]["from"].is_object());
    }

    #[test]
    fn scan_keyframes_exports_degrades_to_error_not_panic() {
        let dir = scratch_dir("kf-scan-broken");
        let entry = dir.join("index.ts");
        write_fixture(&entry, "throw new Error('entry refuses to evaluate');\n");

        let result = scan_keyframes_exports(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("a throwing entry must surface as Err");
        assert!(
            error.contains("refuses to evaluate") || error.contains("eval"),
            "error must describe the evaluation failure: {error}"
        );
    }

    #[test]
    fn scan_keyframes_exports_none_when_no_collections() {
        let dir = scratch_dir("kf-scan-empty");
        let entry = dir.join("index.ts");
        write_fixture(&entry, "export const plain = { value: 1 };\n");

        let result = scan_keyframes_exports(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        assert_eq!(result.expect("scan must succeed"), None);
    }

    // ── vocabulary-registration: seam-1 record consumption ──────────────────

    const FIXTURE_THEME: &str = "export const theme = { serialize: () => ({\n\
         scalesJson: '{}', variableMapJson: '{}', variableCss: '',\n\
         contextualVarsJson: '{}' }) };\n";

    fn sealed_system_fixture(record_literal: &str) -> String {
        format!(
            "export const ds = {{\n\
               toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}),\n\
               getVocabularyRecord: () => ({record_literal}),\n\
             }};\n\
             {FIXTURE_THEME}"
        )
    }

    const TWO_COLLECTION_RECORD: &str = "{\n\
        version: 1,\n\
        keyframes: [\n\
          { name: 'first', frames: { pulse: { name: 'animus-kf-aaa', frames: { from: { opacity: 0 } } } } },\n\
          { name: 'second', frames: { fade: { name: 'animus-kf-bbb', frames: { to: { opacity: 1 } } } } },\n\
        ],\n\
        globalStyles: [],\n\
        collisions: [],\n\
      }";

    #[test]
    fn sealed_record_carries_collections_declaration_ordered() {
        // rust-system-loader §"Collections come from the sealed registration
        // record": registration order reaches the serialized wire.
        let dir = scratch_dir("vocab-record-order");
        let entry = dir.join("entry.ts");
        write_fixture(&entry, &sealed_system_fixture(TWO_COLLECTION_RECORD));

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("sealed system must load");
        let blocks = config
            .keyframes_blocks
            .expect("registered collections must carry");
        let first_at = blocks.find("\"first\"").expect("first present");
        let second_at = blocks.find("\"second\"").expect("second present");
        assert!(
            first_at < second_at,
            "registration order must reach the wire: {blocks}"
        );
        let parsed: serde_json::Value = serde_json::from_str(&blocks).expect("valid JSON");
        assert_eq!(
            parsed["first"]["pulse"]["name"], "animus-kf-aaa",
            "wire keeps the {{ exportName: {{ keyName: {{ name, frames }} }} }} shape"
        );
    }

    #[test]
    fn exported_but_unregistered_collection_does_not_carry() {
        // The hard-cut negative: a branded export absent from the record is
        // invisible to the loader.
        let dir = scratch_dir("vocab-unregistered");
        let entry = dir.join("entry.ts");
        let mut source = sealed_system_fixture(TWO_COLLECTION_RECORD);
        source.push_str(
            "export const motion = { __brand: 'Keyframes', __frames: { spin: { name: 'animus-kf-ccc', frames: {} } } };\n",
        );
        write_fixture(&entry, &source);

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("sealed system must load");
        let blocks = config.keyframes_blocks.expect("registered ones carry");
        assert!(
            !blocks.contains("motion") && !blocks.contains("animus-kf-ccc"),
            "unregistered export must not carry: {blocks}"
        );
    }

    #[test]
    fn wrong_record_version_fails_the_load() {
        // rust-system-loader §"Registration-record version skew fails the
        // load" — the half that has no fallback: a PRESENT record with an
        // incompatible marker. (Record ABSENCE falls back to the export scan
        // until the migration increment deletes the scan.)
        let dir = scratch_dir("vocab-version-skew");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &sealed_system_fixture(
                "{ version: 99, keyframes: [], globalStyles: [], collisions: [] }",
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("incompatible record version must fail loud");
        assert!(
            error.contains("version") && error.contains("99"),
            "error must name the version mismatch: {error}"
        );
    }

    #[test]
    fn ambiguous_system_like_exports_fail_the_load() {
        // rust-system-loader §"Ambiguous system-like exports fail the load":
        // two DISTINCT toConfig-bearing exports and no explicit exportName.
        let dir = scratch_dir("vocab-ambiguous");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &format!(
                "export const ds = {{ toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}) }};\n\
                 export const dsTwo = {{ toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}) }};\n\
                 {FIXTURE_THEME}"
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("two distinct system-like exports must fail loud");
        assert!(
            error.contains("ds") && error.contains("dsTwo"),
            "error must name both exports: {error}"
        );
    }

    #[test]
    fn aliased_reexport_of_one_system_is_not_ambiguous() {
        let dir = scratch_dir("vocab-alias");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &format!(
                "export const ds = {{ toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}) }};\n\
                 export const dsAlias = ds;\n\
                 {FIXTURE_THEME}"
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        result.expect("aliases of ONE instance stay unambiguous");
    }

    #[test]
    fn record_wire_is_byte_identical_across_fresh_loads() {
        // rust-system-loader §"Collections come from the sealed registration
        // record" (determinism scenario): two full loads, two runtimes,
        // identical bytes.
        let dir = scratch_dir("vocab-determinism");
        let entry = dir.join("entry.ts");
        write_fixture(&entry, &sealed_system_fixture(TWO_COLLECTION_RECORD));

        let first = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None)
            .expect("first load");
        let second = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None)
            .expect("second load");
        let _ = fs::remove_dir_all(&dir);

        assert_eq!(
            first.keyframes_blocks, second.keyframes_blocks,
            "fresh-process loads must serialize identical collection bytes"
        );
        assert!(first.keyframes_blocks.is_some());
    }

    #[test]
    fn record_collisions_carry_to_the_config() {
        // The record, not console, is the witness channel (the evaluation
        // host shims console to a no-op).
        let dir = scratch_dir("vocab-collisions");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &sealed_system_fixture(
                "{ version: 1, keyframes: [], globalStyles: [], collisions: [\n\
                   { code: 'animus.vocabulary.collision', name: 'motion',\n\
                     winner: 'local registration #1', loser: 'extended source #1' },\n\
                 ] }",
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("sealed system must load");
        let collisions = config
            .vocabulary_collisions
            .expect("collision entries must carry");
        assert!(
            collisions.contains("animus.vocabulary.collision")
                && collisions.contains("motion")
                && collisions.contains("extended source #1"),
            "collision witness must survive verbatim: {collisions}"
        );
    }

    #[test]
    fn recordless_system_falls_back_to_export_scan_until_migration() {
        // STAGING PIN (design Ledger DEF-11 class; deleted at the migration
        // increment): a system without a vocabulary record keeps export-scan
        // discovery so un-migrated fixtures stay green. The migration
        // increment replaces this with the loud version-skew error — this
        // test must be DELETED in the same diff.
        let dir = scratch_dir("vocab-fallback");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &format!(
                "export const ds = {{ toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}) }};\n\
                 export const motion = {{ __brand: 'Keyframes', __frames: {{ spin: {{ name: 'animus-kf-ddd', frames: {{}} }} }} }};\n\
                 {FIXTURE_THEME}"
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("recordless system must still load");
        let blocks = config
            .keyframes_blocks
            .expect("legacy export scan still discovers");
        assert!(blocks.contains("animus-kf-ddd"));
    }

    #[test]
    fn unresolved_bare_specifier_fails_closed() {
        let dir = scratch_dir("unresolved");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import { thing } from '@animus-test/definitely-not-installed';\n\
             export const value = thing;\n",
        );

        let result = resolve_all_deps(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("an unresolvable bare specifier must fail the load");
        assert!(
            error.contains("@animus-test/definitely-not-installed"),
            "error must name the specifier: {error}"
        );
        assert!(
            error.contains("entry.ts"),
            "error must name the importing module: {error}"
        );
        assert!(
            error.contains("runtime stub list"),
            "error must point at the stub-list escape hatch: {error}"
        );
    }

    #[test]
    fn dependency_set_covers_the_transitive_graph_sorted() {
        let dir = scratch_dir("dep-set");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import { makeTheme } from './theme';\n\
             export const theme = makeTheme();\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );
        write_fixture(
            &dir.join("theme.ts"),
            "import { base } from './tokens/base';\n\
             export const makeTheme = () => ({\n\
               serialize: () => ({\n\
                 scalesJson: JSON.stringify(base),\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             });\n",
        );
        write_fixture(
            &dir.join("tokens/base.ts"),
            "export const base = { color: 'red' };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);

        let canonical_dir = fs::canonicalize(&dir).expect("canonicalize scratch dir");
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("system with relative deps must load");
        let expect = |name: &str| canonical_dir.join(name).to_string_lossy().to_string();
        let mut expected = vec![
            expect("entry.ts"),
            expect("theme.ts"),
            expect("tokens/base.ts"),
        ];
        expected.sort();
        assert_eq!(
            config.dependencies, expected,
            "dependencies must be the sorted canonical transitive module set"
        );
    }

    #[test]
    fn source_theme_manifests_capture_built_theme_token_paths() {
        // extraction-diagnostics (cross-source correlation): a built theme
        // exported by ANY module in the already-evaluated graph contributes
        // all tokenMap paths, including non-emitted scales, keyed by canonical
        // module path.
        let dir = scratch_dir("theme-manifests");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import { kitTokens } from './kit/index';\n\
             export const kitRef = kitTokens;\n\
             export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );
        write_fixture(
            &dir.join("kit/index.ts"),
            "export const kitTokens = {\n\
               colors: { externalAccent: '#f0f' },\n\
               manifest: {\n\
                 tokenMap: { 'space.externalGap': '1rem' },\n\
                 variableMap: {},\n\
               },\n\
             };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);

        let canonical_dir = fs::canonicalize(&dir).expect("canonicalize scratch dir");
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("system with a kit theme in the graph must load");
        let manifests = config
            .source_theme_manifests
            .expect("built-theme export must be captured");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifests).expect("manifests JSON parses");
        let kit_path = canonical_dir
            .join("kit/index.ts")
            .to_string_lossy()
            .to_string();
        assert_eq!(
            parsed[&kit_path]["kitTokens"],
            serde_json::json!(["space.externalGap"]),
            "kit module must contribute its token paths: {parsed}"
        );
    }

    #[test]
    fn source_theme_manifests_capture_bundle_only_exports() {
        // A kit whose ONLY export is the library bundle (`{ system, tokens }`)
        // carries its built theme at `bundle.tokens.manifest` — the capture
        // must probe the tokens half (bundle recognized exactly as the
        // builders do: `system.toConfig` callable) or the correlation
        // diagnostic silently loses its source-token witness.
        let dir = scratch_dir("bundle-theme-manifests");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import { kit } from './kit/index';\n\
             export const kitRef = kit;\n\
             export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );
        write_fixture(
            &dir.join("kit/index.ts"),
            "export const kit = {\n\
               system: { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) },\n\
               tokens: {\n\
                 colors: { externalAccent: '#f0f' },\n\
                 manifest: { variableMap: { 'colors.externalAccent': '--color-external-accent' } },\n\
               },\n\
             };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);

        let canonical_dir = fs::canonicalize(&dir).expect("canonicalize scratch dir");
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("system with a bundle-only kit must load");
        let manifests = config
            .source_theme_manifests
            .expect("bundle tokens half must be captured");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifests).expect("manifests JSON parses");
        let kit_path = canonical_dir
            .join("kit/index.ts")
            .to_string_lossy()
            .to_string();
        assert_eq!(
            parsed[&kit_path]["kit"],
            serde_json::json!(["colors.externalAccent"]),
            "bundle export must contribute its tokens half's paths: {parsed}"
        );
    }

    #[test]
    fn source_theme_manifests_capture_bundle_theme_spelling() {
        // first-class-extension (D9/D11): the canonical library bundle is
        // `{ system, theme }` (`tokens` is the legacy spelling). A kit whose
        // only export is a theme-spelled bundle must still contribute its
        // source-token witness or cross-source correlation silently degrades.
        let dir = scratch_dir("bundle-theme-spelling");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import { kit } from './kit/index';\n\
             export const kitRef = kit;\n\
             export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );
        write_fixture(
            &dir.join("kit/index.ts"),
            "export const kit = {\n\
               system: { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) },\n\
               theme: {\n\
                 colors: { externalAccent: '#f0f' },\n\
                 manifest: { variableMap: { 'colors.externalAccent': '--color-external-accent' } },\n\
               },\n\
             };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);

        let canonical_dir = fs::canonicalize(&dir).expect("canonicalize scratch dir");
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("system with a theme-spelled bundle kit must load");
        let manifests = config
            .source_theme_manifests
            .expect("bundle theme half must be captured");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifests).expect("manifests JSON parses");
        let kit_path = canonical_dir
            .join("kit/index.ts")
            .to_string_lossy()
            .to_string();
        assert_eq!(
            parsed[&kit_path]["kit"],
            serde_json::json!(["colors.externalAccent"]),
            "theme-spelled bundle must contribute its theme half's paths: {parsed}"
        );
    }

    #[test]
    fn asset_placeholder_survives_the_loader_round_trip() {
        // standardize-inheritance-and-assets (rust-system-loader delta): an
        // `asset()` placeholder inside a global style block's fontFaces
        // serializes through evaluation with its specifier bytes intact and
        // WITHOUT any resolution attempt — the scratch dir contains no such
        // file, and the load must not care.
        let dir = scratch_dir("asset-placeholder");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "const asset = (specifier: string) => 'animus-asset:' + specifier;\n\
             export const globals = {\n\
               __brand: 'GlobalStyleBlock',\n\
               styles: { body: { margin: 0 } },\n\
               fontFaces: [{\n\
                 family: 'Inter',\n\
                 src: [{ url: asset('@acme/tokens/fonts/inter.woff2'), format: 'woff2' }],\n\
               }],\n\
             };\n\
             export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("system with an asset placeholder must load");
        let blocks = config
            .global_style_blocks
            .expect("global style block captured");
        assert!(
            blocks.contains("animus-asset:@acme/tokens/fonts/inter.woff2"),
            "placeholder must survive serialization verbatim: {blocks}"
        );
    }

    #[test]
    fn source_theme_manifests_absent_without_built_theme_exports() {
        let dir = scratch_dir("no-theme-manifests");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("plain system must load");
        assert!(
            config.source_theme_manifests.is_none(),
            "no built-theme export → no captured manifests"
        );
    }

    #[test]
    fn theme_export_preferred_over_unrelated_tokens() {
        // rust-system-loader: 'theme' is the
        // preferred export name; an unrelated 'tokens' value that is not a
        // built theme must not shadow it.
        let dir = scratch_dir("theme-preferred");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const theme = {\n\
               serialize: () => ({\n\
                 scalesJson: '{\"winner\":\"theme\"}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const tokens = { color: 'red' };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("'theme' beside a non-theme 'tokens' must load");
        assert!(
            config.scales_json.contains("\"winner\":\"theme\""),
            "the 'theme' export must be the serialized one: {}",
            config.scales_json
        );
    }

    #[test]
    fn tokens_only_export_stays_supported() {
        // rust-system-loader: 'tokens' stays fully supported when no
        // 'theme' export exists — the fallback carries no deprecation failure.
        let dir = scratch_dir("tokens-fallback");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{\"winner\":\"tokens\"}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("a tokens-only system must load");
        assert!(
            config.scales_json.contains("\"winner\":\"tokens\""),
            "the 'tokens' export must be the serialized one: {}",
            config.scales_json
        );
    }

    #[test]
    fn built_tokens_export_wins_when_theme_is_unrelated() {
        let dir = scratch_dir("tokens-beside-unrelated-theme");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const theme = { color: 'red' };\n\
             export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{\"winner\":\"tokens\"}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("built tokens beside unrelated theme must load");
        assert!(
            config.scales_json.contains("\"winner\":\"tokens\""),
            "the built tokens export must be serialized: {}",
            config.scales_json
        );
    }

    #[test]
    fn un_built_theme_export_fails_naming_the_forgotten_build() {
        // A ThemeBuilder mistakenly exported without its trailing .build():
        // callable build/addScale, no serialize. The load must DIAGNOSE the
        // near-miss, not claim no export exists.
        let dir = scratch_dir("theme-unbuilt");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const theme = {\n\
               build: () => ({}),\n\
               addScale: () => ({}),\n\
               addColors: () => ({}),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let err = result.expect_err("an un-built 'theme' export must fail the load");
        assert!(
            err.contains(".build()") && err.contains("'theme'"),
            "error must name the export and the forgotten .build(): {}",
            err
        );
    }

    #[test]
    fn un_built_theme_export_never_falls_back_to_stale_tokens() {
        // The migration-window hazard: `theme` is canonical, and an author
        // editing it without .build() must not have the extractor silently
        // use a legacy `tokens` export they did not touch.
        let dir = scratch_dir("theme-unbuilt-stale-tokens");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const theme = {\n\
               build: () => ({}),\n\
               addScale: () => ({}),\n\
             };\n\
             export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{\"winner\":\"STALE_TOKENS\"}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let err =
            result.expect_err("an un-built 'theme' beside built 'tokens' must fail, not fall back");
        assert!(
            err.contains(".build()"),
            "error must point at the forgotten .build(): {}",
            err
        );
    }

    #[test]
    fn un_built_tokens_export_fails_naming_the_forgotten_build() {
        let dir = scratch_dir("tokens-unbuilt");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const tokens = {\n\
               build: () => ({}),\n\
               addScale: () => ({}),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let err = result.expect_err("an un-built 'tokens' export must fail the load");
        assert!(
            err.contains(".build()") && err.contains("'tokens'"),
            "error must name the export and the forgotten .build(): {}",
            err
        );
    }

    #[test]
    fn non_theme_export_error_names_what_was_found() {
        // An unrelated `theme` object with NO tokens fallback: the error must
        // acknowledge the export it saw instead of denying any export exists.
        let dir = scratch_dir("theme-unrelated-no-tokens");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const theme = { color: 'red' };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let err = result.expect_err("an unrelated 'theme' with no fallback must fail the load");
        assert!(
            err.contains("'theme'") && err.contains("serialize"),
            "error must name the export it found and the missing .serialize(): {}",
            err
        );
    }

    #[test]
    fn aliased_theme_and_tokens_export_stays_valid() {
        // Same-object aliasing (`export const tokens = theme`) is not a
        // conflict — identity is judged by reference equality in the QuickJS
        // context, never by comparing serialized output.
        let dir = scratch_dir("theme-alias");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const theme = {\n\
               serialize: () => ({\n\
                 scalesJson: '{}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const tokens = theme;\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        result.expect("aliasing 'tokens' to 'theme' must stay a valid load");
    }

    #[test]
    fn distinct_built_theme_exports_fail_naming_both() {
        // Two distinct built themes in the entry module make the serialized
        // winner ambiguous — the load must fail with a diagnostic naming both
        // exports, even when their serialized output would be identical.
        let dir = scratch_dir("theme-conflict");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const theme = {\n\
               serialize: () => ({\n\
                 scalesJson: '{}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None);
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("two distinct built themes must fail the load");
        assert!(
            error.contains("'theme'") && error.contains("'tokens'"),
            "diagnostic must name both exports: {error}"
        );
        assert!(
            error.contains("built themes"),
            "diagnostic must say what the conflict is: {error}"
        );
    }

    #[test]
    fn asset_query_import_fails_naming_specifier_and_fix() {
        let dir = scratch_dir("asset-query");
        let entry = dir.join("entry.ts");
        fs::write(dir.join("font.woff2"), b"wOF2FAKE").unwrap();
        write_fixture(
            &entry,
            "import fontUrl from './font.woff2?url';\n\
             export const value = fontUrl;\n",
        );

        let result = resolve_all_deps(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("a bundler asset-query import must fail the load");
        assert!(
            error.contains("./font.woff2?url") && error.contains("literal"),
            "error must name the specifier and point at the literal-URL fix: {error}"
        );
        assert!(
            error.contains("asset('<specifier>')"),
            "error must point at the sanctioned asset() form: {error}"
        );
        assert!(
            error.contains("entry.ts"),
            "error must name the importing module: {error}"
        );
    }

    #[test]
    fn binary_asset_import_fails_naming_specifier() {
        let dir = scratch_dir("asset-ext");
        let entry = dir.join("entry.ts");
        fs::write(dir.join("font.woff2"), b"wOF2FAKE").unwrap();
        write_fixture(
            &entry,
            "import fontUrl from './font.woff2';\n\
             export const value = fontUrl;\n",
        );

        let result = resolve_all_deps(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("a binary asset import must fail the load");
        assert!(
            error.contains("./font.woff2"),
            "error must name the specifier: {error}"
        );
    }

    #[test]
    fn node_builtin_import_fails_with_sandbox_reason() {
        let dir = scratch_dir("node-builtin");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import { createHash } from 'node:crypto';\n\
             export const value = createHash;\n",
        );

        let result = resolve_all_deps(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("a Node builtin import must fail the load");
        assert!(
            error.contains("node:crypto") && error.contains("sandbox"),
            "error must name the builtin and the sandbox, not package resolution: {error}"
        );
        assert!(
            error.contains("entry.ts"),
            "error must name the importing module: {error}"
        );
    }

    #[test]
    fn resolvable_bare_specifier_is_crawled_not_stubbed() {
        let dir = scratch_dir("esm-package");
        let pkg = dir.join("node_modules/fake-esm-pkg");
        write_fixture(
            &pkg.join("package.json"),
            "{\n  \"name\": \"fake-esm-pkg\",\n  \"module\": \"index.mjs\"\n}\n",
        );
        write_fixture(&pkg.join("index.mjs"), "export const thing = 42;\n");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import { thing } from 'fake-esm-pkg';\nexport const value = thing;\n",
        );

        let result = resolve_all_deps(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let (specifier_map, source_map, stub_exports) =
            result.expect("a resolvable bare specifier must be crawled");
        assert!(
            stub_exports.is_empty(),
            "non-enumerated packages must never be stubbed: {stub_exports:?}"
        );
        assert!(
            specifier_map.keys().any(|(_, spec)| spec == "fake-esm-pkg"),
            "specifier map must record the resolved package: {specifier_map:?}"
        );
        assert!(
            source_map.keys().any(|path| path.ends_with("index.mjs")),
            "the package source must be loaded: {source_map:?}"
        );
    }

    #[test]
    fn type_only_imports_never_drive_resolution() {
        let infos = extract_import_specifiers(
            "import type { Property } from 'csstype';\n\
             import { type Only } from 'type-fest';\n\
             export type { Thing } from 'types-pkg';\n\
             import 'side-effect';\n\
             import { real, type Erased } from 'runtime-pkg';\n",
            "/entry.ts",
        );

        let specifiers: Vec<&str> = infos.iter().map(|i| i.specifier.as_str()).collect();
        assert_eq!(specifiers, vec!["side-effect", "runtime-pkg"]);
        assert!(infos[0].names.is_empty());
        assert_eq!(infos[1].names, vec!["real".to_string()]);
    }

    #[test]
    fn type_only_import_of_unresolvable_package_is_not_an_error() {
        // A types-only package (csstype and friends) has no runtime entry. Under
        // fail-closed resolution, an erased annotation must not sink the load.
        let dir = scratch_dir("type-only");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import type { Thing } from '@animus-test/types-only';\n\
             export const value: Thing = 1;\n",
        );

        let result = resolve_all_deps(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let (specifier_map, _, stub_exports) =
            result.expect("type-only imports must not participate in resolution");
        assert!(specifier_map.is_empty(), "{specifier_map:?}");
        assert!(stub_exports.is_empty(), "{stub_exports:?}");
    }

    #[test]
    fn commonjs_dependency_fails_closed() {
        let dir = scratch_dir("cjs-package");
        let pkg = dir.join("node_modules/fake-cjs-pkg");
        write_fixture(
            &pkg.join("package.json"),
            "{\n  \"name\": \"fake-cjs-pkg\",\n  \"main\": \"index.js\"\n}\n",
        );
        write_fixture(
            &pkg.join("index.js"),
            "const dep = require('node:path');\nmodule.exports = { thing: 42 };\n",
        );
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import { thing } from 'fake-cjs-pkg';\nexport const value = thing;\n",
        );

        let result = resolve_all_deps(&entry.to_string_lossy(), &dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("a CommonJS dependency must fail the load");
        assert!(
            error.contains("CommonJS module 'fake-cjs-pkg'"),
            "error must name the specifier: {error}"
        );
        assert!(
            error.contains("runtime stub list"),
            "error must point at the stub-list escape hatch: {error}"
        );
    }

    #[test]
    fn esm_module_is_not_mistaken_for_commonjs() {
        // `require(` inside an ESM body (e.g. a lazy dynamic helper) must not
        // trip the guard — the ESM syntax check wins.
        assert!(!looks_like_commonjs(
            "export const load = () => require('x');\n",
            "/pkg/index.mjs"
        ));
        assert!(looks_like_commonjs(
            "module.exports = { thing: 1 };\n",
            "/pkg/index.js"
        ));
        assert!(!looks_like_commonjs("const value = 1;\n", "/pkg/index.js"));
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

    #[test]
    fn resolve_exports_entry_wildcard_subpath_pattern() {
        // Node's `exports` wildcard form, verbatim from `@ark-ui/react` 5.36.2:
        // every component subpath is served by one `"./*"` pattern. Without
        // pattern support the whole package is unresolvable to this loader
        // while Node and Vite resolve it fine.
        let exports: serde_json::Value = serde_json::json!({
            ".": {
                "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
            },
            "./factory": {
                "import": { "types": "./dist/components/factory.d.ts", "default": "./dist/components/factory.js" }
            },
            "./*": {
                "import": { "types": "./dist/components/*/index.d.ts", "default": "./dist/components/*/index.js" }
            },
            "./package.json": "./package.json"
        });

        assert_eq!(
            resolve_exports_entry(&exports, "/field"),
            Some("./dist/components/field/index.js".to_string()),
            "a `./*` pattern must substitute the matched subpath"
        );
        // An exact key still wins over the pattern that would also match it.
        assert_eq!(
            resolve_exports_entry(&exports, "/factory"),
            Some("./dist/components/factory.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "."),
            Some("./dist/index.js".to_string())
        );
    }

    #[test]
    fn resolve_exports_entry_wildcard_longest_prefix_wins() {
        // Node's PATTERN_KEY_COMPARE: the pattern with the longest literal
        // prefix wins, then the longest suffix.
        let exports: serde_json::Value = serde_json::json!({
            "./*": "./dist/*.js",
            "./lib/*": "./dist/lib/*.js",
            "./lib/*.css": "./dist/lib/*.css"
        });

        assert_eq!(
            resolve_exports_entry(&exports, "/thing"),
            Some("./dist/thing.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "/lib/thing"),
            Some("./dist/lib/thing.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "/lib/thing.css"),
            Some("./dist/lib/thing.css".to_string())
        );
    }

    #[test]
    fn resolve_exports_entry_without_pattern_still_falls_through() {
        // No matching key and no pattern → `None`, so `resolve_bare_specifier`
        // keeps falling through to `module`/`main` exactly as before.
        let exports: serde_json::Value = serde_json::json!({
            ".": "./dist/index.js",
            "./groups": "./dist/groups/index.js"
        });
        assert_eq!(resolve_exports_entry(&exports, "/missing"), None);
    }

    #[test]
    fn resolve_bare_specifier_through_wildcard_exports() {
        // The end-to-end resolver over a fixture package.json carrying a
        // `"./*"` exports map: the subpath file on disk must be found.
        let dir = scratch_dir("wildcard-exports");
        let pkg = dir.join("node_modules/@fixture/wildcard-kit");
        write_fixture(
            &pkg.join("package.json"),
            "{\n  \"name\": \"@fixture/wildcard-kit\",\n  \"type\": \"module\",\n  \"main\": \"dist/index.cjs\",\n  \"module\": \"dist/index.js\",\n  \"exports\": {\n    \".\": { \"import\": { \"types\": \"./dist/index.d.ts\", \"default\": \"./dist/index.js\" } },\n    \"./*\": { \"import\": { \"types\": \"./dist/components/*/index.d.ts\", \"default\": \"./dist/components/*/index.js\" } }\n  }\n}\n",
        );
        write_fixture(&pkg.join("dist/index.js"), "export const kit = 1;\n");
        write_fixture(
            &pkg.join("dist/components/field/index.js"),
            "export const Field = 1;\n",
        );
        let from_dir = dir.join("src");
        fs::create_dir_all(&from_dir).expect("create importing dir");

        let resolved =
            resolve_bare_specifier("@fixture/wildcard-kit/field", &from_dir.to_string_lossy());
        let root = resolve_bare_specifier("@fixture/wildcard-kit", &from_dir.to_string_lossy());
        let missing =
            resolve_bare_specifier("@fixture/wildcard-kit/absent", &from_dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);

        let resolved = resolved.expect("a `./*` exports pattern must resolve its subpath");
        assert!(
            resolved.ends_with("dist/components/field/index.js"),
            "unexpected resolution: {resolved}"
        );
        let root = root.expect("the `.` entry must still resolve");
        assert!(root.ends_with("dist/index.js"), "unexpected root: {root}");
        // A pattern that matches but whose substituted target is absent from
        // disk stays unresolvable — the resolver never invents a path.
        let error = missing.expect_err("an absent pattern target must not resolve");
        assert!(
            error.contains("@fixture/wildcard-kit/absent"),
            "error must name the specifier: {error}"
        );
    }

    // Integration tests that require the workspace to be built
    // are gated behind the file existence check.

    #[test]
    fn resolve_system_package() {
        let workspace_root = workspace_root();
        // Resolve from showcase directory (where node_modules/@animus-ui/ lives)
        let showcase_src = workspace_root.join("packages/showcase/src");
        let dir_str = showcase_src.to_string_lossy();
        if !built_artifact_available(
            &workspace_root.join("packages/system/dist/index.js"),
            "resolve_system_package",
        ) {
            return;
        }

        // @animus-ui/system has exports field
        let path = resolve_bare_specifier("@animus-ui/system", &dir_str)
            .expect("built @animus-ui/system package must resolve");
        assert!(path.contains("dist/index.js") || path.contains("dist/index.mjs"));
    }

    #[test]
    fn resolve_system_subpath() {
        let workspace_root = workspace_root();
        let showcase_src = workspace_root.join("packages/showcase/src");
        let dir_str = showcase_src.to_string_lossy();
        if !built_artifact_available(
            &workspace_root.join("packages/system/dist/groups/index.js"),
            "resolve_system_subpath",
        ) {
            return;
        }

        let path = resolve_bare_specifier("@animus-ui/system/groups", &dir_str)
            .expect("built @animus-ui/system/groups subpath must resolve");
        assert!(path.contains("groups"));
    }

    #[test]
    fn resolve_test_ds_fallback() {
        let workspace_root = workspace_root();
        let showcase_src = workspace_root.join("packages/showcase/src");
        let dir_str = showcase_src.to_string_lossy();
        if !built_artifact_available(
            &workspace_root.join("packages/test-ds/dist/index.mjs"),
            "resolve_test_ds_fallback",
        ) {
            return;
        }

        // @animus-ui/test-ds has NO exports, only module/main
        let path = resolve_bare_specifier("@animus-ui/test-ds", &dir_str)
            .expect("built @animus-ui/test-ds package must resolve");
        assert!(path.contains("dist/index.mjs") || path.contains("dist/index.js"));
    }

    #[test]
    #[ignore] // requires packages/system/dist to be built — run explicitly with --ignored
    fn load_showcase_ds() {
        let workspace_root = workspace_root();
        let root_str = workspace_root.to_string_lossy();
        let ds_path = workspace_root.join("packages/showcase/src/ds.ts");

        assert!(ds_path.is_file(), "showcase ds.ts must exist");

        // Skip if system package hasn't been built (dist is required for bundled eval)
        let system_dist = workspace_root.join("packages/system/dist/index.js");
        if !system_dist.exists() {
            eprintln!(
                "skipping load_showcase_ds: packages/system/dist not built (run bun run build:ts)"
            );
            return;
        }

        let config = load_system_module(&ds_path.to_string_lossy(), &root_str, None)
            .expect("load_system_module should succeed");

        assert!(
            !config.prop_config.is_empty(),
            "propConfig should not be empty"
        );
        assert!(
            !config.scales_json.is_empty(),
            "scalesJson should not be empty"
        );
        assert!(
            !config.variable_css.is_empty(),
            "variableCss should not be empty"
        );
    }
}
