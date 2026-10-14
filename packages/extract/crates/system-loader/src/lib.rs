//! Engine-neutral TypeScript system-module loader.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use oxc::allocator::Allocator;
use oxc::ast::ast::Statement;
use oxc::codegen::Codegen;
use oxc::parser::{Parser, ParserReturn};
use oxc::semantic::SemanticBuilder;
use oxc::span::SourceType;
use oxc::transformer::{TransformOptions, Transformer};
use rquickjs::{Function, Object};
use rustc_hash::{FxHashMap, FxHashSet};

mod bounded;
pub mod executor;
mod kit_source;
mod linked;
pub mod module_table;
pub mod resolution;

pub use kit_source::{declares_kit_source, resolve_kit_source_root, KitSourceRoot, KitSourceRule};
use executor::{shared_host_globals, Realm};
use serde::{Deserialize, Serialize};

/// Serialized system configuration returned by `load_system_module()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemConfig {
    pub prop_config: String,
    pub group_registry: String,
    pub scales_json: String,
    pub variable_map_json: String,
    pub variable_css: String,
    pub contextual_vars_json: String,
    /// Declaration scales from the built theme's `serialize()`, tagged
    /// `{ scale: { kind, members, values } }`; `None` when it has none.
    pub declaration_scales_json: Option<String>,
    /// One record per declared custom property from the built theme's
    /// `serialize()`, sorted by name; `None` when it declares none.
    pub property_records_json: Option<String>,
    pub selector_aliases: Option<String>,
    pub selector_order: Option<String>,
    /// Condition alias map JSON: alias → `{ value, order, kind }`.
    /// `None` when the system registers no condition aliases.
    pub condition_aliases: Option<String>,
    /// Transform source texts by definition key (`{ transformId: sourceText }`
    /// JSON): the only channel for configured transforms; `None` for an older build.
    pub transform_sources: Option<String>,
    /// Binding evidence by the same keys (`{ transformId: { hostGlobals:
    /// [names] } | { rejection: reason } }` JSON), from the authored
    /// callable's own function in its module: which of `btoa`/`atob` it reads
    /// as the host function, or a rejection. A source reading neither name is
    /// rejected only when a reference is shown bound outside the callable;
    /// inconclusive evidence leaves it `{ hostGlobals: [] }`, which is not
    /// proof that it reads no outer binding. A reason completes "its callable
    /// …". `None` without sources.
    pub transform_provenance: Option<String>,
    pub global_style_blocks: Option<String>,
    /// Keyframe collections from the sealed registration record, shaped
    /// `{ exportName: { keyName: { name, frames } } }`; nothing is scanned.
    pub keyframes_blocks: Option<String>,
    /// Coded witness entries from the sealed registration record, as one JSON
    /// array — the host shims console away, so this is the only channel.
    pub vocabulary_witnesses: Option<String>,
    /// Sorted canonical paths of every file the load read: each module it
    /// ran, routed through or audited, entry included and runtime stubs
    /// excluded, and each `package.json` it consulted; plugins use it as the
    /// reload set.
    pub dependencies: Vec<String>,
    /// Paths the resolution looked for and found absent, ahead of the file
    /// it chose, sorted: creating one changes what the system loads.
    pub missing: Vec<String>,
    /// Built-theme token paths, `{ modulePath: { exportName: [paths] } }`,
    /// keyed like `dependencies`. `None` when no module exports a built theme.
    pub source_theme_manifests: Option<String>,
    /// The load's own findings, as one JSON array of [`LoadFinding`]s: each
    /// registration in owned code the system does not reach, which the load
    /// did not apply. `None` when there are none.
    pub load_findings_json: Option<String>,
}

/// A registration the load found in owned code it did not run.
pub const REGISTRATION_UNREACHED: &str = "animus.system.registration-unreached";
/// A call that may be a registration the load did not run, unproved.
pub const REGISTRATION_UNPROVED: &str = "animus.system.registration-unproved";
/// Owned code the load could not audit for registrations.
pub const AUDIT_INCOMPLETE: &str = "animus.system.audit-incomplete";

/// One finding about code a load did not run, located in its source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadFinding {
    pub code: &'static str,
    /// `error` for a proved omission, which fails a strict build; `warn`
    /// otherwise. Each is reported as a warning by default.
    pub severity: &'static str,
    pub file: String,
    pub line: usize,
    pub column: usize,
    /// The registration as written, `registerGlobalStyles`, or empty.
    pub method: String,
    pub reason: String,
}

/// Strip TypeScript types from a complete module, preserving imports,
/// exports, and every other runtime construct.
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

    let semantic_ret = SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    let options = TransformOptions::default();
    let transformer = Transformer::new(&allocator, Path::new(file_path), &options);
    let _transform_ret = transformer.build_with_scoping(scoping, &mut program);

    let codegen = Codegen::new();
    Ok(codegen.build(&program).code)
}

/// What a resolution resolves under (pipeline spec §2.2): the host's export
/// conditions, in its order, the session root's declared workspace
/// packages, by name, at their canonical directories, and the host's
/// extension order (A2), through which every relative and package-entry
/// probe reads candidates; the built-in policy where no host resolves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolutionContext {
    pub conditions: Vec<String>,
    pub workspaces: BTreeMap<String, PathBuf>,
    pub extensions: resolution::ExtensionPolicy,
    /// The instance the host resolves each kit to, by package name, at its
    /// real directory: a package named here is that directory from every
    /// importer, so the system evaluates the kit the bundle renders (A3).
    /// Only kits; the entry inside the instance is still the loader's own
    /// selection.
    pub instances: BTreeMap<String, PathBuf>,
}

impl Default for ResolutionContext {
    fn default() -> Self {
        Self {
            conditions: Vec::new(),
            workspaces: BTreeMap::new(),
            extensions: resolution::extension_policy().clone(),
            instances: BTreeMap::new(),
        }
    }
}

/// Resolve a bare specifier to an absolute file path and the `package.json`
/// that selected it. Resolution chain: `exports` (a kit's `animus` source
/// condition, else the host's `conditions`, `import` and `default`) →
/// `module` → `main`.
pub fn resolve_bare_specifier(
    specifier: &str,
    from_dir: &str,
    context: &ResolutionContext,
) -> Result<(String, PathBuf), String> {
    resolve_bare_specifier_observed(specifier, from_dir, context, &mut LoadReads::default())
}

/// [`resolve_bare_specifier`], recording in `reads` each path it read or
/// looked for as it probed, whether or not the resolution succeeds.
pub fn resolve_bare_specifier_observed(
    specifier: &str,
    from_dir: &str,
    context: &ResolutionContext,
    reads: &mut LoadReads,
) -> Result<(String, PathBuf), String> {
    let (pkg_name, subpath) = split_specifier(specifier);
    let pkg_json_path = locate_package_observed(pkg_name, from_dir, context, reads)?.join("package.json");
    select_package_entry_observed(pkg_json_path, subpath, context, specifier, true, reads)
}

/// The file the package whose manifest is `pkg_json_path` names for
/// `subpath`, as Node's ESM resolver selects it, a kit's source first:
/// `exports` alone where it exists (its valid `animus` target, else the
/// first of `conditions`, `import` and `default` in the object's order);
/// otherwise `module`, `main` and a root `index`, or the subpath, as files or
/// directories through the extension policy. Every path that resolves a
/// package's entry goes through it.
fn select_package_entry(
    pkg_json_path: PathBuf,
    subpath: &str,
    context: &ResolutionContext,
    specifier: &str,
    source_first: bool,
) -> Result<(String, PathBuf), String> {
    select_package_entry_observed(pkg_json_path, subpath, context, specifier, source_first, &mut LoadReads::default())
}

/// [`select_package_entry`], recording the manifest it reads (before it is
/// parsed) and each entry candidate it found absent.
fn select_package_entry_observed(
    pkg_json_path: PathBuf,
    subpath: &str,
    context: &ResolutionContext,
    specifier: &str,
    source_first: bool,
    reads: &mut LoadReads,
) -> Result<(String, PathBuf), String> {
    let conditions = &context.conditions;
    reads.read.insert(pkg_json_path.to_string_lossy().to_string());
    let pkg_dir = pkg_json_path
        .parent()
        .ok_or_else(|| format!("invalid package.json path: {:?}", pkg_json_path))?;

    // A package directory without a manifest is still a package, as Node's
    // resolver reads it: nothing in `exports`, `module` or `main`, so its
    // root `index`.
    let pkg_json: serde_json::Value = match fs::read_to_string(&pkg_json_path) {
        Ok(pkg_json_str) => serde_json::from_str(&pkg_json_str)
            .map_err(|e| format!("failed to parse {:?}: {}", pkg_json_path, e))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && pkg_dir.is_dir() => serde_json::Value::Null,
        Err(e) => return Err(format!("failed to read {:?}: {}", pkg_json_path, e)),
    };

    if let Some(exports) = pkg_json.get("exports") {
        let export_key = if subpath.is_empty() { "." } else { subpath };
        // A source target that is missing or differs from its file only in
        // case, which discovery reports, falls back to the runtime entry; a
        // runtime target differing only in case names no file.
        let facets: &[bool] = if source_first { &[true, false] } else { &[false] };
        for &source in facets {
            if let Some(resolved) = resolve_exports_entry(exports, export_key, source, conditions) {
                // Node reads a target as a URL and decodes its escapes; each
                // decoding rule is another way to name a file Node refuses,
                // so an escape is refused, loudly, where Node may load it.
                if resolved.contains('%') {
                    return Err(format!(
                        "could not resolve '{specifier}': {pkg_json_path:?} exports {resolved:?} for \
                         '{export_key}' — percent-escape unsupported: spell the target and the \
                         specifier without '%'"
                    ));
                }
                // `..` taken back lexically, as Node resolves a target: the
                // path checked is the path opened.
                let abs_path = resolution::lexical(&pkg_dir.join(&resolved)).to_string_lossy().to_string();
                let seen = resolution::see_within(pkg_dir, &abs_path);
                if seen == resolution::Seen::Missing {
                    reads.missing.insert(abs_path.clone());
                }
                match seen {
                    resolution::Seen::File => return Ok((abs_path, pkg_json_path)),
                    resolution::Seen::CaseOnly(actual) if !source => {
                        return Err(resolution::case_mismatch_reason(
                            &format!("'{specifier}', through the exports of {pkg_json_path:?},"),
                            &abs_path,
                            &actual,
                            "spell the export target as the file is spelled",
                        ));
                    }
                    resolution::Seen::CaseOnly(_) | resolution::Seen::Missing => {}
                }
            }
        }
        // `exports` answers alone, as Node reads it: a blocked or unmatched
        // export never falls back to `module` or `main`.
        return Err(format!(
            "could not resolve '{}': {:?} exports no file for '{}' under the conditions {:?}",
            specifier, pkg_json_path, export_key, conditions
        ));
    }

    // A package without `exports`: `module`, then `main`, each as a file or
    // a directory's index through the extension policy, then an `index` at
    // its root, as Node's legacy resolution reads them; a subpath names a
    // file or directory in the package.
    // The first entry the filesystem answers, even under another case, ends
    // the selection. An entry's `..` is taken back lexically, as Node
    // resolves it, so the file checked is the file opened.
    // Each probe records the candidates it found absent ahead of the one it
    // took, all of them when it took none.
    let mut probe = |entry: &str| {
        let base = resolution::lexical(&pkg_dir.join(entry)).to_string_lossy().to_string();
        let probed = context.extensions.probe(&base, |candidate| resolution::see_within(pkg_dir, candidate));
        let taken = match &probed {
            resolution::Probe::Found(path) => Some(path.clone()),
            resolution::Probe::CaseMismatch { candidate, .. } => Some(candidate.clone()),
            resolution::Probe::Absent => None,
        };
        reads.missing.extend(
            context.extensions.candidates(&base).into_iter().take_while(|candidate| Some(candidate) != taken.as_ref()),
        );
        probed
    };
    let legacy = match subpath.trim_start_matches('.').trim_start_matches('/') {
        "" => {
            let mut chosen = None;
            for field in ["module", "main"] {
                if let Some(entry) = pkg_json.get(field).and_then(|value| value.as_str()) {
                    let probed = probe(entry);
                    if probed != resolution::Probe::Absent {
                        chosen = Some(probed);
                        break;
                    }
                }
            }
            chosen.unwrap_or_else(|| probe("index"))
        }
        subpath => probe(subpath),
    };
    match legacy {
        resolution::Probe::Found(path) => Ok((path, pkg_json_path.clone())),
        resolution::Probe::CaseMismatch { candidate, actual } => Err(resolution::case_mismatch_reason(
            &format!("'{specifier}', through {pkg_json_path:?},"),
            &candidate,
            &actual,
            "spell its module, main or import as the file is spelled",
        )),
        resolution::Probe::Absent => Err(format!(
            "could not resolve '{}': no module, main or index file in {:?}",
            specifier, pkg_dir
        )),
    }
}

/// A bare specifier split into its package (`@scope/name` or `name`) and
/// the subpath after it, with its leading `/`.
pub fn split_specifier(specifier: &str) -> (&str, &str) {
    if specifier.starts_with('@') {
        if let Some(first_slash) = specifier.find('/') {
            if let Some(second_slash) = specifier[first_slash + 1..].find('/') {
                let split_at = first_slash + 1 + second_slash;
                return (&specifier[..split_at], &specifier[split_at..]);
            }
        }
        (specifier, "")
    } else {
        if let Some(slash) = specifier.find('/') {
            (&specifier[..slash], &specifier[slash..])
        } else {
            (specifier, "")
        }
    }
}

/// The directory of the package `pkg_name` as the loader locates it from
/// `start_dir`: the first `node_modules/<pkg_name>` directory up the tree,
/// as Node's resolver finds it; else the declared workspace of that name, as
/// for a workspace package nothing links there.
pub fn locate_package(pkg_name: &str, start_dir: &str, context: &ResolutionContext) -> Result<PathBuf, String> {
    locate_package_observed(pkg_name, start_dir, context, &mut LoadReads::default())
}

/// [`locate_package`], recording each `node_modules/<pkg>` it found absent
/// before the one it took: a package installed there would win.
fn locate_package_observed(
    pkg_name: &str,
    start_dir: &str,
    context: &ResolutionContext,
    reads: &mut LoadReads,
) -> Result<PathBuf, String> {
    // Animus's own package is never redirected: a host alias of it must
    // not change which system package evaluates.
    if let Some(instance) = context.instances.get(pkg_name).filter(|_| pkg_name != "@animus-ui/system") {
        return Ok(instance.clone());
    }
    let mut dir = PathBuf::from(start_dir);
    loop {
        let package = dir.join("node_modules").join(pkg_name);
        if package.is_dir() {
            return Ok(package);
        }
        reads.missing.insert(package.to_string_lossy().to_string());
        if !dir.pop() {
            break;
        }
    }
    context
        .workspaces
        .get(pkg_name)
        .cloned()
        .ok_or_else(|| format!("could not find package.json for '{}' from '{}'", pkg_name, start_dir))
}

fn resolve_exports_entry(
    exports: &serde_json::Value,
    key: &str,
    source: bool,
    conditions: &[String],
) -> Option<String> {
    let lookup_key = if key == "." {
        ".".to_string()
    } else if key.starts_with("./") {
        key.to_string()
    } else if key.starts_with('/') {
        format!(".{}", key)
    } else {
        format!("./{}", key)
    };

    // With no `.` keys, as Node reads it, `exports` is the root's target and
    // exports nothing else.
    let has_subpaths = exports
        .as_object()
        .is_some_and(|map| map.keys().any(|key| key.starts_with('.')));
    if !has_subpaths {
        return (lookup_key == ".")
            .then(|| resolve_condition_value(exports, source, conditions))
            .flatten()
            .map(|target| target_path(&target));
    }

    // An exact key answers alone: a declared key whose target resolves to
    // nothing is a blocked subpath, not an invitation to try the patterns.
    if let Some(entry) = exports.get(&lookup_key) {
        return resolve_condition_value(entry, source, conditions).map(|target| target_path(&target));
    }

    resolve_exports_pattern(exports.as_object()?, &lookup_key, source, conditions)
}

/// Node's pattern specificity: the longest literal prefix before `*` wins,
/// ties broken by the longest suffix; the match replaces every `*`.
fn resolve_exports_pattern(
    exports: &serde_json::Map<String, serde_json::Value>,
    lookup_key: &str,
    source: bool,
    conditions: &[String],
) -> Option<String> {
    let (value, matched) = best_exports_pattern(exports, lookup_key)?;
    Some(target_path(&resolve_condition_value(value, source, conditions)?.replace('*', matched)))
}

/// The `exports` pattern Node selects for `lookup_key`, with the part its
/// `*` matches; none where no pattern matches or Node refuses the match.
fn best_exports_pattern<'e, 'k>(
    exports: &'e serde_json::Map<String, serde_json::Value>,
    lookup_key: &'k str,
) -> Option<(&'e serde_json::Value, &'k str)> {
    let mut best: Option<(&str, &str, &serde_json::Value)> = None;

    for (pattern, value) in exports {
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
    if refused_pattern_match(matched) {
        return None;
    }
    Some((value, matched))
}

/// The path an `exports` target names, read as Node reads a URL: a raw
/// backslash is a `/`. A target holding a percent-escape is refused where
/// the entry is selected (`select_package_entry`).
fn target_path(target: &str) -> String {
    target.replace('\\', "/")
}

/// Whether Node refuses a pattern's match (`ERR_INVALID_MODULE_SPECIFIER`):
/// a segment that is `.`, `..` or `node_modules`, in any case. A
/// percent-encoded one is refused with every escape. An empty segment
/// loads (only deprecated, DEP0166).
fn refused_pattern_match(matched: &str) -> bool {
    matched
        .split(['/', '\\'])
        .any(|segment| matches!(segment.to_ascii_lowercase().as_str(), "." | ".." | "node_modules"))
}

/// With `source`, a kit's `animus` condition, its original source, which
/// discovery redirects every host to, comes first. Otherwise the first key,
/// in the object's order as Node and the host match it, that is one of the
/// host's `conditions`, `import` or `default` and resolves; a matched `null`
/// blocks the export.
fn resolve_condition_value(
    value: &serde_json::Value,
    source: bool,
    conditions: &[String],
) -> Option<String> {
    match condition_target(value, source, conditions) {
        Target::Found(target) => Some(target),
        Target::Blocked | Target::Unmatched => None,
    }
}

/// A conditional target as Node resolves it: a matched `null` blocks
/// resolution, while a nested object that matches no condition lets the
/// next key try.
enum Target {
    Found(String),
    Blocked,
    Unmatched,
}

fn condition_target(value: &serde_json::Value, source: bool, conditions: &[String]) -> Target {
    match value {
        serde_json::Value::String(target) if valid_package_target(target) => Target::Found(target.clone()),
        // Node refuses a target that leaves the package.
        serde_json::Value::String(_) | serde_json::Value::Null => Target::Blocked,
        // Fallbacks: the first target that resolves.
        serde_json::Value::Array(targets) => {
            let mut blocked = false;
            for target in targets {
                match condition_target(target, source, conditions) {
                    Target::Found(target) => return Target::Found(target),
                    Target::Blocked => blocked = true,
                    Target::Unmatched => {}
                }
            }
            if blocked { Target::Blocked } else { Target::Unmatched }
        }
        serde_json::Value::Object(obj) => {
            // A kit's source counts only where it is a valid target; otherwise
            // its runtime conditions answer, and discovery reports the source.
            let animus = obj
                .get("animus")
                .filter(|_| source)
                .map(|value| condition_target(value, source, conditions))
                .filter(|target| matches!(target, Target::Found(_)));
            let matched = obj.iter().filter(|(key, _)| {
                matches!(key.as_str(), "import" | "default")
                    || conditions.iter().any(|condition| condition == *key)
            });
            animus
                .into_iter()
                .chain(matched.map(|(_, value)| condition_target(value, source, conditions)))
                .find(|target| !matches!(target, Target::Unmatched))
                .unwrap_or(Target::Unmatched)
        }
        _ => Target::Unmatched,
    }
}

/// A package target Node accepts: relative to the package root (`./`), with
/// no `.`, `..` or `node_modules` segment after it
/// (`ERR_INVALID_PACKAGE_TARGET`). An empty segment loads. Discovery reads
/// a kit's source targets by the same rule (`isPackageTarget`).
fn valid_package_target(target: &str) -> bool {
    target.starts_with("./")
        && !target
            .split(['/', '\\'])
            .skip(1)
            .any(|segment| segment == "." || segment == ".." || segment.eq_ignore_ascii_case("node_modules"))
}

/// `specifier` resolved from `from_dir` as the system loader resolves its
/// imports: a relative or absolute path through the extension policy, or a
/// package through its manifest (`resolve_bare_specifier`). The file's real
/// path, with that of the `package.json` that selected it for a package;
/// otherwise why it names no file.
pub fn resolve_specifier(
    specifier: &str,
    from_dir: &str,
    context: &ResolutionContext,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    if specifier.starts_with('.') || specifier.starts_with('/') {
        resolve_relative(Path::new(from_dir), specifier, &context.extensions)
            .map(|path| (resolution::real_path(PathBuf::from(path)), None))
            .map_err(|miss| match miss {
                RelativeMiss::Absent => format!("could not resolve '{specifier}' from {from_dir:?}"),
                RelativeMiss::CaseMismatch(reason) => reason,
            })
    } else {
        resolve_bare_specifier(specifier, from_dir, context)
            .map(|(path, manifest)| {
                (resolution::real_path(PathBuf::from(path)), Some(resolution::real_path(manifest)))
            })
    }
}

/// [`resolution::real_path`], as the string the loader keys modules by.
fn real_path_string(path: PathBuf) -> String {
    resolution::real_path(path).to_string_lossy().to_string()
}

/// Why a relative specifier resolved to no file.
enum RelativeMiss {
    Absent,
    /// A file differs from it only in case: never resolved, never absent.
    CaseMismatch(String),
}

fn resolve_relative(
    base_dir: &Path,
    specifier: &str,
    policy: &resolution::ExtensionPolicy,
) -> Result<String, RelativeMiss> {
    // Appended, not replaced: `./tokens.theme` names `tokens.theme.ts`. `..`
    // is taken back lexically, as Node resolves it, so the file checked is
    // the file opened.
    let target = resolution::lexical(&base_dir.join(specifier)).to_string_lossy().to_string();
    match policy.probe(&target, |candidate| resolution::see_within(base_dir, candidate)) {
        resolution::Probe::Found(path) => Ok(path),
        resolution::Probe::CaseMismatch { candidate, actual } => {
            Err(RelativeMiss::CaseMismatch(resolution::case_mismatch_reason(
                &format!("relative import '{specifier}' from {base_dir:?}"),
                &candidate,
                &actual,
                "spell the import as the file is spelled",
            )))
        }
        resolution::Probe::Absent => Err(RelativeMiss::Absent),
    }
}

fn module_export_name(name: &oxc::ast::ast::ModuleExportName<'_>) -> String {
    match name {
        oxc::ast::ast::ModuleExportName::IdentifierName(id) => id.name.to_string(),
        oxc::ast::ast::ModuleExportName::IdentifierReference(id) => id.name.to_string(),
        oxc::ast::ast::ModuleExportName::StringLiteral(literal) => literal.value.to_string(),
    }
}

const ASSET_EXTENSIONS: &[&str] = &[
    ".woff2", ".woff", ".ttf", ".otf", ".eot", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
    ".svg", ".ico", ".mp4", ".webm", ".mp3", ".wasm", ".pdf",
];

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

fn stub_key(specifier: &str) -> String {
    format!("__stub__/{}", specifier)
}

/// Escape for a SINGLE-quoted JS literal. Every registry write and lookup
/// must use it, or an apostrophe in a path kills the whole bundle.
/// Backslash is replaced first; the reverse order would re-escape the
/// backslashes this function just added.
fn js_quoted(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

const RUNTIME_STUB_SPECIFIERS: [&str; 4] = [
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-dom",
];

fn is_runtime_stub_specifier(specifier: &str) -> bool {
    RUNTIME_STUB_SPECIFIERS.contains(&specifier)
}

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
                | Statement::ExportDeclaration(_)
                | Statement::ExportNamedDeclaration(_)
                | Statement::ExportFromDeclaration(_)
                | Statement::ExportAllDeclaration(_)
                | Statement::ExportDefaultDeclaration(_)
        )
    })
}

/// The bundle rewrites ESM into functions, so a CJS body would evaluate against
/// an undefined `module`/`require` and fail far from its cause.
fn looks_like_commonjs(source: &str, file_path: &str) -> bool {
    if has_esm_syntax(source, file_path) {
        return false;
    }
    source.contains("module.exports") || source.contains("require(")
}

/// The files a system load read or looked for, kept even when the load
/// fails: what must be watched for a retry to see the fix.
#[derive(Default)]
pub struct LoadReads {
    /// Modules read or attempted, and each `package.json` that selected one.
    pub read: BTreeSet<String>,
    /// Paths looked for and found absent, ahead of the file chosen: creating
    /// one changes what the system loads.
    pub missing: BTreeSet<String>,
    /// What the load found in owned code it did not run.
    pub findings: Vec<LoadFinding>,
}


/// The relative candidates the extension policy tries before `resolved`, or
/// every candidate when nothing resolved.
fn absent_relative_candidates(
    base_dir: &Path,
    specifier: &str,
    policy: &resolution::ExtensionPolicy,
    resolved: Option<&str>,
) -> Vec<String> {
    let target = resolution::lexical(&base_dir.join(specifier)).to_string_lossy().to_string();
    policy.candidates(&target).into_iter().take_while(|candidate| Some(candidate.as_str()) != resolved).collect()
}


/// The names a TypeScript module exports as types only: `export interface`,
/// `export type`, and their re-exports. The strip erases them, so a
/// re-export or import of one that omits `type` finds no binding at link
/// time, where a bundler without isolated modules accepts it.
fn type_only_export_names(source: &str, file_path: &str) -> FxHashSet<String> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(Path::new(file_path)).unwrap_or_else(|_| SourceType::ts().with_module(true));
    let parsed = Parser::new(&allocator, source, source_type).parse();
    let record = &parsed.module_record;
    record
        .local_export_entries
        .iter()
        .chain(&record.indirect_export_entries)
        .filter(|entry| entry.is_type)
        .filter_map(|entry| match &entry.export_name {
            oxc::syntax::module_record::ExportExportName::Name(name) => Some(name.name.to_string()),
            _ => None,
        })
        .collect()
}

/// Marker emitted before each module; bundle-line-to-module
/// attribution keys off it.
const MODULE_MARKER_PREFIX: &str = "// __module__: ";

/// `Context::full` installs ECMAScript intrinsics only — with no host
/// `console`, one top-level `console.log` would abort the whole load.
const CONSOLE_SHIM: &str = "globalThis.console = globalThis.console || (function(){\n\
const noop = function(){};\n\
return { log: noop, warn: noop, error: noop, info: noop, debug: noop, trace: noop, \
dir: noop, group: noop, groupEnd: noop, table: noop, assert: noop, count: noop, \
time: noop, timeEnd: noop, timeLog: noop };\n\
})();\n";

/// The bundle evaluates as one script, so a QuickJS backtrace names only a
/// bundle line; these fields map it back to a module and the stubs in force.
#[derive(Default)]
struct BundleLayout {
    module_starts: Vec<(usize, String)>,
    stub_specifiers: Vec<String>,
    /// Byte range of each real module's rewritten text in the bundle.
    module_spans: Vec<(usize, usize, String)>,
    /// The bundle range of each reference to an imported binding, and the
    /// local name the module refers to it by.
    import_refs: Vec<(usize, usize, String)>,
    /// Every module the load read, run or routed, in evaluation order.
    read_order: Vec<String>,
    /// Each module's export names its export object does not hold, that read
    /// a module that runs: the name, then the module and export it reads. A
    /// routed module never runs, and a retained one holds only its own and
    /// the asked names, so what such an export holds is read from the module
    /// it reads.
    routed_reads: FxHashMap<String, Vec<(String, String, String)>>,
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

/// Convert byte offsets into 1-based line numbers. Offsets must ascend —
/// the cursor never rewinds.
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

/// Generated structure (see `linked`):
/// ```js
/// globalThis.console = globalThis.console || ...;  // host shim
/// const __modules = {};
/// // the `linked::PRELUDE` helpers
/// // __module__: __stub__/react
/// (function(){ const __exports = {}; ... __modules['__stub__/react'] = __exports; })();
/// // every module's export object, in evaluation order, by its place among
/// // the sorted paths and its key (length-prefixed fields)
/// __modules['#register']([1,0], '15:/path/to/dep.js15:/path/to/mod.js');
/// // __module__: /path/to/mod.js
/// __modules['#run'][0] = (function*(){
/// Object.defineProperty(__modules['#'][0], 'name', { enumerable: true, get: () => name });
/// __modules['#reads'](__modules['#'][0], '...');  // getters reading other modules
/// yield;
/// ... })();
/// __modules['#run'][0].next();
/// __modules['#run'][1].next();  // each module's body, in evaluation order
/// ```
/// Every module's export object exists first, so the content scans that walk
/// `__modules` meet modules in the order they ran. Each module then runs to
/// its `yield` to link, defining its export getters; then each finishes in
/// evaluation order. The returned [`BundleLayout`] attributes an eval failure
/// to its module.
fn build_bundle(selection: &bounded::Selection<'_>) -> Result<(String, BundleLayout), String> {
    let bounded::Selection { specifier_map, retained: source_map, stub_exports, entry: entry_path, .. } =
        selection;
    let mut bundle =
        String::with_capacity(source_map.values().map(|s| s.len()).sum::<usize>() + 4096);
    // (byte offset of the marker, module label) — ascending by construction.
    let mut marker_offsets: Vec<(usize, String)> = Vec::new();

    bundle.push_str(CONSOLE_SHIM);
    bundle.push_str("const __modules = {};\n");
    bundle.push_str(linked::PRELUDE);
    bundle.push('\n');

    // Stub modules first, emitted in sorted key order (and with sorted export
    // names) so the same inputs always produce the same bytes.
    let mut stub_modules: Vec<(&String, &FxHashSet<String>)> = stub_exports.iter().collect();
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

    let mut paths: Vec<&String> = source_map.keys().collect();
    paths.sort();
    let refs: linked::ModuleRefs = paths.iter().enumerate().map(|(at, path)| ((*path).clone(), at)).collect();
    let routed: FxHashMap<String, linked::LinkedModule> = selection
        .routed
        .iter()
        .map(|(path, record)| (path.clone(), linked::routed_module(record, path, specifier_map)))
        .collect();
    let mut modules: FxHashMap<String, linked::LinkedModule> =
        FxHashMap::with_capacity_and_hasher(paths.len(), Default::default());
    for path in &paths {
        let module = match selection.analyses.get(*path) {
            Some(analysis) => linked::rewrite_analysed(analysis.source, analysis.program, &analysis.semantic, path, specifier_map, &refs)?,
            None => linked::rewrite_module_for_linking(&source_map[*path], path, specifier_map, &refs)?,
        };
        modules.insert((*path).clone(), module);
    }
    // Each module's own export names: the getters its object always has.
    let local_names = |module: &linked::LinkedModule| -> FxHashSet<String> {
        module
            .exports
            .iter()
            .filter(|(_, target)| matches!(target, linked::ExportTarget::Local(_)))
            .map(|(name, _)| name.clone())
            .collect()
    };
    let linker = linked::Linker::with_routes(&modules, &routed, stub_exports);
    // A retained module's object holds its own exports and the names asked
    // of it, so an import of any other name reads where its route ends.
    let own: FxHashMap<String, FxHashSet<String>> =
        modules.iter().map(|(path, module)| (path.clone(), local_names(module))).collect();
    let retarget = |from: &str, name: &str| {
        if own.get(from).is_some_and(|names| names.contains(name)) {
            return None;
        }
        let at = linker.index_of(from)?;
        match linker.resolve(at, name) {
            module_table::ExportLookup::Resolved(terminal) => match linker.read(&terminal, name)? {
                linked::Getter::Module { module, name: Some(export) } => Some((module, export)),
                _ => None,
            },
            _ => None,
        }
    };
    for module in modules.values_mut() {
        module.render(&refs, &retarget);
    }
    // Evaluation order follows every request of every module read, routed
    // ones included, so a module behind a barrel runs where the barrel's
    // order puts it; only retained modules run.
    let requests: FxHashMap<String, Vec<String>> =
        modules.iter().chain(routed.iter()).map(|(path, module)| (path.clone(), module.requests.clone())).collect();
    let read_order = linked::evaluation_order(&requests, entry_path);
    let order: Vec<String> = read_order.iter().filter(|path| modules.contains_key(*path)).cloned().collect();
    let held = |path: &str, name: &str| {
        own.get(path).is_some_and(|names| names.contains(name))
            || selection.asked.get(path).is_some_and(|asked| asked.contains(name))
    };
    let routed_reads: FxHashMap<String, Vec<(String, String, String)>> = selection
        .routed
        .keys()
        .chain(modules.keys())
        .map(|path| {
            let reads = linker
                .getters(path)
                .into_iter()
                .filter_map(|(name, getter)| match getter {
                    linked::Getter::Module { module, name: Some(export) }
                        if modules.contains_key(&module) && !held(path, &name) =>
                    {
                        Some((name, module, export))
                    }
                    _ => None,
                })
                .collect();
            (path.clone(), reads)
        })
        .collect();
    let generator = |module: &str| format!("__modules['#run'][{}]", refs[module]);

    // The global-style and theme scans walk `__modules` in this order. Each
    // module object is also listed, by its place among the sorted paths, in
    // `__modules['#']`, which no scan enumerates.
    bundle.push_str("Object.defineProperty(__modules, '#', { value: [] });\n");
    let mut keys = String::new();
    for path in &order {
        linked::push_field(&mut keys, path);
    }
    let places: Vec<String> = order.iter().map(|path| refs[path].to_string()).collect();
    let _ = writeln!(bundle, "__modules['#register']([{}], '{}');", places.join(","), js_quoted(&keys));
    bundle.push('\n');
    let mut module_spans = Vec::with_capacity(paths.len());
    let mut import_refs = Vec::new();
    for path in &paths {
        let module = &modules[*path];
        marker_offsets.push((bundle.len(), (*path).clone()));
        let _ = writeln!(bundle, "{}{}", MODULE_MARKER_PREFIX, path);
        let _ = writeln!(
            bundle,
            "{} = (function*(){{",
            generator(path),
        );
        bundle.push_str(&module.link);
        // The module's own scope declares nothing the loader adds, so any
        // name but `__modules` is the module's to declare. Getters are
        // defined in the namespace's order; a run of those that read another
        // module is written as data.
        let exports = linked::module_ref(&refs, path);
        let mut reads = linked::ModuleReads::default();
        let asked = selection.asked.get(*path);
        let getters = linker
            .getters(path)
            .into_iter()
            .filter(|(name, _)| own[*path].contains(name) || asked.is_some_and(|asked| asked.contains(name)));
        for (name, getter) in getters {
            match getter {
                linked::Getter::Local(binding) => {
                    reads.flush(&mut bundle, &exports);
                    let _ = writeln!(
                        bundle,
                        "Object.defineProperty({exports}, '{}', {{ enumerable: true, get: () => {binding} }});",
                        js_quoted(&name),
                    );
                }
                linked::Getter::Module { module, name: read } => reads.push(&refs, &name, &module, read.as_deref()),
            }
        }
        reads.flush(&mut bundle, &exports);
        bundle.push_str("yield;\n");
        let start = bundle.len();
        bundle.push_str(&module.body);
        module_spans.push((start, bundle.len(), (*path).clone()));
        import_refs.extend(module.import_refs.iter().map(|(from, to, local)| (start + from, start + to, local.clone())));
        bundle.push_str("\n})();\n");
        let _ = writeln!(bundle, "{}.next();\n", generator(path));
    }
    for path in &order {
        let _ = writeln!(bundle, "{}.next();", generator(path));
    }

    let module_starts = offsets_to_line_numbers(&bundle, marker_offsets);
    Ok((
        bundle,
        BundleLayout {
            module_starts,
            stub_specifiers,
            module_spans,
            import_refs,
            read_order,
            routed_reads,
        },
    ))
}

/// Line of the innermost bundle frame: rquickjs names the script
/// `eval_script`, so frames read `at <eval> (eval_script:42[:col])`.
fn bundle_line_from_stack(stack: &str) -> Option<usize> {
    let marker = format!("{BUNDLE_SCRIPT}:");
    let start = stack.find(&marker)? + marker.len();
    let digits: String = stack[start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

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

fn execute_bundle(
    bundle_script: &str,
    layout: &BundleLayout,
    entry_path: &str,
    export_name: Option<&str>,
    global_origins: &FxHashMap<String, (String, String)>,
) -> Result<SystemConfig, String> {
    let realm = Realm::fresh(None)?;
    realm.with(|ctx| {
        // Each built theme hashes its contract; natively, not in the interpreter.
        executor::install_native_sha256(&ctx).map_err(|e| format!("native sha256 failed to install: {e}"))?;
        // Compiled before any module runs, so its getters are the pristine ones.
        let authored_probe: Function = ctx
            .eval(AUTHORED_CALLABLE_PROBE.as_bytes())
            .map_err(|e| format!("authored-callable probe failed to compile: {}", e))?;
        ctx.eval::<(), _>(bundle_script.as_bytes())
            .map_err(|e| describe_eval_failure(&ctx, layout, &e))?;
        if !global_origins.is_empty() {
            let origins = serde_json::to_string(global_origins).expect("origins serialize");
            ctx.eval::<(), _>(format!("Object.defineProperty(globalThis, '__global_origins', {{ value: {origins} }});").as_bytes())
                .map_err(|e| format!("global origins failed to install: {e}"))?;
        }

        // The lookup takes the same escape the registration used, so the two
        // keys still match.
        let access_script = format!("__modules['{}']", js_quoted(entry_path));
        let namespace: Object = ctx
            .eval(access_script.as_bytes())
            .map_err(|e| format!("failed to access entry module exports: {}", e))?;

        let mut config = extract_system_config(&ctx, &namespace, export_name, |config, sources| {
            transform_provenance(config, &authored_probe, sources, bundle_script, layout)
        })?;
        config.source_theme_manifests = extract_source_theme_manifests(&ctx).map(|scanned| with_routed_themes(&scanned, layout));
        Ok(config)
    })
}

/// The scanned theme manifests with each export the scan could not see
/// added, in the order the load read the modules: a routed module never
/// runs, and a retained one's object holds only its own and the asked names,
/// so each other export holding a built theme holds what the export it
/// reads holds. A module's names are in code-unit order, as its namespace
/// lists them.
fn with_routed_themes(scanned: &str, layout: &BundleLayout) -> String {
    let Ok(serde_json::Value::Object(scanned)) = serde_json::from_str::<serde_json::Value>(scanned) else {
        return scanned.to_string();
    };
    let themes_of = |path: &str| -> Vec<(String, serde_json::Value)> {
        let mut themes: Vec<(String, serde_json::Value)> = scanned
            .get(path)
            .and_then(|themes| themes.as_object())
            .map(|themes| themes.iter().map(|(name, tokens)| (name.clone(), tokens.clone())).collect())
            .unwrap_or_default();
        for (name, module, export) in layout.routed_reads.get(path).into_iter().flatten() {
            if let Some(tokens) = scanned.get(module).and_then(|themes| themes.get(export)) {
                themes.push((name.clone(), tokens.clone()));
            }
        }
        themes.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
        themes
    };
    let mut manifests = serde_json::Map::new();
    for path in layout.read_order.iter().chain(scanned.keys().filter(|path| !layout.read_order.contains(path))) {
        let themes = themes_of(path);
        if !themes.is_empty() {
            manifests.insert(path.clone(), serde_json::Value::Object(themes.into_iter().collect()));
        }
    }
    serde_json::Value::Object(manifests).to_string()
}

/// Walk the already-evaluated module registry for built-theme token paths —
/// no further evaluation, resolution, or filesystem access.
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
        // The bundle discriminator must match isLibraryBundle in
        // packages/system/src/SystemBuilder.ts; this sandbox cannot import TS.
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

fn extract_system_config<'js>(
    ctx: &rquickjs::Ctx<'js>,
    namespace: &Object<'js>,
    export_name: Option<&str>,
    provenance: impl FnOnce(&Object<'js>, &str) -> Result<String, String>,
) -> Result<SystemConfig, String> {
    // Two distinct `.toConfig()` exports fail the load: an enumeration-order
    // first-pick could silently load a system with no registrations.
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
    let transform_sources: Option<String> = config_obj.get("transformSources").ok();
    let transform_provenance = transform_sources
        .as_deref()
        .map(|sources| provenance(&config_obj, sources))
        .transpose()?;

    // `theme` and `tokens` may both be exported only when they are the SAME
    // object; identity is reference equality, never serialized output.
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

    // An unbuilt ThemeBuilder fails loud: falling through to `tokens` would
    // extract a configuration the author never edited.
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
    let declaration_scales_json: Option<String> = serialized.get("declarationScalesJson").ok();
    let property_records_json: Option<String> = serialized.get("propertyRecordsJson").ok();

    // The registration record is the only source for keyframe and global-style
    // collections; an exported-but-unregistered value does not carry.
    if system_obj
        .get::<_, Function>("getVocabularyRecord")
        .is_err()
    {
        return Err(
            "system carries no vocabulary registration record — it is unsealed or was \
             built by an older @animus-ui/system. Register collections between build() \
             and seal() and export the sealed instance; loading with silently empty \
             collections is refused"
                .to_string(),
        );
    }
    let (keyframes_blocks, global_style_blocks, vocabulary_witnesses) =
        extract_vocabulary_record(ctx, &system_obj)?;

    Ok(SystemConfig {
        prop_config,
        group_registry,
        scales_json,
        variable_map_json,
        variable_css,
        contextual_vars_json,
        declaration_scales_json,
        property_records_json,
        selector_aliases,
        selector_order,
        condition_aliases,
        transform_sources,
        transform_provenance,
        global_style_blocks,
        keyframes_blocks,
        vocabulary_witnesses,
        // Populated by load_system_module from the resolved module graph;
        // execute_bundle only sees the assembled bundle text.
        dependencies: Vec::new(),
        missing: Vec::new(),
        // Populated by execute_bundle after config extraction (the registry
        // walk needs the live rquickjs context, not the namespace alone).
        source_theme_manifests: None,
        load_findings_json: None,
    })
}

/// Reads, for each configured transform, the authored callable an Animus
/// forwarder links under a registry symbol: its position and text, through
/// getters captured before any module ran. Nothing is called.
const AUTHORED_CALLABLE_PROBE: &str = r#"(() => {
  const link = Symbol.for('animus.transform.authored');
  const proto = Function.prototype;
  const get = (key) => Object.getOwnPropertyDescriptor(proto, key).get;
  const fileName = get('fileName');
  const lineNumber = get('lineNumber');
  const columnNumber = get('columnNumber');
  const toText = proto.toString;
  const call = proto.call.bind(proto.call);
  const own = Object.getOwnPropertyDescriptor;
  const stringify = JSON.stringify;
  return (transforms, ids) => {
    const out = {};
    for (const id of ids) {
      const forwarder = transforms == null ? undefined : own(transforms, id)?.value;
      // The link is an own data property of every Animus forwarder.
      const authored = typeof forwarder === 'function' ? own(forwarder, link)?.value : undefined;
      out[id] = typeof authored === 'function'
        ? {
            file: call(fileName, authored),
            line: call(lineNumber, authored),
            column: call(columnNumber, authored),
            text: call(toText, authored),
          }
        : null;
    }
    return stringify(out);
  };
})()"#;

/// The script name rquickjs gives the bundle in positions and backtraces.
const BUNDLE_SCRIPT: &str = "eval_script";

/// Where the authored callable's function starts in the bundle.
#[derive(serde::Deserialize)]
struct AuthoredPosition {
    file: Option<String>,
    line: Option<usize>,
    column: Option<usize>,
    text: String,
}

/// Why an authored callable's bindings cannot be admitted.
enum BindingFailure {
    /// A reference inside the callable resolves to a binding outside it: the
    /// first, and each read of an import through the bundle's module cell
    /// when every read of the cell is one.
    Captured { reason: String, import_reads: Vec<String> },
    /// The callable's function or a host read could not be established.
    Inconclusive(String),
}

/// Per-definition binding evidence for `transformSources`, each definition
/// located through its own authored callable. A definition that may read
/// `btoa` or `atob` is rejected on any failure; any other is rejected only
/// for a binding shown captured, and otherwise keeps its text admission.
fn transform_provenance<'js>(
    config: &Object<'js>,
    authored_probe: &Function<'js>,
    transform_sources: &str,
    bundle: &str,
    layout: &BundleLayout,
) -> Result<String, String> {
    let sources: std::collections::BTreeMap<String, String> = serde_json::from_str(transform_sources)
        .map_err(|e| format!("transformSources is not a JSON object of source texts: {}", e))?;
    let positions = if sources.is_empty() {
        Ok(std::collections::BTreeMap::new())
    } else {
        authored_positions(config, authored_probe, &sources.keys().collect::<Vec<_>>())
    };
    let line_starts: Vec<usize> = std::iter::once(0).chain(bundle.match_indices('\n').map(|(i, _)| i + 1)).collect();
    let mut out = serde_json::Map::new();
    for (id, source) in &sources {
        let evidence = match &positions {
            Err(error) => Err(BindingFailure::Inconclusive(format!("could not be located ({error})"))),
            Ok(positions) => match positions.get(id).and_then(Option::as_ref) {
                Some(position) => host_binding_evidence(position, source, bundle, &line_starts, layout),
                None => Err(BindingFailure::Inconclusive(
                    "was built by an @animus-ui/system older than this extractor".to_string(),
                )),
            },
        };
        out.insert(
            id.clone(),
            match evidence {
                Ok(globals) => serde_json::json!({ "hostGlobals": globals }),
                Err(BindingFailure::Captured { reason, import_reads }) if import_reads.is_empty() => {
                    serde_json::json!({ "rejection": reason })
                }
                Err(BindingFailure::Captured { reason, import_reads }) => {
                    serde_json::json!({ "rejection": reason, "importReads": import_reads })
                }
                Err(BindingFailure::Inconclusive(reason)) if reads_shared_host_name(source) => {
                    serde_json::json!({ "rejection": reason })
                }
                Err(BindingFailure::Inconclusive(_)) => serde_json::json!({ "hostGlobals": [] }),
            },
        );
    }
    Ok(serde_json::Value::Object(out).to_string())
}

/// Whether `source` reads `btoa` or `atob` unbound, as the extractor's
/// admission decides; text that does not parse is assumed to.
fn reads_shared_host_name(source: &str) -> bool {
    let wrapper = format!("const __configured = ({source});");
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &wrapper, SourceType::mjs()).parse();
    if parsed.fatal_error || !parsed.diagnostics.is_empty() {
        return true;
    }
    let semantic = SemanticBuilder::new().build(&parsed.program).semantic;
    let unresolved = semantic.scoping().root_unresolved_references();
    shared_host_globals().iter().any(|name| unresolved.contains_key(*name))
}

/// The probe's view of each candidate's authored callable, `None` when its
/// forwarder carries no link.
fn authored_positions<'js>(
    config: &Object<'js>,
    authored_probe: &Function<'js>,
    candidates: &[&String],
) -> Result<std::collections::BTreeMap<String, Option<AuthoredPosition>>, String> {
    let transforms: rquickjs::Value =
        config.get("transforms").map_err(|e| format!("toConfig().transforms is unreadable: {}", e))?;
    let positions: String = authored_probe
        .call((transforms, candidates.to_vec()))
        .map_err(|e| format!("authored-callable probe failed: {}", e))?;
    serde_json::from_str(&positions).map_err(|e| format!("authored-callable probe returned malformed JSON: {}", e))
}

/// The shared host names the authored function reads as the host's, or why
/// its bindings cannot be admitted: the position must start exactly that
/// function of a bundled module and its text must be the configured source;
/// a reference resolving to a binding outside the function, or reading an
/// imported binding, is captured, and each import read is named when the
/// module cell is read for nothing else; and
/// every `btoa` or `atob` it reads must be unbound in a module without
/// direct eval.
fn host_binding_evidence(
    position: &AuthoredPosition,
    source: &str,
    bundle: &str,
    line_starts: &[usize],
    layout: &BundleLayout,
) -> Result<Vec<&'static str>, BindingFailure> {
    use oxc::ast::AstKind;
    let inconclusive = BindingFailure::Inconclusive;
    if position.text != source {
        return Err(inconclusive("has text that differs from its configured source".to_string()));
    }
    // QuickJS columns count UTF-8 bytes from 1; lines break only at `\n`.
    let offset = match (position.file.as_deref(), position.line, position.column) {
        (Some(file), Some(line), Some(column)) if file == BUNDLE_SCRIPT && line >= 1 && column >= 1 => {
            line_starts.get(line - 1).map(|start| start + column - 1)
        }
        _ => None,
    }
    .ok_or_else(|| inconclusive("has no position in the loaded system's modules".to_string()))?;
    let (start, end, module) = layout
        .module_spans
        .iter()
        .find(|(start, end, _)| (*start..*end).contains(&offset))
        .ok_or_else(|| inconclusive("is not defined in a module of the loaded system".to_string()))?;
    let text = &bundle[*start..*end];
    let local = offset - start;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::mjs()).parse();
    if parsed.fatal_error || !parsed.diagnostics.is_empty() {
        return Err(inconclusive(format!("is defined in {module}, which does not parse as module code")));
    }
    let semantic = SemanticBuilder::new().with_build_nodes(true).build(&parsed.program).semantic;
    let function = semantic.nodes().iter().find_map(|node| match node.kind() {
        AstKind::ArrowFunctionExpression(function) if function.span.start as usize == local => Some(function.span),
        AstKind::Function(function) if function.span.start as usize == local => Some(function.span),
        _ => None,
    });
    let span = function
        .filter(|span| text.get(span.start as usize..span.end as usize) == Some(source))
        .ok_or_else(|| inconclusive(format!("matches no function of {module} at its position")))?;
    let scoping = semantic.scoping();
    let direct_eval = scoping.root_unresolved_references().contains_key("eval");
    let mut globals = Vec::new();
    let mut unproven = None;
    let mut captured: Option<String> = None;
    let mut import_reads: Vec<String> = Vec::new();
    // Whether the callable reads the bundle's module cell other than to read
    // an import: then the cell's reads are not all imports.
    let mut cell_read_otherwise = false;
    // Nodes come in source order, so the first captured name is reported.
    for node in semantic.nodes().iter() {
        let AstKind::IdentifierReference(reference) = node.kind() else { continue };
        if !span.contains_inclusive(reference.span) {
            continue;
        }
        let name = reference.name.as_str();
        let symbol = reference.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id());
        match symbol {
            Some(symbol) if span.contains_inclusive(scoping.symbol_span(symbol)) => {}
            Some(_) => {
                cell_read_otherwise |= name == "__modules";
                captured.get_or_insert_with(|| format!("reads '{name}' declared in {module} outside the callback"));
            }
            // The bundle refers to an imported binding through its module's
            // cell, within the range the rewrite recorded for that read.
            None if name == "__modules" => {
                let at = start + reference.span.start as usize;
                let imported = layout.import_refs.iter().find(|(from, to, _)| (*from..*to).contains(&at));
                let reason =
                    format!("reads '{}' declared in {module} outside the callback", imported.map_or(name, |(_, _, local)| local.as_str()));
                match imported {
                    Some(_) if !import_reads.contains(&reason) => import_reads.push(reason.clone()),
                    Some(_) => {}
                    None => cell_read_otherwise = true,
                }
                captured.get_or_insert(reason);
            }
            None => {
                let Some(host) = shared_host_globals().iter().find(|host| name == **host) else { continue };
                if direct_eval {
                    unproven.get_or_insert_with(|| format!("reads '{name}' in {module}, which calls eval directly"));
                } else if !globals.contains(host) {
                    globals.push(*host);
                }
            }
        }
    }
    if let Some(reason) = captured {
        if cell_read_otherwise {
            import_reads.clear();
        }
        return Err(BindingFailure::Captured { reason, import_reads });
    }
    if let Some(reason) = unproven {
        return Err(inconclusive(reason));
    }
    globals.sort_unstable();
    Ok(globals)
}

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

/// Keyframes blocks, global-style blocks, and the coded witness array, in
/// that order; each `None` when empty.
type VocabularyWires = (Option<String>, Option<String>, Option<String>);

/// Insertion order is preserved end to end: `Object.fromEntries` plus
/// `JSON.stringify` in the context, `preserve_order` on the Rust side.
fn extract_vocabulary_record<'js>(
    ctx: &rquickjs::Ctx<'js>,
    system_obj: &Object<'js>,
) -> Result<VocabularyWires, String> {
    let script = r#"(() => {
  const record = globalThis.__sys_ref.getVocabularyRecord();
  if (!record || typeof record !== 'object') {
    return JSON.stringify({ invalid: 'getVocabularyRecord() did not return an object' });
  }
  if (record.version !== 1) {
    return JSON.stringify({ skew: String(record.version) });
  }
  const keyframes = Array.isArray(record.keyframes) ? record.keyframes : [];
  const globalStyles = Array.isArray(record.globalStyles) ? record.globalStyles : [];
  const collisions = Array.isArray(record.collisions) ? record.collisions : [];
  const legacyVerbs = Array.isArray(record.legacyVerbs) ? record.legacyVerbs : [];
  // Registration copies a block's styles, so its declaring module is found by
  // content: the module exporting a block with the same styles, the export
  // named like the registration breaking a tie between distinct blocks. A
  // module registers after the modules it imports, and `__modules` holds
  // modules in evaluation order (build_bundle registers them so), so the
  // first exporter of a block declares it.
  const exported = [];
  for (const path in __modules) {
    const ns = __modules[path];
    if (!ns || typeof ns !== 'object') continue;
    for (const key of Object.keys(ns)) {
      try {
        const v = ns[key];
        if (v && typeof v === 'object' && v.__brand === 'GlobalStyleBlock' && v.styles && typeof v.styles === 'object') {
          exported.push({ path, key, block: v, json: JSON.stringify(v.styles) });
        }
      } catch (_e) {}
    }
  }
  const sourceOf = (entry) => {
    let json;
    try { json = JSON.stringify(entry.styles); } catch (_e) { return undefined; }
    const matches = exported.filter((candidate) => candidate.json === json);
    const distinct = (list) => [...new Set(list.map((candidate) => candidate.block))];
    let block = distinct(matches);
    if (block.length > 1) block = distinct(matches.filter((candidate) => candidate.key === entry.name));
    if (block.length !== 1) return undefined;
    return matches.find((candidate) => candidate.block === block[0]);
  };
  const blockOf = (entry) => {
    const block = Object.assign({ styles: entry.styles, fontFaces: entry.fontFaces || [] }, entry.unlayered === true ? { unlayered: true } : {});
    // The binding a registration names, carried from the selection, is its
    // declaring module; content decides only where no binding is known.
    const origin = (globalThis.__global_origins || {})[entry.name];
    const declaring = origin ? { path: origin[0], key: origin[1] } : sourceOf(entry);
    if (declaring !== undefined) {
      block.source = declaring.path;
      block.sourceExport = declaring.key;
    }
    return block;
  };
  return JSON.stringify({
    keyframeCount: keyframes.length,
    keyframes: Object.fromEntries(keyframes.map((entry) => [entry.name, entry.frames])),
    globalStyleCount: globalStyles.length,
    globalStyles: Object.fromEntries(globalStyles.map((entry) => [entry.name, blockOf(entry)])),
    witnesses: collisions.concat(legacyVerbs),
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
    let global_style_count = parsed
        .get("globalStyleCount")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let global_style_blocks = if global_style_count == 0 {
        None
    } else {
        parsed
            .get("globalStyles")
            .map(|v| serde_json::to_string(v).unwrap_or_default())
    };
    let vocabulary_witnesses = match parsed.get("witnesses").and_then(|v| v.as_array()) {
        Some(list) if !list.is_empty() => {
            Some(serde_json::to_string(list).unwrap_or_default())
        }
        _ => None,
    };
    Ok((keyframes_blocks, global_style_blocks, vocabulary_witnesses))
}

fn list_export_keys(namespace: &Object<'_>) -> Vec<String> {
    let mut keys = Vec::new();
    for key in namespace.keys::<String>().flatten() {
        keys.push(key);
    }
    keys
}

/// Load a system module and return its serialized configuration, resolving
/// its imports under `context`.
pub fn load_system_module(
    system_path: &str,
    root_dir: &str,
    export_name: Option<&str>,
    context: &ResolutionContext,
) -> Result<SystemConfig, String> {
    load_system_module_reading(system_path, root_dir, export_name, context, &mut LoadReads::default())
}

/// [`load_system_module`], recording in `reads` what the load read and
/// looked for, which a failed load leaves for its caller to watch.
pub fn load_system_module_reading(
    system_path: &str,
    root_dir: &str,
    export_name: Option<&str>,
    context: &ResolutionContext,
    reads: &mut LoadReads,
) -> Result<SystemConfig, String> {
    let entry_path = fs::canonicalize(system_path)
        .map_err(|e| format!("failed to canonicalize '{}': {}", system_path, e))?
        .to_string_lossy()
        .to_string();
    // One load reads each directory's listing once: the exact-case check
    // otherwise lists a directory again for every candidate in it. The pass
    // may run the selection twice, so each run records its reads afresh.
    let arena = Allocator::default();
    let (selected, selecting) = resolution::with_listing_cache(|| {
        let mut loader = bounded::Loader::new(context, &arena);
        let selected = loader.select(&entry_path, export_name);
        (selected, loader.into_reads())
    });
    reads.read.extend(selecting.read);
    reads.missing.extend(selecting.missing);
    reads.findings.extend(selecting.findings);
    let selection = selected?;

    let (bundle, layout) = build_bundle(&selection)?;
    let mut config = execute_bundle(&bundle, &layout, &entry_path, Some(&selection.root), &selection.global_origins)?;
    config.global_style_blocks = config
        .global_style_blocks
        .map(|blocks| sources_relative_to(&blocks, root_dir));

    // Every file the load read: a change to any of them can change what
    // the system reaches or how its routes resolve.
    config.dependencies = reads.read.iter().cloned().collect();
    config.missing = reads.missing.iter().cloned().collect();
    config.load_findings_json = (!reads.findings.is_empty())
        .then(|| serde_json::to_string(&reads.findings).expect("findings serialize"));

    Ok(config)
}

/// Each global style block's declaring `source` module, relative to the root
/// when it lies under it, so diagnostics name it as they name source files.
fn sources_relative_to(blocks: &str, root_dir: &str) -> String {
    let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(blocks) else {
        return blocks.to_string();
    };
    let root = fs::canonicalize(root_dir).unwrap_or_else(|_| PathBuf::from(root_dir));
    if let Some(map) = parsed.as_object_mut() {
        for block in map.values_mut() {
            let Some(source) = block.get_mut("source") else { continue };
            let Some(path) = source.as_str() else { continue };
            if let Ok(relative) = Path::new(path).strip_prefix(&root) {
                *source = serde_json::Value::String(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    serde_json::to_string(&parsed).unwrap_or_else(|_| blocks.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A bundle of a graph given whole, as these tests build one: every
    /// module runs and every export name gets its getter.
    fn build_whole(
        specifier_map: &FxHashMap<(String, String), String>,
        source_map: &FxHashMap<String, String>,
        stub_exports: &FxHashMap<String, FxHashSet<String>>,
        entry_path: &str,
    ) -> Result<(String, BundleLayout), String> {
        let refs: linked::ModuleRefs = FxHashMap::default();
        let mut modules = FxHashMap::default();
        for (path, source) in source_map {
            modules.insert(path.clone(), linked::rewrite_module_for_linking(source, path, specifier_map, &refs)?);
        }
        let linker = linked::Linker::with_routes(&modules, &FxHashMap::default(), stub_exports);
        let asked = source_map
            .keys()
            .map(|path| (path.clone(), linker.getters(path).into_iter().map(|(name, _)| name).collect()))
            .collect();
        build_bundle(&bounded::Selection {
            analyses: FxHashMap::default(),
            entry: entry_path.to_string(),
            root: String::new(),
            retained: source_map.clone(),
            routed: FxHashMap::default(),
            specifier_map: specifier_map.clone(),
            stub_exports: stub_exports.clone(),
            asked,
            global_origins: FxHashMap::default(),
        })
    }

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

        assert!(result.contains("import { createSystem }"));
        assert!(result.contains("export const tokens"));
        assert!(result.contains("export const ds"));
        assert!(result.contains("createSystem()"));

        assert!(!result.contains("MyThemeType"));
        assert!(!result.contains("declare module"));
        assert!(!result.contains("interface Theme"));
    }

    fn eval_bundle(bundle: &str) -> Result<(), String> {
        let realm = Realm::fresh(None).expect("rquickjs realm");
        realm.with(|ctx| {
            ctx.eval::<(), _>(bundle.as_bytes())
                .map_err(|e| describe_eval_failure(&ctx, &BundleLayout::default(), &e))
        })
    }

    fn single_module(path: &str, source: &str) -> FxHashMap<String, String> {
        FxHashMap::from_iter([(path.to_string(), source.to_string())])
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
            build_whole(&FxHashMap::default(), &source_map, &FxHashMap::default(), "/entry.js").unwrap();

        assert!(bundle.starts_with("globalThis.console"));
        eval_bundle(&bundle).expect("top-level console calls must not abort the bundle");
    }

    #[test]
    fn aliased_stub_import_binds_the_noop() {
        // A stub defines the name the import names, not its local alias.
        let record = bounded::record_of("import { space as dsSpace } from 'react';", "/entry.ts");
        assert_eq!(record.requests, ["react"]);
        assert_eq!(record.imports[0].name, module_table::ImportName::Name("space".to_string()));

        let stub_exports =
            FxHashMap::from_iter([(stub_key("react"), FxHashSet::from_iter(["space".to_string()]))]);
        let source_map = single_module(
            "/entry.js",
            "import { space as dsSpace } from 'react';\nexport const applied = dsSpace();\n",
        );
        let (bundle, _) =
            build_whole(&FxHashMap::default(), &source_map, &stub_exports, "/entry.js").unwrap();

        let checked = format!(
            "{bundle}\nif (typeof __modules['/entry.js'].applied !== 'object') throw new Error('dsSpace is not the noop');\n"
        );
        eval_bundle(&checked).expect("aliased stub import must bind a callable noop");
    }

    #[test]
    fn re_export_from_stub_registers_the_source_name() {
        let record = bounded::record_of("export { space as dsSpace } from 'react';\nexport * from 'react-dom';", "/entry.ts");
        assert_eq!(record.requests, ["react", "react-dom"]);
        assert_eq!(record.indirect_exports, [("dsSpace".to_string(), 0, "space".to_string())]);
        assert_eq!(record.star_exports, [1]);

        let stub_exports = FxHashMap::from_iter([
            (stub_key("react"), FxHashSet::from_iter(["space".to_string()])),
            (stub_key("react-dom"), FxHashSet::default()),
        ]);
        let source_map = single_module(
            "/entry.js",
            "export { space as dsSpace } from 'react';\nexport * from 'react-dom';\n",
        );
        let (bundle, _) =
            build_whole(&FxHashMap::default(), &source_map, &stub_exports, "/entry.js").unwrap();

        let checked = format!(
            "{bundle}\nif (__modules['/entry.js'].dsSpace !== __modules['__stub__/react'].space) throw new Error('dsSpace is not the stub\\'s space');\n"
        );
        eval_bundle(&checked).expect("re-export from a stub must not read a property of undefined");
    }

    #[test]
    fn export_star_never_assigns_undefined() {
        let source_map = single_module("/entry.js", "export * from 'react';\n");
        let (bundle, _) =
            build_whole(&FxHashMap::default(), &source_map, &FxHashMap::default(), "/entry.js").unwrap();

        // An unregistered module brings in no name.
        let checked = format!(
            "{bundle}\nif (Object.keys(__modules['/entry.js']).length !== 0) throw new Error('a name was brought in');\n"
        );
        eval_bundle(&checked).expect("`export *` from an unregistered module must not throw");
    }

    #[test]
    fn export_star_as_namespace_binds_the_name() {
        let resolved_map = FxHashMap::from_iter([(
            ("/entry.ts".to_string(), "pkg".to_string()),
            "/canonical/pkg.ts".to_string(),
        )]);
        let source_map = FxHashMap::from_iter([
            ("/entry.ts".to_string(), "export * as ns from 'pkg';\n".to_string()),
            ("/canonical/pkg.ts".to_string(), "export const v = 7;\n".to_string()),
        ]);
        let (bundle, _) = build_whole(&resolved_map, &source_map, &FxHashMap::default(), "/entry.ts").unwrap();
        let checked = format!("{bundle}\nif (__modules['/entry.ts'].ns.v !== 7) throw new Error('ns is not pkg');\n");
        eval_bundle(&checked).expect("`export * as ns` binds pkg's namespace");

        let stub_exports =
            FxHashMap::from_iter([(stub_key("react"), FxHashSet::from_iter(["space".to_string()]))]);
        let source_map = single_module("/entry.js", "export * as R from 'react';\n");
        let (bundle, _) =
            build_whole(&FxHashMap::default(), &source_map, &stub_exports, "/entry.js").unwrap();
        let checked = format!(
            "{bundle}\nif (__modules['/entry.js'].R !== __modules['__stub__/react']) throw new Error('R is not the stub');\n"
        );
        eval_bundle(&checked).expect("`export * as ns` from a stub must bind an object");
    }

    #[test]
    fn module_paths_with_quotes_stay_valid_js() {
        let dir = "/Users/dev/Bob's \\ Projects";
        let dep = format!("{}/dep.js", dir);
        let entry = format!("{}/entry.js", dir);

        let specifier_map = FxHashMap::from_iter([((entry.clone(), "./dep.js".to_string()), dep.clone())]);
        let source_map = FxHashMap::from_iter([
            (dep.clone(), "export const v = 1;\n".to_string()),
            (
                entry.clone(),
                "import { v } from './dep.js';\nif (v !== 1) throw new Error('require key did not match the registry key');\n"
                    .to_string(),
            ),
        ]);

        let (bundle, _) =
            build_whole(&specifier_map, &source_map, &FxHashMap::default(), &entry).unwrap();

        eval_bundle(&bundle).expect("a quoted module path must produce an evaluable bundle");
    }

    #[test]
    fn stub_specifiers_with_quotes_stay_valid_js() {
        let stub_exports = FxHashMap::from_iter([(stub_key("it's-a-module"), FxHashSet::default())]);
        let source_map = single_module("/entry.js", "import x from \"it's-a-module\";\n");
        let (bundle, _) =
            build_whole(&FxHashMap::default(), &source_map, &stub_exports, "/entry.js").unwrap();

        eval_bundle(&bundle).expect("a quoted stub specifier must produce an evaluable bundle");
    }

    #[test]
    fn arbitrary_module_namespace_names_stay_valid_js() {
        let source_map = single_module("/entry.js", "const v = 1;\nexport { v as \"it's\" };\n");
        let (bundle, _) =
            build_whole(&FxHashMap::default(), &source_map, &FxHashMap::default(), "/entry.js").unwrap();

        eval_bundle(&bundle).expect("a quoted export name must produce an evaluable bundle");
    }

    #[test]
    fn bundle_output_is_stable_across_equal_inputs() {
        let names_react = FxHashSet::from_iter(["useMemo".to_string(), "createElement".to_string()]);
        let names_dom = FxHashSet::from_iter(["render".to_string()]);
        let names_jsx = FxHashSet::from_iter(["jsx".to_string()]);

        // Two maps with identical content but different insertion orders, so
        // their iteration orders may differ.
        let mut first_stubs = FxHashMap::default();
        first_stubs.insert(stub_key("react"), names_react.clone());
        first_stubs.insert(stub_key("react-dom"), names_dom.clone());
        first_stubs.insert(stub_key("react/jsx-runtime"), names_jsx.clone());

        let mut second_stubs = FxHashMap::default();
        second_stubs.insert(stub_key("react/jsx-runtime"), names_jsx);
        second_stubs.insert(stub_key("react-dom"), names_dom);
        second_stubs.insert(stub_key("react"), names_react);

        let source_map = single_module("/entry.js", "const value = 1;\n");
        let (first, layout) =
            build_whole(&FxHashMap::default(), &source_map, &first_stubs, "/entry.js").unwrap();
        let (second, _) =
            build_whole(&FxHashMap::default(), &source_map, &second_stubs, "/entry.js").unwrap();

        assert_eq!(first, second, "stub emission must not depend on map order");
        assert_eq!(
            layout.stub_specifiers,
            vec!["react", "react-dom", "react/jsx-runtime"]
        );
        assert!(
            first.find("__exports['createElement']").unwrap()
                < first.find("__exports['useMemo']").unwrap(),
            "{first}"
        );
    }

    #[test]
    fn eval_failure_names_owning_module_and_stub_list() {
        let source_map = FxHashMap::from_iter([
            ("/a.js".to_string(), "const first = 1;\n".to_string()),
            (
                "/b.js".to_string(),
                "const before = 1;\nmissingFunction();\n".to_string(),
            ),
        ]);
        // Force /a.js ahead of /b.js so the failure lands in the second module.
        let specifier_map = FxHashMap::from_iter([(
            ("/b.js".to_string(), "./a.js".to_string()),
            "/a.js".to_string(),
        )]);
        let stub_exports = FxHashMap::from_iter([(stub_key("react"), FxHashSet::default())]);

        let (bundle, layout) =
            build_whole(&specifier_map, &source_map, &stub_exports, "/b.js").unwrap();
        let error = execute_bundle(&bundle, &layout, "/b.js", None, &FxHashMap::default())
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

    /// What `entry`'s imports reach, read without a system root, as a
    /// load's selection reads it.
    fn reach(entry: &Path) -> Result<bounded::Selection<'static>, String> {
        reach_reading(entry).0
    }

    /// [`reach`], with what it read and looked for, kept when it fails. Its
    /// arena lives as long as the test process.
    fn reach_reading(entry: &Path) -> (Result<bounded::Selection<'static>, String>, LoadReads) {
        let context: &'static ResolutionContext = Box::leak(Box::default());
        let arena: &'static Allocator = Box::leak(Box::default());
        let entry = match fs::canonicalize(entry) {
            Ok(entry) => entry,
            Err(error) => return (Err(error.to_string()), LoadReads::default()),
        };
        resolution::with_listing_cache(|| {
            let mut loader = bounded::Loader::new(context, arena);
            let selected = loader.reach_all(&entry.to_string_lossy());
            (selected, loader.into_reads())
        })
    }

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

    /// A package's entry is selected as Node's ESM resolver selects it, a
    /// kit's `animus` source first: `exports` answers alone (arrays by their
    /// first valid target, conditions in the object's order, an invalid
    /// source target falling back to the runtime one); without `exports`,
    /// `module`, `main` and a root `index` resolve as files or directories.
    #[test]
    fn package_entries_follow_node_esm_selection() {
        let dir = scratch_dir("package-entries");
        let package = |name: &str, manifest: serde_json::Value, files: &[&str]| {
            let root = dir.join("node_modules").join(name);
            fs::create_dir_all(&root).expect("create package");
            fs::write(root.join("package.json"), manifest.to_string()).expect("write manifest");
            for file in files {
                let path = root.join(file);
                fs::create_dir_all(path.parent().expect("file has a directory")).expect("create directory");
                fs::write(path, "export {};\n").expect("write file");
            }
        };
        package("legacy-main", serde_json::json!({ "main": "index" }), &["index.js"]);
        package("default-index", serde_json::json!({ "name": "default-index" }), &["index.js"]);
        package("legacy-subpath", serde_json::json!({ "main": "./main.js" }), &["main.js", "lib/part.js"]);
        package("blocked", serde_json::json!({ "exports": { ".": null }, "module": "./esm.js" }), &["esm.js"]);
        package("unexported", serde_json::json!({ "exports": { ".": "./index.js" }, "main": "./index.js" }), &["index.js", "other.js"]);
        package("array", serde_json::json!({ "exports": { ".": ["./esm.js"] }, "main": "./cjs.js" }), &["esm.js", "cjs.js"]);
        package(
            "conditions",
            serde_json::json!({ "exports": { ".": { "browser": "./browser.js", "import": "./import.js" } } }),
            &["browser.js", "import.js"],
        );
        package(
            "import-first",
            serde_json::json!({ "exports": { ".": { "import": "./import.js", "browser": "./browser.js" } } }),
            &["browser.js", "import.js"],
        );
        package(
            "escaping-source",
            serde_json::json!({ "exports": { ".": { "animus": "../escape.ts", "import": "./runtime.js" } } }),
            &["runtime.js"],
        );
        fs::write(dir.join("node_modules/escape.ts"), "export {};\n").expect("write escape");
        // A target differing from its file only in case: a source target
        // falls back to the runtime one, and a runtime target names no file.
        package(
            "case-source",
            serde_json::json!({ "exports": { ".": { "animus": "./src/Index.ts", "import": "./runtime.js" } } }),
            &["src/index.ts", "runtime.js"],
        );
        package("case-runtime", serde_json::json!({ "exports": { ".": "./dist/Index.js" } }), &["dist/index.js"]);
        package("case-main", serde_json::json!({ "main": "./Main.js" }), &["main.js"]);
        // `..` past a link is taken back lexically, as Node reads it: the
        // entry is the package's own `token.ts`, never the `Token.ts` the
        // link's parent holds.
        package("linked-main", serde_json::json!({ "main": "./link/../token.ts" }), &["token.ts", "other/Token.ts", "other/sub/x.ts"]);
        // A pattern's match may not hold `..`, as Node refuses it.
        package(
            "wild",
            serde_json::json!({ "exports": { "./*": "./src/*.ts" } }),
            &["src/token.ts", "src/a/b.ts", "src/a%2fb.ts", "src/a b.ts", "src/a%20b.ts", "src/a\u{f}b.ts"],
        );
        // An exact target holding an escape, beside the file each reading
        // names.
        package("exact-escape", serde_json::json!({ "exports": { ".": "./src/a%20b.ts" } }), &["src/a b.ts", "src/a%20b.ts"]);
        package("exact-dots", serde_json::json!({ "exports": { ".": "./src/%2e%2e/token.ts" } }), &["token.ts", "src/token.ts"]);
        #[cfg(unix)]
        fs::write(dir.join("node_modules/wild/src/a\\b.ts"), "export {};\n").expect("write backslash name");
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            dir.join("node_modules/linked-main/other/sub"),
            dir.join("node_modules/linked-main/link"),
        )
        .expect("link");
        let from = dir.to_string_lossy().to_string();
        let resolved = |specifier: &str, conditions: &[&str]| {
            let conditions: Vec<String> = conditions.iter().map(|condition| condition.to_string()).collect();
            let context = ResolutionContext { conditions, ..ResolutionContext::default() };
            resolve_bare_specifier(specifier, &from, &context)
                .map(|(path, _)| path.rsplit("node_modules/").next().unwrap_or_default().replace("/./", "/"))
        };
        assert_eq!(resolved("legacy-main", &[]).as_deref(), Ok("legacy-main/index.js"));
        assert_eq!(resolved("default-index", &[]).as_deref(), Ok("default-index/index.js"));
        assert_eq!(resolved("legacy-subpath/lib/part", &[]).as_deref(), Ok("legacy-subpath/lib/part.js"));
        assert!(resolved("blocked", &[]).is_err(), "a blocked export never falls back to module");
        assert!(resolved("unexported/other.js", &[]).is_err(), "an unexported subpath never falls back");
        assert_eq!(resolved("array", &[]).as_deref(), Ok("array/esm.js"));
        assert_eq!(resolved("conditions", &["browser"]).as_deref(), Ok("conditions/browser.js"));
        assert_eq!(resolved("conditions", &[]).as_deref(), Ok("conditions/import.js"));
        assert_eq!(resolved("import-first", &["browser"]).as_deref(), Ok("import-first/import.js"));
        assert_eq!(resolved("escaping-source", &[]).as_deref(), Ok("escaping-source/runtime.js"));
        assert_eq!(resolved("case-source", &[]).as_deref(), Ok("case-source/runtime.js"));
        #[cfg(unix)]
        assert_eq!(resolved("linked-main", &[]).as_deref(), Ok("linked-main/token.ts"));
        assert_eq!(resolved("wild/token", &[]).as_deref(), Ok("wild/src/token.ts"));
        assert!(resolved("wild/link/../token", &[]).is_err(), "a `..` in a pattern's match is refused");
        // An empty segment is not refused, as Node 24 loads it.
        assert_eq!(resolved("wild/a//b", &[]).as_deref(), Ok("wild/src/a/b.ts"));
        // The substituted target is read as Node reads a URL: an encoded
        // separator is refused, though a file is spelled so, and a raw
        // backslash is a `/`, though a file holds one in its name.
        assert!(resolved("wild/a%2fb", &[]).is_err(), "an encoded `/` is refused");
        assert!(resolved("wild/a%5Cb", &[]).is_err(), "an encoded `\\` is refused");
        // Any other escape is refused loudly, in a target or a match: Node
        // decodes it, and each decoding rule names a file another way.
        for specifier in ["wild/a%20b", "wild/a%+fb", "exact-escape", "exact-dots"] {
            let error = resolved(specifier, &[]).expect_err("a percent-escape names no file");
            assert!(error.contains("percent-escape unsupported"), "{specifier}: {error}");
        }
        #[cfg(unix)]
        assert_eq!(resolved("wild/a\\b", &[]).as_deref(), Ok("wild/src/a/b.ts"));
        // Where the filesystem opens the misspelled entry, the selection
        // fails naming the file it opens; elsewhere it names no file.
        for (specifier, spelled, actual) in [("case-runtime", "dist/Index.js", "dist/index.js"), ("case-main", "Main.js", "main.js")] {
            let opens = dir.join("node_modules").join(specifier).join(spelled).is_file();
            let error = resolved(specifier, &[]).expect_err("a misspelled entry names no file");
            assert!(!opens || (error.contains(actual) && error.contains("spelled differently")), "{error}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// Contract: one extension policy answers system and analysis resolution
    /// alike. Each witness resolves to the same file for a system's
    /// evaluation, on disk, and for an analysis, in its file set.
    #[test]
    fn one_extension_policy_answers_system_and_analysis_alike() {
        // Contract: extraction opens the file the host resolver opens. Each
        // row: a host's order, the files present, the specifier, the file it
        // names, for a system's evaluation and for an analysis alike.
        let owned = |list: &[&str]| list.iter().map(|item| item.to_string()).collect::<Vec<_>>();
        let order = |appended: &[&str], node_next: &[(&str, &[&str])], alias: &[(&str, &[&str])]| {
            resolution::ExtensionPolicy {
                appended: owned(appended),
                node_next: node_next.iter().map(|(from, to)| (from.to_string(), owned(to))).collect(),
                alias: alias.iter().map(|(from, to)| (from.to_string(), owned(to))).collect(),
            }
        };
        let typescript_outputs: &[(&str, &[&str])] =
            &[(".js", &[".ts", ".tsx"]), (".jsx", &[".tsx"]), (".mjs", &[".mts"]), (".cjs", &[".cts"])];
        let built_in = resolution::extension_policy().clone();
        let vite = order(&[".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"], typescript_outputs, &[]);
        let next_webpack = order(&[".js", ".mjs", ".tsx", ".ts", ".jsx", ".json", ".wasm"], &[], &[]);
        let turbopack = order(&[".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"], &[], &[]);
        let alias_only = order(&[".js", ".json", ".wasm"], &[], &[(".js", &[".ts"])]);
        let alias_then_js = order(&[".js", ".json", ".wasm"], &[], &[(".js", &[".ts", ".js"])]);
        let alias_appending_ts = order(&[".js", ".ts"], &[], &[(".js", &[".ts"])]);
        let multi_dot_alias = order(&[".js", ".tsx"], &[], &[(".view.js", &[".tsx"])]);
        /// A host, its order, the files present, the specifier, the file named.
        type Row<'r> = (&'r str, &'r resolution::ExtensionPolicy, &'r [&'r str], &'r str, Option<&'r str>);
        let rows: [Row; 13] = [
            ("vite", &vite, &["a.ts", "a.js"], "./a", Some("a.js")),
            ("vite", &vite, &["a.jsx", "a.mjs"], "./a", Some("a.mjs")),
            ("built-in", &built_in, &["a.js", "a.ts"], "./a.js", Some("a.js")),
            ("vite", &vite, &["a.js", "a.ts"], "./a.js", Some("a.js")),
            ("next-webpack", &next_webpack, &["a.js", "a.ts"], "./a.js", Some("a.js")),
            ("turbopack", &turbopack, &["a.js", "a.ts"], "./a.js", Some("a.js")),
            // `.JS` is no emitted `.js`, and no candidate is a case variant.
            ("built-in", &built_in, &["a.ts"], "./a.JS", None),
            // A configured alias replaces the literal try, in its order.
            ("webpack alias ['.ts']", &alias_only, &["y.js"], "./y.js", None),
            ("webpack alias ['.ts']", &alias_only, &["y.ts", "y.js"], "./y.js", Some("y.ts")),
            ("webpack alias ['.ts', '.js']", &alias_then_js, &["x.ts", "x.js"], "./x.js", Some("x.ts")),
            // An exhausted alias ends resolution: no appended or index try.
            ("webpack alias ['.ts'], appending .ts", &alias_appending_ts, &["a.js.ts"], "./a.js", None),
            ("webpack alias ['.ts']", &alias_only, &["a.js/index.js"], "./a.js", None),
            // An alias key is the configured suffix, however many dots.
            ("webpack alias '.view.js'", &multi_dot_alias, &["x.tsx", "x.view.js"], "./x.view.js", Some("x.tsx")),
        ];
        for (index, (host, policy, present, specifier, expected)) in rows.into_iter().enumerate() {
            let dir = scratch_dir(&format!("extension-policy-{index}"));
            for file in present {
                let path = dir.join(file);
                fs::create_dir_all(path.parent().expect("a witness file has a directory")).expect("create directory");
                fs::write(path, "export {};\n").expect("write witness");
            }
            let prefix = format!("{}/", dir.to_string_lossy());
            let system = resolve_relative(&dir, specifier, policy)
                .map(|path| path.trim_start_matches(&prefix).trim_start_matches("./").to_string())
                .ok();
            let base = specifier.trim_start_matches("./");
            let analysis = policy
                .probe(base, |candidate| match present.contains(&candidate) {
                    true => resolution::Seen::File,
                    false => resolution::Seen::Missing,
                })
                .found();
            assert_eq!(system.as_deref(), expected, "system, {host}: {present:?} {specifier}");
            assert_eq!(analysis.as_deref(), expected, "analysis, {host}: {present:?} {specifier}");
            let _ = fs::remove_dir_all(&dir);
        }
        // A candidate the filesystem opens under a spelling no directory
        // lists fails loudly, naming the file it opens; where the filesystem
        // does not open it, the host's exact answer stands. Nothing is
        // folded: `X.ts` for `./X` beside `x.ts`; `ä.ts` beside `Ä.ts` and an
        // exact `ä.tsx`; an NFD `é.ts` beside an NFC `é.ts` and an exact NFD
        // `é.tsx`; and `ς.ts` beside `Σ.ts` and an exact `ς.tsx`, which APFS
        // opens as `Σ.ts`. Analysis keys each file by its own spelling.
        let rows: [(&[&str], &str, &str, Option<&str>); 4] = [
            (&["x.ts"], "./X", "X.ts", None),
            (&["\u{c4}.ts", "\u{e4}.tsx"], "./\u{e4}", "\u{e4}.ts", Some("\u{e4}.tsx")),
            (&["\u{e9}.ts", "e\u{301}.tsx"], "./e\u{301}", "e\u{301}.ts", Some("e\u{301}.tsx")),
            (&["\u{3a3}.ts", "\u{3c2}.tsx"], "./\u{3c2}", "\u{3c2}.ts", Some("\u{3c2}.tsx")),
        ];
        for (present, specifier, asked, exact) in rows {
            let dir = scratch_dir("extension-policy-case");
            for file in present {
                fs::write(dir.join(file), "export {};\n").expect("write witness");
            }
            let opens = dir.join(asked).is_file();
            let resolved = resolve_relative(&dir, specifier, resolution::extension_policy());
            let _ = fs::remove_dir_all(&dir);
            match (opens, resolved, exact) {
                (true, Err(RelativeMiss::CaseMismatch(reason)), _) => {
                    assert!(reason.contains(present[0]), "{specifier}: {reason}")
                }
                (false, Ok(path), Some(exact)) => assert!(path.ends_with(exact), "{specifier}: {path}"),
                (false, Err(RelativeMiss::Absent), None) => {}
                (opens, Ok(path), _) => panic!("{specifier} (opens {opens}): resolved to {path}"),
                (opens, Err(miss), _) => panic!(
                    "{specifier} (opens {opens}): {}",
                    match miss {
                        RelativeMiss::Absent => "absent".to_string(),
                        RelativeMiss::CaseMismatch(reason) => reason,
                    }
                ),
            }
        }
        let analysis = resolution::extension_policy()
            .probe("X", |candidate| match candidate == "x.ts" {
                true => resolution::Seen::File,
                false => resolution::Seen::Missing,
            })
            .found();
        assert_eq!(analysis, None);
        // The host's root spelled in another case: only the names a
        // specifier spells are checked, so its imports still resolve where
        // the filesystem opens that root, and are absent where it does not.
        let dir = scratch_dir("extension-policy-host-case");
        fs::create_dir_all(dir.join("sub")).expect("create directory");
        fs::write(dir.join("sub/x.ts"), "export {};\n").expect("write witness");
        let name = dir.file_name().expect("a scratch dir has a name").to_string_lossy().to_ascii_uppercase();
        let host_root = dir.with_file_name(name);
        match (host_root.exists(), resolve_relative(&host_root, "./sub/x", resolution::extension_policy())) {
            (true, Ok(path)) => assert!(path.ends_with("sub/x.ts"), "{path}"),
            (false, Err(RelativeMiss::Absent)) => {}
            (opens, Ok(path)) => panic!("opens root {opens}: resolved to {path}"),
            (opens, Err(RelativeMiss::Absent)) => panic!("opens root {opens}: read as absent"),
            (opens, Err(RelativeMiss::CaseMismatch(reason))) => panic!("opens root {opens}: {reason}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// A relative import the evaluated module makes and that names no file
    /// fails the crawl, naming it; an import only a type uses is erased with
    /// it, so the module it names, and that module's own imports, are never
    /// crawled.
    #[test]
    fn only_evaluated_imports_are_crawled_and_must_resolve() {
        let dir = scratch_dir("evaluated-imports");
        write_fixture(&dir.join("erased.ts"), "import { Shape } from './types';\ntype T = Shape;\nexport default {};\n");
        write_fixture(&dir.join("types.ts"), "import './missing';\nexport interface Shape {}\n");
        write_fixture(&dir.join("value.ts"), "import { size } from './tokens';\nexport const s = size;\n");
        let crawl = |entry: &str| reach(&dir.join(entry));
        assert!(crawl("erased.ts").is_ok(), "{:?}", crawl("erased.ts").err());
        let error = crawl("value.ts").err().unwrap_or_default();
        assert!(error.contains("'./tokens'") && error.contains("value.ts"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Host-binding evidence follows each definition's own authored callable,
    /// located by its position: equal text in another module, a module or
    /// factory binding, direct eval, a missing link or a runtime-built
    /// function each decide only their own definition.
    #[test]
    fn transform_provenance_follows_each_authored_callable() {
        let dir = scratch_dir("transform-provenance");
        write_fixture(
            &dir.join("local.js"),
            "import { Set } from './set.js';\n\
             const btoa = (s) => s;\n\
             const Math = { round: () => 99 };\n\
             export const local = (v) => btoa(String(v));\n\
             export const mathLocal = (v) => Math.round(v);\n\
             export const setImported = (v) => new Set([v]).size;\n",
        );
        write_fixture(&dir.join("set.js"), "export class Set { size = 5; }\n");
        write_fixture(
            &dir.join("global.js"),
            "export const global = (v) => btoa(String(v));\n\
             export function decl(v) { return atob(String(v)); }\n\
             export const own = (v) => { const btoa = (s) => s; return btoa(String(v)); };\n\
             export const mathOwn = (v) => { const Math = { round: () => 99 }; return Math.round(v); };\n\
             export const mathGlobal = (v) => Math.round(v);\n",
        );
        write_fixture(&dir.join("factory.js"), "export const made = ((btoa) => (v) => btoa(String(v)))((s) => s);\n");
        write_fixture(
            &dir.join("authored.js"),
            "export const authored = (() => { const bias = (v) => v; const __modules = (v) => v; return (v) => bias(v) + __modules(v); })();\n",
        );
        write_fixture(
            &dir.join("ds.js"),
            &format!(
                "import {{ local, mathLocal, setImported }} from './local.js';\n\
                 import {{ global, decl, own, mathOwn, mathGlobal }} from './global.js';\n\
                 import {{ made }} from './factory.js';\n\
                 import {{ authored }} from './authored.js';\n\
                 const link = Symbol.for('animus.transform.authored');\n\
                 const forward = (fn) => {{ const w = (v) => fn(v); Object.defineProperty(w, link, {{ value: fn }}); return w; }};\n\
                 const built = new Function('v', 'return btoa(String(v))');\n\
                 const linked = {{ local, global, decl, own, made, built, mathLocal, setImported, mathOwn, mathGlobal, authored }};\n\
                 const transforms = Object.fromEntries(Object.entries(linked).map(([id, fn]) => [id, forward(fn)]));\n\
                 transforms.unlinked = (v) => btoa(String(v));\n\
                 transforms.renamed = forward(global);\n\
                 transforms.mathUnlinked = (v) => Math.round(v);\n\
                 transforms.namedUnlinked = (v) => 'btoa:' + v;\n\
                 const sources = Object.fromEntries(Object.entries(linked).map(([id, fn]) => [id, fn.toString()]));\n\
                 sources.unlinked = transforms.unlinked.toString();\n\
                 sources.renamed = '(v) => btoa(String(v)) ';\n\
                 sources.mathUnlinked = transforms.mathUnlinked.toString();\n\
                 sources.namedUnlinked = transforms.namedUnlinked.toString();\n\
                 export const ds = {{\n\
                   toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}', transforms, transformSources: JSON.stringify(sources) }}),\n\
                   getVocabularyRecord: () => ({{ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }}),\n\
                 }};\n\
                 {FIXTURE_THEME}"
            ),
        );
        let config = load_system_module(&dir.join("ds.js").to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default())
            .expect("fixture system loads");
        let provenance: serde_json::Value =
            serde_json::from_str(config.transform_provenance.as_deref().expect("provenance")).unwrap();
        let reason = |id: &str| provenance[id]["rejection"].as_str().unwrap_or_default().to_string();
        assert_eq!(provenance["global"], serde_json::json!({ "hostGlobals": ["btoa"] }));
        assert_eq!(provenance["decl"], serde_json::json!({ "hostGlobals": ["atob"] }));
        assert_eq!(provenance["own"], serde_json::json!({ "hostGlobals": [] }));
        assert!(reason("local").contains("reads 'btoa' declared in") && reason("local").ends_with("local.js outside the callback"));
        assert!(reason("made").contains("factory.js outside the callback"), "{}", reason("made"));
        assert!(reason("built").contains("has no position"), "{}", reason("built"));
        assert!(reason("unlinked").contains("older than this extractor"), "{}", reason("unlinked"));
        assert!(reason("renamed").contains("differs from its configured source"), "{}", reason("renamed"));
        // Any name bound outside the callable rejects it; without evidence a
        // source reading neither host name keeps its text admission.
        assert!(reason("mathLocal").contains("reads 'Math' declared in"), "{}", reason("mathLocal"));
        assert!(reason("setImported").contains("reads 'Set' declared in"), "{}", reason("setImported"));
        // An import read through the bundle's module cell is named as one; a
        // `__modules` the module declares itself is no import.
        assert_eq!(provenance["setImported"]["importReads"], serde_json::json!([reason("setImported")]));
        assert!(reason("authored").contains("reads 'bias' declared in"), "{}", reason("authored"));
        assert!(provenance["authored"].get("importReads").is_none(), "{}", provenance["authored"]);
        assert_eq!(provenance["mathOwn"], serde_json::json!({ "hostGlobals": [] }));
        assert_eq!(provenance["mathGlobal"], serde_json::json!({ "hostGlobals": [] }));
        assert_eq!(provenance["mathUnlinked"], serde_json::json!({ "hostGlobals": [] }));
        // Naming btoa in a string is not reading it.
        assert_eq!(provenance["namedUnlinked"], serde_json::json!({ "hostGlobals": [] }));
        let _ = fs::remove_dir_all(&dir);
    }

    fn write_fixture(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create fixture parent");
        }
        fs::write(path, contents).expect("write fixture");
    }

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
        let dir = scratch_dir("vocab-record-order");
        let entry = dir.join("entry.ts");
        write_fixture(&entry, &sealed_system_fixture(TWO_COLLECTION_RECORD));

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
        let dir = scratch_dir("vocab-unregistered");
        let entry = dir.join("entry.ts");
        let mut source = sealed_system_fixture(TWO_COLLECTION_RECORD);
        source.push_str(
            "export const motion = { __brand: 'Keyframes', __frames: { spin: { name: 'animus-kf-ccc', frames: {} } } };\n",
        );
        write_fixture(&entry, &source);

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("sealed system must load");
        let blocks = config.keyframes_blocks.expect("registered ones carry");
        assert!(
            !blocks.contains("motion") && !blocks.contains("animus-kf-ccc"),
            "unregistered export must not carry: {blocks}"
        );
    }

    #[test]
    fn a_systems_explicit_reexport_is_never_overridden_by_a_star() {
        // Contract: an explicit export wins over a name `export *` brings in,
        // whatever their order, as Node links them. A TypeScript type
        // re-exported or imported without `type` links to nothing and fails
        // nothing, as a bundler without isolated modules accepts it, and a
        // module exporting only types loads.
        const PROTOCOL: &str = "export const ds = { toConfig: () => ({ propConfig: JSON.stringify(data), groupRegistry: '{}' }), \
             getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [] }) };\n\
             export const theme = { serialize: () => ({ scalesJson: '{}', variableMapJson: '{}', variableCss: '', contextualVarsJson: '{}' }) };\n";
        /// A case's name, its files, and the loaded propConfig.
        type Case<'a> = (&'a str, &'a [(&'a str, &'a str)], &'a str);
        let cases: [Case; 4] = [
            (
                "explicit-beats-star",
                &[
                    ("entry.js", "import { y } from './a.js';\nconst data = { y };\n"),
                    ("a.js", "export { y } from './c.js';\nexport * from './d.js';\n"),
                    ("c.js", "export const y = 'explicit';\n"),
                    ("d.js", "export const y = 'star';\n"),
                ],
                r#"{"y":"explicit"}"#,
            ),
            (
                "type-re-export",
                &[
                    ("entry.ts", "import { v } from './barrel';\nconst data = { v };\n"),
                    ("barrel.ts", "export { Props } from './types';\nexport const v = 1;\n"),
                    ("types.ts", "export interface Props { a: 1 }\nexport const t = 2;\n"),
                ],
                r#"{"v":1}"#,
            ),
            (
                "type-import-then-export",
                &[
                    ("entry.ts", "import { v } from './barrel';\nconst data = { v };\n"),
                    ("barrel.ts", "import { Props } from './types';\nexport { Props };\nexport const v = 1;\n"),
                    ("types.ts", "export interface Props { a: 1 }\nexport const t = 2;\n"),
                ],
                r#"{"v":1}"#,
            ),
            (
                "types-only-module",
                &[
                    ("entry.ts", "import { Props } from './types';\nconst p: Props = { a: 1 };\nconst data = { a: p.a };\n"),
                    ("types.ts", "export interface Props { a: 1 }\n"),
                ],
                r#"{"a":1}"#,
            ),
        ];
        for (name, files, expected) in cases {
            let dir = scratch_dir(&format!("acyclic-{name}"));
            for (file, source) in files {
                let source = if file.starts_with("entry.") { format!("{source}{PROTOCOL}") } else { source.to_string() };
                write_fixture(&dir.join(file), &source);
            }
            let entry = files.iter().find(|(file, _)| file.starts_with("entry.")).map(|(file, _)| dir.join(file)).unwrap();
            let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
            let _ = fs::remove_dir_all(&dir);
            assert_eq!(result.map(|loaded| loaded.prop_config).as_deref(), Ok(expected), "{name}");
        }
    }

    #[test]
    fn an_acyclic_namespace_lists_its_names_in_code_unit_order() {
        // Node lists a module namespace's names in code-unit order, whatever
        // order the module exported them in.
        let dir = scratch_dir("acyclic-namespace-order");
        write_fixture(
            &dir.join("entry.js"),
            "import * as ns from './a.js';\nconst data = { keys: Object.keys(ns), spread: Object.keys({ ...ns }) };\n\
             export const ds = { toConfig: () => ({ propConfig: JSON.stringify(data), groupRegistry: '{}' }), \
             getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [] }) };\n\
             export const theme = { serialize: () => ({ scalesJson: '{}', variableMapJson: '{}', variableCss: '', contextualVarsJson: '{}' }) };\n",
        );
        write_fixture(
            &dir.join("a.js"),
            "export const z = 1;\nexport { y } from './c.js';\nexport * as w from './c.js';\nexport * from './d.js';\nexport const a = 2;\nexport default 0;\n",
        );
        write_fixture(&dir.join("c.js"), "export const y = 3;\n");
        write_fixture(&dir.join("d.js"), "export const B = 4;\n");
        let result = load_system_module(&dir.join("entry.js").to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);
        let order = r#"["B","a","default","w","y","z"]"#;
        assert_eq!(
            result.map(|loaded| loaded.prop_config).as_deref(),
            Ok(format!(r#"{{"keys":{order},"spread":{order}}}"#).as_str())
        );
    }

    /// Contract: a system's module graph, with or without an import cycle,
    /// loads as Node loads it. Each module evaluates once, after the modules
    /// it imports outside its cycle. A hoisted function, an anonymous default function,
    /// a namespace import and a name `export *` brings in are all readable
    /// before their module evaluates, and every import, including one from
    /// outside the cycle, reads the exporting binding live, `export *`
    /// included when star exports form a cycle. An import of a name the
    /// module does not export, or a re-export that resolves to no binding or
    /// ambiguously, fails the load, naming the module. A write to an import
    /// throws at the write, and the loader's default binding takes no name
    /// the module uses.
    #[test]
    fn module_graphs_evaluate_with_node_semantics() {
        const PROTOCOL: &str = "export const ds = { toConfig: () => ({ propConfig: JSON.stringify(data), groupRegistry: '{}' }), \
             getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [] }) };\n\
             export const theme = { serialize: () => ({ scalesJson: '{}', variableMapJson: '{}', variableCss: '', contextualVarsJson: '{}' }) };\n";
        /// A case's name, its modules, and the loaded propConfig or a part
        /// of the load's error.
        type Case<'a> = (&'a str, &'a [(&'a str, &'a str)], Result<&'a str, &'a str>);
        let cases: [Case; 19] = [
            (
                "hoisted-live",
                &[
                    ("a", "import { describe, hello } from './b.js';\nexport let count = 0;\ncount += 1;\nexport const greeting = hello();\nexport class Day { constructor(n) { this.n = n; } label() { return describe(this); } }\n"),
                    ("b", "import { Day, count } from './a.js';\nexport function hello() { return 'hello'; }\nexport function describe(day) { return 'day-' + day.n + '-' + count; }\nexport const make = (n) => new Day(n);\n"),
                    ("entry", "import { make } from './b.js';\nimport { greeting } from './a.js';\nconst data = { label: make(3).label(), greeting };\n"),
                ],
                Ok(r#"{"label":"day-3-1","greeting":"hello"}"#),
            ),
            (
                "namespace-link",
                &[
                    ("entry", "import * as ns from './b.js';\nexport function get() { return ns.value; }\nconst data = { got: ns.got };\n"),
                    ("b", "import { get } from './entry.js';\nexport const value = 2;\nexport const got = get();\n"),
                ],
                Ok(r#"{"got":2}"#),
            ),
            (
                "anonymous-default",
                &[
                    ("entry", "import { got } from './b.js';\nexport default function () { return 6; }\nconst data = { got };\n"),
                    ("b", "import get from './entry.js';\nexport const got = get();\n"),
                ],
                Ok(r#"{"got":6}"#),
            ),
            (
                "star-link",
                &[
                    ("entry", "export * from './b.js';\nimport { seen } from './b.js';\nconst data = { seen };\n"),
                    ("b", "import { value as view } from './entry.js';\nexport const value = 7;\nexport const seen = view;\n"),
                ],
                Ok(r#"{"seen":7}"#),
            ),
            (
                "outside-live",
                &[
                    ("a", "import { ready } from './b.js';\nexport let count = 0;\nexport function bump() { count++; }\nexport const isReady = () => ready;\n"),
                    ("b", "import { bump } from './a.js';\nexport const ready = typeof bump === 'function';\n"),
                    ("entry", "import { count, bump } from './a.js';\nbump();\nconst data = { count };\n"),
                ],
                Ok(r#"{"count":1}"#),
            ),
            (
                "cyclic-star-static",
                &[
                    ("a", "export * from './b.js';\nexport * from './c.js';\n"),
                    ("b", "export * from './a.js';\n"),
                    ("c", "export const value = 7;\n"),
                    ("entry", "import { value } from './a.js';\nconst data = { value };\n"),
                ],
                Ok(r#"{"value":7}"#),
            ),
            (
                "cyclic-star-live",
                &[
                    ("a", "export * from './b.js';\nexport * from './c.js';\n"),
                    ("b", "export * from './a.js';\n"),
                    ("c", "export let value = 7;\nexport function bump() { value++; }\n"),
                    ("entry", "import { value, bump } from './a.js';\nbump();\nconst data = { value };\n"),
                ],
                Ok(r#"{"value":8}"#),
            ),
            (
                "namespace-key-order",
                &[
                    ("entry", "import * as ns from './a.js';\nconst data = { keys: Object.keys(ns) };\n"),
                    ("a", "export const z = 1;\nexport { y } from './c.js';\nexport * as w from './c.js';\nexport const a = 2;\n"),
                    ("c", "import './entry.js';\nexport const y = 3;\n"),
                ],
                Ok(r#"{"keys":["a","w","y","z"]}"#),
            ),
            (
                // React's real exports hold no `x`, so Node takes b's.
                "stub-star-yields-to-module",
                &[
                    ("entry", "import { x } from './a.js';\nimport * as ns from './a.js';\nconst data = { x, keys: Object.keys(ns) };\n"),
                    ("a", "import './entry.js';\nexport * from 'react';\nexport * from './b.js';\n"),
                    ("b", "export const x = 'b';\n"),
                ],
                Ok(r#"{"x":"b","keys":["x"]}"#),
            ),
            (
                // React has `useState` and React DOM does not, so Node takes
                // React's.
                "stub-star-yields-to-stub",
                &[
                    ("entry", "import { useState } from './a.js';\nimport { useState as direct } from 'react';\nconst data = { same: useState === direct };\n"),
                    ("a", "import './entry.js';\nexport * from 'react';\nexport * from 'react-dom';\n"),
                ],
                Ok(r#"{"same":true}"#),
            ),
            (
                // A write to an import reads and evaluates what it would
                // write, then throws at the write.
                "import-writes-throw-at-the-write",
                &[
                    ("m", "export const log = [];\nexport let v = 0;\nexport let n = { valueOf() { log.push('valueOf'); return 1; } };\n"),
                    ("entry", "import { v, n, log } from './m.js';\n\
                        const attempt = (write) => { try { write(); } catch (e) { log.push(e.constructor.name); } };\n\
                        attempt(() => { v = (log.push('rhs'), 2); });\n\
                        attempt(() => { v += (log.push('compound'), 2); });\n\
                        attempt(() => { n++; });\n\
                        attempt(() => { ({ v } = { get v() { log.push('get'); return 3; } }); });\n\
                        attempt(() => { [v] = [(log.push('element'), 4)]; });\n\
                        const data = { log, v };\n"),
                ],
                Ok(r#"{"log":["rhs","TypeError","compound","TypeError","valueOf","TypeError","get","TypeError","element","TypeError"],"v":0}"#),
            ),
            (
                "import-logical-assignment-short-circuits",
                &[
                    ("m", "export let one = 1;\nexport let zero = 0;\n"),
                    ("entry", "import { one, zero } from './m.js';\n\
                        const seen = [];\n\
                        const rhs = (x) => { seen.push(x); return x; };\n\
                        one ||= rhs('or');\none ??= rhs('nullish');\nzero &&= rhs('and');\n\
                        let thrown = null;\n\
                        try { zero ||= rhs('written'); } catch (e) { thrown = e.constructor.name; }\n\
                        const data = { seen, thrown, one, zero };\n"),
                ],
                Ok(r#"{"seen":["written"],"thrown":"TypeError","one":1,"zero":0}"#),
            ),
            (
                // The loader names a default export's binding itself, never
                // taking a name the module declares.
                "authored-default-name",
                &[
                    ("b", "const __default = 4;\nexport default function () { return __default; }\n"),
                    ("entry", "import f from './b.js';\nconst __default = 7;\nexport default 3;\nconst data = { ok: __default, f: f(), name: f.name };\n"),
                ],
                Ok(r#"{"ok":7,"f":4,"name":"default"}"#),
            ),
            (
                // An anonymous default function or class is named `default`;
                // one with its own static `name` keeps it.
                "anonymous-default-names",
                &[
                    ("arrow", "export default () => 1;\n"),
                    ("fexpr", "export default (function () {});\n"),
                    ("cls", "export default class {}\n"),
                    ("clsname", "export default class { static name = 'own'; }\n"),
                    ("fdecl", "export default function () {}\n"),
                    ("entry", "import a from './arrow.js';\nimport f from './fexpr.js';\nimport c from './cls.js';\n\
                        import n from './clsname.js';\nimport d from './fdecl.js';\n\
                        const data = { a: a.name, f: f.name, c: c.name, n: n.name, d: d.name };\n"),
                ],
                Ok(r#"{"a":"default","f":"default","c":"default","n":"own","d":"default"}"#),
            ),
            (
                // The loader declares nothing in a module's scope.
                "authored-exports-name",
                &[
                    ("exp", "const __exports = 7;\nexport const seen = __exports;\n"),
                    ("entry", "import { seen } from './exp.js';\nconst data = { seen };\n"),
                ],
                Ok(r#"{"seen":7}"#),
            ),
            (
                "reserved-modules-name",
                &[
                    ("cell", "const __modules = 1;\nexport const x = __modules;\n"),
                    ("entry", "import { x } from './cell.js';\nconst data = { x };\n"),
                ],
                Err("declares `__modules`, which the system loader reserves"),
            ),
            (
                "missing-import",
                &[
                    ("entry", "import { nope } from './b.js';\nconst data = { nope };\n"),
                    ("b", "import './entry.js';\nexport const value = 1;\n"),
                ],
                Err("entry.js' imports 'nope' from"),
            ),
            (
                "missing-indirect-export",
                &[
                    ("a", "import './b.js';\nexport { absent } from './b.js';\n"),
                    ("b", "import './a.js';\n"),
                    ("entry", "import * as ns from './a.js';\nconst data = { absent: ns.absent };\n"),
                ],
                Err("a.js' re-exports 'absent', which resolves to no binding"),
            ),
            (
                "ambiguous-indirect-export",
                &[
                    ("a", "import './b.js';\nexport { shared } from './b.js';\n"),
                    ("b", "import './a.js';\nexport * from './c.js';\nexport * from './d.js';\n"),
                    ("c", "export const shared = 1;\n"),
                    ("d", "export const shared = 2;\n"),
                    ("entry", "import * as ns from './a.js';\nconst data = { shared: ns.shared };\n"),
                ],
                Err("a.js' re-exports 'shared', which resolves it ambiguously"),
            ),
        ];
        for (name, files, expected) in cases {
            let dir = scratch_dir(&format!("node-{name}"));
            for (file, source) in files {
                let source = if *file == "entry" { format!("{source}{PROTOCOL}") } else { source.to_string() };
                write_fixture(&dir.join(format!("{file}.js")), &source);
            }
            let entry = dir.join("entry.js");
            let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
            let _ = fs::remove_dir_all(&dir);
            match expected {
                Ok(config) => assert_eq!(result.map(|loaded| loaded.prop_config).as_deref(), Ok(config), "{name}"),
                Err(message) => {
                    let error = result.err().unwrap_or_default();
                    assert!(error.contains(message), "{name}: {error}");
                }
            }
        }
    }

    #[test]
    fn wrong_record_version_fails_the_load() {
        let dir = scratch_dir("vocab-version-skew");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &sealed_system_fixture(
                "{ version: 99, keyframes: [], globalStyles: [], collisions: [] }",
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("incompatible record version must fail loud");
        assert!(
            error.contains("version") && error.contains("99"),
            "error must name the version mismatch: {error}"
        );
    }

    #[test]
    fn ambiguous_system_like_exports_fail_the_load() {
        let dir = scratch_dir("vocab-ambiguous");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &format!(
                "export const ds = {{ toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}), getVocabularyRecord: () => ({{ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }}) }};\n\
                 export const dsTwo = {{ toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}), getVocabularyRecord: () => ({{ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }}) }};\n\
                 {FIXTURE_THEME}"
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
                "export const ds = {{ toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}), getVocabularyRecord: () => ({{ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }}) }};\n\
                 export const dsAlias = ds;\n\
                 {FIXTURE_THEME}"
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        result.expect("aliases of ONE instance stay unambiguous");
    }

    #[test]
    fn record_wire_is_byte_identical_across_fresh_loads() {
        let dir = scratch_dir("vocab-determinism");
        let entry = dir.join("entry.ts");
        write_fixture(&entry, &sealed_system_fixture(TWO_COLLECTION_RECORD));

        let first = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default())
            .expect("first load");
        let second = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default())
            .expect("second load");
        let _ = fs::remove_dir_all(&dir);

        assert_eq!(
            first.keyframes_blocks, second.keyframes_blocks,
            "fresh-process loads must serialize identical collection bytes"
        );
        assert!(first.keyframes_blocks.is_some());
    }

    #[test]
    fn record_witnesses_carry_to_the_config() {
        let dir = scratch_dir("vocab-witnesses");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &sealed_system_fixture(
                "{ version: 1, keyframes: [], globalStyles: [], collisions: [\n\
                   { code: 'animus.vocabulary.collision', name: 'motion',\n\
                     winner: 'local registration #1', loser: 'extended source #1' },\n\
                 ], legacyVerbs: [\n\
                   { code: 'animus.vocabulary.legacy-verb', verb: 'includes',\n\
                     names: ['kitMotion'] },\n\
                 ] }",
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("sealed system must load");
        let witnesses = config
            .vocabulary_witnesses
            .expect("witness entries must carry");
        assert!(
            witnesses.contains("animus.vocabulary.collision")
                && witnesses.contains("motion")
                && witnesses.contains("extended source #1")
                && witnesses.contains("animus.vocabulary.legacy-verb")
                && witnesses.contains("kitMotion"),
            "witness entries must survive verbatim: {witnesses}"
        );
    }

    #[test]
    fn undeclared_root_barrel_is_never_evaluated() {
        let dir = scratch_dir("vocab-throwing-barrel");
        let kit = dir.join("node_modules").join("@x").join("kit");
        write_fixture(
            &kit.join("package.json"),
            r#"{"name":"@x/kit","exports":{".":"./index.js","./definition":"./definition.js"}}"#,
        );
        write_fixture(
            &kit.join("index.js"),
            "throw new Error('root barrel must not be evaluated');\n",
        );
        write_fixture(
            &kit.join("definition.js"),
            "export const kitTokens = { fromKit: true };\n",
        );
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &format!(
                "import {{ kitTokens }} from '@x/kit/definition';\n\
                 export const marker = kitTokens;\n\
                 {}",
                sealed_system_fixture(
                    "{ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }",
                )
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        result.expect("the load must succeed without touching the root barrel");
    }

    #[test]
    fn registered_global_styles_carry_in_record_order() {
        let dir = scratch_dir("vocab-globals-order");
        let entry = dir.join("entry.ts");
        let mut source = sealed_system_fixture(
            "{ version: 1, keyframes: [], globalStyles: [\n\
               { name: 'reset', styles: { body: { margin: 0 } } },\n\
               { name: 'typo', styles: { h1: { fontWeight: 700 } } },\n\
             ], collisions: [], legacyVerbs: [] }",
        );
        source.push_str(
            "export const rogue = { __brand: 'GlobalStyleBlock', styles: { p: { margin: 0 } } };\n",
        );
        write_fixture(&entry, &source);

        let first = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default())
            .expect("sealed system must load");
        let second = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default())
            .expect("second load");
        let _ = fs::remove_dir_all(&dir);

        let blocks = first
            .global_style_blocks
            .clone()
            .expect("registered blocks must carry");
        let reset_at = blocks.find("\"reset\"").expect("reset present");
        let typo_at = blocks.find("\"typo\"").expect("typo present");
        assert!(reset_at < typo_at, "record order must reach the wire: {blocks}");
        assert!(
            !blocks.contains("rogue"),
            "unregistered branded export must not carry: {blocks}"
        );
        let parsed: serde_json::Value = serde_json::from_str(&blocks).expect("valid JSON");
        assert!(parsed["reset"]["styles"]["body"].is_object());
        assert!(parsed["reset"]["fontFaces"].is_array());
        assert_eq!(
            first.global_style_blocks, second.global_style_blocks,
            "fresh-process loads must serialize identical block bytes"
        );
    }

    #[test]
    fn recordless_system_fails_the_load() {
        let dir = scratch_dir("vocab-recordless");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &format!(
                "export const ds = {{ toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}) }};\n\
                 {FIXTURE_THEME}"
            ),
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        let error = result.expect_err("a recordless system must fail the load");
        assert!(
            error.contains("unsealed") && error.contains("seal()"),
            "error must name the sealing requirement: {error}"
        );
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

        let result = reach(&entry);
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

    /// Contract: a package export resolves with the host's conditions, the
    /// first matching key in the object's order winning as in Node and the
    /// host, and the `package.json` that selected it is a reload dependency.
    #[test]
    fn exports_resolve_with_host_conditions_and_report_the_manifest() {
        let dir = scratch_dir("host-conditions");
        let kit = dir.join("node_modules/@probe/kit");
        write_fixture(
            &kit.join("package.json"),
            r#"{"exports": {
                "./system": {"source": "./src/system.ts", "import": "./dist/system.mjs"},
                "./ordered": {"import": "./dist/system.mjs", "development": "./src/system.ts"},
                "./blocked": {"development": null, "import": "./dist/system.mjs"}
            }}"#,
        );
        let module = |gray: &str| {
            format!(
                "export const theme = {{ serialize: () => ({{ scalesJson: JSON.stringify({{ gray: '{gray}' }}),\n\
                   variableMapJson: '{{}}', variableCss: '', contextualVarsJson: '{{}}' }}) }};\n\
                 export const system = {{ toConfig: () => ({{ propConfig: '{{}}', groupRegistry: '{{}}' }}),\n\
                   getVocabularyRecord: () => ({{ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }}) }};\n"
            )
        };
        write_fixture(&kit.join("src/system.ts"), &module("source"));
        write_fixture(&kit.join("dist/system.mjs"), &module("dist"));
        write_fixture(&dir.join("system.ts"), "export * from '@probe/kit/system';\n");
        write_fixture(&dir.join("ordered.ts"), "export * from '@probe/kit/ordered';\n");
        write_fixture(&dir.join("blocked.ts"), "export * from '@probe/kit/blocked';\n");
        let load = |entry: &str, conditions: &[&str]| {
            let conditions: Vec<String> = conditions.iter().map(|c| c.to_string()).collect();
            load_system_module(
                &dir.join(entry).to_string_lossy(),
                &dir.to_string_lossy(),
                None,
                &ResolutionContext { conditions, ..ResolutionContext::default() },
            )
        };

        let source = load("system.ts", &["source", "development"]);
        let default = load("system.ts", &[]);
        let ordered = load("ordered.ts", &["development"]);
        let blocked = load("blocked.ts", &["development"]);
        let manifest = fs::canonicalize(kit.join("package.json")).expect("canonical manifest");
        let _ = fs::remove_dir_all(&dir);

        let source = source.expect("the source condition loads");
        assert_eq!(source.scales_json, r#"{"gray":"source"}"#);
        assert!(
            source.dependencies.contains(&manifest.to_string_lossy().to_string()),
            "the selecting manifest must be a dependency: {:?}",
            source.dependencies
        );
        assert_eq!(default.expect("import loads").scales_json, r#"{"gray":"dist"}"#);
        assert_eq!(
            ordered.expect("ordered loads").scales_json,
            r#"{"gray":"dist"}"#,
            "`import` precedes `development` in the object, so it wins"
        );
        assert!(blocked.is_err(), "a matched `null` blocks the export, as in Node");
    }

    #[test]
    fn dependency_set_covers_the_transitive_graph_sorted() {
        let dir = scratch_dir("dep-set");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import { makeTheme } from './theme';\n\
             export const theme = makeTheme();\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
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

        // A helper-built theme may hold anything, so the test names the system.
        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), Some("system"), &ResolutionContext::default());

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

    /// Contract: a workspace package resolves the same for system evaluation
    /// and analysis. A declared workspace that nothing links into
    /// `node_modules` answers once the `node_modules` lookup misses: the
    /// system that imports it loads it, and `resolve_specifier`, which the
    /// session's package map reads, names the same file.
    #[test]
    fn unlinked_workspace_resolves_alike_for_evaluation_and_analysis() {
        let dir = scratch_dir("unlinked-workspace");
        let app = dir.join("app");
        let entry = app.join("entry.ts");
        write_fixture(
            &entry,
            "import { base } from '@probe/tokens';\n\
             export const theme = { serialize: () => ({ scalesJson: JSON.stringify(base), variableMapJson: '{}', variableCss: '', contextualVarsJson: '{}' }) };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );
        let workspace = dir.join("packages/tokens");
        write_fixture(&workspace.join("package.json"), r#"{ "name": "@probe/tokens", "main": "./index.ts" }"#);
        write_fixture(&workspace.join("index.ts"), "export const base = { color: 'red' };\n");
        let canonical = fs::canonicalize(&workspace).expect("canonicalize workspace");
        let context = ResolutionContext {
            workspaces: BTreeMap::from([("@probe/tokens".to_string(), canonical.clone())]),
            ..ResolutionContext::default()
        };
        let load = |context: &ResolutionContext| {
            load_system_module(&entry.to_string_lossy(), &app.to_string_lossy(), None, context)
        };
        let undeclared = load(&ResolutionContext::default());
        let evaluated = load(&context);
        let analyzed = resolve_specifier("@probe/tokens", &app.to_string_lossy(), &context);
        let _ = fs::remove_dir_all(&dir);

        assert!(undeclared.is_err(), "an undeclared, unlinked workspace names no package");
        // An installed package directory without a manifest is still the
        // package Node loads (its `index`), so the workspace never answers.
        let installed = scratch_dir("installed-without-manifest");
        write_fixture(&installed.join("node_modules/@probe/tokens/index.js"), "export const base = 'installed';\n");
        let installed_answer = resolve_specifier("@probe/tokens", &installed.to_string_lossy(), &context);
        let installed_file = fs::canonicalize(installed.join("node_modules/@probe/tokens/index.js")).expect("canonicalize");
        let _ = fs::remove_dir_all(&installed);
        assert_eq!(installed_answer.map(|(path, _)| path), Ok(installed_file));
        let config = evaluated.expect("a declared workspace loads");
        let file = canonical.join("index.ts");
        assert!(config.dependencies.contains(&file.to_string_lossy().to_string()), "{:?}", config.dependencies);
        assert_eq!(analyzed.map(|(path, _)| path), Ok(file));
    }

    #[test]
    fn source_theme_manifests_capture_built_theme_token_paths() {
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
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

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());

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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );
        write_fixture(
            &dir.join("kit/index.ts"),
            "export const kit = {\n\
               system: { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) },\n\
               tokens: {\n\
                 colors: { externalAccent: '#f0f' },\n\
                 manifest: { variableMap: { 'colors.externalAccent': '--color-external-accent' } },\n\
               },\n\
             };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());

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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );
        write_fixture(
            &dir.join("kit/index.ts"),
            "export const kit = {\n\
               system: { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) },\n\
               theme: {\n\
                 colors: { externalAccent: '#f0f' },\n\
                 manifest: { variableMap: { 'colors.externalAccent': '--color-external-accent' } },\n\
               },\n\
             };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());

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
        // The scratch dir holds no such font file: the placeholder bytes must
        // carry through the record without any resolution attempt.
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [{ name: 'globals', styles: globals.styles, fontFaces: globals.fontFaces }], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
    fn a_systems_modules_evaluate_in_esm_order_and_global_styles_register_in_that_order() {
        // Each module that runs registers a global style. Only the modules the
        // system reaches run, in ECMA's evaluation order as Node and Bun run
        // them: the entry reads `declared` through `a`'s star, so `c` runs, but
        // `a` is only a route and never runs; it reads `y` through `b`, so `d`
        // runs, then `b`, whose bare `import './x'` is not followed; then the
        // entry. A block that `c` exports and `a` re-exports through its star
        // is declared by `c`.
        let dir = scratch_dir("esm-order");
        let register = |name: &str| {
            format!("import {{ register }} from './registry';\nregister('{name}', {{ body: {{ color: '{name}' }} }});\n")
        };
        write_fixture(
            &dir.join("registry.ts"),
            "export const registered = [];\n\
             export const register = (name, styles) => { registered.push({ name, styles }); };\n",
        );
        write_fixture(
            &dir.join("c.ts"),
            &format!(
                "{}export const declared = {{ __brand: 'GlobalStyleBlock', styles: {{ main: {{ margin: 0 }} }} }};\n\
                 register('declared', declared.styles);\n",
                register("c")
            ),
        );
        write_fixture(&dir.join("a.ts"), &format!("{}export * from './c';\n", register("a")));
        write_fixture(&dir.join("d.ts"), &format!("{}export const y = 1;\n", register("d")));
        write_fixture(&dir.join("x.ts"), &register("x"));
        write_fixture(
            &dir.join("b.ts"),
            &format!("export {{ y }} from './d';\nimport './x';\n{}export const bRan = true;\n", register("b")),
        );
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            &format!(
                "import {{ declared }} from './a';\nimport {{ y, bRan }} from './b';\nimport {{ registered }} from './registry';\n\
                 export const reached = [declared, y, bRan];\n{}{}",
                register("entry"),
                sealed_system_fixture(
                    "{ version: 1, keyframes: [], globalStyles: registered, collisions: [], legacyVerbs: [] }"
                )
            ),
        );

        let result =
            load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), Some("ds"), &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("ordered system loads");
        let blocks: serde_json::Value =
            serde_json::from_str(&config.global_style_blocks.expect("registered globals")).unwrap();
        let order: Vec<&str> = blocks.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(order, ["c", "declared", "d", "b", "entry"]);
        assert_eq!(blocks["declared"]["source"], "c.ts", "{blocks}");
    }

    #[test]
    fn global_style_blocks_name_their_declaring_module() {
        let dir = scratch_dir("global-block-source");
        let entry = dir.join("entry.ts");
        write_fixture(
            &dir.join("styles/resources.ts"),
            "export const docsResources = {\n\
               __brand: 'GlobalStyleBlock',\n\
               styles: { body: { fontFamily: 'Mona Sans' } },\n\
             };\n",
        );
        // The entry re-exports the block, and registration copies styles, as
        // the system builder does; an inline block is exported by no module.
        write_fixture(
            &entry,
            "import { docsResources } from './styles/resources';\n\
             export { docsResources };\n\
             const inline = { __brand: 'GlobalStyleBlock', styles: { main: { margin: 0 } } };\n\
             const copied = (block) => Object.fromEntries(Object.entries(block.styles).map(([key, body]) => [key, { ...body }]));\n\
             export const tokens = {\n\
               serialize: () => ({\n\
                 scalesJson: '{}',\n\
                 variableMapJson: '{}',\n\
                 variableCss: '',\n\
                 contextualVarsJson: '{}',\n\
               }),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [{ name: 'docsResources', styles: copied(docsResources) }, { name: 'inline', styles: copied(inline) }], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("system with registered globals must load");
        let blocks: serde_json::Value = serde_json::from_str(
            &config.global_style_blocks.expect("registered globals must be serialized"),
        )
        .expect("global style blocks JSON parses");
        assert_eq!(blocks["docsResources"]["source"], "styles/resources.ts", "{blocks}");
        assert_eq!(blocks["docsResources"]["sourceExport"], "docsResources", "{blocks}");
        assert!(blocks["inline"].get("source").is_none(), "{blocks}");
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        let config = result.expect("plain system must load");
        assert!(
            config.source_theme_manifests.is_none(),
            "no built-theme export → no captured manifests"
        );
    }

    #[test]
    fn theme_export_preferred_over_unrelated_tokens() {
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
        let dir = scratch_dir("theme-unbuilt");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const theme = {\n\
               build: () => ({}),\n\
               addScale: () => ({}),\n\
               addColors: () => ({}),\n\
             };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
        let dir = scratch_dir("theme-unrelated-no-tokens");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "export const theme = { color: 'red' };\n\
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        result.expect("aliasing 'tokens' to 'theme' must stay a valid load");
    }

    #[test]
    fn distinct_built_theme_exports_fail_naming_both() {
        // Both exports serialize identically; identity, not output, decides.
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
             export const system = { toConfig: () => ({ propConfig: '{}', groupRegistry: '{}' }), getVocabularyRecord: () => ({ version: 1, keyframes: [], globalStyles: [], collisions: [], legacyVerbs: [] }) };\n",
        );

        let result = load_system_module(&entry.to_string_lossy(), &dir.to_string_lossy(), None, &ResolutionContext::default());
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

        let result = reach(&entry);
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

        let result = reach(&entry);
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

        let result = reach(&entry);
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

        let result = reach(&entry);
        let _ = fs::remove_dir_all(&dir);

        let bounded::Selection { specifier_map, retained: source_map, stub_exports, .. } =
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
        let record = bounded::record_of(
            "import type { Property } from 'csstype';\n\
             import { type Only } from 'type-fest';\n\
             export type { Thing } from 'types-pkg';\n\
             import 'side-effect';\n\
             import { real, type Erased } from 'runtime-pkg';\n",
            "/entry.ts",
        );

        assert_eq!(record.requests, ["side-effect", "runtime-pkg"]);
        let names: Vec<&module_table::ImportName> = record.imports.iter().map(|import| &import.name).collect();
        assert_eq!(names, [&module_table::ImportName::Name("real".to_string())]);
    }

    #[test]
    fn type_only_import_of_unresolvable_package_is_not_an_error() {
        let dir = scratch_dir("type-only");
        let entry = dir.join("entry.ts");
        write_fixture(
            &entry,
            "import type { Thing } from '@animus-test/types-only';\n\
             export const value: Thing = 1;\n",
        );

        let result = reach(&entry);
        let _ = fs::remove_dir_all(&dir);

        let bounded::Selection { specifier_map, stub_exports, .. } =
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

        let result = reach(&entry);
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

    /// Contract: as in Node, `exports` with no `.` keys is the root's target,
    /// a conditions object or a string, and exports no other subpath.
    #[test]
    fn exports_without_subpath_keys_resolve_the_root() {
        let conditions = serde_json::json!({ "import": "./a.js", "default": "./b.js" });
        assert_eq!(resolve_exports_entry(&conditions, ".", false, &[]), Some("./a.js".to_string()));
        assert_eq!(resolve_exports_entry(&conditions, "/a.js", false, &[]), None);
        let string = serde_json::json!("./index.js");
        assert_eq!(resolve_exports_entry(&string, ".", false, &[]), Some("./index.js".to_string()));
    }

    #[test]
    fn resolve_exports_entry_string() {
        let exports: serde_json::Value = serde_json::json!({
            ".": "./dist/index.js",
            "./groups": "./dist/groups/index.js"
        });
        assert_eq!(
            resolve_exports_entry(&exports, ".", true, &[]),
            Some("./dist/index.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "/groups", true, &[]),
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
            },
            "./system": {
                "types": "./dist/system.d.ts",
                "animus": "./src/system.ts",
                "import": "./dist/system.js"
            }
        });
        assert_eq!(
            resolve_exports_entry(&exports, ".", true, &[]),
            Some("./dist/index.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "/runtime", true, &[]),
            Some("./dist/runtime.js".to_string())
        );
        // A kit's source condition comes first; without it, the runtime entry.
        assert_eq!(
            resolve_exports_entry(&exports, "/system", true, &[]),
            Some("./src/system.ts".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "/system", false, &[]),
            Some("./dist/system.js".to_string())
        );
    }

    #[test]
    fn resolve_exports_entry_wildcard_subpath_pattern() {
        // Node's `exports` wildcard form, verbatim from `@ark-ui/react`: one
        // `"./*"` pattern serves every component subpath Node and Vite resolve.
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
            resolve_exports_entry(&exports, "/field", true, &[]),
            Some("./dist/components/field/index.js".to_string()),
            "a `./*` pattern must substitute the matched subpath"
        );
        // An exact key still wins over the pattern that would also match it.
        assert_eq!(
            resolve_exports_entry(&exports, "/factory", true, &[]),
            Some("./dist/components/factory.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, ".", true, &[]),
            Some("./dist/index.js".to_string())
        );
    }

    #[test]
    fn resolve_exports_entry_wildcard_longest_prefix_wins() {
        let exports: serde_json::Value = serde_json::json!({
            "./*": "./dist/*.js",
            "./lib/*": "./dist/lib/*.js",
            "./lib/*.css": "./dist/lib/*.css"
        });

        assert_eq!(
            resolve_exports_entry(&exports, "/thing", true, &[]),
            Some("./dist/thing.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "/lib/thing", true, &[]),
            Some("./dist/lib/thing.js".to_string())
        );
        assert_eq!(
            resolve_exports_entry(&exports, "/lib/thing.css", true, &[]),
            Some("./dist/lib/thing.css".to_string())
        );
    }

    #[test]
    fn resolve_exports_entry_without_pattern_still_falls_through() {
        let exports: serde_json::Value = serde_json::json!({
            ".": "./dist/index.js",
            "./groups": "./dist/groups/index.js"
        });
        assert_eq!(resolve_exports_entry(&exports, "/missing", true, &[]), None);
    }

    #[test]
    fn resolve_bare_specifier_through_wildcard_exports() {
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
            resolve_bare_specifier("@fixture/wildcard-kit/field", &from_dir.to_string_lossy(), &ResolutionContext::default());
        let root = resolve_bare_specifier("@fixture/wildcard-kit", &from_dir.to_string_lossy(), &ResolutionContext::default());
        let missing =
            resolve_bare_specifier("@fixture/wildcard-kit/absent", &from_dir.to_string_lossy(), &ResolutionContext::default());
        let _ = fs::remove_dir_all(&dir);

        let (resolved, _) = resolved.expect("a `./*` exports pattern must resolve its subpath");
        assert!(
            resolved.ends_with("dist/components/field/index.js"),
            "unexpected resolution: {resolved}"
        );
        let (root, _) = root.expect("the `.` entry must still resolve");
        assert!(root.ends_with("dist/index.js"), "unexpected root: {root}");
        let error = missing.expect_err("an absent pattern target must not resolve");
        assert!(
            error.contains("@fixture/wildcard-kit/absent"),
            "error must name the specifier: {error}"
        );
    }

    #[test]
    fn resolve_system_package() {
        let workspace_root = workspace_root();
        // node_modules/@animus-ui/ lives under the showcase package.
        let showcase_src = workspace_root.join("packages/showcase/src");
        let dir_str = showcase_src.to_string_lossy();
        if !built_artifact_available(
            &workspace_root.join("packages/system/dist/index.js"),
            "resolve_system_package",
        ) {
            return;
        }

        // @animus-ui/system has exports field
        let (path, _) = resolve_bare_specifier("@animus-ui/system", &dir_str, &ResolutionContext::default())
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

        let (path, _) = resolve_bare_specifier("@animus-ui/system/groups", &dir_str, &ResolutionContext::default())
            .expect("built @animus-ui/system/groups subpath must resolve");
        assert!(path.contains("groups"));
    }

    /// A package with no `exports` resolves through `module`, then `main`.
    /// Its own fixture keeps the case independent of any workspace build.
    #[test]
    fn resolve_without_exports_falls_back_to_module_then_main() {
        let dir = scratch_dir("module-main-fallback");
        let package = |name: &str, manifest: &str, files: &[&str]| {
            let root = dir.join("node_modules").join(name);
            write_fixture(&root.join("package.json"), manifest);
            for file in files {
                write_fixture(&root.join(file), "export const x = 1;\n");
            }
        };
        package(
            "with-module",
            r#"{"module": "dist/index.mjs", "main": "dist/index.js"}"#,
            &["dist/index.mjs", "dist/index.js"],
        );
        package("main-only", r#"{"main": "dist/index.js"}"#, &["dist/index.js"]);
        let from = dir.to_string_lossy();

        let (module, _) = resolve_bare_specifier("with-module", &from, &ResolutionContext::default()).expect("module resolves");
        assert!(module.ends_with("with-module/dist/index.mjs"), "{module}");
        let (main, _) = resolve_bare_specifier("main-only", &from, &ResolutionContext::default()).expect("main resolves");
        assert!(main.ends_with("main-only/dist/index.js"), "{main}");
    }

    #[test]
    #[ignore] // requires packages/system/dist — run with --ignored
    fn load_showcase_ds() {
        let workspace_root = workspace_root();
        let root_str = workspace_root.to_string_lossy();
        let ds_path = workspace_root.join("packages/showcase/src/ds.ts");

        assert!(ds_path.is_file(), "showcase ds.ts must exist");

        let system_dist = workspace_root.join("packages/system/dist/index.js");
        if !system_dist.exists() {
            eprintln!(
                "skipping load_showcase_ds: packages/system/dist not built (run bun run build:ts)"
            );
            return;
        }

        let config = load_system_module(&ds_path.to_string_lossy(), &root_str, None, &ResolutionContext::default())
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

    /// A load records what must be watched for its retry: the paths it
    /// looked for ahead of each file it chose (never the winner), every
    /// candidate of an import that names nothing, the nearer
    /// `node_modules/<pkg>` directories a package resolution skipped, and
    /// each file it read, even when it then fails.
    #[test]
    fn a_load_records_the_paths_it_looked_for_and_the_files_it_read() {
        let dir = scratch_dir("load-reads");
        let entry = dir.join("system.ts");
        fs::create_dir_all(dir.join("tokens")).unwrap();
        write_fixture(&dir.join("tokens/index.ts"), "export const tokens = {};\n");
        write_fixture(
            &entry,
            "import { tokens } from './tokens';\n\
             import { palette } from './palette';\n\
             export const system = { tokens, palette };\n",
        );

        let (result, reads) = reach_reading(&entry);

        assert!(result.is_err(), "'./palette' names no file");
        let canonical_dir = fs::canonicalize(&dir).unwrap();
        let path = |rel: &str| canonical_dir.join(rel).to_string_lossy().to_string();
        let lexical = |rel: &str| dir.join(rel).to_string_lossy().to_string();
        assert!(reads.read.contains(&path("system.ts")), "{:?}", reads.read);
        let missing = |rel: &str| reads.missing.iter().any(|p| *p == path(rel) || *p == lexical(rel));
        assert!(missing("tokens.ts"), "{:?}", reads.missing);
        assert!(missing("tokens.tsx"), "candidates ahead of the winner: {:?}", reads.missing);
        assert!(!missing("tokens/index.ts"), "the winner is not absent: {:?}", reads.missing);
        assert!(missing("palette.ts") && missing("palette/index.ts"), "{:?}", reads.missing);

        let kit_entry = dir.join("kit-system.ts");
        write_fixture(
            &kit_entry,
            "import { kit } from '@animus-test/absent-kit';\nexport const system = kit;\n",
        );
        let (kit_result, kit_reads) = reach_reading(&kit_entry);
        assert!(kit_result.is_err(), "the package is not installed");
        assert!(
            kit_reads.missing.iter().any(|p| p.ends_with("node_modules/@animus-test/absent-kit")
                && p.starts_with(&*canonical_dir.to_string_lossy())),
            "{:?}",
            kit_reads.missing
        );
    }

    /// A failed package resolution keeps what it read and looked for: the
    /// manifest (even one that does not parse), an exports target or legacy
    /// entry it found absent, and each nearer `node_modules/<pkg>` it
    /// checked, never the package directory it took.
    #[test]
    fn a_failed_package_resolution_keeps_its_manifest_and_absent_entry() {
        let dir = scratch_dir("failed-package-reads");
        let from = dir.join("src");
        fs::create_dir_all(&from).unwrap();
        let modules = dir.join("node_modules");
        write_fixture(&modules.join("bad/package.json"), "{ broken");
        write_fixture(&modules.join("gone-export/package.json"), r#"{"exports": {".": "./dist/index.js"}}"#);
        write_fixture(&modules.join("gone-main/package.json"), r#"{"main": "lib/main.js"}"#);
        let observe = |specifier: &str| {
            let mut reads = LoadReads::default();
            let result = resolve_bare_specifier_observed(
                specifier,
                &from.to_string_lossy(),
                &ResolutionContext::default(),
                &mut reads,
            );
            assert!(result.is_err(), "{specifier} resolves to nothing");
            reads
        };
        let path = |rel: &str| dir.join(rel).to_string_lossy().to_string();

        let bad = observe("bad");
        assert!(bad.read.contains(&path("node_modules/bad/package.json")), "{:?}", bad.read);
        assert!(bad.missing.contains(&path("src/node_modules/bad")), "{:?}", bad.missing);
        assert!(!bad.missing.contains(&path("node_modules/bad")), "the package taken: {:?}", bad.missing);

        let export = observe("gone-export");
        assert!(export.missing.contains(&path("node_modules/gone-export/dist/index.js")), "{:?}", export.missing);

        let main = observe("gone-main");
        assert!(main.missing.contains(&path("node_modules/gone-main/lib/main.js")), "{:?}", main.missing);
    }

    /// A package entry records the candidates its probe found absent ahead
    /// of the one it took, an extension alias's included.
    #[test]
    fn a_package_entry_records_the_candidates_ahead_of_the_one_taken() {
        let dir = scratch_dir("package-entry-candidates");
        let modules = dir.join("node_modules");
        write_fixture(&modules.join("aliased/package.json"), r#"{"main": "entry.js"}"#);
        write_fixture(&modules.join("aliased/entry.js"), "export {};\n");
        let mut context = ResolutionContext::default();
        context.extensions.alias = vec![(".js".to_string(), vec![".ts".to_string(), ".js".to_string()])];
        let mut reads = LoadReads::default();

        let (resolved, _) =
            resolve_bare_specifier_observed("aliased", &dir.to_string_lossy(), &context, &mut reads).unwrap();

        assert!(resolved.ends_with("aliased/entry.js"), "{resolved}");
        let entry_ts = modules.join("aliased/entry.ts").to_string_lossy().to_string();
        assert!(reads.missing.contains(&entry_ts), "{:?}", reads.missing);
    }
}
