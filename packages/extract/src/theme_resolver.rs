use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Configuration for a single prop (from config.ts serialized).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PropConfig {
    pub property: String,
    #[serde(default)]
    pub properties: Vec<String>,
    #[serde(default)]
    pub scale: Option<Value>,
    #[serde(default)]
    pub transform: Option<String>,
}

/// The full prop config map: prop_name → PropConfig.
pub type PropConfigMap = HashMap<String, PropConfig>;

/// The flattened theme: "scale.key" → "css_value".
pub type FlatTheme = HashMap<String, String>;

/// Map of token paths to CSS variable names: "colors.primary" → "--color-primary".
pub type VariableMap = HashMap<String, String>;

/// The names that indicate responsive breakpoint keys.
const BREAKPOINT_KEYS: &[&str] = &["_", "xs", "sm", "md", "lg", "xl"];

/// A resolved CSS property-value pair.
#[derive(Debug, Clone, PartialEq)]
pub struct CssDeclaration {
    pub property: String,
    pub value: String,
}

/// Result of resolving a style object.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResolvedStyles {
    /// Regular CSS declarations.
    pub declarations: Vec<CssDeclaration>,
    /// Pseudo-selector groups: selector → declarations.
    pub pseudo_selectors: Vec<(String, Vec<CssDeclaration>)>,
    /// Responsive declarations: breakpoint_name → declarations.
    pub responsive: Vec<(String, Vec<CssDeclaration>)>,
    /// Responsive pseudo-selectors: breakpoint_name → (selector → declarations).
    pub responsive_pseudos: Vec<(String, Vec<(String, Vec<CssDeclaration>)>)>,
}

/// Resolve a style value map against the config and theme.
pub fn resolve_styles(
    styles: &Value,
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
) -> ResolvedStyles {
    let mut result = ResolvedStyles::default();

    let obj = match styles.as_object() {
        Some(o) => o,
        None => return result,
    };

    for (key, value) in obj {
        // Check if this is a pseudo-selector
        if key.starts_with('&') || key.starts_with(':') {
            let selector = normalize_pseudo_selector(key);
            if let Some(nested_obj) = value.as_object() {
                let nested_styles = resolve_flat_styles(nested_obj, config, theme, variable_map);
                result.pseudo_selectors.push((selector, nested_styles));
            }
            continue;
        }

        // Check if value is a responsive object
        if is_responsive_value(value) {
            resolve_responsive_prop(key, value, config, theme, variable_map, &mut result);
            continue;
        }

        // Regular prop resolution
        let declarations = resolve_single_prop(key, value, config, theme, variable_map);
        result.declarations.extend(declarations);
    }

    result
}

/// Check if a value is a responsive breakpoint object.
/// Responsive objects have keys that are ALL breakpoint names (_/xs/sm/md/lg/xl).
/// The `_` key is optional — `{ sm: 16, lg: 24 }` is valid (no default).
fn is_responsive_value(value: &Value) -> bool {
    if let Some(obj) = value.as_object() {
        !obj.is_empty()
            && obj
                .keys()
                .all(|k| BREAKPOINT_KEYS.contains(&k.as_str()))
    } else {
        false
    }
}

/// Resolve a responsive prop into default + breakpoint declarations.
fn resolve_responsive_prop(
    prop_name: &str,
    value: &Value,
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    result: &mut ResolvedStyles,
) {
    let obj = match value.as_object() {
        Some(o) => o,
        None => return,
    };

    for (bp_key, bp_value) in obj {
        let declarations = resolve_single_prop(prop_name, bp_value, config, theme, variable_map);
        if bp_key == "_" {
            // Default (no media query)
            result.declarations.extend(declarations);
        } else {
            // Find existing responsive entry for this breakpoint or create new
            let existing = result.responsive.iter_mut().find(|(k, _)| k == bp_key);
            if let Some((_, decls)) = existing {
                decls.extend(declarations);
            } else {
                result.responsive.push((bp_key.clone(), declarations));
            }
        }
    }
}

/// Resolve a flat style object (no responsive, no pseudo) into declarations.
fn resolve_flat_styles(
    obj: &Map<String, Value>,
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
) -> Vec<CssDeclaration> {
    let mut declarations = Vec::new();
    for (key, value) in obj {
        declarations.extend(resolve_single_prop(key, value, config, theme, variable_map));
    }
    declarations
}

/// Resolve a single prop to one or more CSS declarations.
fn resolve_single_prop(
    prop_name: &str,
    value: &Value,
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
) -> Vec<CssDeclaration> {
    // If no config entry, treat as pass-through CSS property
    let prop_config = match config.get(prop_name) {
        Some(c) => c,
        None => {
            // Direct CSS property (e.g., userSelect, cursor, content)
            if let Some(css_value) = value_to_css_string(value) {
                let resolved = resolve_token_aliases(&css_value, theme, variable_map);
                return vec![CssDeclaration {
                    property: camel_to_kebab(prop_name),
                    value: resolved,
                }];
            }
            return vec![];
        }
    };

    // Resolve the value against the theme scale, then resolve any token aliases
    let resolved_value = resolve_value(value, prop_config, theme);
    let resolved_value = match resolved_value {
        Some(v) => resolve_token_aliases(&v, theme, variable_map),
        None => return vec![],
    };

    // Determine which CSS properties to emit
    let properties = if prop_config.properties.is_empty() {
        vec![prop_config.property.clone()]
    } else {
        prop_config.properties.clone()
    };

    properties
        .into_iter()
        .map(|css_prop| CssDeclaration {
            property: camel_to_kebab(&css_prop),
            value: resolved_value.clone(),
        })
        .collect()
}

/// Resolve a value using scale lookup and transform.
fn resolve_value(value: &Value, config: &PropConfig, theme: &FlatTheme) -> Option<String> {
    // 1. Try scale lookup
    let mut resolved = None;
    if let Some(scale_value) = &config.scale {
        let key = match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        if !key.is_empty() {
            match scale_value {
                // String → theme scale reference (e.g. "colors" → lookup "colors.primary")
                Value::String(scale_name) => {
                    let lookup_key = format!("{}.{}", scale_name, key);
                    if let Some(theme_value) = theme.get(&lookup_key) {
                        resolved = Some(Value::String(theme_value.clone()));
                    }
                }
                // Object → inline map scale (e.g. { xs: "10rem", sm: "15rem" })
                Value::Object(inline_map) => {
                    if let Some(map_value) = inline_map.get(&key) {
                        if let Some(s) = map_value.as_str() {
                            resolved = Some(Value::String(s.to_string()));
                        } else {
                            resolved = Some(map_value.clone());
                        }
                    }
                }
                // Array → if empty (createScale phantom), passthrough.
                // If non-empty, check membership.
                Value::Array(arr) => {
                    if !arr.is_empty() {
                        // Non-empty array scale: value must be a member
                        let found = arr.iter().any(|item| {
                            match (item, value) {
                                (Value::String(a), Value::String(b)) => a == b,
                                (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
                                _ => false,
                            }
                        });
                        if found {
                            // Value is valid, use as-is (no transformation from scale)
                            resolved = Some(value.clone());
                        }
                    }
                    // Empty array (createScale phantom) → passthrough, resolved stays None
                    // Value passes through raw — it already type-checked in TS
                }
                _ => {}
            }
        }
    }

    let final_value = resolved.as_ref().unwrap_or(value);

    // 2. Emit transform placeholder if configured (applied in JS post-processing)
    // Apply transform when: scale resolved, no scale configured, or scale is an
    // empty array (createScale phantom — value passes through to transform).
    if let Some(transform_name) = &config.transform {
        let scale_is_empty_array = matches!(&config.scale, Some(Value::Array(a)) if a.is_empty());
        let use_transform = resolved.is_some() || config.scale.is_none() || scale_is_empty_array;
        if use_transform {
            if let Some(raw_str) = value_to_css_string(final_value) {
                return Some(format!("__TRANSFORM__{}__{}__", transform_name, raw_str));
            }
        }
    }

    // 3. Convert to CSS string
    value_to_css_string(final_value)
}

/// Resolve `{scale.path}` token alias patterns in a CSS value string.
///
/// Scans for `{...}` patterns and resolves each against the theme.
/// Supports alpha modifier: `{colors.primary/50}` → `color-mix(in srgb, var(--color-primary) 50%, transparent)`.
///
/// Dot-path-to-flat-key conversion: first segment is the scale name, remaining
/// segments are joined with hyphens. `{colors.pink.600}` → flat key `colors.pink-600`.
fn resolve_token_aliases(
    value: &str,
    theme: &FlatTheme,
    variable_map: &VariableMap,
) -> String {
    // Fast path: no braces → no aliases
    if !value.contains('{') {
        return value.to_string();
    }

    let mut result = String::with_capacity(value.len());
    let mut chars = value.char_indices().peekable();

    while let Some((i, ch)) = chars.next() {
        if ch == '{' {
            // Find matching closing brace
            let _start = i;
            let mut end = None;
            let content_start = i + 1;
            while let Some(&(j, c)) = chars.peek() {
                chars.next();
                if c == '}' {
                    end = Some(j);
                    break;
                }
            }

            if let Some(end_idx) = end {
                let alias_content = &value[content_start..end_idx];
                let resolved = resolve_single_alias(alias_content, theme, variable_map);
                result.push_str(&resolved);
            } else {
                // No closing brace — emit as-is
                result.push('{');
                result.push_str(&value[content_start..]);
                break;
            }
        } else {
            result.push(ch);
        }
    }

    result
}

/// Resolve a single token alias content (without braces).
///
/// Handles: `scale.path`, `scale.path/alpha`
fn resolve_single_alias(
    content: &str,
    theme: &FlatTheme,
    variable_map: &VariableMap,
) -> String {
    // Split on '/' to extract alpha modifier
    let (token_path, alpha) = match content.split_once('/') {
        Some((path, alpha_str)) => {
            let alpha: Option<u32> = alpha_str.parse().ok();
            (path, alpha)
        }
        None => (content, None),
    };

    // Convert dot path to flat key: first.rest.of.path → first.rest-of-path
    let flat_key = dot_path_to_flat_key(token_path);

    // Resolve: check variable map first, then flat theme
    let resolved = if let Some(var_name) = variable_map.get(&flat_key) {
        format!("var({})", var_name)
    } else if let Some(literal) = theme.get(&flat_key) {
        literal.clone()
    } else {
        // Unresolved — return original alias text as-is
        return format!("{{{}}}", content);
    };

    // Apply alpha modifier if present
    match alpha {
        Some(0) => "transparent".to_string(),
        Some(100) | None => resolved,
        Some(pct) => {
            format!("color-mix(in srgb, {} {}%, transparent)", resolved, pct)
        }
    }
}

/// Convert a lodash-style dot path to a flat theme key.
///
/// First segment is the scale name, remaining segments join with hyphens.
/// `colors.pink.600` → `colors.pink-600`
/// `colors.primary` → `colors.primary`
/// `space.8` → `space.8`
fn dot_path_to_flat_key(path: &str) -> String {
    let mut parts = path.splitn(2, '.');
    let scale = match parts.next() {
        Some(s) => s,
        None => return path.to_string(),
    };
    let rest = match parts.next() {
        Some(r) => r,
        None => return path.to_string(),
    };

    // The rest may contain more dots — join them with hyphens
    let flat_rest = rest.replace('.', "-");
    format!("{}.{}", scale, flat_rest)
}

/// Convert a JSON value to a CSS-safe string.
fn value_to_css_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i == 0 {
                    Some("0".to_string())
                } else {
                    Some(i.to_string())
                }
            } else {
                Some(n.to_string())
            }
        }
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// Convert camelCase to kebab-case for CSS property names.
fn camel_to_kebab(s: &str) -> String {
    // Handle vendor prefixes
    if s.starts_with("Webkit") {
        let rest = &s[6..];
        return format!("-webkit-{}", camel_to_kebab_inner(rest));
    }
    if s.starts_with("Moz") {
        let rest = &s[3..];
        return format!("-moz-{}", camel_to_kebab_inner(rest));
    }
    if s.starts_with("ms") && s.chars().nth(2).map_or(false, |c| c.is_uppercase()) {
        let rest = &s[2..];
        return format!("-ms-{}", camel_to_kebab_inner(rest));
    }

    camel_to_kebab_inner(s)
}

fn camel_to_kebab_inner(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                result.push('-');
            }
            result.push(c.to_lowercase().next().unwrap());
        } else {
            result.push(c);
        }
    }
    result
}

/// Normalize pseudo-selector from Emotion format to CSS format.
/// `&:hover` → `:hover`, `&:before` → `::before`, `&:after` → `::after`
fn normalize_pseudo_selector(selector: &str) -> String {
    let s = selector.trim_start_matches('&');

    // Normalize single-colon pseudo-elements to double-colon
    if s == ":before" || s == ":after" || s == ":first-line" || s == ":first-letter" {
        return format!(":{}", s);
    }

    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_config() -> PropConfigMap {
        let mut config = HashMap::new();
        config.insert(
            "p".to_string(),
            PropConfig {
                property: "padding".to_string(),
                properties: vec![],
                scale: Some(Value::String("space".to_string())),
                transform: None,
            },
        );
        config.insert(
            "px".to_string(),
            PropConfig {
                property: "padding".to_string(),
                properties: vec!["paddingLeft".to_string(), "paddingRight".to_string()],
                scale: Some(Value::String("space".to_string())),
                transform: None,
            },
        );
        config.insert(
            "width".to_string(),
            PropConfig {
                property: "width".to_string(),
                properties: vec![],
                scale: None,
                transform: Some("size".to_string()),
            },
        );
        config.insert(
            "color".to_string(),
            PropConfig {
                property: "color".to_string(),
                properties: vec![],
                scale: Some(Value::String("colors".to_string())),
                transform: None,
            },
        );
        config.insert(
            "display".to_string(),
            PropConfig {
                property: "display".to_string(),
                properties: vec![],
                scale: None,
                transform: None,
            },
        );
        config.insert(
            "borderRadius".to_string(),
            PropConfig {
                property: "borderRadius".to_string(),
                properties: vec![],
                scale: Some(Value::String("radii".to_string())),
                transform: Some("size".to_string()),
            },
        );
        config
    }

    fn test_theme() -> FlatTheme {
        let mut theme = HashMap::new();
        theme.insert("space.0".to_string(), "0".to_string());
        theme.insert("space.8".to_string(), "0.5rem".to_string());
        theme.insert("space.16".to_string(), "1rem".to_string());
        theme.insert("space.24".to_string(), "1.5rem".to_string());
        theme.insert("space.32".to_string(), "2rem".to_string());
        theme.insert(
            "colors.background".to_string(),
            "var(--colors-background)".to_string(),
        );
        theme.insert(
            "colors.primary".to_string(),
            "var(--colors-primary)".to_string(),
        );
        theme.insert("radii.4".to_string(), "4px".to_string());
        theme
    }

    fn empty_variable_map() -> VariableMap {
        HashMap::new()
    }

    #[test]
    fn resolve_scale_lookup() {
        let config = test_config();
        let theme = test_theme();
        let vars = empty_variable_map();
        let styles = json!({ "p": 8 });
        let resolved = resolve_styles(&styles, &config, &theme, &vars);
        assert_eq!(resolved.declarations.len(), 1);
        assert_eq!(resolved.declarations[0].property, "padding");
        assert_eq!(resolved.declarations[0].value, "0.5rem");
    }

    #[test]
    fn resolve_color_variable() {
        let config = test_config();
        let theme = test_theme();
        let vars = empty_variable_map();
        let styles = json!({ "color": "background" });
        let resolved = resolve_styles(&styles, &config, &theme, &vars);
        assert_eq!(resolved.declarations[0].property, "color");
        assert_eq!(resolved.declarations[0].value, "var(--colors-background)");
    }

    #[test]
    fn resolve_size_transform_placeholder() {
        let config = test_config();
        let theme = test_theme();
        let vars = empty_variable_map();
        let styles = json!({ "width": 1 });
        let resolved = resolve_styles(&styles, &config, &theme, &vars);
        assert_eq!(resolved.declarations[0].property, "width");
        assert_eq!(resolved.declarations[0].value, "__TRANSFORM__size__1__");
    }

    #[test]
    fn resolve_multi_property() {
        let config = test_config();
        let theme = test_theme();
        let vars = empty_variable_map();
        let styles = json!({ "px": 16 });
        let resolved = resolve_styles(&styles, &config, &theme, &vars);
        assert_eq!(resolved.declarations.len(), 2);
        assert_eq!(resolved.declarations[0].property, "padding-left");
        assert_eq!(resolved.declarations[0].value, "1rem");
        assert_eq!(resolved.declarations[1].property, "padding-right");
        assert_eq!(resolved.declarations[1].value, "1rem");
    }

    #[test]
    fn resolve_no_scale_passthrough() {
        let config = test_config();
        let theme = test_theme();
        let vars = empty_variable_map();
        let styles = json!({ "display": "flex" });
        let resolved = resolve_styles(&styles, &config, &theme, &vars);
        assert_eq!(resolved.declarations[0].property, "display");
        assert_eq!(resolved.declarations[0].value, "flex");
    }

    #[test]
    fn resolve_pseudo_selector() {
        let config = test_config();
        let theme = test_theme();
        let vars = empty_variable_map();
        let styles = json!({ "&:hover": { "color": "primary" } });
        let resolved = resolve_styles(&styles, &config, &theme, &vars);
        assert_eq!(resolved.declarations.len(), 0);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        assert_eq!(resolved.pseudo_selectors[0].0, ":hover");
        assert_eq!(resolved.pseudo_selectors[0].1[0].value, "var(--colors-primary)");
    }

    #[test]
    fn resolve_responsive() {
        let config = test_config();
        let theme = test_theme();
        let vars = empty_variable_map();
        let styles = json!({ "p": { "_": 8, "sm": 16 } });
        let resolved = resolve_styles(&styles, &config, &theme, &vars);
        // Default value
        assert_eq!(resolved.declarations.len(), 1);
        assert_eq!(resolved.declarations[0].value, "0.5rem");
        // Breakpoint value
        assert_eq!(resolved.responsive.len(), 1);
        assert_eq!(resolved.responsive[0].0, "sm");
        assert_eq!(resolved.responsive[0].1[0].value, "1rem");
    }

    #[test]
    fn resolve_unknown_prop_passthrough() {
        let config = test_config();
        let theme = test_theme();
        let vars = empty_variable_map();
        let styles = json!({ "cursor": "pointer" });
        let resolved = resolve_styles(&styles, &config, &theme, &vars);
        assert_eq!(resolved.declarations[0].property, "cursor");
        assert_eq!(resolved.declarations[0].value, "pointer");
    }

    #[test]
    fn camel_to_kebab_basic() {
        assert_eq!(camel_to_kebab("backgroundColor"), "background-color");
        assert_eq!(camel_to_kebab("fontSize"), "font-size");
        assert_eq!(camel_to_kebab("display"), "display");
    }

    #[test]
    fn camel_to_kebab_vendor() {
        assert_eq!(
            camel_to_kebab("WebkitTextFillColor"),
            "-webkit-text-fill-color"
        );
    }

    #[test]
    fn resolve_scale_with_transform_placeholder() {
        let config = test_config();
        let theme = test_theme();
        let vars = empty_variable_map();
        let styles = json!({ "borderRadius": 4 });
        let resolved = resolve_styles(&styles, &config, &theme, &vars);
        assert_eq!(resolved.declarations[0].property, "border-radius");
        // Scale lookup finds "4px", then emits placeholder for JS transform
        assert_eq!(resolved.declarations[0].value, "__TRANSFORM__size__4px__");
    }

    // --- Token alias tests ---

    fn test_variable_map() -> VariableMap {
        let mut vars = HashMap::new();
        vars.insert("colors.primary".to_string(), "--color-primary".to_string());
        vars.insert("colors.background".to_string(), "--color-background".to_string());
        vars.insert("colors.pink-600".to_string(), "--color-pink-600".to_string());
        vars
    }

    #[test]
    fn dot_path_conversion() {
        assert_eq!(dot_path_to_flat_key("colors.primary"), "colors.primary");
        assert_eq!(dot_path_to_flat_key("colors.pink.600"), "colors.pink-600");
        assert_eq!(dot_path_to_flat_key("colors.gradient.pink.soft"), "colors.gradient-pink-soft");
        assert_eq!(dot_path_to_flat_key("space.8"), "space.8");
    }

    #[test]
    fn alias_basic_variable_resolution() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary}", &theme, &vars);
        assert_eq!(result, "var(--color-primary)");
    }

    #[test]
    fn alias_literal_resolution() {
        let theme = test_theme();
        let vars = empty_variable_map();
        let result = resolve_token_aliases("{space.8}", &theme, &vars);
        assert_eq!(result, "0.5rem");
    }

    #[test]
    fn alias_in_compound_value() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("1px solid {colors.primary}", &theme, &vars);
        assert_eq!(result, "1px solid var(--color-primary)");
    }

    #[test]
    fn alias_multiple_in_one_value() {
        let theme = test_theme();
        let vars = empty_variable_map();
        let result = resolve_token_aliases("{space.8} {space.16}", &theme, &vars);
        assert_eq!(result, "0.5rem 1rem");
    }

    #[test]
    fn alias_alpha_50() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary/50}", &theme, &vars);
        assert_eq!(result, "color-mix(in srgb, var(--color-primary) 50%, transparent)");
    }

    #[test]
    fn alias_alpha_100_identity() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary/100}", &theme, &vars);
        assert_eq!(result, "var(--color-primary)");
    }

    #[test]
    fn alias_alpha_0_transparent() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary/0}", &theme, &vars);
        assert_eq!(result, "transparent");
    }

    #[test]
    fn alias_nested_dot_path() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.pink.600}", &theme, &vars);
        assert_eq!(result, "var(--color-pink-600)");
    }

    #[test]
    fn alias_unresolved_passthrough() {
        let theme = test_theme();
        let vars = empty_variable_map();
        let result = resolve_token_aliases("{colors.nonexistent}", &theme, &vars);
        assert_eq!(result, "{colors.nonexistent}");
    }

    #[test]
    fn alias_no_braces_passthrough() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("1px solid red", &theme, &vars);
        assert_eq!(result, "1px solid red");
    }

    #[test]
    fn alias_alpha_in_compound() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("0 4px 12px {colors.primary/20}", &theme, &vars);
        assert_eq!(result, "0 4px 12px color-mix(in srgb, var(--color-primary) 20%, transparent)");
    }
}
