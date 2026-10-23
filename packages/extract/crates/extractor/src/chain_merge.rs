//! Extension-chain topology: topological sort over the extension-provenance
//! graph, and parent→child config merging.

use serde_json::{Map, Value};
use std::borrow::Cow;
use std::collections::VecDeque;

use rustc_hash::{FxHashMap, FxHashSet};

use crate::evaluator::js_string_literal;
use crate::facts::{ChainFacts, StageFacts};
use crate::theme::PropConfigMap;

/// Deep merge matching the runtime builder's `deepMerge`: objects merge key
/// by key, and arrays and scalars replace the parent value.
pub fn deep_merge(parent: &Value, child: &Value) -> Value {
    match (parent, child) {
        (Value::Object(parent_map), Value::Object(child_map)) => {
            let mut merged = parent_map.clone();
            for (key, child_val) in child_map {
                if let Some(parent_val) = parent_map.get(key) {
                    merged.insert(key.clone(), deep_merge(parent_val, child_val));
                } else {
                    merged.insert(key.clone(), child_val.clone());
                }
            }
            Value::Object(merged)
        }
        (_, child) => child.clone(),
    }
}

/// Raw variant stage configs keyed by variant prop, in declaration order.
pub type VariantConfigs = Vec<(String, Value)>;

fn variant_prop(config: &Value) -> &str {
    config["prop"].as_str().unwrap_or("variant")
}

/// Stage facts write an omitted `defaultVariant` or `base` as null; an
/// omitted key must not replace the inherited value. A key evaluation could
/// not read replaces it, as in `authored`.
fn merge_variant_config(inherited: &Value, stage: &StageFacts, config: &Value) -> Value {
    let mut authored = config.clone();
    if let Value::Object(fields) = &mut authored {
        fields.retain(|_, field| !field.is_null());
    }
    for path in &stage.skipped_at {
        write_absent(&mut authored, path);
    }
    deep_merge(inherited, &authored)
}

/// What an extension inherits before resolution, as the runtime builder
/// holds it: the raw `styles` and `states` configs and each variant axis's
/// config, each merged over what its own parent inherited.
#[derive(Debug, Clone, Default)]
pub struct InheritedConfigs {
    pub styles: Option<Value>,
    pub states: Option<Value>,
    pub variants: VariantConfigs,
}

impl InheritedConfigs {
    /// The inherited raw config a `styles` or `states` stage merges over.
    fn raw(&self, method: &str) -> Option<&Option<Value>> {
        match method {
            "styles" => Some(&self.styles),
            "states" => Some(&self.states),
            _ => None,
        }
    }

    fn raw_mut(&mut self, method: &str) -> Option<&mut Option<Value>> {
        match method {
            "styles" => Some(&mut self.styles),
            "states" => Some(&mut self.states),
            _ => None,
        }
    }
}

/// The chain with its `styles` and `states` stages and each variant axis it
/// redeclares deep-merged over the inherited configs, as the runtime builder
/// merges them (`None` when no stage redeclares anything inherited), and
/// whether a `styles` or `states` stage merged.
pub fn inherit_stages(chain: &ChainFacts, inherited: &InheritedConfigs) -> (Option<ChainFacts>, bool) {
    let mut merged_chain: Option<ChainFacts> = None;
    let mut merged_props: FxHashSet<&str> = FxHashSet::default();
    let mut merged_methods: FxHashSet<&str> = FxHashSet::default();
    for (idx, stage) in chain.stages.iter().enumerate() {
        let Some(value) = stage.value.as_ref() else {
            continue;
        };
        let merged = match (stage.method.as_str(), inherited.raw(&stage.method)) {
            // The parent merges into the first declaration only.
            (method, Some(Some(parent))) if merged_methods.insert(method) => deep_merge(parent, &authored(stage, value)),
            ("variant", _) => {
                let prop = variant_prop(value);
                // A later same-prop stage keeps its own-chain handling; the
                // parent merges into the first declaration only.
                if !merged_props.insert(prop) {
                    continue;
                }
                let Some((_, parent_config)) = inherited.variants.iter().find(|(p, _)| p == prop) else {
                    continue;
                };
                merge_variant_config(parent_config, stage, value)
            }
            _ => continue,
        };
        merged_chain.get_or_insert_with(|| chain.clone()).stages[idx].value = Some(merged);
    }
    (merged_chain, !merged_methods.is_empty())
}

/// Whether the chain's own variant stages author `entry` for `prop` under the
/// axis option (`None` for its base) — the whole value, or the value at
/// `breakpoint` — rather than inheriting it from a merged-in parent.
pub fn authors_variant_entry(
    chain: &ChainFacts,
    axis: &str,
    option: Option<&str>,
    prop: &str,
    breakpoint: Option<&str>,
    entry: &Value,
) -> bool {
    chain
        .stages
        .iter()
        .filter_map(|stage| stage.value.as_ref().filter(|_| stage.method == "variant"))
        .filter(|config| variant_prop(config) == axis)
        .filter_map(|config| match option {
            Some(option) => config["variants"].get(option),
            None => config.get("base"),
        })
        .any(|styles| declares(styles, prop, breakpoint, entry))
}

/// Whether the chain's own variant stages write `key`, at any depth, under
/// the axis option (`None` for its base), rather than inheriting it from a
/// merged-in parent.
pub fn authors_variant_key(chain: &ChainFacts, axis: &str, option: Option<&str>, key: &str) -> bool {
    chain
        .stages
        .iter()
        .filter_map(|stage| stage.value.as_ref().filter(|_| stage.method == "variant"))
        .filter(|config| variant_prop(config) == axis)
        .filter_map(|config| match option {
            Some(option) => config["variants"].get(option),
            None => config.get("base"),
        })
        .any(|styles| writes_key(styles, key))
}

/// Whether the chain's own `styles` or `states` stage writes `key` in the
/// object `path` leads to: a `styles` path from its root, a `states` path
/// from the state's name.
pub fn authors_key_at(chain: &ChainFacts, path: &[String], key: &str) -> bool {
    chain
        .stages
        .iter()
        .filter(|stage| matches!(stage.method.as_str(), "styles" | "states"))
        .filter_map(|stage| path.iter().try_fold(stage.value.as_ref()?, |object, segment| object.get(segment)))
        .any(|object| object.get(key).is_some_and(|value| !value.is_null()))
}

/// The stage's config with each key evaluation could not read written as
/// absent, as the runtime's `deepMerge` writes that key's value over the
/// inherited one.
fn authored<'v>(stage: &StageFacts, value: &'v Value) -> Cow<'v, Value> {
    if stage.skipped_at.is_empty() {
        return Cow::Borrowed(value);
    }
    let mut authored = value.clone();
    for path in &stage.skipped_at {
        write_absent(&mut authored, path);
    }
    Cow::Owned(authored)
}

fn write_absent(value: &mut Value, path: &[String]) {
    let (Some((key, rest)), Some(entries)) = (path.split_first(), value.as_object_mut()) else {
        return;
    };
    let held = entries.entry(key.clone());
    if rest.is_empty() {
        held.or_insert(Value::Null);
    } else {
        write_absent(held.or_insert_with(|| Value::Object(Map::new())), rest);
    }
}

fn writes_key(styles: &Value, key: &str) -> bool {
    styles
        .as_object()
        .is_some_and(|entries| entries.contains_key(key) || entries.values().any(|nested| writes_key(nested, key)))
}

fn declares(styles: &Value, prop: &str, breakpoint: Option<&str>, entry: &Value) -> bool {
    styles.as_object().is_some_and(|entries| {
        let authored = entries.get(prop).map(|value| match breakpoint {
            Some(breakpoint) => value.get(breakpoint),
            None => Some(value),
        });
        authored.flatten() == Some(entry)
            || entries.values().any(|nested| declares(nested, prop, breakpoint, entry))
    })
}

/// The configs a child hands its own extensions: the inherited configs with
/// each of the chain's `styles`, `states` and variant stages merged in order.
pub fn effective_configs(chain: &ChainFacts, inherited: &InheritedConfigs) -> InheritedConfigs {
    let mut configs = inherited.clone();
    for stage in &chain.stages {
        let Some(value) = stage.value.as_ref() else {
            continue;
        };
        if stage.method == "variant" {
            let prop = variant_prop(value);
            match configs.variants.iter_mut().find(|(p, _)| p == prop) {
                Some((_, config)) => *config = merge_variant_config(config, stage, value),
                None => configs.variants.push((prop.to_string(), value.clone())),
            }
        } else if let Some(slot) = configs.raw_mut(&stage.method) {
            let value = authored(stage, value);
            *slot = Some(slot.as_ref().map_or_else(|| value.clone().into_owned(), |parent| deep_merge(parent, &value)));
        }
    }
    configs
}

/// The property of an extracted component holding the custom-prop callables
/// it delivers; the runtime's `createComponent` writes it.
const DELIVERED_TRANSFORMS: &str = "customTransforms";

/// The custom props a child hands its own extensions: every inherited
/// declaration, each replaced whole by one the chain declares itself. An
/// inherited callback is read from the extended parent as the child's module
/// names it (`parent_binding`), so its source and scope stay in the module
/// that declares it; the second result names those props, whose callables
/// the parent keeps delivering while the child does.
pub fn inherit_custom_configs(
    inherited: Option<&PropConfigMap>,
    own: Option<PropConfigMap>,
    parent_binding: &str,
) -> (Option<PropConfigMap>, FxHashSet<String>) {
    let Some(inherited) = inherited.filter(|configs| !configs.is_empty()) else {
        return (own, FxHashSet::default());
    };
    let own = own.unwrap_or_default();
    let mut read_from_parent = FxHashSet::default();
    let mut configs: PropConfigMap = inherited
        .iter()
        .map(|(prop, config)| {
            let mut config = config.clone();
            if config.transform_fn_source.is_some() {
                config.transform_fn_source = Some(format!(
                    "{parent_binding}.{DELIVERED_TRANSFORMS}[{}]",
                    js_string_literal(prop)
                ));
                if !own.contains_key(prop) {
                    read_from_parent.insert(prop.clone());
                }
            }
            (prop.clone(), config)
        })
        .collect();
    configs.extend(own);
    (Some(configs), read_from_parent)
}

#[derive(Debug, Clone)]
pub struct ProvenanceNode {
    /// Component identifier in "file::binding" format.
    pub component_id: String,
    /// The component this one extends, or `None` for root components.
    pub parent_id: Option<String>,
}

#[derive(Debug)]
pub enum TopoResult {
    /// Valid ordering: parents appear before their children.
    Sorted(Vec<String>),
    /// A cycle was detected: the component IDs it reaches, then every other
    /// ID in parents-first order.
    Cycle(Vec<String>, Vec<String>),
}

/// Topologically sort components by extension provenance (Kahn's algorithm);
/// returns `Cycle` when an extension chain is circular.
pub fn topological_sort(nodes: &[ProvenanceNode]) -> TopoResult {
    let known_ids: FxHashSet<&str> = nodes.iter().map(|n| n.component_id.as_str()).collect();

    let mut in_degree: FxHashMap<&str, usize> = FxHashMap::default();
    let mut children: FxHashMap<&str, Vec<&str>> = FxHashMap::default();

    for node in nodes {
        in_degree.entry(node.component_id.as_str()).or_insert(0);
    }

    for node in nodes {
        if let Some(parent_id) = &node.parent_id {
            if known_ids.contains(parent_id.as_str()) {
                *in_degree.entry(node.component_id.as_str()).or_insert(0) += 1;
                children
                    .entry(parent_id.as_str())
                    .or_default()
                    .push(node.component_id.as_str());
            }
            // A parent outside the slice is an external root, so this node
            // stays a root itself (in_degree 0).
        }
    }

    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    // Sorted for deterministic output.
    let mut queue_vec: Vec<&str> = queue.drain(..).collect();
    queue_vec.sort_unstable();
    queue.extend(queue_vec);

    let mut sorted: Vec<String> = Vec::with_capacity(nodes.len());

    while let Some(id) = queue.pop_front() {
        sorted.push(id.to_string());

        if let Some(child_list) = children.get(id) {
            // Sorted for deterministic output.
            let mut sorted_children = child_list.clone();
            sorted_children.sort_unstable();

            for child_id in sorted_children {
                let deg = in_degree.entry(child_id).or_insert(0);
                *deg -= 1;
                if *deg == 0 {
                    queue.push_back(child_id);
                }
            }
        }
    }

    if sorted.len() < nodes.len() {
        let sorted_set: FxHashSet<&str> = sorted.iter().map(|s| s.as_str()).collect();
        let cycle_nodes: Vec<String> = nodes
            .iter()
            .filter(|n| !sorted_set.contains(n.component_id.as_str()))
            .map(|n| n.component_id.clone())
            .collect();
        return TopoResult::Cycle(cycle_nodes, sorted);
    }

    TopoResult::Sorted(sorted)
}

/// Merge a parent and child component config field by field: parent-only
/// fields survive, shared fields deep-merge with the child winning.
#[cfg(test)]
pub fn merge_chain_configs(
    parent_config: &FxHashMap<String, Value>,
    child_config: &FxHashMap<String, Value>,
) -> FxHashMap<String, Value> {
    let empty_obj = Value::Object(Map::new());
    let mut merged: FxHashMap<String, Value> = FxHashMap::default();

    let all_keys: FxHashSet<&String> = parent_config.keys().chain(child_config.keys()).collect();

    for key in all_keys {
        let parent_val = parent_config.get(key).unwrap_or(&empty_obj);
        let child_val = child_config.get(key);

        let result = match child_val {
            Some(cv) => deep_merge(parent_val, cv),
            None => parent_val.clone(),
        };

        merged.insert(key.clone(), result);
    }

    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_flat_objects() {
        let parent = json!({ "a": 1, "b": 2 });
        let child = json!({ "b": 3, "c": 4 });
        let result = deep_merge(&parent, &child);
        assert_eq!(result, json!({ "a": 1, "b": 3, "c": 4 }));
    }

    #[test]
    fn merge_nested_objects() {
        let parent = json!({ "a": { "x": 1 } });
        let child = json!({ "a": { "y": 2 } });
        let result = deep_merge(&parent, &child);
        assert_eq!(result, json!({ "a": { "x": 1, "y": 2 } }));
    }

    #[test]
    fn child_overrides_scalar() {
        let parent = json!({ "a": 1 });
        let child = json!({ "a": 2 });
        let result = deep_merge(&parent, &child);
        assert_eq!(result, json!({ "a": 2 }));
    }

    #[test]
    fn child_replaces_array() {
        let parent = json!({ "a": [1, 2] });
        let child = json!({ "a": [3] });
        let result = deep_merge(&parent, &child);
        assert_eq!(result, json!({ "a": [3] }));
    }

    #[test]
    fn child_changes_type() {
        let parent = json!({ "a": 1 });
        let child = json!({ "a": { "x": 2 } });
        let result = deep_merge(&parent, &child);
        assert_eq!(result, json!({ "a": { "x": 2 } }));
    }

    #[test]
    fn parent_only_keys_preserved() {
        let parent = json!({ "a": 1, "b": 2 });
        let child = json!({ "a": 3 });
        let result = deep_merge(&parent, &child);
        assert_eq!(result, json!({ "a": 3, "b": 2 }));
    }

    #[test]
    fn deep_nested_merge() {
        let parent = json!({ "a": { "b": { "x": 1, "y": 2 } } });
        let child = json!({ "a": { "b": { "y": 99, "z": 3 } } });
        let result = deep_merge(&parent, &child);
        assert_eq!(result, json!({ "a": { "b": { "x": 1, "y": 99, "z": 3 } } }));
    }

    #[test]
    fn empty_parent() {
        let parent = json!({});
        let child = json!({ "a": 1 });
        let result = deep_merge(&parent, &child);
        assert_eq!(result, json!({ "a": 1 }));
    }

    #[test]
    fn empty_child() {
        let parent = json!({ "a": 1 });
        let child = json!({});
        let result = deep_merge(&parent, &child);
        assert_eq!(result, json!({ "a": 1 }));
    }

    fn node(id: &str, parent: Option<&str>) -> ProvenanceNode {
        ProvenanceNode {
            component_id: id.to_string(),
            parent_id: parent.map(|s| s.to_string()),
        }
    }

    #[test]
    fn sorts_simple_chain() {
        let nodes = vec![node("C", Some("B")), node("B", Some("A")), node("A", None)];
        match topological_sort(&nodes) {
            TopoResult::Sorted(order) => {
                let a = order.iter().position(|x| x == "A").unwrap();
                let b = order.iter().position(|x| x == "B").unwrap();
                let c = order.iter().position(|x| x == "C").unwrap();
                assert!(a < b, "A must come before B");
                assert!(b < c, "B must come before C");
            }
            TopoResult::Cycle(..) => panic!("expected sorted result"),
        }
    }

    #[test]
    fn sorts_forest() {
        let nodes = vec![
            node("A", None),
            node("B", Some("A")),
            node("C", None),
            node("D", Some("C")),
        ];
        match topological_sort(&nodes) {
            TopoResult::Sorted(order) => {
                assert_eq!(order.len(), 4);
                let a = order.iter().position(|x| x == "A").unwrap();
                let b = order.iter().position(|x| x == "B").unwrap();
                let c = order.iter().position(|x| x == "C").unwrap();
                let d = order.iter().position(|x| x == "D").unwrap();
                assert!(a < b, "A must come before B");
                assert!(c < d, "C must come before D");
            }
            TopoResult::Cycle(..) => panic!("expected sorted result"),
        }
    }

    #[test]
    fn detects_cycle() {
        let nodes = vec![node("A", Some("B")), node("B", Some("A"))];
        match topological_sort(&nodes) {
            TopoResult::Cycle(cycle, _) => {
                assert!(cycle.contains(&"A".to_string()) || cycle.contains(&"B".to_string()));
            }
            TopoResult::Sorted(_) => panic!("expected cycle detection"),
        }
    }

    #[test]
    fn roots_first() {
        let nodes = vec![node("B", Some("A")), node("A", None)];
        match topological_sort(&nodes) {
            TopoResult::Sorted(order) => {
                let a = order.iter().position(|x| x == "A").unwrap();
                let b = order.iter().position(|x| x == "B").unwrap();
                assert!(a < b, "A (root) must come before B (child)");
            }
            TopoResult::Cycle(..) => panic!("expected sorted result"),
        }
    }

    #[test]
    fn single_node() {
        let nodes = vec![node("A", None)];
        match topological_sort(&nodes) {
            TopoResult::Sorted(order) => {
                assert_eq!(order, vec!["A".to_string()]);
            }
            TopoResult::Cycle(..) => panic!("expected sorted result"),
        }
    }

    fn make_config(entries: &[(&str, Value)]) -> FxHashMap<String, Value> {
        entries
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn merges_base_styles() {
        let parent = make_config(&[("baseStyles", json!({ "padding": "8px" }))]);
        let child = make_config(&[("baseStyles", json!({ "color": "red" }))]);
        let result = merge_chain_configs(&parent, &child);
        assert_eq!(
            result["baseStyles"],
            json!({ "padding": "8px", "color": "red" })
        );
    }

    #[test]
    fn merges_variants_additively() {
        let parent = make_config(&[(
            "variants",
            json!({ "size": { "sm": { "fontSize": "12px" } } }),
        )]);
        let child = make_config(&[(
            "variants",
            json!({ "color": { "blue": { "color": "blue" } } }),
        )]);
        let result = merge_chain_configs(&parent, &child);
        assert!(result["variants"]["size"].is_object());
        assert!(result["variants"]["color"].is_object());
    }

    #[test]
    fn child_overrides_variant_option() {
        let parent = make_config(&[(
            "variants",
            json!({ "fill": { "bg": "blue" } }),
        )]);
        let child = make_config(&[(
            "variants",
            json!({ "fill": { "bg": "green" } }),
        )]);
        let result = merge_chain_configs(&parent, &child);
        assert_eq!(result["variants"]["fill"]["bg"], json!("green"));
    }

    #[test]
    fn merges_groups() {
        let parent = make_config(&[("activeGroups", json!({ "space": true }))]);
        let child = make_config(&[("activeGroups", json!({ "color": true }))]);
        let result = merge_chain_configs(&parent, &child);
        assert_eq!(result["activeGroups"]["space"], json!(true));
        assert_eq!(result["activeGroups"]["color"], json!(true));
    }

    #[test]
    fn child_only_field() {
        let parent = make_config(&[("baseStyles", json!({ "display": "flex" }))]);
        let child = make_config(&[(
            "statesConfig",
            json!({ "loading": { "opacity": 0 } }),
        )]);
        let result = merge_chain_configs(&parent, &child);
        assert!(result.contains_key("statesConfig"));
        assert_eq!(result["statesConfig"]["loading"]["opacity"], json!(0));
        assert!(result.contains_key("baseStyles"));
    }

    #[test]
    fn parent_only_field_preserved() {
        let parent = make_config(&[
            ("baseStyles", json!({ "padding": "4px" })),
            ("custom", json!({ "size": { "property": "flexBasis" } })),
        ]);
        let child = make_config(&[("baseStyles", json!({ "color": "blue" }))]);
        let result = merge_chain_configs(&parent, &child);
        assert!(result.contains_key("custom"));
        assert_eq!(
            result["custom"]["size"]["property"],
            json!("flexBasis")
        );
    }
}
