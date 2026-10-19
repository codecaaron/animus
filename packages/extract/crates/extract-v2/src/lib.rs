//! animus extract v2 — NAPI entry points for the extraction spine.

#[macro_use]
extern crate napi_derive;


/// Probe identity: proves the binary loads and its oxc linkage parses.
#[napi]
pub fn engine_version() -> String {
    let counter = owned_ast::ParseCounter::new(0);
    let ast = owned_ast::OwnedAst::parse("probe.mjs".into(), "let x = 1;".into(), &counter);
    format!(
        "v2/skeleton oxc-parse-ok:{}",
        ast.diagnostics.is_empty() && ast.program().body.len() == 1
    )
}

/// This build's identity: a digest of the sources compiled into it, the
/// system loader's included. Two binaries built from the same sources share
/// it; any source change gives another. A host cache keys on it, never on
/// the package version.
#[napi]
pub fn engine_build_id() -> String {
    env!("ANIMUS_ENGINE_BUILD_ID").to_string()
}

/// Every diagnostic code the engine emits, with the severity it carries, as
/// JSON: `{ "animus.chain.unextractable": "warn", … }`. Hosts check codes
/// against it instead of keeping a table of their own.
#[napi]
pub fn diagnostic_codes() -> String {
    analyze_css::diagnostic_codes_json()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oxc_umbrella_links_and_parses() {
        assert_eq!(engine_version(), "v2/skeleton oxc-parse-ok:true");
    }
}

pub mod assemble;
pub mod ast_store;
pub mod emit;
pub mod engine;
mod lower_create_element;
pub mod eval;
pub mod evaluator;
pub mod facts;
pub(crate) mod family_members;
pub mod flow;
pub mod identity;
pub mod ids;
pub mod jsx_scan;
pub(crate) mod keyframe_aliases;
pub mod link;
pub mod loads;
pub mod module_specifiers;
pub mod system_membership;
pub mod usage_facts;
pub mod chain_walk;
pub mod css;
pub(crate) mod css_tokens;
pub mod cross_file;
pub mod declarations;
pub mod dynamic_meta;
pub mod forced_usage;
pub mod owned_ast;
pub mod pipeline;
pub(crate) mod pure_builders;
pub mod slot_provenance;
pub mod property_names;
pub mod reconcile;
pub mod runtime_assets;
pub mod chain_merge;
pub(crate) mod selector_group;
pub(crate) mod selector_subject;
pub mod static_value;
pub mod transforms;
pub mod analyze_css;
pub(crate) mod authoring_rank;
pub mod theme;

use std::collections::BTreeMap;

use serde::Deserialize;

#[napi(object)]
pub struct NapiSystemConfig {
    pub prop_config: String,
    pub group_registry: String,
    pub scales_json: String,
    pub variable_map_json: String,
    pub variable_css: String,
    pub contextual_vars_json: String,
    /// Declaration scales JSON (`{ scale: { kind, members, values } }`);
    /// pass it as `declarationScalesJson`. Absent when the theme has none.
    pub declaration_scales_json: Option<String>,
    /// Declared custom-property records JSON, sorted by name. Absent when
    /// the theme declares none.
    pub property_records_json: Option<String>,
    pub selector_aliases: Option<String>,
    pub selector_order: Option<String>,
    /// Condition alias map JSON (the `conditionAliases` manifest field):
    /// alias → `{ value, order, kind }`. Absent when none are registered.
    pub condition_aliases: Option<String>,
    /// Transform source texts by definition key (`{ transformId: sourceText }`
    /// JSON): the only channel by which configured transforms reach evaluation.
    pub transform_sources: Option<String>,
    /// Host-binding evidence by the same keys (`{ transformId: { hostGlobals:
    /// [names] } | { rejection: reason } }` JSON), from each configured
    /// transform's authored callable; pass it as `transformProvenanceJson`.
    /// A reason completes "its callable …".
    pub transform_provenance: Option<String>,
    pub global_style_blocks: Option<String>,
    pub keyframes_blocks: Option<String>,
    /// Position-try collections (`{ exportName: { key: { name, descriptors }
    /// } }` JSON); pass it as `positionTryJson`. Absent when none are
    /// registered.
    pub position_try_blocks: Option<String>,
    /// View-transition collections (`{ exportName: { key: { name, slots } }
    /// }` JSON); pass it as `viewTransitionsJson`. Absent when none are
    /// registered.
    pub view_transition_blocks: Option<String>,
    /// Vocabulary witnesses as a JSON array of coded entries; hosts surface
    /// each as a diagnostic keyed by its `code`. Absent when there are none.
    pub vocabulary_witnesses: Option<String>,
    /// Canonical absolute paths of every module evaluated for the system, and
    /// of each `package.json` that selected one, sorted; the entry is
    /// included, runtime stubs are not.
    pub dependencies: Vec<String>,
    /// Paths the resolution looked for and found absent, ahead of the file it
    /// chose, sorted: creating one changes what the system loads.
    pub missing: Option<Vec<String>>,
    /// Per-module built-theme token manifests, shaped
    /// `{ modulePath: { exportName: [token paths] } }`. Absent when none exist.
    pub source_theme_manifests: Option<String>,
    /// The load's own findings as one JSON array: each registration in owned
    /// code the system does not reach, which the load did not apply. Absent
    /// when there are none.
    pub load_findings_json: Option<String>,
    /// What the system read that differs from one load to the next (the
    /// clock, `Math.random`), sorted: a host must not reuse this result.
    /// Absent when it read none.
    pub volatile: Option<Vec<String>>,
    /// Each path a resolution named that a link led elsewhere, by the real
    /// path it reached: retargeting the link changes what the system loads.
    /// Absent when no resolution passed through a link.
    /// Sorted by path, so the object's keys come in one order.
    pub links: Option<std::collections::BTreeMap<String, String>>,
}

/// A failed load throws an `Error` carrying `dependencies` (the files it
/// read or attempted) and `missing` (the paths it looked for and found
/// absent), so the host watches them for the retry.
#[napi]
#[allow(clippy::too_many_arguments)]
pub fn load_system_module(
    env: napi::Env,
    system_path: String,
    root_dir: String,
    export_name: Option<String>,
    conditions: Option<Vec<String>>,
    workspaces: Option<std::collections::HashMap<String, String>>,
    extension_policy_json: Option<String>,
    instances: Option<std::collections::HashMap<String, String>>,
) -> napi::Result<NapiSystemConfig> {
    let context = resolution_context(conditions, workspaces, extension_policy_json, instances)
        .map_err(napi::Error::from_reason)?;
    let mut reads = animus_system_loader::LoadReads::default();
    let config = match animus_system_loader::load_system_module_reading(
        &system_path,
        &root_dir,
        export_name.as_deref(),
        &context,
        &mut reads,
    ) {
        Ok(config) => config,
        Err(message) => return Err(load_failure(&env, message, reads)),
    };

    Ok(NapiSystemConfig {
        prop_config: config.prop_config,
        group_registry: config.group_registry,
        scales_json: config.scales_json,
        variable_map_json: config.variable_map_json,
        variable_css: config.variable_css,
        contextual_vars_json: config.contextual_vars_json,
        declaration_scales_json: config.declaration_scales_json,
        property_records_json: config.property_records_json,
        selector_aliases: config.selector_aliases,
        selector_order: config.selector_order,
        condition_aliases: config.condition_aliases,
        transform_sources: config.transform_sources,
        transform_provenance: config.transform_provenance,
        global_style_blocks: config.global_style_blocks,
        keyframes_blocks: config.keyframes_blocks,
        position_try_blocks: config.position_try_blocks,
        view_transition_blocks: config.view_transition_blocks,
        vocabulary_witnesses: config.vocabulary_witnesses,
        dependencies: config.dependencies,
        missing: Some(config.missing),
        source_theme_manifests: config.source_theme_manifests,
        load_findings_json: config.load_findings_json,
        volatile: (!config.volatile.is_empty()).then_some(config.volatile),
        links: (!config.links.is_empty()).then_some(config.links),
    })
}

/// The `Error` a failed load throws, with what it read and looked for.
fn load_failure(env: &napi::Env, message: String, reads: animus_system_loader::LoadReads) -> napi::Error {
    use napi::bindgen_prelude::JsObjectValue;
    use napi::JsValue;
    let build = || -> napi::Result<napi::Error> {
        let mut error = env.create_error(napi::Error::from_reason(message.clone()))?;
        error.set_named_property("dependencies", reads.read.iter().cloned().collect::<Vec<_>>())?;
        error.set_named_property("missing", reads.missing.iter().cloned().collect::<Vec<_>>())?;
        if !reads.findings.is_empty() {
            let findings = serde_json::to_string(&reads.findings).map_err(|e| napi::Error::from_reason(e.to_string()))?;
            error.set_named_property("loadFindingsJson", findings)?;
        }
        Ok(napi::Error::from(error.to_unknown()))
    };
    build().unwrap_or_else(|_| napi::Error::from_reason(message))
}

/// The host's export conditions, in its order, the session root's declared
/// workspace packages (name → canonical directory), which a package lookup
/// consults after `node_modules`, the host's extension order as JSON
/// (`{ appended, nodeNext }`), the built-in policy when absent, and the
/// instance the host resolves each kit to, by package name.
fn resolution_context(
    conditions: Option<Vec<String>>,
    workspaces: Option<std::collections::HashMap<String, String>>,
    extension_policy_json: Option<String>,
    instances: Option<std::collections::HashMap<String, String>>,
) -> Result<animus_system_loader::ResolutionContext, String> {
    Ok(animus_system_loader::ResolutionContext {
        conditions: conditions.unwrap_or_default(),
        workspaces: workspaces
            .unwrap_or_default()
            .into_iter()
            .map(|(name, dir)| (name, std::path::PathBuf::from(dir)))
            .collect(),
        extensions: match extension_policy_json {
            Some(json) => serde_json::from_str(&json).map_err(|error| format!("invalid extension policy: {error}"))?,
            None => animus_system_loader::resolution::extension_policy().clone(),
        },
        instances: instances
            .unwrap_or_default()
            .into_iter()
            .map(|(name, dir)| (name, std::path::PathBuf::from(dir)))
            .collect(),
    })
}

/// A specifier as the system loader resolves it: the real path of the file
/// it names, with that of the `package.json` that selected it for a
/// package, or why it names none.
#[napi(object)]
pub struct NapiResolvedSpecifier {
    pub path: Option<String>,
    pub manifest: Option<String>,
    pub unresolved: Option<String>,
}

/// Resolves `specifier` from `from_dir` as the system loader resolves its
/// imports, so a host lane can resolve a file or package the way a system's
/// evaluation does: a relative or absolute path through the extension
/// policy; a package through `exports` (its `animus` source condition, then
/// `conditions`, `import` and `default`), then `module`, then `main`.
#[napi]
pub fn resolve_specifier(
    specifier: String,
    from_dir: String,
    conditions: Option<Vec<String>>,
    workspaces: Option<std::collections::HashMap<String, String>>,
    extension_policy_json: Option<String>,
    instances: Option<std::collections::HashMap<String, String>>,
) -> NapiResolvedSpecifier {
    // One call lists each directory it checks once, as a system load does.
    NapiResolvedSpecifier::from(resolution_context(conditions, workspaces, extension_policy_json, instances).and_then(|context| {
        animus_system_loader::resolution::with_listing_cache(|| {
            animus_system_loader::resolve_specifier(&specifier, &from_dir, &context)
        })
    }))
}

/// The directory of the package `name` as the system loader locates it from
/// `from_dir` (the first `node_modules/<name>` up the tree, then the declared
/// `workspaces`), at its real path, as host resolvers report a linked
/// package; null where it locates none.
#[napi]
pub fn locate_package(
    name: String,
    from_dir: String,
    workspaces: Option<std::collections::HashMap<String, String>>,
) -> Option<String> {
    let context = resolution_context(None, workspaces, None, None).ok()?;
    let dir = animus_system_loader::locate_package(&name, &from_dir, &context).ok()?;
    Some(std::fs::canonicalize(&dir).unwrap_or(dir).to_string_lossy().to_string())
}

/// The built-in extension policy, as JSON (`{ appended, nodeNext, alias }`):
/// the order in which a relative or aliased specifier's candidate files are
/// tried wherever a host names none.
#[napi]
pub fn built_in_extension_policy() -> String {
    serde_json::to_string(animus_system_loader::resolution::extension_policy())
        .expect("the extension policy serializes")
}

/// The files `base` can name, in the order the policy tries them
/// (`extension_policy_json`, the built-in one when absent): with `sources`,
/// only those extensions, and with `joined_index`, a base ending in `/`
/// names its index without another `/`.
#[napi]
pub fn specifier_candidates(
    base: String,
    extension_policy_json: Option<String>,
    sources: Option<Vec<String>>,
    joined_index: Option<bool>,
) -> napi::Result<Vec<String>> {
    let context = resolution_context(None, None, extension_policy_json, None).map_err(napi::Error::from_reason)?;
    Ok(context.extensions.candidates_among(&base, sources.as_deref(), joined_index.unwrap_or(false)))
}

/// What the filesystem holds at `candidate`, spelled exactly below the
/// directory it shares with `within` (from the root when absent): `file`,
/// `case-only` with the spelling the filesystem reports (`actual`), or
/// `missing`.
#[napi(object)]
pub struct NapiSeenFile {
    pub kind: String,
    pub actual: Option<String>,
}

#[napi]
pub fn see_file(candidate: String, within: Option<String>) -> NapiSeenFile {
    use animus_system_loader::resolution::Seen;
    let within = std::path::PathBuf::from(within.unwrap_or_default());
    match animus_system_loader::resolution::see_within(&within, &candidate) {
        Seen::File => NapiSeenFile { kind: "file".into(), actual: None },
        Seen::CaseOnly(actual) => NapiSeenFile { kind: "case-only".into(), actual: Some(actual) },
        Seen::Missing => NapiSeenFile { kind: "missing".into(), actual: None },
    }
}

/// How a probe of `candidates` ends, below `within` as [`see_file`] reads
/// it: `found` at `path`, `case-mismatch` at the first `candidate` the
/// filesystem opens only under another spelling (`actual`), or `absent`.
#[napi(object)]
pub struct NapiProbedFile {
    pub kind: String,
    pub path: Option<String>,
    pub candidate: Option<String>,
    pub actual: Option<String>,
}

#[napi]
pub fn probe_file(candidates: Vec<String>, within: Option<String>) -> NapiProbedFile {
    use animus_system_loader::resolution::{probe_candidates, see_within, Probe};
    let within = std::path::PathBuf::from(within.unwrap_or_default());
    match probe_candidates(candidates, |candidate| see_within(&within, candidate)) {
        Probe::Found(path) => NapiProbedFile { kind: "found".into(), path: Some(path), candidate: None, actual: None },
        Probe::CaseMismatch { candidate, actual } => NapiProbedFile {
            kind: "case-mismatch".into(),
            path: None,
            candidate: Some(candidate),
            actual: Some(actual),
        },
        Probe::Absent => NapiProbedFile { kind: "absent".into(), path: None, candidate: None, actual: None },
    }
}

/// A fast fingerprint of the bytes at `path` (foldhash, 64 bits, hex), for
/// telling whether a file changed between watch passes in one process: no
/// security property, and no stability across versions. `None` where the
/// file cannot be read.
#[napi]
pub fn fingerprint_file(path: String) -> Option<String> {
    std::fs::read(&path).ok().map(|bytes| fingerprint(&bytes))
}

/// `fingerprint_file` of bytes already read, so a reader that keeps them
/// fingerprints exactly what it kept.
#[napi]
pub fn fingerprint_bytes(bytes: napi::bindgen_prelude::Buffer) -> String {
    fingerprint(&bytes)
}

fn fingerprint(bytes: &[u8]) -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = foldhash::quality::FixedState::with_seed(0).build_hasher();
    hasher.write(bytes);
    format!("{:016x}", hasher.finish())
}

/// Whether the package at `package_dir` declares the kit source condition:
/// an `animus` key anywhere in its `exports`, valid or not, read from the
/// manifest alone.
#[napi]
pub fn declares_kit_source(package_dir: String) -> bool {
    animus_system_loader::declares_kit_source(std::path::Path::new(&package_dir))
}

/// A kit's source root (spec §2.2 A5), as JSON: the package located from
/// `from_dir` as the system loader locates it, the rule that chose the root
/// (`animus`, `source-exports`, `src` or `compiled`), its entries, its
/// invalid `animus` targets, and the runtime entry (`host_entry`, the file
/// the host resolves, where given); or `{ "unresolved": why }` where no host
/// imports the specifier. `package_dir` is the package discovery located,
/// where it located one.
#[napi]
#[allow(clippy::too_many_arguments)]
pub fn resolve_kit_source_root(
    specifier: String,
    from_dir: String,
    conditions: Option<Vec<String>>,
    workspaces: Option<std::collections::HashMap<String, String>>,
    extension_policy_json: Option<String>,
    host_entry: Option<String>,
    package_dir: Option<String>,
    sources: Option<Vec<String>>,
) -> String {
    // One call lists each directory it checks once, as a system load does.
    let found = resolution_context(conditions, workspaces, extension_policy_json, None).and_then(|context| {
        animus_system_loader::resolution::with_listing_cache(|| {
            animus_system_loader::resolve_kit_source_root(
                &specifier,
                &from_dir,
                &context,
                host_entry.as_deref(),
                package_dir.as_deref(),
                sources.as_deref(),
            )
        })
    });
    match found {
        Ok(root) => serde_json::to_string(&root).unwrap_or_else(|e| serde_json::json!({ "unresolved": e.to_string() }).to_string()),
        Err(reason) => serde_json::json!({ "unresolved": reason }).to_string(),
    }
}

impl From<Result<(std::path::PathBuf, Option<std::path::PathBuf>), String>> for NapiResolvedSpecifier {
    fn from(result: Result<(std::path::PathBuf, Option<std::path::PathBuf>), String>) -> Self {
        match result {
            Ok((path, manifest)) => Self {
                path: Some(path.to_string_lossy().to_string()),
                manifest: manifest.map(|manifest| manifest.to_string_lossy().to_string()),
                unresolved: None,
            },
            Err(reason) => Self { path: None, manifest: None, unresolved: Some(reason) },
        }
    }
}

#[derive(Deserialize)]
struct InputEntry {
    path: String,
    source: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverResult {
    /// path → chain descriptors. BTreeMap: key order must be deterministic
    /// across processes and thread counts.
    files: BTreeMap<String, Vec<chain_walk::ChainDescriptor>>,
    parse_count: usize,
    diagnostics: Vec<String>,
}

/// Chain discovery over a file set: one parse per file, then one walk per
/// stored AST.
#[napi]
pub fn discover_chains(file_entries_json: String) -> napi::Result<String> {
    let entries: Vec<InputEntry> = serde_json::from_str(&file_entries_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid file entries JSON: {e}")))?;

    let store = ast_store::AstStore::build(
        entries
            .into_iter()
            .map(|e| ast_store::FileEntry {
                path: e.path,
                source: e.source,
            })
            .collect(),
    );

    let mut files = BTreeMap::new();
    let mut diagnostics = Vec::new();
    for ast in store.iter() {
        for d in &ast.diagnostics {
            diagnostics.push(format!("{}|parse|{}", ast.path, d));
        }
        files.insert(ast.path.clone(), chain_walk::walk_program(ast.program()));
    }
    diagnostics.sort();

    let result = DiscoverResult {
        files,
        parse_count: store.parse_count(),
        diagnostics,
    };
    serde_json::to_string(&result)
        .map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FactsResult {
    files: BTreeMap<String, facts::FileFacts>,
    parse_count: usize,
}

/// Each file's run-time module specifiers: imports, re-exports and literal
/// `import()` calls that survive type stripping. With `path_aliases_json`,
/// each non-relative specifier a path alias names also maps to the path
/// analysis probes for it (`probe_base`'s `expand_alias`), so a host
/// comparison reads the analysis's own expansion. `{ "files": { path: [specifier, …] }, "bases": { path:
/// { specifier: base } } }`.
#[napi]
pub fn module_specifiers(file_entries_json: String, path_aliases_json: Option<String>) -> napi::Result<String> {
    let aliases = analyze_css::parse_path_aliases(path_aliases_json.as_deref()).map_err(napi::Error::from_reason)?;
    let entries: Vec<InputEntry> = serde_json::from_str(&file_entries_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid file entries JSON: {e}")))?;
    let store = ast_store::AstStore::build(
        entries
            .into_iter()
            .map(|e| ast_store::FileEntry {
                path: e.path,
                source: e.source,
            })
            .collect(),
    );
    let files: BTreeMap<String, Vec<String>> = store
        .iter()
        .map(|ast| (ast.path.clone(), module_specifiers::runtime_specifiers(ast.program())))
        .collect();
    let bases: BTreeMap<&String, BTreeMap<&String, String>> = files
        .iter()
        .map(|(path, specifiers)| {
            let aliased = specifiers
                .iter()
                .filter(|specifier| !specifier.starts_with('.'))
                .filter_map(|specifier| analyze_css::expand_alias(specifier, &aliases).map(|base| (specifier, base)))
                .collect();
            (path, aliased)
        })
        .collect();
    serde_json::to_string(&serde_json::json!({ "files": files, "bases": bases }))
        .map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
}

/// Which kits a system file's roots extend or include, from the engine's
/// own parse (`system_membership`). `inputs_json` is `{ system, files:
/// { path: source }, resolved: { "importer\0specifier": { file?, why?,
/// caseMismatch? } } }`; the result lists `needs` until every module its
/// identities follow is supplied.
#[napi]
pub fn system_membership(inputs_json: String) -> napi::Result<String> {
    let inputs: system_membership::MembershipInputs = serde_json::from_str(&inputs_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid membership inputs JSON: {e}")))?;
    serde_json::to_string(&system_membership::system_membership(&inputs))
        .map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ModuleFactsResult {
    files: BTreeMap<String, facts::ModuleFacts>,
    parse_count: usize,
}

/// The facts source ingestion and package discovery read, one parse per
/// file: `extractFacts`'s wire without the statics, usage and object facts
/// it also computes (`facts::ModuleFacts`).
#[napi]
pub fn extract_module_facts(file_entries_json: String) -> napi::Result<String> {
    let entries: Vec<InputEntry> = serde_json::from_str(&file_entries_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid file entries JSON: {e}")))?;
    let store = ast_store::AstStore::build(
        entries.into_iter().map(|e| ast_store::FileEntry { path: e.path, source: e.source }).collect(),
    );
    let files = store.iter().map(|ast| (ast.path.clone(), facts::extract_module_facts(ast))).collect();
    serde_json::to_string(&ModuleFactsResult { files, parse_count: store.parse_count() })
        .map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
}

/// What one file of a package the analysis does not read loads: each
/// specifier a runtime `import`, re-export, `import()` or load call names,
/// and why the file may load any module, if it may.
#[derive(serde::Serialize)]
struct PackageFileLoads {
    specifiers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    open: Option<String>,
}

/// What each file of a package the analysis does not read loads, so the
/// host can judge whether the package reaches only what its manifest
/// declares. A file may load any module through a computed load, code from
/// a string, an escaped loader, or a source that does not parse.
#[napi]
pub fn package_loads(file_entries_json: String) -> napi::Result<String> {
    use crate::loads::{LoadKind, LoadTarget};
    let entries: Vec<InputEntry> = serde_json::from_str(&file_entries_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid file entries JSON: {e}")))?;
    let store = ast_store::AstStore::build(
        entries.into_iter().map(|e| ast_store::FileEntry { path: e.path, source: e.source }).collect(),
    );
    let files: BTreeMap<String, PackageFileLoads> = store
        .iter()
        .map(|ast| {
            let program = ast.program();
            let mut specifiers = std::collections::BTreeSet::new();
            let mut open = (ast.panicked || !ast.diagnostics.is_empty()).then(|| "does not parse".to_string());
            for load in crate::loads::collect(program) {
                if matches!(load.kind, LoadKind::Import { runtime: false, .. } | LoadKind::Reexport { runtime: false }) {
                    continue;
                }
                match load.target {
                    LoadTarget::Specifier(specifier) => {
                        specifiers.insert(specifier);
                    }
                    _ => {
                        open.get_or_insert_with(|| "makes a computed load".to_string());
                    }
                }
            }
            let scoping = oxc::semantic::SemanticBuilder::new().build(program).semantic.into_scoping();
            let escape = crate::usage_facts::dynamic_code(program, &scoping)
                .or_else(|| crate::usage_facts::loader_escape(program, &scoping));
            if let Some(how) = escape {
                open.get_or_insert_with(|| how.to_string());
            }
            (ast.path.clone(), PackageFileLoads { specifiers: specifiers.into_iter().collect(), open })
        })
        .collect();
    serde_json::to_string(&files).map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
}

/// Full per-file fact extraction, one parse per file. The store and its
/// ASTs drop on return: no `program()` read survives cross-file resolve.
#[napi]
pub fn extract_facts(file_entries_json: String) -> napi::Result<String> {
    let entries: Vec<InputEntry> = serde_json::from_str(&file_entries_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid file entries JSON: {e}")))?;

    let store = ast_store::AstStore::build(
        entries
            .into_iter()
            .map(|e| ast_store::FileEntry {
                path: e.path,
                source: e.source,
            })
            .collect(),
    );

    let mut files = BTreeMap::new();
    for ast in store.iter() {
        files.insert(ast.path.clone(), facts::extract_file_facts(ast));
    }

    let result = FactsResult {
        files,
        parse_count: store.parse_count(),
    };
    serde_json::to_string(&result)
        .map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
}
