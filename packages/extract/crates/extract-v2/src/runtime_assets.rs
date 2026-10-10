//! Runtime prop configs carry scale values to the browser, where an `asset()`
//! placeholder would load nothing. Each value holding one is replaced with a
//! root variable the global sheet declares, so the one substitution step every
//! emitted sheet passes through resolves, emits and watches the asset in every
//! host. A runtime transform therefore receives the `var()` reference.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::css::content_hash;
use crate::dynamic_meta::DynamicPropMeta;

/// The prefix `asset()` gives the URL it stands for, until substitution.
pub const ASSET_PLACEHOLDER_PREFIX: &str = "animus-asset:";

/// The root variables lifted out of runtime configs, by name.
pub struct RuntimeAssetVars {
    class_prefix: String,
    vars: BTreeMap<String, String>,
}

impl RuntimeAssetVars {
    pub fn new(class_prefix: &str) -> Self {
        Self { class_prefix: class_prefix.to_string(), vars: BTreeMap::new() }
    }

    /// `value` as a runtime config should carry it.
    fn lift(&mut self, value: &str) -> Option<String> {
        if !value.contains(ASSET_PLACEHOLDER_PREFIX) {
            return None;
        }
        let name = format!("--{}-asset-{}", self.class_prefix, content_hash(value));
        let reference = format!("var({name})");
        self.vars.insert(name, value.to_string());
        Some(reference)
    }

    /// Replaces every scale value of `meta` that holds a placeholder.
    pub fn lift_meta(&mut self, meta: &mut DynamicPropMeta) {
        match meta {
            DynamicPropMeta::Value(meta) => {
                for value in meta.scale_values.values_mut() {
                    if let Some(reference) = value.as_str().and_then(|text| self.lift(text)) {
                        *value = Value::String(reference);
                    }
                }
            }
            DynamicPropMeta::Declarations(meta) => {
                for value in meta.declaration_scale_values.values_mut().flat_map(|record| record.values_mut()) {
                    if let Some(reference) = self.lift(value) {
                        *value = reference;
                    }
                }
            }
        }
    }

    /// The rule declaring every lifted value; empty when there are none.
    pub fn root_rule(&self) -> String {
        if self.vars.is_empty() {
            return String::new();
        }
        let declarations: String =
            self.vars.iter().map(|(name, value)| format!("  {name}: {value};\n")).collect();
        format!(":root {{\n{declarations}}}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dynamic_meta::{DeclarationPropMeta, ValuePropMeta};

    const ROCK: &str = r#"url("animus-asset:@acme/media/rock.jpg")"#;

    fn value_meta(scale_values: Value) -> DynamicPropMeta {
        DynamicPropMeta::Value(ValuePropMeta {
            var_name: "--animus-bg-image".into(),
            slot_class: "animus-dyn-bg-image".into(),
            property: "backgroundImage".into(),
            negative: false,
            strict: false,
            keywords: vec![],
            properties: vec![],
            transform_name: None,
            transform_id: None,
            transform_fn_source: None,
            scale_values: serde_json::from_value(scale_values).unwrap(),
            current_var: None,
            production_conditions: None,
            declared_numeric: false,
        })
    }

    #[test]
    fn a_placeholder_value_becomes_a_root_variable() {
        let mut vars = RuntimeAssetVars::new("animus");
        let mut meta = value_meta(serde_json::json!({ "rock": ROCK, "plain": "none", "n": 4 }));
        vars.lift_meta(&mut meta);

        let scale = &meta.value().unwrap().scale_values;
        let name = format!("--animus-asset-{}", content_hash(ROCK));
        assert_eq!(scale["rock"], Value::String(format!("var({name})")));
        assert_eq!(scale["plain"], "none");
        assert_eq!(scale["n"], 4);
        assert_eq!(vars.root_rule(), format!(":root {{\n  {name}: {ROCK};\n}}"));
    }

    #[test]
    fn declaration_records_lift_the_same_way_and_share_a_variable() {
        let mut vars = RuntimeAssetVars::new("animus");
        let mut declarations = DynamicPropMeta::Declarations(DeclarationPropMeta {
            kind: "declarations",
            slot_class: "animus-dcl-texture".into(),
            member_vars: BTreeMap::new(),
            declaration_scale_values: [(
                "rough".to_string(),
                [("backgroundImage".to_string(), ROCK.to_string()), ("color".to_string(), "red".to_string())]
                    .into_iter()
                    .collect(),
            )]
            .into_iter()
            .collect(),
            production_conditions: None,
        });
        let mut value = value_meta(serde_json::json!({ "rock": ROCK }));
        vars.lift_meta(&mut declarations);
        vars.lift_meta(&mut value);

        let DynamicPropMeta::Declarations(declarations) = declarations else { unreachable!() };
        let record = &declarations.declaration_scale_values["rough"];
        assert_eq!(Value::String(record["backgroundImage"].clone()), value.value().unwrap().scale_values["rock"]);
        assert_eq!(record["color"], "red");
        assert_eq!(vars.root_rule().matches("--animus-asset-").count(), 1);
    }

    #[test]
    fn no_placeholder_means_no_rule() {
        let mut vars = RuntimeAssetVars::new("animus");
        vars.lift_meta(&mut value_meta(serde_json::json!({ "plain": "none" })));
        assert_eq!(vars.root_rule(), "");
    }
}
