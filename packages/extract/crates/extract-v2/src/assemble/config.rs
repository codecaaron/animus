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

/// A config's `systemPropNames` as it ships: its groups' lists, then the
/// other names; without groups, the names alone.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct PropNameList {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub names: Vec<String>,
}

pub(crate) fn prop_name_list(
    p: &ReplacementPayload,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Option<PropNameList> {
    if !p.system_group_names.is_empty() {
        Some(PropNameList { groups: p.system_group_names.clone(), names: extra_prop_names(p, group_registry) })
    } else if !p.system_prop_names.is_empty() {
        Some(PropNameList { groups: Vec::new(), names: p.system_prop_names.clone() })
    } else {
        None
    }
}

/// The `systemPropNames` lists configs share, each shipped once in the
/// system-props module as its own export, `systemPropNames_{key}`, keyed by
/// its content's hash: a list no config uses stays out of the bundle, and
/// adding a component leaves every other config's reference unchanged.
#[derive(Debug, Default)]
pub struct PropNameLists(BTreeMap<String, PropNameList>);

impl PropNameLists {
    /// The key `list` is filed under; `None`, leaving it inline, when its
    /// hash already keys another list.
    pub fn intern(&mut self, list: PropNameList) -> Option<String> {
        let key = format!("{:08x}", crate::ids::fnv1a_json(crate::ids::FNV_OFFSET, &list) as u32);
        crate::dynamic_meta::file(&mut self.0, Some(key), &list)
    }

    /// Each list's source in the system-props module, by key.
    /// A list with groups reads them in a pure call, so a bundle drops a
    /// list no component references.
    pub fn into_sources(self) -> BTreeMap<String, String> {
        self.0
            .into_iter()
            .map(|(key, list)| {
                let source = render_prop_name_list(&list, "systemPropGroups");
                let source =
                    if list.groups.is_empty() { source } else { format!("/* @__PURE__ */ (() => {source})()") };
                (key, source)
            })
            .collect()
    }
}

/// The export of the shared list keyed `key`.
pub fn prop_name_list_export(key: &str) -> String {
    format!("systemPropNames_{key}")
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
///
/// This is the system's table (`system_superseded_props`) narrowed to the
/// system props a component lists and does not own, as the runtime narrows
/// it; a config references the table only where the narrowing keeps some.
pub(crate) fn superseded_props(
    p: &ReplacementPayload,
    group_registry: &FxHashMap<String, Vec<String>>,
    system: &BTreeMap<String, Vec<String>>,
) -> BTreeMap<String, Vec<String>> {
    let custom = |name: &str| {
        p.custom_prop_class_map.as_ref().is_some_and(|cpm| cpm.contains_key(name))
            || p.custom_dynamic_config.as_ref().is_some_and(|cdc| cdc.contains_key(name))
    };
    let listed: FxHashSet<String> = prop_walk(p, group_registry).into_iter().filter(|name| !custom(name)).collect();
    system
        .iter()
        .filter(|(name, _)| listed.contains(*name))
        .filter_map(|(name, later)| {
            let later: Vec<String> = later.iter().filter(|prop| listed.contains(*prop)).cloned().collect();
            (!later.is_empty()).then(|| (name.clone(), later))
        })
        .collect()
}

/// Every system prop → the later-defined props that supersede it.
pub(crate) fn system_superseded_props(
    config: &PropConfigMap,
    prop_order: &FxHashMap<String, usize>,
) -> BTreeMap<String, Vec<String>> {
    let mut writes: Vec<(usize, &String, BTreeSet<&str>)> = config
        .iter()
        .filter_map(|(name, prop)| {
            if prop.declaration_binding().is_some() {
                return None;
            }
            let properties = prop.css_properties().iter().map(String::as_str).chain(prop.current_var.as_deref());
            Some((*prop_order.get(name)?, name, properties.collect()))
        })
        .collect();
    writes.sort_by_key(|(position, ..)| *position);
    let mut superseded = BTreeMap::new();
    for (index, (_, name, properties)) in writes.iter().enumerate() {
        let later: Vec<String> = writes[index + 1..]
            .iter()
            .filter(|(_, _, later)| properties.is_subset(later))
            .map(|(_, later, _)| (*later).clone())
            .collect();
        if !later.is_empty() {
            superseded.insert((*name).clone(), later);
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
    inputs: super::ConfigInputs<'_>,
    names: &super::GeneratedNames,
) -> Result<String, AssembleError> {
    let super::ConfigInputs { group_registry, variant_options } = inputs;
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
                    if variant_options {
                        let options: Vec<String> = v["variants"]
                            .as_object()
                            .map(|m| m.keys().cloned().collect())
                            .unwrap_or_default();
                        entry.insert("options".into(), json!(options));
                    }
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
                            "className": crate::css::compound_class(&class_name, compound_index),
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
            if variant_options {
                entry.insert("options".into(), json!(options));
            }
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
    // The runtime names compound `i` `{class}--compound-{i}`; a name it
    // would not derive ships.
    for (index, compound) in compounds.iter_mut().enumerate() {
        if compound["className"] == crate::css::compound_class(&class_name, index) {
            compound.as_object_mut().expect("a compound is an object").remove("className");
        }
    }
    if !compounds.is_empty() {
        config.insert("compounds", json!(compounds));
    }
    if !states.is_empty() {
        config.insert("states", json!(states));
    }
    if let Some(forward) = &chain.descriptor.forward {
        config.insert("forward", forward.to_json());
    }

    let Some(p) = payload else {
        return Ok(config.render());
    };

    if let Some(key) = &p.prop_names_key {
        config.insert("systemPropNames", Field::Script(names.prop_name_list(key).to_string()));
    } else if let Some(list) = prop_name_list(p, group_registry) {
        config.insert("systemPropNames", Field::Script(render_prop_name_list(&list, &names.system_prop_groups.to_string())));
    }

    // The system's one table, which the runtime narrows to this component.
    if !p.superseded_by.is_empty() {
        config.insert("supersededBy", Field::Script(names.superseded_by.to_string()));
    }

    if let Some(ref cpm) = p.custom_prop_class_map {
        // A prop without classes is listed so the runtime treats it as the
        // component's own; one with a dynamic entry already is.
        let dynamic = |prop: &String| p.custom_dynamic_config.as_ref().is_some_and(|cdc| cdc.contains_key(prop));
        let sorted_cpm: BTreeMap<&String, BTreeMap<&String, &String>> = cpm
            .iter()
            .filter(|(prop, classes)| !classes.is_empty() || !dynamic(prop))
            .map(|(k, v)| (k, v.iter().collect()))
            .collect();
        if !sorted_cpm.is_empty() {
            config.insert("customPropMap", json!(sorted_cpm));
        }
    }

    if !p.typed_custom_props.is_empty() {
        config.insert("typedCustomProps", json!(p.typed_custom_props));
    }

    // One generated list, shared by every component, names the system props
    // whose static keys are typed.
    if p.reads_typed_system_props {
        config.insert("typedSystemProps", Field::Script(names.typed_system_props.to_string()));
    }

    if let Some(ref cdc) = p.custom_dynamic_config {
        // The runtime derives each slot's variable and class from the scope
        // (`css::slot_names`); a pair it would not derive, such as a shared
        // slot's, ships.
        let derived: FxHashSet<&String> = match p.slot_scope.as_deref() {
            Some(scope) => cdc
                .iter()
                .filter(|(prop, meta)| {
                    meta.value().is_some_and(|meta| {
                        let (var_name, slot_class) = crate::css::slot_names(prefix, prop, scope);
                        meta.var_name == var_name && meta.slot_class == slot_class
                    })
                })
                .map(|(prop, _)| prop)
                .collect(),
            None => FxHashSet::default(),
        };
        if let (false, Some(scope)) = (derived.is_empty(), &p.slot_scope) {
            config.insert("scope", json!([prefix, scope]));
        }
        let mut dynamic = ObjectLiteral::default();
        let mut sorted_keys: Vec<&String> = cdc.keys().collect();
        sorted_keys.sort();
        for prop_name in sorted_keys {
            let meta = match &cdc[prop_name] {
                crate::dynamic_meta::DynamicPropMeta::Value(meta) => meta,
                crate::dynamic_meta::DynamicPropMeta::Declarations(meta) => {
                    // The meta's own serialization, its table referenced.
                    let Value::Object(entries) = json!(meta) else { unreachable!("a struct serializes as an object") };
                    let mut fields = ObjectLiteral::default();
                    for (field, value) in entries {
                        match field.as_str() {
                            "tables" => {}
                            "declarationScaleValues" => fields.insert(
                                &field,
                                shared_table(names, &field, meta.tables.declaration_scale_values.as_deref(), &value),
                            ),
                            _ => fields.insert(&field, value),
                        }
                    }
                    dynamic.insert(prop_name, Field::Object(fields));
                    continue;
                }
            };
            let mut fields = ObjectLiteral::default();
            if !derived.contains(prop_name) {
                fields.insert("varName", json!(meta.var_name));
                fields.insert("slotClass", json!(meta.slot_class));
            }
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
                fields.insert("keywords", shared_table(names, "keywords", meta.tables.keywords.as_deref(), &meta.keywords));
            }
            if meta.declared_numeric {
                fields.insert("declaredNumeric", json!(true));
            }
            if let Some(ref fn_src) = meta.transform_fn_source {
                fields.insert("transform", Field::Script(fn_src.clone()));
            } else if let Some(ref tn) = meta.transform_name {
                fields.insert("transformName", json!(tn));
                if let Some(ref id) = meta.transform_id {
                    let literal = crate::evaluator::js_string_literal(id);
                    fields.insert("transform", Field::Script(format!("{}[{literal}]", names.transforms)));
                }
            }
            if !meta.scale_values.is_empty() {
                fields.insert(
                    "scaleValues",
                    shared_table(names, "scaleValues", meta.tables.scale_values.as_deref(), &meta.scale_values),
                );
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

/// A list as source: its groups' lists, read from `groups`, then its other
/// names; without groups, the names alone.
fn render_prop_name_list(list: &PropNameList, groups: &str) -> String {
    if list.groups.is_empty() {
        return json!(list.names).to_string();
    }
    let mut parts: Vec<String> = list.groups.iter().map(|g| format!("{groups}.{g}")).collect();
    if !list.names.is_empty() {
        parts.push(json!(list.names).to_string());
    }
    format!("[].concat({})", parts.join(","))
}

/// A table the system-props module's `animusTables` export holds under
/// `key`, referenced there through the module's local name for it; one
/// without a key, inlined.
fn shared_table(
    names: &super::GeneratedNames,
    table: &str,
    key: Option<&str>,
    value: &impl serde::Serialize,
) -> Field {
    match key {
        Some(key) => Field::Script(format!(
            "{}.{table}[{}]",
            names.animus_tables,
            crate::evaluator::js_string_literal(key)
        )),
        None => Field::Json(json!(value)),
    }
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
            // A `__proto__:` key sets the prototype; a computed one defines
            // the own property a prop named `__proto__` needs.
            let literal = crate::evaluator::js_string_literal(key);
            if key == "__proto__" {
                out.push('[');
                out.push_str(&literal);
                out.push(']');
            } else {
                out.push_str(&literal);
            }
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
            declared_numeric: false,
            tables: Default::default(),
        }
    }

    fn config_for(source: &str, payload: &ReplacementPayload) -> String {
        let facts = facts_for("box.tsx", source);
        let registry: FxHashMap<String, Vec<String>> =
            [("space".to_string(), vec!["p".to_string(), "m".to_string()])].into_iter().collect();
        build_config(
            "box.tsx",
            "Box",
            &facts.chains[0],
            "animus",
            Some(payload),
            super::super::ConfigInputs { group_registry: &registry, variant_options: false },
            &super::super::GeneratedNames::exports(),
        )
            .unwrap()
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
            tables: Default::default(),
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
                r#"{"variants":{"size":{}},"states":["busy"],"#,
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
