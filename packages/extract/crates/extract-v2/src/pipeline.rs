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
use crate::facts::ChainFacts;
use crate::theme::{
    merge_pseudo_selectors, resolve_styles, PropConfigMap, ResolveContext, ResolvedStyles,
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

/// Err carries `(failing stage method, detail)` so the caller (analyze_css
/// Phase 5a) can emit a bail diagnostic naming file, binding, and failing
/// stage (extract-quirk-shed inc 02 — v1 967-969 discards the error).
pub fn process_chain_facts(
    chain: &ChainFacts,
    ctx: &ResolveContext,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Result<ComponentPipelineOutput, (String, String)> {
    let mut base_styles: Option<ResolvedStyles> = None;
    let mut variant_css_list: Vec<VariantCss> = Vec::new();
    let mut compound_css_list: Vec<ResolvedStyles> = Vec::new();
    let mut state_css_list: Vec<(String, ResolvedStyles)> = Vec::new();
    let mut active_prop_names: Option<FxHashSet<String>> = None;
    let mut active_group_names: Vec<String> = Vec::new();
    let mut custom_prop_configs: Option<PropConfigMap> = None;
    let mut skip_warnings: Vec<String> = Vec::new();

    let binding = &chain.descriptor.binding;

    for stage in &chain.stages {
        if let Some(err) = &stage.eval_error {
            return Err((stage.method.clone(), err.clone()));
        }
        for (key, reason) in &stage.skipped {
            skip_warnings.push(format!("[skip] {}: property '{}' — {}", binding, key, reason));
        }
        let value = match &stage.value {
            Some(v) => v,
            None => continue,
        };
        match stage.method.as_str() {
            "styles" => {
                base_styles = Some(resolve_styles(value, ctx, true));
            }
            "variant" => {
                // facts carry {prop, defaultVariant, base, variants} from
                // the verbatim parse_variant_arg.
                let base_resolved = value
                    .get("base")
                    .filter(|b| !b.is_null())
                    .map(|b| resolve_styles(b, ctx, false));
                let mut options_css = Vec::new();
                if let Some(variants) = value["variants"].as_object() {
                    for (option_name, option_styles) in variants {
                        let mut resolved = resolve_styles(option_styles, ctx, false);
                        if let Some(base) = &base_resolved {
                            let mut merged_decls = base.declarations.clone();
                            merged_decls.extend(resolved.declarations);
                            resolved.declarations = merged_decls;
                            for (sel, decls) in &base.pseudo_selectors {
                                merge_pseudo_selectors(
                                    &mut resolved.pseudo_selectors,
                                    sel.clone(),
                                    decls.clone(),
                                );
                            }
                            for (bp, decls) in &base.responsive {
                                let existing =
                                    resolved.responsive.iter_mut().find(|(k, _)| k == bp);
                                if let Some((_, existing_decls)) = existing {
                                    let mut merged = decls.clone();
                                    merged.extend(existing_decls.drain(..));
                                    *existing_decls = merged;
                                } else {
                                    resolved.responsive.push((bp.clone(), decls.clone()));
                                }
                            }
                        }
                        options_css.push((option_name.clone(), resolved));
                    }
                }
                variant_css_list.push(VariantCss {
                    prop: value["prop"].as_str().unwrap_or("variant").to_string(),
                    options: options_css,
                    default_option: value
                        .get("defaultVariant")
                        .and_then(|d| d.as_str())
                        .map(|s| s.to_string()),
                });
            }
            "compound" => {
                if let Some(styles) = &stage.second_value {
                    compound_css_list.push(resolve_styles(styles, ctx, false));
                }
            }
            "states" => {
                if let Some(states_map) = value.as_object() {
                    for (state_name, state_styles) in states_map {
                        state_css_list
                            .push((state_name.clone(), resolve_styles(state_styles, ctx, false)));
                    }
                }
            }
            "system" => {
                if let Some(system_map) = value.as_object() {
                    let mut props: FxHashSet<String> = FxHashSet::default();
                    let mut group_names: Vec<String> = Vec::new();
                    for key in system_map.keys() {
                        if let Some(group_props) = group_registry.get(key) {
                            group_names.push(key.clone());
                            for prop in group_props {
                                props.insert(prop.clone());
                            }
                        } else if ctx.config.contains_key(key) {
                            props.insert(key.clone());
                        }
                    }
                    group_names.sort();
                    if !props.is_empty() {
                        active_prop_names = Some(props);
                    }
                    active_group_names = group_names;
                }
            }
            "props" => {
                let mut parsed: PropConfigMap =
                    serde_json::from_value(value.clone()).map_err(|e| {
                        (stage.method.clone(), format!("props config parse failed: {}", e))
                    })?;
                for capture in &stage.captured {
                    if let Some(prop_name) = capture.key.split('.').next() {
                        if let Some(config) = parsed.get_mut(prop_name) {
                            config.transform_fn_source = Some(capture.source.clone());
                        }
                    }
                }
                if !parsed.is_empty() {
                    custom_prop_configs = Some(parsed);
                }
            }
            _ => {}
        }
    }

    Ok(ComponentPipelineOutput {
        component_css: ComponentCss {
            class_name: chain.class_name.clone(),
            base: base_styles,
            variants: variant_css_list,
            compounds: compound_css_list,
            states: state_css_list,
        },
        active_prop_names,
        active_group_names,
        custom_prop_configs,
        skip_warnings,
    })
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
    use crate::theme::{ContextualVarsMap, FlatTheme, SelectorAliasesMap, VariableMap};

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
        let ctx = ResolveContext {
            config: &config,
            theme: &theme,
            variable_map: &variable_map,
            contextual_vars: &contextual,
            breakpoint_keys: &bp,
            selector_aliases: &aliases,
            transform_evaluator: None,
        };
        let registry: FxHashMap<String, Vec<String>> = FxHashMap::default();
        process_chain_facts(&facts.chains[0], &ctx, &registry).unwrap()
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
        let ctx = ResolveContext {
            config: &config,
            theme: &theme,
            variable_map: &variable_map,
            contextual_vars: &contextual,
            breakpoint_keys: &bp,
            selector_aliases: &aliases,
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
}
