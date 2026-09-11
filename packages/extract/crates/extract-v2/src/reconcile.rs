//! Usage ledger construction, and pruning of unused components, variants
//! and states. Unconditional asClass/slot rendering is the caller's job.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::css::ComponentCss;
use crate::jsx_scan::{UsageScanResult, VariantUsage};

pub type VariantConfigMap =
    FxHashMap<String, FxHashMap<String, (FxHashSet<String>, Option<String>)>>;

#[derive(Debug, Clone, Default)]
pub struct UsageLedger {
    pub rendered_components: FxHashSet<String>,
    pub variant_usage: FxHashMap<String, FxHashMap<String, FxHashSet<String>>>,
    pub state_usage: FxHashMap<String, FxHashSet<String>>,
}

pub fn build_ledger(
    all_results: &[UsageScanResult],
    variant_configs: &VariantConfigMap,
) -> UsageLedger {
    let mut ledger = UsageLedger::default();

    for result in all_results {
        for binding in &result.rendered_components {
            ledger.rendered_components.insert(binding.clone());
        }

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
                    if let Some(prop_config) = variant_configs
                        .get(component_binding)
                        .and_then(|vc| vc.get(variant_prop))
                    {
                        for option in &prop_config.0 {
                            used_set.insert(option.clone());
                        }
                    }
                }
                "__default__" => {
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

        for usage in &result.state_usages {
            ledger
                .state_usage
                .entry(usage.component_binding.clone())
                .or_default()
                .insert(usage.state_name.clone());
        }
    }

    // An empty used-set would read as "nothing used, eliminate all"; dropping
    // the entry makes it absent, which reconcile treats as "keep all".
    for prop_map in ledger.variant_usage.values_mut() {
        prop_map.retain(|_prop, used_set| !used_set.is_empty());
    }
    ledger
        .variant_usage
        .retain(|_binding, prop_map| !prop_map.is_empty());

    ledger
}

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
    pub components_forced: usize,
    pub variants_forced: usize,
    pub states_forced: usize,
    pub eliminated_details: Vec<EliminatedDetail>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EliminatedDetail {
    pub component: String,
    pub kind: String,
    pub name: Option<String>,
    pub reason: String,
}

pub fn reconcile(
    components: &mut Vec<(String, ComponentCss)>,
    ledger: &UsageLedger,
    parent_components: &FxHashSet<String>,
) -> ReconciliationReport {
    let mut report = ReconciliationReport {
        components_total: components.len(),
        ..Default::default()
    };

    for (_, css) in components.iter() {
        for variant in &css.variants {
            report.variants_total += variant.options.len();
        }
        report.states_total += css.states.len();
    }

    let mut to_remove: Vec<usize> = Vec::new();

    for (i, (component_id, css)) in components.iter().enumerate() {
        if !ledger.rendered_components.contains(component_id)
            && !parent_components.contains(component_id)
        {
            to_remove.push(i);
            report.eliminated_details.push(EliminatedDetail {
                component: extract_binding(component_id).to_string(),
                kind: "component".to_string(),
                name: None,
                reason: "component not rendered and not a parent".to_string(),
            });
            for variant in &css.variants {
                report.variants_eliminated += variant.options.len();
            }
            report.states_eliminated += css.states.len();
        }
    }

    for &i in to_remove.iter().rev() {
        components.remove(i);
    }

    report.components_eliminated = to_remove.len();
    report.components_extracted = components.len();

    for (component_id, css) in components.iter_mut() {
        let binding = extract_binding(component_id).to_string();

        for variant in css.variants.iter_mut() {
            let used_options = ledger
                .variant_usage
                .get(component_id.as_str())
                .and_then(|vu| vu.get(&variant.prop));

            match used_options {
                None => {}
                Some(used_set) => {
                    let before_count = variant.options.len();
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

        let used_states = ledger.state_usage.get(component_id.as_str());
        match used_states {
            None => {}
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

    report.variants_used = report.variants_total - report.variants_eliminated;
    report.states_used = report.states_total - report.states_eliminated;

    report
}

fn extract_binding(component_id: &str) -> &str {
    component_id
        .rfind("::")
        .map(|pos| &component_id[pos + 2..])
        .unwrap_or(component_id)
}

pub fn identify_prospective_eliminations(
    components: &[(String, ComponentCss)],
    ledger: &UsageLedger,
    parent_components: &FxHashSet<String>,
) -> Vec<EliminatedDetail> {
    let mut details = Vec::new();
    for (component_id, _css) in components.iter() {
        if !ledger.rendered_components.contains(component_id)
            && !parent_components.contains(component_id)
        {
            details.push(EliminatedDetail {
                component: extract_binding(component_id).to_string(),
                kind: "prospective_component".to_string(),
                name: None,
                reason: "component not rendered and not a parent (would be eliminated in production build)".to_string(),
            });
        }
    }
    details
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::css::{ComponentCss, VariantCss};
    use crate::jsx_scan::{UsageScanResult, VariantUsage};
    use crate::theme::ResolvedStyles;
    use rustc_hash::FxHashSet;

    fn empty_styles() -> ResolvedStyles {
        ResolvedStyles::default()
    }

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

    fn make_ledger_with_variants(binding: &str, prop: &str, used_options: &[&str]) -> UsageLedger {
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

    #[test]
    fn eliminates_unused_variant_option() {
        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill", "stroke"], &[]),
        )];
        let ledger = make_ledger_with_variants("src/Button.tsx::Button", "variant", &["stroke"]);
        let parents: FxHashSet<String> = FxHashSet::default();

        let report = reconcile(&mut components, &ledger, &parents);

        let remaining_options: Vec<&str> = components[0].1.variants[0]
            .options
            .iter()
            .map(|(n, _)| n.as_str())
            .collect();
        assert!(
            !remaining_options.contains(&"fill"),
            "fill should be eliminated"
        );
        assert!(
            remaining_options.contains(&"stroke"),
            "stroke should be kept"
        );
        assert_eq!(report.variants_eliminated, 1);
        assert_eq!(report.variants_used, 1);
    }

    #[test]
    fn keeps_all_options_when_all_used() {
        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill", "stroke"], &[]),
        )];
        let ledger =
            make_ledger_with_variants("src/Button.tsx::Button", "variant", &["fill", "stroke"]);
        let parents: FxHashSet<String> = FxHashSet::default();

        let report = reconcile(&mut components, &ledger, &parents);

        assert_eq!(components[0].1.variants[0].options.len(), 2);
        assert_eq!(report.variants_eliminated, 0);
        assert_eq!(report.variants_used, 2);
    }

    #[test]
    fn eliminates_unused_state() {
        let mut components = vec![(
            "src/Layout.tsx::Layout".to_string(),
            make_component("animus-Layout-xyz", "variant", &[], &["loading", "sidebar"]),
        )];
        let ledger = make_ledger_with_states("src/Layout.tsx::Layout", &["sidebar"]);
        let parents: FxHashSet<String> = FxHashSet::default();

        let report = reconcile(&mut components, &ledger, &parents);

        let remaining_states: Vec<&str> = components[0]
            .1
            .states
            .iter()
            .map(|(n, _)| n.as_str())
            .collect();
        assert!(
            !remaining_states.contains(&"loading"),
            "loading should be eliminated"
        );
        assert!(
            remaining_states.contains(&"sidebar"),
            "sidebar should be kept"
        );
        assert_eq!(report.states_eliminated, 1);
        assert_eq!(report.states_used, 1);
    }

    #[test]
    fn eliminates_entire_unused_component() {
        let mut components = vec![(
            "src/Ghost.tsx::Ghost".to_string(),
            make_component("animus-Ghost-nnn", "variant", &["fill"], &["loading"]),
        )];
        let ledger = UsageLedger::default();
        let parents: FxHashSet<String> = FxHashSet::default();

        let report = reconcile(&mut components, &ledger, &parents);

        assert!(components.is_empty(), "Ghost should be eliminated entirely");
        assert_eq!(report.components_eliminated, 1);
        assert_eq!(report.components_extracted, 0);
    }

    #[test]
    fn keeps_parent_component_even_if_not_rendered() {
        let mut components = vec![(
            "src/Base.tsx::Base".to_string(),
            make_component("animus-Base-ppp", "variant", &["fill"], &[]),
        )];
        let ledger = UsageLedger::default();
        let mut parents: FxHashSet<String> = FxHashSet::default();
        parents.insert("src/Base.tsx::Base".to_string());

        reconcile(&mut components, &ledger, &parents);

        assert_eq!(
            components.len(),
            1,
            "Base should be kept because it is a parent"
        );
    }

    #[test]
    fn default_variant_kept_via_ledger() {
        let mut variant_configs = VariantConfigMap::default();
        let options: FxHashSet<String> = ["fill", "stroke"].iter().map(|s| s.to_string()).collect();
        variant_configs
            .entry("src/Button.tsx::Button".to_string())
            .or_default()
            .insert("variant".to_string(), (options, Some("fill".to_string())));

        let scan_result = UsageScanResult {
            system_prop_usages: vec![],
            dynamic_prop_usages: vec![],
            residue_sites: vec![],
            variant_usages: vec![VariantUsage {
                component_binding: "src/Button.tsx::Button".to_string(),
                variant_prop: "variant".to_string(),
                value: "__default__".to_string(),
            }],
            state_usages: vec![],
            rendered_components: {
                let mut s = FxHashSet::default();
                s.insert("src/Button.tsx::Button".to_string());
                s
            },
            identity_uncertain: false,
        };

        let ledger = build_ledger(&[scan_result], &variant_configs);

        let used = &ledger.variant_usage["src/Button.tsx::Button"]["variant"];
        assert!(
            used.contains("fill"),
            "default option 'fill' should be in used set"
        );
        assert!(!used.contains("stroke"), "stroke was not used");

        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill", "stroke"], &[]),
        )];
        let parents: FxHashSet<String> = FxHashSet::default();
        reconcile(&mut components, &ledger, &parents);

        let remaining: Vec<&str> = components[0].1.variants[0]
            .options
            .iter()
            .map(|(n, _)| n.as_str())
            .collect();
        assert!(remaining.contains(&"fill"));
        assert!(!remaining.contains(&"stroke"));
    }

    #[test]
    fn dynamic_variant_keeps_all_options() {
        let mut variant_configs = VariantConfigMap::default();
        let options: FxHashSet<String> = ["fill", "stroke"].iter().map(|s| s.to_string()).collect();
        variant_configs
            .entry("src/Button.tsx::Button".to_string())
            .or_default()
            .insert("variant".to_string(), (options, None));

        let scan_result = UsageScanResult {
            system_prop_usages: vec![],
            dynamic_prop_usages: vec![],
            residue_sites: vec![],
            variant_usages: vec![VariantUsage {
                component_binding: "src/Button.tsx::Button".to_string(),
                variant_prop: "variant".to_string(),
                value: "__dynamic__".to_string(),
            }],
            state_usages: vec![],
            rendered_components: {
                let mut s = FxHashSet::default();
                s.insert("src/Button.tsx::Button".to_string());
                s
            },
            identity_uncertain: false,
        };

        let ledger = build_ledger(&[scan_result], &variant_configs);

        let used = &ledger.variant_usage["src/Button.tsx::Button"]["variant"];
        assert!(used.contains("fill"));
        assert!(used.contains("stroke"));

        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill", "stroke"], &[]),
        )];
        let parents: FxHashSet<String> = FxHashSet::default();
        let report = reconcile(&mut components, &ledger, &parents);

        assert_eq!(components[0].1.variants[0].options.len(), 2);
        assert_eq!(report.variants_eliminated, 0);
    }

    #[test]
    fn report_counts_correct() {
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
        ledger
            .rendered_components
            .insert("src/Button.tsx::Button".to_string());
        ledger
            .rendered_components
            .insert("src/Layout.tsx::Layout".to_string());
        let mut button_used: FxHashSet<String> = FxHashSet::default();
        button_used.insert("stroke".to_string());
        ledger
            .variant_usage
            .entry("src/Button.tsx::Button".to_string())
            .or_default()
            .insert("variant".to_string(), button_used);
        let mut layout_used: FxHashSet<String> = FxHashSet::default();
        layout_used.insert("sidebar".to_string());
        ledger
            .state_usage
            .insert("src/Layout.tsx::Layout".to_string(), layout_used);

        let parents: FxHashSet<String> = FxHashSet::default();
        let report = reconcile(&mut components, &ledger, &parents);

        assert_eq!(report.components_total, 2);
        assert_eq!(report.components_extracted, 2);
        assert_eq!(report.components_eliminated, 0);
        assert_eq!(report.variants_total, 2);
        assert_eq!(report.variants_used, 1);
        assert_eq!(report.variants_eliminated, 1);
        assert_eq!(report.states_total, 2);
        assert_eq!(report.states_used, 1);
        assert_eq!(report.states_eliminated, 1);
    }

    #[test]
    fn conservative_when_no_usage_data() {
        let mut components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component(
                "animus-Button-abc",
                "variant",
                &["fill", "stroke"],
                &["loading"],
            ),
        )];
        let mut ledger = UsageLedger::default();
        ledger
            .rendered_components
            .insert("src/Button.tsx::Button".to_string());

        let parents: FxHashSet<String> = FxHashSet::default();
        let report = reconcile(&mut components, &ledger, &parents);

        assert_eq!(
            components[0].1.variants[0].options.len(),
            2,
            "all variant options kept"
        );
        assert_eq!(components[0].1.states.len(), 1, "all states kept");
        assert_eq!(report.variants_eliminated, 0);
        assert_eq!(report.states_eliminated, 0);
    }

    #[test]
    fn prospective_elimination_flags_unrendered_non_parent() {
        let components = vec![(
            "src/Ghost.tsx::Ghost".to_string(),
            make_component("animus-Ghost-nnn", "variant", &["fill"], &[]),
        )];
        let ledger = UsageLedger::default();
        let parents: FxHashSet<String> = FxHashSet::default();

        let details = identify_prospective_eliminations(&components, &ledger, &parents);

        assert_eq!(details.len(), 1);
        assert_eq!(details[0].component, "Ghost");
        assert_eq!(details[0].kind, "prospective_component");
        assert!(details[0].reason.contains("would be eliminated"));
    }

    #[test]
    fn prospective_elimination_does_not_mutate_components() {
        let components = vec![(
            "src/Ghost.tsx::Ghost".to_string(),
            make_component("animus-Ghost-nnn", "variant", &["fill"], &[]),
        )];
        let ledger = UsageLedger::default();
        let parents: FxHashSet<String> = FxHashSet::default();

        let _details = identify_prospective_eliminations(&components, &ledger, &parents);

        assert_eq!(components.len(), 1, "components list must be unmodified");
        assert_eq!(components[0].0, "src/Ghost.tsx::Ghost");
    }

    #[test]
    fn prospective_elimination_skips_rendered_components() {
        let components = vec![(
            "src/Button.tsx::Button".to_string(),
            make_component("animus-Button-abc", "variant", &["fill"], &[]),
        )];
        let mut ledger = UsageLedger::default();
        ledger
            .rendered_components
            .insert("src/Button.tsx::Button".to_string());
        let parents: FxHashSet<String> = FxHashSet::default();

        let details = identify_prospective_eliminations(&components, &ledger, &parents);

        assert!(
            details.is_empty(),
            "rendered component must not appear as prospective"
        );
    }

    #[test]
    fn prospective_elimination_skips_parent_components() {
        let components = vec![(
            "src/Base.tsx::Base".to_string(),
            make_component("animus-Base-ppp", "variant", &["fill"], &[]),
        )];
        let ledger = UsageLedger::default();
        let mut parents: FxHashSet<String> = FxHashSet::default();
        parents.insert("src/Base.tsx::Base".to_string());

        let details = identify_prospective_eliminations(&components, &ledger, &parents);

        assert!(
            details.is_empty(),
            "parent components must not appear as prospective"
        );
    }

    #[test]
    fn prospective_elimination_kind_distinguishes_from_actual() {
        let components_a = vec![(
            "src/Ghost.tsx::Ghost".to_string(),
            make_component("animus-Ghost-nnn", "variant", &["fill"], &[]),
        )];
        let ledger = UsageLedger::default();
        let parents: FxHashSet<String> = FxHashSet::default();

        let prospective_details =
            identify_prospective_eliminations(&components_a, &ledger, &parents);

        let mut components_b = components_a.clone();
        let actual_report = reconcile(&mut components_b, &ledger, &parents);

        assert_eq!(prospective_details.len(), 1);
        assert_eq!(actual_report.eliminated_details.len(), 1);
        assert_eq!(prospective_details[0].kind, "prospective_component");
        assert_eq!(actual_report.eliminated_details[0].kind, "component");
        assert_eq!(
            prospective_details[0].component,
            actual_report.eliminated_details[0].component
        );
    }
}
