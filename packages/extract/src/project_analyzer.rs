use std::collections::{HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::chain_merger::{ProvenanceNode, TopoResult, merge_chain_configs, topological_sort};
use crate::chain_walker::{walk_chains, TerminalKind};
use crate::css_generator::{
    generate_css_ordered, generate_css_sheets_ordered, generate_custom_prop_css,
    generate_utility_css, ComponentCss, CssSheets, UtilityInput, VariantCss,
};
use crate::import_resolver::{parse_module_info, resolve_bindings, FileModuleInfo};
use crate::jsx_scanner::{scan_jsx, scan_jsx_usage, ComponentUsageConfig, UsageScanResult};
use crate::reconciler::{build_ledger, reconcile};
use crate::theme_resolver::{FlatTheme, PropConfigMap, VariableMap, resolve_styles};
use crate::transform_emitter::{
    generate_replacement, ComponentReplacement, VariantPropConfig,
};
use crate::{
    extract_breakpoints, parse_object_from_source, parse_variant_from_source, process_chain,
};

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/// A source file entry to analyze.
#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub source: String,
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
    /// System prop class map: prop_name → value_key → class_name.
    pub system_props: Option<HashMap<String, HashMap<String, String>>>,
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
    config: &PropConfigMap,
    group_registry: &HashMap<String, Vec<String>>,
    resolve_package_path: &dyn Fn(&str) -> Option<String>,
) -> UniverseManifest {
    let breakpoints = extract_breakpoints(theme);

    // Collect file paths as a HashSet for fast membership checks during path resolution.
    let file_path_set: HashSet<String> = files.iter().map(|f| f.path.clone()).collect();

    // ---------------------------------------------------------------------------
    // Phase 1: Parse all files — collect chains and module info.
    //
    // Option B: parse twice (once in walk_chains, once for parse_module_info).
    // ---------------------------------------------------------------------------

    // file_path → (chains, module_info)
    let mut all_chains: HashMap<String, Vec<crate::chain_walker::ChainDescriptor>> =
        HashMap::new();
    let mut file_modules: HashMap<String, FileModuleInfo> = HashMap::new();

    for file in files {
        let source_type = source_type_for_path(&file.path);

        // Walk chains (creates its own Allocator internally)
        let allocator = Allocator::default();
        let chains = walk_chains(&file.source, &file.path, &allocator);
        all_chains.insert(file.path.clone(), chains);

        // Parse module info (separate parse)
        let mod_allocator = Allocator::default();
        let parse_result =
            Parser::new(&mod_allocator, &file.source, source_type).parse();
        let module_info = parse_module_info(&parse_result.program);
        file_modules.insert(file.path.clone(), module_info);
    }

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

    // Build a lookup: file_path → source (for process_chain which needs the raw source)
    let source_map: HashMap<String, &str> =
        files.iter().map(|f| (f.path.clone(), f.source.as_str())).collect();

    // Collect extraction diagnostics (bail + skip warnings)
    let mut diagnostics: Vec<ExtractionDiagnostic> = Vec::new();

    // Build a lookup: component_id → chain descriptor
    let mut chain_lookup: HashMap<String, (String, crate::chain_walker::ChainDescriptor)> =
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

        let source = match source_map.get(file_path.as_str()) {
            Some(s) => s,
            None => continue,
        };

        match process_chain(chain, source, file_path, config, theme, variable_map, group_registry) {
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
                                });
                            }
                        }

                        // Merge states: inherit parent states child doesn't override
                        for (name, styles) in &parent_css.states {
                            if !component_css.states.iter().any(|(n, _)| n == name) {
                                component_css.states.push((name.clone(), styles.clone()));
                            }
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

    // Scan all files for JSX usages (system props + variant/state/component usage)
    let mut all_utility_inputs: Vec<UtilityInput> = Vec::new();
    let mut all_custom_inputs: Vec<UtilityInput> = Vec::new();
    let mut all_usage_results: Vec<UsageScanResult> = Vec::new();

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

    for file in files {
        if global_component_props.is_empty() && global_custom_props.is_empty() && component_usage_configs.is_empty() {
            break;
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
        );

        // Collect system prop utility inputs from the usage result
        all_utility_inputs.extend(usage_result.system_prop_usages.iter().map(|u| UtilityInput {
            prop_name: u.prop_name.clone(),
            value: u.value.clone(),
        }));

        // Also scan for custom prop usages (scan_jsx is still used for custom props)
        if !global_custom_props.is_empty() {
            let custom_usages = scan_jsx(&parse_result.program, &global_custom_props);
            all_custom_inputs.extend(custom_usages.iter().map(|u| UtilityInput {
                prop_name: u.prop_name.clone(),
                value: u.value.clone(),
            }));
        }

        all_usage_results.push(usage_result);
    }

    // Generate utility CSS (global dedup via generate_utility_css's seen map)
    let utility_output = if !all_utility_inputs.is_empty() {
        Some(generate_utility_css(&all_utility_inputs, config, theme, variable_map, &breakpoints))
    } else {
        None
    };

    // Build the global custom config map (union of all components' custom props)
    let mut global_custom_config: PropConfigMap = PropConfigMap::new();
    for component_id in &sorted_ids {
        if let Some((_, _, _, custom_configs)) = evaluated.get(component_id) {
            if let Some(cc) = custom_configs {
                global_custom_config.extend(cc.clone());
            }
        }
    }

    let custom_output = if !all_custom_inputs.is_empty() && !global_custom_config.is_empty() {
        Some(generate_custom_prop_css(
            &all_custom_inputs,
            &global_custom_config,
            theme,
            variable_map,
            &breakpoints,
        ))
    } else {
        None
    };

    // ---------------------------------------------------------------------------
    // Phase 5c: Populate system_props and system_prop_names on each replacement.
    // ---------------------------------------------------------------------------

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, active_props, custom_configs)) =
            evaluated.get_mut(component_id)
        {
            // Collect all prop names for this component
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

                // Populate system_props from utility output
                if let Some(util_out) = &utility_output {
                    if let Some(props) = active_props {
                        let filtered: HashMap<String, HashMap<String, String>> = util_out
                            .class_map
                            .iter()
                            .filter(|(prop, _)| props.contains(*prop))
                            .map(|(k, v)| (k.clone(), v.clone()))
                            .collect();
                        if !filtered.is_empty() {
                            comp_replacement.system_props = Some(filtered);
                        }
                    }
                }
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

    let usage_ledger = build_ledger(&all_usage_results, &variant_configs_for_ledger);

    // ---------------------------------------------------------------------------
    // Phase 5e: Build reconciled component list (topo order) and reconcile.
    // ---------------------------------------------------------------------------

    // Collect the bindings of components that serve as parents in the extension graph.
    // These must be kept in CSS even if they are never directly rendered.
    let parent_bindings: HashSet<String> = parent_map.values()
        .filter_map(|parent_id| parent_id.rfind("::").map(|pos| parent_id[pos + 2..].to_string()))
        .collect();

    // Build the mutable Vec<(component_id, ComponentCss)> in topological order.
    let mut reconciled_components: Vec<(String, ComponentCss)> = sorted_ids
        .iter()
        .filter_map(|component_id| {
            evaluated.get(component_id).map(|(component_css, _, _, _)| {
                (component_id.clone(), clone_component_css(component_css))
            })
        })
        .collect();

    // Reconcile: remove unused variants, states, and whole components.
    let reconciliation_report = reconcile(&mut reconciled_components, &usage_ledger, &parent_bindings);

    // ---------------------------------------------------------------------------
    // Phase 6: Generate replacement strings.
    // ---------------------------------------------------------------------------

    let mut replacement_by_id: HashMap<String, String> = HashMap::new();

    for component_id in &sorted_ids {
        if let Some((_, comp_replacement, _, _)) = evaluated.get_mut(component_id) {
            let replacement_text = generate_replacement(comp_replacement);
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

    let mut sheets = generate_css_sheets_ordered(&component_css_list, &breakpoints, &reconciled_order);

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
    for sheet in [&sheets.base, &sheets.variants, &sheets.states, &sheets.system, &sheets.custom] {
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
            system_props: comp_replacement.system_props.clone(),
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

    // Serialize reconciliation report
    let report_json = serde_json::to_value(&reconciliation_report).unwrap_or(serde_json::json!({}));

    UniverseManifest {
        components: components_map,
        utilities: utilities_map,
        css,
        sheets,
        provenance: provenance_map,
        files: files_map,
        usage: usage_json,
        report: report_json,
        diagnostics,
    }
}

// ---------------------------------------------------------------------------
// Helper: clone a ComponentCss (since ComponentCss doesn't derive Clone)
// ---------------------------------------------------------------------------

fn clone_component_css(src: &ComponentCss) -> ComponentCss {
    ComponentCss {
        class_name: src.class_name.clone(),
        base: src.base.clone(),
        variants: src
            .variants
            .iter()
            .map(|v| VariantCss {
                prop: v.prop.clone(),
                options: v
                    .options
                    .iter()
                    .map(|(name, styles)| (name.clone(), styles.clone()))
                    .collect(),
            })
            .collect(),
        states: src
            .states
            .iter()
            .map(|(name, styles)| (name.clone(), styles.clone()))
            .collect(),
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
