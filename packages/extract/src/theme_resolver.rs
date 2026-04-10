use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

// ---------------------------------------------------------------------------
// CSS shorthand properties for cascade-tier ordering.
// Mirrors packages/core/src/properties/orderPropNames.ts.
// Props whose `property` field matches one of these are "shorthand-tier"
// and must sort before longhand props to ensure override correctness
// (e.g., `px` emits before `pl` so `pl`'s padding-left wins by cascade).
// ---------------------------------------------------------------------------
const CSS_SHORTHANDS: &[&str] = &[
    "border",
    "borderTop",
    "borderBottom",
    "borderLeft",
    "borderRight",
    "borderWidth",
    "borderStyle",
    "borderColor",
    "background",
    "flex",
    "margin",
    "padding",
    "transition",
    "gap",
    "grid",
    "gridArea",
    "gridColumn",
    "gridRow",
    "gridTemplate",
    "overflow",
];

/// Returns a cascade-ordering key for a DS prop based on its config.
/// Lower key = less specific = should emit first in CSS.
///
/// Tier 0: True CSS shorthand (e.g., `p` → padding, no multi-properties)
/// Tier 1: Multi-target shorthand (e.g., `px` → paddingLeft + paddingRight)
///         Within tier 1, more properties = less specific = sorts earlier.
/// Tier 2: Direct longhand (e.g., `pl` → paddingLeft)
/// Tier 3: Unknown prop (pass-through CSS, no config entry)
fn prop_cascade_tier(prop_name: &str, config: &PropConfigMap) -> (usize, usize) {
    match config.get(prop_name) {
        Some(pc) => {
            let is_shorthand = CSS_SHORTHANDS.iter().any(|&s| s == pc.property);
            if is_shorthand {
                if pc.properties.is_empty() {
                    // True shorthand: `p` → padding (sets all sides)
                    (0, 0)
                } else {
                    // Multi-target: `px` → paddingLeft + paddingRight
                    // More properties = less specific = lower sort value
                    (1, 1000 - pc.properties.len())
                }
            } else {
                // Direct longhand: `pl` → paddingLeft
                (2, 0)
            }
        }
        // Unknown / pass-through CSS property
        None => (3, 0),
    }
}

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
    #[serde(default, rename = "currentVar")]
    pub current_var: Option<String>,
    /// Inline transform function source text, captured from `.props()` configs.
    /// When present, emitted directly in replacement JS instead of using the
    /// shared `transforms` registry. Populated by style_evaluator span capture.
    #[serde(default, rename = "transformFnSource")]
    pub transform_fn_source: Option<String>,
}

/// The full prop config map: prop_name → PropConfig.
pub type PropConfigMap = HashMap<String, PropConfig>;

/// The flattened theme: "scale.key" → "css_value".
pub type FlatTheme = HashMap<String, String>;

/// Map of token paths to CSS variable names: "colors.primary" → "--color-primary".
pub type VariableMap = HashMap<String, String>;

/// Contextual vars registry: scale_name → [var_name]. CSS prop derived as --{name}.
pub type ContextualVarsMap = HashMap<String, Vec<String>>;

/// Selector alias map: "_hover" → "&:hover", "_disabled" → "&:disabled, &[disabled], ..."
pub type SelectorAliasesMap = HashMap<String, String>;

/// Shared immutable context for style resolution. Constructed once per extraction run
/// and threaded by reference through every `resolve_styles` call.
pub struct ResolveContext<'a> {
    pub config: &'a PropConfigMap,
    pub theme: &'a FlatTheme,
    pub variable_map: &'a VariableMap,
    pub contextual_vars: &'a ContextualVarsMap,
    pub breakpoint_keys: &'a HashSet<String>,
    pub selector_aliases: &'a SelectorAliasesMap,
}

/// The set of valid breakpoint key names, derived from the serialized theme.

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
///
/// `auto_content`: when true, `_before`/`_after` blocks auto-inject `content: ""`.
/// Should be true for `.styles()` (base definitions) and false for variant/compound/state
/// overrides where the base pseudo-element already provides content.
pub fn resolve_styles(
    styles: &Value,
    ctx: &ResolveContext,
    auto_content: bool,
) -> ResolvedStyles {
    let mut result = ResolvedStyles::default();

    let obj = match styles.as_object() {
        Some(o) => o,
        None => return result,
    };

    // Sort props by cascade tier: true shorthands → multi-target shorthands → longhands.
    // Uses stable sort to preserve IndexMap insertion order within each tier.
    let mut entries: Vec<(&String, &Value)> = obj.iter().collect();
    entries.sort_by(|(a, _), (b, _)| {
        prop_cascade_tier(a, ctx.config).cmp(&prop_cascade_tier(b, ctx.config))
    });

    for (key, value) in entries {
        // Check if this is a selector alias (_hover, _disabled, etc.)
        if key.starts_with('_') {
            if let Some(alias_selector) = ctx.selector_aliases.get(key) {
                if let Some(nested_obj) = value.as_object() {
                    let mut nested_styles =
                        resolve_flat_styles(nested_obj, ctx.config, ctx.theme, ctx.variable_map, ctx.contextual_vars);

                    // Auto-default content: "" for _before / _after (base only)
                    if auto_content
                        && (key == "_before" || key == "_after")
                        && !nested_styles.iter().any(|d| d.property == "content")
                    {
                        nested_styles.insert(
                            0,
                            CssDeclaration {
                                property: "content".to_string(),
                                value: "\"\"".to_string(),
                            },
                        );
                    }

                    let selector = normalize_pseudo_selector(alias_selector);
                    merge_pseudo_selectors(&mut result.pseudo_selectors, selector, nested_styles);
                }
            }
            continue;
        }

        // Check if this is a raw pseudo-selector
        if key.starts_with('&') || key.starts_with(':') {
            let selector = normalize_pseudo_selector(key);
            if let Some(nested_obj) = value.as_object() {
                let nested_styles =
                    resolve_flat_styles(nested_obj, ctx.config, ctx.theme, ctx.variable_map, ctx.contextual_vars);
                merge_pseudo_selectors(&mut result.pseudo_selectors, selector, nested_styles);
            }
            continue;
        }

        // Check if value is a responsive object
        if is_responsive_value(value, ctx.breakpoint_keys) {
            resolve_responsive_prop(
                key,
                value,
                ctx.config,
                ctx.theme,
                ctx.variable_map,
                ctx.contextual_vars,
                &mut result,
            );
            continue;
        }

        // Regular prop resolution
        let declarations =
            resolve_single_prop(key, value, ctx.config, ctx.theme, ctx.variable_map, ctx.contextual_vars);
        result.declarations.extend(declarations);
    }

    result
}

/// Merge declarations into the pseudo_selectors list.
/// If the selector already exists, merge declarations (last-write-wins per property).
/// If not, append a new entry.
pub fn merge_pseudo_selectors(
    pseudo_selectors: &mut Vec<(String, Vec<CssDeclaration>)>,
    selector: String,
    new_declarations: Vec<CssDeclaration>,
) {
    if let Some((_, existing)) = pseudo_selectors.iter_mut().find(|(s, _)| *s == selector) {
        // Merge: for each new declaration, replace existing with same property or append
        for new_decl in new_declarations {
            if let Some(pos) = existing.iter().position(|d| d.property == new_decl.property) {
                existing[pos] = new_decl;
            } else {
                existing.push(new_decl);
            }
        }
    } else {
        pseudo_selectors.push((selector, new_declarations));
    }
}

/// Check if a value is a responsive breakpoint object.
/// Responsive objects have keys that are ALL either `_` (default) or members
/// of the theme-derived breakpoint key set.
/// The `_` key is optional — `{ sm: 16, lg: 24 }` is valid (no default).
fn is_responsive_value(value: &Value, breakpoint_keys: &HashSet<String>) -> bool {
    if let Some(obj) = value.as_object() {
        !obj.is_empty()
            && obj
                .keys()
                .all(|k| k == "_" || breakpoint_keys.contains(k))
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
    contextual_vars: &ContextualVarsMap,
    result: &mut ResolvedStyles,
) {
    let obj = match value.as_object() {
        Some(o) => o,
        None => return,
    };

    for (bp_key, bp_value) in obj {
        let declarations =
            resolve_single_prop(prop_name, bp_value, config, theme, variable_map, contextual_vars);
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
    contextual_vars: &ContextualVarsMap,
) -> Vec<CssDeclaration> {
    // Sort props by cascade tier (same as resolve_styles).
    let mut entries: Vec<(&String, &Value)> = obj.iter().collect();
    entries.sort_by(|(a, _), (b, _)| {
        prop_cascade_tier(a, config).cmp(&prop_cascade_tier(b, config))
    });

    let mut declarations = Vec::new();
    for (key, value) in entries {
        declarations.extend(resolve_single_prop(
            key,
            value,
            config,
            theme,
            variable_map,
            contextual_vars,
        ));
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
    contextual_vars: &ContextualVarsMap,
) -> Vec<CssDeclaration> {
    // If no config entry, treat as pass-through CSS property
    let prop_config = match config.get(prop_name) {
        Some(c) => c,
        None => {
            // Direct CSS property (e.g., userSelect, cursor, content)
            if let Some(css_value) = value_to_css_string(value) {
                let resolved =
                    resolve_token_aliases(&css_value, theme, variable_map, contextual_vars);
                return vec![CssDeclaration {
                    property: camel_to_kebab(prop_name),
                    value: resolved,
                }];
            }
            return vec![];
        }
    };

    // Resolve: token manifest first (via scale lookup), then contextual vars, then raw passthrough
    let resolved_value = {
        let rv = resolve_value(value, prop_config, theme);
        match rv {
            Some(v) => {
                let aliased = resolve_token_aliases(&v, theme, variable_map, contextual_vars);
                // If scale lookup didn't match (value passed through raw), check contextual vars
                if let Value::String(val_str) = value {
                    if aliased == *val_str {
                        if let Some(Value::String(scale_name)) = &prop_config.scale {
                            if let Some(ctx) =
                                resolve_contextual_var(scale_name, val_str, contextual_vars)
                            {
                                ctx
                            } else {
                                aliased
                            }
                        } else {
                            aliased
                        }
                    } else {
                        aliased
                    }
                } else {
                    aliased
                }
            }
            None => return vec![],
        }
    };

    // Determine which CSS properties to emit
    let properties = if prop_config.properties.is_empty() {
        vec![prop_config.property.clone()]
    } else {
        prop_config.properties.clone()
    };

    let mut declarations: Vec<CssDeclaration> = properties
        .into_iter()
        .map(|css_prop| CssDeclaration {
            property: camel_to_kebab(&css_prop),
            value: resolved_value.clone(),
        })
        .collect();

    // Auto-emission: if prop has currentVar, emit a sibling CSS custom property declaration
    if let Some(current_var) = &prop_config.current_var {
        // Self-referential guard: skip if resolved value REFERENCES the contextual var
        // (exact match OR contained within a color-mix/expression)
        let self_ref = format!("var({})", current_var);
        if !resolved_value.contains(&self_ref) {
            declarations.push(CssDeclaration {
                property: current_var.clone(),
                value: resolved_value,
            });
        }
    }

    declarations
}

/// Check if a value is a contextual var name for a given scale.
/// Returns the resolved CSS var reference if found: var(--{name}).
/// Token manifest takes precedence — only resolves if NOT in the theme.
fn resolve_contextual_var(
    scale_name: &str,
    value: &str,
    contextual_vars: &ContextualVarsMap,
) -> Option<String> {
    if let Some(var_names) = contextual_vars.get(scale_name) {
        if var_names.iter().any(|n| n == value) {
            return Some(format!("var(--{})", value));
        }
    }
    None
}

/// Resolve a value using scale lookup and transform.
fn resolve_value(value: &Value, config: &PropConfig, theme: &FlatTheme) -> Option<String> {
    // 0. Detect negative numeric values — abs for lookup, negate result
    // Preserve integer representation to avoid "8.0" vs "8" key mismatch
    let (is_negative, lookup_value) = match value {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i < 0 {
                    (true, Value::Number(serde_json::Number::from(i.unsigned_abs())))
                } else {
                    (false, value.clone())
                }
            } else if let Some(f) = n.as_f64() {
                if f < 0.0 {
                    let abs = serde_json::Number::from_f64(f.abs())
                        .unwrap_or_else(|| serde_json::Number::from_f64(0.0).unwrap());
                    (true, Value::Number(abs))
                } else {
                    (false, value.clone())
                }
            } else {
                (false, value.clone())
            }
        }
        _ => (false, value.clone()),
    };

    // 1. Try scale lookup
    let mut resolved = None;
    if let Some(scale_value) = &config.scale {
        let key = match &lookup_value {
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
                            match (item, &lookup_value) {
                                (Value::String(a), Value::String(b)) => a == b,
                                (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
                                _ => false,
                            }
                        });
                        if found {
                            // Value is valid, use as-is (no transformation from scale)
                            resolved = Some(lookup_value.clone());
                        }
                    }
                    // Empty array (createScale phantom) → passthrough, resolved stays None
                    // Value passes through raw — it already type-checked in TS
                }
                _ => {}
            }
        }
    }

    let final_value = resolved.as_ref().unwrap_or(&lookup_value);

    // 2. Emit transform placeholder if configured (applied in JS post-processing)
    // Apply transform when: scale resolved, no scale configured, or scale is an
    // empty array (createScale phantom — value passes through to transform).
    if let Some(transform_name) = &config.transform {
        let scale_is_empty_array = matches!(&config.scale, Some(Value::Array(a)) if a.is_empty());
        let use_transform = resolved.is_some() || config.scale.is_none() || scale_is_empty_array;
        if use_transform {
            if let Some(raw_str) = value_to_css_string(final_value) {
                let css = format!("__TRANSFORM__{}__{}__", transform_name, raw_str);
                return Some(if is_negative {
                    negate_css_value(&css)
                } else {
                    css
                });
            }
        }
    }

    // 3. Convert to CSS string, negate if needed
    let css = value_to_css_string(final_value);
    if is_negative {
        css.map(|v| negate_css_value(&v))
    } else {
        css
    }
}

/// Negate a CSS value string: numeric → prepend minus, string with unit → prepend minus.
fn negate_css_value(val: &str) -> String {
    if val.starts_with('-') {
        // Already negative (double negation) → strip the minus
        val[1..].to_string()
    } else {
        format!("-{}", val)
    }
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
    contextual_vars: &ContextualVarsMap,
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
                let resolved =
                    resolve_single_alias(alias_content, theme, variable_map, contextual_vars);
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
    contextual_vars: &ContextualVarsMap,
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

    // Resolve: check variable map first, then flat theme, then contextual vars
    let resolved = if let Some(var_name) = variable_map.get(&flat_key) {
        format!("var({})", var_name)
    } else if let Some(literal) = theme.get(&flat_key) {
        literal.clone()
    } else if let Some(dot_idx) = token_path.find('.') {
        // Check contextual vars: extract scale name and var name from dot path
        let scale_name = &token_path[..dot_idx];
        let var_name = &token_path[dot_idx + 1..];
        if let Some(ctx_resolved) = resolve_contextual_var(scale_name, var_name, contextual_vars) {
            ctx_resolved
        } else {
            // Unresolved — return original alias text as-is
            return format!("{{{}}}", content);
        }
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

/// Convert a dot path to a flat theme key.
///
/// With nested theme storage, the tokenMap uses dot-path keys throughout.
/// This is now a passthrough — the dot path IS the flat key.
/// `colors.pink.600` → `colors.pink.600`
/// `colors.primary` → `colors.primary`
/// `space.8` → `space.8`
fn dot_path_to_flat_key(path: &str) -> String {
    path.to_string()
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
/// Handles comma-separated selectors: `&:hover, &:focus` → `:hover, :focus`
fn normalize_pseudo_selector(selector: &str) -> String {
    selector
        .split(',')
        .map(|part| {
            let trimmed = part.trim().trim_start_matches('&');
            // Normalize single-colon pseudo-elements to double-colon
            match trimmed {
                ":before" | ":after" | ":first-line" | ":first-letter" => {
                    format!(":{}", trimmed)
                }
                _ => trimmed.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

// ---------------------------------------------------------------------------
// Global style block resolution
// ---------------------------------------------------------------------------

/// Resolve a global style block into raw CSS.
///
/// The input `block` is a JSON object: `{ selector → { prop → value } }`.
/// Each selector's style object is resolved through prop config (scale lookup,
/// transforms → `__TRANSFORM__` placeholders, token aliases).
///
/// `@keyframes` selectors receive special handling: their values are
/// `{ "0%" → { prop → value }, "100%" → { prop → value } }`.
pub fn resolve_global_block(
    block: &Value,
    ctx: &ResolveContext,
) -> String {
    let selectors = match block.as_object() {
        Some(o) => o,
        None => return String::new(),
    };

    let mut rules: Vec<String> = Vec::new();

    for (selector, style_obj) in selectors {
        if selector.starts_with("@keyframes") {
            // @keyframes: value is { "0%" → { prop → value }, "100%" → { ... } }
            let stops = match style_obj.as_object() {
                Some(o) => o,
                None => continue,
            };
            let mut frames: Vec<String> = Vec::new();
            for (pct, frame_styles) in stops {
                let frame_obj = match frame_styles.as_object() {
                    Some(o) => o,
                    None => continue,
                };
                let decls = resolve_flat_styles(
                    frame_obj,
                    ctx.config,
                    ctx.theme,
                    ctx.variable_map,
                    ctx.contextual_vars,
                );
                if !decls.is_empty() {
                    let decl_str: String = decls
                        .iter()
                        .map(|d| format!("    {}: {};", d.property, d.value))
                        .collect::<Vec<_>>()
                        .join("\n");
                    frames.push(format!("  {} {{\n{}\n  }}", pct, decl_str));
                }
            }
            if !frames.is_empty() {
                rules.push(format!("{} {{\n{}\n}}", selector, frames.join("\n")));
            }
            continue;
        }

        // Regular selector: value is { prop → value }
        let style_map = match style_obj.as_object() {
            Some(o) => o,
            None => continue,
        };
        let decls = resolve_flat_styles(
            style_map,
            ctx.config,
            ctx.theme,
            ctx.variable_map,
            ctx.contextual_vars,
        );
        if !decls.is_empty() {
            let decl_str: String = decls
                .iter()
                .map(|d| format!("  {}: {};", d.property, d.value))
                .collect::<Vec<_>>()
                .join("\n");
            rules.push(format!("{} {{\n{}\n}}", selector, decl_str));
        }
    }

    rules.join("\n\n")
}

/// Resolve all global style blocks into a single CSS string.
///
/// Input: `{ blockName → { selector → { prop → value } } }`.
/// Block names are for identification only — all blocks emit into the same CSS output.
pub fn resolve_all_global_blocks(
    blocks: &Value,
    ctx: &ResolveContext,
) -> String {
    let block_map = match blocks.as_object() {
        Some(o) => o,
        None => return String::new(),
    };

    let mut parts: Vec<String> = Vec::new();
    for (_name, block) in block_map {
        let css = resolve_global_block(block, ctx);
        if !css.is_empty() {
            parts.push(css);
        }
    }

    parts.join("\n\n")
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
                current_var: None,
                transform_fn_source: None,
            },
        );
        config.insert(
            "px".to_string(),
            PropConfig {
                property: "padding".to_string(),
                properties: vec!["paddingLeft".to_string(), "paddingRight".to_string()],
                scale: Some(Value::String("space".to_string())),
                transform: None,
                current_var: None,
                transform_fn_source: None,
            },
        );
        config.insert(
            "py".to_string(),
            PropConfig {
                property: "padding".to_string(),
                properties: vec!["paddingTop".to_string(), "paddingBottom".to_string()],
                scale: Some(Value::String("space".to_string())),
                transform: None,
                current_var: None,
                transform_fn_source: None,
            },
        );
        config.insert(
            "pl".to_string(),
            PropConfig {
                property: "paddingLeft".to_string(),
                properties: vec![],
                scale: Some(Value::String("space".to_string())),
                transform: None,
                current_var: None,
                transform_fn_source: None,
            },
        );
        config.insert(
            "width".to_string(),
            PropConfig {
                property: "width".to_string(),
                properties: vec![],
                scale: None,
                transform: Some("size".to_string()),
                current_var: None,
                transform_fn_source: None,
            },
        );
        config.insert(
            "color".to_string(),
            PropConfig {
                property: "color".to_string(),
                properties: vec![],
                scale: Some(Value::String("colors".to_string())),
                transform: None,
                current_var: None,
                transform_fn_source: None,
            },
        );
        config.insert(
            "display".to_string(),
            PropConfig {
                property: "display".to_string(),
                properties: vec![],
                scale: None,
                transform: None,
                current_var: None,
                transform_fn_source: None,
            },
        );
        config.insert(
            "borderRadius".to_string(),
            PropConfig {
                property: "borderRadius".to_string(),
                properties: vec![],
                scale: Some(Value::String("radii".to_string())),
                transform: Some("size".to_string()),
                current_var: None,
                transform_fn_source: None,
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

    fn empty_selector_aliases() -> SelectorAliasesMap {
        HashMap::new()
    }

    fn test_bp_keys() -> HashSet<String> {
        HashSet::from(["_", "xs", "sm", "md", "lg", "xl"].map(|s| s.to_string()))
    }

    /// Owns all resolution data and provides a `ctx()` method for borrowing.
    struct TestCtxOwner {
        config: PropConfigMap,
        theme: FlatTheme,
        variable_map: VariableMap,
        contextual_vars: ContextualVarsMap,
        breakpoint_keys: HashSet<String>,
        selector_aliases: SelectorAliasesMap,
    }

    impl TestCtxOwner {
        fn new() -> Self {
            Self {
                config: test_config(),
                theme: test_theme(),
                variable_map: empty_variable_map(),
                contextual_vars: ContextualVarsMap::new(),
                breakpoint_keys: test_bp_keys(),
                selector_aliases: empty_selector_aliases(),
            }
        }

        fn with_aliases(mut self) -> Self {
            self.selector_aliases = test_selector_aliases();
            self.breakpoint_keys = HashSet::new();
            self
        }

        fn ctx(&self) -> ResolveContext {
            ResolveContext {
                config: &self.config,
                theme: &self.theme,
                variable_map: &self.variable_map,
                contextual_vars: &self.contextual_vars,
                breakpoint_keys: &self.breakpoint_keys,
                selector_aliases: &self.selector_aliases,
            }
        }
    }

    #[test]
    fn resolve_scale_lookup() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "p": 8 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations.len(), 1);
        assert_eq!(resolved.declarations[0].property, "padding");
        assert_eq!(resolved.declarations[0].value, "0.5rem");
    }

    #[test]
    fn resolve_color_variable() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "color": "background" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "color");
        assert_eq!(resolved.declarations[0].value, "var(--colors-background)");
    }

    #[test]
    fn resolve_size_transform_placeholder() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "width": 1 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "width");
        assert_eq!(resolved.declarations[0].value, "__TRANSFORM__size__1__");
    }

    #[test]
    fn resolve_multi_property() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "px": 16 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations.len(), 2);
        assert_eq!(resolved.declarations[0].property, "padding-left");
        assert_eq!(resolved.declarations[0].value, "1rem");
        assert_eq!(resolved.declarations[1].property, "padding-right");
        assert_eq!(resolved.declarations[1].value, "1rem");
    }

    #[test]
    fn resolve_no_scale_passthrough() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "display": "flex" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "display");
        assert_eq!(resolved.declarations[0].value, "flex");
    }

    #[test]
    fn resolve_pseudo_selector() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "&:hover": { "color": "primary" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations.len(), 0);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        assert_eq!(resolved.pseudo_selectors[0].0, ":hover");
        assert_eq!(resolved.pseudo_selectors[0].1[0].value, "var(--colors-primary)");
    }

    #[test]
    fn resolve_responsive() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "p": { "_": 8, "sm": 16 } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
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
        let owner = TestCtxOwner::new();
        let styles = json!({ "cursor": "pointer" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
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
        let owner = TestCtxOwner::new();
        let styles = json!({ "borderRadius": 4 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "border-radius");
        // Scale lookup finds "4px", then emits placeholder for JS transform
        assert_eq!(resolved.declarations[0].value, "__TRANSFORM__size__4px__");
    }

    // --- Token alias tests ---

    fn test_variable_map() -> VariableMap {
        let mut vars = HashMap::new();
        vars.insert("colors.primary".to_string(), "--color-primary".to_string());
        vars.insert("colors.background".to_string(), "--color-background".to_string());
        vars.insert("colors.pink.600".to_string(), "--color-pink-600".to_string());
        vars
    }

    #[test]
    fn dot_path_conversion() {
        // With nested storage, dot paths are now passthrough — the dot path IS the key
        assert_eq!(dot_path_to_flat_key("colors.primary"), "colors.primary");
        assert_eq!(dot_path_to_flat_key("colors.pink.600"), "colors.pink.600");
        assert_eq!(dot_path_to_flat_key("colors.gradient.pink.soft"), "colors.gradient.pink.soft");
        assert_eq!(dot_path_to_flat_key("space.8"), "space.8");
    }

    #[test]
    fn alias_basic_variable_resolution() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "var(--color-primary)");
    }

    #[test]
    fn alias_literal_resolution() {
        let theme = test_theme();
        let vars = empty_variable_map();
        let result = resolve_token_aliases("{space.8}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "0.5rem");
    }

    #[test]
    fn alias_in_compound_value() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("1px solid {colors.primary}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "1px solid var(--color-primary)");
    }

    #[test]
    fn alias_multiple_in_one_value() {
        let theme = test_theme();
        let vars = empty_variable_map();
        let result = resolve_token_aliases("{space.8} {space.16}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "0.5rem 1rem");
    }

    #[test]
    fn alias_alpha_50() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary/50}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "color-mix(in srgb, var(--color-primary) 50%, transparent)");
    }

    #[test]
    fn alias_alpha_100_identity() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary/100}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "var(--color-primary)");
    }

    #[test]
    fn alias_alpha_0_transparent() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary/0}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "transparent");
    }

    #[test]
    fn alias_nested_dot_path() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.pink.600}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "var(--color-pink-600)");
    }

    #[test]
    fn alias_unresolved_passthrough() {
        let theme = test_theme();
        let vars = empty_variable_map();
        let result = resolve_token_aliases("{colors.nonexistent}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "{colors.nonexistent}");
    }

    #[test]
    fn alias_no_braces_passthrough() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("1px solid red", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "1px solid red");
    }

    #[test]
    fn alias_alpha_in_compound() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("0 4px 12px {colors.primary/20}", &theme, &vars, &ContextualVarsMap::new());
        assert_eq!(result, "0 4px 12px color-mix(in srgb, var(--color-primary) 20%, transparent)");
    }

    // --- Selector alias tests ---

    fn test_selector_aliases() -> SelectorAliasesMap {
        let mut map = HashMap::new();
        map.insert("_hover".to_string(), "&:hover".to_string());
        map.insert("_active".to_string(), "&:active".to_string());
        map.insert("_disabled".to_string(), "&:disabled, &[disabled], &[aria-disabled=\"true\"], &[data-disabled]".to_string());
        map.insert("_before".to_string(), "&::before".to_string());
        map.insert("_after".to_string(), "&::after".to_string());
        map.insert("_focus".to_string(), "&:focus".to_string());
        map
    }

    #[test]
    fn resolve_selector_alias_hover() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({ "_hover": { "color": "primary" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations.len(), 0);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        assert_eq!(resolved.pseudo_selectors[0].0, ":hover");
        assert_eq!(resolved.pseudo_selectors[0].1[0].value, "var(--colors-primary)");
    }

    #[test]
    fn resolve_selector_alias_disabled_compound() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({ "_disabled": { "p": 8 } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        // Compound selector preserved as comma-separated (normalized)
        assert!(resolved.pseudo_selectors[0].0.contains(":disabled"));
        assert!(resolved.pseudo_selectors[0].0.contains("[data-disabled]"));
        assert_eq!(resolved.pseudo_selectors[0].1[0].property, "padding");
        assert_eq!(resolved.pseudo_selectors[0].1[0].value, "0.5rem");
    }

    #[test]
    fn resolve_before_content_autodefault() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({ "_before": { "display": "block" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        assert_eq!(resolved.pseudo_selectors[0].0, "::before");
        // content: "" auto-injected
        assert_eq!(resolved.pseudo_selectors[0].1[0].property, "content");
        assert_eq!(resolved.pseudo_selectors[0].1[0].value, "\"\"");
        // Original declaration follows
        assert_eq!(resolved.pseudo_selectors[0].1[1].property, "display");
    }

    #[test]
    fn resolve_after_explicit_content_no_autodefault() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({ "_after": { "content": "\"→\"", "display": "block" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        // Should NOT inject auto content since explicit content is provided
        let content_count = resolved.pseudo_selectors[0].1.iter().filter(|d| d.property == "content").count();
        assert_eq!(content_count, 1);
        assert_eq!(resolved.pseudo_selectors[0].1.iter().find(|d| d.property == "content").unwrap().value, "\"→\"");
    }

    #[test]
    fn raw_before_no_content_autodefault() {
        let owner = TestCtxOwner::new().with_aliases();
        // Raw selector — should NOT get content auto-default
        let styles = json!({ "&::before": { "display": "block" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let has_content = resolved.pseudo_selectors[0].1.iter().any(|d| d.property == "content");
        assert!(!has_content, "Raw &::before should not auto-inject content");
    }

    #[test]
    fn merge_alias_and_raw_same_selector() {
        let owner = TestCtxOwner::new().with_aliases();
        // Both _hover (alias) and raw &:hover target the same selector
        let styles = json!({
            "_hover": { "color": "primary" },
            "&:hover": { "p": 8 }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        // Should merge into a single pseudo_selector entry
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        assert_eq!(resolved.pseudo_selectors[0].0, ":hover");
        // Both declarations present
        assert!(resolved.pseudo_selectors[0].1.iter().any(|d| d.property == "color"));
        assert!(resolved.pseudo_selectors[0].1.iter().any(|d| d.property == "padding"));
    }

    #[test]
    fn unknown_alias_key_ignored() {
        let owner = TestCtxOwner::new().with_aliases();
        // _groupHover is not in the alias map
        let styles = json!({ "_groupHover": { "color": "primary" }, "p": 8 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        // Unknown alias key is silently skipped
        assert_eq!(resolved.pseudo_selectors.len(), 0);
        // Regular prop still resolves
        assert_eq!(resolved.declarations.len(), 1);
    }

    #[test]
    fn variant_level_before_no_content_autodefault() {
        let owner = TestCtxOwner::new().with_aliases();
        // Variant override: only changes bg, should NOT inject content
        let styles = json!({ "_before": { "color": "primary" } });
        // auto_content = false (variant context)
        let resolved = resolve_styles(&styles, &owner.ctx(), false);
        let has_content = resolved.pseudo_selectors[0].1.iter().any(|d| d.property == "content");
        assert!(!has_content, "Variant-level _before should not auto-inject content");
    }

    // --- Cascade-tier ordering tests ---

    #[test]
    fn prop_cascade_tier_ordering() {
        let config = test_config();
        // p (true shorthand) < px (multi-target) < pl (longhand) < unknown
        let p_tier = prop_cascade_tier("p", &config);
        let px_tier = prop_cascade_tier("px", &config);
        let pl_tier = prop_cascade_tier("pl", &config);
        let unknown_tier = prop_cascade_tier("cursor", &config);

        assert!(p_tier < px_tier, "true shorthand (p) should sort before multi-target (px)");
        assert!(px_tier < pl_tier, "multi-target (px) should sort before longhand (pl)");
        assert!(pl_tier < unknown_tier, "longhand (pl) should sort before unknown (cursor)");
    }

    #[test]
    fn prop_cascade_tier_multi_target_specificity() {
        let config = test_config();
        // px and py are both tier 1 with same number of properties
        let px_tier = prop_cascade_tier("px", &config);
        let py_tier = prop_cascade_tier("py", &config);
        assert_eq!(px_tier, py_tier, "px and py should have equal cascade tier");
    }

    #[test]
    fn shorthand_before_longhand_in_resolve() {
        // px: 3, pl: 8 → pl's padding-left must appear AFTER px's padding-left
        let owner = TestCtxOwner::new();
        let styles = json!({ "px": 16, "pl": 8 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);

        // Should have 3 declarations: padding-left (from px), padding-right (from px), padding-left (from pl)
        assert_eq!(resolved.declarations.len(), 3);

        // Find the two padding-left declarations
        let pl_positions: Vec<usize> = resolved.declarations.iter()
            .enumerate()
            .filter(|(_, d)| d.property == "padding-left")
            .map(|(i, _)| i)
            .collect();
        assert_eq!(pl_positions.len(), 2, "should have two padding-left declarations");

        // First padding-left (from px) should have px's value (1rem = space.16)
        assert_eq!(resolved.declarations[pl_positions[0]].value, "1rem");
        // Second padding-left (from pl) should have pl's value (0.5rem = space.8)
        assert_eq!(resolved.declarations[pl_positions[1]].value, "0.5rem");
        // pl's value comes last → wins by CSS cascade
    }

    #[test]
    fn shorthand_before_longhand_reversed_source_order() {
        // Even when pl is written BEFORE px in source, px should still emit first
        let owner = TestCtxOwner::new();
        let styles = json!({ "pl": 8, "px": 16 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);

        assert_eq!(resolved.declarations.len(), 3);
        // px (multi-target shorthand) should emit before pl (longhand)
        assert_eq!(resolved.declarations[0].property, "padding-left");
        assert_eq!(resolved.declarations[0].value, "1rem"); // from px
        assert_eq!(resolved.declarations[1].property, "padding-right");
        assert_eq!(resolved.declarations[1].value, "1rem"); // from px
        assert_eq!(resolved.declarations[2].property, "padding-left");
        assert_eq!(resolved.declarations[2].value, "0.5rem"); // from pl — wins
    }

    #[test]
    fn true_shorthand_before_multi_target_before_longhand() {
        // p, px, pl — all three tiers
        let owner = TestCtxOwner::new();
        let styles = json!({ "pl": 8, "px": 16, "p": 24 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);

        // p (tier 0) should emit first as padding
        assert_eq!(resolved.declarations[0].property, "padding");
        assert_eq!(resolved.declarations[0].value, "1.5rem"); // space.24
        // px (tier 1) next — padding-left + padding-right
        assert_eq!(resolved.declarations[1].property, "padding-left");
        assert_eq!(resolved.declarations[1].value, "1rem"); // space.16
        assert_eq!(resolved.declarations[2].property, "padding-right");
        assert_eq!(resolved.declarations[2].value, "1rem"); // space.16
        // pl (tier 2) last — padding-left override
        assert_eq!(resolved.declarations[3].property, "padding-left");
        assert_eq!(resolved.declarations[3].value, "0.5rem"); // space.8 — wins
    }
}
