use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};

/// Deep merge two JSON values with lodash `merge()` semantics.
///
/// - Both objects: merged key-by-key, recursing into shared keys
/// - Any other combination: child replaces parent entirely
pub fn deep_merge(parent: &Value, child: &Value) -> Value {
    match (parent, child) {
        // Both objects: merge key-by-key
        (Value::Object(parent_map), Value::Object(child_map)) => {
            let mut merged = parent_map.clone();
            for (key, child_val) in child_map {
                if let Some(parent_val) = parent_map.get(key) {
                    // Key exists in both: recurse
                    merged.insert(key.clone(), deep_merge(parent_val, child_val));
                } else {
                    // Key only in child: add
                    merged.insert(key.clone(), child_val.clone());
                }
            }
            Value::Object(merged)
        }
        // Any other case: child replaces parent
        (_, child) => child.clone(),
    }
}

/// A node in the provenance graph describing a component's extension relationship.
#[derive(Debug, Clone)]
pub struct ProvenanceNode {
    /// Component identifier in "file::binding" format.
    pub component_id: String,
    /// The component this one extends, or `None` for root components.
    pub parent_id: Option<String>,
}

/// Result of a topological sort over the provenance graph.
#[derive(Debug)]
pub enum TopoResult {
    /// Valid ordering: parents appear before their children.
    Sorted(Vec<String>),
    /// A cycle was detected; the involved component IDs are listed.
    Cycle(Vec<String>),
}

/// Topologically sort components by their extension provenance using Kahn's algorithm.
///
/// Components with no parent come first, followed by their children in dependency order.
/// Returns `TopoResult::Cycle` if any circular extension chain is detected.
pub fn topological_sort(nodes: &[ProvenanceNode]) -> TopoResult {
    // Build a set of all known IDs so we can handle parent references to nodes
    // not present in the slice gracefully (treat as external roots).
    let known_ids: HashSet<&str> = nodes.iter().map(|n| n.component_id.as_str()).collect();

    // in_degree: how many incoming edges (parents) each node has within the known set
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    // children: parent_id → list of child IDs
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();

    // Initialise every node with in_degree 0
    for node in nodes {
        in_degree.entry(node.component_id.as_str()).or_insert(0);
    }

    // Build edges only between nodes that are both present in the slice
    for node in nodes {
        if let Some(parent_id) = &node.parent_id {
            if known_ids.contains(parent_id.as_str()) {
                // Parent is present: add a real edge
                *in_degree.entry(node.component_id.as_str()).or_insert(0) += 1;
                children
                    .entry(parent_id.as_str())
                    .or_default()
                    .push(node.component_id.as_str());
            }
            // If parent is NOT in the slice it is an external root; treat this node as a
            // root itself (in_degree stays 0).
        }
    }

    // Seed the queue with all nodes that have no in-slice parent
    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    // Sort the initial queue for deterministic output
    let mut queue_vec: Vec<&str> = queue.drain(..).collect();
    queue_vec.sort_unstable();
    queue.extend(queue_vec);

    let mut sorted: Vec<String> = Vec::with_capacity(nodes.len());

    while let Some(id) = queue.pop_front() {
        sorted.push(id.to_string());

        if let Some(child_list) = children.get(id) {
            // Sort children for deterministic output
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

    // If sorted length < total nodes, a cycle exists
    if sorted.len() < nodes.len() {
        let sorted_set: HashSet<&str> = sorted.iter().map(|s| s.as_str()).collect();
        let cycle_nodes: Vec<String> = nodes
            .iter()
            .filter(|n| !sorted_set.contains(n.component_id.as_str()))
            .map(|n| n.component_id.clone())
            .collect();
        return TopoResult::Cycle(cycle_nodes);
    }

    TopoResult::Sorted(sorted)
}

/// Merge an extension chain: given the evaluated configs of a parent and child component,
/// produce the merged config.
///
/// Each config maps field names to `serde_json::Value`. Known fields are:
/// `"baseStyles"`, `"variants"`, `"statesConfig"`, `"activeGroups"`, `"custom"`.
///
/// Fields present only in the parent are preserved. Fields present in the child are
/// deep-merged with the parent's corresponding value (defaulting to an empty object
/// when the parent lacks that field).
pub fn merge_chain_configs(
    parent_config: &HashMap<String, Value>,
    child_config: &HashMap<String, Value>,
) -> HashMap<String, Value> {
    let empty_obj = Value::Object(Map::new());
    let mut merged: HashMap<String, Value> = HashMap::new();

    // Collect all field names from both configs
    let all_keys: HashSet<&String> = parent_config.keys().chain(child_config.keys()).collect();

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

    // -------------------------------------------------------------------------
    // deep_merge tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // topological_sort tests
    // -------------------------------------------------------------------------

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
        // Two independent chains: A→B and C→D
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
        // A extends B, B extends A
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

    // -------------------------------------------------------------------------
    // merge_chain_configs tests
    // -------------------------------------------------------------------------

    fn make_config(entries: &[(&str, Value)]) -> HashMap<String, Value> {
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
        // Both variant keys should be present
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
        // Parent has no statesConfig; child adds it
        let parent = make_config(&[("baseStyles", json!({ "display": "flex" }))]);
        let child = make_config(&[(
            "statesConfig",
            json!({ "loading": { "opacity": 0 } }),
        )]);
        let result = merge_chain_configs(&parent, &child);
        assert!(result.contains_key("statesConfig"));
        assert_eq!(result["statesConfig"]["loading"]["opacity"], json!(0));
        // Parent field still present
        assert!(result.contains_key("baseStyles"));
    }

    #[test]
    fn parent_only_field_preserved() {
        // Parent has custom props; child doesn't declare them
        let parent = make_config(&[
            ("baseStyles", json!({ "padding": "4px" })),
            ("custom", json!({ "size": { "property": "flexBasis" } })),
        ]);
        let child = make_config(&[("baseStyles", json!({ "color": "blue" }))]);
        let result = merge_chain_configs(&parent, &child);
        // custom field from parent must survive
        assert!(result.contains_key("custom"));
        assert_eq!(
            result["custom"]["size"]["property"],
            json!("flexBasis")
        );
    }
}
