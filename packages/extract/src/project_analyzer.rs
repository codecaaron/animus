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
use crate::transform_evaluator::TransformEvaluator;
use crate::transform_extractor::{extract_transforms, ExtractedTransform};
use crate::css_generator::{
    build_variable_slot_entries, generate_composed_variant_css, generate_css_sheets_ordered,
    generate_custom_prop_css, generate_utility_css, layer_name, BreakpointMap, ComponentCss,
    ComposeFamilyRef, CssFragmentStore, CssSheets, PerComponentSheets, UtilityInput, UtilityOutput,
    VariantCss,
};
use crate::theme_resolver::ResolvedStyles;
use crate::import_resolver::{
    parse_module_info, resolve_bindings, FileModuleInfo, ResolvedBinding,
};
use crate::jsx_scanner::{scan_compose_calls, scan_jsx, scan_jsx_usage, ComponentUsageConfig, ComposeFamilyInfo, DynamicPropUsage, SystemPropUsage, UsageScanResult};
use crate::reconciler::{build_ledger, identify_prospective_eliminations, reconcile, ReconciliationReport, UsageLedger, VariantConfigMap};
use crate::theme_resolver::{resolve_all_global_blocks, resolve_all_keyframes_blocks, ContextualVarsMap, FlatTheme, PropConfigMap, ResolveContext, SelectorAliasesMap, VariableMap};
use crate::transform_emitter::{
    generate_replacement, ComponentReplacement, EmitterConfig, VariantPropConfig,
};
use crate::style_evaluator::{collect_static_values, collect_static_exports};
use crate::{extract_breakpoints, process_chain, ProcessingContext};

type ComponentPropSetMap = FxHashMap<String, FxHashSet<String>>;
type ComponentUsageConfigMap = FxHashMap<String, ComponentUsageConfig>;
type ChainResult = (
    ComponentCss,
    ComponentReplacement,
    Option<FxHashSet<String>>,
    Option<PropConfigMap>,
);
type EvaluatedComponents = FxHashMap<String, ChainResult>;
type ChainLookup = FxHashMap<String, (String, ChainDescriptor)>;
type OwnedScanMaps = (
    ComponentPropSetMap,
    ComponentUsageConfigMap,
    ComponentPropSetMap,
);
type ScanMaps<'a> = (
    &'a ComponentPropSetMap,
    &'a ComponentUsageConfigMap,
    &'a ComponentPropSetMap,
);
type ExtensionProvenance = (FxHashMap<String, String>, FxHashSet<String>);

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

struct ParsedProjectFiles {
    all_chains: FxHashMap<String, Vec<ChainDescriptor>>,
    file_modules: FxHashMap<String, FileModuleInfo>,
    cache_hit_files: FxHashSet<String>,
    cached_evals_by_file: FxHashMap<String, Vec<CachedEvalEntry>>,
    cached_jsx_by_file: FxHashMap<String, UsageScanResult>,
    cached_custom_static_by_file: FxHashMap<String, Vec<SystemPropUsage>>,
    cached_custom_dynamic_by_file: FxHashMap<String, Vec<DynamicPropUsage>>,
    cached_compose_by_file: FxHashMap<String, Vec<ComposeFamilyInfo>>,
    transforms_by_file: FxHashMap<String, Vec<ExtractedTransform>>,
    all_extracted_transforms: Vec<ExtractedTransform>,
    static_values_by_file: FxHashMap<String, FxHashMap<String, Value>>,
    static_exports_by_file: FxHashMap<String, FxHashMap<String, Value>>,
}

struct ProjectImportInput<'a> {
    file_path_set: &'a FxHashSet<String>,
    path_aliases: &'a [AliasEntry],
    resolve_package_path: &'a dyn Fn(&str) -> Option<String>,
    file_modules: &'a FxHashMap<String, FileModuleInfo>,
    static_values_by_file: &'a FxHashMap<String, FxHashMap<String, Value>>,
    static_exports_by_file: &'a FxHashMap<String, FxHashMap<String, Value>>,
    keyframes_blocks: Option<&'a Value>,
}

struct ResolvedProjectImports {
    binding_map: FxHashMap<(String, String), ResolvedBinding>,
    static_values: FxHashMap<String, FxHashMap<String, Value>>,
}

struct ChainEvaluationInput<'a, 'ctx> {
    sorted_ids: &'a [String],
    all_chains: &'a FxHashMap<String, Vec<ChainDescriptor>>,
    files: &'a [FileEntry],
    extracted_transforms: &'a [ExtractedTransform],
    cache_hit_files: &'a FxHashSet<String>,
    cached_evals_by_file: &'a FxHashMap<String, Vec<CachedEvalEntry>>,
    parent_map: &'a FxHashMap<String, String>,
    proc_ctx: &'a ProcessingContext<'ctx>,
    resolved_static_values: &'a FxHashMap<String, FxHashMap<String, Value>>,
    evaluator: &'a TransformEvaluator,
}

struct EvaluatedProjectChains {
    evaluated: EvaluatedComponents,
    chain_lookup: ChainLookup,
    pre_merge_evals: FxHashMap<String, Vec<CachedEvalEntry>>,
    diagnostics: Vec<ExtractionDiagnostic>,
}

struct ProjectJsxScanInput<'a> {
    files: &'a [FileEntry],
    sorted_ids: &'a [String],
    evaluated: &'a EvaluatedComponents,
    file_modules: &'a FxHashMap<String, FileModuleInfo>,
    cache_hit_files: &'a FxHashSet<String>,
    cached_jsx_by_file: &'a FxHashMap<String, UsageScanResult>,
    cached_custom_static_by_file: &'a FxHashMap<String, Vec<SystemPropUsage>>,
    cached_custom_dynamic_by_file: &'a FxHashMap<String, Vec<DynamicPropUsage>>,
    cached_compose_by_file: &'a FxHashMap<String, Vec<ComposeFamilyInfo>>,
    dev_mode: bool,
}

struct ProjectJsxScan {
    component_usage_configs: ComponentUsageConfigMap,
    utility_inputs: Vec<UtilityInput>,
    custom_inputs: Vec<UtilityInput>,
    custom_dynamic_usages: Vec<DynamicPropUsage>,
    usage_results: Vec<UsageScanResult>,
    per_file_usage: FxHashMap<String, UsageScanResult>,
    per_file_custom_static: FxHashMap<String, Vec<SystemPropUsage>>,
    per_file_custom_dynamic: FxHashMap<String, Vec<DynamicPropUsage>>,
    compose_families: Vec<ComposeFamilyInfo>,
    per_file_compose: FxHashMap<String, Vec<ComposeFamilyInfo>>,
    use_client_files: FxHashSet<String>,
}

struct ProjectUtilityInput<'a, 'ctx> {
    sorted_ids: &'a [String],
    evaluated: &'a EvaluatedComponents,
    utility_inputs: Vec<UtilityInput>,
    custom_inputs: Vec<UtilityInput>,
    custom_dynamic_usages: &'a [DynamicPropUsage],
    usage_results: &'a [UsageScanResult],
    resolve_ctx: &'a ResolveContext<'ctx>,
    breakpoints: &'a BreakpointMap,
    class_prefix: &'a str,
}

struct ProjectUtilityOutput {
    dynamic_prop_names: FxHashSet<String>,
    dynamic_props: HashMap<String, DynamicPropMeta>,
    per_component_custom_dynamic: HashMap<String, HashMap<String, DynamicPropMeta>>,
    utility_output: Option<UtilityOutput>,
    custom_output: Option<UtilityOutput>,
}

struct ProjectCssInput<'a, 'ctx> {
    sorted_ids: &'a [String],
    evaluated: &'a mut EvaluatedComponents,
    dynamic_prop_names: &'a FxHashSet<String>,
    group_registry: &'a HashMap<String, Vec<String>>,
    reconciled_components: Vec<(String, ComponentCss)>,
    compose_families: &'a [ComposeFamilyInfo],
    breakpoints: &'a BreakpointMap,
    utility_output: Option<&'a UtilityOutput>,
    custom_output: Option<&'a UtilityOutput>,
    global_style_blocks: Option<&'a Value>,
    keyframes_blocks: Option<&'a Value>,
    resolve_ctx: &'a ResolveContext<'ctx>,
    class_prefix: &'a str,
}

struct GeneratedProjectCss {
    replacement_by_id: FxHashMap<String, String>,
    sheets: CssSheets,
    fragments: CssFragmentStore,
    css: String,
    global_css: String,
}

struct ProjectManifestInput<'a> {
    sorted_ids: &'a [String],
    chain_lookup: &'a ChainLookup,
    evaluated: &'a EvaluatedComponents,
    replacement_by_id: &'a FxHashMap<String, String>,
    parent_map: &'a FxHashMap<String, String>,
    utility_output: Option<&'a UtilityOutput>,
    usage_ledger: &'a UsageLedger,
    compose_families: &'a [ComposeFamilyInfo],
    per_file_compose: &'a FxHashMap<String, Vec<ComposeFamilyInfo>>,
}

struct ProjectManifestData {
    components: HashMap<String, ComponentDescriptor>,
    files: HashMap<String, Vec<String>>,
    provenance: HashMap<String, Vec<String>>,
    utilities: HashMap<String, String>,
    usage: Value,
    compose_replacements: Vec<ComposeReplacementDescriptor>,
}

struct ProjectCacheState {
    cached_evals_by_file: FxHashMap<String, Vec<CachedEvalEntry>>,
    cached_jsx_by_file: FxHashMap<String, UsageScanResult>,
    cached_custom_static_by_file: FxHashMap<String, Vec<SystemPropUsage>>,
    cached_custom_dynamic_by_file: FxHashMap<String, Vec<DynamicPropUsage>>,
    cached_compose_by_file: FxHashMap<String, Vec<ComposeFamilyInfo>>,
    pre_merge_evals: FxHashMap<String, Vec<CachedEvalEntry>>,
    per_file_usage: FxHashMap<String, UsageScanResult>,
    per_file_custom_static: FxHashMap<String, Vec<SystemPropUsage>>,
    per_file_custom_dynamic: FxHashMap<String, Vec<DynamicPropUsage>>,
    per_file_compose: FxHashMap<String, Vec<ComposeFamilyInfo>>,
    transforms_by_file: FxHashMap<String, Vec<ExtractedTransform>>,
    static_values_by_file: FxHashMap<String, FxHashMap<String, Value>>,
    static_exports_by_file: FxHashMap<String, FxHashMap<String, Value>>,
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

fn resolve_project_imports(input: ProjectImportInput<'_>) -> ResolvedProjectImports {
    let ProjectImportInput {
        file_path_set,
        path_aliases,
        resolve_package_path,
        file_modules,
        static_values_by_file,
        static_exports_by_file,
        keyframes_blocks,
    } = input;
    let known_files = file_path_set.clone();
    let resolve_path = |current_file: &str, source: &str| {
        if source.starts_with('.') {
            resolve_relative_path(current_file, source, &known_files)
        } else if let Some(expanded) = expand_alias(source, path_aliases) {
            probe_known_files(&expanded, &known_files)
        } else {
            resolve_package_path(source)
        }
    };
    let binding_map = resolve_bindings(file_modules, &resolve_path);
    let static_values = resolve_project_static_values(
        file_modules,
        &binding_map,
        static_values_by_file,
        static_exports_by_file,
        keyframes_blocks,
    );

    ResolvedProjectImports {
        binding_map,
        static_values,
    }
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

pub(crate) struct AnalyzeInput<'a> {
    pub(crate) files: &'a [FileEntry],
    pub(crate) theme: &'a FlatTheme,
    pub(crate) variable_map: &'a VariableMap,
    pub(crate) contextual_vars: &'a ContextualVarsMap,
    pub(crate) config: &'a PropConfigMap,
    pub(crate) group_registry: &'a HashMap<String, Vec<String>>,
    pub(crate) resolve_package_path: &'a dyn Fn(&str) -> Option<String>,
    pub(crate) dev_mode: bool,
    pub(crate) class_prefix: &'a str,
    pub(crate) emitter_config: EmitterConfig,
    pub(crate) selector_aliases: &'a SelectorAliasesMap,
    pub(crate) global_style_blocks: Option<&'a Value>,
    pub(crate) path_aliases: &'a [AliasEntry],
    pub(crate) keyframes_blocks: Option<&'a Value>,
}

fn parse_project_files(files: &[FileEntry]) -> ParsedProjectFiles {
    let mut all_chains = FxHashMap::default();
    let mut file_modules = FxHashMap::default();
    let mut cache_hit_files = FxHashSet::default();
    let mut cached_evals_by_file = FxHashMap::default();
    let mut cached_jsx_by_file = FxHashMap::default();
    let mut cached_custom_static_by_file = FxHashMap::default();
    let mut cached_custom_dynamic_by_file = FxHashMap::default();
    let mut cached_compose_by_file = FxHashMap::default();
    let mut transforms_by_file = FxHashMap::default();
    let mut all_extracted_transforms = Vec::new();
    let mut static_values_by_file = FxHashMap::default();
    let mut static_exports_by_file = FxHashMap::default();
    let mut cache_miss_indices = Vec::new();

    {
        let mut cache_guard = FILE_CACHE.lock().unwrap_or_else(|error| error.into_inner());

        for (index, file) in files.iter().enumerate() {
            if let Some(file_hash) = &file.hash {
                let cache_hit = cache_guard
                    .get(&file.path)
                    .is_some_and(|cached| cached.hash == *file_hash);
                if cache_hit {
                    let cached = cache_guard
                        .remove(&file.path)
                        .expect("cache hit disappeared while the cache lock was held");
                    all_chains.insert(file.path.clone(), cached.chains);
                    file_modules.insert(file.path.clone(), cached.module_info);
                    cached_evals_by_file.insert(file.path.clone(), cached.eval_results);
                    cached_jsx_by_file.insert(file.path.clone(), cached.jsx_usage);
                    cached_custom_static_by_file
                        .insert(file.path.clone(), cached.custom_prop_static);
                    cached_custom_dynamic_by_file
                        .insert(file.path.clone(), cached.custom_prop_dynamic);
                    cached_compose_by_file.insert(file.path.clone(), cached.compose_families);
                    all_extracted_transforms.extend(cached.extracted_transforms);
                    static_values_by_file.insert(file.path.clone(), cached.static_values);
                    static_exports_by_file.insert(file.path.clone(), cached.static_exports);
                    cache_hit_files.insert(file.path.clone());
                    continue;
                }
            }
            cache_miss_indices.push(index);
        }
    }

    use rayon::prelude::*;

    let parse_results = cache_miss_indices
        .par_iter()
        .map(|&index| {
            let file = &files[index];
            let source_type = source_type_for_path(&file.path);
            let allocator = Allocator::default();
            count_parse();
            let parse_result = Parser::new(&allocator, &file.source, source_type).parse();

            let chains = walk_chains_from_program(&parse_result.program, &file.source);
            let module_info = parse_module_info(&parse_result.program);
            let transform_bindings = module_info
                .imports
                .iter()
                .filter(|import| {
                    import.imported_name == "createTransform"
                        && import.local_name != "createTransform"
                })
                .map(|import| import.local_name.clone())
                .collect();
            let transforms = extract_transforms(
                &parse_result.program,
                &file.source,
                &file.path,
                &transform_bindings,
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
        .collect::<Vec<_>>();

    for result in parse_results {
        all_chains.insert(result.path.clone(), result.chains);
        file_modules.insert(result.path.clone(), result.module_info);
        transforms_by_file.insert(result.path.clone(), result.transforms.clone());
        all_extracted_transforms.extend(result.transforms);
        static_values_by_file.insert(result.path.clone(), result.static_values);
        static_exports_by_file.insert(result.path, result.static_exports);
    }

    ParsedProjectFiles {
        all_chains,
        file_modules,
        cache_hit_files,
        cached_evals_by_file,
        cached_jsx_by_file,
        cached_custom_static_by_file,
        cached_custom_dynamic_by_file,
        cached_compose_by_file,
        transforms_by_file,
        all_extracted_transforms,
        static_values_by_file,
        static_exports_by_file,
    }
}

fn resolve_extension_provenance(
    all_chains: &FxHashMap<String, Vec<ChainDescriptor>>,
    binding_map: &FxHashMap<(String, String), ResolvedBinding>,
) -> ExtensionProvenance {
    let mut parent_map = FxHashMap::default();
    let mut unresolvable_extensions = FxHashSet::default();

    for (file_path, chains) in all_chains {
        for chain in chains {
            if !chain.extractable {
                continue;
            }

            let component_id = format!("{}::{}", file_path, chain.binding);
            let Some(extends_binding) = &chain.extends_from else {
                continue;
            };
            let key = (file_path.clone(), extends_binding.clone());
            if let Some(resolved) = binding_map.get(&key) {
                parent_map.insert(
                    component_id,
                    format!("{}::{}", resolved.file, resolved.export_name),
                );
                continue;
            }

            let same_file_parent = format!("{}::{}", file_path, extends_binding);
            let found_in_same_file = all_chains.get(file_path).is_some_and(|file_chains| {
                file_chains
                    .iter()
                    .any(|candidate| candidate.binding == *extends_binding && candidate.extractable)
            });
            if found_in_same_file {
                parent_map.insert(component_id, same_file_parent);
            } else {
                unresolvable_extensions.insert(component_id);
            }
        }
    }

    (parent_map, unresolvable_extensions)
}

fn sort_extractable_components(
    all_chains: &FxHashMap<String, Vec<ChainDescriptor>>,
    parent_map: &FxHashMap<String, String>,
    unresolvable_extensions: &FxHashSet<String>,
) -> Vec<String> {
    let mut component_ids = all_chains
        .iter()
        .flat_map(|(file_path, chains)| {
            chains.iter().filter_map(move |chain| {
                if !chain.extractable {
                    return None;
                }
                let component_id = format!("{}::{}", file_path, chain.binding);
                (!unresolvable_extensions.contains(&component_id)).then_some(component_id)
            })
        })
        .collect::<Vec<_>>();

    component_ids.sort();
    let nodes = component_ids
        .iter()
        .map(|component_id| ProvenanceNode {
            component_id: component_id.clone(),
            parent_id: parent_map.get(component_id).cloned(),
        })
        .collect::<Vec<_>>();

    match topological_sort(&nodes) {
        TopoResult::Sorted(order) => order,
        TopoResult::Cycle(cycle_ids) => {
            let cycle_set = cycle_ids.iter().collect::<FxHashSet<_>>();
            component_ids
                .into_iter()
                .filter(|component_id| !cycle_set.contains(component_id))
                .collect()
        }
    }
}

fn merge_parent_chain(
    parent_css: &ComponentCss,
    parent_replacement: &ComponentReplacement,
    component_css: &mut ComponentCss,
    component_replacement: &mut ComponentReplacement,
) {
    match (&parent_css.base, &component_css.base) {
        (Some(parent_base), Some(child_base)) => {
            let mut declarations = parent_base.declarations.clone();
            let child_properties = child_base
                .declarations
                .iter()
                .map(|declaration| declaration.property.as_str())
                .collect::<FxHashSet<_>>();
            declarations
                .retain(|declaration| !child_properties.contains(declaration.property.as_str()));
            declarations.extend(child_base.declarations.clone());

            let mut pseudo_selectors = parent_base.pseudo_selectors.clone();
            for (selector, child_declarations) in &child_base.pseudo_selectors {
                if let Some((_, declarations)) = pseudo_selectors
                    .iter_mut()
                    .find(|(parent_selector, _)| parent_selector == selector)
                {
                    *declarations = child_declarations.clone();
                } else {
                    pseudo_selectors.push((selector.clone(), child_declarations.clone()));
                }
            }

            let mut responsive = parent_base.responsive.clone();
            for (breakpoint, child_declarations) in &child_base.responsive {
                if let Some((_, declarations)) = responsive
                    .iter_mut()
                    .find(|(parent_breakpoint, _)| parent_breakpoint == breakpoint)
                {
                    *declarations = child_declarations.clone();
                } else {
                    responsive.push((breakpoint.clone(), child_declarations.clone()));
                }
            }

            component_css.base = Some(ResolvedStyles {
                declarations,
                pseudo_selectors,
                responsive,
                responsive_pseudos: parent_base.responsive_pseudos.clone(),
            });
        }
        (Some(parent_base), None) => component_css.base = Some(parent_base.clone()),
        _ => {}
    }

    for parent_variant in &parent_css.variants {
        if !component_css
            .variants
            .iter()
            .any(|variant| variant.prop == parent_variant.prop)
        {
            component_css.variants.push(VariantCss {
                prop: parent_variant.prop.clone(),
                options: parent_variant.options.clone(),
                default_option: parent_variant.default_option.clone(),
            });
        }
    }

    for (parent_name, parent_styles) in &parent_css.states {
        if !component_css
            .states
            .iter()
            .any(|(name, _)| name == parent_name)
        {
            component_css
                .states
                .push((parent_name.clone(), parent_styles.clone()));
        }
    }

    if !parent_css.compounds.is_empty() {
        let mut compounds = parent_css.compounds.clone();
        compounds.append(&mut component_css.compounds);
        component_css.compounds = compounds;
    }

    if !parent_replacement.compound_configs.is_empty() {
        let mut compound_configs = parent_replacement.compound_configs.clone();
        compound_configs.append(&mut component_replacement.compound_configs);
        component_replacement.compound_configs = compound_configs;
    }

    for parent_variant in &parent_replacement.variant_config {
        if !component_replacement
            .variant_config
            .iter()
            .any(|variant| variant.prop == parent_variant.prop)
        {
            component_replacement
                .variant_config
                .push(VariantPropConfig {
                    prop: parent_variant.prop.clone(),
                    options: parent_variant.options.clone(),
                    default: parent_variant.default.clone(),
                });
        }
    }
    for parent_state in &parent_replacement.state_names {
        if !component_replacement.state_names.contains(parent_state) {
            component_replacement.state_names.push(parent_state.clone());
        }
    }
}

fn merge_chain_active_props(
    component_id: &str,
    active_props: Option<FxHashSet<String>>,
    parent_map: &FxHashMap<String, String>,
    inherited_active_props: &mut FxHashMap<String, FxHashSet<String>>,
    evaluated: &EvaluatedComponents,
) -> Option<FxHashSet<String>> {
    let mut merged_active_props = FxHashSet::default();

    if let Some(parent_id) = parent_map.get(component_id) {
        if let Some(parent_inherited) = inherited_active_props.get(parent_id) {
            merged_active_props.extend(parent_inherited.iter().cloned());
        }
        if let Some((_, _, Some(parent_active), _)) = evaluated.get(parent_id) {
            merged_active_props.extend(parent_active.iter().cloned());
        }
    }

    if let Some(own_props) = &active_props {
        merged_active_props.extend(own_props.iter().cloned());
    }

    if merged_active_props.is_empty() {
        active_props
    } else {
        inherited_active_props.insert(component_id.to_string(), merged_active_props.clone());
        Some(merged_active_props)
    }
}

fn evaluate_project_chains(input: ChainEvaluationInput<'_, '_>) -> EvaluatedProjectChains {
    let ChainEvaluationInput {
        sorted_ids,
        all_chains,
        files,
        extracted_transforms,
        cache_hit_files,
        cached_evals_by_file,
        parent_map,
        proc_ctx,
        resolved_static_values,
        evaluator,
    } = input;
    let mut evaluated = EvaluatedComponents::default();
    let mut inherited_active_props = FxHashMap::default();
    let mut pre_merge_evals: FxHashMap<String, Vec<CachedEvalEntry>> = FxHashMap::default();
    let source_map = files
        .iter()
        .map(|file| (file.path.clone(), file.source.as_str()))
        .collect::<FxHashMap<_, _>>();
    let mut diagnostics = Vec::new();

    for transform in extracted_transforms {
        if transform.valid {
            if let Err(error) = evaluator.register(&transform.name, &transform.source) {
                diagnostics.push(ExtractionDiagnostic {
                    file: transform.file.clone(),
                    component: format!("createTransform('{}')", transform.name),
                    kind: "warn".to_string(),
                    message: format!("Failed to register transform in evaluator: {}", error),
                });
            }
        }
    }

    let mut chain_lookup = ChainLookup::default();
    for (file_path, chains) in all_chains {
        for chain in chains {
            if chain.extractable {
                chain_lookup.insert(
                    format!("{}::{}", file_path, chain.binding),
                    (file_path.clone(), chain.clone()),
                );
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

    for component_id in sorted_ids {
        let Some((file_path, chain)) = chain_lookup.get(component_id) else {
            continue;
        };
        let cached_eval = cache_hit_files
            .contains(file_path)
            .then(|| cached_evals_by_file.get(file_path))
            .flatten()
            .and_then(|entries| {
                entries
                    .iter()
                    .find(|entry| entry.component_id == *component_id)
            });
        let evaluation = if let Some(entry) = cached_eval {
            Ok((
                entry.component_css.clone(),
                entry.replacement.clone(),
                entry.active_props.clone(),
                entry.prop_config.clone(),
                Vec::new(),
            ))
        } else {
            let Some(source) = source_map.get(file_path) else {
                continue;
            };
            process_chain(
                chain,
                source,
                file_path,
                proc_ctx,
                resolved_static_values.get(file_path),
            )
        };

        let Ok((
            mut component_css,
            mut component_replacement,
            active_props,
            custom_configs,
            skip_warnings,
        )) = evaluation
        else {
            continue;
        };

        diagnostics.extend(
            skip_warnings
                .into_iter()
                .map(|message| ExtractionDiagnostic {
                    file: file_path.clone(),
                    component: chain.binding.clone(),
                    kind: "skip".to_string(),
                    message,
                }),
        );
        pre_merge_evals
            .entry(file_path.clone())
            .or_default()
            .push(CachedEvalEntry {
                component_id: component_id.clone(),
                component_css: component_css.clone(),
                replacement: component_replacement.clone(),
                active_props: active_props.clone(),
                prop_config: custom_configs.clone(),
            });

        if let Some(parent) = parent_map
            .get(component_id)
            .and_then(|parent_id| evaluated.get(parent_id))
        {
            merge_parent_chain(
                &parent.0,
                &parent.1,
                &mut component_css,
                &mut component_replacement,
            );
        }
        let active_props = merge_chain_active_props(
            component_id,
            active_props,
            parent_map,
            &mut inherited_active_props,
            &evaluated,
        );
        evaluated.insert(
            component_id.clone(),
            (
                component_css,
                component_replacement,
                active_props,
                custom_configs,
            ),
        );
    }

    EvaluatedProjectChains {
        evaluated,
        chain_lookup,
        pre_merge_evals,
        diagnostics,
    }
}

fn build_component_scan_maps(
    sorted_ids: &[String],
    evaluated: &EvaluatedComponents,
) -> OwnedScanMaps {
    let mut component_props = ComponentPropSetMap::default();
    let mut usage_configs = ComponentUsageConfigMap::default();
    let mut custom_props = ComponentPropSetMap::default();

    for component_id in sorted_ids {
        let Some((_, replacement, active_props, custom_configs)) = evaluated.get(component_id)
        else {
            continue;
        };

        // Without a default, an omitted JSX prop scans as `__default__`, which
        // matches no option. Omit that variant so reconciliation keeps all options.
        let variants = replacement
            .variant_config
            .iter()
            .filter_map(|config| {
                config.default.as_ref().map(|_| {
                    let options = config.options.iter().cloned().collect();
                    (config.prop.clone(), (options, config.default.clone()))
                })
            })
            .collect();
        let states = replacement.state_names.iter().cloned().collect();
        usage_configs.insert(
            replacement.binding.clone(),
            ComponentUsageConfig { variants, states },
        );

        let mut all_props = FxHashSet::default();
        if let Some(active_props) = active_props {
            all_props.extend(active_props.iter().cloned());
        }
        if let Some(custom_configs) = custom_configs {
            all_props.extend(custom_configs.keys().cloned());
            if !custom_configs.is_empty() {
                custom_props
                    .entry(replacement.binding.clone())
                    .or_default()
                    .extend(custom_configs.keys().cloned());
            }
        }
        if !all_props.is_empty() {
            component_props
                .entry(replacement.binding.clone())
                .or_default()
                .extend(all_props);
        }
    }

    (component_props, usage_configs, custom_props)
}

fn build_project_usage_ledger(
    usage_results: &[UsageScanResult],
    usage_configs: &ComponentUsageConfigMap,
    sorted_ids: &[String],
    evaluated: &EvaluatedComponents,
    compose_families: &[ComposeFamilyInfo],
) -> UsageLedger {
    let variant_configs: VariantConfigMap = usage_configs
        .iter()
        .map(|(binding, config)| (binding.clone(), config.variants.clone()))
        .collect();
    let mut ledger = build_ledger(usage_results, &variant_configs);

    // .asClass() chains produce class names outside JSX, so mark them rendered.
    for component_id in sorted_ids {
        if let Some((_, replacement, _, _)) = evaluated.get(component_id) {
            if replacement.is_class_resolver {
                ledger.rendered_components.insert(replacement.binding.clone());
            }
        }
    }

    // Compose slots are rendered indirectly. Shared child variants also receive
    // their options through composed CSS rather than direct JSX props.
    for family in compose_families {
        for (_, binding_name) in &family.slots {
            ledger.rendered_components.insert(binding_name.clone());
            if *binding_name == family.root_binding {
                continue;
            }
            for shared_key in &family.shared_keys {
                let Some(variant_config) = variant_configs
                    .get(binding_name)
                    .and_then(|config| config.get(shared_key))
                else {
                    continue;
                };
                ledger
                    .variant_usage
                    .entry(binding_name.clone())
                    .or_default()
                    .entry(shared_key.clone())
                    .or_default()
                    .extend(variant_config.0.iter().cloned());
            }
        }
    }

    ledger
}

fn reconcile_project_components(
    sorted_ids: &[String],
    evaluated: &EvaluatedComponents,
    parent_map: &FxHashMap<String, String>,
    usage_ledger: &UsageLedger,
    dev_mode: bool,
) -> (Vec<(String, ComponentCss)>, Value) {
    let mut components = sorted_ids
        .iter()
        .filter_map(|component_id| {
            evaluated
                .get(component_id)
                .map(|(css, _, _, _)| (component_id.clone(), css.clone()))
        })
        .collect::<Vec<_>>();
    let parent_bindings = parent_map
        .values()
        .filter_map(|parent_id| {
            parent_id
                .rfind("::")
                .map(|position| parent_id[position + 2..].to_string())
        })
        .collect::<FxHashSet<_>>();

    let report = if dev_mode {
        ReconciliationReport {
            components_total: components.len(),
            components_extracted: components.len(),
            eliminated_details: identify_prospective_eliminations(
                &components,
                usage_ledger,
                &parent_bindings,
            ),
            ..Default::default()
        }
    } else {
        reconcile(&mut components, usage_ledger, &parent_bindings)
    };

    (
        components,
        serde_json::to_value(&report).unwrap_or(serde_json::json!({})),
    )
}

fn scan_project_jsx(input: ProjectJsxScanInput<'_>) -> ProjectJsxScan {
    let ProjectJsxScanInput {
        files,
        sorted_ids,
        evaluated,
        file_modules,
        cache_hit_files,
        cached_jsx_by_file,
        cached_custom_static_by_file,
        cached_custom_dynamic_by_file,
        cached_compose_by_file,
        dev_mode,
    } = input;

    // Build component scan policy once: active/custom props plus usage configs.
    // Components with no tracked variants or states stay present in usage_configs
    // so the scanner still records them as rendered.
    let (global_component_props, component_usage_configs, global_custom_props) =
        build_component_scan_maps(sorted_ids, evaluated);

    let mut utility_inputs = Vec::new();
    let mut custom_inputs = Vec::new();
    let mut custom_dynamic_usages = Vec::new();
    let mut usage_results = Vec::new();
    let mut per_file_usage = FxHashMap::default();
    let mut per_file_custom_static = FxHashMap::default();
    let mut per_file_custom_dynamic = FxHashMap::default();

    // Compose scanning must precede JSX scanning so <Family.Slot /> resolves to
    // the original slot binding. Cache hits reuse the prior compose result because
    // HMR sends empty source for unchanged files.
    let mut compose_families = Vec::new();
    let mut per_file_compose = FxHashMap::default();
    let mut use_client_files = FxHashSet::default();
    for file in files {
        if cache_hit_files.contains(&file.path) {
            if let Some(cached_families) = cached_compose_by_file.get(&file.path) {
                if cached_families.iter().any(|family| family.context) {
                    use_client_files.insert(file.path.clone());
                }
                per_file_compose.insert(file.path.clone(), cached_families.clone());
                compose_families.extend(cached_families.iter().cloned());
                continue;
            }
        }

        let allocator = Allocator::default();
        count_parse();
        let parsed =
            Parser::new(&allocator, &file.source, source_type_for_path(&file.path)).parse();
        let file_families = scan_compose_calls(&parsed.program);
        if file_families.iter().any(|family| family.context) {
            use_client_files.insert(file.path.clone());
        }
        per_file_compose.insert(file.path.clone(), file_families.clone());
        compose_families.extend(file_families);
    }

    let mut member_expr_bindings = FxHashMap::default();
    for family in &compose_families {
        if let Some(family_binding) = &family.family_binding {
            for (slot_name, binding_name) in &family.slots {
                member_expr_bindings.insert(
                    format!("{family_binding}.{slot_name}"),
                    binding_name.clone(),
                );
            }
        }
    }

    let has_scan_policy = !global_component_props.is_empty()
        || !global_custom_props.is_empty()
        || !component_usage_configs.is_empty();
    if has_scan_policy {
        for file in files {
            if dev_mode && cache_hit_files.contains(&file.path) {
                if let Some(cached_usage) = cached_jsx_by_file.get(&file.path) {
                    utility_inputs.extend(cached_usage.system_prop_usages.iter().map(|usage| {
                        UtilityInput {
                            prop_name: usage.prop_name.clone(),
                            value: usage.value.clone(),
                        }
                    }));
                    if let Some(custom_static) = cached_custom_static_by_file.get(&file.path) {
                        custom_inputs.extend(custom_static.iter().map(|usage| UtilityInput {
                            prop_name: usage.prop_name.clone(),
                            value: usage.value.clone(),
                        }));
                    }
                    if let Some(custom_dynamic) = cached_custom_dynamic_by_file.get(&file.path) {
                        custom_dynamic_usages.extend(custom_dynamic.iter().cloned());
                    }
                    usage_results.push(cached_usage.clone());
                    per_file_usage.insert(file.path.clone(), cached_usage.clone());
                    continue;
                }
            }

            let scan_allocator = Allocator::default();
            count_parse();
            let parsed = Parser::new(
                &scan_allocator,
                &file.source,
                source_type_for_path(&file.path),
            )
            .parse();

            let module_info = file_modules.get(&file.path);
            let has_aliases = module_info.is_some_and(|module_info| {
                module_info.imports.iter().any(|import| {
                    import.local_name != import.imported_name
                        && (global_component_props.contains_key(&import.imported_name)
                            || component_usage_configs.contains_key(&import.imported_name)
                            || global_custom_props.contains_key(&import.imported_name))
                })
            });

            let (file_component_props, file_usage_configs, file_custom_props);
            let (scan_component_props, scan_usage_configs, scan_custom_props): ScanMaps<'_>;
            if has_aliases {
                let module_info = module_info.expect("alias detection requires module info");
                file_component_props = {
                    let mut map = global_component_props.clone();
                    for import in &module_info.imports {
                        if import.local_name != import.imported_name {
                            if let Some(props) = global_component_props.get(&import.imported_name) {
                                map.insert(import.local_name.clone(), props.clone());
                            }
                        }
                    }
                    map
                };
                file_usage_configs = {
                    let mut map = component_usage_configs.clone();
                    for import in &module_info.imports {
                        if import.local_name != import.imported_name {
                            if let Some(config) = component_usage_configs.get(&import.imported_name)
                            {
                                map.insert(import.local_name.clone(), config.clone());
                            }
                        }
                    }
                    map
                };
                file_custom_props = {
                    let mut map = global_custom_props.clone();
                    for import in &module_info.imports {
                        if import.local_name != import.imported_name {
                            if let Some(props) = global_custom_props.get(&import.imported_name) {
                                map.insert(import.local_name.clone(), props.clone());
                            }
                        }
                    }
                    map
                };
                scan_component_props = &file_component_props;
                scan_usage_configs = &file_usage_configs;
                scan_custom_props = &file_custom_props;
            } else {
                scan_component_props = &global_component_props;
                scan_usage_configs = &component_usage_configs;
                scan_custom_props = &global_custom_props;
            }

            let usage_result = scan_jsx_usage(
                &parsed.program,
                scan_component_props,
                scan_usage_configs,
                &member_expr_bindings,
            );
            utility_inputs.extend(usage_result.system_prop_usages.iter().map(|usage| {
                UtilityInput {
                    prop_name: usage.prop_name.clone(),
                    value: usage.value.clone(),
                }
            }));

            if !scan_custom_props.is_empty() {
                let custom_scan =
                    scan_jsx(&parsed.program, scan_custom_props, &member_expr_bindings);
                custom_inputs.extend(custom_scan.static_usages.iter().map(|usage| UtilityInput {
                    prop_name: usage.prop_name.clone(),
                    value: usage.value.clone(),
                }));
                custom_dynamic_usages.extend(custom_scan.dynamic_usages.iter().cloned());
                per_file_custom_static.insert(file.path.clone(), custom_scan.static_usages);
                per_file_custom_dynamic.insert(file.path.clone(), custom_scan.dynamic_usages);
            }

            per_file_usage.insert(file.path.clone(), usage_result.clone());
            usage_results.push(usage_result);
        }
    }

    ProjectJsxScan {
        component_usage_configs,
        utility_inputs,
        custom_inputs,
        custom_dynamic_usages,
        usage_results,
        per_file_usage,
        per_file_custom_static,
        per_file_custom_dynamic,
        compose_families,
        per_file_compose,
        use_client_files,
    }
}

fn build_project_utility_output(input: ProjectUtilityInput<'_, '_>) -> ProjectUtilityOutput {
    let ProjectUtilityInput {
        sorted_ids,
        evaluated,
        mut utility_inputs,
        mut custom_inputs,
        custom_dynamic_usages,
        usage_results,
        resolve_ctx,
        breakpoints,
        class_prefix,
    } = input;

    let dynamic_prop_names = usage_results
        .iter()
        .flat_map(|result| result.dynamic_prop_usages.iter())
        .map(|usage| usage.prop_name.clone())
        .collect::<FxHashSet<_>>();

    let mut dynamic_props = HashMap::new();
    for prop_name in &dynamic_prop_names {
        if let Some(prop_config) = resolve_ctx.config.get(prop_name.as_str()) {
            let kebab = camel_to_kebab(prop_name);
            let mut scale_values = HashMap::new();
            if let Some(Value::String(scale_name)) = &prop_config.scale {
                let prefix = format!("{scale_name}.");
                for (theme_key, css_value) in resolve_ctx.theme {
                    if let Some(scale_key) = theme_key.strip_prefix(&prefix) {
                        scale_values.insert(scale_key.to_string(), css_value.clone());
                    }
                }
            }
            dynamic_props.insert(
                prop_name.clone(),
                DynamicPropMeta {
                    var_name: format!("--{class_prefix}-{kebab}"),
                    slot_class: format!("{class_prefix}-dyn-{kebab}"),
                    property: prop_config.property.clone(),
                    properties: prop_config.properties.clone(),
                    transform_name: prop_config.transform.clone(),
                    transform_fn_source: prop_config.transform_fn_source.clone(),
                    scale_values,
                },
            );
        }
    }

    let slot_entries = (!dynamic_props.is_empty())
        .then(|| build_variable_slot_entries(&dynamic_props, breakpoints));

    let mut global_custom_config = PropConfigMap::default();
    for component_id in sorted_ids {
        if let Some((_, _, _, Some(custom_configs))) = evaluated.get(component_id) {
            global_custom_config.extend(custom_configs.clone());
        }
    }

    let inline_transform_props = global_custom_config
        .iter()
        .filter(|(_, config)| config.transform_fn_source.is_some())
        .map(|(name, _)| name.clone())
        .collect::<FxHashSet<_>>();
    if !inline_transform_props.is_empty() {
        custom_inputs.retain(|input| !inline_transform_props.contains(&input.prop_name));
        utility_inputs.retain(|input| !inline_transform_props.contains(&input.prop_name));
    }

    let utility_output = (!utility_inputs.is_empty() || slot_entries.is_some()).then(|| {
        generate_utility_css(
            &utility_inputs,
            resolve_ctx,
            breakpoints,
            slot_entries,
            class_prefix,
        )
    });

    let mut custom_dynamic_by_binding = FxHashMap::default();
    for usage in custom_dynamic_usages {
        custom_dynamic_by_binding
            .entry(usage.binding.clone())
            .or_insert_with(FxHashSet::default)
            .insert(usage.prop_name.clone());
    }

    if !inline_transform_props.is_empty() {
        for component_id in sorted_ids {
            if let Some((_, replacement, _, Some(custom_configs))) = evaluated.get(component_id) {
                for prop_name in custom_configs.keys() {
                    if inline_transform_props.contains(prop_name) {
                        custom_dynamic_by_binding
                            .entry(replacement.binding.clone())
                            .or_insert_with(FxHashSet::default)
                            .insert(prop_name.clone());
                    }
                }
            }
        }
    }

    let mut per_component_custom_dynamic = HashMap::new();
    for component_id in sorted_ids {
        if let Some((_, replacement, _, Some(custom_configs))) = evaluated.get(component_id) {
            let Some(dynamic_props_for_binding) =
                custom_dynamic_by_binding.get(&replacement.binding)
            else {
                continue;
            };

            let class_hash = replacement
                .class_name
                .rsplit('-')
                .next()
                .unwrap_or(&replacement.class_name);
            let hash8 = &class_hash[..class_hash.len().min(8)];
            let mut component_dynamic = HashMap::new();
            for prop_name in dynamic_props_for_binding {
                let Some(prop_config) = custom_configs.get(prop_name) else {
                    continue;
                };
                let kebab = camel_to_kebab(prop_name);
                let mut scale_values = HashMap::new();
                match &prop_config.scale {
                    Some(Value::String(scale_name)) => {
                        let prefix = format!("{scale_name}.");
                        for (theme_key, css_value) in resolve_ctx.theme {
                            if let Some(scale_key) = theme_key.strip_prefix(&prefix) {
                                scale_values.insert(scale_key.to_string(), css_value.clone());
                            }
                        }
                    }
                    Some(Value::Object(inline_scale)) => {
                        let css_prop = camel_to_kebab(&prop_config.property);
                        for (key, value) in inline_scale {
                            let resolved = if let Some(value) = value.as_str() {
                                value.to_string()
                            } else if let Some(value) = value.as_f64() {
                                crate::css_generator::apply_unit_fallback_for_property(
                                    value, &css_prop,
                                )
                            } else {
                                value.to_string()
                            };
                            scale_values.insert(key.clone(), resolved);
                        }
                    }
                    _ => {}
                }

                component_dynamic.insert(
                    prop_name.clone(),
                    DynamicPropMeta {
                        var_name: format!("--{class_prefix}-{kebab}"),
                        slot_class: format!("{class_prefix}-dyn-{hash8}-{kebab}"),
                        property: prop_config.property.clone(),
                        properties: prop_config.properties.clone(),
                        transform_name: prop_config.transform.clone(),
                        transform_fn_source: prop_config.transform_fn_source.clone(),
                        scale_values,
                    },
                );
            }
            if !component_dynamic.is_empty() {
                per_component_custom_dynamic.insert(component_id.clone(), component_dynamic);
            }
        }
    }

    let mut custom_slot_entries = Vec::new();
    for custom_dynamic in per_component_custom_dynamic.values() {
        custom_slot_entries.extend(build_variable_slot_entries(custom_dynamic, breakpoints));
    }
    let custom_slot_entries = (!custom_slot_entries.is_empty()).then_some(custom_slot_entries);
    let custom_output = (!custom_inputs.is_empty() || custom_slot_entries.is_some()).then(|| {
        generate_custom_prop_css(
            &custom_inputs,
            &global_custom_config,
            resolve_ctx,
            breakpoints,
            custom_slot_entries,
            class_prefix,
        )
    });

    ProjectUtilityOutput {
        dynamic_prop_names,
        dynamic_props,
        per_component_custom_dynamic,
        utility_output,
        custom_output,
    }
}

fn populate_component_runtime_metadata(
    sorted_ids: &[String],
    evaluated: &mut EvaluatedComponents,
    custom_output: Option<&UtilityOutput>,
    per_component_custom_dynamic: &HashMap<String, HashMap<String, DynamicPropMeta>>,
) {
    for component_id in sorted_ids {
        let Some((_, replacement, active_props, custom_configs)) = evaluated.get_mut(component_id)
        else {
            continue;
        };

        let mut prop_names = Vec::new();
        if let Some(active_props) = active_props {
            prop_names.extend(active_props.iter().cloned());
        }
        if let Some(custom_configs) = custom_configs {
            prop_names.extend(custom_configs.keys().cloned());
        }
        prop_names.sort();
        prop_names.dedup();
        if !prop_names.is_empty() {
            replacement.system_prop_names = prop_names;
        }

        if let (Some(custom_configs), Some(custom_output)) = (custom_configs, custom_output) {
            if !custom_configs.is_empty() {
                let component_class_map = custom_configs
                    .keys()
                    .filter_map(|prop_name| {
                        custom_output
                            .class_map
                            .get(prop_name)
                            .map(|value_map| (prop_name.clone(), value_map.clone()))
                    })
                    .collect::<HashMap<_, _>>();
                if !component_class_map.is_empty() {
                    replacement.custom_prop_class_map = Some(component_class_map);
                }
            }
        }

        if let Some(custom_dynamic) = per_component_custom_dynamic.get(component_id) {
            replacement.custom_dynamic_config = Some(custom_dynamic.clone());
        }
    }
}

fn generate_project_css(input: ProjectCssInput<'_, '_>) -> GeneratedProjectCss {
    let ProjectCssInput {
        sorted_ids,
        evaluated,
        dynamic_prop_names,
        group_registry,
        reconciled_components,
        compose_families,
        breakpoints,
        utility_output,
        custom_output,
        global_style_blocks,
        keyframes_blocks,
        resolve_ctx,
        class_prefix,
    } = input;

    let mut replacement_by_id = FxHashMap::default();
    for component_id in sorted_ids {
        if let Some((_, replacement, _, _)) = evaluated.get_mut(component_id) {
            replacement.has_dynamic_props = replacement
                .system_prop_names
                .iter()
                .any(|name| dynamic_prop_names.contains(name));
            replacement_by_id.insert(
                component_id.clone(),
                generate_replacement(replacement, group_registry),
            );
        }
    }

    let reconciled_order = reconciled_components
        .iter()
        .map(|(component_id, _)| component_id.clone())
        .collect::<Vec<_>>();
    let component_css = reconciled_components
        .into_iter()
        .map(|(_, css)| css)
        .collect::<Vec<_>>();
    let (mut sheets, fragments) =
        generate_css_sheets_ordered(&component_css, breakpoints, &reconciled_order, class_prefix);

    let mut composed_variant_css = String::new();
    if !compose_families.is_empty() {
        let binding_to_class = evaluated
            .values()
            .map(|(_, replacement, _, _)| {
                (
                    replacement.binding.as_str(),
                    replacement.class_name.as_str(),
                )
            })
            .collect::<HashMap<_, _>>();
        let family_refs = compose_families
            .iter()
            .filter_map(|family| {
                let root_class = binding_to_class.get(family.root_binding.as_str())?;
                let child_slots = family
                    .slots
                    .iter()
                    .filter(|(slot_name, _)| slot_name != "Root")
                    .filter_map(|(_, binding)| {
                        binding_to_class
                            .get(binding.as_str())
                            .map(|class| (binding.as_str(), *class))
                    })
                    .collect::<Vec<_>>();
                (!child_slots.is_empty()).then_some(ComposeFamilyRef {
                    root_class,
                    child_slots,
                    shared_keys: &family.shared_keys,
                })
            })
            .collect::<Vec<_>>();
        if !family_refs.is_empty() {
            composed_variant_css =
                generate_composed_variant_css(&family_refs, &component_css, breakpoints);
        }
    }

    // Keep the standalone/composed sublayer topology visible even when either
    // side is empty; consumers and devtools see one stable cascade structure.
    let standalone_content = extract_layer_content(&sheets.variants);
    let variants_layer = layer_name("variants");
    let mut sublayered_variants = String::new();
    writeln!(sublayered_variants, "@layer {variants_layer} {{").unwrap();
    writeln!(sublayered_variants, "  @layer standalone, composed;").unwrap();
    if !standalone_content.is_empty() {
        writeln!(sublayered_variants, "  @layer standalone {{").unwrap();
        sublayered_variants.push_str(&standalone_content);
        writeln!(sublayered_variants, "  }}").unwrap();
    }
    writeln!(sublayered_variants, "  @layer composed {{").unwrap();
    sublayered_variants.push_str(&composed_variant_css);
    writeln!(sublayered_variants, "  }}").unwrap();
    writeln!(sublayered_variants, "}}").unwrap();
    sheets.variants = sublayered_variants;

    if let Some(utility_output) = utility_output {
        if !utility_output.css.is_empty() {
            sheets.system = utility_output.css.clone();
        }
    }
    if let Some(custom_output) = custom_output {
        if !custom_output.css.is_empty() {
            sheets.custom = custom_output.css.clone();
        }
    }

    let global_css = global_style_blocks
        .map(|blocks| resolve_all_global_blocks(blocks, resolve_ctx))
        .unwrap_or_default();
    let keyframes_css = keyframes_blocks
        .map(|blocks| resolve_all_keyframes_blocks(blocks, resolve_ctx))
        .unwrap_or_default();
    let mut combined_global = global_css.clone();
    if !keyframes_css.is_empty() {
        if !combined_global.is_empty() {
            combined_global.push('\n');
        }
        combined_global.push_str(&keyframes_css);
    }
    if !combined_global.is_empty() {
        sheets.global = format!(
            "@layer {} {{\n{}\n}}\n",
            layer_name("global"),
            combined_global
        );
    }

    // The compatibility CSS excludes global rules; plugins assemble sheets.global
    // separately and including it here would double-emit the same declarations.
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

    GeneratedProjectCss {
        replacement_by_id,
        sheets,
        fragments,
        css,
        global_css,
    }
}

fn build_project_manifest_data(input: ProjectManifestInput<'_>) -> ProjectManifestData {
    let ProjectManifestInput {
        sorted_ids,
        chain_lookup,
        evaluated,
        replacement_by_id,
        parent_map,
        utility_output,
        usage_ledger,
        compose_families,
        per_file_compose,
    } = input;

    let mut components = HashMap::new();
    let mut files = HashMap::<String, Vec<String>>::new();
    let mut provenance = HashMap::new();
    for component_id in sorted_ids {
        let Some((file_path, chain)) = chain_lookup.get(component_id) else {
            continue;
        };
        let Some((_, replacement, _, _)) = evaluated.get(component_id) else {
            continue;
        };

        let terminal = match chain.terminal {
            TerminalKind::AsElement => "asElement",
            TerminalKind::AsComponent => "asComponent",
            TerminalKind::AsClass => "asClass",
        };
        components.insert(
            component_id.clone(),
            ComponentDescriptor {
                file: file_path.clone(),
                binding: chain.binding.clone(),
                class_name: replacement.class_name.clone(),
                extends_from: parent_map.get(component_id).cloned(),
                terminal: terminal.to_string(),
                tag: chain.tag.clone(),
                replacement: replacement_by_id
                    .get(component_id)
                    .cloned()
                    .unwrap_or_default(),
                system_prop_names: replacement.system_prop_names.clone(),
            },
        );
        files
            .entry(file_path.clone())
            .or_default()
            .push(component_id.clone());

        let mut ancestors = Vec::new();
        let mut current = parent_map.get(component_id).cloned();
        while let Some(parent_id) = current {
            ancestors.push(parent_id.clone());
            current = parent_map.get(&parent_id).cloned();
        }
        if !ancestors.is_empty() {
            provenance.insert(component_id.clone(), ancestors);
        }
    }

    let mut utilities = HashMap::new();
    if let Some(utility_output) = utility_output {
        for (prop, value_map) in &utility_output.class_map {
            for (value, class_name) in value_map {
                utilities.insert(class_name.clone(), format!("{prop}:{value}"));
            }
        }
    }

    let mut rendered_components = usage_ledger.rendered_components.iter().collect::<Vec<_>>();
    rendered_components.sort();
    let usage = serde_json::json!({
        "rendered_components": rendered_components,
        "variant_usage": &usage_ledger.variant_usage,
        "state_usage": &usage_ledger.state_usage,
    });

    // This must run before cache storage drains per_file_compose.
    let compose_replacements = compose_families
        .iter()
        .filter_map(|family| {
            let file_path = per_file_compose
                .iter()
                .find(|(_, families)| families.iter().any(|entry| entry.span == family.span))
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

    ProjectManifestData {
        components,
        files,
        provenance,
        utilities,
        usage,
        compose_replacements,
    }
}

fn store_project_cache(
    files: &[FileEntry],
    file_path_set: &FxHashSet<String>,
    file_modules: &FxHashMap<String, FileModuleInfo>,
    all_chains: &FxHashMap<String, Vec<ChainDescriptor>>,
    cache_hit_files: &FxHashSet<String>,
    state: ProjectCacheState,
) {
    let ProjectCacheState {
        mut cached_evals_by_file,
        mut cached_jsx_by_file,
        mut cached_custom_static_by_file,
        mut cached_custom_dynamic_by_file,
        mut cached_compose_by_file,
        mut pre_merge_evals,
        mut per_file_usage,
        mut per_file_custom_static,
        mut per_file_custom_dynamic,
        mut per_file_compose,
        mut transforms_by_file,
        mut static_values_by_file,
        mut static_exports_by_file,
    } = state;

    let Ok(mut cache) = FILE_CACHE.lock() else {
        return;
    };
    for file in files {
        let Some(file_hash) = &file.hash else {
            continue;
        };
        let (
            eval_results,
            jsx_usage,
            custom_prop_static,
            custom_prop_dynamic,
            compose_families,
            static_values,
            static_exports,
        ) = if cache_hit_files.contains(&file.path) {
            (
                cached_evals_by_file.remove(&file.path).unwrap_or_default(),
                cached_jsx_by_file.remove(&file.path).unwrap_or_default(),
                cached_custom_static_by_file
                    .remove(&file.path)
                    .unwrap_or_default(),
                cached_custom_dynamic_by_file
                    .remove(&file.path)
                    .unwrap_or_default(),
                cached_compose_by_file
                    .remove(&file.path)
                    .unwrap_or_default(),
                static_values_by_file
                    .get(&file.path)
                    .cloned()
                    .unwrap_or_default(),
                static_exports_by_file
                    .get(&file.path)
                    .cloned()
                    .unwrap_or_default(),
            )
        } else {
            (
                pre_merge_evals.remove(&file.path).unwrap_or_default(),
                per_file_usage.remove(&file.path).unwrap_or_default(),
                per_file_custom_static
                    .remove(&file.path)
                    .unwrap_or_default(),
                per_file_custom_dynamic
                    .remove(&file.path)
                    .unwrap_or_default(),
                per_file_compose.remove(&file.path).unwrap_or_default(),
                static_values_by_file.remove(&file.path).unwrap_or_default(),
                static_exports_by_file
                    .remove(&file.path)
                    .unwrap_or_default(),
            )
        };

        cache.insert(
            file.path.clone(),
            CachedFileResult {
                hash: file_hash.clone(),
                module_info: file_modules
                    .get(&file.path)
                    .cloned()
                    .unwrap_or(FileModuleInfo {
                        imports: Vec::new(),
                        exports: Vec::new(),
                    }),
                chains: all_chains.get(&file.path).cloned().unwrap_or_default(),
                eval_results,
                jsx_usage,
                custom_prop_static,
                custom_prop_dynamic,
                compose_families,
                extracted_transforms: transforms_by_file.remove(&file.path).unwrap_or_default(),
                static_values,
                static_exports,
            },
        );
    }

    let paths_to_evict = cache
        .keys()
        .filter(|path| !file_path_set.contains(*path))
        .cloned()
        .collect::<Vec<_>>();
    for path in paths_to_evict {
        cache.remove(&path);
    }
}

fn append_invalid_transform_diagnostics(
    diagnostics: &mut Vec<ExtractionDiagnostic>,
    transforms: &[ExtractedTransform],
) {
    for transform in transforms.iter().filter(|transform| !transform.valid) {
        diagnostics.extend(
            transform
                .diagnostics
                .iter()
                .map(|message| ExtractionDiagnostic {
                    file: transform.file.clone(),
                    component: format!("createTransform('{}')", transform.name),
                    kind: "bail".to_string(),
                    message: message.clone(),
                }),
        );
    }
}

fn build_reverse_provenance(
    provenance: &HashMap<String, Vec<String>>,
) -> HashMap<String, Vec<String>> {
    let mut reverse_provenance = HashMap::<String, Vec<String>>::new();
    for (child_id, ancestors) in provenance {
        if let Some(parent_id) = ancestors.first() {
            reverse_provenance
                .entry(parent_id.clone())
                .or_default()
                .push(child_id.clone());
        }
    }
    reverse_provenance
}

pub(crate) fn analyze(input: AnalyzeInput<'_>) -> UniverseManifest {
    let AnalyzeInput {
        files,
        theme,
        variable_map,
        contextual_vars,
        config,
        group_registry,
        resolve_package_path,
        dev_mode,
        class_prefix,
        emitter_config,
        selector_aliases,
        global_style_blocks,
        path_aliases,
        keyframes_blocks,
    } = input;
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

    // ---------------------------------------------------------------------------
    // Phase 1: Parse all files — collect chains and module info.
    let phase1_start = Instant::now();
    let ParsedProjectFiles {
        all_chains,
        file_modules,
        cache_hit_files,
        cached_evals_by_file,
        cached_jsx_by_file,
        cached_custom_static_by_file,
        cached_custom_dynamic_by_file,
        cached_compose_by_file,
        transforms_by_file,
        all_extracted_transforms,
        static_values_by_file,
        static_exports_by_file,
    } = parse_project_files(files);

    let parse_and_walk_ms = phase1_start.elapsed().as_millis() as u64;
    let cache_hits = cache_hit_files.len();

    // ---------------------------------------------------------------------------
    // Phase 2: Build binding map via import resolver.
    // ---------------------------------------------------------------------------
    let phase2_start = Instant::now();

    let ResolvedProjectImports {
        binding_map,
        static_values: resolved_static_values,
    } = resolve_project_imports(ProjectImportInput {
        file_path_set: &file_path_set,
        path_aliases,
        resolve_package_path,
        file_modules: &file_modules,
        static_values_by_file: &static_values_by_file,
        static_exports_by_file: &static_exports_by_file,
        keyframes_blocks,
    });

    let import_resolution_ms = phase2_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 3: Resolve extension provenance.
    //
    // For each chain with extends_from, look up the local binding in binding_map
    // to find the definitive file + export_name of the parent component.
    // ---------------------------------------------------------------------------
    let phase3_start = Instant::now();
    let (parent_map, unresolvable_extensions) =
        resolve_extension_provenance(&all_chains, &binding_map);

    let extension_provenance_ms = phase3_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 4: Topological sort.
    // ---------------------------------------------------------------------------
    let phase4_start = Instant::now();
    let sorted_ids =
        sort_extractable_components(&all_chains, &parent_map, &unresolvable_extensions);

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

    let phase5a_start = Instant::now();
    let EvaluatedProjectChains {
        mut evaluated,
        chain_lookup,
        pre_merge_evals,
        mut diagnostics,
    } = evaluate_project_chains(ChainEvaluationInput {
        sorted_ids: &sorted_ids,
        all_chains: &all_chains,
        files,
        extracted_transforms: &all_extracted_transforms,
        cache_hit_files: &cache_hit_files,
        cached_evals_by_file: &cached_evals_by_file,
        parent_map: &parent_map,
        proc_ctx: &proc_ctx,
        resolved_static_values: &resolved_static_values,
        evaluator: &evaluator,
    });

    let chain_evaluation_ms = phase5a_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 5b: JSX scanning (global — single pass across all files)
    // ---------------------------------------------------------------------------
    let phase5b_start = Instant::now();
    let ProjectJsxScan {
        component_usage_configs,
        utility_inputs,
        custom_inputs,
        custom_dynamic_usages,
        usage_results,
        per_file_usage,
        per_file_custom_static,
        per_file_custom_dynamic,
        compose_families,
        per_file_compose,
        use_client_files,
    } = scan_project_jsx(ProjectJsxScanInput {
        files,
        sorted_ids: &sorted_ids,
        evaluated: &evaluated,
        file_modules: &file_modules,
        cache_hit_files: &cache_hit_files,
        cached_jsx_by_file: &cached_jsx_by_file,
        cached_custom_static_by_file: &cached_custom_static_by_file,
        cached_custom_dynamic_by_file: &cached_custom_dynamic_by_file,
        cached_compose_by_file: &cached_compose_by_file,
        dev_mode,
    });

    let ProjectUtilityOutput {
        dynamic_prop_names,
        dynamic_props,
        per_component_custom_dynamic,
        utility_output,
        custom_output,
    } = build_project_utility_output(ProjectUtilityInput {
        sorted_ids: &sorted_ids,
        evaluated: &evaluated,
        utility_inputs,
        custom_inputs,
        custom_dynamic_usages: &custom_dynamic_usages,
        usage_results: &usage_results,
        resolve_ctx: &resolve_ctx,
        breakpoints: &breakpoints,
        class_prefix,
    });

    let jsx_scanning_ms = phase5b_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 5c: Populate system_prop_names on each replacement.
    // system_props moved to shared map (UniverseManifest.system_prop_map).
    // ---------------------------------------------------------------------------
    let phase5c_start = Instant::now();

    populate_component_runtime_metadata(
        &sorted_ids,
        &mut evaluated,
        custom_output.as_ref(),
        &per_component_custom_dynamic,
    );

    let system_prop_aggregation_ms = phase5c_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 5d: Build usage ledger from all scan results.
    // ---------------------------------------------------------------------------
    let phase5d_start = Instant::now();

    let usage_ledger = build_project_usage_ledger(
        &usage_results,
        &component_usage_configs,
        &sorted_ids,
        &evaluated,
        &compose_families,
    );

    let usage_ledger_ms = phase5d_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 5e: Build reconciled component list (topo order) and reconcile.
    // In dev_mode: skip reconciliation — pass all components without pruning.
    // ---------------------------------------------------------------------------
    let phase5e_start = Instant::now();

    let (reconciled_components, reconciliation_report) = reconcile_project_components(
        &sorted_ids,
        &evaluated,
        &parent_map,
        &usage_ledger,
        dev_mode,
    );

    let reconciliation_ms = phase5e_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 6: Generate replacement strings.
    // ---------------------------------------------------------------------------
    let phase6_start = Instant::now();

    let GeneratedProjectCss {
        replacement_by_id,
        sheets,
        fragments: css_fragments,
        css,
        global_css: global_css_raw,
    } = generate_project_css(ProjectCssInput {
        sorted_ids: &sorted_ids,
        evaluated: &mut evaluated,
        dynamic_prop_names: &dynamic_prop_names,
        group_registry,
        reconciled_components,
        compose_families: &compose_families,
        breakpoints: &breakpoints,
        utility_output: utility_output.as_ref(),
        custom_output: custom_output.as_ref(),
        global_style_blocks,
        keyframes_blocks,
        resolve_ctx: &resolve_ctx,
        class_prefix,
    });

    let css_generation_ms = phase6_start.elapsed().as_millis() as u64;

    // ---------------------------------------------------------------------------
    // Phase 7: Build manifest.
    // ---------------------------------------------------------------------------
    let phase7_start = Instant::now();

    let ProjectManifestData {
        components: components_map,
        files: files_map,
        provenance: provenance_map,
        utilities: utilities_map,
        usage: usage_json,
        compose_replacements,
    } = build_project_manifest_data(ProjectManifestInput {
        sorted_ids: &sorted_ids,
        chain_lookup: &chain_lookup,
        evaluated: &evaluated,
        replacement_by_id: &replacement_by_id,
        parent_map: &parent_map,
        utility_output: utility_output.as_ref(),
        usage_ledger: &usage_ledger,
        compose_families: &compose_families,
        per_file_compose: &per_file_compose,
    });

    store_project_cache(
        files,
        &file_path_set,
        &file_modules,
        &all_chains,
        &cache_hit_files,
        ProjectCacheState {
            cached_evals_by_file,
            cached_jsx_by_file,
            cached_custom_static_by_file,
            cached_custom_dynamic_by_file,
            cached_compose_by_file,
            pre_merge_evals,
            per_file_usage,
            per_file_custom_static,
            per_file_custom_dynamic,
            per_file_compose,
            transforms_by_file,
            static_values_by_file,
            static_exports_by_file,
        },
    );

    // Build shared system prop map from utility output (group props only)
    let system_prop_map = if let Some(util_out) = &utility_output {
        util_out.class_map.clone()
    } else {
        HashMap::new()
    };

    // Valid transforms were registered during evaluation; append only invalid diagnostics.
    append_invalid_transform_diagnostics(&mut diagnostics, &all_extracted_transforms);

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

    // Reverse provenance records only the direct parent (first ancestor).
    let reverse_provenance = build_reverse_provenance(&provenance_map);

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
    use crate::import_resolver::{ExportInfo, ImportInfo};
    use serde_json::json;

    #[test]
    fn phase_two_preserves_resolution_precedence_and_enrichment_order() {
        let mut file_modules = FxHashMap::default();
        file_modules.insert(
            "src/tokens.ts".to_string(),
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
            "src/theme/palette.ts".to_string(),
            FileModuleInfo {
                imports: Vec::new(),
                exports: vec![ExportInfo {
                    exported_name: "ACCENT".to_string(),
                    local_name: Some("ACCENT".to_string()),
                    source: None,
                    is_default: false,
                }],
            },
        );
        file_modules.insert(
            "node_modules/animus-motion/index.ts".to_string(),
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
            "sentinel.ts".to_string(),
            FileModuleInfo {
                imports: Vec::new(),
                exports: vec![
                    ExportInfo {
                        exported_name: "GAP".to_string(),
                        local_name: Some("GAP".to_string()),
                        source: None,
                        is_default: false,
                    },
                    ExportInfo {
                        exported_name: "ACCENT".to_string(),
                        local_name: Some("ACCENT".to_string()),
                        source: None,
                        is_default: false,
                    },
                ],
            },
        );
        file_modules.insert(
            "src/component.tsx".to_string(),
            FileModuleInfo {
                imports: vec![
                    ImportInfo {
                        local_name: "spacing".to_string(),
                        imported_name: "GAP".to_string(),
                        source: "./tokens".to_string(),
                        is_default: false,
                    },
                    ImportInfo {
                        local_name: "accent".to_string(),
                        imported_name: "ACCENT".to_string(),
                        source: "@theme/palette".to_string(),
                        is_default: false,
                    },
                    ImportInfo {
                        local_name: "remoteAnimation".to_string(),
                        imported_name: "motion".to_string(),
                        source: "animus-motion".to_string(),
                        is_default: false,
                    },
                    ImportInfo {
                        local_name: "animation".to_string(),
                        imported_name: "motion".to_string(),
                        source: "animus-motion".to_string(),
                        is_default: false,
                    },
                ],
                exports: vec![ExportInfo {
                    exported_name: "LOCAL_MOTION".to_string(),
                    local_name: Some("animation".to_string()),
                    source: None,
                    is_default: false,
                }],
            },
        );

        let mut static_values_by_file = FxHashMap::default();
        static_values_by_file.insert(
            "src/component.tsx".to_string(),
            FxHashMap::from_iter([
                ("LOCAL".to_string(), json!("kept")),
                ("spacing".to_string(), json!("local-spacing")),
                ("remoteAnimation".to_string(), json!("local-remote")),
                ("animation".to_string(), json!("local-animation")),
            ]),
        );

        let mut static_exports_by_file = FxHashMap::default();
        static_exports_by_file.insert(
            "src/tokens.ts".to_string(),
            FxHashMap::from_iter([("GAP".to_string(), json!(8))]),
        );
        static_exports_by_file.insert(
            "src/theme/palette.ts".to_string(),
            FxHashMap::from_iter([("ACCENT".to_string(), json!("hotpink"))]),
        );
        static_exports_by_file.insert(
            "node_modules/animus-motion/index.ts".to_string(),
            FxHashMap::from_iter([("motion".to_string(), json!("static-motion"))]),
        );
        static_exports_by_file.insert(
            "sentinel.ts".to_string(),
            FxHashMap::from_iter([
                ("GAP".to_string(), json!("wrong-relative")),
                ("ACCENT".to_string(), json!("wrong-alias")),
            ]),
        );

        let keyframes_blocks = json!({
            "motion": {
                "ember": {
                    "name": "animus-kf-ember",
                    "frames": { "0%": { "opacity": 0 } }
                }
            },
            "LOCAL_MOTION": {
                "flash": {
                    "name": "animus-kf-local-flash",
                    "frames": { "0%": { "opacity": 1 } }
                }
            }
        });

        let file_path_set = file_modules.keys().cloned().collect();
        let path_aliases = vec![
            AliasEntry {
                pattern: "./tokens".to_string(),
                replacement: "sentinel.ts".to_string(),
                alias_type: AliasType::Exact,
            },
            AliasEntry {
                pattern: "@theme/".to_string(),
                replacement: "src/theme/".to_string(),
                alias_type: AliasType::Prefix,
            },
        ];
        let package_requests = std::cell::RefCell::new(Vec::new());
        let resolve_package_path = |source: &str| {
            package_requests.borrow_mut().push(source.to_string());
            Some(if source == "animus-motion" {
                "node_modules/animus-motion/index.ts".to_string()
            } else {
                "sentinel.ts".to_string()
            })
        };

        let ResolvedProjectImports {
            binding_map,
            static_values,
        } = resolve_project_imports(ProjectImportInput {
            file_path_set: &file_path_set,
            path_aliases: &path_aliases,
            resolve_package_path: &resolve_package_path,
            file_modules: &file_modules,
            static_values_by_file: &static_values_by_file,
            static_exports_by_file: &static_exports_by_file,
            keyframes_blocks: Some(&keyframes_blocks),
        });

        let relative = &binding_map[&("src/component.tsx".to_string(), "spacing".to_string())];
        assert_eq!(relative.file, "src/tokens.ts");
        assert_eq!(relative.export_name, "GAP");

        let aliased = &binding_map[&("src/component.tsx".to_string(), "accent".to_string())];
        assert_eq!(aliased.file, "src/theme/palette.ts");
        assert_eq!(aliased.export_name, "ACCENT");

        let package =
            &binding_map[&("src/component.tsx".to_string(), "remoteAnimation".to_string())];
        assert_eq!(package.file, "node_modules/animus-motion/index.ts");
        assert_eq!(package.export_name, "motion");
        assert_eq!(
            package_requests.into_inner(),
            vec!["animus-motion", "animus-motion"]
        );

        assert_eq!(static_values["src/component.tsx"]["LOCAL"], json!("kept"));
        assert_eq!(static_values["src/component.tsx"]["spacing"], json!(8));
        assert_eq!(
            static_values["src/component.tsx"]["accent"],
            json!("hotpink")
        );
        assert_eq!(
            static_values["src/component.tsx"]["remoteAnimation"],
            json!({ "ember": "animus-kf-ember" })
        );
        assert_eq!(
            static_values["src/component.tsx"]["animation"],
            json!({ "flash": "animus-kf-local-flash" })
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
