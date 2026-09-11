//! Runtime-config JSON for a replacement. Key order and the
//! `[].concat(...)` splice shape are compared byte-for-byte downstream.

use std::collections::BTreeMap;

use rustc_hash::FxHashMap;

use serde_json::{json, Map, Value};

use crate::facts::ChainFacts;
use crate::ids::class_name_for;

use super::{AssembleError, ReplacementPayload};

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
    let mut config = Map::new();

    let mut variants = Map::new();
    let mut compounds: Vec<Value> = Vec::new();
    let mut states: Vec<String> = Vec::new();
    let mut compound_index = 0usize;
    let class_name = class_name_for(filename, binding, prefix);
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
        config.insert("variants".into(), Value::Object(variants));
    }
    if !compounds.is_empty() {
        config.insert("compounds".into(), json!(compounds));
    }
    if !states.is_empty() {
        config.insert("states".into(), json!(states));
    }

    let base_json =
        serde_json::to_string(&Value::Object(config)).unwrap_or_else(|_| "{}".into());
    let Some(p) = payload else {
        return Ok(base_json);
    };

    let mut result = if !p.system_group_names.is_empty() {
        let mut concat_parts: Vec<String> = p
            .system_group_names
            .iter()
            .map(|g| format!("systemPropGroups.{}", g))
            .collect();
        {
            let mut extra_names: rustc_hash::FxHashSet<String> = rustc_hash::FxHashSet::default();
            if !p.system_prop_names.is_empty() {
                let group_covered: rustc_hash::FxHashSet<String> = p
                    .system_group_names
                    .iter()
                    .filter_map(|g| group_registry.get(g))
                    .flat_map(|props| props.iter().cloned())
                    .collect();
                for prop in &p.system_prop_names {
                    if !group_covered.contains(prop) {
                        extra_names.insert(prop.clone());
                    }
                }
            }
            if let Some(ref cpm) = p.custom_prop_class_map {
                extra_names.extend(cpm.keys().cloned());
            }
            if let Some(ref cdc) = p.custom_dynamic_config {
                extra_names.extend(cdc.keys().cloned());
            }
            if !extra_names.is_empty() {
                let mut sorted: Vec<String> = extra_names.into_iter().collect();
                sorted.sort();
                concat_parts
                    .push(serde_json::to_string(&sorted).unwrap_or_else(|_| "[]".to_string()));
            }
        }
        let concat_expr = concat_parts.join(",");
        let spn_field = format!("\"systemPropNames\":[].concat({})", concat_expr);
        if base_json == "{}" {
            format!("{{{}}}", spn_field)
        } else {
            format!("{},{}}}", &base_json[..base_json.len() - 1], spn_field)
        }
    } else if !p.system_prop_names.is_empty() {
        let mut config_map: Map<String, Value> =
            serde_json::from_str(&base_json).unwrap_or_default();
        config_map.insert("systemPropNames".to_string(), json!(p.system_prop_names));
        serde_json::to_string(&Value::Object(config_map)).unwrap_or(base_json)
    } else {
        base_json
    };

    if let Some(ref cpm) = p.custom_prop_class_map {
        let sorted_cpm: BTreeMap<&String, BTreeMap<&String, &String>> =
            cpm.iter().map(|(k, v)| (k, v.iter().collect())).collect();
        let cpm_json = serde_json::to_string(&sorted_cpm).unwrap_or_else(|_| "{}".to_string());
        if result == "{}" {
            result = format!("{{\"customPropMap\":{}}}", cpm_json);
        } else {
            result = format!("{},\"customPropMap\":{}}}", &result[..result.len() - 1], cpm_json);
        }
    }

    if let Some(ref cdc) = p.custom_dynamic_config {
        let mut entries: Vec<String> = Vec::new();
        let mut sorted_keys: Vec<&String> = cdc.keys().collect();
        sorted_keys.sort();
        for prop_name in sorted_keys {
            let meta = &cdc[prop_name];
            let mut fields: Vec<String> = Vec::new();
            fields.push(format!("\"varName\":\"{}\"", meta.var_name));
            fields.push(format!("\"slotClass\":\"{}\"", meta.slot_class));
            fields.push(format!("\"property\":\"{}\"", meta.property));
            if !meta.properties.is_empty() {
                let props_json =
                    serde_json::to_string(&meta.properties).unwrap_or_else(|_| "[]".to_string());
                fields.push(format!("\"properties\":{}", props_json));
            }
            if let Some(ref fn_src) = meta.transform_fn_source {
                fields.push(format!("\"transform\":{}", fn_src));
            } else if let Some(ref tn) = meta.transform_name {
                fields.push(format!("\"transformName\":\"{}\"", tn));
                fields.push(format!("\"transform\":transforms.{}", tn));
            }
            if !meta.scale_values.is_empty() {
                let sorted_sv: BTreeMap<&String, &String> = meta.scale_values.iter().collect();
                let sv_json =
                    serde_json::to_string(&sorted_sv).unwrap_or_else(|_| "{}".to_string());
                fields.push(format!("\"scaleValues\":{}", sv_json));
            }
            entries.push(format!("\"{}\":{{{}}}", prop_name, fields.join(",")));
        }
        let cdc_str = format!("{{{}}}", entries.join(","));
        if result == "{}" {
            result = format!("{{\"customDynamicConfig\":{}}}", cdc_str);
        } else {
            result = format!(
                "{},\"customDynamicConfig\":{}}}",
                &result[..result.len() - 1],
                cdc_str
            );
        }
    }

    Ok(result)
}
