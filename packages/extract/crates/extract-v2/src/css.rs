//! CSS generation — v1 `css_generator.rs` ported VERBATIM (row 07 Task
//! 07.5). @layer-structured emission with v1's deterministic ordering
//! (the promoted output-ordering contract per design.md §Risks: sorted
//! component ids, sorted declarations, topological cascade ranks).
//! v1's test module is carried verbatim below as the executable contract.
//! DynamicPropMeta mirrors the facts-layer shape; camel_to_kebab is
//! inlined (v1 hosts it in project_analyzer).

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write;

use rustc_hash::FxHashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;


use crate::theme::{ConditionedGroup, CssDeclaration, PropConfigMap, ResolveContext, ResolvedStyles, first_top_level_branch, resolve_styles, split_top_level_commas};

/// v1 project_analyzer::camel_to_kebab, inlined VERBATIM for the v2 port.
pub fn camel_to_kebab(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                result.push('-');
            }
            result.push(ch.to_lowercase().next().unwrap());
        } else {
            result.push(ch);
        }
    }
    result
}

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
    /// `@layer global { ... }` — resolved global style blocks
    #[serde(default)]
    pub global: String,
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

/// Per-component CSS fragments for the 4 splittable layers.
/// Used for incremental HMR and future route-level code-splitting.
/// system/custom layers are cross-cutting (deduplicated utilities) and stay monolithic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerComponentSheets {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variants: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compounds: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub states: Option<String>,
}

/// Ordered fragment storage with O(1) lookup by component_id.
/// Fragments are stored in topological order (matching reconciled_order)
/// to preserve CSS cascade correctness.
pub struct CssFragmentStore {
    pub base: Vec<(String, String)>,
    pub variants: Vec<(String, String)>,
    pub compounds: Vec<(String, String)>,
    pub states: Vec<(String, String)>,
    pub base_index: FxHashMap<String, usize>,
    pub variants_index: FxHashMap<String, usize>,
    pub compounds_index: FxHashMap<String, usize>,
    pub states_index: FxHashMap<String, usize>,
    pub total_base_bytes: usize,
    pub total_variants_bytes: usize,
    pub total_compounds_bytes: usize,
    pub total_states_bytes: usize,
}

impl Default for CssFragmentStore {
    fn default() -> Self {
        Self::new()
    }
}

impl CssFragmentStore {
    pub fn new() -> Self {
        Self {
            base: Vec::new(),
            variants: Vec::new(),
            compounds: Vec::new(),
            states: Vec::new(),
            base_index: FxHashMap::default(),
            variants_index: FxHashMap::default(),
            compounds_index: FxHashMap::default(),
            states_index: FxHashMap::default(),
            total_base_bytes: 0,
            total_variants_bytes: 0,
            total_compounds_bytes: 0,
            total_states_bytes: 0,
        }
    }

    /// Convert fragments into a HashMap<component_id, PerComponentSheets> for serialization.
    pub fn to_per_component_map(&self) -> HashMap<String, PerComponentSheets> {
        let mut map: HashMap<String, PerComponentSheets> = HashMap::new();
        for (id, css) in &self.base {
            map.entry(id.clone()).or_insert_with(|| PerComponentSheets {
                base: None, variants: None, compounds: None, states: None,
            }).base = Some(css.clone());
        }
        for (id, css) in &self.variants {
            map.entry(id.clone()).or_insert_with(|| PerComponentSheets {
                base: None, variants: None, compounds: None, states: None,
            }).variants = Some(css.clone());
        }
        for (id, css) in &self.compounds {
            map.entry(id.clone()).or_insert_with(|| PerComponentSheets {
                base: None, variants: None, compounds: None, states: None,
            }).compounds = Some(css.clone());
        }
        for (id, css) in &self.states {
            map.entry(id.clone()).or_insert_with(|| PerComponentSheets {
                base: None, variants: None, compounds: None, states: None,
            }).states = Some(css.clone());
        }
        map
    }

    /// Concatenate base fragments in order into a single string.
    pub fn concat_base(&self) -> String {
        let mut out = String::with_capacity(self.total_base_bytes);
        for (_, css) in &self.base {
            out.push_str(css);
        }
        out
    }

    /// Concatenate variant fragments in order into a single string.
    pub fn concat_variants(&self) -> String {
        let mut out = String::with_capacity(self.total_variants_bytes);
        for (_, css) in &self.variants {
            out.push_str(css);
        }
        out
    }

    /// Concatenate compound fragments in order into a single string.
    pub fn concat_compounds(&self) -> String {
        let mut out = String::with_capacity(self.total_compounds_bytes);
        for (_, css) in &self.compounds {
            out.push_str(css);
        }
        out
    }

    /// Concatenate state fragments in order into a single string.
    pub fn concat_states(&self) -> String {
        let mut out = String::with_capacity(self.total_states_bytes);
        for (_, css) in &self.states {
            out.push_str(css);
        }
        out
    }
}

/// Breakpoint pixel values for responsive @media queries.
#[derive(Debug, Clone)]
pub struct BreakpointMap {
    pub breakpoints: FxHashMap<String, u32>,
}

impl BreakpointMap {
    pub fn new(breakpoints: FxHashMap<String, u32>) -> Self {
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
    /// The default option name, if `defaultVariant` was specified.
    /// Used to emit a sidecar `--{prop}-default` class with the default option's styles.
    pub default_option: Option<String>,
}

/// The canonical layer prefix. All Animus layers are namespaced under `anm-`
/// to avoid collision with other frameworks' layers (e.g., Tailwind's `base`).
/// Uses dash (not dot) to keep layers flat and interleave-able.
const LAYER_PREFIX: &str = "anm";

/// Format a layer name with the canonical `anm-` prefix.
/// `"base"` becomes `"anm-base"`, `"variants"` becomes `"anm-variants"`.
pub fn layer_name(name: &str) -> String {
    format!("{}-{}", LAYER_PREFIX, name)
}

/// Generate the full @layer-structured CSS output for all components.
pub fn generate_css(
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
) -> String {
    let mut output = String::new();

    // Layer declaration
    let layer_names: Vec<String> = ["global", "base", "variants", "compounds", "states", "system", "custom"]
        .iter()
        .map(|n| layer_name(n))
        .collect();
    writeln!(output, "@layer {};", layer_names.join(", ")).unwrap();
    writeln!(output).unwrap();

    // Base layer
    let base_css = generate_layer_content(components, breakpoints, LayerKind::Base);
    if !base_css.is_empty() {
        writeln!(output, "@layer {} {{", layer_name("base")).unwrap();
        output.push_str(&base_css);
        writeln!(output, "}}").unwrap();
        writeln!(output).unwrap();
    }

    // Variants layer
    let variants_css = generate_layer_content(components, breakpoints, LayerKind::Variants);
    if !variants_css.is_empty() {
        writeln!(output, "@layer {} {{", layer_name("variants")).unwrap();
        output.push_str(&variants_css);
        writeln!(output, "}}").unwrap();
        writeln!(output).unwrap();
    }

    // Compounds layer
    let compounds_css = generate_layer_content(components, breakpoints, LayerKind::Compounds);
    if !compounds_css.is_empty() {
        writeln!(output, "@layer {} {{", layer_name("compounds")).unwrap();
        output.push_str(&compounds_css);
        writeln!(output, "}}").unwrap();
        writeln!(output).unwrap();
    }

    // States layer
    let states_css = generate_layer_content(components, breakpoints, LayerKind::States);
    if !states_css.is_empty() {
        writeln!(output, "@layer {} {{", layer_name("states")).unwrap();
        output.push_str(&states_css);
        writeln!(output, "}}").unwrap();
    }

    output
}


/// Generate structured per-layer CSS sheets with topological ordering.
///
/// Returns `(CssSheets, CssFragmentStore)`. The `system` and `custom` fields on
/// CssSheets are left empty — the caller populates them from utility/custom CSS generation.
/// The CssFragmentStore contains per-component CSS fragments keyed by component_id.
pub fn generate_css_sheets_ordered(
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
    order: &[String],
    class_prefix: &str,
) -> (CssSheets, CssFragmentStore) {
    // Build ordered (component_id, &ComponentCss) pairs
    let order_index: FxHashMap<String, usize> = order
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), i))
        .collect();

    let mut indexed: Vec<(usize, String, &ComponentCss)> = components
        .iter()
        .map(|comp| {
            if order.is_empty() {
                return (0, String::new(), comp);
            }
            let (rank, id) = order_index
                .iter()
                .filter_map(|(id, idx)| {
                    let binding = id.split("::").last()?;
                    if comp.class_name.starts_with(&format!("{}-{}-", class_prefix, binding)) {
                        Some((*idx, id.clone()))
                    } else {
                        None
                    }
                })
                .next()
                .unwrap_or((usize::MAX, String::new()));
            (rank, id, comp)
        })
        .collect();

    if !order.is_empty() {
        indexed.sort_by_key(|(rank, _, _)| *rank);
    }

    // Single-pass: generate fragments for all 4 layers simultaneously
    let mut fragments = CssFragmentStore::new();

    for (_, component_id, component) in &indexed {
        let id = component_id.clone();

        // Base fragment
        if let Some(base) = &component.base {
            let mut frag = String::with_capacity(512);
            write_rule_block(&mut frag, &component.class_name, base, breakpoints);
            if !frag.is_empty() {
                fragments.total_base_bytes += frag.len();
                let idx = fragments.base.len();
                fragments.base_index.insert(id.clone(), idx);
                fragments.base.push((id.clone(), frag));
            }
        }

        // Variants fragment
        if !component.variants.is_empty() {
            let mut frag = String::with_capacity(512);
            for variant in &component.variants {
                for (option_name, styles) in &variant.options {
                    let selector = format!(
                        "{}--{}-{}",
                        component.class_name, variant.prop, option_name
                    );
                    write_rule_block(&mut frag, &selector, styles, breakpoints);
                }
                if let Some(ref default_name) = variant.default_option {
                    if let Some((_name, styles)) = variant.options.iter().find(|(n, _)| n == default_name) {
                        let selector = format!("{}--{}-default", component.class_name, variant.prop);
                        write_rule_block(&mut frag, &selector, styles, breakpoints);
                    }
                }
            }
            if !frag.is_empty() {
                fragments.total_variants_bytes += frag.len();
                let idx = fragments.variants.len();
                fragments.variants_index.insert(id.clone(), idx);
                fragments.variants.push((id.clone(), frag));
            }
        }

        // Compounds fragment
        if !component.compounds.is_empty() {
            let mut frag = String::with_capacity(512);
            for (index, styles) in component.compounds.iter().enumerate() {
                let selector = format!("{}--compound-{}", component.class_name, index);
                write_rule_block(&mut frag, &selector, styles, breakpoints);
            }
            if !frag.is_empty() {
                fragments.total_compounds_bytes += frag.len();
                let idx = fragments.compounds.len();
                fragments.compounds_index.insert(id.clone(), idx);
                fragments.compounds.push((id.clone(), frag));
            }
        }

        // States fragment
        if !component.states.is_empty() {
            let mut frag = String::with_capacity(512);
            for (state_name, styles) in &component.states {
                let selector = format!("{}--{}", component.class_name, state_name);
                write_rule_block(&mut frag, &selector, styles, breakpoints);
            }
            if !frag.is_empty() {
                fragments.total_states_bytes += frag.len();
                let idx = fragments.states.len();
                fragments.states_index.insert(id.clone(), idx);
                fragments.states.push((id.clone(), frag));
            }
        }
    }

    // Derive CssSheets from fragments
    let layer_names: Vec<String> = ["global", "base", "variants", "compounds", "states", "system", "custom"]
        .iter()
        .map(|n| layer_name(n))
        .collect();
    let declaration = format!("@layer {};\n", layer_names.join(", "));

    let base_content = fragments.concat_base();
    let base = if !base_content.is_empty() {
        format!("@layer {} {{\n{}}}\n", layer_name("base"), base_content)
    } else {
        String::new()
    };

    let variants_content = fragments.concat_variants();
    let variants = if !variants_content.is_empty() {
        format!("@layer {} {{\n{}}}\n", layer_name("variants"), variants_content)
    } else {
        String::new()
    };

    let compounds_content = fragments.concat_compounds();
    let compounds = if !compounds_content.is_empty() {
        format!("@layer {} {{\n{}}}\n", layer_name("compounds"), compounds_content)
    } else {
        String::new()
    };

    let states_content = fragments.concat_states();
    let states = if !states_content.is_empty() {
        format!("@layer {} {{\n{}}}\n", layer_name("states"), states_content)
    } else {
        String::new()
    };

    let sheets = CssSheets {
        declaration,
        global: String::new(),
        base,
        variants,
        compounds,
        states,
        system: String::new(),
        custom: String::new(),
    };

    (sheets, fragments)
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
                    if let Some(ref default_name) = variant.default_option {
                        if let Some((_name, styles)) = variant.options.iter().find(|(n, _)| n == default_name) {
                            let selector = format!("{}--{}-default", component.class_name, variant.prop);
                            write_rule_block(&mut output, &selector, styles, breakpoints);
                        }
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
    let mut sorted_responsive: Vec<(&String, &Vec<CssDeclaration>)> =
        styles.breakpoint_groups().collect();
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

    // Responsive selector groups (inc 05: responsive value maps inside
    // selector blocks) — px ascending, after the selectorless breakpoint
    // rules; one @media wrapper per (breakpoint, selector) group (the
    // per-triple granularity decided at population time — journal R7/R8).
    let mut sorted_responsive_selectors: Vec<(&String, &String, &Vec<CssDeclaration>)> =
        styles.breakpoint_selector_groups().collect();
    sorted_responsive_selectors.sort_by_key(|(bp_name, _, _)| {
        breakpoints.breakpoints.get(bp_name.as_str()).copied().unwrap_or(0)
    });
    for (bp_name, sel, declarations) in sorted_responsive_selectors {
        if let Some(mq) = breakpoints.media_query(bp_name) {
            if !declarations.is_empty() {
                writeln!(output, "  {} {{", mq).unwrap();
                write_declarations_indented(
                    output,
                    &format_pseudo_selector(selector, sel),
                    declarations,
                    4,
                );
                writeln!(output, "  }}").unwrap();
            }
        }
    }

    // Condition blocks (Media/Container/Supports) — after breakpoints, in
    // registry/source order (design D4). Nested inside the owning @layer.
    write_condition_blocks(output, &[format!(".{}", selector)], styles, breakpoints);
}

/// Sort order for pseudo-selectors within a single rule block.
/// Later position = higher cascade precedence within the same specificity tier.
/// Follows LVHA convention and interaction semantics.
fn pseudo_sort_order(selector: &str) -> u32 {
    // Extract the first selector BRANCH for compound selectors, splitting on
    // top-level commas only. A naive `split(',')` truncates the branch at a
    // comma inside a functional pseudo, which drops whatever the tail carried:
    // `:is(:hover, [data-disabled])` becomes `:is(:hover`, losing the
    // `[data-disabled` token that tiers it at 200 and sorting it as an unknown
    // 900 instead. Only shapes whose first branch holds a protected comma
    // differ at all.
    let first = first_top_level_branch(selector).trim();
    let exact = match first {
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
    };
    if exact != 900 {
        return exact;
    }
    // Composed selectors (inc 05): order by the OUTER segment's cascade
    // position — the longest known pseudo head wins; unknown heads keep the
    // 900/insertion bucket. Exact matches above are untouched (depth-1
    // byte-identity); pre-inc-05 output has no composed producers.
    const KNOWN_HEADS: &[(&str, u32)] = &[
        (":focus-within", 40),
        (":focus-visible", 60),
        (":first-child", 400),
        (":last-child", 410),
        ("::placeholder", 320),
        ("::selection", 330),
        ("::before", 300),
        ("::after", 310),
        (":visited", 20),
        (":hover", 30),
        (":active", 70),
        (":target", 80),
        (":focus", 50),
        (":empty", 440),
        (":link", 10),
    ];
    let mut best: Option<(usize, u32)> = None;
    for (head, ord) in KNOWN_HEADS {
        if first.starts_with(head)
            && first.len() > head.len()
            && best.is_none_or(|(len, _)| head.len() > len)
        {
            best = Some((head.len(), *ord));
        }
    }
    best.map_or(900, |(_, ord)| ord)
}

/// Format a pseudo-selector against a bare class NAME.
/// `class` + `:hover,:focus` → `.class:hover, .class:focus`
///
/// Same branch contract as `format_composed_pseudo`, which it delegates to
/// after dot-prefixing the class.
fn format_pseudo_selector(class: &str, pseudo: &str) -> String {
    format_composed_pseudo(&format!(".{}", class), pseudo)
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

/// Emit non-breakpoint condition blocks (Media/Container/Supports) wrapping
/// one or more inner selectors, in deterministic emission order (design D4:
/// aliased conditions by registry order, then raw keys in source order). Each
/// at-rule nests INSIDE the caller's `@layer` block; the class selector nests
/// inside the at-rule. `inner_selectors` are the fully-formed, dot-prefixed
/// selector strings (one for base/variant/state/utility rules; two for the
/// composed inheritance/override pair; one for an expanded compound). Callers
/// invoke this AFTER pseudos and breakpoint media queries so the total
/// within-rule order holds.
fn write_condition_blocks(
    output: &mut String,
    inner_selectors: &[String],
    styles: &ResolvedStyles,
    breakpoints: &BreakpointMap,
) {
    for group in styles.conditioned_emission_order() {
        if group.declarations.is_empty() {
            continue;
        }
        // Resolve every prelude in the stack (inc 05: stacks wrap
        // outermost-first; inner Breakpoint conditions resolve through the
        // BreakpointMap — e.g. a responsive value map inside a container
        // block). A stack with an unresolvable member emits nothing.
        let mut preludes: Vec<String> = Vec::with_capacity(group.conditions.len());
        let mut resolvable = true;
        for condition in &group.conditions {
            match condition {
                crate::theme::Condition::Breakpoint(bp) => match breakpoints.media_query(bp) {
                    Some(mq) => preludes.push(mq),
                    None => {
                        resolvable = false;
                        break;
                    }
                },
                other => match other.prelude() {
                    Some(p) => preludes.push(p.to_string()),
                    None => {
                        resolvable = false;
                        break;
                    }
                },
            }
        }
        if !resolvable || preludes.is_empty() {
            continue;
        }
        for (depth, prelude) in preludes.iter().enumerate() {
            writeln!(output, "{}{} {{", "  ".repeat(depth + 1), prelude).unwrap();
        }
        let decl_indent = 2 * (preludes.len() + 1);
        for inner in inner_selectors {
            // Nested selector within the condition. Branches arrive
            // `,`-joined and untrimmed, so `format_composed_pseudo` preserves
            // authored descendant combinators.
            let sel = match &group.selector {
                Some(s) => format_composed_pseudo(inner, s),
                None => inner.clone(),
            };
            write_declarations_indented(output, &sel, &group.declarations, decl_indent);
        }
        for depth in (0..preludes.len()).rev() {
            writeln!(output, "{}}}", "  ".repeat(depth + 1)).unwrap();
        }
    }
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
/// - Rule 1 (inheritance): `.Root--var-opt .Child { declarations }` — (0,2,0)
/// - Rule 2 (override): `.Root .Child.Child--var-opt { declarations }` — (0,3,0)
///
/// The caller wraps this output in `@layer composed { }` within the variants
/// sublayer structure. Standalone variant rules go in `@layer standalone { }`.
/// Layer ordering (standalone < composed) handles the category boundary;
/// the specificity gap within composed handles inheritance vs override.
///
/// Returns raw CSS content (no layer wrapper — caller provides sublayer structure).
pub fn generate_composed_variant_css(
    families: &[ComposeFamilyRef],
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
) -> String {
    let mut output = String::new();

    // Build a lookup: class_name → &ComponentCss
    let class_map: FxHashMap<&str, &ComponentCss> = components
        .iter()
        .map(|css| (css.class_name.as_str(), css))
        .collect();

    for family in families {
        let root_css = class_map.get(family.root_class);

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

                // ANI-005: when the shared prop is omitted at the callsite the
                // runtime writes `{root}--{prop}-default` instead of an option
                // class, so the ROOT's defaultVariant needs the same slot
                // propagation the explicit options get. Inheritance rule ONLY —
                // a `-default`-keyed override on the child side would let a
                // defaulted child outrank root inheritance, which the two-rule
                // model forbids.
                let Some(default_styles) = root_css
                    .and_then(|root| root.variants.iter().find(|v| v.prop == *shared_key))
                    .and_then(|root_variant| root_variant.default_option.as_deref())
                    .and_then(|default_name| {
                        variant.options.iter().find(|(n, _)| n == default_name)
                    })
                    .map(|(_, styles)| styles)
                else {
                    continue;
                };
                write_composed_default_inheritance_rule(
                    &mut output,
                    family.root_class,
                    child_class,
                    shared_key,
                    default_styles,
                    breakpoints,
                );
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

    // Rule 1 (inheritance): .Root--var-opt .Child — specificity (0,2,0)
    // Uses only the variant class (not the root identity class), keeping
    // inheritance structurally below override (0,3,0) within the composed sublayer.
    let inheritance_selector = format!(".{} .{}", variant_class, child_class);
    // Rule 2 (override): .Root .Child.Child--var-opt — specificity (0,3,0)
    let override_selector = format!(".{} .{}.{}", root_class, child_class, child_variant_class);

    write_composed_selector_rules(
        output,
        &[inheritance_selector, override_selector],
        styles,
        breakpoints,
    );
}

/// Emit the inheritance rule alone for the root's DEFAULT option of a shared
/// variant (ANI-005): `.Root--prop-default .Child`, matching the sidecar class
/// the runtime writes when the prop is omitted at the callsite. No override
/// counterpart — the child-suppression invariant requires a defaulted child to
/// keep losing to root inheritance.
fn write_composed_default_inheritance_rule(
    output: &mut String,
    root_class: &str,
    child_class: &str,
    variant_prop: &str,
    styles: &ResolvedStyles,
    breakpoints: &BreakpointMap,
) {
    let default_class = format!("{}--{}-default", root_class, variant_prop);
    let inheritance_selector = format!(".{} .{}", default_class, child_class);
    write_composed_selector_rules(
        output,
        std::slice::from_ref(&inheritance_selector),
        styles,
        breakpoints,
    );
}

/// Write one composed rule per selector, keeping every surface of the
/// resolved styles (declarations, pseudos, responsive, responsive pseudos,
/// condition blocks) in the same emission order for all of them.
fn write_composed_selector_rules(
    output: &mut String,
    selectors: &[String],
    styles: &ResolvedStyles,
    breakpoints: &BreakpointMap,
) {
    // Main declarations
    if !styles.declarations.is_empty() {
        for selector in selectors {
            write_declarations(output, selector, &styles.declarations);
        }
    }

    // Pseudo-selectors — sorted by cascade order, same as direct variant rules
    let mut sorted_pseudos: Vec<&(String, Vec<CssDeclaration>)> =
        styles.pseudo_selectors.iter().collect();
    sorted_pseudos.sort_by_key(|(sel, _)| pseudo_sort_order(sel));
    for (pseudo, declarations) in sorted_pseudos {
        if !declarations.is_empty() {
            for selector in selectors {
                let composed = format_composed_pseudo(selector, pseudo);
                write_declarations(output, &composed, declarations);
            }
        }
    }

    // Responsive declarations — sorted by breakpoint pixel value (ascending)
    let mut sorted_responsive: Vec<(&String, &Vec<CssDeclaration>)> =
        styles.breakpoint_groups().collect();
    sorted_responsive.sort_by_key(|(bp_name, _)| {
        breakpoints.breakpoints.get(bp_name.as_str()).copied().unwrap_or(0)
    });
    for (bp_name, declarations) in sorted_responsive {
        if let Some(mq) = breakpoints.media_query(bp_name) {
            if !declarations.is_empty() {
                writeln!(output, "  {} {{", mq).unwrap();
                for selector in selectors {
                    write_declarations_indented(output, selector, declarations, 4);
                }
                writeln!(output, "  }}").unwrap();
            }
        }
    }

    // Responsive pseudo-selectors — sorted by breakpoint pixel value (ascending)
    let mut sorted_responsive_pseudos: Vec<(&String, &String, &Vec<CssDeclaration>)> =
        styles.breakpoint_selector_groups().collect();
    sorted_responsive_pseudos.sort_by_key(|(bp_name, _, _)| {
        breakpoints.breakpoints.get(bp_name.as_str()).copied().unwrap_or(0)
    });
    for (bp_name, pseudo, declarations) in sorted_responsive_pseudos {
        if let Some(mq) = breakpoints.media_query(bp_name) {
            if !declarations.is_empty() {
                writeln!(output, "  {} {{", mq).unwrap();
                for selector in selectors {
                    let composed = format_composed_pseudo(selector, pseudo);
                    write_declarations_indented(output, &composed, declarations, 4);
                }
                writeln!(output, "  }}").unwrap();
            }
        }
    }

    // Condition blocks — every selector nests inside each at-rule (design D4),
    // after the breakpoint media queries.
    write_condition_blocks(output, selectors, styles, breakpoints);
}

// ---------------------------------------------------------------------------
// Shared-axis compound expansion — ancestor-form rules for child compounds
// ---------------------------------------------------------------------------

/// One compound's stored conditions: axis → required value, either a single
/// value or a list the runtime reads as "any of these".
pub type CompoundConditions = BTreeMap<String, Value>;

/// One compound's config — its conditions beside the flat compound class the
/// emitter enumerates for it.
pub type CompoundConfig = (CompoundConditions, String);

/// Compound configs keyed by component class name, each list in flat-rule
/// order.
pub type CompoundConditionMap<'a> = FxHashMap<&'a str, &'a [CompoundConfig]>;

/// Generate ancestor-form CSS for every child-slot compound whose conditions
/// reference at least one shared axis.
///
/// Under the CSS-only transport a shared axis reaches a child slot as a
/// SELECTOR, never as a prop: the child's runtime writes classes for its OWN
/// props only, so a compound that requires a shared axis never sees a value
/// for it and its flat `.{child}--compound-{N}` rule cannot activate. The
/// expansion moves the shared half of the conditions onto the Root — whose
/// runtime does write `--{prop}-{option}` classes — and leaves the child-only
/// half chained on the child, where the child's own classes carry it.
/// Emission is unconditional: a `context: true` family transports the prop as
/// well, and its flat rule may activate with the same declarations.
///
/// `compound_conditions` maps a component class name to that component's
/// compound configs, positionally aligned with `ComponentCss::compounds`: both
/// are built from the same styled (two-argument) compound stages, parent-first
/// through extension merge.
///
/// Returns raw CSS content for the compounds layer (no layer wrapper). The
/// flat rules stay ahead of it in the same layer and are not read, rewritten,
/// or renumbered here.
pub fn generate_composed_compound_css(
    families: &[ComposeFamilyRef],
    components: &[ComponentCss],
    compound_conditions: &CompoundConditionMap,
    breakpoints: &BreakpointMap,
) -> String {
    let mut output = String::new();

    let class_map: FxHashMap<&str, &ComponentCss> = components
        .iter()
        .map(|css| (css.class_name.as_str(), css))
        .collect();

    for family in families {
        let root_css = class_map.get(family.root_class).copied();

        for &(_, child_class) in &family.child_slots {
            let Some(child_css) = class_map.get(child_class) else {
                continue;
            };
            let Some(configs) = compound_conditions.get(child_class) else {
                continue;
            };
            // Zip, not index: a config list shorter than the styles list (or
            // longer) emits only the pairs whose alignment is certain.
            for (styles, (conditions, _)) in child_css.compounds.iter().zip(configs.iter()) {
                let Some(selector) = composed_compound_selector(
                    family.root_class,
                    root_css,
                    child_css,
                    family.shared_keys,
                    conditions,
                ) else {
                    continue;
                };
                write_composed_selector_rules(
                    &mut output,
                    std::slice::from_ref(&selector),
                    styles,
                    breakpoints,
                );
            }
        }
    }

    output
}

/// Build the ancestor-form selector for one compound's conditions, or `None`
/// when they touch no shared axis (the flat rule already covers them) or carry
/// a value shape no class can express.
///
/// Axis order is the conditions' own stored order — they arrive sorted by axis
/// name, so the emitted selector is stable across runs. Each axis contributes
/// exactly ONE piece to the chain: the bare class when it accepts one value,
/// `:is(…)` when it accepts several. An axis whose required value is also its
/// OWNER's default option gains a `--{axis}-default` alternative, the class
/// that owner's runtime writes when the prop is omitted at the callsite; the
/// owner is the Root for a shared axis and the slot for a slot-only one, so
/// both halves of a mixed condition set survive an omitted prop.
///
/// Every SHARED axis additionally contributes exclusions on the child side —
/// one `:not(.{child}--{axis}-{option})` per option the slot DECLARES on that
/// axis and the conditions do not accept. A slot that explicitly sets its own
/// value for a shared axis keeps its own flat compound, which this rule's
/// higher class count would otherwise outrank inside the layer. The
/// `--{axis}-default` class is never excluded: a defaulted slot keeps losing
/// to Root inheritance, the same suppression invariant the composed default
/// rule carries.
///
/// Option names are interpolated verbatim, as everywhere else in the emitter.
fn composed_compound_selector(
    root_class: &str,
    root_css: Option<&ComponentCss>,
    child_css: &ComponentCss,
    shared_keys: &[String],
    conditions: &CompoundConditions,
) -> Option<String> {
    let child_class = child_css.class_name.as_str();
    let mut root_chain = String::new();
    let mut child_chain = String::new();
    let mut child_exclusions = String::new();
    let mut any_shared = false;

    for (axis, value) in conditions {
        let shared = shared_keys.iter().any(|key| key == axis);
        any_shared |= shared;
        let (owner, owner_css) = if shared {
            (root_class, root_css)
        } else {
            (child_class, Some(child_css))
        };
        let values = compound_axis_values(value);
        let mut alternatives: Vec<String> = values
            .iter()
            .map(|option| format!(".{}--{}-{}", owner, axis, option))
            .collect();
        if alternatives.is_empty() {
            // A value that is neither a string nor a list of strings names no
            // class — the whole compound stays flat-only.
            return None;
        }
        let owner_default = owner_css
            .and_then(|css| css.variants.iter().find(|variant| variant.prop == *axis))
            .and_then(|variant| variant.default_option.as_deref());
        if owner_default.is_some_and(|option| values.contains(&option)) {
            alternatives.push(format!(".{}--{}-default", owner, axis));
        }

        if shared {
            root_chain.push_str(&compound_axis_group(&alternatives));
            for (option, _) in declared_options(child_css, axis) {
                if !values.contains(&option.as_str()) {
                    write!(
                        child_exclusions,
                        ":not(.{}--{}-{})",
                        child_class, axis, option
                    )
                    .unwrap();
                }
            }
        } else {
            child_chain.push_str(&compound_axis_group(&alternatives));
        }
    }
    if !any_shared {
        return None;
    }

    Some(format!(
        "{} .{}{}{}",
        root_chain, child_class, child_chain, child_exclusions
    ))
}

/// One axis as a single compound-selector piece: the bare class when the axis
/// accepts one value, `:is(…)` when it accepts several. Both spend the same
/// specificity — `:is()` counts its most specific argument and every argument
/// here is a single class — and the grouped form stays linear in the number of
/// accepted values where a per-axis product would not.
fn compound_axis_group(alternatives: &[String]) -> String {
    match alternatives {
        [only] => only.clone(),
        _ => format!(":is({})", alternatives.join(",")),
    }
}

/// The options a component declares for a prop, in declaration order.
///
/// The exclusion set built from this is dev/prod-stable only because the
/// reconciler force-marks every option of a shared key on a non-root slot as
/// used (the compose-family interlock): were an option pruned in production,
/// its `:not(…)` would vanish and the ancestor form would start matching a
/// slot it lost to in dev. That interlock is now load-bearing for the
/// exclusions as well as for the composed variant rules.
fn declared_options<'a>(css: &'a ComponentCss, prop: &str) -> &'a [(String, ResolvedStyles)] {
    css.variants
        .iter()
        .find(|variant| variant.prop == prop)
        .map_or(&[][..], |variant| variant.options.as_slice())
}

/// The values an axis accepts: a single value, or every string in a value list
/// (the runtime reads a list as "any of these").
fn compound_axis_values(value: &Value) -> Vec<&str> {
    match value {
        Value::String(option) => vec![option.as_str()],
        Value::Array(options) => options.iter().filter_map(|option| option.as_str()).collect(),
        _ => Vec::new(),
    }
}

/// Format a pseudo-selector appended to a full composed selector.
/// `.Root.Root--size-sm .Child` + `:hover` → `.Root.Root--size-sm .Child:hover`
/// Handles comma-separated pseudos: `:hover,:focus` → two selectors.
///
/// Branches split on TOP-LEVEL commas only and are NOT trimmed: the stored
/// form joins with `","`, so a branch's leading whitespace is the authored
/// descendant combinator (`" p + ul, ul + p"` → `.C p + ul, .C ul + p`).
/// Comma-free input takes the same path and yields one branch unchanged.
///
/// The selector is appended to whole: a compound expansion's `:is()` groups
/// keep their commas inside parentheses, so nothing there splits.
fn format_composed_pseudo(selector: &str, pseudo: &str) -> String {
    split_top_level_commas(pseudo)
        .into_iter()
        .map(|part| format!("{}{}", selector, part))
        .collect::<Vec<_>>()
        .join(", ")
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

    // Responsive blocks — sort by breakpoint name.
    let mut responsive: Vec<(&String, &Vec<CssDeclaration>)> =
        styles.breakpoint_groups().collect();
    responsive.sort_by_key(|(a, _)| *a);
    for (bp, bp_decls) in &responsive {
        write!(out, "@{}{{", bp).unwrap();
        let mut sorted = (*bp_decls).clone();
        sorted.sort_by(|a, b| a.property.cmp(&b.property));
        for d in &sorted {
            write!(out, "{}:{};", d.property, d.value).unwrap();
        }
        write!(out, "}}").unwrap();
    }

    // Non-breakpoint condition blocks (Media/Container/Supports) — admitted
    // into the hash (inc 03) so two usages differing ONLY by a condition
    // block hash to distinct classes instead of colliding into one. Sorted
    // by (prelude, selector) for order-independence; declarations sorted by
    // property for insertion-order stability, matching the base/breakpoint
    // treatment above.
    // inc 05: the hash key is the FULL condition stack (inner Breakpoint
    // members rendered as `bp:<name>`) plus the nested selector, so usages
    // differing in any stack member or selector hash to distinct classes.
    // The legacy selectorless single-breakpoint groups stay in the `@bp`
    // section above; everything else is admitted here.
    fn hash_stack_key(g: &ConditionedGroup) -> String {
        g.conditions
            .iter()
            .map(|c| match c {
                crate::theme::Condition::Breakpoint(bp) => format!("bp:{}", bp),
                other => other.prelude().unwrap_or("").to_string(),
            })
            .collect::<Vec<_>>()
            .join("|")
    }
    let mut conditioned: Vec<&ConditionedGroup> = styles
        .conditioned
        .iter()
        .filter(|g| {
            !(g.selector.is_none()
                && matches!(
                    g.conditions.as_slice(),
                    [crate::theme::Condition::Breakpoint(_)]
                ))
        })
        .collect();
    conditioned.sort_by(|a, b| {
        hash_stack_key(a)
            .cmp(&hash_stack_key(b))
            .then_with(|| a.selector.cmp(&b.selector))
    });
    for g in &conditioned {
        // CONSTRAINT: `g.selector` enters the utility-class hash VERBATIM in
        // its stored form, so the `","`-vs-`", "` branch join is hash-visible.
        // It is inert today only because the sole PRODUCTION caller
        // (`generate_utility_css_impl`) resolves single system-prop values,
        // which never carry condition groups — no selector can reach here. If
        // a selector-bearing input is ever admitted to utility generation,
        // comma-bearing selectors WILL shift utility class names.
        let sel = g.selector.as_deref().unwrap_or("");
        write!(out, "@cond:{}|{}{{", hash_stack_key(g), sel).unwrap();
        let mut sorted = g.declarations.clone();
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
    let mut sorted_responsive: Vec<(&String, &Vec<CssDeclaration>)> =
        styles.breakpoint_groups().collect();
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

    // Condition blocks — after breakpoints (design D4). Utility usages are
    // single system-prop values today and carry none, but the writer stays
    // uniform for when condition-bearing styles route through here.
    write_condition_blocks(layer_body, &[format!(".{}", class_name)], styles, breakpoints);
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
    let mut seen: FxHashMap<String, (String, ResolvedStyles)> = FxHashMap::default();

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
                if let Some((_, decls)) = s.breakpoint_groups().next() {
                    if let Some(d) = decls.first() {
                        return d.property.clone();
                    }
                }
                String::new()
            };
            // Breakpoint sort order: base/static → 0, per-bp → pixel value.
            let bp_order = |s: &ResolvedStyles| -> u32 {
                if !s.declarations.is_empty() { return 0; }
                if let Some((bp_name, _)) = s.breakpoint_groups().next() {
                    return *breakpoints.breakpoints.get(bp_name.as_str()).unwrap_or(&0);
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
/// Emits rules inside `@layer system { ... }` (or `@layer {prefix}.system { ... }` when prefixed).
pub fn generate_utility_css(
    usages: &[UtilityInput],
    ctx: &ResolveContext,
    breakpoints: &BreakpointMap,
    slot_entries: Option<Vec<(String, ResolvedStyles, String)>>,
    class_prefix: &str,
) -> UtilityOutput {
    let layer_name = layer_name("system");
    generate_utility_css_impl(usages, ctx, breakpoints, &layer_name, slot_entries, class_prefix)
}

/// Generate utility CSS for `.props()` custom props.
/// Emits rules inside `@layer anm-custom { ... }`.
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
        condition_aliases: ctx.condition_aliases,
        transform_evaluator: ctx.transform_evaluator,
    };
    let layer_name = layer_name("custom");
    generate_utility_css_impl(usages, &custom_ctx, breakpoints, &layer_name, slot_entries, class_prefix)
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

use crate::dynamic_meta::DynamicPropMeta;

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

    for meta in dynamic_props.values() {
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
            conditioned: vec![],
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
                conditioned: vec![ConditionedGroup::breakpoint(bp_name.to_string(), bp_decls)],
            };

            entries.push((bp_class, bp_styles, css_property.clone()));
        }
    }

    entries
}

#[cfg(test)]
mod tests {
    use rustc_hash::FxHashSet;

    use super::*;
    use crate::theme::{
        Condition, ConditionAliasesMap, ConditionEmitOrder, ConditionedGroup, ContextualVarsMap,
        SelectorAliasesMap, VariableMap,
    };

    fn empty_vars() -> VariableMap {
        FxHashMap::default()
    }

    fn test_breakpoints() -> BreakpointMap {
        let mut bp = FxHashMap::default();
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
        bp_keys: FxHashSet<String>,
        aliases: SelectorAliasesMap,
        conditions: ConditionAliasesMap,
    }

    impl TestUtilCtx {
        fn new(config: PropConfigMap, theme: FlatTheme, bp: &BreakpointMap) -> Self {
            Self {
                config,
                theme,
                vars: empty_vars(),
                ctx_vars: ContextualVarsMap::default(),
                bp_keys: bp.breakpoints.keys().cloned().collect(),
                aliases: SelectorAliasesMap::default(),
                conditions: ConditionAliasesMap::default(),
            }
        }

        fn ctx(&self) -> ResolveContext<'_> {
            ResolveContext {
                config: &self.config,
                theme: &self.theme,
                variable_map: &self.vars,
                contextual_vars: &self.ctx_vars,
                breakpoint_keys: &self.bp_keys,
                selector_aliases: &self.aliases,
                condition_aliases: &self.conditions,
                transform_evaluator: None,
            }
        }
    }

    // ------------------------------------------------------------------
    // Class-hash admission + condition emission (inc 03 — D4)
    // ------------------------------------------------------------------

    fn container_group(prelude: &str, prop: &str, value: &str) -> ConditionedGroup {
        ConditionedGroup::single(
            Condition::Container(prelude.to_string()),
            vec![CssDeclaration { property: prop.to_string(), value: value.to_string() }],
            ConditionEmitOrder::Raw(0),
        )
    }

    #[test]
    fn condition_block_admitted_into_class_hash() {
        // MANDATORY: two usages differing ONLY by a condition block must hash
        // to distinct canonical strings (else they collide into one class).
        let base = ResolvedStyles {
            declarations: vec![CssDeclaration { property: "display".into(), value: "grid".into() }],
            ..Default::default()
        };
        let with_condition = ResolvedStyles {
            declarations: vec![CssDeclaration { property: "display".into(), value: "grid".into() }],
            conditioned: vec![container_group("@container (min-width: 400px)", "padding", "1rem")],
            ..Default::default()
        };
        let h_base = canonical_css_for_hash(&base);
        let h_cond = canonical_css_for_hash(&with_condition);
        assert_ne!(h_base, h_cond, "condition block must change the canonical hash input");
        assert_ne!(content_hash(&h_base), content_hash(&h_cond));
    }

    #[test]
    fn different_condition_preludes_hash_differently() {
        let a = ResolvedStyles {
            conditioned: vec![container_group("@container (min-width: 400px)", "padding", "1rem")],
            ..Default::default()
        };
        let b = ResolvedStyles {
            conditioned: vec![container_group("@container (min-width: 800px)", "padding", "1rem")],
            ..Default::default()
        };
        assert_ne!(canonical_css_for_hash(&a), canonical_css_for_hash(&b));
    }

    #[test]
    fn write_rule_block_nests_condition_inside_layer_order() {
        // Emission proof: declarations → pseudo → breakpoint MQ → condition,
        // condition wrapping the class selector.
        let styles = ResolvedStyles {
            declarations: vec![CssDeclaration { property: "display".into(), value: "flex".into() }],
            pseudo_selectors: vec![(
                ":hover".into(),
                vec![CssDeclaration { property: "color".into(), value: "red".into() }],
            )],
            conditioned: vec![
                ConditionedGroup::breakpoint(
                    "sm",
                    vec![CssDeclaration { property: "gap".into(), value: "1rem".into() }],
                ),
                container_group("@container (min-width: 400px)", "font-size", "18px"),
            ],
        };
        let mut out = String::new();
        write_rule_block(&mut out, "animus-Box-abcd", &styles, &test_breakpoints());

        let p_decl = out.find("display: flex").unwrap();
        let p_hover = out.find(":hover").unwrap();
        let p_mq = out.find("@media (min-width: 768px)").unwrap();
        let p_cont = out.find("@container (min-width: 400px)").unwrap();
        assert!(p_decl < p_hover, "declarations before pseudos");
        assert!(p_hover < p_mq, "pseudos before breakpoint MQ");
        assert!(p_mq < p_cont, "breakpoint MQ before condition");
        // Condition wraps the class selector.
        assert!(out.contains("@container (min-width: 400px) {\n    .animus-Box-abcd {\n      font-size: 18px;"));
    }

    #[test]
    fn emission_ordering_proof_declarations_pseudo_breakpoint_aliased_raw() {
        // FULL D4 total order in one rule (RETURN item #5): unconditioned
        // declarations → pseudo → breakpoint MQ (px asc) → aliased condition
        // (registry order) → raw condition (source order). `conditioned` is
        // deliberately given out of emission order to prove the sort.
        let styles = ResolvedStyles {
            declarations: vec![CssDeclaration { property: "display".into(), value: "flex".into() }],
            pseudo_selectors: vec![(
                ":hover".into(),
                vec![CssDeclaration { property: "color".into(), value: "red".into() }],
            )],
            conditioned: vec![
                // raw (source idx 0) — must emit LAST despite being first here
                ConditionedGroup::single(
                    Condition::Supports("@supports (display: grid)".into()),
                    vec![CssDeclaration { property: "display".into(), value: "grid".into() }],
                    ConditionEmitOrder::Raw(0),
                ),
                // aliased (order 500) — must emit before the raw one
                ConditionedGroup::single(
                    Condition::Media("@media (prefers-reduced-motion: reduce)".into()),
                    vec![CssDeclaration { property: "transition".into(), value: "none".into() }],
                    ConditionEmitOrder::Aliased(500),
                ),
                // breakpoint — must emit before both condition groups
                ConditionedGroup::breakpoint(
                    "sm",
                    vec![CssDeclaration { property: "gap".into(), value: "1rem".into() }],
                ),
            ],
        };
        let mut out = String::new();
        write_rule_block(&mut out, "animus-Box-abcd", &styles, &test_breakpoints());

        let ordered_markers = [
            "display: flex",                              // 1. declarations
            ":hover",                                     // 2. pseudo
            "@media (min-width: 768px)",                  // 3. breakpoint MQ
            "@media (prefers-reduced-motion: reduce)",    // 4. aliased condition
            "@supports (display: grid)",                  // 5. raw condition
        ];
        let mut last = 0usize;
        for marker in ordered_markers {
            let pos = out.find(marker).unwrap_or_else(|| panic!("missing marker {marker} in:\n{out}"));
            assert!(pos >= last, "marker {marker} out of order in:\n{out}");
            last = pos;
        }
        // Snapshot the exact emitted rule for the report excerpt.
        assert_eq!(
            out,
            "  .animus-Box-abcd {\n    display: flex;\n  }\n\
             \x20 .animus-Box-abcd:hover {\n    color: red;\n  }\n\
             \x20 @media (min-width: 768px) {\n    .animus-Box-abcd {\n      gap: 1rem;\n    }\n  }\n\
             \x20 @media (prefers-reduced-motion: reduce) {\n    .animus-Box-abcd {\n      transition: none;\n    }\n  }\n\
             \x20 @supports (display: grid) {\n    .animus-Box-abcd {\n      display: grid;\n    }\n  }\n"
        );
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
                conditioned: vec![],
            }),
            variants: vec![],
            compounds: vec![],
            states: vec![],
        }];

        let css = generate_css(&components, &test_breakpoints());
        assert!(css.contains("@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;"));
        assert!(css.contains("@layer anm-base {"));
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
                default_option: None,
                options: vec![
                    (
                        "fill".to_string(),
                        ResolvedStyles {
                            declarations: vec![CssDeclaration {
                                property: "color".to_string(),
                                value: "var(--colors-background)".to_string(),
                            }],
                            pseudo_selectors: vec![],
                            conditioned: vec![],
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
                            conditioned: vec![],
                        },
                    ),
                ],
            }],
            compounds: vec![],
            states: vec![],
        }];

        let css = generate_css(&components, &test_breakpoints());
        assert!(css.contains("@layer anm-variants {"));
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
                    conditioned: vec![],
                },
            )],
        }];

        let css = generate_css(&components, &test_breakpoints());
        assert!(css.contains("@layer anm-states {"));
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
                conditioned: vec![],
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
                conditioned: vec![ConditionedGroup::breakpoint(
                    "sm",
                    vec![CssDeclaration {
                        property: "font-size".to_string(),
                        value: "1.125rem".to_string(),
                    }],
                )],
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
        assert!(css.starts_with("@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;"));
    }

    // -----------------------------------------------------------------------
    // Utility CSS generation tests
    // -----------------------------------------------------------------------

    use crate::theme::{FlatTheme, PropConfig, PropConfigMap};
    use serde_json::json;

    fn utility_config() -> PropConfigMap {
        let mut config = FxHashMap::default();
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
        let mut theme = FxHashMap::default();
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
        assert!(out.css.contains("@layer anm-system {"));
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
        assert!(out.css.contains("@layer anm-custom {"));
        assert!(!out.css.contains("@layer anm-system {"));
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
                scale_values: std::collections::BTreeMap::new(),
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
        assert!(entries[0].1.breakpoint_groups().next().is_none());
        // Per-breakpoint slot classes are separate entries
        // 5 breakpoints → 5 additional entries (total 6 including base)
        assert_eq!(entries.len(), 6);
        // xs entry: own class, wrapped in @media
        assert_eq!(entries[1].0, "animus-dyn-p-xs");
        assert!(entries[1].1.declarations.is_empty()); // no base decls
        let bps1: Vec<_> = entries[1].1.breakpoint_groups().collect();
        assert_eq!(bps1.len(), 1);
        assert_eq!(bps1[0].0, "xs");
        assert_eq!(bps1[0].1[0].value, "var(--animus-p-xs)");
        // sm entry
        assert_eq!(entries[2].0, "animus-dyn-p-sm");
        assert_eq!(entries[2].1.breakpoint_groups().next().unwrap().1[0].value, "var(--animus-p-sm)");
        // xl entry (last)
        assert_eq!(entries[5].0, "animus-dyn-p-xl");
        assert_eq!(entries[5].1.breakpoint_groups().next().unwrap().1[0].value, "var(--animus-p-xl)");
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
                scale_values: std::collections::BTreeMap::new(),
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
        let bps1: Vec<_> = entries[1].1.breakpoint_groups().collect();
        assert_eq!(bps1[0].1.len(), 2);
        assert_eq!(bps1[0].1[0].value, "var(--animus-px-xs)");
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
                scale_values: std::collections::BTreeMap::new(),
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
        assert_eq!(out.css.matches("@layer anm-system {").count(), 1);
    }

    #[test]
    fn variable_slot_camel_to_kebab() {
        
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
                default_option: None,
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

        // Rule 1 (inheritance): .Root--size-sm .Child — (0,2,0)
        assert!(css.contains(".animus-Root-abc--size-sm .animus-Child-def"));
        // Rule 2 (override): .Root .Child.Child--size-sm — (0,3,0)
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

        // Specificity tiers:
        // Rule 1 (inheritance): .Root--size-sm .Child → 2 classes (0,2,0)
        // Rule 2 (override): .Root .Child.Child--size-sm → 3 classes (0,3,0)
        let inheritance_sel = ".animus-Root-abc--size-sm .animus-Child-def";
        let override_sel = ".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm";
        assert!(css.contains(inheritance_sel), "Missing inheritance selector");
        assert!(css.contains(override_sel), "Missing override selector");
        assert_eq!(inheritance_sel.matches('.').count(), 2, "Inheritance should be (0,2,0)");
        assert_eq!(override_sel.matches('.').count(), 3, "Override should be (0,3,0)");
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
        let inheritance_pos = css.find(".animus-Root-abc--size-sm .animus-Child-def").unwrap();
        let override_pos = css.find(".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm").unwrap();
        assert!(inheritance_pos < override_pos, "Inheritance rule must come before override rule");
    }

    #[test]
    fn composed_root_default_option_propagates_to_child_slots() {
        // ANI-005: an omitted shared prop makes the runtime write
        // `{root}--{prop}-default`, so the root's defaultVariant must reach the
        // slots. Exactly ONE extra rule — inheritance only.
        let mut root = make_component_css("animus-Root-abc", "size", &[
            ("sm", "font-size", "0.875rem"),
            ("lg", "font-size", "1.25rem"),
        ]);
        root.variants[0].default_option = Some("sm".to_string());
        let child = make_component_css("animus-Child-def", "size", &[
            ("sm", "padding", "4px"),
            ("lg", "padding", "8px"),
        ]);
        let components = vec![root, child];

        let shared = vec![String::from("size")];
        let families = vec![ComposeFamilyRef {
            root_class: "animus-Root-abc",
            child_slots: vec![("Child", "animus-Child-def")],
            shared_keys: &shared,
        }];

        let bp = test_breakpoints();
        let css = generate_composed_variant_css(&families, &components, &bp);

        // The default arm inherits the CHILD's styles for the root's default option.
        assert!(
            css.contains(".animus-Root-abc--size-default .animus-Child-def {\n    padding: 4px;"),
            "missing default inheritance rule:\n{css}"
        );
        // Child suppression survives: no `-default`-keyed override on the child side.
        assert!(
            !css.contains("animus-Child-def--size-default"),
            "default must not emit a child-side override:\n{css}"
        );
        assert_eq!(
            css.matches("--size-default").count(),
            1,
            "exactly one default-keyed rule expected:\n{css}"
        );
    }

    #[test]
    fn composed_root_default_absent_from_child_options_emits_nothing() {
        // Guard shape mirrors the shared-key miss: a root default the child
        // does not define is skipped, not synthesized.
        let mut root = make_component_css("animus-Root-abc", "size", &[
            ("sm", "font-size", "0.875rem"),
            ("xl", "font-size", "2rem"),
        ]);
        root.variants[0].default_option = Some("xl".to_string());
        let child = make_component_css("animus-Child-def", "size", &[
            ("sm", "padding", "4px"),
        ]);
        let components = vec![root, child];

        let shared = vec![String::from("size")];
        let families = vec![ComposeFamilyRef {
            root_class: "animus-Root-abc",
            child_slots: vec![("Child", "animus-Child-def")],
            shared_keys: &shared,
        }];

        let bp = test_breakpoints();
        let css = generate_composed_variant_css(&families, &components, &bp);
        assert!(!css.contains("--size-default"), "{css}");
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
            default_option: None,
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

        // Control gets both size and tone composed rules (inheritance at 0,2,0)
        assert!(css.contains(".animus-Root-abc--size-sm .animus-Control-def"));
        assert!(css.contains(".animus-Root-abc--tone-muted .animus-Control-def"));
        // Label gets size composed rules (no tone variant on Label → no tone rules)
        assert!(css.contains(".animus-Root-abc--size-sm .animus-Label-ghi"));
        assert!(!css.contains("--tone-muted .animus-Label-ghi"));
    }

    #[test]
    fn composed_includes_pseudo_selectors() {
        let child = ComponentCss {
            class_name: "animus-Child-def".to_string(),
            base: None,
            variants: vec![VariantCss {
                prop: "size".to_string(),
                default_option: None,
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

        // Inheritance pseudo: .Root--size-sm .Child:hover — (0,2,0) + pseudo
        assert!(css.contains(".animus-Root-abc--size-sm .animus-Child-def:hover"));
        // Override pseudo: .Root .Child.Child--size-sm:hover — (0,3,0) + pseudo
        assert!(css.contains(".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm:hover"));
        // Pseudo declarations present
        assert!(css.contains("background-color: blue"));
    }

    #[test]
    fn composed_emits_selector_breakpoint_and_conditioned_groups() {
        // inc-05 review F6: two `ResolvedStyles` shapes went live for composed
        // slots but had no composed-level test —
        //   (1) a SELECTOR-BEARING breakpoint group, which resolves through
        //       `breakpoint_selector_groups()` (the legacy bucket that carried
        //       a "no producer today" note until nested resolution populated
        //       it), and
        //   (2) a non-breakpoint CONDITIONED group, which resolves through
        //       `write_condition_blocks` at the composed level.
        // Each must wrap BOTH composed selectors (inheritance + override), and
        // the breakpoint MQ must emit before the condition (D4 within-rule
        // order).
        let child = ComponentCss {
            class_name: "animus-Child-def".to_string(),
            base: None,
            variants: vec![VariantCss {
                prop: "size".to_string(),
                default_option: None,
                options: vec![(
                    "sm".to_string(),
                    ResolvedStyles {
                        declarations: vec![CssDeclaration {
                            property: "padding".to_string(),
                            value: "4px".to_string(),
                        }],
                        conditioned: vec![
                            // (1) selector-bearing breakpoint group
                            ConditionedGroup {
                                conditions: vec![Condition::Breakpoint("sm".to_string())],
                                selector: Some(":hover".to_string()),
                                declarations: vec![CssDeclaration {
                                    property: "gap".to_string(),
                                    value: "1rem".to_string(),
                                }],
                                emit_order: ConditionEmitOrder::Breakpoint,
                            },
                            // (2) non-breakpoint conditioned group (no selector)
                            container_group(
                                "@container (min-width: 400px)",
                                "font-size",
                                "18px",
                            ),
                        ],
                        ..Default::default()
                    },
                )],
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

        // (1) The selector-bearing breakpoint group nests both composed
        // selectors (with the `:hover` pseudo appended) inside ONE sm media
        // query — `gap: 1rem` emits twice (inheritance + override).
        assert_eq!(
            css.matches("@media (min-width: 768px)").count(),
            1,
            "exactly one sm breakpoint MQ:\n{css}"
        );
        assert!(
            css.contains(".animus-Root-abc--size-sm .animus-Child-def:hover"),
            "inheritance selector + :hover:\n{css}"
        );
        assert!(
            css.contains(".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm:hover"),
            "override selector + :hover:\n{css}"
        );
        assert_eq!(
            css.matches("gap: 1rem").count(),
            2,
            "responsive-selector decl wraps both composed selectors:\n{css}"
        );

        // (2) The conditioned group nests both composed selectors inside the
        // @container block — `font-size: 18px` emits twice.
        assert_eq!(
            css.matches("@container (min-width: 400px)").count(),
            1,
            "exactly one @container block:\n{css}"
        );
        assert_eq!(
            css.matches("font-size: 18px").count(),
            2,
            "conditioned decl wraps both composed selectors:\n{css}"
        );

        // D4 within-rule order: breakpoint MQ before the condition block.
        let mq_pos = css.find("@media (min-width: 768px)").unwrap();
        let cond_pos = css.find("@container (min-width: 400px)").unwrap();
        assert!(mq_pos < cond_pos, "breakpoint MQ before condition (D4):\n{css}");
    }

    // ------------------------------------------------------------------
    // Shared-axis compound expansion
    // ------------------------------------------------------------------

    /// The owned config list, for tests that keep the configs alive beside the
    /// borrowed lookup.
    type CompoundConfigList = Vec<CompoundConfig>;

    /// One compound's conditions as the config layer stores them: axis →
    /// required value, paired with the flat compound class the emitter
    /// enumerates positionally.
    fn compound_config(
        child_class: &str,
        index: usize,
        entries: &[(&str, Value)],
    ) -> CompoundConfig {
        (
            entries
                .iter()
                .map(|(axis, value)| ((*axis).to_string(), value.clone()))
                .collect(),
            format!("{}--compound-{}", child_class, index),
        )
    }

    fn compound_styles(property: &str, value: &str) -> ResolvedStyles {
        ResolvedStyles {
            declarations: vec![CssDeclaration {
                property: property.to_string(),
                value: value.to_string(),
            }],
            ..Default::default()
        }
    }

    fn conditions_map<'a>(
        entries: &'a [(&'a str, CompoundConfigList)],
    ) -> CompoundConditionMap<'a> {
        entries
            .iter()
            .map(|(class, configs)| (*class, configs.as_slice()))
            .collect()
    }

    fn one_child_family<'a>(shared: &'a [String]) -> Vec<ComposeFamilyRef<'a>> {
        vec![ComposeFamilyRef {
            root_class: "animus-Root-abc",
            child_slots: vec![("Child", "animus-Child-def")],
            shared_keys: shared,
        }]
    }

    #[test]
    fn shared_axis_compound_expands_to_an_ancestor_selector() {
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from("sm"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        // One accepted value emits the bare class, never a one-argument
        // `:is()` — the pinned convention for a single alternative.
        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn several_shared_axes_chain_on_the_root_in_conditions_order() {
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        // Authored `{ tone: 'loud', size: 'sm' }`; the stored conditions are
        // sorted by axis name, so the chain is `size` then `tone` either way.
        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("tone", Value::from("loud")), ("size", Value::from("sm"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size"), String::from("tone")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm.animus-Root-abc--tone-loud .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn child_only_axes_stay_on_the_child_beside_the_shared_ancestor() {
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from("sm")), ("weight", Value::from("bold"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        // `weight` is the child's own prop — the child's runtime writes its
        // class, so it chains on the child half of the selector.
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def.animus-Child-def--weight-bold {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn an_accepted_value_list_groups_the_axis_into_one_is_selector() {
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from(vec!["sm", "lg"]))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        assert_eq!(
            css,
            "  :is(.animus-Root-abc--size-sm,.animus-Root-abc--size-lg) .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn value_lists_group_each_axis_on_its_own_side() {
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[
                    ("size", Value::from(vec!["sm", "lg"])),
                    ("weight", Value::from(vec!["bold", "black"])),
                ],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        // One group per axis, in conditions order — no combination product.
        assert_eq!(
            css,
            "  :is(.animus-Root-abc--size-sm,.animus-Root-abc--size-lg) \
             .animus-Child-def:is(.animus-Child-def--weight-bold,.animus-Child-def--weight-black) \
             {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn a_root_default_keeps_the_compound_alive_when_the_prop_is_omitted() {
        // An omitted Root prop makes the Root's runtime write
        // `--{prop}-default` instead of the option class, so the conditions'
        // required value needs the default-keyed alternative as well.
        let mut root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        root.variants[0].default_option = Some("sm".to_string());
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from("sm"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        assert_eq!(
            css,
            "  :is(.animus-Root-abc--size-sm,.animus-Root-abc--size-default) .animus-Child-def \
             {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn a_root_default_the_conditions_do_not_require_adds_no_alternative() {
        let mut root = make_component_css(
            "animus-Root-abc",
            "size",
            &[("sm", "padding", "4px"), ("lg", "padding", "8px")],
        );
        root.variants[0].default_option = Some("lg".to_string());
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from("sm"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        // The Root defaults to `lg`, which the conditions do not accept — the
        // axis keeps its single alternative and stays a bare class.
        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    /// A child slot carrying its own defaulted variant beside the shared axis.
    fn child_with_defaulted_own_variant(default_option: &str) -> ComponentCss {
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.variants.push(VariantCss {
            prop: "weight".to_string(),
            default_option: Some(default_option.to_string()),
            options: vec![
                (
                    "bold".to_string(),
                    ResolvedStyles {
                        declarations: vec![CssDeclaration {
                            property: "font-weight".to_string(),
                            value: "700".to_string(),
                        }],
                        ..Default::default()
                    },
                ),
                (
                    "light".to_string(),
                    ResolvedStyles {
                        declarations: vec![CssDeclaration {
                            property: "font-weight".to_string(),
                            value: "300".to_string(),
                        }],
                        ..Default::default()
                    },
                ),
            ],
        });
        child.compounds = vec![compound_styles("display", "flex")];
        child
    }

    #[test]
    fn a_child_default_keeps_the_mixed_form_alive_when_the_child_prop_is_omitted() {
        // The child's own runtime writes `--weight-default` for an omitted
        // prop exactly as the Root does, so the child half of the selector
        // needs the same default-keyed alternative.
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let components = vec![root, child_with_defaulted_own_variant("bold")];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from("sm")), ("weight", Value::from("bold"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm \
             .animus-Child-def:is(.animus-Child-def--weight-bold,.animus-Child-def--weight-default) \
             {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn a_child_default_the_conditions_do_not_require_adds_no_alternative() {
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let components = vec![root, child_with_defaulted_own_variant("light")];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from("sm")), ("weight", Value::from("bold"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        // The slot defaults `weight` to `light`, which the conditions do not
        // accept — the child side keeps its single bare class.
        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def.animus-Child-def--weight-bold \
             {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn a_compound_on_child_only_axes_stays_flat() {
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("weight", Value::from("bold"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        // The child's own prop already activates the flat rule — nothing to
        // lift onto the Root.
        assert_eq!(css, "", "{css}");
    }

    #[test]
    fn an_expanded_compound_carries_its_pseudo_rules() {
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css("animus-Child-def", "size", &[("sm", "padding", "4px")]);
        child.compounds = vec![ResolvedStyles {
            declarations: vec![CssDeclaration {
                property: "display".to_string(),
                value: "flex".to_string(),
            }],
            pseudo_selectors: vec![(
                ":hover".to_string(),
                vec![CssDeclaration {
                    property: "background-color".to_string(),
                    value: "blue".to_string(),
                }],
            )],
            ..Default::default()
        }];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from(vec!["sm", "lg"]))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        assert!(
            css.contains(
                "  :is(.animus-Root-abc--size-sm,.animus-Root-abc--size-lg) \
                 .animus-Child-def:hover {\n"
            ),
            "the pseudo must land on the whole expanded selector:\n{css}"
        );
    }

    #[test]
    fn an_explicit_slot_option_on_a_shared_axis_suppresses_the_ancestor_form() {
        // The slot declares its own `size`, so a callsite may set it directly.
        // When it does, the slot's own flat compound governs — the ancestor
        // form excludes every option the conditions do not accept. Agreement
        // (`--size-sm`) matches none of the exclusions, so it still applies.
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css(
            "animus-Child-def",
            "size",
            &[("sm", "padding", "4px"), ("lg", "padding", "8px")],
        );
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from("sm"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def:not(.animus-Child-def--size-lg) \
             {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn an_accepted_value_list_excludes_only_the_options_it_leaves_out() {
        // The slot declares a superset of what the conditions accept: the
        // accepted values group on the Root, the leftover option is the only
        // exclusion.
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css(
            "animus-Child-def",
            "size",
            &[
                ("sm", "padding", "4px"),
                ("md", "padding", "6px"),
                ("lg", "padding", "8px"),
            ],
        );
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from(vec!["sm", "md"]))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        assert_eq!(
            css,
            "  :is(.animus-Root-abc--size-sm,.animus-Root-abc--size-md) \
             .animus-Child-def:not(.animus-Child-def--size-lg) {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn a_defaulted_slot_option_on_a_shared_axis_is_never_excluded() {
        // A slot that only defaults its own copy of the shared axis writes
        // `--size-default`, which must keep losing to Root inheritance — so
        // the exclusions name explicit options only.
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css(
            "animus-Child-def",
            "size",
            &[("sm", "padding", "4px"), ("lg", "padding", "8px")],
        );
        child.variants[0].default_option = Some("lg".to_string());
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from("sm"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def:not(.animus-Child-def--size-lg) \
             {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn a_slot_without_its_own_copy_of_the_shared_axis_takes_the_form_unconditionally() {
        let root = make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")]);
        let mut child = make_component_css(
            "animus-Child-def",
            "weight",
            &[("bold", "font-weight", "700")],
        );
        child.compounds = vec![compound_styles("display", "flex")];
        let components = vec![root, child];

        let configs = vec![(
            "animus-Child-def",
            vec![compound_config(
                "animus-Child-def",
                0,
                &[("size", Value::from("sm"))],
            )],
        )];
        let conditions = conditions_map(&configs);
        let shared = vec![String::from("size")];
        let families = one_child_family(&shared);

        let css = generate_composed_compound_css(
            &families,
            &components,
            &conditions,
            &test_breakpoints(),
        );

        // Nothing to exclude: the slot has no class of its own on that axis.
        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    // ---- inc 05: nested emission (design D5/D4) ----

    fn decls(pairs: &[(&str, &str)]) -> Vec<CssDeclaration> {
        pairs.iter().map(|(p, v)| CssDeclaration { property: p.to_string(), value: v.to_string() }).collect()
    }

    #[test]
    fn emits_stacked_condition_wrappers_outermost_first() {
        let styles = ResolvedStyles {
            declarations: vec![],
            pseudo_selectors: vec![],
            conditioned: vec![ConditionedGroup {
                conditions: vec![
                    Condition::Supports("@supports (display: grid)".into()),
                    Condition::Container("@container (min-width: 400px)".into()),
                ],
                selector: None,
                declarations: decls(&[("display", "grid")]),
                emit_order: ConditionEmitOrder::Raw(0),
            }],
        };
        let mut out = String::new();
        write_rule_block(&mut out, "animus-X-1", &styles, &test_breakpoints());
        let si = out.find("@supports (display: grid) {").expect("outer wrapper");
        let ci = out.find("@container (min-width: 400px) {").expect("inner wrapper");
        assert!(si < ci, "outermost-first:\n{}", out);
        assert!(out.contains(".animus-X-1"));
        assert!(out.contains("display: grid;"));
    }

    #[test]
    fn emits_condition_group_with_nested_selector() {
        let styles = ResolvedStyles {
            declarations: vec![],
            pseudo_selectors: vec![],
            conditioned: vec![ConditionedGroup {
                conditions: vec![Condition::Container("@container (min-width: 400px)".into())],
                selector: Some(":hover".into()),
                declarations: decls(&[("gap", "0.5rem")]),
                emit_order: ConditionEmitOrder::Raw(0),
            }],
        };
        let mut out = String::new();
        write_rule_block(&mut out, "animus-X-2", &styles, &test_breakpoints());
        assert!(out.contains("@container (min-width: 400px) {"));
        assert!(out.contains(".animus-X-2:hover"), "selector composes inside at-rule:\n{}", out);
    }

    #[test]
    fn emits_breakpoint_member_inside_condition_stack() {
        let styles = ResolvedStyles {
            declarations: vec![],
            pseudo_selectors: vec![],
            conditioned: vec![ConditionedGroup {
                conditions: vec![
                    Condition::Container("@container (min-width: 400px)".into()),
                    Condition::Breakpoint("sm".into()),
                ],
                selector: None,
                declarations: decls(&[("font-size", "16px")]),
                emit_order: ConditionEmitOrder::Raw(0),
            }],
        };
        let mut out = String::new();
        write_rule_block(&mut out, "animus-X-3", &styles, &test_breakpoints());
        let ci = out.find("@container (min-width: 400px) {").expect("container wrapper");
        let mi = out.find("@media (min-width: 768px) {").expect("inner breakpoint wrapper");
        assert!(ci < mi, "breakpoint nests INSIDE the container block:\n{}", out);
    }

    #[test]
    fn rule_block_emits_responsive_selector_groups() {
        let styles = ResolvedStyles {
            declarations: decls(&[("display", "flex")]),
            pseudo_selectors: vec![(":hover".to_string(), decls(&[("padding", "0.5rem")]))],
            conditioned: vec![ConditionedGroup {
                conditions: vec![Condition::Breakpoint("sm".into())],
                selector: Some(":hover".into()),
                declarations: decls(&[("padding", "1rem")]),
                emit_order: ConditionEmitOrder::Breakpoint,
            }],
        };
        let mut out = String::new();
        write_rule_block(&mut out, "animus-X-4", &styles, &test_breakpoints());
        let mq = out.find("@media (min-width: 768px) {").expect("mq wrapper");
        let sel = out.find(".animus-X-4:hover {").expect("plain pseudo rule");
        let cond_sel = out[mq..].find(".animus-X-4:hover").expect("selector inside mq");
        assert!(sel < mq, "plain pseudo before responsive-selector group:\n{}", out);
        let _ = cond_sel;
        assert!(out.contains("padding: 1rem;"));
    }

    #[test]
    fn hash_distinguishes_stack_members_and_selector() {
        let base = ResolvedStyles {
            declarations: decls(&[("display", "grid")]),
            pseudo_selectors: vec![],
            conditioned: vec![ConditionedGroup {
                conditions: vec![Condition::Supports("@supports (display: grid)".into())],
                selector: None,
                declarations: decls(&[("gap", "1rem")]),
                emit_order: ConditionEmitOrder::Raw(0),
            }],
        };
        let mut stacked = base.clone();
        stacked.conditioned[0].conditions.push(Condition::Container("@container (min-width: 400px)".into()));
        let mut with_selector = base.clone();
        with_selector.conditioned[0].selector = Some(":hover".into());
        let mut with_bp_selector = base.clone();
        with_bp_selector.conditioned[0].conditions = vec![Condition::Breakpoint("sm".into())];
        with_bp_selector.conditioned[0].selector = Some(":hover".into());
        with_bp_selector.conditioned[0].emit_order = ConditionEmitOrder::Breakpoint;

        let h0 = canonical_css_for_hash(&base);
        let h1 = canonical_css_for_hash(&stacked);
        let h2 = canonical_css_for_hash(&with_selector);
        let h3 = canonical_css_for_hash(&with_bp_selector);
        assert_ne!(h0, h1, "inner stack member must change the hash");
        assert_ne!(h0, h2, "nested selector must change the hash");
        assert_ne!(h0, h3, "selector-bearing breakpoint group must be admitted");
        // And the selector-bearing breakpoint group is NOT invisible:
        assert!(h3.contains("@cond:bp:sm|:hover{"), "hash admits bp+selector: {}", h3);
    }

    #[test]
    fn composed_selectors_emit_in_outer_cascade_order() {
        // F4 (inc-05 review): authored ACTIVE-first, but hover (cascade 30)
        // must emit before active (cascade 70) — non-vacuous: insertion and
        // cascade predictions diverge.
        let styles = ResolvedStyles {
            declarations: vec![],
            pseudo_selectors: vec![
                (":active::before".to_string(), decls(&[("opacity", "0.5")])),
                (":hover::before".to_string(), decls(&[("opacity", "1")])),
            ],
            conditioned: vec![],
        };
        let mut out = String::new();
        write_rule_block(&mut out, "animus-X-5", &styles, &test_breakpoints());
        let h = out.find(".animus-X-5:hover::before").expect("hover rule");
        let a = out.find(".animus-X-5:active::before").expect("active rule");
        assert!(h < a, "outer cascade order must beat authoring order:\n{}", out);
    }

    #[test]
    fn condition_base_group_emits_before_breakpoint_child() {
        // F1 (inc-05 review): emission regression — base wrapper precedes the
        // stacked-breakpoint wrapper for the same outer prelude.
        let styles = ResolvedStyles {
            declarations: vec![],
            pseudo_selectors: vec![],
            conditioned: vec![
                ConditionedGroup {
                    conditions: vec![Condition::Container("@container (min-width: 400px)".into())],
                    selector: None,
                    declarations: decls(&[("font-size", "14px")]),
                    emit_order: ConditionEmitOrder::Raw(0),
                },
                ConditionedGroup {
                    conditions: vec![
                        Condition::Container("@container (min-width: 400px)".into()),
                        Condition::Breakpoint("sm".into()),
                    ],
                    selector: None,
                    declarations: decls(&[("font-size", "16px")]),
                    emit_order: ConditionEmitOrder::Raw(0),
                },
            ],
        };
        let mut out = String::new();
        write_rule_block(&mut out, "animus-X-6", &styles, &test_breakpoints());
        let base = out.find("font-size: 14px").expect("base decl");
        let bp = out.find("font-size: 16px").expect("bp override");
        assert!(base < bp, "base before breakpoint override:\n{}", out);
    }

    // ---- comma-list emission (combinators + depth-aware split) ----

    #[test]
    fn format_pseudo_selector_preserves_descendant_branches() {
        // Stored branches join with "," and a leading space IS a combinator.
        assert_eq!(
            format_pseudo_selector("C", " p + ul, ul + p"),
            ".C p + ul, .C ul + p"
        );
        assert_eq!(format_pseudo_selector("C", " strong, b"), ".C strong, .C b");
        assert_eq!(
            format_pseudo_selector("C", " tr > *:last-child, tr > *:has(+ [data-part=\"trailing\"])"),
            ".C tr > *:last-child, .C tr > *:has(+ [data-part=\"trailing\"])"
        );
    }

    #[test]
    fn format_pseudo_selector_ampersand_adjacent_byte_identity() {
        // Byte-identity anchor for every `&`-adjacent comma list.
        assert_eq!(
            format_pseudo_selector("c", ":hover,[data-x]"),
            ".c:hover, .c[data-x]"
        );
        assert_eq!(
            format_pseudo_selector("c", ":disabled,[disabled]"),
            ".c:disabled, .c[disabled]"
        );
        assert_eq!(format_pseudo_selector("c", ":hover"), ".c:hover");
        // The real built-in `_disabled` alias, in stored form.
        assert_eq!(
            format_pseudo_selector("c", ":disabled,[disabled],[aria-disabled=\"true\"],[data-disabled]"),
            ".c:disabled, .c[disabled], .c[aria-disabled=\"true\"], .c[data-disabled]"
        );
    }

    #[test]
    fn format_pseudo_selector_does_not_split_functional_or_quoted_commas() {
        assert_eq!(
            format_pseudo_selector("C", " [data-part=\"add-row\"] :is(:focus-visible, [data-focus-visible])"),
            ".C [data-part=\"add-row\"] :is(:focus-visible, [data-focus-visible])"
        );
        assert_eq!(
            format_pseudo_selector("C", "[data-pinned]:is([data-active=\"true\"], [data-mode=\"edit\"])"),
            ".C[data-pinned]:is([data-active=\"true\"], [data-mode=\"edit\"])"
        );
        assert_eq!(
            format_pseudo_selector("C", "[data-label=\"a,b\"]"),
            ".C[data-label=\"a,b\"]"
        );
    }

    #[test]
    fn format_composed_pseudo_mirrors_combinator_and_functional_handling() {
        assert_eq!(
            format_composed_pseudo(".Root .Child", " p + ul, ul + p"),
            ".Root .Child p + ul, .Root .Child ul + p"
        );
        assert_eq!(
            format_composed_pseudo(".Root", " [data-part=\"add-row\"] :is(:focus-visible, [data-focus-visible])"),
            ".Root [data-part=\"add-row\"] :is(:focus-visible, [data-focus-visible])"
        );
        assert_eq!(
            format_composed_pseudo(".Root", ":hover,[data-x]"),
            ".Root:hover, .Root[data-x]"
        );
    }

    #[test]
    fn resolved_comma_lists_emit_with_combinators_and_intact_functions() {
        // End-to-end: authored selector key → stored form → emitted CSS.
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let styles = resolve_styles(
            &json!({
                "& p + ul, & ul + p": { "display": "flex" },
                "& [data-part=\"add-row\"] :is(:focus-visible, [data-focus-visible])": { "display": "grid" },
                "&:hover, &[data-x]": { "display": "block" },
            }),
            &tc.ctx(),
            true,
        );
        let mut out = String::new();
        write_rule_block(&mut out, "C", &styles, &bp);
        assert!(out.contains(".C p + ul, .C ul + p {"), "{}", out);
        assert!(
            out.contains(".C [data-part=\"add-row\"] :is(:focus-visible, [data-focus-visible]) {"),
            "{}",
            out
        );
        assert!(out.contains(".C:hover, .C[data-x] {"), "{}", out);
    }

    #[test]
    fn composed_comma_selector_inside_condition_emits_every_branch() {
        // The ONE production pairing of `compose_selectors`' "," join with
        // `format_composed_pseudo` is the nested-selector arm of
        // `write_condition_blocks`. Exercise it end-to-end: a comma list
        // carrying BOTH a descendant combinator and a functional argument,
        // composed under an outer selector, inside a condition block.
        let bp = test_breakpoints();
        let mut tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        tc.aliases.insert("_hover".into(), "&:hover".into());
        let styles = resolve_styles(
            &json!({
                "@container (min-width: 400px)": {
                    "_hover": {
                        "& .a:is(x, y), & .b": { "display": "flex" }
                    }
                }
            }),
            &tc.ctx(),
            true,
        );
        // One group, one selector — the functional argument did not split.
        assert_eq!(styles.conditioned.len(), 1, "{:?}", styles.conditioned);
        assert_eq!(
            styles.conditioned[0].selector.as_deref(),
            Some(":hover .a:is(x, y),:hover .b")
        );

        let mut out = String::new();
        write_rule_block(&mut out, "C", &styles, &bp);
        assert!(
            out.contains(".C:hover .a:is(x, y), .C:hover .b {"),
            "{}",
            out
        );
        // Discriminating negatives. Splitting the functional argument would
        // emit `.C:hover .a:is(x, .C:hovery), .C:hover .b` — the orphaned
        // `y)` tail picks up its own anchor, producing a THIRD branch.
        assert!(!out.contains(":hovery)"), "{}", out);
        assert_eq!(out.matches(".C:hover").count(), 2, "{}", out);
    }

    #[test]
    fn pseudo_sort_order_reads_the_whole_first_branch() {
        // A comma inside a functional pseudo must not truncate the branch:
        // the tail carries the token that tiers it. Truncating at the comma
        // loses `[data-disabled` and drops the rule to the unknown bucket.
        assert_eq!(pseudo_sort_order(":is(:hover, [data-disabled])"), 200);
        assert_eq!(pseudo_sort_order(":is(:focus, [aria-selected])"), 150);
        // Unchanged for the ordinary shapes.
        assert_eq!(pseudo_sort_order(":hover"), 30);
        assert_eq!(pseudo_sort_order(":hover,:focus"), 30);
        assert_eq!(pseudo_sort_order(":disabled,[disabled]"), 200);
    }
}
