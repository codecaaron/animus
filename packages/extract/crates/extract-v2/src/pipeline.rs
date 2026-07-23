//! Per-component pipeline over FACTS (row 07 Task 07.6): v1
//! `process_chain`'s post-eval half, reimplemented over ChainFacts — the
//! evaluation already happened eagerly in facts.rs, so this consumes
//! stage VALUES (no source, no spans, no re-parse; G1).
//!
//! Bug-compat mirror of packages/extract/src/lib.rs process_chain
//! (~396-660): styles/variant/compound/states/system/props handling,
//! variant base-merge semantics, positional compound classes, group
//! expansion, PropConfigMap parsing with captured-transform injection,
//! and the ComponentCss/tail assembly.

use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::Value;

use crate::css::{ComponentCss, VariantCss};
use crate::facts::{ChainFacts, StageFacts};
use crate::theme::{
    merge_pseudo_selectors, resolve_styles, ConditionEmitOrder, CssDeclaration, PropConfigMap,
    ResolveContext, ResolvedStyles,
};

/// Facts-level ComponentReplacement precursor (emission/config fields the
/// cross-file phases fill later, mirroring v1's staged population).
#[derive(Debug, Clone)]
pub struct ComponentPipelineOutput {
    pub component_css: ComponentCss,
    pub active_prop_names: Option<FxHashSet<String>>,
    pub active_group_names: Vec<String>,
    pub custom_prop_configs: Option<PropConfigMap>,
    pub skip_warnings: Vec<String>,
}

#[derive(Default)]
struct PipelineState {
    base_styles: Option<ResolvedStyles>,
    variant_css_list: Vec<VariantCss>,
    compound_css_list: Vec<ResolvedStyles>,
    state_css_list: Vec<(String, ResolvedStyles)>,
    active_prop_names: Option<FxHashSet<String>>,
    active_group_names: Vec<String>,
    custom_prop_configs: Option<PropConfigMap>,
    skip_warnings: Vec<String>,
}

impl PipelineState {
    fn finish(self, class_name: String) -> ComponentPipelineOutput {
        ComponentPipelineOutput {
            component_css: ComponentCss {
                class_name,
                base: self.base_styles,
                variants: self.variant_css_list,
                compounds: self.compound_css_list,
                states: self.state_css_list,
            },
            active_prop_names: self.active_prop_names,
            active_group_names: self.active_group_names,
            custom_prop_configs: self.custom_prop_configs,
            skip_warnings: self.skip_warnings,
        }
    }
}

/// Err carries `(failing stage method, detail)` so the caller (analyze_css
/// Phase 5a) can emit a bail diagnostic naming file, binding, and failing
/// stage (extract-quirk-shed inc 02 — v1 967-969 discards the error).
pub fn process_chain_facts(
    chain: &ChainFacts,
    ctx: &ResolveContext,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Result<ComponentPipelineOutput, (String, String)> {
    let mut state = PipelineState::default();
    let binding = &chain.descriptor.binding;

    for stage in &chain.stages {
        process_stage(&mut state, stage, binding, ctx, group_registry)?;
    }

    Ok(state.finish(chain.class_name.clone()))
}

fn process_stage(
    state: &mut PipelineState,
    stage: &StageFacts,
    binding: &str,
    ctx: &ResolveContext,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Result<(), (String, String)> {
    if let Some(err) = &stage.eval_error {
        return Err((stage.method.clone(), err.clone()));
    }
    state
        .skip_warnings
        .extend(stage.skipped.iter().map(|(key, reason)| {
            format!("[skip] {}: property '{}' — {}", binding, key, reason)
        }));
    let Some(value) = &stage.value else {
        return Ok(());
    };

    match stage.method.as_str() {
        "styles" => state.base_styles = Some(resolve_styles(value, ctx, true)),
        "variant" => state.variant_css_list.push(resolve_variant_stage(value, ctx)),
        "compound" => {
            if let Some(styles) = &stage.second_value {
                state
                    .compound_css_list
                    .push(resolve_styles(styles, ctx, false));
            }
        }
        "states" => state.state_css_list.extend(resolve_state_stage(value, ctx)),
        "system" => apply_system_stage(state, value, ctx, group_registry),
        "props" => {
            if let Some(config) = resolve_props_stage(stage, value)? {
                state.custom_prop_configs = Some(config);
            }
        }
        _ => {}
    }
    Ok(())
}

fn resolve_variant_stage(value: &Value, ctx: &ResolveContext) -> VariantCss {
    // Facts carry {prop, defaultVariant, base, variants} from the verbatim
    // parse_variant_arg.
    let base = value
        .get("base")
        .filter(|candidate| !candidate.is_null())
        .map(|candidate| resolve_styles(candidate, ctx, false));
    let options = value["variants"]
        .as_object()
        .into_iter()
        .flat_map(|variants| variants.iter())
        .map(|(name, styles)| {
            let resolved = resolve_styles(styles, ctx, false);
            (name.clone(), merge_variant_base(resolved, base.as_ref()))
        })
        .collect();

    VariantCss {
        prop: value["prop"].as_str().unwrap_or("variant").to_string(),
        options,
        default_option: value
            .get("defaultVariant")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn merge_variant_base(
    mut resolved: ResolvedStyles,
    base: Option<&ResolvedStyles>,
) -> ResolvedStyles {
    let Some(base) = base else {
        return resolved;
    };

    let mut merged_declarations = base.declarations.clone();
    merged_declarations.append(&mut resolved.declarations);
    resolved.declarations = merged_declarations;
    for (selector, declarations) in &base.pseudo_selectors {
        merge_pseudo_selectors(
            &mut resolved.pseudo_selectors,
            selector.clone(),
            declarations.clone(),
        );
    }
    // Iterate the base breakpoint groups directly (reviewer R9): `base` and
    // `resolved` are disjoint borrows, so the intermediate owned clone the
    // earlier code collected was unnecessary. `merge_responsive_base` copies
    // per-group via `to_vec`, so no borrow of `base` outlives the loop body.
    for (breakpoint, declarations) in base.breakpoint_groups() {
        merge_responsive_base(&mut resolved, breakpoint, declarations);
    }
    // Carry the base's condition groups into each option — a variant
    // `base`'s condition block would otherwise be dropped from every option
    // (spec: "Condition block in a variant"). D4's no-cross-rule-merge
    // choice makes a plain append cascade-correct; the emission sorter
    // re-orders by kind/registry/source. Selectorless single-breakpoint
    // groups already merged via `breakpoint_groups()` above; everything
    // else — non-breakpoint groups AND `[Breakpoint]`+selector groups
    // (responsive maps inside selector blocks, inc 05 review F2) — appends.
    for group in &base.conditioned {
        let is_plain_breakpoint = matches!(group.emit_order, ConditionEmitOrder::Breakpoint)
            && group.selector.is_none()
            && group.conditions.len() == 1;
        if !is_plain_breakpoint {
            resolved.conditioned.push(group.clone());
        }
    }
    resolved
}

fn merge_responsive_base(
    resolved: &mut ResolvedStyles,
    breakpoint: &str,
    declarations: &[CssDeclaration],
) {
    // Base declarations sort before existing ones within the breakpoint group.
    let existing = resolved.breakpoint_decls_mut(breakpoint);
    let mut merged = declarations.to_vec();
    merged.append(existing);
    *existing = merged;
}

fn resolve_state_stage(value: &Value, ctx: &ResolveContext) -> Vec<(String, ResolvedStyles)> {
    value
        .as_object()
        .into_iter()
        .flat_map(|states| states.iter())
        .map(|(name, styles)| (name.clone(), resolve_styles(styles, ctx, false)))
        .collect()
}

fn resolve_system_stage(
    value: &Value,
    ctx: &ResolveContext,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Option<(Option<FxHashSet<String>>, Vec<String>)> {
    let system_map = value.as_object()?;
    let mut props = FxHashSet::default();
    let mut group_names = Vec::new();
    for key in system_map.keys() {
        if let Some(group_props) = group_registry.get(key) {
            group_names.push(key.clone());
            props.extend(group_props.iter().cloned());
        } else if ctx.config.contains_key(key) {
            props.insert(key.clone());
        }
    }
    group_names.sort();
    Some(((!props.is_empty()).then_some(props), group_names))
}

fn apply_system_stage(
    state: &mut PipelineState,
    value: &Value,
    ctx: &ResolveContext,
    group_registry: &FxHashMap<String, Vec<String>>,
) {
    let Some((props, groups)) = resolve_system_stage(value, ctx, group_registry) else {
        return;
    };
    if let Some(props) = props {
        state.active_prop_names = Some(props);
    }
    state.active_group_names = groups;
}

fn resolve_props_stage(
    stage: &StageFacts,
    value: &Value,
) -> Result<Option<PropConfigMap>, (String, String)> {
    let mut parsed: PropConfigMap = serde_json::from_value(value.clone()).map_err(|error| {
        (
            stage.method.clone(),
            format!("props config parse failed: {}", error),
        )
    })?;
    for capture in &stage.captured {
        let Some(prop_name) = capture.key.split('.').next() else {
            continue;
        };
        let Some(config) = parsed.get_mut(prop_name) else {
            continue;
        };
        config.transform_fn_source = Some(capture.source.clone());
    }
    Ok((!parsed.is_empty()).then_some(parsed))
}

/// Detect `Value` shapes theme resolution can't take yet in v2 (facts may
/// carry them; the caller gates loud).
pub fn value_is_object(v: &Value) -> bool {
    v.is_object()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::extract_file_facts;
    use crate::owned_ast::{OwnedAst, ParseCounter};
    use crate::theme::{
        ConditionAliasesMap, ContextualVarsMap, FlatTheme, SelectorAliasesMap, VariableMap,
    };

    fn resolve_fixture(source: &str) -> ComponentPipelineOutput {
        let counter = ParseCounter::new(0);
        let ast = OwnedAst::parse("t.tsx".into(), source.into(), &counter);
        let facts = extract_file_facts(&ast);
        let config: PropConfigMap = serde_json::from_str(
            r#"{
              "p": {"property": "padding", "scale": "space"},
              "fontSize": {"property": "fontSize", "scale": "fontSizes"},
              "display": {"property": "display"}
            }"#,
        )
        .unwrap();
        let mut theme: FlatTheme = FlatTheme::default();
        theme.insert("space.8".into(), "0.5rem".into());
        theme.insert("fontSizes.14".into(), "0.875rem".into());
        let variable_map: VariableMap = VariableMap::default();
        let contextual: ContextualVarsMap = ContextualVarsMap::default();
        let bp: FxHashSet<String> = FxHashSet::default();
        let aliases: SelectorAliasesMap = SelectorAliasesMap::default();
        let conditions: ConditionAliasesMap = ConditionAliasesMap::default();
        let ctx = ResolveContext {
            config: &config,
            theme: &theme,
            variable_map: &variable_map,
            contextual_vars: &contextual,
            breakpoint_keys: &bp,
            selector_aliases: &aliases,
            condition_aliases: &conditions,
            transform_evaluator: None,
        };
        let registry: FxHashMap<String, Vec<String>> = FxHashMap::default();
        process_chain_facts(&facts.chains[0], &ctx, &registry).unwrap()
    }

    #[test]
    fn empty_pipeline_state_preserves_chain_identity() {
        let output = PipelineState::default().finish("anm-C".to_string());

        assert_eq!(output.component_css.class_name, "anm-C");
        assert!(output.component_css.base.is_none());
        assert!(output.component_css.variants.is_empty());
        assert!(output.component_css.compounds.is_empty());
        assert!(output.component_css.states.is_empty());
        assert!(output.active_prop_names.is_none());
        assert!(output.active_group_names.is_empty());
        assert!(output.custom_prop_configs.is_none());
        assert!(output.skip_warnings.is_empty());
    }

    #[test]
    fn styles_resolve_through_scales() {
        let out = resolve_fixture(
            "export const C = ds.styles({ p: 8, fontSize: 14, display: 'flex' }).asElement('div');",
        );
        let base = out.component_css.base.unwrap();
        let css: Vec<String> = base
            .declarations
            .iter()
            .map(|d| format!("{}: {}", d.property, d.value))
            .collect();
        assert!(css.contains(&"padding: 0.5rem".to_string()), "{css:?}");
        assert!(css.contains(&"font-size: 0.875rem".to_string()), "{css:?}");
        assert!(css.contains(&"display: flex".to_string()), "{css:?}");
    }

    #[test]
    fn variant_base_merges_into_options() {
        let out = resolve_fixture(
            r#"export const C = ds.variant({ prop: 'size', base: { display: 'flex' }, variants: { sm: { p: 8 } } }).asElement('div');"#,
        );
        let vc = &out.component_css.variants[0];
        let (name, resolved) = &vc.options[0];
        assert_eq!(name, "sm");
        let props: Vec<&str> = resolved.declarations.iter().map(|d| d.property.as_str()).collect();
        assert_eq!(props, vec!["display", "padding"], "base first, option after");
    }

    #[test]
    fn variant_base_condition_block_merges_into_each_option() {
        // media-condition-aliases: "Condition block in a variant" — a condition
        // block on the variant `base` must reach EVERY option (variants layer),
        // not be dropped by merge_variant_base.
        let out = resolve_fixture(
            r#"export const C = ds.variant({ prop: 'size', base: { '@media (prefers-reduced-motion: reduce)': { display: 'none' } }, variants: { sm: { p: 8 }, lg: { fontSize: 14 } } }).asElement('div');"#,
        );
        let vc = &out.component_css.variants[0];
        assert_eq!(vc.options.len(), 2);
        for (name, resolved) in &vc.options {
            assert_eq!(
                resolved.conditioned.len(),
                1,
                "base condition must reach option {name}"
            );
            let g = &resolved.conditioned[0];
            assert!(matches!(
                g.conditions.as_slice(),
                [crate::theme::Condition::Media(q)] if q == "@media (prefers-reduced-motion: reduce)"
            ));
            assert_eq!(g.declarations[0].property, "display");
            assert_eq!(g.declarations[0].value, "none");
        }
    }

    #[test]
    fn variant_base_carries_breakpoint_selector_groups() {
        // F2 (inc-05 review): a responsive map inside a selector block on the
        // variant `base` ([Breakpoint]+selector group) must reach every
        // option — previously silently dropped by the Breakpoint-order skip.
        use crate::theme::{Condition, ConditionEmitOrder, ConditionedGroup};
        let base = ResolvedStyles {
            declarations: vec![],
            pseudo_selectors: vec![(
                ":hover".to_string(),
                vec![CssDeclaration { property: "padding".into(), value: "0.5rem".into() }],
            )],
            conditioned: vec![ConditionedGroup {
                conditions: vec![Condition::Breakpoint("sm".into())],
                selector: Some(":hover".into()),
                declarations: vec![CssDeclaration { property: "padding".into(), value: "1rem".into() }],
                emit_order: ConditionEmitOrder::Breakpoint,
            }],
        };
        let option = ResolvedStyles::default();
        let merged = merge_variant_base(option, Some(&base));
        assert_eq!(merged.conditioned.len(), 1, "bp+selector group must carry");
        assert_eq!(merged.conditioned[0].selector.as_deref(), Some(":hover"));
        assert!(merged.pseudo_selectors.iter().any(|(s, _)| s == ":hover"));
    }

    #[test]
    fn variant_option_condition_block_resolves() {
        // The option's own condition block flows straight through resolve_styles.
        let out = resolve_fixture(
            r#"export const C = ds.variant({ prop: 'size', variants: { sm: { p: 8, '@supports (display: grid)': { display: 'flex' } } } }).asElement('div');"#,
        );
        let (_n, resolved) = &out.component_css.variants[0].options[0];
        assert_eq!(resolved.conditioned.len(), 1);
        assert!(matches!(
            resolved.conditioned[0].conditions.as_slice(),
            [crate::theme::Condition::Supports(q)] if q == "@supports (display: grid)"
        ));
        assert_eq!(resolved.conditioned[0].declarations[0].value, "flex");
    }

    #[test]
    fn system_groups_expand_and_props_parse() {
        let counter = ParseCounter::new(0);
        let ast = OwnedAst::parse(
            "t.tsx".into(),
            "export const C = ds.system({ space: true, display: true }).props({ w: { property: 'width', transform: (v) => v } }).asElement('div');"
                .into(),
            &counter,
        );
        let facts = extract_file_facts(&ast);
        let config: PropConfigMap =
            serde_json::from_str(r#"{"display": {"property": "display"}}"#).unwrap();
        let theme = FlatTheme::default();
        let variable_map = VariableMap::default();
        let contextual = ContextualVarsMap::default();
        let bp: FxHashSet<String> = FxHashSet::default();
        let aliases = SelectorAliasesMap::default();
        let conditions = ConditionAliasesMap::default();
        let ctx = ResolveContext {
            config: &config,
            theme: &theme,
            variable_map: &variable_map,
            contextual_vars: &contextual,
            breakpoint_keys: &bp,
            selector_aliases: &aliases,
            condition_aliases: &conditions,
            transform_evaluator: None,
        };
        let mut registry: FxHashMap<String, Vec<String>> = FxHashMap::default();
        registry.insert("space".into(), vec!["p".into(), "m".into()]);
        let out = process_chain_facts(&facts.chains[0], &ctx, &registry).unwrap();
        let props = out.active_prop_names.unwrap();
        assert!(props.contains("p") && props.contains("m") && props.contains("display"));
        assert_eq!(out.active_group_names, vec!["space"]);
        let cfg = out.custom_prop_configs.unwrap();
        assert!(cfg["w"].transform_fn_source.as_ref().unwrap().contains("(v) => v"));
    }

    #[test]
    fn later_empty_system_stage_preserves_active_props() {
        let output = resolve_fixture(
            "export const C = ds.system({ display: true }).system({ unknown: true }).asElement('div');",
        );

        assert!(output.active_prop_names.unwrap().contains("display"));
        assert!(output.active_group_names.is_empty());
    }
}
