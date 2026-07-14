//! animus extract v2 — parity-gated rewrite spine (skeleton).
//!
//! Increment 03 ships only the dual-build probe surface; the owned-AST
//! store and chain discovery land in increment 04.

#[macro_use]
extern crate napi_derive;


/// Build/probe identity: proves the v2 binary loads and its oxc linkage
/// parses. Consumed by the dual-build verification and the parity harness
/// engine registry.
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
pub mod owned_ast;
pub mod pipeline;
pub mod reconcile;
pub mod chain_merge;
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
    pub global_style_blocks: Option<String>,
    pub keyframes_blocks: Option<String>,
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
        global_style_blocks: config.global_style_blocks,
        keyframes_blocks: config.keyframes_blocks,
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
    /// path → chain descriptors (BTreeMap: deterministic key order across
    /// processes and thread counts — NS6).
    files: BTreeMap<String, Vec<chain_walk::ChainDescriptor>>,
    parse_count: usize,
    diagnostics: Vec<String>,
}

/// Chain discovery over a file set: parse once per file (parallel), walk
/// every stored AST, return owned facts. The v2 spine's first real surface;
/// consumed by the parity comparison tooling.
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

/// Full per-file fact extraction (increment 11): chains + eagerly evaluated
/// stages + statics + raw usage facts + compose families — one parse per
/// file. The store (and every AST) is dropped when this call returns; the
/// D4-relevant invariant is that no program() read happens after
/// cross-file facts resolve.
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
