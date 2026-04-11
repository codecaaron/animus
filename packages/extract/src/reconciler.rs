use rustc_hash::{FxHashMap, FxHashSet};

use crate::css_generator::ComponentCss;
use crate::jsx_scanner::{UsageScanResult, VariantUsage};

// ---------------------------------------------------------------------------
// Usage Ledger
// ---------------------------------------------------------------------------

/// Aggregated usage data across all files
#[derive(Debug, Clone, Default)]
pub struct UsageLedger {
    /// Component bindings that appear as JSX element tags
    pub rendered_components: FxHashSet<String>,
    /// binding → variant_prop → Set<used_option_values>
    pub variant_usage: FxHashMap<String, FxHashMap<String, FxHashSet<String>>>,
    /// binding → Set<used_state_names>
    pub state_usage: FxHashMap<String, FxHashSet<String>>,
}

/// Build a usage ledger from scan results across multiple files.
///
/// `all_results` - scan results from each file
/// `variant_configs` - binding → variant_prop → (all_options, default_option)
///   Used to resolve "__dynamic__" (expand to all options) and "__default__" (expand to default option)
pub fn build_ledger(
    all_results: &[UsageScanResult],
    variant_configs: &FxHashMap<String, FxHashMap<String, (FxHashSet<String>, Option<String>)>>,
) -> UsageLedger {
    let mut ledger = UsageLedger::default();

    for result in all_results {
        // 1. Union rendered components
        for binding in &result.rendered_components {
            ledger.rendered_components.insert(binding.clone());
        }

        // 2. Resolve variant usages
        for usage in &result.variant_usages {
            let VariantUsage {
                component_binding,
                variant_prop,
                value,
            } = usage;

            let used_set = ledger
                .variant_usage
                .entry(component_binding.clone())
                .or_default()
                .entry(variant_prop.clone())
                .or_default();

            match value.as_str() {
                "__dynamic__" => {
                    // Expand to all known options for this variant prop
                    if let Some(prop_config) = variant_configs
                        .get(component_binding)
                        .and_then(|vc| vc.get(variant_prop))
                    {
                        for option in &prop_config.0 {
                            used_set.insert(option.clone());
                        }
                    }
                    // If no config exists, nothing to expand — dynamic with unknown options is a no-op here
                }
                "__default__" => {
                    // Expand to the default option if one exists
                    if let Some(default) = variant_configs
                        .get(component_binding)
                        .and_then(|vc| vc.get(variant_prop))
                        .and_then(|(_, default)| default.as_ref())
                    {
                        used_set.insert(default.clone());
                    }
                }
                literal => {
                    used_set.insert(literal.to_string());
                }
            }
        }

        // 3. Union state usages
        for usage in &result.state_usages {
            ledger
                .state_usage
                .entry(usage.component_binding.clone())
                .or_default()
                .insert(usage.state_name.clone());
        }
    }

    // Guard: remove empty variant entries created by __dynamic__/__default__ with no config.
    // An empty FxHashSet means "we saw the variant but couldn't determine any used options."
    // The reconciler treats Some(empty) as "nothing used → eliminate all" which is wrong.
    // Removing the empty entry makes it None → conservative "keep all" behavior.
    for (_binding, prop_map) in ledger.variant_usage.iter_mut() {
        prop_map.retain(|_prop, used_set| !used_set.is_empty());
    }
    ledger.variant_usage.retain(|_binding, prop_map| !prop_map.is_empty());

    ledger
}

// ---------------------------------------------------------------------------
// CSS Reconciler
// ---------------------------------------------------------------------------

/// Report of what was eliminated during reconciliation
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ReconciliationReport {
    pub components_total: usize,
    pub components_extracted: usize,
    pub components_eliminated: usize,
    pub variants_total: usize,
    pub variants_used: usize,
    pub variants_eliminated: usize,
    pub states_total: usize,
    pub states_used: usize,
    pub states_eliminated: usize,
    pub eliminated_details: Vec<EliminatedDetail>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EliminatedDetail {
    pub component: String,
    pub kind: String,       // "component", "variant", "state"
    pub name: Option<String>, // variant option or state name (None for whole component)
    pub reason: String,
}

/// Reconcile component CSS list by removing unused variants, states, and whole components.
///
/// `components` - mutable list of (component_id, ComponentCss) to filter
/// `ledger` - the usage ledger
/// `parent_components` - set of component bindings that are parents in the provenance graph
///   (these are kept even if not rendered, because children inherit from them)
///
/// Returns a reconciliation report.
pub fn reconcile(
    components: &mut Vec<(String, ComponentCss)>,
    ledger: &UsageLedger,
    parent_components: &FxHashSet<String>,
) -> ReconciliationReport {
    let mut report = ReconciliationReport::default();

    // Track totals before filtering
    report.components_total = components.len();

    // Pre-count variant and state totals
    for (_, css) in components.iter() {
        for variant in &css.variants {
            report.variants_total += variant.options.len();
        }
        report.states_total += css.states.len();
    }

    // --- Step 1: Component-level elimination ---
    // Collect indices to remove (removing backwards to preserve indices)
    let mut to_remove: Vec<usize> = Vec::new();

    for (i, (component_id, css)) in components.iter().enumerate() {
        let binding = extract_binding(component_id);

        if !ledger.rendered_components.contains(binding)
            && !parent_components.contains(binding)
        {
            to_remove.push(i);
            report.eliminated_details.push(EliminatedDetail {
                component: binding.to_string(),
                kind: "component".to_string(),
                name: None,
                reason: "component not rendered and not a parent".to_string(),
            });
            // Count variants and states being eliminated with the whole component
            for variant in &css.variants {
                report.variants_eliminated += variant.options.len();
            }
            report.states_eliminated += css.states.len();
        }
    }

    // Remove from back to front to preserve indices
    for &i in to_remove.iter().rev() {
        components.remove(i);
    }

    report.components_eliminated = to_remove.len();
    report.components_extracted = components.len();

    // --- Step 2: Variant option elimination and Step 3: State elimination ---
    for (component_id, css) in components.iter_mut() {
        let binding = extract_binding(component_id).to_string();

        // Variant option filtering
        for variant in css.variants.iter_mut() {
            let used_options = ledger
                .variant_usage
                .get(&binding)
                .and_then(|vu| vu.get(&variant.prop));

            match used_options {
                None => {
                    // No usage data for this variant prop — conservative: keep all
                }
                Some(used_set) => {
                    let before_count = variant.options.len();
                    // Retain only options whose name is in the used set
                    let mut eliminated_here: Vec<String> = Vec::new();
                    variant.options.retain(|(option_name, _)| {
                        let keep = used_set.contains(option_name);
                        if !keep {
                            eliminated_here.push(option_name.clone());
                        }
                        keep
                    });
                    let after_count = variant.options.len();
                    let eliminated_count = before_count - after_count;
                    report.variants_eliminated += eliminated_count;

                    for eliminated_option in eliminated_here {
                        report.eliminated_details.push(EliminatedDetail {
                            component: binding.clone(),
                            kind: "variant".to_string(),
                            name: Some(eliminated_option.clone()),
                            reason: format!(
                                "variant option '{}' on prop '{}' not in used set",
                                eliminated_option, variant.prop
                            ),
                        });
                    }
                }
            }
        }

        // State filtering
        let used_states = ledger.state_usage.get(&binding);
        match used_states {
            None => {
                // No usage data for this binding's states — conservative: keep all
            }
            Some(used_set) => {
                let before_count = css.states.len();
                let mut eliminated_here: Vec<String> = Vec::new();
                css.states.retain(|(state_name, _)| {
                    let keep = used_set.contains(state_name);
                    if !keep {
                        eliminated_here.push(state_name.clone());
                    }
                    keep
                });
                let after_count = css.states.len();
                let eliminated_count = before_count - after_count;
                report.states_eliminated += eliminated_count;

                for eliminated_state in eliminated_here {
                    report.eliminated_details.push(EliminatedDetail {
                        component: binding.clone(),
                        kind: "state".to_string(),
                        name: Some(eliminated_state.clone()),
                        reason: format!(
                            "state '{}' not in used set for component '{}'",
                            eliminated_state, binding
                        ),
                    });
                }
            }
        }
    }

    // --- Step 4: Calculate used counts ---
    report.variants_used = report.variants_total - report.variants_eliminated;
    report.states_used = report.states_total - report.states_eliminated;

    report
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract the binding name from a component_id of the form "file::binding" or
/// "path/to/file.tsx::Binding". Returns the segment after the last "::".
fn extract_binding(component_id: &str) -> &str {
    component_id
        .rfind("::")
        .map(|pos| &component_id[pos + 2..])
        .unwrap_or(component_id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::css_generator::{ComponentCss, VariantCss};
    use crate::jsx_scanner::{StateUsage, VariantUsage, UsageScanResult};
    use crate::theme_resolver::ResolvedStyles;
    use rustc_hash::{FxHashMap, FxHashSet};

    // ------------------------------------------------------------------
    // Test helpers
    // ------------------------------------------------------------------

    fn empty_styles() -> ResolvedStyles {
        ResolvedStyles {
            declarations: vec![],
            pseudo_selectors: vec![],
            responsive: vec![],
            responsive_pseudos: vec![],
        }
    }

    /// Build a simple ComponentCss with named variants and states.
    fn make_component(
        class_name: &str,
        variant_prop: &str,
        options: &[&str],
        states: &[&str],
    ) -> ComponentCss {
        ComponentCss {
            class_name: class_name.to_string(),
            base: None,
            variants: if options.is_empty() {
                vec![]
            } else {
                vec![VariantCss {
                    prop: variant_prop.to_string(),
                    default_option: None,
                    options: options
                        .iter()
                        .map(|o| (o.to_string(), empty_styles()))
                        .collect(),
                }]
            },
            compounds: vec![],
            states: states
                .iter()
                .map(|s| (s.to_string(), empty_styles()))
                .collect(),
        }
    }

    fn make_ledger_with_variants(
        binding: &str,
        prop: &str,
        used_options: &[&str],
    ) -> UsageLedger {
        let mut ledger = UsageLedger::default();
        ledger.rendered_components.insert(binding.to_string());
        let used: FxHashSet<String> = used_options.iter().map(|s| s.to_string()).collect();
        ledger
            .variant_usage
            .entry(binding.to_string())
            .or_default()
            .insert(prop.to_string(), used);
        ledger
    }

    fn make_ledger_with_states(binding: &str, used_states: &[&str]) -> UsageLedger {
        let mut ledger = UsageLedger::default();
        ledger.rendered_components.insert(binding.to_string());
        let used: FxHashSet<String> = used_states.iter().map(|s| s.to_string()).collect();
        ledger.state_usage.insert(binding.to_string(), used);
        ledger
    }

    // ------------------------------------------------------------------
    // eliminates_unused_variant_option
    // ------------------------------------------------------------------
    #[test]
    fn eliminates_unused_variant_option() {
        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill", "stroke"], &[]),
        )];
        let ledger = make_ledger_with_variants("Button", "variant", &["stroke"]);
        let parents: FxHashSet<String> = FxHashSet::default();

        let report = reconcile(&mut components, &ledger, &parents);

        let remaining_options: Vec<&str> = components[0]
            .1
            .variants[0]
            .options
            .iter()
            .map(|(n, _)| n.as_str())
            .collect();
        assert!(!remaining_options.contains(&"fill"), "fill should be eliminated");
        assert!(remaining_options.contains(&"stroke"), "stroke should be kept");
        assert_eq!(report.variants_eliminated, 1);
        assert_eq!(report.variants_used, 1);
    }

    // ------------------------------------------------------------------
    // keeps_all_options_when_all_used
    // ------------------------------------------------------------------
    #[test]
    fn keeps_all_options_when_all_used() {
        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill", "stroke"], &[]),
        )];
        let ledger = make_ledger_with_variants("Button", "variant", &["fill", "stroke"]);
        let parents: FxHashSet<String> = FxHashSet::default();

        let report = reconcile(&mut components, &ledger, &parents);

        assert_eq!(components[0].1.variants[0].options.len(), 2);
        assert_eq!(report.variants_eliminated, 0);
        assert_eq!(report.variants_used, 2);
    }

    // ------------------------------------------------------------------
    // eliminates_unused_state
    // ------------------------------------------------------------------
    #[test]
    fn eliminates_unused_state() {
        let mut components = vec![(
            "src/Layout.tsx::Layout".to_string(),
            make_component("animus-Layout-xyz", "variant", &[], &["loading", "sidebar"]),
        )];
        let ledger = make_ledger_with_states("Layout", &["sidebar"]);
        let parents: FxHashSet<String> = FxHashSet::default();

        let report = reconcile(&mut components, &ledger, &parents);

        let remaining_states: Vec<&str> = components[0]
            .1
            .states
            .iter()
            .map(|(n, _)| n.as_str())
            .collect();
        assert!(!remaining_states.contains(&"loading"), "loading should be eliminated");
        assert!(remaining_states.contains(&"sidebar"), "sidebar should be kept");
        assert_eq!(report.states_eliminated, 1);
        assert_eq!(report.states_used, 1);
    }

    // ------------------------------------------------------------------
    // eliminates_entire_unused_component
    // ------------------------------------------------------------------
    #[test]
    fn eliminates_entire_unused_component() {
        let mut components = vec![(
            "src/Ghost.tsx::Ghost".to_string(),
            make_component("animus-Ghost-nnn", "variant", &["fill"], &["loading"]),
        )];
        // Ledger has no rendered components, no parents
        let ledger = UsageLedger::default();
        let parents: FxHashSet<String> = FxHashSet::default();

        let report = reconcile(&mut components, &ledger, &parents);

        assert!(components.is_empty(), "Ghost should be eliminated entirely");
        assert_eq!(report.components_eliminated, 1);
        assert_eq!(report.components_extracted, 0);
    }

    // ------------------------------------------------------------------
    // keeps_parent_component_even_if_not_rendered
    // ------------------------------------------------------------------
    #[test]
    fn keeps_parent_component_even_if_not_rendered() {
        let mut components = vec![(
            "src/Base.tsx::Base".to_string(),
            make_component("animus-Base-ppp", "variant", &["fill"], &[]),
        )];
        let ledger = UsageLedger::default(); // Base is NOT in rendered_components
        let mut parents: FxHashSet<String> = FxHashSet::default();
        parents.insert("Base".to_string());

        reconcile(&mut components, &ledger, &parents);

        assert_eq!(components.len(), 1, "Base should be kept because it is a parent");
    }

    // ------------------------------------------------------------------
    // default_variant_kept_via_ledger
    // ------------------------------------------------------------------
    #[test]
    fn default_variant_kept_via_ledger() {
        // Build a scan result with __default__ usage → build_ledger resolves to "fill"
        let mut variant_configs: FxHashMap<String, FxHashMap<String, (FxHashSet<String>, Option<String>)>> =
            FxHashMap::default();
        let options: FxHashSet<String> =
            ["fill", "stroke"].iter().map(|s| s.to_string()).collect();
        variant_configs
            .entry("Button".to_string())
            .or_default()
            .insert("variant".to_string(), (options, Some("fill".to_string())));

        let scan_result = UsageScanResult {
            system_prop_usages: vec![],
            dynamic_prop_usages: vec![],
            variant_usages: vec![VariantUsage {
                component_binding: "Button".to_string(),
                variant_prop: "variant".to_string(),
                value: "__default__".to_string(),
            }],
            state_usages: vec![],
            rendered_components: {
                let mut s = FxHashSet::default();
                s.insert("Button".to_string());
                s
            },
        };

        let ledger = build_ledger(&[scan_result], &variant_configs);

        // "fill" (the default) should be in the used set
        let used = &ledger.variant_usage["Button"]["variant"];
        assert!(used.contains("fill"), "default option 'fill' should be in used set");
        assert!(!used.contains("stroke"), "stroke was not used");

        // Now reconcile: only fill kept
        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill", "stroke"], &[]),
        )];
        let parents: FxHashSet<String> = FxHashSet::default();
        reconcile(&mut components, &ledger, &parents);

        let remaining: Vec<&str> = components[0]
            .1
            .variants[0]
            .options
            .iter()
            .map(|(n, _)| n.as_str())
            .collect();
        assert!(remaining.contains(&"fill"));
        assert!(!remaining.contains(&"stroke"));
    }

    // ------------------------------------------------------------------
    // dynamic_variant_keeps_all_options
    // ------------------------------------------------------------------
    #[test]
    fn dynamic_variant_keeps_all_options() {
        // __dynamic__ expands to all options in the config
        let mut variant_configs: FxHashMap<String, FxHashMap<String, (FxHashSet<String>, Option<String>)>> =
            FxHashMap::default();
        let options: FxHashSet<String> =
            ["fill", "stroke"].iter().map(|s| s.to_string()).collect();
        variant_configs
            .entry("Button".to_string())
            .or_default()
            .insert("variant".to_string(), (options, None));

        let scan_result = UsageScanResult {
            system_prop_usages: vec![],
            dynamic_prop_usages: vec![],
            variant_usages: vec![VariantUsage {
                component_binding: "Button".to_string(),
                variant_prop: "variant".to_string(),
                value: "__dynamic__".to_string(),
            }],
            state_usages: vec![],
            rendered_components: {
                let mut s = FxHashSet::default();
                s.insert("Button".to_string());
                s
            },
        };

        let ledger = build_ledger(&[scan_result], &variant_configs);

        let used = &ledger.variant_usage["Button"]["variant"];
        assert!(used.contains("fill"));
        assert!(used.contains("stroke"));

        // Reconcile — both options kept since both are in used set
        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill", "stroke"], &[]),
        )];
        let parents: FxHashSet<String> = FxHashSet::default();
        let report = reconcile(&mut components, &ledger, &parents);

        assert_eq!(components[0].1.variants[0].options.len(), 2);
        assert_eq!(report.variants_eliminated, 0);
    }

    // ------------------------------------------------------------------
    // report_counts_correct
    // ------------------------------------------------------------------
    #[test]
    fn report_counts_correct() {
        // 2 components: Button (2 variants fill/stroke, no states) and Layout (no variants, 2 states loading/sidebar)
        // Ledger: Button rendered, only stroke used. Layout rendered, only sidebar used.
        let mut components = vec![
            (
                "src/Button.tsx::Button".to_string(),
                make_component("animus-Button-abc", "variant", &["fill", "stroke"], &[]),
            ),
            (
                "src/Layout.tsx::Layout".to_string(),
                make_component("animus-Layout-xyz", "", &[], &["loading", "sidebar"]),
            ),
        ];

        let mut ledger = UsageLedger::default();
        ledger.rendered_components.insert("Button".to_string());
        ledger.rendered_components.insert("Layout".to_string());
        let mut button_used: FxHashSet<String> = FxHashSet::default();
        button_used.insert("stroke".to_string());
        ledger
            .variant_usage
            .entry("Button".to_string())
            .or_default()
            .insert("variant".to_string(), button_used);
        let mut layout_used: FxHashSet<String> = FxHashSet::default();
        layout_used.insert("sidebar".to_string());
        ledger.state_usage.insert("Layout".to_string(), layout_used);

        let parents: FxHashSet<String> = FxHashSet::default();
        let report = reconcile(&mut components, &ledger, &parents);

        assert_eq!(report.components_total, 2);
        assert_eq!(report.components_extracted, 2);
        assert_eq!(report.components_eliminated, 0);
        assert_eq!(report.variants_total, 2);   // fill + stroke
        assert_eq!(report.variants_used, 1);    // stroke
        assert_eq!(report.variants_eliminated, 1); // fill
        assert_eq!(report.states_total, 2);     // loading + sidebar
        assert_eq!(report.states_used, 1);      // sidebar
        assert_eq!(report.states_eliminated, 1); // loading
    }

    // ------------------------------------------------------------------
    // conservative_when_no_usage_data
    // ------------------------------------------------------------------
    #[test]
    fn conservative_when_no_usage_data() {
        // Component is in rendered_components but has NO variant or state usage entries.
        // All variants and states should be kept (conservative).
        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill", "stroke"], &["loading"]),
        )];
        let mut ledger = UsageLedger::default();
        ledger.rendered_components.insert("Button".to_string());
        // No variant_usage or state_usage entries for Button

        let parents: FxHashSet<String> = FxHashSet::default();
        let report = reconcile(&mut components, &ledger, &parents);

        assert_eq!(components[0].1.variants[0].options.len(), 2, "all variant options kept");
        assert_eq!(components[0].1.states.len(), 1, "all states kept");
        assert_eq!(report.variants_eliminated, 0);
        assert_eq!(report.states_eliminated, 0);
    }
}
