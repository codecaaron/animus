use std::collections::{HashMap, HashSet};
use std::fmt::Write;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};

use crate::chain_merger::{ProvenanceNode, TopoResult, topological_sort};
use crate::chain_walker::{walk_chains, ChainDescriptor, TerminalKind};
use crate::css_generator::{
    build_variable_slot_entries, generate_composed_variant_css, generate_css_sheets_ordered,
    generate_custom_prop_css, generate_utility_css, ComponentCss, ComposeFamilyRef, CssSheets,
    UtilityInput, VariantCss,
};
use crate::theme_resolver::ResolvedStyles;
use crate::import_resolver::{parse_module_info, resolve_bindings, FileModuleInfo};
use crate::jsx_scanner::{scan_compose_calls, scan_jsx, scan_jsx_usage, ComponentUsageConfig, ComposeFamilyInfo, DynamicPropUsage, SystemPropUsage, UsageScanResult};
use crate::reconciler::{build_ledger, reconcile};
use crate::theme_resolver::{ContextualVarsMap, FlatTheme, PropConfigMap, ResolveContext, SelectorAliasesMap, VariableMap};
use crate::transform_emitter::{
    generate_replacement, CompoundConfig, ComponentReplacement, VariantPropConfig,
};
use crate::{extract_breakpoints, process_chain, ProcessingContext};

// ---------------------------------------------------------------------------
// Per-file extraction cache (persistent across analyzeProject() calls)
// ---------------------------------------------------------------------------

/// Cached evaluation result for a single component within a file.
#[derive(Debug, Clone)]
pub struct CachedEvalEntry {
    pub component_id: String,
    pub component_css: ComponentCss,
    pub replacement: ComponentReplacement,
    pub active_props: Option<HashSet<String>>,
    pub prop_config: Option<PropConfigMap>,
}

/// Cached extraction results for an entire file.
#[derive(Debug, Clone)]
pub struct CachedFileResult {
    pub hash: String,
    pub module_info: FileModuleInfo,
    pub chains: Vec<ChainDescriptor>,
    pub eval_results: Vec<CachedEvalEntry>,
    pub jsx_usage: UsageScanResult,
    /// Custom prop scan results (static + dynamic) — cached separately because
    /// custom props are scanned via `scan_jsx()` independently of the main usage scan.
    pub custom_prop_static: Vec<SystemPropUsage>,
    pub custom_prop_dynamic: Vec<DynamicPropUsage>,
}

/// Persistent per-file cache. Key is file path, value is the cached extraction result.
/// Protected by a Mutex for safe cross-thread NAPI access.
static FILE_CACHE: Lazy<Mutex<HashMap<String, CachedFileResult>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Clear the per-file extraction cache. Called on geological resets
/// (theme/config/system file change) to force full re-analysis.
pub fn clear_file_cache() {
    if let Ok(mut cache) = FILE_CACHE.lock() {
        cache.clear();
    }
}

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/// A source file entry to analyze.
#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub source: String,
    /// Content hash for cache lookup. When present and matching, cached results are reused.
    /// When absent (None), the file is always re-parsed.
    #[serde(default)]
    pub hash: Option<String>,
}

/// Describes a single extracted component in the manifest.
#[derive(Debug, Serialize, Deserialize)]
pub struct ComponentDescriptor {
    /// The source file that defines this component.
    pub file: String,
    /// The local binding name (e.g. "NavLink").
    pub binding: String,
    /// The CSS class name generated for this component.
    pub class_name: String,
    /// The component_id of the parent, if this is an extension chain.
    pub extends_from: Option<String>,
    /// "asElement" or "asComponent".
    pub terminal: String,
    /// HTML tag name or component identifier name.
    pub tag: String,
    /// The full `createComponent(...)` call string, ready to splice into source.
    pub replacement: String,
    /// All active system prop names for this component (for DOM filtering).
    pub system_prop_names: Vec<String>,
}

/// A diagnostic message from extraction (bail or per-property skip).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionDiagnostic {
    pub file: String,
    pub component: String,
    pub kind: String, // "bail" or "skip"
    pub message: String,
}

/// The complete universe of extracted components across all project files.
#[derive(Debug, Serialize, Deserialize)]
pub struct UniverseManifest {
    /// component_id ("file::binding") → descriptor
    pub components: HashMap<String, ComponentDescriptor>,
    /// class_name → css_declaration string (utility class map)
    pub utilities: HashMap<String, String>,
    /// Complete @layer CSS string for the whole project (concatenation of all sheets)
    pub css: String,
    /// Per-layer CSS strings for structured delivery (dev adopted stylesheets, future code-splitting)
    pub sheets: CssSheets,
    /// component_id → ancestor chain (parent_id, grandparent_id, ...)
    pub provenance: HashMap<String, Vec<String>>,
    /// file_path → list of component_ids defined in that file
    pub files: HashMap<String, Vec<String>>,
    /// Serialized usage ledger (rendered components, variant/state usage)
    #[serde(default)]
    pub usage: serde_json::Value,
    /// Serialized reconciliation report (elimination counts + details)
    #[serde(default)]
    pub report: serde_json::Value,
    /// Extraction diagnostics (bail reasons, per-property skip warnings)
    #[serde(default)]
    pub diagnostics: Vec<ExtractionDiagnostic>,
    /// Shared system prop map: prop_name → { value_key → class_name }.
    /// Aggregates all group prop utility classes across all components.
    /// Custom props (.props()) are excluded — they stay per-component.
    #[serde(default)]
    pub system_prop_map: HashMap<String, HashMap<String, String>>,
    /// Dynamic prop metadata: prop_name → DynamicPropMeta.
    /// Only props with at least one detected dynamic usage appear here.
    #[serde(default)]
    pub dynamic_props: HashMap<String, DynamicPropMeta>,
    /// Emitter configuration for generated import paths.
    /// Stored in the manifest so `transform_file()` can read it without extra parameters.
    #[serde(default)]
    pub emitter_config: crate::transform_emitter::EmitterConfig,
    /// Files that need a `"use client"` directive injected (compose families with `context: true`).
    #[serde(default)]
    pub use_client_files: HashSet<String>,
}

/// Metadata for a prop with detected dynamic usage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicPropMeta {
    /// CSS custom property name, e.g. "--animus-border-radius"
    pub var_name: String,
    /// CSS class name for the variable slot, e.g. "animus-dyn-border-radius"
    pub slot_class: String,
    /// Primary CSS property this prop maps to, e.g. "border-radius"
    pub property: String,
    /// Additional CSS properties for multi-property props (e.g. paddingLeft, paddingRight for px)
    #[serde(default)]
    pub properties: Vec<String>,
    /// Transform function name if the prop has one, e.g. "size" (group-level transforms)
    #[serde(default)]
    pub transform_name: Option<String>,
    /// Inline transform function source text (custom prop transforms).
    /// When present, emitted directly in replacement JS instead of `transforms.{name}`.
    #[serde(default)]
    pub transform_fn_source: Option<String>,
    /// Pre-resolved scale values: value_key → resolved CSS value.
    /// Allows runtime to resolve scale keys without shipping full scale data.
    /// e.g. { "1": "1px solid", "2": "2px solid" } for borderBottom with borders scale.
    #[serde(default)]
    pub scale_values: HashMap<String, String>,
}

/// Convert a camelCase prop name to kebab-case for CSS variable naming.
/// Examples: "borderRadius" → "border-radius", "p" → "p", "mt" → "mt"
pub fn camel_to_kebab(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                result.push('-');
            }
            result.push(ch.to_lowercase().next().unwrap());
        } else {
            result.push(ch);
        }
    }
    result
}

// ---------------------------------------------------------------------------
// Main analysis entry point
// ---------------------------------------------------------------------------

/// Analyse all project files and produce a `UniverseManifest`.
///
/// `resolve_package_path(source)` is called when an import source does not
/// start with `'.'` (i.e. it is a package specifier).  Return `None` to mark
/// the import as unresolvable.
pub fn analyze(
    files: &[FileEntry],
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
    config: &PropConfigMap,
    group_registry: &HashMap<String, Vec<String>>,
    resolve_package_path: &dyn Fn(&str) -> Option<String>,
    dev_mode: bool,
    class_prefix: &str,
    emitter_config: crate::transform_emitter::EmitterConfig,
    selector_aliases: &SelectorAliasesMap,
) -> UniverseManifest {
    let breakpoints = extract_breakpoints(theme);
    let bp_keys: HashSet<String> = breakpoints.breakpoints.keys().cloned().collect();
    let resolve_ctx = ResolveContext {
        config,
        theme,
        variable_map,
        contextual_vars,
        breakpoint_keys: &bp_keys,
        selector_aliases,
    };
    let proc_ctx = ProcessingContext {
        resolve: &resolve_ctx,
        group_registry,
        class_prefix,
    };

    // Collect file paths as a HashSet for fast membership checks during path resolution.
    let file_path_set: HashSet<String> = files.iter().map(|f| f.path.clone()).collect();

    // Track which files were cache hits vs misses (for incremental JSX scanning)
    let mut cache_hit_files: HashSet<String> = HashSet::new();

    // Cached eval entries extracted during Phase 1 for use in Phase 5.
    // Key: file_path, Value: vec of cached eval entries (taken from cache, not cloned).
    let mut cached_evals_by_file: HashMap<String, Vec<CachedEvalEntry>> = HashMap::new();
    // Cached JSX usage results for dev-mode incremental scanning.
    let mut cached_jsx_by_file: HashMap<String, UsageScanResult> = HashMap::new();
    // Cached custom prop scan results for dev-mode incremental scanning.
    let mut cached_custom_static_by_file: HashMap<String, Vec<SystemPropUsage>> = HashMap::new();
    let mut cached_custom_dynamic_by_file: HashMap<String, Vec<DynamicPropUsage>> = HashMap::new();

    // ---------------------------------------------------------------------------
    // Phase 1: Parse all files — collect chains and module info.
    // For files with a matching hash in the cache, take ownership of cached data
    // (remove from cache) to avoid deep clones of the entire cache HashMap.
    // Cache entries are re-inserted after processing.
    // ---------------------------------------------------------------------------

    let mut all_chains: HashMap<String, Vec<ChainDescriptor>> = HashMap::new();
    let mut file_modules: HashMap<String, FileModuleInfo> = HashMap::new();

    {
        // Hold lock for Phase 1 lookups — take ownership of matching entries
        let mut cache_guard = FILE_CACHE.lock().unwrap_or_else(|e| e.into_inner());

        for file in files {
            if let Some(ref file_hash) = file.hash {
                // Check if cache has a matching entry — use remove() to take ownership
                // instead of clone(). Entries are re-inserted during cache storage phase.
                let cache_hit = cache_guard.get(&file.path)
                    .map_or(false, |c| c.hash == *file_hash);
                if cache_hit {
                    let cached = cache_guard.remove(&file.path).unwrap();
                    all_chains.insert(file.path.clone(), cached.chains);
                    file_modules.insert(file.path.clone(), cached.module_info);
                    cached_evals_by_file.insert(file.path.clone(), cached.eval_results);
                    cached_jsx_by_file.insert(file.path.clone(), cached.jsx_usage);
                    cached_custom_static_by_file.insert(file.path.clone(), cached.custom_prop_static);
                    cached_custom_dynamic_by_file.insert(file.path.clone(), cached.custom_prop_dynamic);
                    cache_hit_files.insert(file.path.clone());
                    continue;
                }
            }

            // Cache miss (or no hash): parse via OXC
            let source_type = source_type_for_path(&file.path);

            let allocator = Allocator::default();
            let chains = walk_chains(&file.source, &file.path, &allocator);
            all_chains.insert(file.path.clone(), chains);

            let mod_allocator = Allocator::default();
            let parse_result =
                Parser::new(&mod_allocator, &file.source, source_type).parse();
            let module_info = parse_module_info(&parse_result.program);
            file_modules.insert(file.path.clone(), module_info);
        }
    } // Lock released here

    // ---------------------------------------------------------------------------
    // Phase 2: Build binding map via import resolver.
    // ---------------------------------------------------------------------------

    let file_paths_clone = file_path_set.clone();
    let resolve_path = |current_file: &str, source: &str| -> Option<String> {
        if source.starts_with('.') {
            resolve_relative_path(current_file, source, &file_paths_clone)
        } else {
            resolve_package_path(source)
        }
    };

    let binding_map = resolve_bindings(&file_modules, &resolve_path);

    // ---------------------------------------------------------------------------
    // Phase 3: Resolve extension provenance.
    //
    // For each chain with extends_from, look up the local binding in binding_map
    // to find the definitive file + export_name of the parent component.
    // ---------------------------------------------------------------------------

    // Maps component_id → parent_component_id (if any)
    let mut parent_map: HashMap<String, String> = HashMap::new();
    // Extension chains whose parent could not be resolved — excluded from extraction
    let mut unresolvable_extensions: HashSet<String> = HashSet::new();

    for (file_path, chains) in &all_chains {
        for chain in chains {
            if !chain.extractable {
                continue;
            }

            let component_id = format!("{}::{}", file_path, chain.binding);

            if let Some(extends_binding) = &chain.extends_from {
                // Resolve the local binding to its definition
                let key = (file_path.clone(), extends_binding.clone());
                if let Some(resolved) = binding_map.get(&key) {
                    let parent_id =
                        format!("{}::{}", resolved.file, resolved.export_name);
                    parent_map.insert(component_id, parent_id);
                } else {
                    // Check if parent is defined in the same file (no import needed)
                    let same_file_parent = format!("{}::{}", file_path, extends_binding);
                    let found_in_same_file = all_chains
                        .get(file_path.as_str())
                        .map_or(false, |chains| {
                            chains.iter().any(|c| {
                                c.binding == *extends_binding && c.extractable
                            })
                        });

                    if found_in_same_file {
                        parent_map.insert(component_id, same_file_parent);
                    } else {
                        // Parent is unresolvable — exclude from extraction
                        unresolvable_extensions.insert(component_id);
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Phase 4: Topological sort.
    // ---------------------------------------------------------------------------

    let mut all_component_ids: Vec<String> = Vec::new();
    for (file_path, chains) in &all_chains {
        for chain in chains {
            if chain.extractable {
                let id = format!("{}::{}", file_path, chain.binding);
                // Skip extensions whose parent couldn't be resolved
                if !unresolvable_extensions.contains(&id) {
                    all_component_ids.push(id);
                }
            }
        }
    }

    // Sort for deterministic ordering across builds (HashMap iteration is non-deterministic)
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
            // On cycle: exclude cyclic components from extraction entirely.
            // They will fall through to Emotion runtime.
            let cycle_set: HashSet<&String> = cycle_ids.iter().collect();
            all_component_ids
                .iter()
                .filter(|id| !cycle_set.contains(id))
                .cloned()
                .collect()
        }
    };

    // ---------------------------------------------------------------------------
    // Phase 5: Evaluate chains + build ComponentCss list.
    //
    // We process in topological order so parent CSS is emitted before child CSS.
    // For extension chains: evaluate the child independently (process_chain).
    // The parent's CSS is already emitted separately — CSS cascade handles inheritance.
    //
    // For merged active groups (system props): propagate parent's active props to child.
    // ---------------------------------------------------------------------------

    // component_id → (ComponentCss, ComponentReplacement, active_props, custom_configs)
    type ChainResult = (
        ComponentCss,
        ComponentReplacement,
        Option<HashSet<String>>,
        Option<PropConfigMap>,
    );
    let mut evaluated: HashMap<String, ChainResult> = HashMap::new();
    // component_id → inherited active props from parent (accumulated)
    let mut inherited_active_props: HashMap<String, HashSet<String>> = HashMap::new();

    // Pre-merge eval results per file, for cache storage.
    // Cache stores PRE-MERGE ComponentCss so extension chains recompute correctly
    // when a parent changes but a child is cached.
    let mut pre_merge_evals: HashMap<String, Vec<CachedEvalEntry>> = HashMap::new();

    // Build a lookup: file_path → source (for process_chain which needs the raw source)
    let source_map: HashMap<String, &str> =
        files.iter().map(|f| (f.path.clone(), f.source.as_str())).collect();

    // Collect extraction diagnostics (bail + skip warnings)
    let mut diagnostics: Vec<ExtractionDiagnostic> = Vec::new();

    // Build a lookup: component_id → chain descriptor
    let mut chain_lookup: HashMap<String, (String, ChainDescriptor)> =
        HashMap::new();
    for (file_path, chains) in &all_chains {
        for chain in chains {
            if chain.extractable {
                let id = format!("{}::{}", file_path, chain.binding);
                chain_lookup.insert(id, (file_path.clone(), chain.clone()));
            } else if let Some(reason) = &chain.bail_reason {
                diagnostics.push(ExtractionDiagnostic {
                    file: file_path.clone(),
                    component: chain.binding.clone(),
                    kind: "bail".to_string(),
                    message: reason.clone(),
                });
            }
        }
    }

    // Process in topological order
    for component_id in &sorted_ids {
        let (file_path, chain) = match chain_lookup.get(component_id) {
            Some(entry) => entry,
            None => continue,
        };

        // Try to get pre-merge data from cache (if this file was a cache hit)
        let cached_eval = if cache_hit_files.contains(file_path) {
            cached_evals_by_file.get(file_path).and_then(|entries| {
                entries.iter().find(|e| e.component_id == *component_id)
            })
        } else {
            None
        };

        let eval_result = if let Some(entry) = cached_eval {
            // Cache hit: use cached pre-merge data
            Ok((
                entry.component_css.clone(),
                entry.replacement.clone(),
                entry.active_props.clone(),
                entry.prop_config.clone(),
                Vec::<String>::new(),
            ))
        } else {
            // Cache miss: evaluate via process_chain
            let source = match source_map.get(file_path.as_str()) {
                Some(s) => s,
                None => continue,
            };
            {
                process_chain(chain, source, file_path, &proc_ctx)
            }
        };

        match eval_result {
            Ok((mut component_css, mut comp_replacement, active_props, custom_configs, skip_warnings)) => {
                // Collect skip warnings as diagnostics
                for warning in &skip_warnings {
                    diagnostics.push(ExtractionDiagnostic {
                        file: file_path.clone(),
                        component: chain.binding.clone(),
                        kind: "skip".to_string(),
                        message: warning.clone(),
                    });
                }

                // Save PRE-MERGE data for cache storage
                pre_merge_evals.entry(file_path.clone()).or_default().push(CachedEvalEntry {
                    component_id: component_id.clone(),
                    component_css: component_css.clone(),
                    replacement: comp_replacement.clone(),
                    active_props: active_props.clone(),
                    prop_config: custom_configs.clone(),
                });

                // For extension chains: merge parent's CSS into child's CSS
                if let Some(parent_id) = parent_map.get(component_id) {
                    if let Some((parent_css, parent_replacement, _, _)) = evaluated.get(parent_id) {
                        // Merge base styles
                        match (&parent_css.base, &component_css.base) {
                            (Some(parent_base), Some(child_base)) => {
                                let mut merged_decls = parent_base.declarations.clone();
                                let child_props: HashSet<&str> = child_base
                                    .declarations.iter().map(|d| d.property.as_str()).collect();
                                merged_decls.retain(|d| !child_props.contains(d.property.as_str()));
                                merged_decls.extend(child_base.declarations.clone());

                                let mut merged_pseudos = parent_base.pseudo_selectors.clone();
                                for (sel, decls) in &child_base.pseudo_selectors {
                                    if let Some(entry) = merged_pseudos.iter_mut().find(|(s, _)| s == sel) {
                                        entry.1 = decls.clone();
                                    } else {
                                        merged_pseudos.push((sel.clone(), decls.clone()));
                                    }
                                }

                                let mut merged_responsive = parent_base.responsive.clone();
                                for (bp, decls) in &child_base.responsive {
                                    if let Some(entry) = merged_responsive.iter_mut().find(|(b, _)| b == bp) {
                                        entry.1 = decls.clone();
                                    } else {
                                        merged_responsive.push((bp.clone(), decls.clone()));
                                    }
                                }

                                component_css.base = Some(crate::theme_resolver::ResolvedStyles {
                                    declarations: merged_decls,
                                    pseudo_selectors: merged_pseudos,
                                    responsive: merged_responsive,
                                    responsive_pseudos: parent_base.responsive_pseudos.clone(),
                                });
                            }
                            (Some(parent_base), None) => {
                                component_css.base = Some(parent_base.clone());
                            }
                            _ => {} // no parent base, nothing to merge
                        }

                        // Merge variants: inherit parent variants child doesn't override
                        for pv in &parent_css.variants {
                            if !component_css.variants.iter().any(|v| v.prop == pv.prop) {
                                component_css.variants.push(VariantCss {
                                    prop: pv.prop.clone(),
                                    options: pv.options.clone(),
                                    default_option: pv.default_option.clone(),
                                });
                            }
                        }

                        // Merge states: inherit parent states child doesn't override
                        for (name, styles) in &parent_css.states {
                            if !component_css.states.iter().any(|(n, _)| n == name) {
                                component_css.states.push((name.clone(), styles.clone()));
                            }
                        }

                        // Inherit compounds: parent first, child appended after
                        if !parent_css.compounds.is_empty() {
                            let mut merged_compounds = parent_css.compounds.clone();
                            merged_compounds.extend(component_css.compounds.drain(..));
                            component_css.compounds = merged_compounds;
                        }

                        // Inherit compound configs for runtime replacement
                        if !parent_replacement.compound_configs.is_empty() {
                            let mut merged_configs = parent_replacement.compound_configs.clone();
                            merged_configs.extend(comp_replacement.compound_configs.drain(..));
                            comp_replacement.compound_configs = merged_configs;
                        }

                        // Inherit parent's variant/state config for runtime replacement
                        for pvc in &parent_replacement.variant_config {
                            if !comp_replacement.variant_config.iter().any(|vc| vc.prop == pvc.prop) {
                                comp_replacement.variant_config.push(VariantPropConfig {
                                    prop: pvc.prop.clone(),
                                    options: pvc.options.clone(),
                                    default: pvc.default.clone(),
                                });
                            }
                        }
                        for ps in &parent_replacement.state_names {
                            if !comp_replacement.state_names.contains(ps) {
                                comp_replacement.state_names.push(ps.clone());
                            }
                        }
                    }
                }

                // Merge active props with parent's inherited active props
                let mut merged_active_props: HashSet<String> = HashSet::new();

                if let Some(parent_id) = parent_map.get(component_id) {
                    if let Some(parent_inherited) = inherited_active_props.get(parent_id) {
                        merged_active_props.extend(parent_inherited.iter().cloned());
                    }
                    if let Some((_, _, parent_active, _)) = evaluated.get(parent_id) {
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
                    (component_css, comp_replacement, final_active_props, custom_configs),
                );
            }
            Err(_e) => {
                // Skip components that fail to evaluate
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Phase 5b: JSX scanning (global — single pass across all files)
    // ---------------------------------------------------------------------------

    // Build component usage configs for variant/state tracking (Arc 4 reconciliation).
    //
    // Only include variant props that have a `defaultVariant` specified.
    // Without a default, rendering a component without an explicit variant prop
    // emits `__default__` in the scanner, which would resolve to nothing and cause
    // the reconciler to eliminate all variant options (incorrect conservative behavior).
    // When a variant has no default, we omit it from tracking so the reconciler
    // falls back to the conservative "keep all" path.
    let mut component_usage_configs: HashMap<String, ComponentUsageConfig> = HashMap::new();

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, _, _)) = evaluated.get(component_id) {
            let binding = comp_replacement.binding.clone();

            let mut variants: HashMap<String, (HashSet<String>, Option<String>)> = HashMap::new();
            for vc in &comp_replacement.variant_config {
                // Only track variants that have an explicit default option.
                // Without a default, implicit usage (no prop passed) is ambiguous.
                if vc.default.is_some() {
                    let options: HashSet<String> = vc.options.iter().cloned().collect();
                    variants.insert(vc.prop.clone(), (options, vc.default.clone()));
                }
            }

            let states: HashSet<String> = comp_replacement.state_names.iter().cloned().collect();

            // Always insert — even with empty variants/states — so the scanner
            // recognizes this binding as a known component and tracks it in
            // rendered_components. Without this, components with no tracked variants
            // and no states would be invisible to the scanner and incorrectly eliminated.
            component_usage_configs.insert(binding, ComponentUsageConfig { variants, states });
        }
    }

    // Build the global component_props map: binding → active system prop names
    // Deduplicated across all files (same binding name in different files gets
    // the union of their active props — this is fine for utility class generation).
    let mut global_component_props: HashMap<String, HashSet<String>> = HashMap::new();

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, active_props, custom_configs)) =
            evaluated.get(component_id)
        {
            let mut all_props: HashSet<String> = HashSet::new();

            if let Some(props) = active_props {
                all_props.extend(props.iter().cloned());
            }
            if let Some(cc) = custom_configs {
                all_props.extend(cc.keys().cloned());
            }

            if !all_props.is_empty() {
                global_component_props
                    .entry(comp_replacement.binding.clone())
                    .or_default()
                    .extend(all_props);
            }
        }
    }

    // Scan files for JSX usages (system props + variant/state/component usage)
    // In dev_mode: scan only changed files (cache miss), reuse cached usage for unchanged files.
    // In prod mode: scan all files.
    let mut all_utility_inputs: Vec<UtilityInput> = Vec::new();
    let mut all_custom_inputs: Vec<UtilityInput> = Vec::new();
    let mut all_custom_dynamic_usages: Vec<crate::jsx_scanner::DynamicPropUsage> = Vec::new();
    let mut all_usage_results: Vec<UsageScanResult> = Vec::new();
    // Per-file usage results for cache storage
    let mut per_file_usage: HashMap<String, UsageScanResult> = HashMap::new();
    // Per-file custom prop scan results for cache storage
    let mut per_file_custom_static: HashMap<String, Vec<SystemPropUsage>> = HashMap::new();
    let mut per_file_custom_dynamic: HashMap<String, Vec<DynamicPropUsage>> = HashMap::new();

    // Build a custom-props-only map for custom prop scanning
    let mut global_custom_props: HashMap<String, HashSet<String>> = HashMap::new();

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, _, custom_configs)) = evaluated.get(component_id) {
            if let Some(cc) = custom_configs {
                if !cc.is_empty() {
                    global_custom_props
                        .entry(comp_replacement.binding.clone())
                        .or_default()
                        .extend(cc.keys().cloned());
                }
            }
        }
    }

    // Pre-scan compose() calls to build member expression resolution map.
    // This must happen before JSX scanning so that <Family.Slot /> usage
    // can resolve to the original slot binding for system prop detection.
    let mut compose_families: Vec<ComposeFamilyInfo> = Vec::new();
    let mut use_client_files: HashSet<String> = HashSet::new();
    for file in files {
        let source_type = source_type_for_path(&file.path);
        let alloc = Allocator::default();
        let parsed = Parser::new(&alloc, &file.source, source_type).parse();
        let file_families = scan_compose_calls(&parsed.program);
        if file_families.iter().any(|f| f.context) {
            use_client_files.insert(file.path.clone());
        }
        compose_families.extend(file_families);
    }

    // Build member expression resolution map from compose families.
    // Maps "Family.Slot" → original binding name (e.g., "NavBar.Root" → "NavBarRoot").
    let mut member_expr_bindings: HashMap<String, String> = HashMap::new();
    for family in &compose_families {
        if let Some(ref family_binding) = family.family_binding {
            for (slot_name, binding_name) in &family.slots {
                let dotted_key = format!("{}.{}", family_binding, slot_name);
                member_expr_bindings.insert(dotted_key, binding_name.clone());
            }
        }
    }

    for file in files {
        if global_component_props.is_empty() && global_custom_props.is_empty() && component_usage_configs.is_empty() {
            break;
        }

        // In dev_mode: reuse cached usage for unchanged files (cache hits)
        if dev_mode && cache_hit_files.contains(&file.path) {
            if let Some(cached_usage) = cached_jsx_by_file.get(&file.path) {
                // Merge cached usage via union (additive — never remove)
                all_utility_inputs.extend(cached_usage.system_prop_usages.iter().map(|u| UtilityInput {
                    prop_name: u.prop_name.clone(),
                    value: u.value.clone(),
                }));
                // Restore cached custom prop usages (static + dynamic)
                if let Some(custom_static) = cached_custom_static_by_file.get(&file.path) {
                    all_custom_inputs.extend(custom_static.iter().map(|u| UtilityInput {
                        prop_name: u.prop_name.clone(),
                        value: u.value.clone(),
                    }));
                }
                if let Some(custom_dynamic) = cached_custom_dynamic_by_file.get(&file.path) {
                    all_custom_dynamic_usages.extend(custom_dynamic.iter().cloned());
                }
                all_usage_results.push(cached_usage.clone());
                per_file_usage.insert(file.path.clone(), cached_usage.clone());
                continue;
            }
        }

        let source_type = source_type_for_path(&file.path);
        let scan_allocator = Allocator::default();
        let parse_result =
            Parser::new(&scan_allocator, &file.source, source_type).parse();

        // Use extended scanner that tracks variant/state/component usage
        let usage_result = scan_jsx_usage(
            &parse_result.program,
            &global_component_props,
            &component_usage_configs,
            &member_expr_bindings,
        );

        // Collect system prop utility inputs from the usage result
        all_utility_inputs.extend(usage_result.system_prop_usages.iter().map(|u| UtilityInput {
            prop_name: u.prop_name.clone(),
            value: u.value.clone(),
        }));

        // Also scan for custom prop usages (scan_jsx is still used for custom props)
        if !global_custom_props.is_empty() {
            let custom_scan = scan_jsx(&parse_result.program, &global_custom_props, &member_expr_bindings);
            all_custom_inputs.extend(custom_scan.static_usages.iter().map(|u| UtilityInput {
                prop_name: u.prop_name.clone(),
                value: u.value.clone(),
            }));
            // Collect custom dynamic usages (per-component scoped)
            all_custom_dynamic_usages.extend(custom_scan.dynamic_usages.iter().cloned());
            // Store per-file for cache
            per_file_custom_static.insert(file.path.clone(), custom_scan.static_usages);
            per_file_custom_dynamic.insert(file.path.clone(), custom_scan.dynamic_usages);
        }

        per_file_usage.insert(file.path.clone(), usage_result.clone());
        all_usage_results.push(usage_result);
    }

    // Aggregate dynamic prop names across all files (needed before Phase 6)
    let dynamic_prop_names: HashSet<String> = all_usage_results
        .iter()
        .flat_map(|r| r.dynamic_prop_usages.iter())
        .map(|d| d.prop_name.clone())
        .collect();

    // Build dynamic_props metadata (needed before utility CSS generation
    // so slot entries can be merged into the same emission stream)
    let mut dynamic_props: HashMap<String, DynamicPropMeta> = HashMap::new();
    for prop_name in &dynamic_prop_names {
        if let Some(prop_config) = config.get(prop_name.as_str()) {
            let kebab = camel_to_kebab(prop_name);
            let mut scale_values: HashMap<String, String> = HashMap::new();
            if let Some(serde_json::Value::String(scale_name)) = &prop_config.scale {
                let prefix = format!("{}.", scale_name);
                for (theme_key, css_value) in theme.iter() {
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

    // Build variable slot entries for merging into utility CSS stream
    let slot_entries = if !dynamic_props.is_empty() {
        Some(build_variable_slot_entries(&dynamic_props, &breakpoints))
    } else {
        None
    };

    // Build the global custom config map (union of all components' custom props).
    // Must happen BEFORE utility CSS generation so inline-transform props can be filtered.
    let mut global_custom_config: PropConfigMap = PropConfigMap::new();
    for component_id in &sorted_ids {
        if let Some((_, _, _, custom_configs)) = evaluated.get(component_id) {
            if let Some(cc) = custom_configs {
                global_custom_config.extend(cc.clone());
            }
        }
    }

    // Props with inline transforms (transform_fn_source) must use the dynamic path —
    // Rust can't evaluate the JS function, so static utility CSS would have untransformed values.
    // Filter from BOTH utility paths before CSS generation.
    let inline_transform_props: HashSet<String> = global_custom_config
        .iter()
        .filter(|(_, config)| config.transform_fn_source.is_some())
        .map(|(name, _)| name.clone())
        .collect();

    if !inline_transform_props.is_empty() {
        // Custom props appear in systemPropNames (for DOM filtering), so the system
        // prop scanner also picks them up. Both must be filtered.
        all_custom_inputs.retain(|input| !inline_transform_props.contains(&input.prop_name));
        all_utility_inputs.retain(|input| !inline_transform_props.contains(&input.prop_name));
    }

    // Generate utility CSS with interleaved slot entries — one sorted @layer system block
    let utility_output = if !all_utility_inputs.is_empty() || slot_entries.is_some() {
        Some(generate_utility_css(&all_utility_inputs, &resolve_ctx, &breakpoints, slot_entries, class_prefix))
    } else {
        None
    };

    // Build per-component custom dynamic prop metadata
    // Group custom dynamic usages by binding → set of dynamic prop names
    let mut custom_dynamic_by_binding: HashMap<String, HashSet<String>> = HashMap::new();
    for dyn_usage in &all_custom_dynamic_usages {
        custom_dynamic_by_binding
            .entry(dyn_usage.binding.clone())
            .or_default()
            .insert(dyn_usage.prop_name.clone());
    }

    // Force inline-transform props into the dynamic path for ALL components that use them.
    // This ensures the runtime transform function runs even for statically-known values.
    if !inline_transform_props.is_empty() {
        for component_id in &sorted_ids {
            if let Some((_, comp_replacement, _, custom_configs)) = evaluated.get(component_id) {
                if let Some(cc) = custom_configs {
                    let binding = &comp_replacement.binding;
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

    // For each component with custom props, build per-component DynamicPropMeta
    // Key: component_id → HashMap<prop_name, DynamicPropMeta>
    let mut per_component_custom_dynamic: HashMap<String, HashMap<String, DynamicPropMeta>> = HashMap::new();
    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, _, custom_configs)) = evaluated.get(component_id) {
            if let Some(cc) = custom_configs {
                let binding = &comp_replacement.binding;
                if let Some(dynamic_props_for_binding) = custom_dynamic_by_binding.get(binding) {
                    let mut component_dynamic: HashMap<String, DynamicPropMeta> = HashMap::new();
                    // Extract class hash from class_name (first 8 chars after last '-')
                    let class_hash = comp_replacement.class_name
                        .rsplit('-')
                        .next()
                        .unwrap_or(&comp_replacement.class_name);
                    let hash8 = &class_hash[..class_hash.len().min(8)];

                    for prop_name in dynamic_props_for_binding {
                        if let Some(prop_config) = cc.get(prop_name) {
                            let kebab = camel_to_kebab(prop_name);
                            let mut scale_values: HashMap<String, String> = HashMap::new();

                            // Handle inline scale (Value::Object) or theme scale ref (Value::String)
                            match &prop_config.scale {
                                Some(serde_json::Value::String(scale_name)) => {
                                    let prefix = format!("{}.", scale_name);
                                    for (theme_key, css_value) in theme.iter() {
                                        if let Some(scale_key) = theme_key.strip_prefix(&prefix) {
                                            scale_values.insert(scale_key.to_string(), css_value.clone());
                                        }
                                    }
                                }
                                Some(serde_json::Value::Object(inline_scale)) => {
                                    let css_prop = camel_to_kebab(&prop_config.property);
                                    for (key, val) in inline_scale {
                                        let resolved = if let Some(s) = val.as_str() {
                                            s.to_string()
                                        } else if let Some(n) = val.as_f64() {
                                            // Apply unit fallback for numeric values
                                            crate::css_generator::apply_unit_fallback_for_property(n, &css_prop)
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
                        per_component_custom_dynamic.insert(component_id.clone(), component_dynamic);
                    }
                }
            }
        }
    }

    // Build custom variable slot entries from all per-component custom dynamic metadata
    let mut all_custom_slot_entries: Vec<(String, ResolvedStyles, String)> = Vec::new();
    for custom_dynamic in per_component_custom_dynamic.values() {
        all_custom_slot_entries.extend(build_variable_slot_entries(custom_dynamic, &breakpoints));
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

    // ---------------------------------------------------------------------------
    // Phase 5c: Populate system_prop_names on each replacement.
    // system_props moved to shared map (UniverseManifest.system_prop_map).
    // ---------------------------------------------------------------------------

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, active_props, custom_configs)) =
            evaluated.get_mut(component_id)
        {
            // Collect all prop names for this component (for DOM filtering)
            let mut all_prop_names: Vec<String> = Vec::new();
            if let Some(props) = active_props {
                all_prop_names.extend(props.iter().cloned());
            }
            if let Some(cc) = custom_configs {
                all_prop_names.extend(cc.keys().cloned());
            }
            all_prop_names.sort();
            all_prop_names.dedup();

            if !all_prop_names.is_empty() {
                comp_replacement.system_prop_names = all_prop_names.clone();
            }

            // Populate per-component custom prop class map from custom_output
            if let Some(cc) = custom_configs {
                if !cc.is_empty() {
                    if let Some(ref custom_out) = custom_output {
                        let mut component_class_map: HashMap<String, HashMap<String, String>> = HashMap::new();
                        for prop_name in cc.keys() {
                            if let Some(val_map) = custom_out.class_map.get(prop_name) {
                                component_class_map.insert(prop_name.clone(), val_map.clone());
                            }
                        }
                        if !component_class_map.is_empty() {
                            comp_replacement.custom_prop_class_map = Some(component_class_map);
                        }
                    }
                }
            }

            // Populate per-component custom dynamic config
            if let Some(custom_dynamic) = per_component_custom_dynamic.get(component_id) {
                comp_replacement.custom_dynamic_config = Some(custom_dynamic.clone());
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Phase 5d: Build usage ledger from all scan results.
    // ---------------------------------------------------------------------------

    let variant_configs_for_ledger: HashMap<String, HashMap<String, (HashSet<String>, Option<String>)>> =
        component_usage_configs.iter()
            .map(|(binding, config)| (binding.clone(), config.variants.clone()))
            .collect();

    let mut usage_ledger = build_ledger(&all_usage_results, &variant_configs_for_ledger);

    // .asClass() chains are always "rendered" — they produce class names used
    // outside JSX, so the scanner never sees them as rendered components.
    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, _, _)) = evaluated.get(component_id) {
            if comp_replacement.is_class_resolver {
                usage_ledger.rendered_components.insert(comp_replacement.binding.clone());
            }
        }
    }

    // Mark all slot bindings as rendered (backward compat with previous behavior).
    // compose_families was built earlier (pre-JSX-scan phase) for member expression resolution.
    for family in &compose_families {
        for (_slot_name, binding_name) in &family.slots {
            usage_ledger.rendered_components.insert(binding_name.clone());
        }
    }

    // For shared variant keys, mark all variant options as used on child slots
    // so the reconciler doesn't prune them. Children in a compose family receive
    // shared variants via CSS, not direct JSX props — the reconciler won't see
    // direct usage, so we must pre-populate.
    for family in &compose_families {
        for (_slot_name, binding_name) in &family.slots {
            if *binding_name == family.root_binding {
                continue; // Root's variants are used directly via JSX props
            }
            for shared_key in &family.shared_keys {
                // Look up variant config to get all options for this shared key
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

    // ---------------------------------------------------------------------------
    // Phase 5e: Build reconciled component list (topo order) and reconcile.
    // In dev_mode: skip reconciliation — pass all components without pruning.
    // ---------------------------------------------------------------------------

    // Build the mutable Vec<(component_id, ComponentCss)> in topological order.
    let mut reconciled_components: Vec<(String, ComponentCss)> = sorted_ids
        .iter()
        .filter_map(|component_id| {
            evaluated.get(component_id).map(|(component_css, _, _, _)| {
                (component_id.clone(), component_css.clone())
            })
        })
        .collect();

    // Reconcile only in prod mode (dev_mode skips to retain all variants/states/components)
    let reconciliation_report = if dev_mode {
        serde_json::json!({})
    } else {
        // Collect the bindings of components that serve as parents in the extension graph.
        let parent_bindings: HashSet<String> = parent_map.values()
            .filter_map(|parent_id| parent_id.rfind("::").map(|pos| parent_id[pos + 2..].to_string()))
            .collect();
        let report = reconcile(&mut reconciled_components, &usage_ledger, &parent_bindings);
        serde_json::to_value(&report).unwrap_or(serde_json::json!({}))
    };

    // ---------------------------------------------------------------------------
    // Phase 6: Generate replacement strings.
    // ---------------------------------------------------------------------------

    let mut replacement_by_id: HashMap<String, String> = HashMap::new();

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, _, _)) = evaluated.get_mut(component_id) {
            // Set has_dynamic_props if any of this component's system prop names
            // appear in the global dynamic_prop_names set
            comp_replacement.has_dynamic_props = comp_replacement
                .system_prop_names
                .iter()
                .any(|name| dynamic_prop_names.contains(name));
            let replacement_text = generate_replacement(comp_replacement, group_registry);
            replacement_by_id.insert(component_id.clone(), replacement_text);
        }
    }

    // Extract ordered component_ids and css list from the reconciled components.
    // reconciled_components is already in topological order (built from sorted_ids).
    let reconciled_order: Vec<String> = reconciled_components.iter().map(|(id, _)| id.clone()).collect();
    let component_css_list: Vec<ComponentCss> = reconciled_components.into_iter().map(|(_, css)| css).collect();

    // ---------------------------------------------------------------------------
    // Phase 6b: Generate CSS with topological ordering.
    // ---------------------------------------------------------------------------

    let mut sheets = generate_css_sheets_ordered(&component_css_list, &breakpoints, &reconciled_order, class_prefix);

    // Phase 6c: Generate composed variant CSS for compose() families.
    // Build binding → class_name map from evaluated components.
    if !compose_families.is_empty() {
        let binding_to_class: HashMap<&str, &str> = evaluated
            .values()
            .map(|(_, cr, _, _)| (cr.binding.as_str(), cr.class_name.as_str()))
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
            let composed_css = generate_composed_variant_css(&family_refs, &component_css_list, &breakpoints);
            if !composed_css.is_empty() {
                // Wrap variants in sublayer structure: standalone < composed.
                // Extract raw standalone content from the existing @layer variants block,
                // then reassemble with sublayer wrappers.
                let standalone_content = extract_layer_content(&sheets.variants);
                let mut sublayered = String::new();
                writeln!(sublayered, "@layer variants {{").unwrap();
                writeln!(sublayered, "  @layer standalone, composed;").unwrap();
                if !standalone_content.is_empty() {
                    writeln!(sublayered, "  @layer standalone {{").unwrap();
                    sublayered.push_str(&standalone_content);
                    writeln!(sublayered, "  }}").unwrap();
                }
                writeln!(sublayered, "  @layer composed {{").unwrap();
                sublayered.push_str(&composed_css);
                writeln!(sublayered, "  }}").unwrap();
                writeln!(sublayered, "}}").unwrap();
                sheets.variants = sublayered;
            }
        }
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

    // Concatenated CSS for backward compatibility
    let mut css = sheets.declaration.clone();
    css.push('\n');
    for sheet in [&sheets.base, &sheets.variants, &sheets.compounds, &sheets.states, &sheets.system, &sheets.custom] {
        if !sheet.is_empty() {
            css.push_str(sheet);
            css.push('\n');
        }
    }

    // ---------------------------------------------------------------------------
    // Phase 7: Build manifest.
    // ---------------------------------------------------------------------------

    let mut components_map: HashMap<String, ComponentDescriptor> = HashMap::new();
    let mut files_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut provenance_map: HashMap<String, Vec<String>> = HashMap::new();

    for component_id in &sorted_ids {
        let (file_path, chain) = match chain_lookup.get(component_id) {
            Some(entry) => entry,
            None => continue,
        };

        let (_, comp_replacement, _active_props, _custom_configs) =
            match evaluated.get(component_id) {
                Some(r) => r,
                None => continue,
            };

        let replacement = replacement_by_id
            .get(component_id)
            .cloned()
            .unwrap_or_default();

        let terminal_str = match chain.terminal {
            TerminalKind::AsElement => "asElement",
            TerminalKind::AsComponent => "asComponent",
            TerminalKind::AsClass => "asClass",
        };

        let descriptor = ComponentDescriptor {
            file: file_path.clone(),
            binding: chain.binding.clone(),
            class_name: comp_replacement.class_name.clone(),
            extends_from: parent_map.get(component_id).cloned(),
            terminal: terminal_str.to_string(),
            tag: chain.tag.clone(),
            replacement,
            system_prop_names: comp_replacement.system_prop_names.clone(),
        };

        components_map.insert(component_id.clone(), descriptor);

        // files_map: file → [component_ids]
        files_map
            .entry(file_path.clone())
            .or_default()
            .push(component_id.clone());

        // provenance_map: component_id → ancestor chain
        let mut ancestors: Vec<String> = Vec::new();
        let mut current = parent_map.get(component_id).cloned();
        while let Some(pid) = current {
            ancestors.push(pid.clone());
            current = parent_map.get(&pid).cloned();
        }
        if !ancestors.is_empty() {
            provenance_map.insert(component_id.clone(), ancestors);
        }
    }

    // Build utilities map: class_name → css declaration snippet
    let mut utilities_map: HashMap<String, String> = HashMap::new();
    if let Some(util_out) = &utility_output {
        for (prop, val_map) in &util_out.class_map {
            for (val_key, class_name) in val_map {
                utilities_map.insert(class_name.clone(), format!("{}:{}", prop, val_key));
            }
        }
    }

    // Serialize usage ledger for the manifest
    let mut rendered_sorted: Vec<&String> = usage_ledger.rendered_components.iter().collect();
    rendered_sorted.sort();
    let usage_json = serde_json::json!({
        "rendered_components": rendered_sorted,
        "variant_usage": usage_ledger.variant_usage,
        "state_usage": usage_ledger.state_usage,
    });

    // ---------------------------------------------------------------------------
    // Cache storage: store results for cache-miss files, evict removed files
    // ---------------------------------------------------------------------------

    if let Ok(mut cache) = FILE_CACHE.lock() {
        for file in files {
            if let Some(ref file_hash) = file.hash {
                if cache_hit_files.contains(&file.path) {
                    // Re-insert cache-hit entries (taken via remove() in Phase 1)
                    let eval_results = cached_evals_by_file.remove(&file.path).unwrap_or_default();
                    let jsx_usage = cached_jsx_by_file.remove(&file.path).unwrap_or_default();
                    let custom_prop_static = cached_custom_static_by_file.remove(&file.path).unwrap_or_default();
                    let custom_prop_dynamic = cached_custom_dynamic_by_file.remove(&file.path).unwrap_or_default();
                    cache.insert(file.path.clone(), CachedFileResult {
                        hash: file_hash.clone(),
                        module_info: file_modules.get(&file.path).cloned().unwrap_or(FileModuleInfo {
                            imports: Vec::new(),
                            exports: Vec::new(),
                        }),
                        chains: all_chains.get(&file.path).cloned().unwrap_or_default(),
                        eval_results,
                        jsx_usage,
                        custom_prop_static,
                        custom_prop_dynamic,
                    });
                } else {
                    // Cache miss: store fresh results
                    let jsx_usage = per_file_usage.remove(&file.path).unwrap_or_default();
                    let custom_prop_static = per_file_custom_static.remove(&file.path).unwrap_or_default();
                    let custom_prop_dynamic = per_file_custom_dynamic.remove(&file.path).unwrap_or_default();
                    cache.insert(file.path.clone(), CachedFileResult {
                        hash: file_hash.clone(),
                        module_info: file_modules.get(&file.path).cloned().unwrap_or(FileModuleInfo {
                            imports: Vec::new(),
                            exports: Vec::new(),
                        }),
                        chains: all_chains.get(&file.path).cloned().unwrap_or_default(),
                        eval_results: pre_merge_evals.remove(&file.path).unwrap_or_default(),
                        jsx_usage,
                        custom_prop_static,
                        custom_prop_dynamic,
                    });
                }
            }
        }

        // Evict cache entries for files not in current file list
        let paths_to_evict: Vec<String> = cache.keys()
            .filter(|k| !file_path_set.contains(*k))
            .cloned()
            .collect();
        for path in paths_to_evict {
            cache.remove(&path);
        }
    }

    // Build shared system prop map from utility output (group props only)
    let system_prop_map = if let Some(util_out) = &utility_output {
        util_out.class_map.clone()
    } else {
        HashMap::new()
    };

    UniverseManifest {
        components: components_map,
        utilities: utilities_map,
        css,
        sheets,
        provenance: provenance_map,
        files: files_map,
        usage: usage_json,
        report: reconciliation_report,
        diagnostics,
        system_prop_map,
        dynamic_props,
        emitter_config,
        use_client_files,
    }
}

// ---------------------------------------------------------------------------
// Helper: determine OXC SourceType from file extension
// ---------------------------------------------------------------------------

fn source_type_for_path(path: &str) -> SourceType {
    if path.ends_with(".tsx") {
        SourceType::tsx()
    } else if path.ends_with(".ts") {
        SourceType::ts()
    } else if path.ends_with(".jsx") {
        SourceType::jsx()
    } else {
        SourceType::mjs()
    }
}

// ---------------------------------------------------------------------------
// Helper: resolve a relative import path against the set of known files
// ---------------------------------------------------------------------------

/// Resolve a relative import (`"./Button"`, `"../components/Button"`) from
/// `from_file` against the set of known project files.
///
/// Tries extensions: `.ts`, `.tsx`, `.js`, `.jsx`, and bare + `/index.*`.
pub fn resolve_relative_path(
    from_file: &str,
    import_source: &str,
    known_files: &HashSet<String>,
) -> Option<String> {
    // Get the directory of the importing file
    let dir = match from_file.rfind('/') {
        Some(pos) => &from_file[..pos],
        None => "",
    };

    // Normalize: join dir + import_source
    let joined = if dir.is_empty() {
        import_source.to_string()
    } else {
        format!("{}/{}", dir, import_source)
    };

    // Normalise dotdot segments (simple — not a full path normaliser)
    let candidate = normalise_path(&joined);

    // Try with extensions
    const EXTENSIONS: &[&str] = &[".ts", ".tsx", ".js", ".jsx"];

    // 1. Try direct match (already has extension)
    if known_files.contains(&candidate) {
        return Some(candidate);
    }

    // 2. Try appending extensions
    for ext in EXTENSIONS {
        let with_ext = format!("{}{}", candidate, ext);
        if known_files.contains(&with_ext) {
            return Some(with_ext);
        }
    }

    // 3. Try /index.* variants
    for ext in EXTENSIONS {
        let index_path = format!("{}/index{}", candidate, ext);
        if known_files.contains(&index_path) {
            return Some(index_path);
        }
    }

    None
}

/// Very simple path normalisation: collapse `..` segments.
/// Does not handle `.` segments or Windows-style paths.
fn normalise_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();

    for segment in path.split('/') {
        match segment {
            ".." => {
                parts.pop();
            }
            "." | "" => {
                // skip empty and current-dir segments (except preserve leading empty for absolute paths)
            }
            other => {
                parts.push(other);
            }
        }
    }

    // Preserve leading slash for absolute paths
    if path.starts_with('/') {
        format!("/{}", parts.join("/"))
    } else {
        parts.join("/")
    }
}

/// Extract raw CSS content from an `@layer name { ... }` block.
///
/// Given `"@layer variants {\n  .foo { ... }\n}\n"`, returns `"  .foo { ... }\n"`.
/// Returns an empty string if the input is empty or not a layer block.
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
