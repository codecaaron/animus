//! Forced-emission overrides (spec: static-emission-overrides).
//!
//! Parses the `staticCss` declaration (EngineOptions `static_css_json`) and
//! synthesizes USAGE — a `UsageScanResult` fed to the ordinary ledger, plus
//! utility/custom-dynamic stream entries — so forced styles survive
//! reconciliation through the exact machinery observed JSX usage uses.
//! There is no parallel generator: wildcard variants ride the ledger's
//! `"__dynamic__"` expansion, wildcard states enumerate the component's
//! declared set, system-prop values enter the utility stream verbatim.
//!
//! Unmatched names warn (kind `"warn"` diagnostics) and never fail the
//! build. Synthesis is deterministic: maps are iterated in sorted order.

use rustc_hash::{FxHashMap, FxHashSet};
use serde::Deserialize;
use serde_json::Value;

use crate::analyze_css::CssDiagnostic;
use crate::jsx_scan::{
    ComponentUsageConfig, DynamicPropUsage, StateUsage, SystemPropUsage, UsageScanResult,
    VariantUsage,
};
use crate::reconcile::{EliminatedDetail, UsageLedger};

/// Pseudo-file attributed to staticCss diagnostics.
const STATIC_CSS_SOURCE: &str = "staticCss";

// ---------------------------------------------------------------------------
// Declaration schema (camelCase JSON from the plugins)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StaticCssConfig {
    pub components: FxHashMap<String, ComponentOverride>,
    pub system_props: FxHashMap<String, Vec<Value>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ComponentOverride {
    pub variants: Option<VariantsOverride>,
    pub states: Option<ListOrAll>,
    pub dynamic_props: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum VariantsOverride {
    /// `'*'` — every option of every declared variant prop.
    All(String),
    /// Per-prop: `'*'` or an explicit option list.
    PerProp(FxHashMap<String, ListOrAll>),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ListOrAll {
    All(String),
    List(Vec<String>),
}

impl StaticCssConfig {
    pub fn parse(json: &str) -> Result<Self, String> {
        let trimmed = json.trim();
        if trimmed.is_empty() || trimmed == "null" {
            return Ok(Self::default());
        }
        serde_json::from_str(trimmed).map_err(|e| format!("invalid staticCss JSON: {}", e))
    }

    pub fn is_empty(&self) -> bool {
        self.components.is_empty() && self.system_props.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Injection result
// ---------------------------------------------------------------------------

/// Flat forced counts + labeled detail rows, merged into the
/// `ReconciliationReport` by the caller (spec: extraction-report).
#[derive(Debug, Clone, Default)]
pub struct ForcedReport {
    pub components_forced: usize,
    pub variants_forced: usize,
    pub states_forced: usize,
    pub details: Vec<EliminatedDetail>,
}

#[derive(Debug, Default)]
pub struct ForcedInjection {
    /// Synthetic usage appended to the per-file scan results before
    /// `build_ledger` (variants/states/rendered membership).
    pub scan: UsageScanResult,
    /// Forced system-prop `(prop, value)` pairs for the utility stream.
    pub utility_values: Vec<(String, Value)>,
    /// Forced per-component custom dynamic slots.
    pub custom_dynamic: Vec<DynamicPropUsage>,
    /// Component bindings to include in identity reachability (activity
    /// floors for their system props).
    pub forced_bindings: Vec<String>,
    /// `kind: "warn"` diagnostics for unmatched declarations.
    pub warnings: Vec<CssDiagnostic>,
    pub report: ForcedReport,
}

/// Merge forced counts + labeled detail rows into the reconciliation
/// report (both dev and prod report paths).
pub fn merge_into_report(
    report: &mut crate::reconcile::ReconciliationReport,
    forced: &ForcedReport,
) {
    report.components_forced = forced.components_forced;
    report.variants_forced = forced.variants_forced;
    report.states_forced = forced.states_forced;
    report
        .eliminated_details
        .extend(forced.details.iter().cloned());
}

fn warn(warnings: &mut Vec<CssDiagnostic>, component: &str, message: String) {
    warnings.push(CssDiagnostic {
        file: STATIC_CSS_SOURCE.to_string(),
        component: component.to_string(),
        kind: "warn".to_string(),
        message,
    });
}

fn sorted_keys<V>(map: &FxHashMap<String, V>) -> Vec<&String> {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    keys
}

fn is_star(s: &str) -> bool {
    s == "*"
}

/// Build the synthetic injection for a parsed declaration.
///
/// `known_bindings` — every evaluated component binding (existence check).
/// `usage_configs` — binding → EVERY declared variant/state (wildcard bounds
///   and existence checks). Variants without a `default_option` are declared
///   but never participate in usage reconciliation (reconcile keeps props
///   with no ledger entry in full), so no synthetic usage is pushed for them
///   — a ledger entry would flip them from kept-in-full to
///   pruned-to-the-forced-options. They are still validated and counted.
/// `custom_props_by_binding` — binding → declared custom prop names.
/// `system_prop_exists` — membership in the system prop config.
/// `observed` — the ledger built from OBSERVED scan results only, used to
/// label/count entries that exist solely because they were forced.
pub fn build_forced_injection(
    config: &StaticCssConfig,
    known_bindings: &FxHashSet<String>,
    usage_configs: &FxHashMap<String, ComponentUsageConfig>,
    custom_props_by_binding: &FxHashMap<String, FxHashSet<String>>,
    system_prop_exists: &dyn Fn(&str) -> bool,
    observed: &UsageLedger,
) -> ForcedInjection {
    let mut out = ForcedInjection::default();

    for name in sorted_keys(&config.components) {
        let ov = &config.components[name];

        if !known_bindings.contains(name) {
            warn(
                &mut out.warnings,
                name,
                format!("staticCss names unknown component '{}'", name),
            );
            continue;
        }

        // Survival: forced components count as rendered.
        out.scan.rendered_components.insert(name.clone());
        out.forced_bindings.push(name.clone());
        if !observed.rendered_components.contains(name) {
            out.report.components_forced += 1;
            out.report.details.push(EliminatedDetail {
                component: name.clone(),
                kind: "forced".to_string(),
                name: None,
                reason: "component kept: forced by staticCss (not rendered in any analyzed file)"
                    .to_string(),
            });
        }

        let declared = usage_configs.get(name);

        // ----- variants ---------------------------------------------------
        match &ov.variants {
            None => {}
            Some(VariantsOverride::All(star)) => {
                if !is_star(star) {
                    warn(
                        &mut out.warnings,
                        name,
                        format!(
                            "staticCss variants for '{}' must be '*' or a per-prop map (got '{}')",
                            name, star
                        ),
                    );
                } else if let Some(cfg) = declared {
                    let mut props: Vec<&String> = cfg.variants.keys().collect();
                    props.sort();
                    for prop in props {
                        force_variant_prop_all(&mut out, name, prop, cfg, observed);
                    }
                } else {
                    warn(
                        &mut out.warnings,
                        name,
                        format!("staticCss forces variants on '{}', which declares none", name),
                    );
                }
            }
            Some(VariantsOverride::PerProp(per_prop)) => {
                for prop in sorted_keys(per_prop) {
                    let declared_prop =
                        declared.and_then(|cfg| cfg.variants.get(prop).map(|_| cfg));
                    let Some(cfg) = declared_prop else {
                        warn(
                            &mut out.warnings,
                            name,
                            format!(
                                "staticCss names unknown variant prop '{}' on '{}'",
                                prop, name
                            ),
                        );
                        continue;
                    };
                    match &per_prop[prop] {
                        ListOrAll::All(star) if is_star(star) => {
                            force_variant_prop_all(&mut out, name, prop, cfg, observed);
                        }
                        ListOrAll::All(other) => {
                            warn(
                                &mut out.warnings,
                                name,
                                format!(
                                    "staticCss variant list for '{}.{}' must be '*' or an array (got '{}')",
                                    name, prop, other
                                ),
                            );
                        }
                        ListOrAll::List(options) => {
                            let (declared_options, default_option) = &cfg.variants[prop];
                            for option in options {
                                if !declared_options.contains(option) {
                                    warn(
                                        &mut out.warnings,
                                        name,
                                        format!(
                                            "staticCss names unknown option '{}' for '{}.{}'",
                                            option, name, prop
                                        ),
                                    );
                                    continue;
                                }
                                // Synthetic usage only for reconciliation-
                                // participating (default-bearing) props — see
                                // the `usage_configs` doc above.
                                if default_option.is_some() {
                                    out.scan.variant_usages.push(VariantUsage {
                                        component_binding: name.clone(),
                                        variant_prop: prop.clone(),
                                        value: option.clone(),
                                    });
                                }
                                record_forced_variant(&mut out, name, prop, option, observed);
                            }
                        }
                    }
                }
            }
        }

        // ----- states -----------------------------------------------------
        match &ov.states {
            None => {}
            Some(ListOrAll::All(star)) => {
                if !is_star(star) {
                    warn(
                        &mut out.warnings,
                        name,
                        format!(
                            "staticCss states for '{}' must be '*' or an array (got '{}')",
                            name, star
                        ),
                    );
                } else if let Some(cfg) = declared {
                    let mut states: Vec<&String> = cfg.states.iter().collect();
                    states.sort();
                    for state in states {
                        push_forced_state(&mut out, name, state, observed);
                    }
                } else {
                    warn(
                        &mut out.warnings,
                        name,
                        format!("staticCss forces states on '{}', which declares none", name),
                    );
                }
            }
            Some(ListOrAll::List(states)) => {
                for state in states {
                    let declared_state = declared
                        .map(|cfg| cfg.states.contains(state))
                        .unwrap_or(false);
                    if !declared_state {
                        warn(
                            &mut out.warnings,
                            name,
                            format!("staticCss names unknown state '{}' on '{}'", state, name),
                        );
                        continue;
                    }
                    push_forced_state(&mut out, name, state, observed);
                }
            }
        }

        // ----- custom dynamic slots ---------------------------------------
        for prop in &ov.dynamic_props {
            let declared_prop = custom_props_by_binding
                .get(name)
                .map(|props| props.contains(prop))
                .unwrap_or(false);
            if !declared_prop {
                warn(
                    &mut out.warnings,
                    name,
                    format!(
                        "staticCss names unknown custom prop '{}' on '{}'",
                        prop, name
                    ),
                );
                continue;
            }
            out.custom_dynamic.push(DynamicPropUsage {
                prop_name: prop.clone(),
                binding: name.clone(),
            });
        }
    }

    // ----- system props ---------------------------------------------------
    for prop in sorted_keys(&config.system_props) {
        if !system_prop_exists(prop) {
            warn(
                &mut out.warnings,
                prop,
                format!("staticCss names unknown system prop '{}'", prop),
            );
            continue;
        }
        for value in &config.system_props[prop] {
            out.scan.system_prop_usages.push(SystemPropUsage {
                prop_name: prop.clone(),
                value: value.clone(),
                binding: STATIC_CSS_SOURCE.to_string(),
            });
            out.utility_values.push((prop.clone(), value.clone()));
        }
    }

    out
}

/// Wildcard variant forcing: the ledger's own `"__dynamic__"` expansion
/// transacts every declared option; details/counts resolve the concrete
/// options here.
fn force_variant_prop_all(
    out: &mut ForcedInjection,
    binding: &str,
    prop: &str,
    cfg: &ComponentUsageConfig,
    observed: &UsageLedger,
) {
    let (options, default_option) = &cfg.variants[prop];
    // Synthetic usage only for reconciliation-participating (default-bearing)
    // props — see the `usage_configs` doc on build_forced_injection.
    if default_option.is_some() {
        out.scan.variant_usages.push(VariantUsage {
            component_binding: binding.to_string(),
            variant_prop: prop.to_string(),
            value: "__dynamic__".to_string(),
        });
    }
    let mut sorted: Vec<&String> = options.iter().collect();
    sorted.sort();
    for option in sorted {
        record_forced_variant(out, binding, prop, option, observed);
    }
}

fn record_forced_variant(
    out: &mut ForcedInjection,
    binding: &str,
    prop: &str,
    option: &str,
    observed: &UsageLedger,
) {
    let already_observed = observed
        .variant_usage
        .get(binding)
        .and_then(|props| props.get(prop))
        .map(|set| set.contains(option))
        .unwrap_or(false);
    if !already_observed {
        out.report.variants_forced += 1;
        out.report.details.push(EliminatedDetail {
            component: binding.to_string(),
            kind: "forced".to_string(),
            name: Some(option.to_string()),
            reason: format!(
                "variant option '{}' on prop '{}' kept: forced by staticCss",
                option, prop
            ),
        });
    }
}

fn push_forced_state(
    out: &mut ForcedInjection,
    binding: &str,
    state: &str,
    observed: &UsageLedger,
) {
    out.scan.state_usages.push(StateUsage {
        component_binding: binding.to_string(),
        state_name: state.to_string(),
    });
    let already_observed = observed
        .state_usage
        .get(binding)
        .map(|set| set.contains(state))
        .unwrap_or(false);
    if !already_observed {
        out.report.states_forced += 1;
        out.report.details.push(EliminatedDetail {
            component: binding.to_string(),
            kind: "forced".to_string(),
            name: Some(state.to_string()),
            reason: "state kept: forced by staticCss".to_string(),
        });
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn usage_config(
        variants: &[(&str, &[&str], Option<&str>)],
        states: &[&str],
    ) -> ComponentUsageConfig {
        let mut cfg = ComponentUsageConfig {
            variants: FxHashMap::default(),
            states: FxHashSet::default(),
        };
        for (prop, options, default) in variants {
            cfg.variants.insert(
                prop.to_string(),
                (
                    options.iter().map(|o| o.to_string()).collect(),
                    default.map(|d| d.to_string()),
                ),
            );
        }
        for s in states {
            cfg.states.insert(s.to_string());
        }
        cfg
    }

    type Harness = (
        FxHashSet<String>,
        FxHashMap<String, ComponentUsageConfig>,
        FxHashMap<String, FxHashSet<String>>,
    );

    fn harness() -> Harness {
        let known: FxHashSet<String> = ["Button".to_string(), "Card".to_string()]
            .into_iter()
            .collect();
        let mut configs = FxHashMap::default();
        configs.insert(
            "Button".to_string(),
            usage_config(
                &[("variant", &["fill", "stroke", "ghost"], Some("fill"))],
                &["disabled", "loading"],
            ),
        );
        // Declared variant WITHOUT a default_option: never participates in
        // usage reconciliation, but must still be forceable by name.
        configs.insert(
            "Card".to_string(),
            usage_config(&[("tone", &["light", "dark"], None)], &[]),
        );
        let mut custom = FxHashMap::default();
        let mut button_props = FxHashSet::default();
        button_props.insert("size".to_string());
        custom.insert("Button".to_string(), button_props);
        (known, configs, custom)
    }

    fn build(config_json: &str) -> ForcedInjection {
        let (known, configs, custom) = harness();
        let config = StaticCssConfig::parse(config_json).unwrap();
        build_forced_injection(
            &config,
            &known,
            &configs,
            &custom,
            &|p| p == "p" || p == "mt",
            &UsageLedger::default(),
        )
    }

    #[test]
    fn empty_config_is_a_no_op() {
        let injection = build("{}");
        assert!(injection.scan.variant_usages.is_empty());
        assert!(injection.scan.rendered_components.is_empty());
        assert!(injection.utility_values.is_empty());
        assert!(injection.warnings.is_empty());
        assert_eq!(injection.report.components_forced, 0);
    }

    #[test]
    fn explicit_variant_list_injects_literals_and_labels() {
        let injection = build(
            r#"{"components":{"Button":{"variants":{"variant":["ghost"]}}}}"#,
        );
        assert_eq!(injection.scan.variant_usages.len(), 1);
        assert_eq!(injection.scan.variant_usages[0].value, "ghost");
        assert!(injection.scan.rendered_components.contains("Button"));
        assert_eq!(injection.report.variants_forced, 1);
        assert_eq!(injection.report.components_forced, 1);
        assert!(injection
            .report
            .details
            .iter()
            .any(|d| d.kind == "forced" && d.name.as_deref() == Some("ghost")));
    }

    #[test]
    fn wildcard_variants_use_dynamic_expansion_and_count_all_options() {
        let injection = build(r#"{"components":{"Button":{"variants":"*"}}}"#);
        assert_eq!(injection.scan.variant_usages.len(), 1);
        assert_eq!(injection.scan.variant_usages[0].value, "__dynamic__");
        assert_eq!(injection.report.variants_forced, 3);
    }

    #[test]
    fn no_default_variant_is_forced_without_synthetic_usage() {
        let injection =
            build(r#"{"components":{"Card":{"variants":{"tone":["light"]}}}}"#);
        // Declared-but-defaultless is NOT unknown.
        assert!(injection.warnings.is_empty());
        assert_eq!(injection.report.variants_forced, 1);
        assert!(injection.scan.rendered_components.contains("Card"));
        // No ledger entry may be created: synthetic usage would flip the
        // no-default variant from kept-in-full to pruned-to-forced.
        assert!(injection.scan.variant_usages.is_empty());
    }

    #[test]
    fn wildcard_covers_no_default_variants_without_synthetic_usage() {
        let injection = build(r#"{"components":{"Card":{"variants":"*"}}}"#);
        assert!(injection.warnings.is_empty());
        assert_eq!(injection.report.variants_forced, 2);
        assert!(injection.scan.variant_usages.is_empty());
    }

    #[test]
    fn wildcard_states_enumerate_declared_set() {
        let injection = build(r#"{"components":{"Button":{"states":"*"}}}"#);
        let mut names: Vec<&str> = injection
            .scan
            .state_usages
            .iter()
            .map(|s| s.state_name.as_str())
            .collect();
        names.sort();
        assert_eq!(names, vec!["disabled", "loading"]);
        assert_eq!(injection.report.states_forced, 2);
    }

    #[test]
    fn system_prop_values_feed_the_utility_stream_verbatim() {
        let injection =
            build(r#"{"systemProps":{"p":[4,{"_":8,"sm":16}]}}"#);
        assert_eq!(injection.utility_values.len(), 2);
        assert_eq!(injection.utility_values[0].0, "p");
        assert!(injection.utility_values[1].1.is_object());
    }

    #[test]
    fn custom_dynamic_props_inject_dynamic_usage() {
        let injection =
            build(r#"{"components":{"Button":{"dynamicProps":["size"]}}}"#);
        assert_eq!(injection.custom_dynamic.len(), 1);
        assert_eq!(injection.custom_dynamic[0].prop_name, "size");
        assert_eq!(injection.custom_dynamic[0].binding, "Button");
    }

    #[test]
    fn unmatched_names_warn_and_never_fail() {
        let injection = build(
            r#"{"components":{"Buton":{"variants":"*"},"Button":{"variants":{"nope":["x"],"variant":["nope"]},"states":["missing"],"dynamicProps":["ghost"]}},"systemProps":{"zzz":[1]}}"#,
        );
        let messages: Vec<&str> = injection
            .warnings
            .iter()
            .map(|w| w.message.as_str())
            .collect();
        assert_eq!(injection.warnings.len(), 6);
        assert!(messages.iter().any(|m| m.contains("unknown component 'Buton'")));
        assert!(messages.iter().any(|m| m.contains("unknown variant prop 'nope'")));
        assert!(messages.iter().any(|m| m.contains("unknown option 'nope'")));
        assert!(messages.iter().any(|m| m.contains("unknown state 'missing'")));
        assert!(messages.iter().any(|m| m.contains("unknown custom prop 'ghost'")));
        assert!(messages.iter().any(|m| m.contains("unknown system prop 'zzz'")));
        // The valid component membership still applied.
        assert!(injection.scan.rendered_components.contains("Button"));
    }

    #[test]
    fn observed_usage_suppresses_forced_labels() {
        let (known, configs, custom) = harness();
        let mut observed = UsageLedger::default();
        observed.rendered_components.insert("Button".to_string());
        observed
            .variant_usage
            .entry("Button".to_string())
            .or_default()
            .entry("variant".to_string())
            .or_default()
            .insert("ghost".to_string());

        let config = StaticCssConfig::parse(
            r#"{"components":{"Button":{"variants":{"variant":["ghost"]}}}}"#,
        )
        .unwrap();
        let injection = build_forced_injection(
            &config,
            &known,
            &configs,
            &custom,
            &|_| false,
            &observed,
        );
        // Usage still injected (harmless union) but nothing labeled forced.
        assert_eq!(injection.scan.variant_usages.len(), 1);
        assert_eq!(injection.report.variants_forced, 0);
        assert_eq!(injection.report.components_forced, 0);
        assert!(injection.report.details.is_empty());
    }

    #[test]
    fn synthesis_is_deterministic() {
        let json = r#"{"components":{"Button":{"variants":"*","states":"*"},"Card":{}},"systemProps":{"p":[1,2],"mt":[3]}}"#;
        let a = build(json);
        let b = build(json);
        assert_eq!(
            serde_json::to_string(&a.scan).unwrap(),
            serde_json::to_string(&b.scan).unwrap()
        );
        assert_eq!(a.utility_values, b.utility_values);
    }
}
