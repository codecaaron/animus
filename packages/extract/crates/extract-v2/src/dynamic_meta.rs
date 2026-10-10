use std::collections::{BTreeMap, HashMap};

use serde::Serialize;
use serde_json::Value;

use crate::declarations::{DeclarationBinding, DeclarationNames, DECLARATIONS_KIND};
use crate::theme::{
    contextual_var_reference, css_keywords, is_strict_scale, ContextualVarsMap, FlatTheme,
    PropConfig,
};

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum DynamicPropMeta {
    Value(ValuePropMeta),
    Declarations(DeclarationPropMeta),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValuePropMeta {
    pub var_name: String,
    pub slot_class: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub property: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub negative: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub strict: bool,
    /// The keywords a strict prop admits beside its tokens; empty otherwise.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keywords: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<String>,
    /// The bound transform's readable name, for diagnostics.
    pub transform_name: Option<String>,
    /// The runtime registry key of the bound definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform_id: Option<String>,
    pub transform_fn_source: Option<String>,
    /// BTreeMap: serialization order must be deterministic.
    pub scale_values: BTreeMap<String, Value>,
    /// The custom property a write of the prop also sets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_var: Option<String>,
    /// See `DynamicPropMeta::set_production_conditions`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub production_conditions: Option<Vec<String>>,
    /// Every property the prop writes is registered with a numeric syntax,
    /// so a number needs no unit and the development runtime does not warn.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub declared_numeric: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclarationPropMeta {
    pub kind: &'static str,
    pub slot_class: String,
    pub member_vars: BTreeMap<String, String>,
    /// Scale key → member → CSS value, as the binding classes declare them.
    pub declaration_scale_values: BTreeMap<String, BTreeMap<String, String>>,
    /// See `DynamicPropMeta::set_production_conditions`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub production_conditions: Option<Vec<String>>,
}

impl DynamicPropMeta {
    pub fn new(
        var_name: String,
        slot_class: String,
        config: &PropConfig,
        theme: &FlatTheme,
        contextual_vars: &ContextualVarsMap,
        numeric_properties: &rustc_hash::FxHashSet<String>,
    ) -> Self {
        let strict = is_strict_scale(config, theme);
        Self::Value(ValuePropMeta {
            var_name,
            slot_class,
            property: contextual_vars.emitted_property(&config.property).into_owned(),
            negative: config.negative,
            strict,
            keywords: if strict {
                css_keywords(&config.property).map(str::to_string).collect()
            } else {
                Vec::new()
            },
            properties: config
                .properties
                .iter()
                .map(|property| contextual_vars.emitted_property(property).into_owned())
                .collect(),
            transform_name: config.transform.clone(),
            transform_id: config.transform_id.clone(),
            transform_fn_source: config.transform_fn_source.clone(),
            scale_values: scale_values(config, theme, contextual_vars),
            current_var: config
                .current_var
                .as_deref()
                .map(|current_var| contextual_vars.emitted_property(current_var).into_owned()),
            production_conditions: None,
            declared_numeric: config.declares_numeric(numeric_properties),
        })
    }

    /// A declaration prop's runtime entry: its consuming class, each member's
    /// variable and every key's record.
    pub fn declarations(class_prefix: &str, prop_name: &str, binding: &DeclarationBinding) -> Self {
        let names = DeclarationNames::of(class_prefix, prop_name, binding);
        Self::Declarations(DeclarationPropMeta {
            kind: DECLARATIONS_KIND,
            slot_class: names.consuming_class(),
            member_vars: binding
                .members
                .iter()
                .map(|member| (member.name.clone(), names.member_var(member)))
                .collect(),
            declaration_scale_values: binding.records.as_ref().clone(),
            production_conditions: None,
        })
    }

    /// Development only: the conditions (`_` for the base) at which a
    /// production build keeps this prop's slot, empty when it keeps none;
    /// `None` when it keeps every one. The development runtime warns when a
    /// value reaches a condition production prunes.
    pub fn set_production_conditions(&mut self, conditions: Option<Vec<String>>) {
        match self {
            Self::Value(meta) => meta.production_conditions = conditions,
            Self::Declarations(meta) => meta.production_conditions = conditions,
        }
    }

    pub fn value(&self) -> Option<&ValuePropMeta> {
        match self {
            Self::Value(meta) => Some(meta),
            Self::Declarations(_) => None,
        }
    }
}

impl ValuePropMeta {
    /// What a slot rule depends on: the properties it writes, the current
    /// variable it also sets, and the transform the runtime applies first.
    fn slot_key(&self) -> (&[String], Option<&str>, [Option<&str>; 3]) {
        let destination = if self.properties.is_empty() {
            std::slice::from_ref(&self.property)
        } else {
            &self.properties
        };
        let transform = [
            self.transform_name.as_deref(),
            self.transform_id.as_deref(),
            self.transform_fn_source.as_deref(),
        ];
        (destination, self.current_var.as_deref(), transform)
    }
}

/// Props alike in what a slot rule depends on share one slot variable and
/// rule, as `h` and `height` do: each takes the slot of the first by name.
/// The runtime resolves a value through the prop's own metadata, and of two
/// writes to one element the later-defined prop's wins.
pub fn share_slots(metas: &mut HashMap<String, DynamicPropMeta>) {
    let mut props: Vec<&String> = metas.keys().collect();
    props.sort();
    let mut slots: HashMap<_, (&str, &str)> = HashMap::new();
    let mut shared: Vec<(String, String, String)> = Vec::new();
    for prop in props {
        let Some(meta) = metas[prop].value() else { continue };
        let (var_name, slot_class) = *slots
            .entry(meta.slot_key())
            .or_insert((meta.var_name.as_str(), meta.slot_class.as_str()));
        if var_name != meta.var_name {
            shared.push((prop.clone(), var_name.to_string(), slot_class.to_string()));
        }
    }
    for (prop, var_name, slot_class) in shared {
        if let Some(DynamicPropMeta::Value(meta)) = metas.get_mut(&prop) {
            meta.var_name = var_name;
            meta.slot_class = slot_class;
        }
    }
}

/// Keep named and inline scale entries identical for system and custom slots.
/// A named scale's contextual variables are tokens that resolve to themselves.
fn scale_values(
    config: &PropConfig,
    theme: &FlatTheme,
    contextual_vars: &ContextualVarsMap,
) -> BTreeMap<String, Value> {
    match &config.scale {
        Some(Value::String(name)) => {
            let prefix = format!("{name}.");
            let mut values: BTreeMap<String, Value> = theme.iter().filter_map(|(key, value)| {
                key.strip_prefix(&prefix).map(|key| (key.to_string(), Value::String(value.clone())))
            }).collect();
            let vars = contextual_vars.scale(name);
            for var in vars {
                values
                    .entry(var.name.clone())
                    .or_insert_with(|| Value::String(contextual_var_reference(&var.var)));
            }
            // A final spelling still resolves, after every declared name.
            for var in vars {
                values
                    .entry(var.var.clone())
                    .or_insert_with(|| Value::String(contextual_var_reference(&var.var)));
            }
            values
        }
        Some(Value::Object(values)) => {
            values.iter().map(|(key, value)| {
                // Transforms must receive the authored number before unit fallback.
                let value = if value.is_string() || value.is_number() {
                    value.clone()
                } else {
                    Value::String(value.to_string())
                };
                (key.clone(), value)
            }).collect()
        }
        // An array scale's entries are their own CSS values.
        Some(Value::Array(values)) => {
            values.iter().filter_map(|value| match value {
                Value::String(text) => Some((text.clone(), value.clone())),
                Value::Number(number) => Some((number.to_string(), value.clone())),
                _ => None,
            }).collect()
        }
        _ => BTreeMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn runtime_meta(contextual_vars: &str) -> ValuePropMeta {
        let config: PropConfig = serde_json::from_value(json!({
            "property": "--tone",
            "properties": ["--tone", "outlineColor"],
            "scale": "colors",
            "currentVar": "--tone",
        }))
        .unwrap();
        let theme: FlatTheme = [("colors.red".to_string(), "#f00".to_string())].into_iter().collect();
        let contextual_vars: ContextualVarsMap = serde_json::from_str(contextual_vars).unwrap();
        let meta = DynamicPropMeta::new("--animus-tint".into(), "animus-dyn-tint".into(), &config, &theme, &contextual_vars, &Default::default());
        meta.value().unwrap().clone()
    }

    #[test]
    fn runtime_writes_and_the_scale_map_use_final_names() {
        let meta = runtime_meta(
            r#"{"colors":[{"name":"tone","var":"acme-tone"},{"name":"acme-tone","var":"acme-acme-tone"}]}"#,
        );
        assert_eq!(meta.property, "--acme-tone");
        assert_eq!(meta.properties, ["--acme-tone", "outlineColor"]);
        assert_eq!(meta.current_var.as_deref(), Some("--acme-tone"));
        assert_eq!(
            serde_json::to_value(&meta.scale_values).unwrap(),
            json!({
                "red": "#f00",
                "tone": "var(--acme-tone)",
                "acme-tone": "var(--acme-acme-tone)",
                "acme-acme-tone": "var(--acme-acme-tone)",
            })
        );
    }

    #[test]
    fn the_legacy_string_form_keeps_its_runtime_map() {
        let meta = runtime_meta(r#"{"colors":["tone"]}"#);
        assert_eq!(meta.property, "--tone");
        assert_eq!(meta.properties, ["--tone", "outlineColor"]);
        assert_eq!(meta.current_var.as_deref(), Some("--tone"));
        assert_eq!(
            serde_json::to_value(&meta.scale_values).unwrap(),
            json!({ "red": "#f00", "tone": "var(--tone)" })
        );
    }
}
