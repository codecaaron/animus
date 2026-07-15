//! DynamicPropMeta — v1 project_analyzer's shape, mirrored for the CSS
//! port (row 07). Sorted serialization per the row-09 determinism class.
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
    /// BTreeMap: deterministic key order by construction.
    pub scale_values: BTreeMap<String, String>,
}
