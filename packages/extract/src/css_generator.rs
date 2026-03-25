use std::collections::HashMap;
use std::fmt::Write;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::theme_resolver::{CssDeclaration, FlatTheme, PropConfigMap, ResolvedStyles, VariableMap, resolve_styles};

/// Per-layer CSS strings returned by the extraction pipeline.
///
/// Each field contains a complete, self-contained CSS block for one layer.
/// The `declaration` field contains only the `@layer` ordering statement.
/// Consumers can deliver these individually (e.g., adopted stylesheets)
/// or concatenate them for a single-file output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CssSheets {
    /// Layer ordering: `@layer global, base, variants, states, system, custom;\n`
    pub declaration: String,
    /// `@layer base { ... }` — component base styles
    pub base: String,
    /// `@layer variants { ... }` — variant option styles
    pub variants: String,
    /// `@layer states { ... }` — boolean state styles
    pub states: String,
    /// `@layer system { ... }` — utility/system prop classes
    pub system: String,
    /// `@layer custom { ... }` — custom prop classes
    pub custom: String,
}

/// Breakpoint pixel values for responsive @media queries.
#[derive(Debug, Clone)]
pub struct BreakpointMap {
    pub breakpoints: HashMap<String, u32>,
}

impl BreakpointMap {
    pub fn new(breakpoints: HashMap<String, u32>) -> Self {
        Self { breakpoints }
    }

    pub fn media_query(&self, bp: &str) -> Option<String> {
        self.breakpoints
            .get(bp)
            .map(|px| format!("@media (min-width: {}px)", px))
    }
}

/// Describes a component's extracted CSS structure.
#[derive(Debug)]
pub struct ComponentCss {
    pub class_name: String,
    /// Base styles (from .styles())
    pub base: Option<ResolvedStyles>,
    /// Variant styles: (prop_name, option_name) → ResolvedStyles
    pub variants: Vec<VariantCss>,
    /// State styles: state_name → ResolvedStyles
    pub states: Vec<(String, ResolvedStyles)>,
}

#[derive(Debug)]
pub struct VariantCss {
    pub prop: String,
    pub options: Vec<(String, ResolvedStyles)>,
}

/// Generate the full @layer-structured CSS output for all components.
pub fn generate_css(
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
) -> String {
    let mut output = String::new();

    // Layer declaration
    writeln!(output, "@layer global, base, variants, states, system, custom;").unwrap();
    writeln!(output).unwrap();

    // Base layer
    let base_css = generate_layer_content(components, breakpoints, LayerKind::Base);
    if !base_css.is_empty() {
        writeln!(output, "@layer base {{").unwrap();
        output.push_str(&base_css);
        writeln!(output, "}}").unwrap();
        writeln!(output).unwrap();
    }

    // Variants layer
    let variants_css = generate_layer_content(components, breakpoints, LayerKind::Variants);
    if !variants_css.is_empty() {
        writeln!(output, "@layer variants {{").unwrap();
        output.push_str(&variants_css);
        writeln!(output, "}}").unwrap();
        writeln!(output).unwrap();
    }

    // States layer
    let states_css = generate_layer_content(components, breakpoints, LayerKind::States);
    if !states_css.is_empty() {
        writeln!(output, "@layer states {{").unwrap();
        output.push_str(&states_css);
        writeln!(output, "}}").unwrap();
    }

    output
}

/// Generate CSS with components ordered by the given component_id list.
///
/// Each `component_id` in `order` maps to a `class_name` via the `id_to_class` map.
/// Within each @layer, parent components' rules appear BEFORE child components' rules,
/// ensuring CSS source-order cascade lets children override parents.
/// Components not present in the order are appended after the ordered ones.
pub fn generate_css_ordered(
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
    order: &[String], // component_ids in topological order (e.g. "file::binding")
) -> String {
    if order.is_empty() {
        return generate_css(components, breakpoints);
    }

    // Build a lookup: class_name → index_in_order
    // component_ids are in "file::binding" format; class_names are "animus-Binding-hash".
    // We match by splitting the component_id on "::" and taking the binding part, then
    // matching against the class_name prefix "animus-{binding}-".
    let order_index: HashMap<String, usize> = order
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), i))
        .collect();

    // Sort components: those in `order` come first (by their index), then unordered ones.
    // We match a component to an order entry by looking for a class_name that contains
    // the binding portion of the component_id.
    let mut indexed: Vec<(usize, &ComponentCss)> = components
        .iter()
        .map(|comp| {
            // Try to find a matching component_id in order by matching class_name segments
            let rank = order_index
                .iter()
                .filter_map(|(id, idx)| {
                    // component_id format: "path/to/file.tsx::Binding"
                    let binding = id.split("::").last()?;
                    // class_name format: "animus-Binding-hash"
                    if comp.class_name.starts_with(&format!("animus-{}-", binding)) {
                        Some(*idx)
                    } else {
                        None
                    }
                })
                .next()
                .unwrap_or(usize::MAX);
            (rank, comp)
        })
        .collect();

    // Stable sort preserves relative order of unordered components
    indexed.sort_by_key(|(rank, _)| *rank);

    let ordered_components: Vec<&ComponentCss> = indexed.iter().map(|(_, c)| *c).collect();

    generate_css_from_slice(&ordered_components, breakpoints)
}

/// Internal: generate structured CSS sheets from a slice of component references.
///
/// Returns a `CssSheets` with per-layer strings. The `system` and `custom` fields
/// are left empty here — they are populated by the caller (utility/custom CSS
/// generation is separate from component CSS generation).
fn generate_sheets_from_slice(
    components: &[&ComponentCss],
    breakpoints: &BreakpointMap,
) -> CssSheets {
    let declaration = "@layer global, base, variants, states, system, custom;\n".to_string();

    let base_content = generate_layer_content_slice(components, breakpoints, LayerKind::Base);
    let base = if !base_content.is_empty() {
        format!("@layer base {{\n{}}}\n", base_content)
    } else {
        String::new()
    };

    let variants_content = generate_layer_content_slice(components, breakpoints, LayerKind::Variants);
    let variants = if !variants_content.is_empty() {
        format!("@layer variants {{\n{}}}\n", variants_content)
    } else {
        String::new()
    };

    let states_content = generate_layer_content_slice(components, breakpoints, LayerKind::States);
    let states = if !states_content.is_empty() {
        format!("@layer states {{\n{}}}\n", states_content)
    } else {
        String::new()
    };

    CssSheets {
        declaration,
        base,
        variants,
        states,
        system: String::new(),
        custom: String::new(),
    }
}

/// Internal: generate concatenated CSS from a slice (used by generate_css_ordered).
fn generate_css_from_slice(
    components: &[&ComponentCss],
    breakpoints: &BreakpointMap,
) -> String {
    let sheets = generate_sheets_from_slice(components, breakpoints);
    let mut output = sheets.declaration;
    output.push('\n');
    if !sheets.base.is_empty() {
        output.push_str(&sheets.base);
        output.push('\n');
    }
    if !sheets.variants.is_empty() {
        output.push_str(&sheets.variants);
        output.push('\n');
    }
    if !sheets.states.is_empty() {
        output.push_str(&sheets.states);
    }
    output
}

/// Generate structured per-layer CSS sheets with topological ordering.
///
/// Same ordering logic as `generate_css_ordered`, but returns `CssSheets`
/// instead of a concatenated string. The `system` and `custom` fields are
/// left empty — the caller populates them from utility/custom CSS generation.
pub fn generate_css_sheets_ordered(
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
    order: &[String],
) -> CssSheets {
    if order.is_empty() {
        let refs: Vec<&ComponentCss> = components.iter().collect();
        return generate_sheets_from_slice(&refs, breakpoints);
    }

    let order_index: HashMap<String, usize> = order
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), i))
        .collect();

    let mut indexed: Vec<(usize, &ComponentCss)> = components
        .iter()
        .map(|comp| {
            let rank = order_index
                .iter()
                .filter_map(|(id, idx)| {
                    let binding = id.split("::").last()?;
                    if comp.class_name.starts_with(&format!("animus-{}-", binding)) {
                        Some(*idx)
                    } else {
                        None
                    }
                })
                .next()
                .unwrap_or(usize::MAX);
            (rank, comp)
        })
        .collect();

    indexed.sort_by_key(|(rank, _)| *rank);
    let ordered_components: Vec<&ComponentCss> = indexed.iter().map(|(_, c)| *c).collect();

    generate_sheets_from_slice(&ordered_components, breakpoints)
}

fn generate_layer_content_slice(
    components: &[&ComponentCss],
    breakpoints: &BreakpointMap,
    kind: LayerKind,
) -> String {
    let mut output = String::new();

    for component in components {
        match kind {
            LayerKind::Base => {
                if let Some(base) = &component.base {
                    write_rule_block(&mut output, &component.class_name, base, breakpoints);
                }
            }
            LayerKind::Variants => {
                for variant in &component.variants {
                    for (option_name, styles) in &variant.options {
                        let selector = format!(
                            "{}--{}-{}",
                            component.class_name, variant.prop, option_name
                        );
                        write_rule_block(&mut output, &selector, styles, breakpoints);
                    }
                }
            }
            LayerKind::States => {
                for (state_name, styles) in &component.states {
                    let selector = format!("{}--{}", component.class_name, state_name);
                    write_rule_block(&mut output, &selector, styles, breakpoints);
                }
            }
        }
    }

    output
}

enum LayerKind {
    Base,
    Variants,
    States,
}

fn generate_layer_content(
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
    kind: LayerKind,
) -> String {
    let mut output = String::new();

    for component in components {
        match kind {
            LayerKind::Base => {
                if let Some(base) = &component.base {
                    write_rule_block(&mut output, &component.class_name, base, breakpoints);
                }
            }
            LayerKind::Variants => {
                for variant in &component.variants {
                    for (option_name, styles) in &variant.options {
                        let selector = format!(
                            "{}--{}-{}",
                            component.class_name, variant.prop, option_name
                        );
                        write_rule_block(&mut output, &selector, styles, breakpoints);
                    }
                }
            }
            LayerKind::States => {
                for (state_name, styles) in &component.states {
                    let selector = format!("{}--{}", component.class_name, state_name);
                    write_rule_block(&mut output, &selector, styles, breakpoints);
                }
            }
        }
    }

    output
}

/// Write a complete CSS rule block for a selector, including pseudo-selectors and responsive.
fn write_rule_block(
    output: &mut String,
    selector: &str,
    styles: &ResolvedStyles,
    breakpoints: &BreakpointMap,
) {
    // Main declarations
    if !styles.declarations.is_empty() {
        write_declarations(output, &format!(".{}", selector), &styles.declarations);
    }

    // Pseudo-selectors
    for (pseudo, declarations) in &styles.pseudo_selectors {
        if !declarations.is_empty() {
            write_declarations(output, &format!(".{}{}", selector, pseudo), declarations);
        }
    }

    // Responsive declarations
    for (bp_name, declarations) in &styles.responsive {
        if let Some(mq) = breakpoints.media_query(bp_name) {
            if !declarations.is_empty() {
                writeln!(output, "  {} {{", mq).unwrap();
                write_declarations_indented(
                    output,
                    &format!(".{}", selector),
                    declarations,
                    4,
                );
                writeln!(output, "  }}").unwrap();
            }
        }
    }
}

fn write_declarations(output: &mut String, selector: &str, declarations: &[CssDeclaration]) {
    writeln!(output, "  {} {{", selector).unwrap();
    for decl in declarations {
        writeln!(output, "    {}: {};", decl.property, decl.value).unwrap();
    }
    writeln!(output, "  }}").unwrap();
}

fn write_declarations_indented(
    output: &mut String,
    selector: &str,
    declarations: &[CssDeclaration],
    indent: usize,
) {
    let pad = " ".repeat(indent);
    writeln!(output, "{}{} {{", pad, selector).unwrap();
    for decl in declarations {
        writeln!(output, "{}  {}: {};", pad, decl.property, decl.value).unwrap();
    }
    writeln!(output, "{}}}", pad).unwrap();
}

/// Generate a deterministic 8-char content hash from a normalized chain descriptor.
pub fn content_hash(input: &str) -> String {
    // Simple FNV-1a hash, truncated to 8 hex chars
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:08x}", hash as u32)
}

/// Generate a class name from binding name and content hash.
pub fn make_class_name(binding: &str, hash_input: &str) -> String {
    format!("animus-{}-{}", binding, content_hash(hash_input))
}

// ---------------------------------------------------------------------------
// Utility CSS generation (@layer system / @layer custom)
// ---------------------------------------------------------------------------

/// A system prop usage to generate utility CSS for.
#[derive(Debug, Clone)]
pub struct UtilityInput {
    pub prop_name: String,
    /// A JSON number, string, or responsive object (`{ "_": 8, "sm": 16 }`).
    pub value: Value,
}

/// Result of utility CSS generation.
pub struct UtilityOutput {
    /// Complete CSS string for the `@layer system` (or `@layer custom`) block.
    pub css: String,
    /// `class_map[prop_name][serialized_value] = class_name`
    ///
    /// Key format: `"p"` → `"8"` → `"animus-u-a1b2c3d4"`.
    /// Responsive key example: `"_:8|sm:16"`.
    pub class_map: HashMap<String, HashMap<String, String>>,
}

/// Serialize a value to a canonical lookup key for runtime matching.
///
/// - `8` → `"8"`
/// - `"flex"` → `"flex"`
/// - `{ "_": 8, "sm": 16 }` → `"_:8|sm:16"` (keys sorted, pipe-separated)
pub fn serialize_value_key(value: &Value) -> String {
    match value {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Object(obj) => {
            let mut pairs: Vec<String> = obj
                .iter()
                .map(|(k, v)| format!("{}:{}", k, serialize_value_key(v)))
                .collect();
            pairs.sort();
            pairs.join("|")
        }
        _ => format!("{}", value),
    }
}

/// Build a canonical CSS string from a `ResolvedStyles` for hashing.
///
/// Declarations are sorted by property name so the hash is stable regardless
/// of insertion order.  Responsive blocks appear after base declarations,
/// sorted by breakpoint name.
fn canonical_css_for_hash(styles: &ResolvedStyles) -> String {
    let mut out = String::new();

    // Base declarations — sort for stability
    let mut decls = styles.declarations.clone();
    decls.sort_by(|a, b| a.property.cmp(&b.property));
    for d in &decls {
        write!(out, "{}:{};", d.property, d.value).unwrap();
    }

    // Responsive blocks — sort by breakpoint name
    let mut responsive = styles.responsive.clone();
    responsive.sort_by(|(a, _), (b, _)| a.cmp(b));
    for (bp, bp_decls) in &responsive {
        write!(out, "@{}{{", bp).unwrap();
        let mut sorted = bp_decls.clone();
        sorted.sort_by(|a, b| a.property.cmp(&b.property));
        for d in &sorted {
            write!(out, "{}:{};", d.property, d.value).unwrap();
        }
        write!(out, "}}").unwrap();
    }

    out
}

/// Write the CSS rules for a single utility class into `layer_body`.
///
/// Uses the same indent conventions as `write_rule_block` so the output sits
/// correctly inside an `@layer { ... }` wrapper.
fn write_utility_rule(
    layer_body: &mut String,
    class_name: &str,
    styles: &ResolvedStyles,
    breakpoints: &BreakpointMap,
) {
    // Base declarations
    if !styles.declarations.is_empty() {
        write_declarations(layer_body, &format!(".{}", class_name), &styles.declarations);
    }

    // Pseudo-selectors (carried through resolve_styles)
    for (pseudo, declarations) in &styles.pseudo_selectors {
        if !declarations.is_empty() {
            write_declarations(
                layer_body,
                &format!(".{}{}", class_name, pseudo),
                declarations,
            );
        }
    }

    // Responsive declarations
    for (bp_name, declarations) in &styles.responsive {
        if let Some(mq) = breakpoints.media_query(bp_name) {
            if !declarations.is_empty() {
                writeln!(layer_body, "  {} {{", mq).unwrap();
                write_declarations_indented(
                    layer_body,
                    &format!(".{}", class_name),
                    declarations,
                    4,
                );
                writeln!(layer_body, "  }}").unwrap();
            }
        }
    }
}

/// Core implementation used by both `generate_utility_css` and
/// `generate_custom_prop_css`.  `layer_name` is `"system"` or `"custom"`.
fn generate_utility_css_impl(
    usages: &[UtilityInput],
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    breakpoints: &BreakpointMap,
    layer_name: &str,
) -> UtilityOutput {
    let mut class_map: HashMap<String, HashMap<String, String>> = HashMap::new();
    // Deduplicate: canonical_css → (class_name, ResolvedStyles)
    let mut seen: HashMap<String, (String, ResolvedStyles)> = HashMap::new();

    for usage in usages {
        // Build a single-key style object and resolve it.
        // resolve_styles handles both plain values and responsive objects
        // natively (it calls is_responsive_value internally).
        let style_obj = serde_json::json!({ &usage.prop_name: usage.value.clone() });
        let resolved = resolve_styles(&style_obj, config, theme, variable_map);

        // Compute a canonical CSS string and derive the class name from its hash.
        let canonical = canonical_css_for_hash(&resolved);
        if canonical.is_empty() {
            // Nothing resolved (unknown prop with no passthrough value, etc.)
            continue;
        }

        let class_name = seen
            .entry(canonical.clone())
            .or_insert_with(|| {
                let hash = content_hash(&canonical);
                let name = format!("animus-u-{}", hash);
                (name, resolved.clone())
            })
            .0
            .clone();

        // Register in class_map
        let value_key = serialize_value_key(&usage.value);
        class_map
            .entry(usage.prop_name.clone())
            .or_default()
            .insert(value_key, class_name);
    }

    // Render @layer block
    let mut css = String::new();
    if !seen.is_empty() {
        writeln!(css, "@layer {} {{", layer_name).unwrap();
        // Emit in a deterministic order (sorted by class name for stability)
        let mut entries: Vec<(&String, &(String, ResolvedStyles))> = seen.iter().collect();
        entries.sort_by_key(|(_, (name, _))| name.as_str());
        for (_, (class_name, styles)) in entries {
            write_utility_rule(&mut css, class_name, styles, breakpoints);
        }
        writeln!(css, "}}").unwrap();
    }

    UtilityOutput { css, class_map }
}

/// Generate utility CSS for a list of `(prop, value)` pairs.
/// Emits rules inside `@layer system { ... }`.
pub fn generate_utility_css(
    usages: &[UtilityInput],
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    breakpoints: &BreakpointMap,
) -> UtilityOutput {
    generate_utility_css_impl(usages, config, theme, variable_map, breakpoints, "system")
}

/// Generate utility CSS for `.props()` custom props.
/// Emits rules inside `@layer custom { ... }`.
pub fn generate_custom_prop_css(
    usages: &[UtilityInput],
    custom_configs: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    breakpoints: &BreakpointMap,
) -> UtilityOutput {
    generate_utility_css_impl(usages, custom_configs, theme, variable_map, breakpoints, "custom")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme_resolver::CssDeclaration;

    fn empty_vars() -> VariableMap {
        HashMap::new()
    }

    fn test_breakpoints() -> BreakpointMap {
        let mut bp = HashMap::new();
        bp.insert("xs".to_string(), 480);
        bp.insert("sm".to_string(), 768);
        bp.insert("md".to_string(), 1024);
        bp.insert("lg".to_string(), 1200);
        bp.insert("xl".to_string(), 1440);
        BreakpointMap::new(bp)
    }

    #[test]
    fn generates_base_layer() {
        let components = vec![ComponentCss {
            class_name: "animus-Box-abcd1234".to_string(),
            base: Some(ResolvedStyles {
                declarations: vec![
                    CssDeclaration {
                        property: "padding".to_string(),
                        value: "0".to_string(),
                    },
                    CssDeclaration {
                        property: "display".to_string(),
                        value: "inline-flex".to_string(),
                    },
                ],
                pseudo_selectors: vec![],
                responsive: vec![],
                responsive_pseudos: vec![],
            }),
            variants: vec![],
            states: vec![],
        }];

        let css = generate_css(&components, &test_breakpoints());
        assert!(css.contains("@layer global, base, variants, states, system, custom;"));
        assert!(css.contains("@layer base {"));
        assert!(css.contains(".animus-Box-abcd1234 {"));
        assert!(css.contains("padding: 0;"));
        assert!(css.contains("display: inline-flex;"));
    }

    #[test]
    fn generates_variant_layer() {
        let components = vec![ComponentCss {
            class_name: "animus-Btn-1234abcd".to_string(),
            base: None,
            variants: vec![VariantCss {
                prop: "variant".to_string(),
                options: vec![
                    (
                        "fill".to_string(),
                        ResolvedStyles {
                            declarations: vec![CssDeclaration {
                                property: "color".to_string(),
                                value: "var(--colors-background)".to_string(),
                            }],
                            pseudo_selectors: vec![],
                            responsive: vec![],
                            responsive_pseudos: vec![],
                        },
                    ),
                    (
                        "stroke".to_string(),
                        ResolvedStyles {
                            declarations: vec![CssDeclaration {
                                property: "border".to_string(),
                                value: "1px solid".to_string(),
                            }],
                            pseudo_selectors: vec![],
                            responsive: vec![],
                            responsive_pseudos: vec![],
                        },
                    ),
                ],
            }],
            states: vec![],
        }];

        let css = generate_css(&components, &test_breakpoints());
        assert!(css.contains("@layer variants {"));
        assert!(css.contains(".animus-Btn-1234abcd--variant-fill {"));
        assert!(css.contains(".animus-Btn-1234abcd--variant-stroke {"));
    }

    #[test]
    fn generates_state_layer() {
        let components = vec![ComponentCss {
            class_name: "animus-Layout-deadbeef".to_string(),
            base: None,
            variants: vec![],
            states: vec![(
                "loading".to_string(),
                ResolvedStyles {
                    declarations: vec![CssDeclaration {
                        property: "opacity".to_string(),
                        value: "0".to_string(),
                    }],
                    pseudo_selectors: vec![],
                    responsive: vec![],
                    responsive_pseudos: vec![],
                },
            )],
        }];

        let css = generate_css(&components, &test_breakpoints());
        assert!(css.contains("@layer states {"));
        assert!(css.contains(".animus-Layout-deadbeef--loading {"));
        assert!(css.contains("opacity: 0;"));
    }

    #[test]
    fn generates_pseudo_selectors() {
        let components = vec![ComponentCss {
            class_name: "animus-Btn-aabb".to_string(),
            base: Some(ResolvedStyles {
                declarations: vec![],
                pseudo_selectors: vec![(
                    ":hover".to_string(),
                    vec![CssDeclaration {
                        property: "color".to_string(),
                        value: "var(--colors-primary)".to_string(),
                    }],
                )],
                responsive: vec![],
                responsive_pseudos: vec![],
            }),
            variants: vec![],
            states: vec![],
        }];

        let css = generate_css(&components, &test_breakpoints());
        assert!(css.contains(".animus-Btn-aabb:hover {"));
        assert!(css.contains("color: var(--colors-primary);"));
    }

    #[test]
    fn generates_responsive_media() {
        let components = vec![ComponentCss {
            class_name: "animus-Box-ccdd".to_string(),
            base: Some(ResolvedStyles {
                declarations: vec![CssDeclaration {
                    property: "font-size".to_string(),
                    value: "1rem".to_string(),
                }],
                pseudo_selectors: vec![],
                responsive: vec![(
                    "sm".to_string(),
                    vec![CssDeclaration {
                        property: "font-size".to_string(),
                        value: "1.125rem".to_string(),
                    }],
                )],
                responsive_pseudos: vec![],
            }),
            variants: vec![],
            states: vec![],
        }];

        let css = generate_css(&components, &test_breakpoints());
        assert!(css.contains("font-size: 1rem;"));
        assert!(css.contains("@media (min-width: 768px)"));
        assert!(css.contains("font-size: 1.125rem;"));
    }

    #[test]
    fn content_hash_stable() {
        let h1 = content_hash("test input");
        let h2 = content_hash("test input");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 8);
    }

    #[test]
    fn content_hash_unique() {
        let h1 = content_hash("input a");
        let h2 = content_hash("input b");
        assert_ne!(h1, h2);
    }

    #[test]
    fn make_class_name_format() {
        let name = make_class_name("ButtonContainer", "some-chain-data");
        assert!(name.starts_with("animus-ButtonContainer-"));
        assert_eq!(name.len(), "animus-ButtonContainer-".len() + 8);
    }

    #[test]
    fn layer_declaration_order() {
        let css = generate_css(&[], &test_breakpoints());
        assert!(css.starts_with("@layer global, base, variants, states, system, custom;"));
    }

    // -----------------------------------------------------------------------
    // Utility CSS generation tests
    // -----------------------------------------------------------------------

    use crate::theme_resolver::{FlatTheme, PropConfig, PropConfigMap};
    use serde_json::json;

    fn utility_config() -> PropConfigMap {
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
            "mt".to_string(),
            PropConfig {
                property: "marginTop".to_string(),
                properties: vec![],
                scale: Some("space".to_string()),
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
        config
    }

    fn utility_theme() -> FlatTheme {
        let mut theme = HashMap::new();
        theme.insert("space.8".to_string(), "0.5rem".to_string());
        theme.insert("space.16".to_string(), "1rem".to_string());
        theme
    }

    #[test]
    fn generates_simple_utility() {
        let config = utility_config();
        let theme = utility_theme();
        let bp = test_breakpoints();
        let usages = vec![UtilityInput {
            prop_name: "p".to_string(),
            value: json!(8),
        }];
        let out = generate_utility_css(&usages, &config, &theme, &empty_vars(), &bp);
        assert!(out.css.contains("@layer system {"));
        assert!(out.css.contains("padding: 0.5rem;"));
        // Class selector must use the animus-u- prefix
        assert!(out.css.contains(".animus-u-"));
    }

    #[test]
    fn generates_responsive_utility() {
        let config = utility_config();
        let theme = utility_theme();
        let bp = test_breakpoints();
        let usages = vec![UtilityInput {
            prop_name: "mt".to_string(),
            value: json!({ "_": 8, "sm": 16 }),
        }];
        let out = generate_utility_css(&usages, &config, &theme, &empty_vars(), &bp);
        // Base value
        assert!(out.css.contains("margin-top: 0.5rem;"));
        // Responsive value inside @media
        assert!(out.css.contains("@media (min-width: 768px)"));
        assert!(out.css.contains("margin-top: 1rem;"));
    }

    #[test]
    fn utility_class_name_deterministic() {
        let config = utility_config();
        let theme = utility_theme();
        let bp = test_breakpoints();
        let usages = vec![UtilityInput {
            prop_name: "p".to_string(),
            value: json!(8),
        }];
        let out1 = generate_utility_css(&usages, &config, &theme, &empty_vars(), &bp);
        let out2 = generate_utility_css(&usages, &config, &theme, &empty_vars(), &bp);
        assert_eq!(out1.css, out2.css);
        let map1 = &out1.class_map["p"]["8"];
        let map2 = &out2.class_map["p"]["8"];
        assert_eq!(map1, map2);
    }

    #[test]
    fn different_values_different_classes() {
        let config = utility_config();
        let theme = utility_theme();
        let bp = test_breakpoints();
        let usages = vec![
            UtilityInput {
                prop_name: "p".to_string(),
                value: json!(8),
            },
            UtilityInput {
                prop_name: "p".to_string(),
                value: json!(16),
            },
        ];
        let out = generate_utility_css(&usages, &config, &theme, &empty_vars(), &bp);
        let class_8 = &out.class_map["p"]["8"];
        let class_16 = &out.class_map["p"]["16"];
        assert_ne!(class_8, class_16);
    }

    #[test]
    fn serialize_value_key_number() {
        assert_eq!(serialize_value_key(&json!(8)), "8");
        assert_eq!(serialize_value_key(&json!(0)), "0");
    }

    #[test]
    fn serialize_value_key_string() {
        assert_eq!(serialize_value_key(&json!("flex")), "flex");
    }

    #[test]
    fn serialize_value_key_responsive() {
        // Keys must be sorted: "_" < "sm" lexicographically
        let key = serialize_value_key(&json!({ "_": 8, "sm": 16 }));
        assert_eq!(key, "_:8|sm:16");
    }

    #[test]
    fn custom_prop_uses_custom_layer() {
        let config = utility_config();
        let theme = utility_theme();
        let bp = test_breakpoints();
        let usages = vec![UtilityInput {
            prop_name: "p".to_string(),
            value: json!(8),
        }];
        let out = generate_custom_prop_css(&usages, &config, &theme, &empty_vars(), &bp);
        assert!(out.css.contains("@layer custom {"));
        assert!(!out.css.contains("@layer system {"));
    }

    #[test]
    fn class_map_structure() {
        let config = utility_config();
        let theme = utility_theme();
        let bp = test_breakpoints();
        let usages = vec![UtilityInput {
            prop_name: "p".to_string(),
            value: json!(8),
        }];
        let out = generate_utility_css(&usages, &config, &theme, &empty_vars(), &bp);
        // class_map["p"]["8"] must be a class name that appears in the CSS
        assert!(out.class_map.contains_key("p"));
        let p_map = &out.class_map["p"];
        assert!(p_map.contains_key("8"));
        let class_name = &p_map["8"];
        assert!(class_name.starts_with("animus-u-"));
        assert!(out.css.contains(class_name.as_str()));
    }
}
