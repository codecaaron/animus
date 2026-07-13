//! Project-level CSS orchestration (row 07 Task 07.6): v1
//! `project_analyzer::analyze` Phases 3–6 reimplemented over retained
//! FACTS — no AST access, no re-parse (v1 re-parses every file for JSX
//! scanning; v2 filters the usage facts collected at parse time).
//!
//! Bug-compat mirrors (v1 project_analyzer line refs):
//!  - eval failures drop the component SILENTLY (967-969: no diagnostic);
//!  - cycle in extension provenance ⇒ the ordering degrades to the
//!    lexically-sorted non-cyclic set (700-712) — not a re-topo;
//!  - usage configs only track variant props WITH a default (982-1001),
//!    but every evaluated binding is inserted (1006-1010);
//!  - inline-transform custom props are forced onto the dynamic path and
//!    filtered from BOTH static utility streams (1302-1316, 1335-1353);
//!  - .asClass() chains and ALL compose slots are unconditionally
//!    rendered; shared variant keys pre-populate child-slot usage
//!    (1514-1559);
//!  - dev_mode retains all components and reports prospective
//!    eliminations only (1584-1602).
//!
//! Known input gaps (fail-visible, journaled): global style blocks and
//! keyframes blocks are not yet engine inputs — `sheets.global` stays
//! empty; extension parents are resolved from direct relative imports or
//! same-file chains (v1's full import_resolver also follows re-exports).

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;

use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::Value;

use crate::chain_merge::{topological_sort, ProvenanceNode, TopoResult};
use crate::chain_walk::TerminalKind;
use crate::css::{
    build_variable_slot_entries, camel_to_kebab, generate_composed_variant_css,
    generate_css_sheets_ordered, generate_custom_prop_css, generate_utility_css, layer_name,
    BreakpointMap, ComponentCss, ComposeFamilyRef, CssFragmentStore, CssSheets, UtilityInput,
    VariantCss,
};
use crate::dynamic_meta::DynamicPropMeta;
use crate::evaluator::TransformEvaluator;
use crate::facts::FileFacts;
use crate::jsx_scan::{ComponentUsageConfig, DynamicPropUsage, UsageScanResult};
use crate::pipeline::process_chain_facts;
use crate::reconcile::{build_ledger, identify_prospective_eliminations, reconcile};
use crate::theme::{
    ContextualVarsMap, FlatTheme, PropConfigMap, ResolveContext, ResolvedStyles,
    SelectorAliasesMap, VariableMap,
};

/// v1 project_analyzer AliasType/AliasEntry VERBATIM serde shapes.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AliasType {
    Prefix,
    Exact,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AliasEntry {
    pub pattern: String,
    pub replacement: String,
    #[serde(rename = "type")]
    pub alias_type: AliasType,
}

/// v1 expand_alias VERBATIM (project_analyzer 132-150): first match in
/// GIVEN order (v1 does not sort at parse).
pub fn expand_alias(source: &str, aliases: &[AliasEntry]) -> Option<String> {
    for alias in aliases {
        match alias.alias_type {
            AliasType::Exact => {
                if source == alias.pattern {
                    return Some(alias.replacement.clone());
                }
            }
            AliasType::Prefix => {
                if source.starts_with(&alias.pattern) {
                    let rest = &source[alias.pattern.len()..];
                    return Some(format!("{}{}", alias.replacement, rest));
                }
            }
        }
    }
    None
}

/// Parsed configuration/theme inputs (EngineOptions JSON blobs → owned
/// maps; parsed ONCE at engine construction, fail-loud).
#[derive(Default)]
pub struct CssInputs {
    pub theme: FlatTheme,
    pub variable_map: VariableMap,
    pub contextual_vars: ContextualVarsMap,
    pub config: PropConfigMap,
    pub group_registry: FxHashMap<String, Vec<String>>,
    pub selector_aliases: SelectorAliasesMap,
    /// v1 `global_style_blocks_json` (resolved into sheets.global).
    pub global_style_blocks: Option<Value>,
    /// v1 `keyframes_blocks_json` (keyframes registry + global CSS).
    pub keyframes_blocks: Option<Value>,
    /// v1 `package_resolution_json`: import source → resolved path.
    pub package_map: FxHashMap<String, String>,
    /// v1 `path_aliases_json` (`{aliases: [...]}` wrapper), given order.
    pub path_aliases: Vec<AliasEntry>,
    pub dev_mode: bool,
}

impl CssInputs {
    #[allow(clippy::too_many_arguments)]
    pub fn from_json(
        theme_json: Option<&str>,
        variable_map_json: Option<&str>,
        contextual_vars_json: Option<&str>,
        config_json: Option<&str>,
        group_registry_json: Option<&str>,
        selector_aliases_json: Option<&str>,
        global_style_blocks_json: Option<&str>,
        keyframes_json: Option<&str>,
        package_resolution_json: Option<&str>,
        path_aliases_json: Option<&str>,
        dev_mode: bool,
    ) -> Result<Self, String> {
        fn parse<T: serde::de::DeserializeOwned + Default>(
            name: &str,
            json: Option<&str>,
        ) -> Result<T, String> {
            match json {
                None => Ok(T::default()),
                Some(s) if s.trim().is_empty() || s.trim() == "null" => Ok(T::default()),
                Some(s) => serde_json::from_str(s)
                    .map_err(|e| format!("EngineOptions.{name}: invalid JSON — {e}")),
            }
        }
        fn parse_opt_value(name: &str, json: Option<&str>) -> Result<Option<Value>, String> {
            match json {
                None => Ok(None),
                Some(s) if s.trim().is_empty() || s.trim() == "null" => Ok(None),
                Some(s) => serde_json::from_str(s)
                    .map(Some)
                    .map_err(|e| format!("EngineOptions.{name}: invalid JSON — {e}")),
            }
        }
        // v1 lib.rs 877-888: `{aliases: [...]}` wrapper, silently-empty on
        // parse failure in v1 — v2 fails loud instead (G5).
        let path_aliases = match path_aliases_json {
            None => Vec::new(),
            Some(s) if s.trim().is_empty() || s.trim() == "null" => Vec::new(),
            Some(s) => {
                #[derive(serde::Deserialize)]
                struct AliasWrapper {
                    aliases: Vec<AliasEntry>,
                }
                serde_json::from_str::<AliasWrapper>(s)
                    .map(|w| w.aliases)
                    .map_err(|e| format!("EngineOptions.pathAliasesJson: invalid JSON — {e}"))?
            }
        };
        Ok(CssInputs {
            theme: parse("themeJson", theme_json)?,
            variable_map: parse("variableMapJson", variable_map_json)?,
            contextual_vars: parse("contextualVarsJson", contextual_vars_json)?,
            config: parse("configJson", config_json)?,
            group_registry: parse("groupRegistryJson", group_registry_json)?,
            selector_aliases: parse("selectorAliasesJson", selector_aliases_json)?,
            global_style_blocks: parse_opt_value("globalStyleBlocksJson", global_style_blocks_json)?,
            keyframes_blocks: parse_opt_value("keyframesJson", keyframes_json)?,
            package_map: parse("packageResolutionJson", package_resolution_json)?,
            path_aliases,
            dev_mode,
        })
    }
}

/// v1 manifest ComponentDescriptor (project_analyzer 1784-1793), the
/// plugin-consumed subset — field names match v1's serde output.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ComponentDescriptor {
    pub file: String,
    pub binding: String,
    pub class_name: String,
    pub extends_from: Option<String>,
    pub terminal: String,
    pub tag: String,
    pub replacement: String,
    pub system_prop_names: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CssDiagnostic {
    pub file: String,
    pub component: String,
    pub kind: String,
    pub message: String,
}

pub struct CssOutput {
    pub css: String,
    pub sheets: CssSheets,
    pub fragments: CssFragmentStore,
    pub diagnostics: Vec<CssDiagnostic>,
    pub reconciliation: Value,
    /// component_id → config-dependent replacement payloads (v1 Phase
    /// 5c/6 equivalents; consumed by engine.transform_file).
    pub replacement_configs: FxHashMap<String, crate::assemble::ReplacementPayload>,
    /// v1 manifest `system_prop_map` (utility class_map; key-sorted).
    pub system_prop_map: BTreeMap<String, BTreeMap<String, String>>,
    /// v1 manifest `dynamic_props` (global dynamic prop metadata; sorted).
    pub dynamic_props: BTreeMap<String, DynamicPropMeta>,
    /// v1 manifest `component_fragments` (per-component sheet fragments).
    pub component_fragments: BTreeMap<String, crate::css::PerComponentSheets>,
    /// v1 manifest `reverse_provenance` (parent → direct children, sorted).
    pub reverse_provenance: BTreeMap<String, Vec<String>>,
    /// v1 manifest `components` (id → descriptor; evaluated survivors).
    pub components: BTreeMap<String, ComponentDescriptor>,
    /// v1 manifest `files` (path → [component_ids]; evaluated survivors).
    pub files_map: BTreeMap<String, Vec<String>>,
}

/// v1 lib.rs:748 verbatim: breakpoints live under `breakpoints.` theme keys.
pub fn extract_breakpoints(theme: &FlatTheme) -> BreakpointMap {
    let mut bps = FxHashMap::default();
    for (key, value) in theme {
        if key.starts_with("breakpoints.") {
            let bp_name = key.strip_prefix("breakpoints.").unwrap();
            if let Ok(px) = value.parse::<u32>() {
                bps.insert(bp_name.to_string(), px);
            }
        }
    }
    BreakpointMap::new(bps)
}

/// v1 project_analyzer:2117 verbatim.
fn extract_layer_content(layer_block: &str) -> String {
    let trimmed = layer_block.trim();
    if let Some(start) = trimmed.find('{') {
        let after_brace = &trimmed[start + 1..];
        if let Some(end) = after_brace.rfind('}') {
            return after_brace[..end].to_string();
        }
    }
    String::new()
}

/// Resolve a relative import specifier against the analyzed file set.
/// Covers direct-relative parents; v1's import_resolver additionally
/// follows re-exports and path aliases (journaled gap).
pub fn resolve_import_source<T>(
    from_file: &str,
    spec: &str,
    files: &BTreeMap<String, T>,
    inputs: &CssInputs,
) -> Option<String> {
    // v1 resolve_path order (project_analyzer 528-536): relative →
    // expand_alias + probe → package-map lookup (path returned
    // UNCONDITIONALLY — a non-project path becomes a dangling external
    // root and the child stays standalone).
    if !spec.starts_with('.') {
        if let Some(expanded) = expand_alias(spec, &inputs.path_aliases) {
            return probe_files(&expanded, files);
        }
        return inputs.package_map.get(spec).cloned();
    }
    let dir: Vec<&str> = match from_file.rfind('/') {
        Some(pos) => from_file[..pos].split('/').collect(),
        None => Vec::new(),
    };
    let mut parts: Vec<&str> = dir;
    for seg in spec.split('/') {
        match seg {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    let base = parts.join("/");
    probe_files(&base, files)
}

/// v1 probe_known_files order EXACTLY (project_analyzer 2027-2047):
/// bare, .ts, .tsx, .js, .jsx, /index.ts, /index.tsx, /index.js,
/// /index.jsx — a sibling .ts/.tsx pair must resolve to the SAME parent
/// v1 picks (inc-07 review F3).
fn probe_files<T>(base: &str, files: &BTreeMap<String, T>) -> Option<String> {
    let candidates = [
        base.to_string(),
        format!("{base}.ts"),
        format!("{base}.tsx"),
        format!("{base}.js"),
        format!("{base}.jsx"),
        format!("{base}/index.ts"),
        format!("{base}/index.tsx"),
        format!("{base}/index.js"),
        format!("{base}/index.jsx"),
    ];
    candidates.into_iter().find(|c| files.contains_key(c))
}

/// Follow re-export chains (v1 import_resolver resolve_bindings): from
/// (file, exported name), hop through `export {{ X as Y }} from '...'`
/// links until a file that defines the name locally (or has no matching
/// re-export). Cycle-guarded; unresolvable hops stop at the last node
/// (dangling — v1 keeps the child standalone).
pub fn follow_reexports(
    mut file: String,
    mut name: String,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> (String, String) {
    let mut seen: FxHashSet<(String, String)> = FxHashSet::default();
    while seen.insert((file.clone(), name.clone())) {
        let Some(ff) = files.get(&file) else { break };
        let Some(exp) = ff
            .exports
            .iter()
            .find(|e| e.exported == name && e.source.is_some())
        else {
            break;
        };
        let (Some(spec), Some(original)) = (&exp.source, &exp.original) else { break };
        let Some(next) = resolve_import_source(&file, spec, files, inputs) else { break };
        name = original.clone();
        file = next;
    }
    (file, name)
}

pub fn run(
    files: &BTreeMap<String, FileFacts>,
    order: &[String],
    inputs: &CssInputs,
    class_prefix: &str,
) -> CssOutput {
    let breakpoints = extract_breakpoints(&inputs.theme);
    let bp_keys: FxHashSet<String> = breakpoints.breakpoints.keys().cloned().collect();
    let evaluator = TransformEvaluator::new();
    let mut diagnostics: Vec<CssDiagnostic> = Vec::new();

    // Register extracted createTransform sources (v1 750-762) — INPUT
    // order, so cross-file name collisions keep last-registration-wins.
    for path in order {
        let Some(ff) = files.get(path) else { continue };
        for t in &ff.transforms {
            if t.valid {
                if let Err(err) = evaluator.register(&t.name, &t.source) {
                    diagnostics.push(CssDiagnostic {
                        file: t.file.clone(),
                        component: format!("createTransform('{}')", t.name),
                        kind: "warn".to_string(),
                        message: format!("Failed to register transform in evaluator: {}", err),
                    });
                }
            }
        }
    }

    // Invalid-transform bail diagnostics (v1 1928-1940; emitted at
    // manifest build in v1 — multiset position is what the harness
    // compares, so emission point here is equivalent).
    for path in order {
        let Some(ff) = files.get(path) else { continue };
        for t in &ff.transforms {
            if !t.valid {
                for diag in &t.diagnostics {
                    diagnostics.push(CssDiagnostic {
                        file: t.file.clone(),
                        component: format!("createTransform('{}')", t.name),
                        kind: "bail".to_string(),
                        message: diag.clone(),
                    });
                }
            }
        }
    }

    let resolve_ctx = ResolveContext {
        config: &inputs.config,
        theme: &inputs.theme,
        variable_map: &inputs.variable_map,
        contextual_vars: &inputs.contextual_vars,
        breakpoint_keys: &bp_keys,
        selector_aliases: &inputs.selector_aliases,
        transform_evaluator: Some(&evaluator),
    };

    // -- Phase 3 mirror: extension provenance -------------------------------
    let mut parent_map: FxHashMap<String, String> = FxHashMap::default();
    let mut unresolvable_extensions: FxHashSet<String> = FxHashSet::default();
    let has_extractable = |file: &str, binding: &str| -> bool {
        files.get(file).is_some_and(|ff| {
            ff.chains
                .iter()
                .any(|c| c.descriptor.binding == binding && c.descriptor.extractable)
        })
    };
    for (file_path, ff) in files {
        for chain in &ff.chains {
            let d = &chain.descriptor;
            if !d.extractable {
                if let Some(reason) = &d.bail_reason {
                    diagnostics.push(CssDiagnostic {
                        file: file_path.clone(),
                        component: d.binding.clone(),
                        kind: "bail".to_string(),
                        message: reason.clone(),
                    });
                }
                continue;
            }
            let component_id = format!("{}::{}", file_path, d.binding);
            if let Some(extends_binding) = &d.extends_from {
                let imported = ff.imports.iter().find(|i| &i.local == extends_binding);
                let resolved = match imported {
                    // v1 binding_map records ANY resolvable export — no
                    // chain check; a parent id that never evaluates is an
                    // external root in the topo and the child is kept
                    // STANDALONE, not dropped (inc-07 review F3).
                    Some(imp) => resolve_import_source(file_path, &imp.source, files, inputs)
                        .map(|f| {
                            let (pf, pn) =
                                follow_reexports(f, imp.imported.clone(), files, inputs);
                            format!("{}::{}", pf, pn)
                        }),
                    None => {
                        if has_extractable(file_path, extends_binding) {
                            Some(format!("{}::{}", file_path, extends_binding))
                        } else {
                            None
                        }
                    }
                };
                match resolved {
                    Some(parent_id) => {
                        parent_map.insert(component_id, parent_id);
                    }
                    None => {
                        unresolvable_extensions.insert(component_id);
                    }
                }
            }
        }
    }

    // -- Phase 4 mirror: topological sort ------------------------------------
    let mut all_component_ids: Vec<String> = Vec::new();
    for (file_path, ff) in files {
        for chain in &ff.chains {
            if chain.descriptor.extractable {
                let id = format!("{}::{}", file_path, chain.descriptor.binding);
                if !unresolvable_extensions.contains(&id) {
                    all_component_ids.push(id);
                }
            }
        }
    }
    all_component_ids.sort();
    let nodes: Vec<ProvenanceNode> = all_component_ids
        .iter()
        .map(|id| ProvenanceNode {
            component_id: id.clone(),
            parent_id: parent_map.get(id).cloned(),
        })
        .collect();
    let sorted_ids = match topological_sort(&nodes) {
        TopoResult::Sorted(order) => order,
        TopoResult::Cycle(cycle_ids) => {
            let cycle_set: FxHashSet<&String> = cycle_ids.iter().collect();
            all_component_ids
                .iter()
                .filter(|id| !cycle_set.contains(id))
                .cloned()
                .collect()
        }
    };

    // chain lookup: id → (file, chain index)
    let mut chain_lookup: FxHashMap<&str, (&str, usize)> = FxHashMap::default();
    for (file_path, ff) in files {
        for (i, chain) in ff.chains.iter().enumerate() {
            if chain.descriptor.extractable {
                let id = format!("{}::{}", file_path, chain.descriptor.binding);
                if let Some(id_ref) = sorted_ids.iter().find(|s| **s == id) {
                    chain_lookup.insert(id_ref.as_str(), (file_path.as_str(), i));
                }
            }
        }
    }

    // -- Phase 5a mirror: evaluate chains (topo order) -----------------------
    type EvalEntry = (
        ComponentCss,
        String,       // binding
        TerminalKind, // terminal (asClass detection)
        Option<FxHashSet<String>>,
        Vec<String>, // active group names (sorted)
        Option<PropConfigMap>,
        Vec<(BTreeMap<String, Value>, String)>, // POST-MERGE compound configs
    );
    let mut evaluated: FxHashMap<String, EvalEntry> = FxHashMap::default();
    let mut inherited_active_props: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();

    for component_id in &sorted_ids {
        let Some((file_path, chain_idx)) = chain_lookup.get(component_id.as_str()) else {
            continue;
        };
        let chain = &files[*file_path].chains[*chain_idx];
        if chain.fatal_error.is_some() {
            // v1 967-969: eval failure → silent skip.
            continue;
        }
        let result = process_chain_facts(chain, &resolve_ctx, &inputs.group_registry);
        match result {
            Ok(out) => {
                let mut component_css = out.component_css;
                let active_props = out.active_prop_names;
                let active_group_names = out.active_group_names;
                let custom_configs = out.custom_prop_configs;
                for warning in &out.skip_warnings {
                    diagnostics.push(CssDiagnostic {
                        file: file_path.to_string(),
                        component: chain.descriptor.binding.clone(),
                        kind: "skip".to_string(),
                        message: warning.clone(),
                    });
                }

                // Own compound configs from facts (v1 process_chain:
                // sorted String|Array conditions + positional class).
                let mut compound_configs: Vec<(BTreeMap<String, Value>, String)> = Vec::new();
                {
                    let mut idx = 0usize;
                    for stage in &chain.stages {
                        // v1 lib.rs 536-554: config + index only for styled
                        // (two-arg) compounds.
                        if stage.method == "compound" && stage.second_value.is_some() {
                            if let Some(cond) = &stage.value {
                                let sorted: BTreeMap<String, Value> = cond
                                    .as_object()
                                    .map(|m| {
                                        m.iter()
                                            .filter(|(_, v)| v.is_string() || v.is_array())
                                            .map(|(k, v)| (k.clone(), v.clone()))
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                compound_configs.push((
                                    sorted,
                                    format!(
                                        "{}--compound-{}",
                                        component_css.class_name, idx
                                    ),
                                ));
                                idx += 1;
                            }
                        }
                    }
                }

                // Extension merge (v1 840-931 verbatim over ComponentCss).
                if let Some(parent_id) = parent_map.get(component_id) {
                    if let Some((parent_css, _, _, _, _, _, parent_compound_configs)) =
                        evaluated.get(parent_id)
                    {
                        match (&parent_css.base, &component_css.base) {
                            (Some(parent_base), Some(child_base)) => {
                                let mut merged_decls = parent_base.declarations.clone();
                                let child_props: FxHashSet<&str> = child_base
                                    .declarations
                                    .iter()
                                    .map(|d| d.property.as_str())
                                    .collect();
                                merged_decls
                                    .retain(|d| !child_props.contains(d.property.as_str()));
                                merged_decls.extend(child_base.declarations.clone());

                                let mut merged_pseudos = parent_base.pseudo_selectors.clone();
                                for (sel, decls) in &child_base.pseudo_selectors {
                                    if let Some(entry) =
                                        merged_pseudos.iter_mut().find(|(s, _)| s == sel)
                                    {
                                        entry.1 = decls.clone();
                                    } else {
                                        merged_pseudos.push((sel.clone(), decls.clone()));
                                    }
                                }

                                let mut merged_responsive = parent_base.responsive.clone();
                                for (bp, decls) in &child_base.responsive {
                                    if let Some(entry) =
                                        merged_responsive.iter_mut().find(|(b, _)| b == bp)
                                    {
                                        entry.1 = decls.clone();
                                    } else {
                                        merged_responsive.push((bp.clone(), decls.clone()));
                                    }
                                }

                                component_css.base = Some(ResolvedStyles {
                                    declarations: merged_decls,
                                    pseudo_selectors: merged_pseudos,
                                    responsive: merged_responsive,
                                    responsive_pseudos: parent_base.responsive_pseudos.clone(),
                                });
                            }
                            (Some(parent_base), None) => {
                                component_css.base = Some(parent_base.clone());
                            }
                            _ => {}
                        }

                        for pv in &parent_css.variants {
                            if !component_css.variants.iter().any(|v| v.prop == pv.prop) {
                                component_css.variants.push(VariantCss {
                                    prop: pv.prop.clone(),
                                    options: pv.options.clone(),
                                    default_option: pv.default_option.clone(),
                                });
                            }
                        }

                        for (name, styles) in &parent_css.states {
                            if !component_css.states.iter().any(|(n, _)| n == name) {
                                component_css.states.push((name.clone(), styles.clone()));
                            }
                        }

                        if !parent_css.compounds.is_empty() {
                            let mut merged_compounds = parent_css.compounds.clone();
                            merged_compounds.extend(component_css.compounds.drain(..));
                            component_css.compounds = merged_compounds;
                        }

                        // v1 908-913: inherit compound configs, parent first.
                        if !parent_compound_configs.is_empty() {
                            let mut merged_configs = parent_compound_configs.clone();
                            merged_configs.extend(compound_configs.drain(..));
                            compound_configs = merged_configs;
                        }
                    }
                }

                // Active-prop inheritance (v1 933-960 verbatim).
                let mut merged_active_props: FxHashSet<String> = FxHashSet::default();
                if let Some(parent_id) = parent_map.get(component_id) {
                    if let Some(parent_inherited) = inherited_active_props.get(parent_id) {
                        merged_active_props.extend(parent_inherited.iter().cloned());
                    }
                    if let Some((_, _, _, parent_active, _, _, _)) = evaluated.get(parent_id) {
                        if let Some(pa) = parent_active {
                            merged_active_props.extend(pa.iter().cloned());
                        }
                    }
                }
                if let Some(ref own_props) = active_props {
                    merged_active_props.extend(own_props.iter().cloned());
                }
                if !merged_active_props.is_empty() {
                    inherited_active_props
                        .insert(component_id.clone(), merged_active_props.clone());
                }
                let final_active_props = if !merged_active_props.is_empty() {
                    Some(merged_active_props)
                } else {
                    active_props
                };

                evaluated.insert(
                    component_id.clone(),
                    (
                        component_css,
                        chain.descriptor.binding.clone(),
                        chain.descriptor.terminal.clone(),
                        final_active_props,
                        active_group_names,
                        custom_configs,
                        compound_configs,
                    ),
                );
            }
            Err(_e) => {
                // v1 967-969: silent skip.
            }
        }
    }

    // -- Phase 5b mirror: usage configs + scans ------------------------------
    let mut component_usage_configs: FxHashMap<String, ComponentUsageConfig> =
        FxHashMap::default();
    for component_id in &sorted_ids {
        if let Some((component_css, binding, _, _, _, _, _)) = evaluated.get(component_id) {
            let mut variants: FxHashMap<String, (FxHashSet<String>, Option<String>)> =
                FxHashMap::default();
            for vc in &component_css.variants {
                if vc.default_option.is_some() {
                    let options: FxHashSet<String> =
                        vc.options.iter().map(|(name, _)| name.clone()).collect();
                    variants.insert(vc.prop.clone(), (options, vc.default_option.clone()));
                }
            }
            let states: FxHashSet<String> =
                component_css.states.iter().map(|(n, _)| n.clone()).collect();
            component_usage_configs
                .insert(binding.clone(), ComponentUsageConfig { variants, states });
        }
    }

    let mut global_component_props: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
    for component_id in &sorted_ids {
        if let Some((_, binding, _, active_props, _, custom_configs, _)) = evaluated.get(component_id) {
            let mut all_props: FxHashSet<String> = FxHashSet::default();
            if let Some(props) = active_props {
                all_props.extend(props.iter().cloned());
            }
            if let Some(cc) = custom_configs {
                all_props.extend(cc.keys().cloned());
            }
            if !all_props.is_empty() {
                global_component_props
                    .entry(binding.clone())
                    .or_default()
                    .extend(all_props);
            }
        }
    }

    let mut global_custom_props: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
    for component_id in &sorted_ids {
        if let Some((_, binding, _, _, _, custom_configs, _)) = evaluated.get(component_id) {
            if let Some(cc) = custom_configs {
                if !cc.is_empty() {
                    global_custom_props
                        .entry(binding.clone())
                        .or_default()
                        .extend(cc.keys().cloned());
                }
            }
        }
    }

    let mut compose_families = Vec::new();
    for path in order {
        if let Some(ff) = files.get(path) {
            compose_families.extend(ff.compose.iter().cloned());
        }
    }
    let mut member_expr_bindings: FxHashMap<String, String> = FxHashMap::default();
    for family in &compose_families {
        if let Some(ref family_binding) = family.family_binding {
            for (slot_name, binding_name) in &family.slots {
                member_expr_bindings
                    .insert(format!("{}.{}", family_binding, slot_name), binding_name.clone());
            }
        }
    }

    let mut all_utility_inputs: Vec<UtilityInput> = Vec::new();
    let mut all_custom_inputs: Vec<UtilityInput> = Vec::new();
    let mut all_custom_dynamic_usages: Vec<DynamicPropUsage> = Vec::new();
    let mut all_usage_results: Vec<UsageScanResult> = Vec::new();

    for path in order {
        if global_component_props.is_empty()
            && global_custom_props.is_empty()
            && component_usage_configs.is_empty()
        {
            break;
        }
        let Some(ff) = files.get(path) else { continue };

        // Per-file alias augmentation (v1 1147-1213 verbatim shape).
        let mut has_aliases = false;
        for imp in &ff.imports {
            if imp.local != imp.imported
                && (global_component_props.contains_key(&imp.imported)
                    || component_usage_configs.contains_key(&imp.imported)
                    || global_custom_props.contains_key(&imp.imported))
            {
                has_aliases = true;
                break;
            }
        }

        let (file_component_props, file_usage_configs, file_custom_props);
        let (scan_component_props, scan_usage_configs, scan_custom_props): (
            &FxHashMap<String, FxHashSet<String>>,
            &FxHashMap<String, ComponentUsageConfig>,
            &FxHashMap<String, FxHashSet<String>>,
        );

        if has_aliases {
            file_component_props = {
                let mut m = global_component_props.clone();
                for imp in &ff.imports {
                    if imp.local != imp.imported {
                        if let Some(props) = global_component_props.get(&imp.imported) {
                            m.insert(imp.local.clone(), props.clone());
                        }
                    }
                }
                m
            };
            file_usage_configs = {
                let mut m = component_usage_configs.clone();
                for imp in &ff.imports {
                    if imp.local != imp.imported {
                        if let Some(config) = component_usage_configs.get(&imp.imported) {
                            m.insert(imp.local.clone(), config.clone());
                        }
                    }
                }
                m
            };
            file_custom_props = {
                let mut m = global_custom_props.clone();
                for imp in &ff.imports {
                    if imp.local != imp.imported {
                        if let Some(props) = global_custom_props.get(&imp.imported) {
                            m.insert(imp.local.clone(), props.clone());
                        }
                    }
                }
                m
            };
            scan_component_props = &file_component_props;
            scan_usage_configs = &file_usage_configs;
            scan_custom_props = &file_custom_props;
        } else {
            scan_component_props = &global_component_props;
            scan_usage_configs = &component_usage_configs;
            scan_custom_props = &global_custom_props;
        }

        let usage_result = crate::usage_facts::filter_usage_scan(
            &ff.usage,
            scan_component_props,
            scan_usage_configs,
            &member_expr_bindings,
        );

        all_utility_inputs.extend(usage_result.system_prop_usages.iter().map(|u| UtilityInput {
            prop_name: u.prop_name.clone(),
            value: u.value.clone(),
        }));

        if !scan_custom_props.is_empty() {
            let custom_scan = crate::usage_facts::filter_custom_prop_scan(
                &ff.usage,
                scan_custom_props,
                &member_expr_bindings,
            );
            all_custom_inputs.extend(custom_scan.static_usages.iter().map(|u| UtilityInput {
                prop_name: u.prop_name.clone(),
                value: u.value.clone(),
            }));
            all_custom_dynamic_usages.extend(custom_scan.dynamic_usages.iter().cloned());
        }

        all_usage_results.push(usage_result);
    }

    // Dynamic prop metadata (v1 1247-1289).
    let dynamic_prop_names: FxHashSet<String> = all_usage_results
        .iter()
        .flat_map(|r| r.dynamic_prop_usages.iter())
        .map(|d| d.prop_name.clone())
        .collect();

    let mut dynamic_props: HashMap<String, DynamicPropMeta> = HashMap::new();
    for prop_name in &dynamic_prop_names {
        if let Some(prop_config) = inputs.config.get(prop_name.as_str()) {
            let kebab = camel_to_kebab(prop_name);
            let mut scale_values: BTreeMap<String, String> = BTreeMap::new();
            if let Some(Value::String(scale_name)) = &prop_config.scale {
                let prefix = format!("{}.", scale_name);
                for (theme_key, css_value) in &inputs.theme {
                    if let Some(scale_key) = theme_key.strip_prefix(&prefix) {
                        scale_values.insert(scale_key.to_string(), css_value.clone());
                    }
                }
            }
            dynamic_props.insert(
                prop_name.clone(),
                DynamicPropMeta {
                    var_name: format!("--{}-{}", class_prefix, kebab),
                    slot_class: format!("{}-dyn-{}", class_prefix, kebab),
                    property: prop_config.property.clone(),
                    properties: prop_config.properties.clone(),
                    transform_name: prop_config.transform.clone(),
                    transform_fn_source: prop_config.transform_fn_source.clone(),
                    scale_values,
                },
            );
        }
    }
    let slot_entries = if !dynamic_props.is_empty() {
        Some(build_variable_slot_entries(&dynamic_props, &breakpoints))
    } else {
        None
    };

    // Global custom config union + inline-transform filtering (v1 1291-1316).
    let mut global_custom_config: PropConfigMap = PropConfigMap::default();
    for component_id in &sorted_ids {
        if let Some((_, _, _, _, _, custom_configs, _)) = evaluated.get(component_id) {
            if let Some(cc) = custom_configs {
                global_custom_config.extend(cc.clone());
            }
        }
    }
    let inline_transform_props: FxHashSet<String> = global_custom_config
        .iter()
        .filter(|(_, config)| config.transform_fn_source.is_some())
        .map(|(name, _)| name.clone())
        .collect();
    if !inline_transform_props.is_empty() {
        all_custom_inputs.retain(|input| !inline_transform_props.contains(&input.prop_name));
        all_utility_inputs.retain(|input| !inline_transform_props.contains(&input.prop_name));
    }

    let utility_output = if !all_utility_inputs.is_empty() || slot_entries.is_some() {
        Some(generate_utility_css(
            &all_utility_inputs,
            &resolve_ctx,
            &breakpoints,
            slot_entries,
            class_prefix,
        ))
    } else {
        None
    };

    // Per-component custom dynamic metadata (v1 1325-1447).
    let mut custom_dynamic_by_binding: FxHashMap<String, FxHashSet<String>> =
        FxHashMap::default();
    for dyn_usage in &all_custom_dynamic_usages {
        custom_dynamic_by_binding
            .entry(dyn_usage.binding.clone())
            .or_default()
            .insert(dyn_usage.prop_name.clone());
    }
    if !inline_transform_props.is_empty() {
        for component_id in &sorted_ids {
            if let Some((_, binding, _, _, _, custom_configs, _)) = evaluated.get(component_id) {
                if let Some(cc) = custom_configs {
                    for prop_name in cc.keys() {
                        if inline_transform_props.contains(prop_name) {
                            custom_dynamic_by_binding
                                .entry(binding.clone())
                                .or_default()
                                .insert(prop_name.clone());
                        }
                    }
                }
            }
        }
    }

    let mut per_component_custom_dynamic: FxHashMap<String, HashMap<String, DynamicPropMeta>> =
        FxHashMap::default();
    let mut all_custom_slot_entries: Vec<(String, ResolvedStyles, String)> = Vec::new();
    for component_id in &sorted_ids {
        let Some((component_css, binding, _, _, _, custom_configs, _)) = evaluated.get(component_id)
        else {
            continue;
        };
        let Some(cc) = custom_configs else { continue };
        let Some(dynamic_props_for_binding) = custom_dynamic_by_binding.get(binding) else {
            continue;
        };
        let mut component_dynamic: HashMap<String, DynamicPropMeta> = HashMap::new();
        let class_hash = component_css
            .class_name
            .rsplit('-')
            .next()
            .unwrap_or(&component_css.class_name);
        let hash8 = &class_hash[..class_hash.len().min(8)];
        for prop_name in dynamic_props_for_binding {
            if let Some(prop_config) = cc.get(prop_name) {
                let kebab = camel_to_kebab(prop_name);
                let mut scale_values: BTreeMap<String, String> = BTreeMap::new();
                match &prop_config.scale {
                    Some(Value::String(scale_name)) => {
                        let prefix = format!("{}.", scale_name);
                        for (theme_key, css_value) in &inputs.theme {
                            if let Some(scale_key) = theme_key.strip_prefix(&prefix) {
                                scale_values.insert(scale_key.to_string(), css_value.clone());
                            }
                        }
                    }
                    Some(Value::Object(inline_scale)) => {
                        let css_prop = camel_to_kebab(&prop_config.property);
                        for (key, val) in inline_scale {
                            let resolved = if let Some(s) = val.as_str() {
                                s.to_string()
                            } else if let Some(n) = val.as_f64() {
                                crate::css::apply_unit_fallback_for_property(n, &css_prop)
                            } else {
                                val.to_string()
                            };
                            scale_values.insert(key.clone(), resolved);
                        }
                    }
                    _ => {}
                }
                component_dynamic.insert(
                    prop_name.clone(),
                    DynamicPropMeta {
                        var_name: format!("--{}-{}", class_prefix, kebab),
                        slot_class: format!("{}-dyn-{}-{}", class_prefix, hash8, kebab),
                        property: prop_config.property.clone(),
                        properties: prop_config.properties.clone(),
                        transform_name: prop_config.transform.clone(),
                        transform_fn_source: prop_config.transform_fn_source.clone(),
                        scale_values,
                    },
                );
            }
        }
        if !component_dynamic.is_empty() {
            all_custom_slot_entries
                .extend(build_variable_slot_entries(&component_dynamic, &breakpoints));
            per_component_custom_dynamic.insert(component_id.clone(), component_dynamic);
        }
    }
    let custom_slot_entries = if !all_custom_slot_entries.is_empty() {
        Some(all_custom_slot_entries)
    } else {
        None
    };

    let custom_output = if !all_custom_inputs.is_empty() || custom_slot_entries.is_some() {
        Some(generate_custom_prop_css(
            &all_custom_inputs,
            &global_custom_config,
            &resolve_ctx,
            &breakpoints,
            custom_slot_entries,
            class_prefix,
        ))
    } else {
        None
    };

    // -- Phase 5c mirror: replacement payloads --------------------------------
    let mut replacement_configs: FxHashMap<String, crate::assemble::ReplacementPayload> =
        FxHashMap::default();
    for component_id in &sorted_ids {
        let Some((_, _, _, active_props, group_names, custom_configs, compound_configs)) =
            evaluated.get(component_id)
        else {
            continue;
        };
        let mut all_prop_names: Vec<String> = Vec::new();
        if let Some(props) = active_props {
            all_prop_names.extend(props.iter().cloned());
        }
        if let Some(cc) = custom_configs {
            all_prop_names.extend(cc.keys().cloned());
        }
        all_prop_names.sort();
        all_prop_names.dedup();

        let mut custom_prop_class_map: Option<HashMap<String, HashMap<String, String>>> = None;
        if let Some(cc) = custom_configs {
            if !cc.is_empty() {
                if let Some(ref custom_out) = custom_output {
                    let mut component_class_map: HashMap<String, HashMap<String, String>> =
                        HashMap::new();
                    for prop_name in cc.keys() {
                        if let Some(val_map) = custom_out.class_map.get(prop_name) {
                            component_class_map.insert(prop_name.clone(), val_map.clone());
                        }
                    }
                    if !component_class_map.is_empty() {
                        custom_prop_class_map = Some(component_class_map);
                    }
                }
            }
        }

        // v1 Phase 6 (1617-1620): dynamic when any of the component's
        // prop names has a detected dynamic usage.
        let has_dynamic_props =
            all_prop_names.iter().any(|name| dynamic_prop_names.contains(name));

        // Extension children get the POST-MERGE config trio (v1 908-929).
        let merged_config = if parent_map.contains_key(component_id) {
            let (component_css, ..) = &evaluated[component_id];
            Some(crate::assemble::MergedChainConfig {
                variant_config: component_css
                    .variants
                    .iter()
                    .map(|vc| {
                        (
                            vc.prop.clone(),
                            vc.options.iter().map(|(name, _)| name.clone()).collect(),
                            vc.default_option.clone(),
                        )
                    })
                    .collect(),
                compound_configs: compound_configs.clone(),
                state_names: component_css.states.iter().map(|(n, _)| n.clone()).collect(),
            })
        } else {
            None
        };

        replacement_configs.insert(
            component_id.clone(),
            crate::assemble::ReplacementPayload {
                system_prop_names: all_prop_names,
                system_group_names: group_names.clone(),
                has_dynamic_props,
                custom_prop_class_map,
                custom_dynamic_config: per_component_custom_dynamic.get(component_id).cloned(),
                merged_config,
            },
        );
    }

    // -- Phase 5d mirror: usage ledger ---------------------------------------
    let variant_configs_for_ledger: FxHashMap<
        String,
        FxHashMap<String, (FxHashSet<String>, Option<String>)>,
    > = component_usage_configs
        .iter()
        .map(|(binding, config)| (binding.clone(), config.variants.clone()))
        .collect();

    let mut usage_ledger = build_ledger(&all_usage_results, &variant_configs_for_ledger);

    for component_id in &sorted_ids {
        if let Some((_, binding, terminal, _, _, _, _)) = evaluated.get(component_id) {
            if *terminal == TerminalKind::AsClass {
                usage_ledger.rendered_components.insert(binding.clone());
            }
        }
    }
    for family in &compose_families {
        for (_slot_name, binding_name) in &family.slots {
            usage_ledger.rendered_components.insert(binding_name.clone());
        }
    }
    for family in &compose_families {
        for (_slot_name, binding_name) in &family.slots {
            if *binding_name == family.root_binding {
                continue;
            }
            for shared_key in &family.shared_keys {
                if let Some(variant_config) = variant_configs_for_ledger
                    .get(binding_name)
                    .and_then(|vc| vc.get(shared_key))
                {
                    let used_set = usage_ledger
                        .variant_usage
                        .entry(binding_name.clone())
                        .or_default()
                        .entry(shared_key.clone())
                        .or_default();
                    for option in &variant_config.0 {
                        used_set.insert(option.clone());
                    }
                }
            }
        }
    }

    // -- Phase 5e mirror: reconcile ------------------------------------------
    let mut reconciled_components: Vec<(String, ComponentCss)> = sorted_ids
        .iter()
        .filter_map(|component_id| {
            evaluated
                .get(component_id)
                .map(|(component_css, _, _, _, _, _, _)| (component_id.clone(), component_css.clone()))
        })
        .collect();

    let parent_bindings: FxHashSet<String> = parent_map
        .values()
        .filter_map(|parent_id| parent_id.rfind("::").map(|pos| parent_id[pos + 2..].to_string()))
        .collect();

    let reconciliation = if inputs.dev_mode {
        let prospective = identify_prospective_eliminations(
            &reconciled_components,
            &usage_ledger,
            &parent_bindings,
        );
        let mut report = crate::reconcile::ReconciliationReport::default();
        report.components_total = reconciled_components.len();
        report.components_extracted = reconciled_components.len();
        report.eliminated_details = prospective;
        serde_json::to_value(&report).unwrap_or(serde_json::json!({}))
    } else {
        let report = reconcile(&mut reconciled_components, &usage_ledger, &parent_bindings);
        serde_json::to_value(&report).unwrap_or(serde_json::json!({}))
    };

    // -- Phase 6b mirror: CSS generation --------------------------------------
    let reconciled_order: Vec<String> =
        reconciled_components.iter().map(|(id, _)| id.clone()).collect();
    let component_css_list: Vec<ComponentCss> =
        reconciled_components.into_iter().map(|(_, css)| css).collect();

    let (mut sheets, fragments) = generate_css_sheets_ordered(
        &component_css_list,
        &breakpoints,
        &reconciled_order,
        class_prefix,
    );

    // Phase 6c: composed variant CSS.
    let mut composed_variant_css = String::new();
    if !compose_families.is_empty() {
        let binding_to_class: HashMap<&str, &str> = evaluated
            .values()
            .map(|(css, binding, _, _, _, _, _)| (binding.as_str(), css.class_name.as_str()))
            .collect();
        let family_refs: Vec<ComposeFamilyRef> = compose_families
            .iter()
            .filter_map(|family| {
                let root_class = binding_to_class.get(family.root_binding.as_str())?;
                let child_slots: Vec<(&str, &str)> = family
                    .slots
                    .iter()
                    .filter(|(slot_name, _)| slot_name != "Root")
                    .filter_map(|(_, binding)| {
                        let class = binding_to_class.get(binding.as_str())?;
                        Some((binding.as_str(), *class))
                    })
                    .collect();
                if child_slots.is_empty() {
                    return None;
                }
                Some(ComposeFamilyRef {
                    root_class,
                    child_slots,
                    shared_keys: &family.shared_keys,
                })
            })
            .collect();
        if !family_refs.is_empty() {
            composed_variant_css =
                generate_composed_variant_css(&family_refs, &component_css_list, &breakpoints);
        }
    }

    // Unconditional variants sublayering (v1 1675-1694 verbatim).
    {
        let standalone_content = extract_layer_content(&sheets.variants);
        let variants_layer = layer_name("variants");
        let mut sublayered = String::new();
        writeln!(sublayered, "@layer {} {{", variants_layer).unwrap();
        writeln!(sublayered, "  @layer standalone, composed;").unwrap();
        if !standalone_content.is_empty() {
            writeln!(sublayered, "  @layer standalone {{").unwrap();
            sublayered.push_str(&standalone_content);
            writeln!(sublayered, "  }}").unwrap();
        }
        writeln!(sublayered, "  @layer composed {{").unwrap();
        sublayered.push_str(&composed_variant_css);
        writeln!(sublayered, "  }}").unwrap();
        writeln!(sublayered, "}}").unwrap();
        sheets.variants = sublayered;
    }

    if let Some(util_out) = &utility_output {
        if !util_out.css.is_empty() {
            sheets.system = util_out.css.clone();
        }
    }
    if let Some(custom_out) = &custom_output {
        if !custom_out.css.is_empty() {
            sheets.custom = custom_out.css.clone();
        }
    }

    // Global style blocks + keyframes → sheets.global (v1 1708-1736).
    let global_css_raw = if let Some(blocks) = &inputs.global_style_blocks {
        crate::theme::resolve_all_global_blocks(blocks, &resolve_ctx)
    } else {
        String::new()
    };
    let keyframes_css_raw = if let Some(blocks) = &inputs.keyframes_blocks {
        crate::theme::resolve_all_keyframes_blocks(blocks, &resolve_ctx)
    } else {
        String::new()
    };
    let mut combined_global = String::new();
    if !global_css_raw.is_empty() {
        combined_global.push_str(&global_css_raw);
    }
    if !keyframes_css_raw.is_empty() {
        if !combined_global.is_empty() {
            combined_global.push('\n');
        }
        combined_global.push_str(&keyframes_css_raw);
    }
    if !combined_global.is_empty() {
        sheets.global = format!("@layer {} {{\n{}\n}}\n", layer_name("global"), combined_global);
    }

    // Concatenated CSS (v1 1738-1748; global excluded — flows via sheets).
    let mut css = sheets.declaration.clone();
    css.push('\n');
    for sheet in [
        &sheets.base,
        &sheets.variants,
        &sheets.compounds,
        &sheets.states,
        &sheets.system,
        &sheets.custom,
    ] {
        if !sheet.is_empty() {
            css.push_str(sheet);
            css.push('\n');
        }
    }

    // Manifest observables (v1 1922-1994).
    let system_prop_map: BTreeMap<String, BTreeMap<String, String>> = utility_output
        .as_ref()
        .map(|u| {
            u.class_map
                .iter()
                .map(|(k, v)| (k.clone(), v.iter().map(|(a, b)| (a.clone(), b.clone())).collect()))
                .collect()
        })
        .unwrap_or_default();
    let dynamic_props_sorted: BTreeMap<String, DynamicPropMeta> =
        dynamic_props.into_iter().collect();
    let component_fragments: BTreeMap<String, crate::css::PerComponentSheets> =
        fragments.to_per_component_map().into_iter().collect();
    // v1 Phase 7 components/files maps (evaluated survivors only).
    let mut components: BTreeMap<String, ComponentDescriptor> = BTreeMap::new();
    let mut files_map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for component_id in &sorted_ids {
        let Some((file_path, chain_idx)) = chain_lookup.get(component_id.as_str()) else {
            continue;
        };
        let Some((component_css, binding, terminal, _, _, _, _)) = evaluated.get(component_id)
        else {
            continue;
        };
        let chain = &files[*file_path].chains[*chain_idx];
        let payload = replacement_configs.get(component_id);
        let replacement = crate::assemble::generate_replacement(
            file_path,
            chain,
            class_prefix,
            payload,
            &inputs.group_registry,
        )
        .unwrap_or_default();
        let terminal_str = match terminal {
            TerminalKind::AsElement => "asElement",
            TerminalKind::AsComponent => "asComponent",
            TerminalKind::AsClass => "asClass",
        };
        components.insert(
            component_id.clone(),
            ComponentDescriptor {
                file: file_path.to_string(),
                binding: binding.clone(),
                class_name: component_css.class_name.clone(),
                extends_from: parent_map.get(component_id).cloned(),
                terminal: terminal_str.to_string(),
                tag: chain.descriptor.tag.clone(),
                replacement,
                system_prop_names: payload.map(|p| p.system_prop_names.clone()).unwrap_or_default(),
            },
        );
        files_map.entry(file_path.to_string()).or_default().push(component_id.clone());
    }

    let mut reverse_provenance: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for component_id in &sorted_ids {
        // v1 builds provenance only for EVALUATED survivors (Phase 7
        // components_map gate; inc-07 review F8).
        if !evaluated.contains_key(component_id) {
            continue;
        }
        if let Some(parent_id) = parent_map.get(component_id) {
            reverse_provenance.entry(parent_id.clone()).or_default().push(component_id.clone());
        }
    }
    for children in reverse_provenance.values_mut() {
        children.sort();
    }

    CssOutput {
        css,
        sheets,
        fragments,
        diagnostics,
        reconciliation,
        replacement_configs,
        system_prop_map,
        dynamic_props: dynamic_props_sorted,
        component_fragments,
        reverse_provenance,
        components,
        files_map,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::extract_file_facts_with_prefix;
    use crate::owned_ast::{OwnedAst, ParseCounter};

    fn analyze(entries: &[(&str, &str)], inputs: &CssInputs) -> CssOutput {
        let counter = ParseCounter::new(0);
        let mut files = BTreeMap::new();
        let mut order = Vec::new();
        for (path, source) in entries {
            let ast = OwnedAst::parse(path.to_string(), source.to_string(), &counter);
            files.insert(path.to_string(), extract_file_facts_with_prefix(&ast, "animus"));
            order.push(path.to_string());
        }
        run(&files, &order, inputs, "animus")
    }

    fn test_inputs() -> CssInputs {
        let mut inputs = CssInputs::from_json(
            None,
            None,
            None,
            Some(r#"{"p": {"property": "padding", "scale": "space"}, "display": {"property": "display"}}"#),
            Some(r#"{"space": ["p", "m"]}"#),
            None,
            None,
            None,
            None,
            None,
            false,
        )
        .unwrap();
        inputs.theme.insert("space.8".into(), "0.5rem".into());
        inputs.theme.insert("breakpoints.sm".into(), "480".into());
        inputs
    }

    #[test]
    fn import_source_resolution_follows_v1_order() {
        // relative → alias-expand+probe → package map (v1 528-536).
        let mut files: BTreeMap<String, ()> = BTreeMap::new();
        files.insert("src/ui/button.tsx".into(), ());
        files.insert("lib/theme.ts".into(), ());
        let mut inputs = CssInputs::default();
        inputs.path_aliases.push(AliasEntry {
            pattern: "@ui/".into(),
            replacement: "src/ui/".into(),
            alias_type: AliasType::Prefix,
        });
        inputs.package_map.insert("@corp/tokens".into(), "vendor/tokens.ts".into());

        assert_eq!(
            resolve_import_source("src/app.tsx", "./ui/button", &files, &inputs).as_deref(),
            Some("src/ui/button.tsx")
        );
        assert_eq!(
            resolve_import_source("x.tsx", "@ui/button", &files, &inputs).as_deref(),
            Some("src/ui/button.tsx")
        );
        // Package map returns the path UNCONDITIONALLY (dangling roots ok).
        assert_eq!(
            resolve_import_source("x.tsx", "@corp/tokens", &files, &inputs).as_deref(),
            Some("vendor/tokens.ts")
        );
        assert_eq!(resolve_import_source("x.tsx", "not-mapped", &files, &inputs), None);
    }

    #[test]
    fn base_css_flows_through_sheets_and_layers() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const C = ds.styles({ p: 8, display: 'flex' }).asElement('div');\nexport const App = () => <C />;\n",
            )],
            &test_inputs(),
        );
        assert!(out.sheets.base.contains("padding: 0.5rem"), "{}", out.sheets.base);
        assert!(out.css.starts_with("@layer anm-global, anm-base"), "{}", out.css);
        assert!(out.sheets.variants.contains("@layer standalone, composed;"));
    }

    #[test]
    fn unused_component_is_reconciled_away_in_prod() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Used = ds.styles({ display: 'flex' }).asElement('div');\nexport const Unused = ds.styles({ display: 'grid' }).asElement('div');\nexport const App = () => <Used />;\n",
            )],
            &test_inputs(),
        );
        assert!(out.sheets.base.contains("flex"));
        assert!(!out.sheets.base.contains("grid"), "{}", out.sheets.base);
    }

    #[test]
    fn dev_mode_keeps_unused_components() {
        let mut inputs = test_inputs();
        inputs.dev_mode = true;
        let out = analyze(
            &[(
                "a.tsx",
                "export const Unused = ds.styles({ display: 'grid' }).asElement('div');\n",
            )],
            &inputs,
        );
        assert!(out.sheets.base.contains("grid"));
    }

    #[test]
    fn system_prop_usage_generates_utility_css() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Box = ds.system({ space: true }).asElement('div');\nexport const App = () => <Box p={8} />;\n",
            )],
            &test_inputs(),
        );
        assert!(out.sheets.system.contains("padding"), "{}", out.sheets.system);
        assert!(out.sheets.system.contains("animus-u-"), "{}", out.sheets.system);
    }

    #[test]
    fn extension_child_inherits_parent_base_across_files() {
        let out = analyze(
            &[
                (
                    "base.tsx",
                    "export const Parent = ds.styles({ display: 'flex', p: 8 }).asElement('div');\nexport const A = () => <Parent />;\n",
                ),
                (
                    "child.tsx",
                    "import { Parent } from './base';\nexport const Child = Parent.extend().styles({ display: 'grid' }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        // Child overrides display but inherits padding from Parent.
        let child_start = out.sheets.base.find("animus-Child-").unwrap();
        let child_rule = &out.sheets.base[child_start..];
        let child_rule = &child_rule[..child_rule.find('}').unwrap()];
        assert!(child_rule.contains("display: grid"), "{}", out.sheets.base);
        assert!(child_rule.contains("padding: 0.5rem"), "{}", out.sheets.base);
    }

    #[test]
    fn named_transform_registers_and_applies() {
        let mut inputs = test_inputs();
        inputs
            .config
            .insert("w".into(), serde_json::from_str(r#"{"property": "width", "transform": "battle"}"#).unwrap());
        let out = analyze(
            &[
                (
                    "t.tsx",
                    "import { createTransform } from '@animus-ui/system';\nexport const t1 = createTransform('battle', (v) => `${v}px`);\n",
                ),
                (
                    "a.tsx",
                    "export const C = ds.styles({ w: 3 }).asElement('div');\nexport const App = () => <C />;\n",
                ),
            ],
            &inputs,
        );
        assert!(out.sheets.base.contains("width: 3px"), "{}", out.sheets.base);
    }
}
