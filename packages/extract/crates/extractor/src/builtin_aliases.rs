//! The selector and condition aliases every system starts with, as the
//! system package defines them (`BUILT_IN_SELECTORS` in selectors.ts,
//! `BUILT_IN_CONDITIONS` in conditions.ts). They are an Animus version's,
//! not a team's, so the system fingerprint leaves out each one a system
//! keeps unchanged: adding a built-in renames no class, except where a
//! system already writes that alias with the same value as a custom one,
//! which renames once, when it becomes built in. The native module
//! publishes the table (`builtInAliases`), and a test of the extract
//! package holds it in step with the system's.

use serde_json::{json, Map, Value};

/// Each built-in selector alias and its selector.
pub const SELECTORS: &[(&str, &str)] = &[
    ("_link", "&:link"),
    ("_visited", "&:visited"),
    ("_hover", "&:hover"),
    ("_focusWithin", "&:focus-within"),
    ("_focus", "&:focus"),
    ("_focusVisible", "&:focus-visible"),
    ("_active", "&:active"),
    ("_target", "&:target"),
    ("_checked", "&:checked, &[aria-checked=\"true\"], &[data-checked]"),
    ("_invalid", "&:invalid, &[aria-invalid=\"true\"], &[data-invalid]"),
    ("_required", "&:required, &[aria-required=\"true\"]"),
    ("_readOnly", "&:read-only, &[aria-readonly=\"true\"], &[data-readonly]"),
    ("_expanded", "&[aria-expanded=\"true\"], &[data-expanded]"),
    ("_selected", "&[aria-selected=\"true\"], &[data-selected]"),
    ("_pressed", "&[aria-pressed=\"true\"], &[data-pressed]"),
    ("_disabled", "&:disabled, &[disabled], &[aria-disabled=\"true\"], &[data-disabled]"),
    ("_before", "&::before"),
    ("_after", "&::after"),
    ("_placeholder", "&::placeholder"),
    ("_selection", "&::selection"),
    ("_first", "&:first-child"),
    ("_last", "&:last-child"),
    ("_even", "&:nth-child(even)"),
    ("_odd", "&:nth-child(odd)"),
    ("_empty", "&:empty"),
];

/// Each built-in condition alias: its value, order and kind.
pub const CONDITIONS: &[(&str, &str, u32, &str)] = &[
    ("_motionReduce", "@media (prefers-reduced-motion: reduce)", 300, "media"),
    ("_motionSafe", "@media (prefers-reduced-motion: no-preference)", 310, "media"),
    ("_print", "@media print", 320, "media"),
    ("_portrait", "@media (orientation: portrait)", 330, "media"),
    ("_landscape", "@media (orientation: landscape)", 340, "media"),
    ("_moreContrast", "@media (prefers-contrast: more)", 350, "media"),
    ("_lessContrast", "@media (prefers-contrast: less)", 360, "media"),
    ("_osDark", "@media (prefers-color-scheme: dark)", 370, "media"),
    ("_osLight", "@media (prefers-color-scheme: light)", 380, "media"),
];

/// The table as JSON, in the system's serialized shapes: `{ selectors:
/// { alias: selector }, conditions: { alias: { value, order, kind } } }`.
pub fn json() -> String {
    let selectors: Map<String, Value> =
        SELECTORS.iter().map(|&(name, selector)| (name.to_string(), json!(selector))).collect();
    let conditions: Map<String, Value> = CONDITIONS
        .iter()
        .map(|&(name, value, order, kind)| (name.to_string(), json!({ "value": value, "order": order, "kind": kind })))
        .collect();
    json!({ "selectors": selectors, "conditions": conditions }).to_string()
}

/// A serialized alias map with each entry left out that is a built-in as
/// this table defines it, the rest by name: what the fingerprint reads of
/// it. The map's order is no part of it: the engine reads selector aliases
/// unordered, and a condition's rank is its entry's `order`. So a team's
/// alias that a later Animus builds in under the same name with another
/// value, which then takes the built-in's rank, keeps its classes; one with
/// the built-in's own value is left out from then on, which renames once.
/// A map the walk cannot parse is kept whole.
pub fn without_built_ins(json: Option<&str>, built_in: impl Fn(&str, &Value) -> bool) -> Option<String> {
    let json = json?;
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(json) else {
        return Some(json.to_string());
    };
    let mut kept: Vec<(String, Value)> = map.into_iter().filter(|(name, value)| !built_in(name, value)).collect();
    kept.sort_by(|(a, _), (b, _)| a.cmp(b));
    let kept: Map<String, Value> = kept.into_iter().collect();
    Some(Value::Object(kept).to_string())
}

/// Whether `value` is the selector alias `name` as built in.
pub fn is_built_in_selector(name: &str, value: &Value) -> bool {
    SELECTORS.iter().any(|&(built_in, selector)| built_in == name && value.as_str() == Some(selector))
}

/// Whether `value` is the condition alias `name` as built in.
pub fn is_built_in_condition(name: &str, value: &Value) -> bool {
    CONDITIONS.iter().any(|&(built_in, condition, order, kind)| {
        built_in == name && *value == json!({ "value": condition, "order": order, "kind": kind })
    })
}

#[cfg(test)]
mod tests {
    use crate::analyze_css::CssInputs;

    /// One of the table's two maps, as its JSON.
    fn json_part(key: &str) -> String {
        let all: serde_json::Value = serde_json::from_str(&super::json()).unwrap();
        all[key].to_string()
    }

    fn fingerprint(selectors: Option<&str>, conditions: Option<&str>) -> String {
        CssInputs::from_json(None, None, None, None, None, selectors, conditions, None, None, None, None, None, None, false)
            .unwrap()
            .system_fingerprint("animus")
    }

    /// Contract: the system fingerprint leaves out each built-in alias a
    /// system keeps unchanged, so a system holding every built-in, one, or
    /// none names its classes alike, and an Animus version that adds a
    /// built-in renames no class. A custom alias and a built-in it
    /// overrides still name them; the maps' order does not.
    #[test]
    fn the_fingerprint_leaves_unchanged_built_in_aliases_out() {
        let none = fingerprint(None, None);
        let empty = fingerprint(Some("{}"), Some("{}"));
        let all = fingerprint(Some(&json_part("selectors")), Some(&json_part("conditions")));
        let one = fingerprint(
            Some(r#"{"_hover":"&:hover"}"#),
            Some(r#"{"_print":{"value":"@media print","order":320,"kind":"media"}}"#),
        );
        assert_eq!(empty, all);
        assert_eq!(empty, one);
        assert_ne!(none, empty, "no alias map at all is not an empty one");
        let custom = fingerprint(Some(r#"{"_hover":"&:hover","_groupHover":".group:hover &"}"#), Some("{}"));
        let overridden = fingerprint(Some(r#"{"_hover":"&:hover:not(:active)"}"#), Some("{}"));
        let condition = fingerprint(Some("{}"), Some(r#"{"_print":{"value":"@media print","order":500,"kind":"media"}}"#));
        assert_ne!(custom, empty);
        assert_ne!(overridden, empty);
        assert_ne!(condition, empty, "a built-in at another order is no built-in");
        // The maps' order is no part of it: a team's alias that a later
        // Animus builds in under its name moves in the serialized order.
        let reordered = fingerprint(Some(r#"{"_b":"& b","_a":"& a"}"#), Some("{}"));
        assert_eq!(reordered, fingerprint(Some(r#"{"_a":"& a","_b":"& b"}"#), Some("{}")));
    }
}
