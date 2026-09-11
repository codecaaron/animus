use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicPropMeta {
    pub var_name: String,
    pub slot_class: String,
    pub property: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<String>,
    pub transform_name: Option<String>,
    pub transform_fn_source: Option<String>,
    /// BTreeMap: serialization order must be deterministic.
    pub scale_values: BTreeMap<String, String>,
}
