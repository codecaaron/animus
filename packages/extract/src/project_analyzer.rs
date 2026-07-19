use std::collections::{HashMap, HashSet};
use std::fmt::Write;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use rustc_hash::{FxHashMap, FxHashSet};

use once_cell::sync::Lazy;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::chain_merger::{ProvenanceNode, TopoResult, topological_sort};
use crate::chain_walker::{walk_chains_from_program, ChainDescriptor, TerminalKind};
use crate::transform_extractor::{extract_transforms, ExtractedTransform};
use crate::css_generator::{
    build_variable_slot_entries, generate_composed_variant_css, generate_css_sheets_ordered,
    generate_custom_prop_css, generate_utility_css, layer_name, ComponentCss, ComposeFamilyRef,
    CssSheets, PerComponentSheets, UtilityInput, VariantCss,
};
use crate::theme_resolver::ResolvedStyles;
use crate::import_resolver::{
    parse_module_info, resolve_bindings, FileModuleInfo, ResolvedBinding,
};
use crate::jsx_scanner::{scan_compose_calls, scan_jsx, scan_jsx_usage, ComponentUsageConfig, ComposeFamilyInfo, DynamicPropUsage, SystemPropUsage, UsageScanResult};
use crate::reconciler::{build_ledger, identify_prospective_eliminations, reconcile, ReconciliationReport, VariantConfigMap};
use crate::theme_resolver::{resolve_all_global_blocks, resolve_all_keyframes_blocks, ContextualVarsMap, FlatTheme, PropConfigMap, ResolveContext, SelectorAliasesMap, VariableMap};
use crate::transform_emitter::{
    generate_replacement, ComponentReplacement, VariantPropConfig,
};
use crate::style_evaluator::{collect_static_values, collect_static_exports};
use crate::{extract_breakpoints, process_chain, ProcessingContext};

type ComponentPropSetMap = FxHashMap<String, FxHashSet<String>>;
type ScanMaps<'a> = (
    &'a ComponentPropSetMap,
    &'a FxHashMap<String, ComponentUsageConfig>,
    &'a ComponentPropSetMap,
);

// ---------------------------------------------------------------------------
// Per-file extraction cache (persistent across analyzeProject() calls)
// ---------------------------------------------------------------------------

/// Cached evaluation result for a single component within a file.
#[derive(Debug, Clone)]
pub struct CachedEvalEntry {
    pub component_id: String,
    pub component_css: ComponentCss,
    pub replacement: ComponentReplacement,
    pub active_props: Option<FxHashSet<String>>,
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
    /// Compose family results — cached because compose scanning re-parses source,
    /// and HMR sends empty source for unchanged files (cache-hit optimization).
    pub compose_families: Vec<ComposeFamilyInfo>,
    /// Extracted createTransform() calls — cached so HMR cache hits
    /// still contribute to the extracted_transforms map.
    pub extracted_transforms: Vec<ExtractedTransform>,
    /// Statically-evaluable top-level const declarations: binding_name → Value.
    pub static_values: FxHashMap<String, Value>,
    /// Subset of static_values that are exported: export_name → Value.
    pub static_exports: FxHashMap<String, Value>,
}

/// Per-file Phase 1 parse result, collected from parallel workers and merged sequentially.
struct FileParseResult {
    path: String,
    chains: Vec<ChainDescriptor>,
    module_info: FileModuleInfo,
    transforms: Vec<ExtractedTransform>,
    static_values: FxHashMap<String, Value>,
    static_exports: FxHashMap<String, Value>,
}

/// Persistent per-file cache. Key is file path, value is the cached extraction result.
/// Protected by a Mutex for safe cross-thread NAPI access.
static FILE_CACHE: Lazy<Mutex<FxHashMap<String, CachedFileResult>>> =
    Lazy::new(|| Mutex::new(FxHashMap::default()));

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

/// The type of path alias: prefix match (wildcard) or exact match.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AliasType {
    Prefix,
    Exact,
}

/// A path alias entry forwarded from the host bundler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AliasEntry {
    pub pattern: String,
    pub replacement: String,
    #[serde(rename = "type")]
    pub alias_type: AliasType,
}

/// Expand an import source against the alias list.
///
/// Tries each alias in order (callers should sort longest-prefix-first).
/// Returns the expanded path (project-root-relative) on first match, or None.
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
    /// Serialized key-sorted: these bytes reach consumer bundles via the
    /// system-props virtual module (deterministic emission across processes).
    #[serde(default, serialize_with = "sorted_nested_map")]
    pub system_prop_map: HashMap<String, HashMap<String, String>>,
    /// Dynamic prop metadata: prop_name → DynamicPropMeta.
    /// Only props with at least one detected dynamic usage appear here.
    #[serde(default, serialize_with = "sorted_map")]
    pub dynamic_props: HashMap<String, DynamicPropMeta>,
    /// Emitter configuration for generated import paths.
    /// Stored in the manifest so `transform_file()` can read it without extra parameters.
    #[serde(default)]
    pub emitter_config: crate::transform_emitter::EmitterConfig,
    /// Files that need a `"use client"` directive injected (compose families with `context: true`).
    #[serde(default)]
    pub use_client_files: HashSet<String>,
    /// Compose call replacements — one per compose() call expression in the project.
    #[serde(default)]
    pub compose_replacements: Vec<ComposeReplacementDescriptor>,
    /// Resolved global CSS (from global style blocks). Wraps in @layer anm-global.
    #[serde(default)]
    pub global_css: String,
    /// Per-component CSS fragments for the 4 splittable layers (base, variants, compounds, states).
    /// Keyed by component_id. Enables incremental HMR and future route-level code-splitting.
    #[serde(default, serialize_with = "sorted_map")]
    pub component_fragments: HashMap<String, PerComponentSheets>,
    /// Reverse provenance: parent_id → [child_ids that extend it].
    /// Enables transitive cache invalidation when a parent component changes.
    #[serde(default)]
    pub reverse_provenance: HashMap<String, Vec<String>>,
    /// Per-phase pipeline timing data.
    pub timing: PipelineTiming,
}

/// Describes a compose() call to be replaced by createComposedFamily().
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposeReplacementDescriptor {
    pub file_path: String,
    pub slots: Vec<(String, String)>,
    pub name: String,
    pub context: bool,
    pub shared_keys: Vec<String>,
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
    #[serde(default, serialize_with = "sorted_map")]
    pub scale_values: HashMap<String, String>,
}

/// Serialize a HashMap with sorted keys — HashMap iteration order is
/// per-process random, and these fields reach consumer-visible bytes.
fn sorted_map<S, V>(map: &HashMap<String, V>, ser: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
    V: Serialize,
{
    let sorted: std::collections::BTreeMap<&String, &V> = map.iter().collect();
    sorted.serialize(ser)
}

/// Serialize a two-level HashMap with both levels key-sorted.
fn sorted_nested_map<S>(
    map: &HashMap<String, HashMap<String, String>>,
    ser: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    let sorted: std::collections::BTreeMap<&String, std::collections::BTreeMap<&String, &String>> =
        map.iter().map(|(k, v)| (k, v.iter().collect())).collect();
    sorted.serialize(ser)
}

/// Per-phase timing data from the extraction pipeline.
/// Durations are in milliseconds (u64 truncation — sub-ms phases report 0).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineTiming {
    pub parse_and_walk: u64,
    pub import_resolution: u64,
    pub extension_provenance: u64,
    pub topological_sort: u64,
    pub chain_evaluation: u64,
    pub jsx_scanning: u64,
    pub system_prop_aggregation: u64,
    pub usage_ledger: u64,
    pub reconciliation: u64,
    pub css_generation: u64,
    pub manifest_serialization: u64,
    pub file_count: usize,
    pub cache_hits: usize,
    pub total_ms: u64,
    /// Parser invocations during this analyze() call (informational; the
    /// parity harness reads it for the parse-count budget). Best-effort
    /// under concurrent analyze calls — the counter is process-global and
    /// the plugin serializes analysis via its singleton promise.
    #[serde(default)]
    pub parse_count: usize,
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

fn resolve_project_static_values(
    file_modules: &FxHashMap<String, FileModuleInfo>,
    binding_map: &FxHashMap<(String, String), ResolvedBinding>,
    static_values_by_file: &FxHashMap<String, FxHashMap<String, Value>>,
    static_exports_by_file: &FxHashMap<String, FxHashMap<String, Value>>,
    keyframes_blocks: Option<&Value>,
) -> FxHashMap<String, FxHashMap<String, Value>> {
    // system_loader emits `{ exportName: { keyName: { name, frames } } }`.
    // Reshape it to `{ exportName: { keyName: name } }` for static evaluation.
    let keyframes_registry: FxHashMap<String, Value> = keyframes_blocks
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(export_name, collection)| {
                    let coll_obj = collection.as_object()?;
                    let mut map = serde_json::Map::new();
                    for (key_name, block) in coll_obj {
                        if let Some(name) = block.get("name").and_then(|n| n.as_str()) {
                            map.insert(key_name.clone(), Value::String(name.to_string()));
                        }
                    }
                    Some((export_name.clone(), Value::Object(map)))
                })
                .collect()
        })
        .unwrap_or_default();

    let mut resolved_static_values: FxHashMap<String, FxHashMap<String, Value>> =
        FxHashMap::default();

    for (file_path, file_info) in file_modules {
        // Preserve enrichment order: local, imported static, imported keyframe,
        // then same-file keyframe values.
        let mut values = static_values_by_file
            .get(file_path)
            .cloned()
            .unwrap_or_default();

        for imp in &file_info.imports {
            let key = (file_path.clone(), imp.local_name.clone());
            if let Some(resolved) = binding_map.get(&key) {
                if let Some(export_map) = static_exports_by_file.get(&resolved.file) {
                    if let Some(val) = export_map.get(&resolved.export_name) {
                        values.insert(imp.local_name.clone(), val.clone());
                    }
                }
                // Keyframes registry is keyed by export name at the system entry.
                // We assume the resolved export name is globally unique for keyframes
                // collections (the system_loader scans a single entry module).
                if let Some(kf) = keyframes_registry.get(&resolved.export_name) {
                    values.insert(imp.local_name.clone(), kf.clone());
                }
            }
        }

        // Also handle the case where a file defines a keyframes collection locally
        // and uses it in the same file (e.g., the system entry declaring both the
        // collection and a component that references it).
        for exp in &file_info.exports {
            if let Some(local) = &exp.local_name {
                if let Some(kf) = keyframes_registry.get(&exp.exported_name) {
                    values.insert(local.clone(), kf.clone());
                }
            }
        }

        resolved_static_values.insert(file_path.clone(), values);
    }

    resolved_static_values
}

// ---------------------------------------------------------------------------
// Main analysis entry point
// ---------------------------------------------------------------------------

/// Analyse all project files and produce a `UniverseManifest`.
///
/// `resolve_package_path(source)` is called when an import source does not
/// start with `'.'` (i.e. it is a package specifier).  Return `None` to mark
/// the import as unresolvable.
/// Process-global parser-invocation counter for the analyze path.
/// Reset at analyze() entry; reported as timing.parse_count.
pub static ANALYZE_PARSE_COUNT: AtomicUsize = AtomicUsize::new(0);

pub fn count_parse() {
    ANALYZE_PARSE_COUNT.fetch_add(1, Ordering::Relaxed);
}

// The analysis pipeline keeps its immutable inputs explicit at this boundary.
#[allow(clippy::too_many_arguments)]
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
    global_style_blocks: Option<&Value>,
    path_aliases: &[AliasEntry],
    keyframes_blocks: Option<&Value>,
) -> UniverseManifest {
    ANALYZE_PARSE_COUNT.store(0, Ordering::Relaxed);
    let breakpoints = extract_breakpoints(theme);
    let bp_keys: FxHashSet<String> = breakpoints.breakpoints.keys().cloned().collect();
    let evaluator = crate::transform_evaluator::TransformEvaluator::new();
    let resolve_ctx = ResolveContext {
        config,
        theme,
        variable_map,
        contextual_vars,
        breakpoint_keys: &bp_keys,
        selector_aliases,
        transform_evaluator: Some(&evaluator),
    };
    let proc_ctx = ProcessingContext {
        resolve: &resolve_ctx,
        group_registry,
        class_prefix,
    };

    let total_start = Instant::now();
    let file_count = files.len();

    // Collect file paths as a HashSet for fast membership checks during path resolution.
    let file_path_set: FxHashSet<String> = files.iter().map(|f| f.path.clone()).collect();

    // Track which files were cache hits vs misses (for incremental JSX scanning)
    let mut cache_hit_files: FxHashSet<String> = FxHashSet::default();

    // Cached eval entries extracted during Phase 1 for use in Phase 5.
    // Key: file_path, Value: vec of cached eval entries (taken from cache, not cloned).
    let mut cached_evals_by_file: FxHashMap<String, Vec<CachedEvalEntry>> = FxHashMap::default();
    // Cached JSX usage results for dev-mode incremental scanning.
    let mut cached_jsx_by_file: FxHashMap<String, UsageScanResult> = FxHashMap::default();
    // Cached custom prop scan results for dev-mode incremental scanning.
    let mut cached_custom_static_by_file: FxHashMap<String, Vec<SystemPropUsage>> = FxHashMap::default();
    let mut cached_custom_dynamic_by_file: FxHashMap<String, Vec<DynamicPropUsage>> = FxHashMap::default();
    // Cached compose family results for dev-mode incremental scanning.
    let mut cached_compose_by_file: FxHashMap<String, Vec<ComposeFamilyInfo>> = FxHashMap::default();
    // Per-file extracted transforms (for cache storage).
    let mut transforms_by_file: FxHashMap<String, Vec<ExtractedTransform>> = FxHashMap::default();
    // Extracted createTransform() function sources across all files.
    let mut all_extracted_transforms: Vec<ExtractedTransform> = Vec::new();
    // Per-file static values (binding_name → Value) for const resolution.
    let mut static_values_by_file: FxHashMap<String, FxHashMap<String, Value>> = FxHashMap::default();
    // Per-file static exports (export_name → Value) for cross-file resolution.
    let mut static_exports_by_file: FxHashMap<String, FxHashMap<String, Value>> = FxHashMap::default();

    // ---------------------------------------------------------------------------
    // Phase 1: Parse all files — collect chains and module info.
    let phase1_start = Instant::now();
    // Split into two passes:
    //   Pass 1 (sequential, under lock): process cache hits, collect cache-miss refs
    //   Pass 2 (parallel, lock-free): par_iter over cache misses with per-file allocators
    // ---------------------------------------------------------------------------

    let mut all_chains: FxHashMap<String, Vec<ChainDescriptor>> = FxHashMap::default();
    let mut file_modules: FxHashMap<String, FileModuleInfo> = FxHashMap::default();

    // Indices of files that were cache misses (for parallel processing)
    let mut cache_miss_indices: Vec<usize> = Vec::new();

    {
        // Pass 1: Hold lock for cache lookups — take ownership of matching entries
        let mut cache_guard = FILE_CACHE.lock().unwrap_or_else(|e| e.into_inner());

        for (idx, file) in files.iter().enumerate() {
            if let Some(ref file_hash) = file.hash {
                let cache_hit = cache_guard.get(&file.path)
                    .is_some_and(|c| c.hash == *file_hash);
                if cache_hit {
                    let cached = cache_guard.remove(&file.path).unwrap();
                    all_chains.insert(file.path.clone(), cached.chains);
                    file_modules.insert(file.path.clone(), cached.module_info);
                    cached_evals_by_file.insert(file.path.clone(), cached.eval_results);
                    cached_jsx_by_file.insert(file.path.clone(), cached.jsx_usage);
                    cached_custom_static_by_file.insert(file.path.clone(), cached.custom_prop_static);
                    cached_custom_dynamic_by_file.insert(file.path.clone(), cached.custom_prop_dynamic);
                    cached_compose_by_file.insert(file.path.clone(), cached.compose_families);
                    all_extracted_transforms.extend(cached.extracted_transforms);
                    static_values_by_file.insert(file.path.clone(), cached.static_values);
                    static_exports_by_file.insert(file.path.clone(), cached.static_exports);
                    cache_hit_files.insert(file.path.clone());
                    continue;
                }
            }
            cache_miss_indices.push(idx);
        }
    } // Lock released before parallel work

    // Pass 2: Parse cache-miss files in parallel (each gets its own allocator)
    use rayon::prelude::*;

    let parse_results: Vec<FileParseResult> = cache_miss_indices
        .par_iter()
        .map(|&idx| {
            let file = &files[idx];
            let source_type = source_type_for_path(&file.path);
            let allocator = Allocator::default();
            count_parse();
            let parse_result = Parser::new(&allocator, &file.source, source_type).parse();

            let chains = walk_chains_from_program(&parse_result.program, &file.source);
            let module_info = parse_module_info(&parse_result.program);

            let mut ct_bindings: FxHashSet<String> = FxHashSet::default();
            for imp in &module_info.imports {
                if imp.imported_name == "createTransform" && imp.local_name != "createTransform" {
                    ct_bindings.insert(imp.local_name.clone());
                }
            }
            let transforms = extract_transforms(
                &parse_result.program,
                &file.source,
                &file.path,
                &ct_bindings,
            );

            let static_values = collect_static_values(&parse_result.program);
            let static_exports = collect_static_exports(&module_info, &static_values);

            FileParseResult {
                path: file.path.clone(),
                chains,
                module_info,
                transforms,
                static_values,
                static_exports,
            }
        })
        .collect();

    // Sequential merge: insert parallel results into main maps
    for result in parse_results {
        all_chains.insert(result.path.clone(), result.chains);
        file_modules.insert(result.path.clone(), result.module_info);
        transforms_by_file.insert(result.path.clone(), result.transforms.clone());
        all_extracted_transforms.extend(result.transforms);
        static_values_by_file.insert(result.path.clone(), result.static_values);
        static_exports_by_file.insert(result.path.clone(), result.static_exports);
    }

    let parse_and_walk_ms = phase1_start.elapsed().as_millis() as u64;
    let cache_hits = cache_hit_files.len();

    // ---------------------------------------------------------------------------
    // Phase 2: Build binding map via import resolver.
    // ---------------------------------------------------------------------------
    let phase2_start = Instant::now();

    let file_paths_set_clone = file_path_set.clone();
    let resolve_path = |current_file: &str, source: &str| -> Option<String> {
        if source.starts_with('.') {
            resolve_relative_path(current_file, source, &file_paths_set_clone)
        } else if let Some(expanded) = expand_alias(source, path_aliases) {
            probe_known_files(&expanded, &file_paths_set_clone)
        } else {
            resolve_package_path(source)
        }
    };

    let binding_map = resolve_bindings(&file_modules, &resolve_path);

    let resolved_static_values = resolve_project_static_values(
        &file_modules,
        &binding_map,
        &static_values_by_file,
        &static_exports_by_file,
        keyframes_blocks,
    );

    let import_resolution_ms = phase2_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 3: Resolve extension provenance.
    //
    // For each chain with extends_from, look up the local binding in binding_map
    // to find the definitive file + export_name of the parent component.
    // ---------------------------------------------------------------------------
    let phase3_start = Instant::now();

    // Maps component_id → parent_component_id (if any)
    let mut parent_map: FxHashMap<String, String> = FxHashMap::default();
    // Extension chains whose parent could not be resolved — excluded from extraction
    let mut unresolvable_extensions: FxHashSet<String> = FxHashSet::default();

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
                        .is_some_and(|chains| {
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

    let extension_provenance_ms = phase3_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 4: Topological sort.
    // ---------------------------------------------------------------------------
    let phase4_start = Instant::now();

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
            let cycle_set: FxHashSet<&String> = cycle_ids.iter().collect();
            all_component_ids
                .iter()
                .filter(|id| !cycle_set.contains(id))
                .cloned()
                .collect()
        }
    };

    let topological_sort_ms = phase4_start.elapsed().as_millis() as u64;

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
        Option<FxHashSet<String>>,
        Option<PropConfigMap>,
    );
    let mut evaluated: FxHashMap<String, ChainResult> = FxHashMap::default();
    let phase5a_start = Instant::now();
    // component_id → inherited active props from parent (accumulated)
    let mut inherited_active_props: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();

    // Pre-merge eval results per file, for cache storage.
    // Cache stores PRE-MERGE ComponentCss so extension chains recompute correctly
    // when a parent changes but a child is cached.
    let mut pre_merge_evals: FxHashMap<String, Vec<CachedEvalEntry>> = FxHashMap::default();

    // Build a lookup: file_path → source (for process_chain which needs the raw source)
    let source_map: FxHashMap<String, &str> =
        files.iter().map(|f| (f.path.clone(), f.source.as_str())).collect();

    // Collect extraction diagnostics (bail + skip warnings)
    let mut diagnostics: Vec<ExtractionDiagnostic> = Vec::new();

    // Register valid extracted transforms into the boa evaluator.
    for t in &all_extracted_transforms {
        if t.valid {
            if let Err(err) = evaluator.register(&t.name, &t.source) {
                diagnostics.push(ExtractionDiagnostic {
                    file: t.file.clone(),
                    component: format!("createTransform('{}')", t.name),
                    kind: "warn".to_string(),
                    message: format!("Failed to register transform in evaluator: {}", err),
                });
            }
        }
    }

    // Build a lookup: component_id → chain descriptor
    let mut chain_lookup: FxHashMap<String, (String, ChainDescriptor)> =
        FxHashMap::default();
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
                process_chain(chain, source, file_path, &proc_ctx, resolved_static_values.get(file_path))
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
                                let child_props: FxHashSet<&str> = child_base
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
                            merged_compounds.append(&mut component_css.compounds);
                            component_css.compounds = merged_compounds;
                        }

                        // Inherit compound configs for runtime replacement
                        if !parent_replacement.compound_configs.is_empty() {
                            let mut merged_configs = parent_replacement.compound_configs.clone();
                            merged_configs.append(&mut comp_replacement.compound_configs);
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
                let mut merged_active_props: FxHashSet<String> = FxHashSet::default();

                if let Some(parent_id) = parent_map.get(component_id) {
                    if let Some(parent_inherited) = inherited_active_props.get(parent_id) {
                        merged_active_props.extend(parent_inherited.iter().cloned());
                    }
                    if let Some((_, _, Some(parent_active), _)) = evaluated.get(parent_id) {
                        merged_active_props.extend(parent_active.iter().cloned());
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

    let chain_evaluation_ms = phase5a_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 5b: JSX scanning (global — single pass across all files)
    // ---------------------------------------------------------------------------
    let phase5b_start = Instant::now();

    // Build component usage configs for variant/state tracking (Arc 4 reconciliation).
    //
    // Only include variant props that have a `defaultVariant` specified.
    // Without a default, rendering a component without an explicit variant prop
    // emits `__default__` in the scanner, which would resolve to nothing and cause
    // the reconciler to eliminate all variant options (incorrect conservative behavior).
    // When a variant has no default, we omit it from tracking so the reconciler
    // falls back to the conservative "keep all" path.
    let mut component_usage_configs: FxHashMap<String, ComponentUsageConfig> = FxHashMap::default();

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, _, _)) = evaluated.get(component_id) {
            let binding = comp_replacement.binding.clone();

            let mut variants: FxHashMap<String, (FxHashSet<String>, Option<String>)> = FxHashMap::default();
            for vc in &comp_replacement.variant_config {
                // Only track variants that have an explicit default option.
                // Without a default, implicit usage (no prop passed) is ambiguous.
                if vc.default.is_some() {
                    let options: FxHashSet<String> = vc.options.iter().cloned().collect();
                    variants.insert(vc.prop.clone(), (options, vc.default.clone()));
                }
            }

            let states: FxHashSet<String> = comp_replacement.state_names.iter().cloned().collect();

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
    let mut global_component_props: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, active_props, custom_configs)) =
            evaluated.get(component_id)
        {
            let mut all_props: FxHashSet<String> = FxHashSet::default();

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
    let mut per_file_usage: FxHashMap<String, UsageScanResult> = FxHashMap::default();
    // Per-file custom prop scan results for cache storage
    let mut per_file_custom_static: FxHashMap<String, Vec<SystemPropUsage>> = FxHashMap::default();
    let mut per_file_custom_dynamic: FxHashMap<String, Vec<DynamicPropUsage>> = FxHashMap::default();

    // Build a custom-props-only map for custom prop scanning
    let mut global_custom_props: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, _, Some(custom_configs))) = evaluated.get(component_id) {
            if !custom_configs.is_empty() {
                global_custom_props
                    .entry(comp_replacement.binding.clone())
                    .or_default()
                    .extend(custom_configs.keys().cloned());
            }
        }
    }

    // Pre-scan compose() calls to build member expression resolution map.
    // This must happen before JSX scanning so that <Family.Slot /> usage
    // can resolve to the original slot binding for system prop detection.
    // For cache-hit files (HMR unchanged), reuse cached results since the
    // source is empty (cache optimization skips full source serialization).
    let mut compose_families: Vec<ComposeFamilyInfo> = Vec::new();
    let mut per_file_compose: FxHashMap<String, Vec<ComposeFamilyInfo>> = FxHashMap::default();
    let mut use_client_files: FxHashSet<String> = FxHashSet::default();
    for file in files {
        if cache_hit_files.contains(&file.path) {
            if let Some(cached_families) = cached_compose_by_file.get(&file.path) {
                if cached_families.iter().any(|f| f.context) {
                    use_client_files.insert(file.path.clone());
                }
                per_file_compose.insert(file.path.clone(), cached_families.clone());
                compose_families.extend(cached_families.iter().cloned());
                continue;
            }
        }
        let source_type = source_type_for_path(&file.path);
        let alloc = Allocator::default();
        count_parse();
        let parsed = Parser::new(&alloc, &file.source, source_type).parse();
        let file_families = scan_compose_calls(&parsed.program);
        if file_families.iter().any(|f| f.context) {
            use_client_files.insert(file.path.clone());
        }
        per_file_compose.insert(file.path.clone(), file_families.clone());
        compose_families.extend(file_families);
    }

    // Build member expression resolution map from compose families.
    // Maps "Family.Slot" → original binding name (e.g., "NavBar.Root" → "NavBarRoot").
    let mut member_expr_bindings: FxHashMap<String, String> = FxHashMap::default();
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
            { count_parse(); Parser::new(&scan_allocator, &file.source, source_type).parse() };

        // Build per-file augmented prop maps for import aliases.
        // When a file has `import { Button as Btn }`, we need the scanner
        // to match `<Btn>` against Button's active props.
        let mut has_aliases = false;
        if let Some(module_info) = file_modules.get(&file.path) {
            for imp in &module_info.imports {
                if imp.local_name != imp.imported_name
                    && (global_component_props.contains_key(&imp.imported_name)
                        || component_usage_configs.contains_key(&imp.imported_name)
                        || global_custom_props.contains_key(&imp.imported_name))
                {
                    has_aliases = true;
                    break;
                }
            }
        }

        let (file_component_props, file_usage_configs, file_custom_props);
        let (scan_component_props, scan_usage_configs, scan_custom_props): ScanMaps<'_>;

        if has_aliases {
            let module_info = file_modules.get(&file.path).unwrap();
            file_component_props = {
                let mut m = global_component_props.clone();
                for imp in &module_info.imports {
                    if imp.local_name != imp.imported_name {
                        if let Some(props) = global_component_props.get(&imp.imported_name) {
                            m.insert(imp.local_name.clone(), props.clone());
                        }
                    }
                }
                m
            };
            file_usage_configs = {
                let mut m = component_usage_configs.clone();
                for imp in &module_info.imports {
                    if imp.local_name != imp.imported_name {
                        if let Some(config) = component_usage_configs.get(&imp.imported_name) {
                            m.insert(imp.local_name.clone(), config.clone());
                        }
                    }
                }
                m
            };
            file_custom_props = {
                let mut m = global_custom_props.clone();
                for imp in &module_info.imports {
                    if imp.local_name != imp.imported_name {
                        if let Some(props) = global_custom_props.get(&imp.imported_name) {
                            m.insert(imp.local_name.clone(), props.clone());
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

        // Use extended scanner that tracks variant/state/component usage
        let usage_result = scan_jsx_usage(
            &parse_result.program,
            scan_component_props,
            scan_usage_configs,
            &member_expr_bindings,
        );

        // Collect system prop utility inputs from the usage result
        all_utility_inputs.extend(usage_result.system_prop_usages.iter().map(|u| UtilityInput {
            prop_name: u.prop_name.clone(),
            value: u.value.clone(),
        }));

        // Also scan for custom prop usages (scan_jsx is still used for custom props)
        if !scan_custom_props.is_empty() {
            let custom_scan = scan_jsx(&parse_result.program, scan_custom_props, &member_expr_bindings);
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
    let dynamic_prop_names: FxHashSet<String> = all_usage_results
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
    let mut global_custom_config: PropConfigMap = PropConfigMap::default();
    for component_id in &sorted_ids {
        if let Some((_, _, _, Some(custom_configs))) = evaluated.get(component_id) {
            global_custom_config.extend(custom_configs.clone());
        }
    }

    // Props with inline transforms (transform_fn_source) must use the dynamic path —
    // Rust can't evaluate the JS function, so static utility CSS would have untransformed values.
    // Filter from BOTH utility paths before CSS generation.
    let inline_transform_props: FxHashSet<String> = global_custom_config
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
    let mut custom_dynamic_by_binding: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
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
            if let Some((_, comp_replacement, _, Some(custom_configs))) = evaluated.get(component_id) {
                let binding = &comp_replacement.binding;
                for prop_name in custom_configs.keys() {
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

    // For each component with custom props, build per-component DynamicPropMeta
    // Key: component_id → HashMap<prop_name, DynamicPropMeta>
    let mut per_component_custom_dynamic: HashMap<String, HashMap<String, DynamicPropMeta>> = HashMap::new();
    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, _, Some(custom_configs))) = evaluated.get(component_id) {
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
                        if let Some(prop_config) = custom_configs.get(prop_name) {
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

    let jsx_scanning_ms = phase5b_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 5c: Populate system_prop_names on each replacement.
    // system_props moved to shared map (UniverseManifest.system_prop_map).
    // ---------------------------------------------------------------------------
    let phase5c_start = Instant::now();

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

    let system_prop_aggregation_ms = phase5c_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 5d: Build usage ledger from all scan results.
    // ---------------------------------------------------------------------------
    let phase5d_start = Instant::now();

    let variant_configs_for_ledger: VariantConfigMap =
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

    let usage_ledger_ms = phase5d_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 5e: Build reconciled component list (topo order) and reconcile.
    // In dev_mode: skip reconciliation — pass all components without pruning.
    // ---------------------------------------------------------------------------
    let phase5e_start = Instant::now();

    // Build the mutable Vec<(component_id, ComponentCss)> in topological order.
    let mut reconciled_components: Vec<(String, ComponentCss)> = sorted_ids
        .iter()
        .filter_map(|component_id| {
            evaluated.get(component_id).map(|(component_css, _, _, _)| {
                (component_id.clone(), component_css.clone())
            })
        })
        .collect();

    // Collect the bindings of components that serve as parents in the extension graph.
    let parent_bindings: FxHashSet<String> = parent_map.values()
        .filter_map(|parent_id| parent_id.rfind("::").map(|pos| parent_id[pos + 2..].to_string()))
        .collect();

    // Dev mode retains all components (HMR ergonomics) BUT populates
    // `eliminated_details` with prospective entries so `extraction-diagnostics`
    // surfaces JSX-scanner blind spots at authoring time — closes the silent
    // dev/build divergence described in `css-reconciler` spec.
    let reconciliation_report = if dev_mode {
        let prospective = identify_prospective_eliminations(
            &reconciled_components,
            &usage_ledger,
            &parent_bindings,
        );
        let report = ReconciliationReport {
            components_total: reconciled_components.len(),
            components_extracted: reconciled_components.len(),
            eliminated_details: prospective,
            ..Default::default()
        };
        serde_json::to_value(&report).unwrap_or(serde_json::json!({}))
    } else {
        let report = reconcile(&mut reconciled_components, &usage_ledger, &parent_bindings);
        serde_json::to_value(&report).unwrap_or(serde_json::json!({}))
    };

    let reconciliation_ms = phase5e_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 6: Generate replacement strings.
    // ---------------------------------------------------------------------------
    let phase6_start = Instant::now();

    let mut replacement_by_id: FxHashMap<String, String> = FxHashMap::default();

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

    let (mut sheets, css_fragments) = generate_css_sheets_ordered(&component_css_list, &breakpoints, &reconciled_order, class_prefix);

    // Phase 6c: Generate composed variant CSS for compose() families.
    // Build binding → class_name map from evaluated components.
    let mut composed_variant_css = String::new();
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
            composed_variant_css = generate_composed_variant_css(&family_refs, &component_css_list, &breakpoints);
        }
    }

    // Always wrap variants in sublayer structure: standalone < composed.
    // Sublayers are unconditional so the cascade topology is visible in devtools
    // regardless of whether compose families exist. Empty sublayers are harmless.
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

    // Resolve global style blocks (if provided) through theme_resolver.
    let global_css_raw = if let Some(blocks) = global_style_blocks {
        resolve_all_global_blocks(blocks, &resolve_ctx)
    } else {
        String::new()
    };

    // Resolve keyframes blocks (top-level keyframes() factory exports).
    let keyframes_css_raw = if let Some(blocks) = keyframes_blocks {
        resolve_all_keyframes_blocks(blocks, &resolve_ctx)
    } else {
        String::new()
    };

    // Merge global + keyframes CSS inside the @layer global wrapper.
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

    // Concatenated CSS for backward compatibility.
    // Global CSS is excluded — it flows through sheets.global and is assembled
    // by the plugin via assembleStylesheet() to avoid double-emission.
    let mut css = sheets.declaration.clone();
    css.push('\n');
    for sheet in [&sheets.base, &sheets.variants, &sheets.compounds, &sheets.states, &sheets.system, &sheets.custom] {
        if !sheet.is_empty() {
            css.push_str(sheet);
            css.push('\n');
        }
    }

    let css_generation_ms = phase6_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 7: Build manifest.
    // ---------------------------------------------------------------------------
    let phase7_start = Instant::now();

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
    // Build compose replacement descriptors BEFORE cache storage drains per_file_compose
    // ---------------------------------------------------------------------------

    let compose_replacements: Vec<ComposeReplacementDescriptor> = compose_families
        .iter()
        .filter_map(|family| {
            // Find the file that contains this compose call by matching the root binding
            let file_path = per_file_compose.iter()
                .find(|(_, families)| families.iter().any(|f| f.span == family.span))
                .map(|(path, _)| path.clone())?;
            Some(ComposeReplacementDescriptor {
                file_path,
                slots: family.slots.clone(),
                name: family.name.clone(),
                context: family.context,
                shared_keys: family.shared_keys.clone(),
            })
        })
        .collect();

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
                    let compose_families_cached = cached_compose_by_file.remove(&file.path).unwrap_or_default();
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
                        compose_families: compose_families_cached,
                        extracted_transforms: transforms_by_file.remove(&file.path).unwrap_or_default(),
                        static_values: static_values_by_file.get(&file.path).cloned().unwrap_or_default(),
                        static_exports: static_exports_by_file.get(&file.path).cloned().unwrap_or_default(),
                    });
                } else {
                    // Cache miss: store fresh results
                    let jsx_usage = per_file_usage.remove(&file.path).unwrap_or_default();
                    let custom_prop_static = per_file_custom_static.remove(&file.path).unwrap_or_default();
                    let custom_prop_dynamic = per_file_custom_dynamic.remove(&file.path).unwrap_or_default();
                    let compose_families_fresh = per_file_compose.remove(&file.path).unwrap_or_default();
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
                        compose_families: compose_families_fresh,
                        extracted_transforms: transforms_by_file.remove(&file.path).unwrap_or_default(),
                        static_values: static_values_by_file.remove(&file.path).unwrap_or_default(),
                        static_exports: static_exports_by_file.remove(&file.path).unwrap_or_default(),
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

    // Emit diagnostics for invalid transforms (valid ones already registered in evaluator).
    for t in &all_extracted_transforms {
        if !t.valid {
            for diag in &t.diagnostics {
                diagnostics.push(ExtractionDiagnostic {
                    file: t.file.clone(),
                    component: format!("createTransform('{}')", t.name),
                    kind: "bail".to_string(),
                    message: diag.clone(),
                });
            }
        }
    }

    let manifest_serialization_ms = phase7_start.elapsed().as_millis() as u64;

    let timing = PipelineTiming {
        parse_count: ANALYZE_PARSE_COUNT.load(Ordering::Relaxed),
        parse_and_walk: parse_and_walk_ms,
        import_resolution: import_resolution_ms,
        extension_provenance: extension_provenance_ms,
        topological_sort: topological_sort_ms,
        chain_evaluation: chain_evaluation_ms,
        jsx_scanning: jsx_scanning_ms,
        system_prop_aggregation: system_prop_aggregation_ms,
        usage_ledger: usage_ledger_ms,
        reconciliation: reconciliation_ms,
        css_generation: css_generation_ms,
        manifest_serialization: manifest_serialization_ms,
        file_count,
        cache_hits,
        total_ms: total_start.elapsed().as_millis() as u64,
    };

    // Build per-component fragment map from the CssFragmentStore
    let component_fragments = css_fragments.to_per_component_map();

    // Build reverse provenance: parent_id → [child_ids that extend it]
    let mut reverse_provenance: HashMap<String, Vec<String>> = HashMap::new();
    for (child_id, ancestors) in &provenance_map {
        // Only add direct parent (first in ancestors list)
        if let Some(parent_id) = ancestors.first() {
            reverse_provenance
                .entry(parent_id.clone())
                .or_default()
                .push(child_id.clone());
        }
    }

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
        use_client_files: use_client_files.into_iter().collect(),
        compose_replacements,
        global_css: global_css_raw,
        component_fragments,
        reverse_provenance,
        timing,
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
// Helper: probe a candidate path against the set of known files
// ---------------------------------------------------------------------------

/// Probe a candidate path against the known file set, trying common extensions.
///
/// Tries: bare match, `.ts`, `.tsx`, `.js`, `.jsx`, and `/index.*` variants.
/// The candidate should already be normalized (no `..` segments).
pub fn probe_known_files(
    candidate: &str,
    known_files: &FxHashSet<String>,
) -> Option<String> {
    const EXTENSIONS: &[&str] = &[".ts", ".tsx", ".js", ".jsx"];

    // 1. Try direct match (already has extension)
    if known_files.contains(candidate) {
        return Some(candidate.to_string());
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

// ---------------------------------------------------------------------------
// Helper: resolve a relative import path against the set of known files
// ---------------------------------------------------------------------------

/// Resolve a relative import (`"./Button"`, `"../components/Button"`) from
/// `from_file` against the set of known project files.
///
/// Joins the import source relative to the importing file's directory,
/// normalizes the path, then delegates to `probe_known_files`.
pub fn resolve_relative_path(
    from_file: &str,
    import_source: &str,
    known_files: &FxHashSet<String>,
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

    probe_known_files(&candidate, known_files)
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import_resolver::{ExportInfo, ImportInfo, ResolvedBinding};
    use serde_json::json;

    #[test]
    fn resolves_project_static_values_across_phase_two() {
        let mut file_modules = FxHashMap::default();
        file_modules.insert(
            "tokens.ts".to_string(),
            FileModuleInfo {
                imports: Vec::new(),
                exports: vec![ExportInfo {
                    exported_name: "GAP".to_string(),
                    local_name: Some("GAP".to_string()),
                    source: None,
                    is_default: false,
                }],
            },
        );
        file_modules.insert(
            "motion.ts".to_string(),
            FileModuleInfo {
                imports: Vec::new(),
                exports: vec![ExportInfo {
                    exported_name: "motion".to_string(),
                    local_name: Some("motion".to_string()),
                    source: None,
                    is_default: false,
                }],
            },
        );
        file_modules.insert(
            "component.tsx".to_string(),
            FileModuleInfo {
                imports: vec![
                    ImportInfo {
                        local_name: "spacing".to_string(),
                        imported_name: "GAP".to_string(),
                        source: "./tokens".to_string(),
                        is_default: false,
                    },
                    ImportInfo {
                        local_name: "animation".to_string(),
                        imported_name: "motion".to_string(),
                        source: "./motion".to_string(),
                        is_default: false,
                    },
                ],
                exports: Vec::new(),
            },
        );

        let mut binding_map = FxHashMap::default();
        binding_map.insert(
            ("component.tsx".to_string(), "spacing".to_string()),
            ResolvedBinding {
                file: "tokens.ts".to_string(),
                export_name: "GAP".to_string(),
            },
        );
        binding_map.insert(
            ("component.tsx".to_string(), "animation".to_string()),
            ResolvedBinding {
                file: "motion.ts".to_string(),
                export_name: "motion".to_string(),
            },
        );

        let mut static_values_by_file = FxHashMap::default();
        static_values_by_file.insert(
            "component.tsx".to_string(),
            FxHashMap::from_iter([("LOCAL".to_string(), json!("kept"))]),
        );

        let mut static_exports_by_file = FxHashMap::default();
        static_exports_by_file.insert(
            "tokens.ts".to_string(),
            FxHashMap::from_iter([("GAP".to_string(), json!(8))]),
        );

        let keyframes_blocks = json!({
            "motion": {
                "ember": {
                    "name": "animus-kf-ember",
                    "frames": { "0%": { "opacity": 0 } }
                }
            }
        });

        let resolved = resolve_project_static_values(
            &file_modules,
            &binding_map,
            &static_values_by_file,
            &static_exports_by_file,
            Some(&keyframes_blocks),
        );

        assert_eq!(resolved["component.tsx"]["LOCAL"], json!("kept"));
        assert_eq!(resolved["component.tsx"]["spacing"], json!(8));
        assert_eq!(
            resolved["component.tsx"]["animation"]["ember"],
            json!("animus-kf-ember")
        );
        assert_eq!(
            resolved["motion.ts"]["motion"]["ember"],
            json!("animus-kf-ember")
        );
    }

    // -- expand_alias tests --

    fn make_aliases() -> Vec<AliasEntry> {
        vec![
            // Longest prefix first (sorted by caller)
            AliasEntry {
                pattern: "@admin/components/".to_string(),
                replacement: "src/ui/components/".to_string(),
                alias_type: AliasType::Prefix,
            },
            AliasEntry {
                pattern: "@admin/".to_string(),
                replacement: "src/".to_string(),
                alias_type: AliasType::Prefix,
            },
            AliasEntry {
                pattern: "@config".to_string(),
                replacement: "src/config.ts".to_string(),
                alias_type: AliasType::Exact,
            },
        ]
    }

    #[test]
    fn prefix_alias_expands() {
        let aliases = make_aliases();
        assert_eq!(
            expand_alias("@admin/utils/format", &aliases),
            Some("src/utils/format".to_string())
        );
    }

    #[test]
    fn longest_prefix_wins() {
        let aliases = make_aliases();
        // @admin/components/ is longer than @admin/, so it should match first
        assert_eq!(
            expand_alias("@admin/components/Button", &aliases),
            Some("src/ui/components/Button".to_string())
        );
    }

    #[test]
    fn exact_alias_resolves() {
        let aliases = make_aliases();
        assert_eq!(
            expand_alias("@config", &aliases),
            Some("src/config.ts".to_string())
        );
    }

    #[test]
    fn exact_alias_no_partial_match() {
        let aliases = make_aliases();
        // @config/foo should NOT match the exact alias @config
        assert_eq!(expand_alias("@config/foo", &aliases), None);
    }

    #[test]
    fn alias_miss_returns_none() {
        let aliases = make_aliases();
        assert_eq!(expand_alias("@tanstack/react-query", &aliases), None);
    }

    #[test]
    fn empty_aliases_returns_none() {
        assert_eq!(expand_alias("@admin/Button", &[]), None);
    }

    // -- probe_known_files tests --

    #[test]
    fn probe_finds_tsx_extension() {
        let mut known = FxHashSet::default();
        known.insert("src/components/Button.tsx".to_string());
        assert_eq!(
            probe_known_files("src/components/Button", &known),
            Some("src/components/Button.tsx".to_string())
        );
    }

    #[test]
    fn probe_finds_index_file() {
        let mut known = FxHashSet::default();
        known.insert("src/components/index.ts".to_string());
        assert_eq!(
            probe_known_files("src/components", &known),
            Some("src/components/index.ts".to_string())
        );
    }

    #[test]
    fn probe_returns_none_when_not_found() {
        let known = FxHashSet::default();
        assert_eq!(probe_known_files("src/missing", &known), None);
    }

    #[test]
    fn alias_expand_then_probe_integration() {
        let aliases = vec![AliasEntry {
            pattern: "@admin/".to_string(),
            replacement: "src/".to_string(),
            alias_type: AliasType::Prefix,
        }];
        let mut known = FxHashSet::default();
        known.insert("src/components/Button.tsx".to_string());

        let expanded = expand_alias("@admin/components/Button", &aliases).unwrap();
        assert_eq!(expanded, "src/components/Button");
        assert_eq!(
            probe_known_files(&expanded, &known),
            Some("src/components/Button.tsx".to_string())
        );
    }
}
