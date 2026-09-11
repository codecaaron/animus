//! Extension-chain topology: topological sort over the extension-provenance
//! graph, and parent→child config merging.

#[cfg(test)]
use serde_json::{Map, Value};
use std::collections::VecDeque;

use rustc_hash::{FxHashMap, FxHashSet};

/// Deep merge with lodash `merge()` semantics: objects merge key-by-key,
/// any other combination replaces the parent wholesale.
#[cfg(test)]
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
    /// A cycle was detected; the involved component IDs are listed.
    Cycle(Vec<String>),
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
        return TopoResult::Cycle(cycle_nodes);
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
            TopoResult::Cycle(_) => panic!("expected sorted result"),
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
            TopoResult::Cycle(_) => panic!("expected sorted result"),
        }
    }

    #[test]
    fn detects_cycle() {
        let nodes = vec![node("A", Some("B")), node("B", Some("A"))];
        match topological_sort(&nodes) {
            TopoResult::Cycle(cycle) => {
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
            TopoResult::Cycle(_) => panic!("expected sorted result"),
        }
    }

    #[test]
    fn single_node() {
        let nodes = vec![node("A", None)];
        match topological_sort(&nodes) {
            TopoResult::Sorted(order) => {
                assert_eq!(order, vec!["A".to_string()]);
            }
            TopoResult::Cycle(_) => panic!("expected sorted result"),
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
