use std::collections::BTreeMap;

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclarationPropMeta {
    pub kind: &'static str,
    pub slot_class: String,
    pub member_vars: BTreeMap<String, String>,
    /// Scale key → member → CSS value, as the binding classes declare them.
    pub declaration_scale_values: BTreeMap<String, BTreeMap<String, String>>,
}

impl DynamicPropMeta {
    pub fn new(
        var_name: String,
        slot_class: String,
        config: &PropConfig,
        theme: &FlatTheme,
        contextual_vars: &ContextualVarsMap,
    ) -> Self {
        let strict = is_strict_scale(config, theme);
        Self::Value(ValuePropMeta {
            var_name,
            slot_class,
            property: config.property.clone(),
            negative: config.negative,
            strict,
            keywords: if strict {
                css_keywords(&config.property).map(str::to_string).collect()
            } else {
                Vec::new()
            },
            properties: config.properties.clone(),
            transform_name: config.transform.clone(),
            transform_id: config.transform_id.clone(),
            transform_fn_source: config.transform_fn_source.clone(),
            scale_values: scale_values(config, theme, contextual_vars),
            current_var: config.current_var.clone(),
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
        })
    }

    pub fn value(&self) -> Option<&ValuePropMeta> {
        match self {
            Self::Value(meta) => Some(meta),
            Self::Declarations(_) => None,
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
            for var_name in contextual_vars.get(name).into_iter().flatten() {
                values
                    .entry(var_name.clone())
                    .or_insert_with(|| Value::String(contextual_var_reference(var_name)));
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
