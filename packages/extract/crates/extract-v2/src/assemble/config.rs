//! Runtime config for a replacement: an object literal of JSON values and
//! JavaScript expressions. Key order and the `[].concat(...)` group list are
//! compared byte-for-byte downstream.

use std::collections::{BTreeMap, BTreeSet};

use rustc_hash::{FxHashMap, FxHashSet};

use serde_json::{json, Map, Value};

use crate::facts::ChainFacts;
use crate::theme::PropConfigMap;

use super::{AssembleError, ReplacementPayload};

/// The names a config lists after its groups' own: the system props no group
/// covers, and the custom props, sorted.
fn extra_prop_names(p: &ReplacementPayload, group_registry: &FxHashMap<String, Vec<String>>) -> Vec<String> {
    let group_covered: FxHashSet<&String> =
        p.system_group_names.iter().filter_map(|g| group_registry.get(g)).flatten().collect();
    let mut names: BTreeSet<String> =
        p.system_prop_names.iter().filter(|prop| !group_covered.contains(prop)).cloned().collect();
    names.extend(p.custom_prop_class_map.iter().flat_map(|cpm| cpm.keys().cloned()));
    names.extend(p.custom_dynamic_config.iter().flat_map(|cdc| cdc.keys().cloned()));
    names.into_iter().collect()
}

/// A config's `systemPropNames`, each at its first position: its groups'
/// lists, then the other names.
fn prop_walk(p: &ReplacementPayload, group_registry: &FxHashMap<String, Vec<String>>) -> Vec<String> {
    let names: Vec<String> = if p.system_group_names.is_empty() {
        p.system_prop_names.clone()
    } else {
        let groups = p.system_group_names.iter().filter_map(|g| group_registry.get(g)).flatten().cloned();
        groups.chain(extra_prop_names(p, group_registry)).collect()
    };
    let mut seen = FxHashSet::default();
    names.into_iter().filter(|name| seen.insert(name.clone())).collect()
}

/// When one element sets two system props that write one CSS property, the
/// prop the system defines later takes effect: the runtime skips each prop a
/// later-defined set prop supersedes, whatever order the config lists them
/// in (an extension child lists its props sorted). A later prop supersedes
/// one when it writes every property that one writes, its current variable
/// included; a partial overlap keeps both, and the stylesheet's order
/// decides, as it does for a shorthand and its longhand. Custom and
/// declaration props take no part.
pub(crate) fn superseded_props(
    p: &ReplacementPayload,
    group_registry: &FxHashMap<String, Vec<String>>,
    config: &PropConfigMap,
    prop_order: &FxHashMap<String, usize>,
) -> BTreeMap<String, Vec<String>> {
    let custom = |name: &str| {
        p.custom_prop_class_map.as_ref().is_some_and(|cpm| cpm.contains_key(name))
            || p.custom_dynamic_config.as_ref().is_some_and(|cdc| cdc.contains_key(name))
    };
    let mut writes: Vec<(usize, String, BTreeSet<&str>)> = prop_walk(p, group_registry)
        .into_iter()
        .filter(|name| !custom(name))
        .filter_map(|name| {
            let prop = config.get(&name).filter(|prop| prop.declaration_binding().is_none())?;
            let properties = prop.css_properties().iter().map(String::as_str).chain(prop.current_var.as_deref());
            Some((*prop_order.get(&name)?, name, properties.collect()))
        })
        .collect();
    writes.sort_by_key(|(position, ..)| *position);
    let mut superseded = BTreeMap::new();
    for (index, (_, name, properties)) in writes.iter().enumerate() {
        let later: Vec<String> = writes[index + 1..]
            .iter()
            .filter(|(_, _, later)| properties.is_subset(later))
            .map(|(_, later, _)| later.clone())
            .collect();
        if !later.is_empty() {
            superseded.insert(name.clone(), later);
        }
    }
    superseded
}

/// Runtime-config JSON for the facts-derivable subset. Compound conditions
/// are sorted; keys are emitted variants, compounds, states.
pub(super) fn build_config(
    filename: &str,
    binding: &str,
    chain: &ChainFacts,
    prefix: &str,
    payload: Option<&ReplacementPayload>,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Result<String, AssembleError> {
    let mut config = ObjectLiteral::default();

    let mut variants = Map::new();
    let mut compounds: Vec<Value> = Vec::new();
    let mut states: Vec<String> = Vec::new();
    let mut compound_index = 0usize;
    let class_name = super::component_class_name(filename, binding, prefix, payload);
    let use_merged = payload.and_then(|p| p.merged_config.as_ref());

    for stage in &chain.stages {
        if use_merged.is_some() && matches!(stage.method.as_str(), "variant" | "compound" | "states")
        {
            // Extension child: the merged trio below is authoritative.
            continue;
        }
        match stage.method.as_str() {
            "variant" => {
                if let Some(v) = &stage.value {
                    let prop = v["prop"].as_str().unwrap_or("variant").to_string();
                    let mut entry = Map::new();
                    let options: Vec<String> = v["variants"]
                        .as_object()
                        .map(|m| m.keys().cloned().collect())
                        .unwrap_or_default();
                    entry.insert("options".into(), json!(options));
                    if let Some(d) = v["defaultVariant"].as_str() {
                        entry.insert("default".into(), json!(d));
                    }
                    variants.insert(prop, Value::Object(entry));
                }
            }
            "compound" => {
                // A compound entry exists only when the second (styles)
                // argument does; the class index counts those compounds.
                if stage.second_value.is_some() {
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
                        compounds.push(json!({
                            "conditions": sorted,
                            "className": format!("{class_name}--compound-{compound_index}"),
                        }));
                        compound_index += 1;
                    }
                }
            }
            "states" => {
                if let Some(v) = &stage.value {
                    if let Some(m) = v.as_object() {
                        states.extend(m.keys().cloned());
                    }
                }
            }
            "system" | "props"
                // Fail loud rather than emit a template without prop config.
                if payload.is_none() => {
                    return Err(AssembleError::NeedsConfig(format!(
                        "{binding}: '{}' stage payloads require prop config (row 07)",
                        stage.method
                    )));
                }
            _ => {}
        }
    }

    if let Some(merged) = use_merged {
        for (prop, options, default) in &merged.variant_config {
            let mut entry = Map::new();
            entry.insert("options".into(), json!(options));
            if let Some(d) = default {
                entry.insert("default".into(), json!(d));
            }
            variants.insert(prop.clone(), Value::Object(entry));
        }
        for (conditions, cname) in &merged.compound_configs {
            compounds.push(json!({
                "conditions": conditions,
                "className": cname,
            }));
        }
        states = merged.state_names.clone();
    }
    if !variants.is_empty() {
        config.insert("variants", Value::Object(variants));
    }
    if !compounds.is_empty() {
        config.insert("compounds", json!(compounds));
    }
    if !states.is_empty() {
        config.insert("states", json!(states));
    }

    let Some(p) = payload else {
        return Ok(config.render());
    };

    if !p.system_group_names.is_empty() {
        let mut concat_parts: Vec<String> = p
            .system_group_names
            .iter()
            .map(|g| format!("systemPropGroups.{}", g))
            .collect();
        let extra_names = extra_prop_names(p, group_registry);
        if !extra_names.is_empty() {
            concat_parts.push(json!(extra_names).to_string());
        }
        config.insert(
            "systemPropNames",
            Field::Script(format!("[].concat({})", concat_parts.join(","))),
        );
    } else if !p.system_prop_names.is_empty() {
        config.insert("systemPropNames", json!(p.system_prop_names));
    }

    if !p.superseded_by.is_empty() {
        config.insert("supersededBy", json!(p.superseded_by));
    }

    if let Some(ref cpm) = p.custom_prop_class_map {
        let sorted_cpm: BTreeMap<&String, BTreeMap<&String, &String>> =
            cpm.iter().map(|(k, v)| (k, v.iter().collect())).collect();
        config.insert("customPropMap", json!(sorted_cpm));
    }

    if !p.typed_custom_props.is_empty() {
        config.insert("typedCustomProps", json!(p.typed_custom_props));
    }

    // One generated list, shared by every component, names the system props
    // whose static keys are typed.
    if p.reads_typed_system_props {
        config.insert("typedSystemProps", Field::Script("typedSystemProps".into()));
    }

    if let Some(ref cdc) = p.custom_dynamic_config {
        let mut dynamic = ObjectLiteral::default();
        let mut sorted_keys: Vec<&String> = cdc.keys().collect();
        sorted_keys.sort();
        for prop_name in sorted_keys {
            let meta = match &cdc[prop_name] {
                crate::dynamic_meta::DynamicPropMeta::Value(meta) => meta,
                crate::dynamic_meta::DynamicPropMeta::Declarations(meta) => {
                    dynamic.insert(prop_name, json!(meta));
                    continue;
                }
            };
            let mut fields = ObjectLiteral::default();
            fields.insert("varName", json!(meta.var_name));
            fields.insert("slotClass", json!(meta.slot_class));
            fields.insert("property", json!(meta.property));
            if !meta.properties.is_empty() {
                fields.insert("properties", json!(meta.properties));
            }
            if meta.negative {
                fields.insert("negative", json!(true));
            }
            if meta.strict {
                fields.insert("strict", json!(true));
            }
            if !meta.keywords.is_empty() {
                fields.insert("keywords", json!(meta.keywords));
            }
            if let Some(ref fn_src) = meta.transform_fn_source {
                fields.insert("transform", Field::Script(fn_src.clone()));
            } else if let Some(ref tn) = meta.transform_name {
                fields.insert("transformName", json!(tn));
                if let Some(ref id) = meta.transform_id {
                    let literal = crate::evaluator::js_string_literal(id);
                    fields.insert("transform", Field::Script(format!("transforms[{literal}]")));
                }
            }
            if !meta.scale_values.is_empty() {
                fields.insert("scaleValues", json!(meta.scale_values));
            }
            if let Some(ref current_var) = meta.current_var {
                fields.insert("currentVar", json!(current_var));
            }
            if let Some(ref conditions) = meta.production_conditions {
                fields.insert("productionConditions", json!(conditions));
            }
            dynamic.insert(prop_name, Field::Object(fields));
        }
        config.insert("customDynamicConfig", Field::Object(dynamic));
    }

    Ok(config.render())
}

/// One value of the config object literal.
enum Field {
    Json(Value),
    /// JavaScript the runtime evaluates, such as a group list or a transform
    /// reference.
    Script(String),
    Object(ObjectLiteral),
}

impl From<Value> for Field {
    fn from(value: Value) -> Self {
        Field::Json(value)
    }
}

/// An object literal rendered with its fields in insertion order.
#[derive(Default)]
struct ObjectLiteral(Vec<(String, Field)>);

impl ObjectLiteral {
    fn insert(&mut self, key: &str, value: impl Into<Field>) {
        self.0.push((key.to_string(), value.into()));
    }

    fn render(&self) -> String {
        let mut out = String::from("{");
        for (index, (key, value)) in self.0.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str(&crate::evaluator::js_string_literal(key));
            out.push(':');
            match value {
                Field::Json(value) => out.push_str(&value.to_string()),
                Field::Script(script) => out.push_str(script),
                Field::Object(object) => out.push_str(&object.render()),
            }
        }
        out.push('}');
        out
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::super::test_support::facts_for;
    use super::*;
    use crate::dynamic_meta::{DeclarationPropMeta, DynamicPropMeta, ValuePropMeta};

    fn value_meta(name: &str) -> ValuePropMeta {
        ValuePropMeta {
            var_name: format!("--animus-{name}"),
            slot_class: format!("animus-dyn-{name}"),
            property: "width".into(),
            negative: false,
            strict: false,
            keywords: Vec::new(),
            properties: Vec::new(),
            transform_name: None,
            transform_id: None,
            transform_fn_source: None,
            scale_values: BTreeMap::new(),
            current_var: None,
            production_conditions: None,
        }
    }

    fn config_for(source: &str, payload: &ReplacementPayload) -> String {
        let facts = facts_for("box.tsx", source);
        let registry: FxHashMap<String, Vec<String>> =
            [("space".to_string(), vec!["p".to_string(), "m".to_string()])].into_iter().collect();
        build_config("box.tsx", "Box", &facts.chains[0], "animus", Some(payload), &registry).unwrap()
    }

    #[test]
    fn config_object_carries_every_field_in_order() {
        let sized = ValuePropMeta {
            negative: true,
            strict: true,
            keywords: vec!["auto".into()],
            properties: vec!["width".into(), "height".into()],
            transform_name: Some("size".into()),
            transform_id: Some("theme.ts#size".into()),
            scale_values: [("sm".to_string(), json!("4px"))].into_iter().collect(),
            current_var: Some("--current-size".into()),
            production_conditions: None,
            ..value_meta("sized")
        };
        let lifted = ValuePropMeta {
            transform_fn_source: Some("(v) => v * 2".into()),
            ..value_meta("lift")
        };
        let tone = DeclarationPropMeta {
            kind: "declarations",
            slot_class: "animus-dyn-tone".into(),
            member_vars: [("color".to_string(), "--animus-tone-color".to_string())].into_iter().collect(),
            declaration_scale_values: BTreeMap::new(),
            production_conditions: None,
        };
        let payload = ReplacementPayload {
            system_prop_names: vec!["bg".into(), "p".into()],
            system_group_names: vec!["space".into()],
            custom_prop_class_map: Some(HashMap::from([(
                "sized".to_string(),
                HashMap::from([("sm".to_string(), "animus-uc-1".to_string())]),
            )])),
            custom_dynamic_config: Some(HashMap::from([
                ("sized".to_string(), DynamicPropMeta::Value(sized)),
                ("lift".to_string(), DynamicPropMeta::Value(lifted)),
                ("tone".to_string(), DynamicPropMeta::Declarations(tone)),
            ])),
            typed_custom_props: vec!["sized".into()],
            reads_typed_system_props: true,
            ..ReplacementPayload::default()
        };
        let config = config_for(
            "export const Box = ds.variant({ prop: 'size', variants: { sm: {} } }).states({ busy: {} }).asElement('div');",
            &payload,
        );
        assert_eq!(
            config,
            concat!(
                r#"{"variants":{"size":{"options":["sm"]}},"states":["busy"],"#,
                r#""systemPropNames":[].concat(systemPropGroups.space,["bg","lift","sized","tone"]),"#,
                r#""customPropMap":{"sized":{"sm":"animus-uc-1"}},"#,
                r#""typedCustomProps":["sized"],"#,
                r#""typedSystemProps":typedSystemProps,"#,
                r#""customDynamicConfig":{"#,
                r#""lift":{"varName":"--animus-lift","slotClass":"animus-dyn-lift","property":"width","transform":(v) => v * 2},"#,
                r#""sized":{"varName":"--animus-sized","slotClass":"animus-dyn-sized","property":"width","#,
                r#""properties":["width","height"],"negative":true,"strict":true,"keywords":["auto"],"#,
                r#""transformName":"size","transform":transforms["theme.ts#size"],"scaleValues":{"sm":"4px"},"#,
                r#""currentVar":"--current-size"},"#,
                r#""tone":{"kind":"declarations","slotClass":"animus-dyn-tone","#,
                r#""memberVars":{"color":"--animus-tone-color"},"declarationScaleValues":{}}}}"#,
            )
        );
    }

    #[test]
    fn config_object_without_variants_starts_from_its_first_field() {
        let plain = "export const Box = ds.styles({}).asElement('div');";
        let names_only = ReplacementPayload {
            system_prop_names: vec!["bg".into()],
            reads_typed_system_props: true,
            ..ReplacementPayload::default()
        };
        assert_eq!(
            config_for(plain, &names_only),
            r#"{"systemPropNames":["bg"],"typedSystemProps":typedSystemProps}"#
        );
        let groups_only = ReplacementPayload {
            system_prop_names: vec!["p".into()],
            system_group_names: vec!["space".into()],
            ..ReplacementPayload::default()
        };
        assert_eq!(
            config_for(plain, &groups_only),
            r#"{"systemPropNames":[].concat(systemPropGroups.space)}"#
        );
        let typed_only = ReplacementPayload {
            typed_custom_props: vec!["sized".into()],
            ..ReplacementPayload::default()
        };
        assert_eq!(config_for(plain, &typed_only), r#"{"typedCustomProps":["sized"]}"#);
    }
}
