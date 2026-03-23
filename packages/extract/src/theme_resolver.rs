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
    pub scale: Option<String>,
    #[serde(default)]
    pub transform: Option<String>,
}

/// The full prop config map: prop_name → PropConfig.
pub type PropConfigMap = HashMap<String, PropConfig>;

/// The flattened theme: "scale.key" → "css_value".
pub type FlatTheme = HashMap<String, String>;

/// Breakpoint map: breakpoint_name → pixel value.
#[derive(Debug, Clone, Deserialize)]
pub struct Breakpoints {
    #[serde(default)]
    pub xs: Option<u32>,
    #[serde(default)]
    pub sm: Option<u32>,
    #[serde(default)]
    pub md: Option<u32>,
    #[serde(default)]
    pub lg: Option<u32>,
    #[serde(default)]
    pub xl: Option<u32>,
}

/// The names that indicate responsive breakpoint keys.
const BREAKPOINT_KEYS: &[&str] = &["_", "xs", "sm", "md", "lg", "xl"];

/// A resolved CSS property-value pair.
#[derive(Debug, Clone)]
pub struct CssDeclaration {
    pub property: String,
    pub value: String,
}

/// Result of resolving a style object.
#[derive(Debug, Clone, Default)]
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
                let nested_styles = resolve_flat_styles(nested_obj, config, theme);
                result.pseudo_selectors.push((selector, nested_styles));
            }
            continue;
        }

        // Check if value is a responsive object
        if is_responsive_value(value) {
            resolve_responsive_prop(key, value, config, theme, &mut result);
            continue;
        }

        // Regular prop resolution
        let declarations = resolve_single_prop(key, value, config, theme);
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
    result: &mut ResolvedStyles,
) {
    let obj = match value.as_object() {
        Some(o) => o,
        None => return,
    };

    for (bp_key, bp_value) in obj {
        let declarations = resolve_single_prop(prop_name, bp_value, config, theme);
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
) -> Vec<CssDeclaration> {
    let mut declarations = Vec::new();
    for (key, value) in obj {
        declarations.extend(resolve_single_prop(key, value, config, theme));
    }
    declarations
}

/// Resolve a single prop to one or more CSS declarations.
fn resolve_single_prop(
    prop_name: &str,
    value: &Value,
    config: &PropConfigMap,
    theme: &FlatTheme,
) -> Vec<CssDeclaration> {
    // If no config entry, treat as pass-through CSS property
    let prop_config = match config.get(prop_name) {
        Some(c) => c,
        None => {
            // Direct CSS property (e.g., userSelect, cursor, content)
            if let Some(css_value) = value_to_css_string(value) {
                return vec![CssDeclaration {
                    property: camel_to_kebab(prop_name),
                    value: css_value,
                }];
            }
            return vec![];
        }
    };

    // Resolve the value against the theme scale
    let resolved_value = resolve_value(value, prop_config, theme);
    let resolved_value = match resolved_value {
        Some(v) => v,
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
    if let Some(scale_name) = &config.scale {
        let key = match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        if !key.is_empty() {
            let lookup_key = format!("{}.{}", scale_name, key);
            if let Some(theme_value) = theme.get(&lookup_key) {
                resolved = Some(Value::String(theme_value.clone()));
            }
        }
    }

    let final_value = resolved.as_ref().unwrap_or(value);

    // 2. Emit transform placeholder if configured (applied in JS post-processing)
    if let Some(transform_name) = &config.transform {
        let use_transform = resolved.is_some() || config.scale.is_none();
        if use_transform {
            if let Some(raw_str) = value_to_css_string(final_value) {
                return Some(format!("__TRANSFORM__{}__{}__", transform_name, raw_str));
            }
        }
    }

    // 3. Convert to CSS string
    value_to_css_string(final_value)
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
                scale: Some("space".to_string()),
                transform: None,
            },
        );
        config.insert(
            "px".to_string(),
            PropConfig {
                property: "padding".to_string(),
                properties: vec!["paddingLeft".to_string(), "paddingRight".to_string()],
                scale: Some("space".to_string()),
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
                scale: Some("colors".to_string()),
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
                scale: Some("radii".to_string()),
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

    #[test]
    fn resolve_scale_lookup() {
        let config = test_config();
        let theme = test_theme();
        let styles = json!({ "p": 8 });
        let resolved = resolve_styles(&styles, &config, &theme);
        assert_eq!(resolved.declarations.len(), 1);
        assert_eq!(resolved.declarations[0].property, "padding");
        assert_eq!(resolved.declarations[0].value, "0.5rem");
    }

    #[test]
    fn resolve_color_variable() {
        let config = test_config();
        let theme = test_theme();
        let styles = json!({ "color": "background" });
        let resolved = resolve_styles(&styles, &config, &theme);
        assert_eq!(resolved.declarations[0].property, "color");
        assert_eq!(resolved.declarations[0].value, "var(--colors-background)");
    }

    #[test]
    fn resolve_size_transform_placeholder() {
        let config = test_config();
        let theme = test_theme();
        let styles = json!({ "width": 1 });
        let resolved = resolve_styles(&styles, &config, &theme);
        assert_eq!(resolved.declarations[0].property, "width");
        assert_eq!(resolved.declarations[0].value, "__TRANSFORM__size__1__");
    }

    #[test]
    fn resolve_multi_property() {
        let config = test_config();
        let theme = test_theme();
        let styles = json!({ "px": 16 });
        let resolved = resolve_styles(&styles, &config, &theme);
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
        let styles = json!({ "display": "flex" });
        let resolved = resolve_styles(&styles, &config, &theme);
        assert_eq!(resolved.declarations[0].property, "display");
        assert_eq!(resolved.declarations[0].value, "flex");
    }

    #[test]
    fn resolve_pseudo_selector() {
        let config = test_config();
        let theme = test_theme();
        let styles = json!({ "&:hover": { "color": "primary" } });
        let resolved = resolve_styles(&styles, &config, &theme);
        assert_eq!(resolved.declarations.len(), 0);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        assert_eq!(resolved.pseudo_selectors[0].0, ":hover");
        assert_eq!(resolved.pseudo_selectors[0].1[0].value, "var(--colors-primary)");
    }

    #[test]
    fn resolve_responsive() {
        let config = test_config();
        let theme = test_theme();
        let styles = json!({ "p": { "_": 8, "sm": 16 } });
        let resolved = resolve_styles(&styles, &config, &theme);
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
        let styles = json!({ "cursor": "pointer" });
        let resolved = resolve_styles(&styles, &config, &theme);
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
        let styles = json!({ "borderRadius": 4 });
        let resolved = resolve_styles(&styles, &config, &theme);
        assert_eq!(resolved.declarations[0].property, "border-radius");
        // Scale lookup finds "4px", then emits placeholder for JS transform
        assert_eq!(resolved.declarations[0].value, "__TRANSFORM__size__4px__");
    }
}
