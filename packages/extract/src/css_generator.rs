use std::collections::{HashMap, HashSet};
use std::fmt::Write;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::project_analyzer::camel_to_kebab;
use crate::theme_resolver::{CssDeclaration, FlatTheme, PropConfig, PropConfigMap, ResolveContext, ResolvedStyles, SelectorAliasesMap, VariableMap, resolve_styles};

// ---------------------------------------------------------------------------
// CSS shorthand ordering — shorthands first, longhands last.
// Mirrors packages/core/src/properties/orderPropNames.ts
// Within the same @layer and specificity, later source order wins.
// Placing shorthands first ensures longhands can always override them.
// ---------------------------------------------------------------------------

const SHORTHAND_PROPERTIES: &[&str] = &[
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

/// Returns a sort key for a CSS property based on shorthand status.
/// Lower key = emitted earlier in source = lower cascade priority.
/// Works with both camelCase (PropConfig) and kebab-case (CSS declarations).
fn css_property_cascade_key(css_property: &str) -> usize {
    // Check against SHORTHAND_PROPERTIES (camelCase).
    // If input is kebab-case, also check camelCase equivalent.
    for (i, &shorthand) in SHORTHAND_PROPERTIES.iter().enumerate() {
        if css_property == shorthand {
            return i;
        }
        // Compare kebab-case version
        let kebab = camel_to_kebab(shorthand);
        if css_property == kebab {
            return i;
        }
    }
    // Longhand: comes after all shorthands
    SHORTHAND_PROPERTIES.len() + 1
}

/// Per-layer CSS strings returned by the extraction pipeline.
///
/// Each field contains a complete, self-contained CSS block for one layer.
/// The `declaration` field contains only the `@layer` ordering statement.
/// Consumers can deliver these individually (e.g., adopted stylesheets)
/// or concatenate them for a single-file output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CssSheets {
    /// Layer ordering: `@layer global, base, variants, compounds, states, system, custom;\n`
    pub declaration: String,
    /// `@layer base { ... }` — component base styles
    pub base: String,
    /// `@layer variants { ... }` — variant option styles
    pub variants: String,
    /// `@layer compounds { ... }` — compound variant styles
    pub compounds: String,
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
#[derive(Debug, Clone, PartialEq)]
pub struct ComponentCss {
    pub class_name: String,
    /// Base styles (from .styles())
    pub base: Option<ResolvedStyles>,
    /// Variant styles: (prop_name, option_name) → ResolvedStyles
    pub variants: Vec<VariantCss>,
    /// Compound styles: index → ResolvedStyles
    pub compounds: Vec<ResolvedStyles>,
    /// State styles: state_name → ResolvedStyles
    pub states: Vec<(String, ResolvedStyles)>,
}

#[derive(Debug, Clone, PartialEq)]
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
    writeln!(output, "@layer global, base, variants, compounds, states, system, custom;").unwrap();
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

    // Compounds layer
    let compounds_css = generate_layer_content(components, breakpoints, LayerKind::Compounds);
    if !compounds_css.is_empty() {
        writeln!(output, "@layer compounds {{").unwrap();
        output.push_str(&compounds_css);
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

/// Internal: generate structured CSS sheets from a slice of component references.
///
/// Returns a `CssSheets` with per-layer strings. The `system` and `custom` fields
/// are left empty here — they are populated by the caller (utility/custom CSS
/// generation is separate from component CSS generation).
fn generate_sheets_from_slice(
    components: &[&ComponentCss],
    breakpoints: &BreakpointMap,
) -> CssSheets {
    let declaration = "@layer global, base, variants, compounds, states, system, custom;\n".to_string();

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

    let compounds_content = generate_layer_content_slice(components, breakpoints, LayerKind::Compounds);
    let compounds = if !compounds_content.is_empty() {
        format!("@layer compounds {{\n{}}}\n", compounds_content)
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
        compounds,
        states,
        system: String::new(),
        custom: String::new(),
    }
}

/// Generate structured per-layer CSS sheets with topological ordering.
///
/// Returns `CssSheets` with per-layer strings. The `system` and `custom` fields are
/// left empty — the caller populates them from utility/custom CSS generation.
pub fn generate_css_sheets_ordered(
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
    order: &[String],
    class_prefix: &str,
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
                    if comp.class_name.starts_with(&format!("{}-{}-", class_prefix, binding)) {
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
            LayerKind::Compounds => {
                for (index, styles) in component.compounds.iter().enumerate() {
                    let selector = format!("{}--compound-{}", component.class_name, index);
                    write_rule_block(&mut output, &selector, styles, breakpoints);
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
    Compounds,
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
            LayerKind::Compounds => {
                for (index, styles) in component.compounds.iter().enumerate() {
                    let selector = format!("{}--compound-{}", component.class_name, index);
                    write_rule_block(&mut output, &selector, styles, breakpoints);
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

    // Pseudo-selectors — sorted by cascade order for deterministic precedence
    let mut sorted_pseudos: Vec<&(String, Vec<CssDeclaration>)> = styles.pseudo_selectors.iter().collect();
    sorted_pseudos.sort_by_key(|(sel, _)| pseudo_sort_order(sel));
    for (pseudo, declarations) in sorted_pseudos {
        if !declarations.is_empty() {
            write_declarations(output, &format_pseudo_selector(selector, pseudo), declarations);
        }
    }

    // Responsive declarations — sorted by breakpoint pixel value (ascending)
    // to ensure correct cascade: smaller breakpoints first, larger override later.
    let mut sorted_responsive: Vec<&(String, Vec<CssDeclaration>)> =
        styles.responsive.iter().collect();
    sorted_responsive.sort_by_key(|(bp_name, _)| {
        breakpoints.breakpoints.get(bp_name.as_str()).copied().unwrap_or(0)
    });
    for (bp_name, declarations) in sorted_responsive {
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

/// Sort order for pseudo-selectors within a single rule block.
/// Later position = higher cascade precedence within the same specificity tier.
/// Follows LVHA convention and interaction semantics.
fn pseudo_sort_order(selector: &str) -> u32 {
    // Extract the first selector segment for compound selectors
    let first = selector.split(',').next().unwrap_or(selector).trim();
    match first {
        ":link" => 10,
        ":visited" => 20,
        ":hover" => 30,
        ":focus-within" => 40,
        ":focus" => 50,
        ":focus-visible" => 60,
        ":active" => 70,
        ":target" => 80,
        _ if first.contains(":checked") || first.contains("[aria-checked") || first.contains("[data-checked") => 100,
        _ if first.contains(":invalid") || first.contains("[aria-invalid") || first.contains("[data-invalid") => 110,
        _ if first.contains(":required") || first.contains("[aria-required") => 120,
        _ if first.contains(":read-only") || first.contains("[aria-readonly") || first.contains("[data-readonly") => 130,
        _ if first.contains("[aria-expanded") || first.contains("[data-expanded") => 140,
        _ if first.contains("[aria-selected") || first.contains("[data-selected") => 150,
        _ if first.contains("[aria-pressed") || first.contains("[data-pressed") => 160,
        _ if first.contains(":disabled") || first.contains("[disabled") || first.contains("[aria-disabled") || first.contains("[data-disabled") => 200,
        "::before" => 300,
        "::after" => 310,
        "::placeholder" => 320,
        "::selection" => 330,
        ":first-child" => 400,
        ":last-child" => 410,
        _ if first.contains("nth-child(even)") => 420,
        _ if first.contains("nth-child(odd)") => 430,
        ":empty" => 440,
        // Unknown selectors sort to end (preserve insertion order among unknowns)
        _ => 900,
    }
}

/// Format a pseudo-selector with the base class, handling comma-separated selectors.
/// `.class` + `:hover, :focus` → `.class:hover, .class:focus`
fn format_pseudo_selector(class: &str, pseudo: &str) -> String {
    if pseudo.contains(',') {
        pseudo
            .split(',')
            .map(|part| format!(".{}{}", class, part.trim()))
            .collect::<Vec<_>>()
            .join(", ")
    } else {
        format!(".{}{}", class, pseudo)
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

// ---------------------------------------------------------------------------
// Composed variant CSS — two-rule model for CSS-only shared propagation
// ---------------------------------------------------------------------------

/// Information about a compose family needed for CSS generation.
/// Maps slot names to their component CSS class names.
pub struct ComposeFamilyRef<'a> {
    pub root_class: &'a str,
    pub child_slots: Vec<(&'a str, &'a str)>, // (binding_name, class_name)
    pub shared_keys: &'a [String],
}

/// Generate composed variant CSS rules for all families.
///
/// For each shared variant option on each child slot, emits two rules:
/// - Rule 1 (inheritance): `.Root.Root--var-opt .Child { declarations }`
/// - Rule 2 (override): `.Root .Child.Child--var-opt { declarations }`
///
/// Both have specificity (0,3,0). Rule 1 emitted first; at equal specificity
/// within the same @layer, Rule 2 (source-order later) wins when both match.
///
/// Returns the CSS content to append inside `@layer variants { ... }`.
pub fn generate_composed_variant_css(
    families: &[ComposeFamilyRef],
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
) -> String {
    let mut output = String::new();

    // Build a lookup: class_name → &ComponentCss
    let class_map: HashMap<&str, &ComponentCss> = components
        .iter()
        .map(|css| (css.class_name.as_str(), css))
        .collect();

    for family in families {
        for &(_, child_class) in &family.child_slots {
            let Some(child_css) = class_map.get(child_class) else {
                continue;
            };

            for shared_key in family.shared_keys {
                // Find the child's variant CSS for this shared key
                let Some(variant) = child_css
                    .variants
                    .iter()
                    .find(|v| v.prop == *shared_key)
                else {
                    continue;
                };

                for (option_name, styles) in &variant.options {
                    write_composed_rule_pair(
                        &mut output,
                        family.root_class,
                        child_class,
                        shared_key,
                        option_name,
                        styles,
                        breakpoints,
                    );
                }
            }
        }
    }

    output
}

/// Emit one composed rule pair (inheritance + override) for a single variant option.
fn write_composed_rule_pair(
    output: &mut String,
    root_class: &str,
    child_class: &str,
    variant_prop: &str,
    option_name: &str,
    styles: &ResolvedStyles,
    breakpoints: &BreakpointMap,
) {
    let variant_class = format!("{}--{}-{}", root_class, variant_prop, option_name);
    let child_variant_class = format!("{}--{}-{}", child_class, variant_prop, option_name);

    // Rule 1 (inheritance): .Root.Root--var-opt .Child
    let inheritance_selector = format!(".{}.{} .{}", root_class, variant_class, child_class);
    // Rule 2 (override): .Root .Child.Child--var-opt
    let override_selector = format!(".{} .{}.{}", root_class, child_class, child_variant_class);

    // Main declarations
    if !styles.declarations.is_empty() {
        write_declarations(output, &inheritance_selector, &styles.declarations);
        write_declarations(output, &override_selector, &styles.declarations);
    }

    // Pseudo-selectors — sorted by cascade order, same as direct variant rules
    let mut sorted_pseudos: Vec<&(String, Vec<CssDeclaration>)> =
        styles.pseudo_selectors.iter().collect();
    sorted_pseudos.sort_by_key(|(sel, _)| pseudo_sort_order(sel));
    for (pseudo, declarations) in sorted_pseudos {
        if !declarations.is_empty() {
            let inh_pseudo = format_composed_pseudo(&inheritance_selector, pseudo);
            let ovr_pseudo = format_composed_pseudo(&override_selector, pseudo);
            write_declarations(output, &inh_pseudo, declarations);
            write_declarations(output, &ovr_pseudo, declarations);
        }
    }

    // Responsive declarations — sorted by breakpoint pixel value (ascending)
    let mut sorted_responsive: Vec<&(String, Vec<CssDeclaration>)> =
        styles.responsive.iter().collect();
    sorted_responsive.sort_by_key(|(bp_name, _)| {
        breakpoints.breakpoints.get(bp_name.as_str()).copied().unwrap_or(0)
    });
    for (bp_name, declarations) in sorted_responsive {
        if let Some(mq) = breakpoints.media_query(bp_name) {
            if !declarations.is_empty() {
                writeln!(output, "  {} {{", mq).unwrap();
                write_declarations_indented(output, &inheritance_selector, declarations, 4);
                write_declarations_indented(output, &override_selector, declarations, 4);
                writeln!(output, "  }}").unwrap();
            }
        }
    }

    // Responsive pseudo-selectors — sorted by breakpoint pixel value (ascending)
    let mut sorted_responsive_pseudos: Vec<&(String, Vec<(String, Vec<CssDeclaration>)>)> =
        styles.responsive_pseudos.iter().collect();
    sorted_responsive_pseudos.sort_by_key(|(bp_name, _)| {
        breakpoints.breakpoints.get(bp_name.as_str()).copied().unwrap_or(0)
    });
    for (bp_name, pseudo_groups) in sorted_responsive_pseudos {
        if let Some(mq) = breakpoints.media_query(bp_name) {
            for (pseudo, declarations) in pseudo_groups {
                if !declarations.is_empty() {
                    let inh_pseudo = format_composed_pseudo(&inheritance_selector, pseudo);
                    let ovr_pseudo = format_composed_pseudo(&override_selector, pseudo);
                    writeln!(output, "  {} {{", mq).unwrap();
                    write_declarations_indented(output, &inh_pseudo, declarations, 4);
                    write_declarations_indented(output, &ovr_pseudo, declarations, 4);
                    writeln!(output, "  }}").unwrap();
                }
            }
        }
    }
}

/// Format a pseudo-selector appended to a full composed selector.
/// `.Root.Root--size-sm .Child` + `:hover` → `.Root.Root--size-sm .Child:hover`
/// Handles comma-separated pseudos: `:hover, :focus` → two selectors.
fn format_composed_pseudo(selector: &str, pseudo: &str) -> String {
    if pseudo.contains(',') {
        pseudo
            .split(',')
            .map(|part| format!("{}{}", selector, part.trim()))
            .collect::<Vec<_>>()
            .join(", ")
    } else {
        format!("{}{}", selector, pseudo)
    }
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
///
/// When `prefix` is provided, uses `{prefix}-{binding}-{hash}`.
/// Defaults to `animus-{binding}-{hash}`.
pub fn make_class_name(binding: &str, hash_input: &str, prefix: &str) -> String {
    format!("{}-{}-{}", prefix, binding, content_hash(hash_input))
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

    // Pseudo-selectors — sorted by cascade order
    let mut sorted_pseudos: Vec<&(String, Vec<CssDeclaration>)> = styles.pseudo_selectors.iter().collect();
    sorted_pseudos.sort_by_key(|(sel, _)| pseudo_sort_order(sel));
    for (pseudo, declarations) in sorted_pseudos {
        if !declarations.is_empty() {
            write_declarations(
                layer_body,
                &format_pseudo_selector(class_name, pseudo),
                declarations,
            );
        }
    }

    // Responsive declarations — sorted by breakpoint pixel value (ascending)
    let mut sorted_responsive: Vec<&(String, Vec<CssDeclaration>)> =
        styles.responsive.iter().collect();
    sorted_responsive.sort_by_key(|(bp_name, _)| {
        breakpoints.breakpoints.get(bp_name.as_str()).copied().unwrap_or(0)
    });
    for (bp_name, declarations) in sorted_responsive {
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
///
/// When `slot_entries` is provided, those entries are merged into the same
/// sorted emission stream — producing a single `@layer` block with
/// interleaved static utilities and dynamic slot classes, all cascade-ordered.
fn generate_utility_css_impl(
    usages: &[UtilityInput],
    ctx: &ResolveContext,
    breakpoints: &BreakpointMap,
    layer_name: &str,
    slot_entries: Option<Vec<(String, ResolvedStyles, String)>>,
    class_prefix: &str,
) -> UtilityOutput {
    let mut class_map: HashMap<String, HashMap<String, String>> = HashMap::new();
    // Deduplicate: canonical_css → (class_name, ResolvedStyles)
    let mut seen: HashMap<String, (String, ResolvedStyles)> = HashMap::new();

    for usage in usages {
        // Build a single-key style object and resolve it.
        // resolve_styles handles both plain values and responsive objects
        // natively (it calls is_responsive_value internally).
        let style_obj = serde_json::json!({ &usage.prop_name: usage.value.clone() });
        let resolved = resolve_styles(&style_obj, ctx, true);

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
                let name = format!("{}-u-{}", class_prefix, hash);
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

    // Merge slot entries (dynamic variable classes) into the same stream
    // as static utility classes for single-pass cascade-correct emission.
    if let Some(slots) = slot_entries {
        for (slot_class, slot_styles, _slot_css_prop) in slots {
            let canonical_key = format!("__slot__:{}", slot_class);
            seen.insert(canonical_key, (slot_class, slot_styles));
        }
    }

    // Render @layer block with cascade-correct ordering:
    // shorthands first (lower priority), longhands last (higher priority).
    // Static utilities and dynamic slot classes are interleaved by cascade key.
    let mut css = String::new();
    if !seen.is_empty() {
        writeln!(css, "@layer {} {{", layer_name).unwrap();
        let mut entries: Vec<(&String, &(String, ResolvedStyles))> =
            seen.iter().collect();
        entries.sort_by(|(_, (name_a, styles_a)), (_, (name_b, styles_b))| {
            // Extract CSS property from base declarations, falling back to
            // responsive declarations (per-bp slot classes have empty base decls).
            let prop_from = |s: &ResolvedStyles| -> String {
                if let Some(d) = s.declarations.first() {
                    return d.property.clone();
                }
                if let Some((_, decls)) = s.responsive.first() {
                    if let Some(d) = decls.first() {
                        return d.property.clone();
                    }
                }
                String::new()
            };
            // Breakpoint sort order: base/static → 0, per-bp → pixel value.
            let bp_order = |s: &ResolvedStyles| -> u32 {
                if !s.declarations.is_empty() { return 0; }
                if let Some((bp_name, _)) = s.responsive.first() {
                    return *breakpoints.breakpoints.get(bp_name).unwrap_or(&0);
                }
                0
            };

            let css_prop_a = prop_from(styles_a);
            let css_prop_b = prop_from(styles_b);
            let key_a = css_property_cascade_key(&css_prop_a);
            let key_b = css_property_cascade_key(&css_prop_b);
            key_a
                .cmp(&key_b)
                .then_with(|| css_prop_a.cmp(&css_prop_b))
                .then_with(|| bp_order(styles_a).cmp(&bp_order(styles_b)))
                .then_with(|| name_a.cmp(name_b))
        });
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
    ctx: &ResolveContext,
    breakpoints: &BreakpointMap,
    slot_entries: Option<Vec<(String, ResolvedStyles, String)>>,
    class_prefix: &str,
) -> UtilityOutput {
    generate_utility_css_impl(usages, ctx, breakpoints, "system", slot_entries, class_prefix)
}

/// Generate utility CSS for `.props()` custom props.
/// Emits rules inside `@layer custom { ... }`.
pub fn generate_custom_prop_css(
    usages: &[UtilityInput],
    custom_config: &PropConfigMap,
    ctx: &ResolveContext,
    breakpoints: &BreakpointMap,
    slot_entries: Option<Vec<(String, ResolvedStyles, String)>>,
    class_prefix: &str,
) -> UtilityOutput {
    // Build a temporary context with custom_config instead of the global config
    let custom_ctx = ResolveContext {
        config: custom_config,
        theme: ctx.theme,
        variable_map: ctx.variable_map,
        contextual_vars: ctx.contextual_vars,
        breakpoint_keys: ctx.breakpoint_keys,
        selector_aliases: ctx.selector_aliases,
    };
    generate_utility_css_impl(usages, &custom_ctx, breakpoints, "custom", slot_entries, class_prefix)
}

// ---------------------------------------------------------------------------
// Unit fallback for numeric CSS values
// ---------------------------------------------------------------------------

/// CSS properties that accept unitless numeric values.
/// Matches @emotion/unitless and the runtime UNITLESS_PROPERTIES set.
const UNITLESS_CSS_PROPERTIES: &[&str] = &[
    "animation-iteration-count", "border-image-outset", "border-image-slice",
    "border-image-width", "box-flex", "box-flex-group", "box-ordinal-group",
    "column-count", "columns", "flex", "flex-grow", "flex-positive",
    "flex-shrink", "flex-negative", "flex-order", "font-weight",
    "grid-area", "grid-column", "grid-column-end", "grid-column-span",
    "grid-column-start", "grid-row", "grid-row-end", "grid-row-span",
    "grid-row-start", "line-clamp", "line-height", "opacity", "order",
    "orphans", "tab-size", "widows", "z-index", "zoom",
    "fill-opacity", "flood-opacity", "stop-opacity",
    "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit",
    "stroke-opacity", "stroke-width",
];

/// Apply unit fallback to a numeric value for a given CSS property.
/// Returns "Npx" for properties that expect length units, "N" for unitless properties.
pub fn apply_unit_fallback_for_property(value: f64, css_property: &str) -> String {
    if UNITLESS_CSS_PROPERTIES.contains(&css_property) {
        if value.fract() == 0.0 {
            format!("{}", value as i64)
        } else {
            format!("{}", value)
        }
    } else if value == 0.0 {
        "0".to_string()
    } else if value.fract() == 0.0 {
        format!("{}px", value as i64)
    } else {
        format!("{}px", value)
    }
}

// ---------------------------------------------------------------------------
// Dynamic prop variable slot class generation
// ---------------------------------------------------------------------------

use crate::project_analyzer::DynamicPropMeta;

/// Build ResolvedStyles entries for dynamic prop variable slot classes.
/// Returns (class_name, ResolvedStyles, css_property) tuples that can be
/// merged into the utility CSS emission stream for single-pass cascade ordering.
pub fn build_variable_slot_entries(
    dynamic_props: &HashMap<String, DynamicPropMeta>,
    breakpoints: &BreakpointMap,
) -> Vec<(String, ResolvedStyles, String)> {
    let mut entries = Vec::new();

    // Sort breakpoints by pixel value for deterministic responsive ordering
    let mut sorted_bps: Vec<(&String, &u32)> = breakpoints.breakpoints.iter().collect();
    sorted_bps.sort_by_key(|(_, px)| *px);

    for (_prop_name, meta) in dynamic_props {
        let css_property = camel_to_kebab(&meta.property);

        // Base declarations
        let base_declarations = if meta.properties.is_empty() {
            vec![CssDeclaration {
                property: css_property.clone(),
                value: format!("var({})", meta.var_name),
            }]
        } else {
            meta.properties
                .iter()
                .map(|p| CssDeclaration {
                    property: camel_to_kebab(p),
                    value: format!("var({})", meta.var_name),
                })
                .collect()
        };

        // Base slot class: simple var() reference, no @media wrapper
        let styles = ResolvedStyles {
            declarations: base_declarations,
            pseudo_selectors: vec![],
            responsive: vec![],
            responsive_pseudos: vec![],
        };

        entries.push((meta.slot_class.clone(), styles, css_property.clone()));

        // Per-breakpoint slot classes: each gets its own class with a simple var() reference,
        // wrapped in an @media query. Runtime only applies the classes for breakpoints
        // the user actually provides — no cascade leak from unset breakpoints.
        for (bp_name, _) in &sorted_bps {
            let bp_var = format!("{}-{}", meta.var_name, bp_name);
            let bp_class = format!("{}-{}", meta.slot_class, bp_name);

            let bp_decls = if meta.properties.is_empty() {
                vec![CssDeclaration {
                    property: css_property.clone(),
                    value: format!("var({})", bp_var),
                }]
            } else {
                meta.properties
                    .iter()
                    .map(|p| CssDeclaration {
                        property: camel_to_kebab(p),
                        value: format!("var({})", bp_var),
                    })
                    .collect()
            };

            let bp_styles = ResolvedStyles {
                declarations: vec![],
                pseudo_selectors: vec![],
                responsive: vec![(bp_name.to_string(), bp_decls)],
                responsive_pseudos: vec![],
            };

            entries.push((bp_class, bp_styles, css_property.clone()));
        }
    }

    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme_resolver::CssDeclaration;

    use crate::theme_resolver::ContextualVarsMap;

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

    /// Owns resolution data for test utility CSS calls.
    struct TestUtilCtx {
        config: PropConfigMap,
        theme: FlatTheme,
        vars: VariableMap,
        ctx_vars: ContextualVarsMap,
        bp_keys: HashSet<String>,
        aliases: SelectorAliasesMap,
    }

    impl TestUtilCtx {
        fn new(config: PropConfigMap, theme: FlatTheme, bp: &BreakpointMap) -> Self {
            Self {
                config,
                theme,
                vars: empty_vars(),
                ctx_vars: ContextualVarsMap::new(),
                bp_keys: bp.breakpoints.keys().cloned().collect(),
                aliases: SelectorAliasesMap::new(),
            }
        }

        fn ctx(&self) -> ResolveContext {
            ResolveContext {
                config: &self.config,
                theme: &self.theme,
                variable_map: &self.vars,
                contextual_vars: &self.ctx_vars,
                breakpoint_keys: &self.bp_keys,
                selector_aliases: &self.aliases,
            }
        }
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
            compounds: vec![],
            states: vec![],
        }];

        let css = generate_css(&components, &test_breakpoints());
        assert!(css.contains("@layer global, base, variants, compounds, states, system, custom;"));
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
            compounds: vec![],
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
            compounds: vec![],
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
            compounds: vec![],
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
            compounds: vec![],
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
        let name = make_class_name("ButtonContainer", "some-chain-data", "animus");
        assert!(name.starts_with("animus-ButtonContainer-"));
        assert_eq!(name.len(), "animus-ButtonContainer-".len() + 8);
    }

    #[test]
    fn layer_declaration_order() {
        let css = generate_css(&[], &test_breakpoints());
        assert!(css.starts_with("@layer global, base, variants, compounds, states, system, custom;"));
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
                scale: Some(serde_json::Value::String("space".to_string())),
                transform: None,
                current_var: None,
                transform_fn_source: None,
            },
        );
        config.insert(
            "mt".to_string(),
            PropConfig {
                property: "marginTop".to_string(),
                properties: vec![],
                scale: Some(serde_json::Value::String("space".to_string())),
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
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let usages = vec![UtilityInput {
            prop_name: "p".to_string(),
            value: json!(8),
        }];
        let out = generate_utility_css(&usages, &tc.ctx(), &bp, None, "animus");
        assert!(out.css.contains("@layer system {"));
        assert!(out.css.contains("padding: 0.5rem;"));
        // Class selector must use the animus-u- prefix
        assert!(out.css.contains(".animus-u-"));
    }

    #[test]
    fn generates_responsive_utility() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let usages = vec![UtilityInput {
            prop_name: "mt".to_string(),
            value: json!({ "_": 8, "sm": 16 }),
        }];
        let out = generate_utility_css(&usages, &tc.ctx(), &bp, None, "animus");
        // Base value
        assert!(out.css.contains("margin-top: 0.5rem;"));
        // Responsive value inside @media
        assert!(out.css.contains("@media (min-width: 768px)"));
        assert!(out.css.contains("margin-top: 1rem;"));
    }

    #[test]
    fn utility_class_name_deterministic() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let usages = vec![UtilityInput {
            prop_name: "p".to_string(),
            value: json!(8),
        }];
        let out1 = generate_utility_css(&usages, &tc.ctx(), &bp, None, "animus");
        let out2 = generate_utility_css(&usages, &tc.ctx(), &bp, None, "animus");
        assert_eq!(out1.css, out2.css);
        let map1 = &out1.class_map["p"]["8"];
        let map2 = &out2.class_map["p"]["8"];
        assert_eq!(map1, map2);
    }

    #[test]
    fn different_values_different_classes() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
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
        let out = generate_utility_css(&usages, &tc.ctx(), &bp, None, "animus");
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
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let usages = vec![UtilityInput {
            prop_name: "p".to_string(),
            value: json!(8),
        }];
        let out = generate_custom_prop_css(&usages, &tc.config, &tc.ctx(), &bp, None, "animus");
        assert!(out.css.contains("@layer custom {"));
        assert!(!out.css.contains("@layer system {"));
    }

    #[test]
    fn class_map_structure() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let usages = vec![UtilityInput {
            prop_name: "p".to_string(),
            value: json!(8),
        }];
        let out = generate_utility_css(&usages, &tc.ctx(), &bp, None, "animus");
        // class_map["p"]["8"] must be a class name that appears in the CSS
        assert!(out.class_map.contains_key("p"));
        let p_map = &out.class_map["p"];
        assert!(p_map.contains_key("8"));
        let class_name = &p_map["8"];
        assert!(class_name.starts_with("animus-u-"));
        assert!(out.css.contains(class_name.as_str()));
    }

    // ==================================================================
    // Variable slot CSS generation tests
    // ==================================================================

    #[test]
    fn variable_slot_single_property() {
        let mut dynamic_props = HashMap::new();
        dynamic_props.insert(
            "p".to_string(),
            DynamicPropMeta {
                var_name: "--animus-p".to_string(),
                slot_class: "animus-dyn-p".to_string(),
                property: "padding".to_string(),
                properties: vec![],
                transform_name: None,
                transform_fn_source: None,
                scale_values: HashMap::new(),
            },
        );
        let bp = test_breakpoints();
        let entries = build_variable_slot_entries(&dynamic_props, &bp);
        // 1 base + 5 per-breakpoint = 6
        assert_eq!(entries.len(), 6);
        assert_eq!(entries[0].0, "animus-dyn-p");
        // Base declaration uses var()
        assert_eq!(entries[0].1.declarations[0].property, "padding");
        assert_eq!(entries[0].1.declarations[0].value, "var(--animus-p)");
        // Base slot class has no responsive entries (standalone)
        assert!(entries[0].1.responsive.is_empty());
        // Per-breakpoint slot classes are separate entries
        // 5 breakpoints → 5 additional entries (total 6 including base)
        assert_eq!(entries.len(), 6);
        // xs entry: own class, wrapped in @media
        assert_eq!(entries[1].0, "animus-dyn-p-xs");
        assert!(entries[1].1.declarations.is_empty()); // no base decls
        assert_eq!(entries[1].1.responsive.len(), 1);
        assert_eq!(entries[1].1.responsive[0].0, "xs");
        assert_eq!(entries[1].1.responsive[0].1[0].value, "var(--animus-p-xs)");
        // sm entry
        assert_eq!(entries[2].0, "animus-dyn-p-sm");
        assert_eq!(entries[2].1.responsive[0].1[0].value, "var(--animus-p-sm)");
        // xl entry (last)
        assert_eq!(entries[5].0, "animus-dyn-p-xl");
        assert_eq!(entries[5].1.responsive[0].1[0].value, "var(--animus-p-xl)");
    }

    #[test]
    fn variable_slot_multi_property() {
        let mut dynamic_props = HashMap::new();
        dynamic_props.insert(
            "px".to_string(),
            DynamicPropMeta {
                var_name: "--animus-px".to_string(),
                slot_class: "animus-dyn-px".to_string(),
                property: "padding".to_string(),
                properties: vec!["padding-left".to_string(), "padding-right".to_string()],
                transform_name: None,
                transform_fn_source: None,
                scale_values: HashMap::new(),
            },
        );
        let bp = test_breakpoints();
        let entries = build_variable_slot_entries(&dynamic_props, &bp);
        // 1 base + 5 per-breakpoint = 6
        assert_eq!(entries.len(), 6);
        // Base slot class has multi-property declarations
        assert_eq!(entries[0].1.declarations.len(), 2);
        assert_eq!(entries[0].1.declarations[0].property, "padding-left");
        assert_eq!(entries[0].1.declarations[1].property, "padding-right");
        // Per-bp slot classes also have multi-property declarations
        assert_eq!(entries[1].0, "animus-dyn-px-xs");
        assert_eq!(entries[1].1.responsive[0].1.len(), 2);
        assert_eq!(entries[1].1.responsive[0].1[0].value, "var(--animus-px-xs)");
    }

    #[test]
    fn variable_slot_empty_dynamic_props() {
        let dynamic_props: HashMap<String, DynamicPropMeta> = HashMap::new();
        let bp = test_breakpoints();
        let entries = build_variable_slot_entries(&dynamic_props, &bp);
        assert!(entries.is_empty());
    }

    #[test]
    fn slot_entries_merge_into_utility_stream() {
        let mut dynamic_props = HashMap::new();
        dynamic_props.insert(
            "p".to_string(),
            DynamicPropMeta {
                var_name: "--animus-p".to_string(),
                slot_class: "animus-dyn-p".to_string(),
                property: "padding".to_string(),
                properties: vec![],
                transform_name: None,
                transform_fn_source: None,
                scale_values: HashMap::new(),
            },
        );
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let slots = build_variable_slot_entries(&dynamic_props, &bp);
        let usages = vec![UtilityInput { prop_name: "p".to_string(), value: json!(8) }];
        let out = generate_utility_css(&usages, &tc.ctx(), &bp, Some(slots), "animus");
        // Both slot and static classes in same @layer system block
        assert!(out.css.contains("animus-dyn-p"));
        assert!(out.css.contains("animus-u-"));
        // Only one @layer system block
        assert_eq!(out.css.matches("@layer system {").count(), 1);
    }

    #[test]
    fn variable_slot_camel_to_kebab() {
        use crate::project_analyzer::camel_to_kebab;
        assert_eq!(camel_to_kebab("borderRadius"), "border-radius");
        assert_eq!(camel_to_kebab("p"), "p");
        assert_eq!(camel_to_kebab("mt"), "mt");
        assert_eq!(camel_to_kebab("paddingLeft"), "padding-left");
        assert_eq!(camel_to_kebab("backgroundColor"), "background-color");
    }

    // ------------------------------------------------------------------
    // Composed variant CSS emission
    // ------------------------------------------------------------------

    fn make_component_css(class_name: &str, variant_prop: &str, options: &[(&str, &str, &str)]) -> ComponentCss {
        ComponentCss {
            class_name: class_name.to_string(),
            base: None,
            variants: vec![VariantCss {
                prop: variant_prop.to_string(),
                options: options
                    .iter()
                    .map(|(name, prop, val)| {
                        (
                            name.to_string(),
                            ResolvedStyles {
                                declarations: vec![CssDeclaration {
                                    property: prop.to_string(),
                                    value: val.to_string(),
                                }],
                                ..Default::default()
                            },
                        )
                    })
                    .collect(),
            }],
            compounds: vec![],
            states: vec![],
        }
    }

    #[test]
    fn composed_emits_two_rules_per_option() {
        let components = vec![
            make_component_css("animus-Root-abc", "size", &[
                ("sm", "font-size", "0.875rem"),
                ("lg", "font-size", "1.25rem"),
            ]),
            make_component_css("animus-Child-def", "size", &[
                ("sm", "font-size", "0.875rem"),
                ("lg", "font-size", "1.25rem"),
            ]),
        ];

        let shared = vec![String::from("size")];
        let families = vec![ComposeFamilyRef {
            root_class: "animus-Root-abc",
            child_slots: vec![("Child", "animus-Child-def")],
            shared_keys: &shared,
        }];

        let bp = test_breakpoints();
        let css = generate_composed_variant_css(&families, &components, &bp);

        // Rule 1 (inheritance): .Root.Root--size-sm .Child
        assert!(css.contains(".animus-Root-abc.animus-Root-abc--size-sm .animus-Child-def"));
        // Rule 2 (override): .Root .Child.Child--size-sm
        assert!(css.contains(".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm"));
        // Both options
        assert!(css.contains("--size-sm"));
        assert!(css.contains("--size-lg"));
    }

    #[test]
    fn composed_specificity_three_classes_each() {
        let components = vec![
            make_component_css("animus-Root-abc", "size", &[
                ("sm", "padding", "4px"),
            ]),
            make_component_css("animus-Child-def", "size", &[
                ("sm", "padding", "4px"),
            ]),
        ];

        let shared = vec![String::from("size")];
        let families = vec![ComposeFamilyRef {
            root_class: "animus-Root-abc",
            child_slots: vec![("Child", "animus-Child-def")],
            shared_keys: &shared,
        }];

        let bp = test_breakpoints();
        let css = generate_composed_variant_css(&families, &components, &bp);

        // Count class selectors in each rule — should be 3 each
        // Rule 1: .Root.Root--size-sm .Child → 3 classes
        // Rule 2: .Root .Child.Child--size-sm → 3 classes
        for line in css.lines() {
            if line.trim_start().starts_with('.') && line.contains('{') {
                let selector = line.split('{').next().unwrap().trim();
                let class_count = selector.matches('.').count();
                assert_eq!(class_count, 3, "Selector '{}' should have exactly 3 class selectors", selector);
            }
        }
    }

    #[test]
    fn composed_source_order_inheritance_before_override() {
        let components = vec![
            make_component_css("animus-Root-abc", "size", &[
                ("sm", "padding", "4px"),
            ]),
            make_component_css("animus-Child-def", "size", &[
                ("sm", "padding", "4px"),
            ]),
        ];

        let shared = vec![String::from("size")];
        let families = vec![ComposeFamilyRef {
            root_class: "animus-Root-abc",
            child_slots: vec![("Child", "animus-Child-def")],
            shared_keys: &shared,
        }];

        let bp = test_breakpoints();
        let css = generate_composed_variant_css(&families, &components, &bp);

        // Inheritance rule must appear before override rule
        let inheritance_pos = css.find(".animus-Root-abc.animus-Root-abc--size-sm .animus-Child-def").unwrap();
        let override_pos = css.find(".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm").unwrap();
        assert!(inheritance_pos < override_pos, "Inheritance rule must come before override rule");
    }

    #[test]
    fn composed_multiple_shared_variants_multiple_children() {
        let root = make_component_css("animus-Root-abc", "size", &[
            ("sm", "font-size", "0.875rem"),
        ]);
        let mut child1 = make_component_css("animus-Control-def", "size", &[
            ("sm", "font-size", "0.875rem"),
        ]);
        child1.variants.push(VariantCss {
            prop: "tone".to_string(),
            options: vec![("muted".to_string(), ResolvedStyles {
                declarations: vec![CssDeclaration { property: "opacity".to_string(), value: "0.5".to_string() }],
                ..Default::default()
            })],
        });
        let child2 = make_component_css("animus-Label-ghi", "size", &[
            ("sm", "font-size", "0.875rem"),
        ]);

        let components = vec![root, child1, child2];

        let shared_keys = vec![String::from("size"), String::from("tone")];
        let families = vec![ComposeFamilyRef {
            root_class: "animus-Root-abc",
            child_slots: vec![
                ("Control", "animus-Control-def"),
                ("Label", "animus-Label-ghi"),
            ],
            shared_keys: &shared_keys,
        }];

        let bp = test_breakpoints();
        let css = generate_composed_variant_css(&families, &components, &bp);

        // Control gets both size and tone composed rules
        assert!(css.contains(".animus-Root-abc.animus-Root-abc--size-sm .animus-Control-def"));
        assert!(css.contains(".animus-Root-abc.animus-Root-abc--tone-muted .animus-Control-def"));
        // Label gets size composed rules (no tone variant on Label → no tone rules)
        assert!(css.contains(".animus-Root-abc.animus-Root-abc--size-sm .animus-Label-ghi"));
        assert!(!css.contains("--tone-muted .animus-Label-ghi"));
    }

    #[test]
    fn composed_includes_pseudo_selectors() {
        let child = ComponentCss {
            class_name: "animus-Child-def".to_string(),
            base: None,
            variants: vec![VariantCss {
                prop: "size".to_string(),
                options: vec![("sm".to_string(), ResolvedStyles {
                    declarations: vec![CssDeclaration {
                        property: "padding".to_string(),
                        value: "4px".to_string(),
                    }],
                    pseudo_selectors: vec![(
                        ":hover".to_string(),
                        vec![CssDeclaration {
                            property: "background-color".to_string(),
                            value: "blue".to_string(),
                        }],
                    )],
                    ..Default::default()
                })],
            }],
            compounds: vec![],
            states: vec![],
        };
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let components = vec![root, child];

        let shared = vec![String::from("size")];
        let families = vec![ComposeFamilyRef {
            root_class: "animus-Root-abc",
            child_slots: vec![("Child", "animus-Child-def")],
            shared_keys: &shared,
        }];

        let bp = test_breakpoints();
        let css = generate_composed_variant_css(&families, &components, &bp);

        // Inheritance pseudo: .Root.Root--size-sm .Child:hover
        assert!(css.contains(".animus-Root-abc.animus-Root-abc--size-sm .animus-Child-def:hover"));
        // Override pseudo: .Root .Child.Child--size-sm:hover
        assert!(css.contains(".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm:hover"));
        // Pseudo declarations present
        assert!(css.contains("background-color: blue"));
    }
}
