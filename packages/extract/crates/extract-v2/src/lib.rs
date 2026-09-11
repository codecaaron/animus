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
pub mod eval;
pub mod evaluator;
pub mod facts;
pub mod ids;
pub mod jsx_scan;
pub mod usage_facts;
pub mod chain_walk;
pub mod css;
pub mod cross_file;
pub mod dynamic_meta;
pub mod forced_usage;
pub mod owned_ast;
pub mod pipeline;
pub mod reconcile;
pub mod chain_merge;
pub(crate) mod selector_subject;
pub mod transforms;
pub mod analyze_css;
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
    pub selector_aliases: Option<String>,
    pub selector_order: Option<String>,
    /// Condition alias map JSON (the `conditionAliases` manifest field):
    /// alias → `{ value, order, kind }`. Absent when none are registered.
    pub condition_aliases: Option<String>,
    /// Transform source texts (`{ transformName: sourceText }` JSON): the
    /// only channel by which transforms shipped in a package reach evaluation.
    pub transform_sources: Option<String>,
    pub global_style_blocks: Option<String>,
    pub keyframes_blocks: Option<String>,
    /// Vocabulary witnesses as a JSON array of coded entries; hosts surface
    /// each as a diagnostic keyed by its `code`. Absent when there are none.
    pub vocabulary_witnesses: Option<String>,
    /// Canonical absolute paths of every module evaluated for the system,
    /// sorted; the entry is included, runtime stubs are not.
    pub dependencies: Vec<String>,
    /// Per-module built-theme token manifests, shaped
    /// `{ modulePath: { exportName: [token paths] } }`. Absent when none exist.
    pub source_theme_manifests: Option<String>,
}

#[napi]
pub fn load_system_module(
    system_path: String,
    root_dir: String,
    export_name: Option<String>,
) -> napi::Result<NapiSystemConfig> {
    let config = animus_system_loader::load_system_module(
        &system_path,
        &root_dir,
        export_name.as_deref(),
    )
    .map_err(napi::Error::from_reason)?;

    Ok(NapiSystemConfig {
        prop_config: config.prop_config,
        group_registry: config.group_registry,
        scales_json: config.scales_json,
        variable_map_json: config.variable_map_json,
        variable_css: config.variable_css,
        contextual_vars_json: config.contextual_vars_json,
        selector_aliases: config.selector_aliases,
        selector_order: config.selector_order,
        condition_aliases: config.condition_aliases,
        transform_sources: config.transform_sources,
        global_style_blocks: config.global_style_blocks,
        keyframes_blocks: config.keyframes_blocks,
        vocabulary_witnesses: config.vocabulary_witnesses,
        dependencies: config.dependencies,
        source_theme_manifests: config.source_theme_manifests,
    })
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
