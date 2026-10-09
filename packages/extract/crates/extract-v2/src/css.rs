//! `@layer`-structured CSS generation with deterministic ordering: sorted
//! component ids, sorted declarations, topological cascade ranks.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt::Write;
use std::sync::Arc;

use rustc_hash::FxHashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::declarations::{breakpoint_of, record_key, DeclarationBinding, DeclarationNames};
use crate::theme::{ConditionedGroup, CssDeclaration, PropConfig, PropConfigMap, ResolveContext, ResolvedStyles, TransformFailure, TransformFailureSink, first_top_level_branch, is_responsive_value, resolve_styles, split_top_level_commas};

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

fn css_property_cascade_key(css_property: &str) -> usize {
    for (i, &shorthand) in SHORTHAND_PROPERTIES.iter().enumerate() {
        if css_property == shorthand {
            return i;
        }
        let kebab = camel_to_kebab(shorthand);
        if css_property == kebab {
            return i;
        }
    }
    SHORTHAND_PROPERTIES.len() + 1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CssSheets {
    pub declaration: String,
    #[serde(default)]
    pub global: String,
    pub base: String,
    pub variants: String,
    pub compounds: String,
    pub states: String,
    pub system: String,
    pub custom: String,
}

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

    pub fn concat_base(&self) -> String {
        let mut out = String::with_capacity(self.total_base_bytes);
        for (_, css) in &self.base {
            out.push_str(css);
        }
        out
    }

    pub fn concat_variants(&self) -> String {
        let mut out = String::with_capacity(self.total_variants_bytes);
        for (_, css) in &self.variants {
            out.push_str(css);
        }
        out
    }

    pub fn concat_compounds(&self) -> String {
        let mut out = String::with_capacity(self.total_compounds_bytes);
        for (_, css) in &self.compounds {
            out.push_str(css);
        }
        out
    }

    pub fn concat_states(&self) -> String {
        let mut out = String::with_capacity(self.total_states_bytes);
        for (_, css) in &self.states {
            out.push_str(css);
        }
        out
    }
}

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

#[derive(Debug, Clone, PartialEq)]
pub struct ComponentCss {
    pub class_name: String,
    pub base: Option<ResolvedStyles>,
    pub variants: Vec<VariantCss>,
    pub compounds: Vec<ResolvedStyles>,
    pub states: Vec<(String, ResolvedStyles)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VariantCss {
    pub prop: String,
    pub options: Vec<(String, ResolvedStyles)>,
    pub default_option: Option<String>,
}

/// Layers are namespaced under `anm-` so they cannot collide with another
/// framework's layer names; a dash (not a dot) keeps the layers flat.
const LAYER_PREFIX: &str = "anm";

pub fn layer_name(name: &str) -> String {
    format!("{}-{}", LAYER_PREFIX, name)
}

pub fn wrap_layer(name: &str, content: &str) -> String {
    format!("@layer {} {{\n{}}}\n", layer_name(name), content)
}

pub fn generate_css(
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
) -> String {
    let mut output = String::new();

    let layer_names: Vec<String> = ["global", "base", "variants", "compounds", "states", "system", "custom"]
        .iter()
        .map(|n| layer_name(n))
        .collect();
    writeln!(output, "@layer {};", layer_names.join(", ")).unwrap();
    writeln!(output).unwrap();

    let base_css = generate_layer_content(components, breakpoints, LayerKind::Base);
    if !base_css.is_empty() {
        writeln!(output, "@layer {} {{", layer_name("base")).unwrap();
        output.push_str(&base_css);
        writeln!(output, "}}").unwrap();
        writeln!(output).unwrap();
    }

    let variants_css = generate_layer_content(components, breakpoints, LayerKind::Variants);
    if !variants_css.is_empty() {
        writeln!(output, "@layer {} {{", layer_name("variants")).unwrap();
        output.push_str(&variants_css);
        writeln!(output, "}}").unwrap();
        writeln!(output).unwrap();
    }

    let compounds_css = generate_layer_content(components, breakpoints, LayerKind::Compounds);
    if !compounds_css.is_empty() {
        writeln!(output, "@layer {} {{", layer_name("compounds")).unwrap();
        output.push_str(&compounds_css);
        writeln!(output, "}}").unwrap();
        writeln!(output).unwrap();
    }

    let states_css = generate_layer_content(components, breakpoints, LayerKind::States);
    if !states_css.is_empty() {
        writeln!(output, "@layer {} {{", layer_name("states")).unwrap();
        output.push_str(&states_css);
        writeln!(output, "}}").unwrap();
    }

    output
}

pub fn generate_css_sheets_ordered(
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
    order: &[String],
    class_prefix: &str,
) -> (CssSheets, CssFragmentStore) {
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

    let mut fragments = CssFragmentStore::new();

    for (_, component_id, component) in &indexed {
        let id = component_id.clone();

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

    let layer_names: Vec<String> = ["global", "base", "variants", "compounds", "states", "system", "custom"]
        .iter()
        .map(|n| layer_name(n))
        .collect();
    let declaration = format!("@layer {};\n", layer_names.join(", "));

    let base_content = fragments.concat_base();
    let base = if !base_content.is_empty() {
        wrap_layer("base", &base_content)
    } else {
        String::new()
    };

    let variants_content = fragments.concat_variants();
    let variants = if !variants_content.is_empty() {
        wrap_layer("variants", &variants_content)
    } else {
        String::new()
    };

    let compounds_content = fragments.concat_compounds();
    let compounds = if !compounds_content.is_empty() {
        wrap_layer("compounds", &compounds_content)
    } else {
        String::new()
    };

    let states_content = fragments.concat_states();
    let states = if !states_content.is_empty() {
        wrap_layer("states", &states_content)
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

fn write_rule_block(
    output: &mut String,
    selector: &str,
    styles: &ResolvedStyles,
    breakpoints: &BreakpointMap,
) {
    if !styles.declarations.is_empty() {
        write_declarations(output, &format!(".{}", selector), &styles.declarations);
    }

    let mut sorted_pseudos: Vec<&(String, Vec<CssDeclaration>)> = styles.pseudo_selectors.iter().collect();
    sorted_pseudos.sort_by_key(|(sel, _)| pseudo_sort_order(sel));
    for (pseudo, declarations) in sorted_pseudos {
        if !declarations.is_empty() {
            write_declarations(output, &format_pseudo_selector(selector, pseudo), declarations);
        }
    }

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

    write_condition_blocks(output, &[format!(".{}", selector)], styles, breakpoints);
}

fn pseudo_sort_order(selector: &str) -> u32 {
    let first = crate::selector_subject::subject_suffix(
        first_top_level_branch(selector),
    )
    .trim();
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
        _ => 900,
    };
    if exact != 900 {
        return exact;
    }
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

pub struct ComposeFamilyRef<'a> {
    pub root_class: &'a str,
    pub child_slots: Vec<(&'a str, &'a str)>, // (binding_name, class_name)
    pub shared_keys: &'a [String],
}

pub fn generate_composed_variant_css(
    families: &[ComposeFamilyRef],
    components: &[ComponentCss],
    breakpoints: &BreakpointMap,
) -> String {
    let mut output = String::new();

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

    let inheritance_selector = format!(".{} .{}", variant_class, child_class);
    let override_selector = format!(".{} .{}.{}", root_class, child_class, child_variant_class);

    write_composed_selector_rules(
        output,
        &[inheritance_selector, override_selector],
        styles,
        breakpoints,
    );
}

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

fn write_composed_selector_rules(
    output: &mut String,
    selectors: &[String],
    styles: &ResolvedStyles,
    breakpoints: &BreakpointMap,
) {
    if !styles.declarations.is_empty() {
        for selector in selectors {
            write_declarations(output, selector, &styles.declarations);
        }
    }

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

    write_condition_blocks(output, selectors, styles, breakpoints);
}

pub type CompoundConditions = BTreeMap<String, Value>;

pub type CompoundConfig = (CompoundConditions, String);

pub type CompoundConditionMap<'a> = FxHashMap<&'a str, &'a [CompoundConfig]>;

/// `compound_conditions` aligns positionally with `ComponentCss::compounds`.
/// Returns compounds-layer content with no layer wrapper; flat rules precede.
/// A child's runtime writes classes for its own props only, so the shared half
/// of a compound must chain on the root class or the rule never activates.
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
            return None;
        }
        let owner_default = owner_css
            .and_then(|css| css.variants.iter().find(|variant| variant.prop == *axis))
            .and_then(|variant| variant.default_option.as_deref());
        if owner_default.is_some_and(|option| values.iter().any(|v| v == option)) {
            alternatives.push(format!(".{}--{}-default", owner, axis));
        }

        if shared {
            root_chain.push_str(&compound_axis_group(&alternatives));
            for (option, _) in declared_options(child_css, axis) {
                if !values.iter().any(|v| v == option) {
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

/// Bare class for one value, `:is(…)` for several: `:is()` takes its most
/// specific argument's specificity, so both forms cost one class.
fn compound_axis_group(alternatives: &[String]) -> String {
    match alternatives {
        [only] => only.clone(),
        _ => format!(":is({})", alternatives.join(",")),
    }
}

/// A pruned shared-key option would drop its `:not(…)` and let the ancestor
/// form match a slot it must lose to; the reconciler keeps them all marked.
fn declared_options<'a>(css: &'a ComponentCss, prop: &str) -> &'a [(String, ResolvedStyles)] {
    css.variants
        .iter()
        .find(|variant| variant.prop == prop)
        .map_or(&[][..], |variant| variant.options.as_slice())
}

fn compound_axis_values(value: &Value) -> Vec<String> {
    fn class_fragment(value: &Value) -> Option<String> {
        match value {
            Value::String(option) => Some(option.clone()),
            Value::Number(option) => Some(option.to_string()),
            _ => None,
        }
    }
    match value {
        Value::Array(options) => options.iter().filter_map(class_fragment).collect(),
        single => class_fragment(single).into_iter().collect(),
    }
}

fn format_composed_pseudo(selector: &str, pseudo: &str) -> String {
    let anchor_one = |part: &str| -> String {
        if crate::selector_subject::has_subject(part) {
            crate::selector_subject::substitute_subjects(part, selector)
        } else {
            format!("{}{}", selector, part)
        }
    };
    if first_top_level_branch(pseudo).len() == pseudo.len() {
        return anchor_one(pseudo);
    }
    split_top_level_commas(pseudo)
        .into_iter()
        .map(anchor_one)
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn content_hash(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:08x}", hash as u32)
}

pub fn make_class_name(binding: &str, hash_input: &str, prefix: &str) -> String {
    format!("{}-{}-{}", prefix, binding, content_hash(hash_input))
}

#[derive(Debug, Clone)]
pub struct UtilityInput {
    pub prop_name: String,
    pub value: Value,
}

pub struct UtilityOutput {
    pub css: String,
    pub class_map: HashMap<String, HashMap<String, String>>,
}

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

/// A callback-bound prop's static key, which keeps the authored type: a
/// string is its JSON literal, a number its decimal text, and a responsive
/// value `{…}` holds its `"breakpoint":key` entries in key order, so no two
/// values share a key. Must stay in step with the runtime's `typedValueKey`.
pub fn typed_value_key(value: &Value) -> String {
    let quote = |text: &str| serde_json::to_string(text).unwrap_or_default();
    match value {
        Value::String(text) => quote(text),
        Value::Object(entries) => {
            let mut keys: Vec<&String> = entries.keys().collect();
            keys.sort();
            let pairs: Vec<String> = keys
                .into_iter()
                .map(|key| format!("{}:{}", quote(key), typed_value_key(&entries[key])))
                .collect();
            format!("{{{}}}", pairs.join(","))
        }
        other => serialize_value_key(other),
    }
}

/// Whether the runtime derives the build's lookup key from this literal:
/// a string free of escapes and entities, a boolean, a number both print
/// with the same digits (the build switches to exponents below 1e-5), or a
/// responsive object of those. The untyped key joins `key:value` pairs
/// sorted as text, which orders a key before its extension (`sm2` before
/// `sm`) unlike the runtime's key sort, so it admits no such pair.
fn runtime_derives_key(value: &Value, typed: bool) -> bool {
    let scalar = |value: &Value| match value {
        Value::Bool(_) => true,
        Value::String(text) => !text.contains(['&', '\\']),
        Value::Number(number) => number
            .as_f64()
            .is_some_and(|n| n == 0.0 || (1e-5..9_007_199_254_740_992.0).contains(&n.abs())),
        _ => false,
    };
    match value {
        Value::Object(entries) => {
            let extends = |key: &String| entries.keys().any(|other| other != key && other.starts_with(key.as_str()));
            entries.values().all(scalar) && (typed || !entries.keys().any(extends))
        }
        value => scalar(value),
    }
}

fn canonical_css_for_hash(styles: &ResolvedStyles) -> String {
    let mut out = String::new();

    let mut decls = styles.declarations.clone();
    decls.sort_by(|a, b| a.property.cmp(&b.property));
    for d in &decls {
        write!(out, "{}:{};", d.property, d.value).unwrap();
    }

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

fn write_utility_rule(
    layer_body: &mut String,
    class_name: &str,
    styles: &ResolvedStyles,
    breakpoints: &BreakpointMap,
) {
    if !styles.declarations.is_empty() {
        write_declarations(layer_body, &format!(".{}", class_name), &styles.declarations);
    }

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

    write_condition_blocks(layer_body, &[format!(".{}", class_name)], styles, breakpoints);
}

type UtilityClassMap = HashMap<String, HashMap<String, String>>;

/// Utility class namespaces, one per cascade layer: a class defined in both
/// layers would carry custom-layer precedence onto every system consumer.
/// Both sort after `dcl`/`dyn`, so the layer's name tie-break is unchanged.
const SYSTEM_UTILITY_NAMESPACE: &str = "u";
const CUSTOM_UTILITY_NAMESPACE: &str = "uc";

/// One utility class per distinct canonical CSS within a layer; the class
/// map records which class a `(prop, value)` usage resolved to.
fn add_utility_class(
    usage: &UtilityInput,
    ctx: &ResolveContext,
    seen: &mut FxHashMap<String, (String, ResolvedStyles)>,
    class_map: &mut UtilityClassMap,
    class_prefix: &str,
    namespace: &str,
    value_key: fn(&Value) -> String,
) {
    let style_obj = serde_json::json!({ &usage.prop_name: usage.value.clone() });
    // A usage value is no style block, so it reports no dropped key.
    let usage_ctx = ResolveContext { dropped_keys: None, ..*ctx };
    let resolved = resolve_styles(&style_obj, &usage_ctx, true);

    debug_assert!(
        resolved
            .conditioned
            .iter()
            .all(|group| group.selector.is_none()),
        "utility input for '{}' resolved a selector-bearing conditioned group — \
         utility class hashes would become selector-join-sensitive",
        usage.prop_name
    );

    if let Some(class_name) = intern_utility_class(resolved, seen, class_prefix, namespace) {
        class_map
            .entry(usage.prop_name.clone())
            .or_default()
            .insert(value_key(&usage.value), class_name);
    }
}

/// The layer's class for `resolved`, shared by every usage with the same
/// canonical CSS; `None` when it declares nothing.
fn intern_utility_class(
    resolved: ResolvedStyles,
    seen: &mut FxHashMap<String, (String, ResolvedStyles)>,
    class_prefix: &str,
    namespace: &str,
) -> Option<String> {
    let canonical = canonical_css_for_hash(&resolved);
    if canonical.is_empty() {
        return None;
    }
    let entry = seen.entry(canonical).or_insert_with_key(|canonical| {
        let hash = content_hash(canonical);
        (format!("{class_prefix}-{namespace}-{hash}"), resolved)
    });
    Some(entry.0.clone())
}

/// The CSS-wide keywords a runtime value can carry. Through a dynamic slot a
/// keyword would act on the inline variable, not on the property.
pub const CSS_WIDE_KEYWORDS: [&str; 5] = ["initial", "inherit", "unset", "revert", "revert-layer"];

/// Gives a runtime-delivered prop one class per CSS-wide keyword, at the base
/// and at each breakpoint, holding what a static write of the keyword
/// declares: for a transformed prop, the transform's result. A keyword the
/// static path leaves to the runtime (`admits` says no) gets no class, so
/// the runtime resolves it as it resolves a static write. The keys are the
/// ones a static write takes, and a class a static write already maps is
/// kept, so runtime and static keywords select one class.
#[allow(clippy::too_many_arguments)]
fn add_keyword_classes(
    prop_name: &str,
    scale: &BTreeMap<String, Value>,
    breakpoints: &BreakpointMap,
    ctx: &ResolveContext,
    admits: &mut dyn FnMut(&Value) -> bool,
    seen: &mut FxHashMap<String, (String, ResolvedStyles)>,
    class_map: &mut UtilityClassMap,
    class_prefix: &str,
    namespace: &str,
) {
    let key = value_key(ctx.config.get(prop_name).is_some_and(PropConfig::keys_typed));
    // No usage wrote these keywords, so nothing is reported against one.
    let quiet = ResolveContext { transform_failures: None, token_misses: None, dropped_keys: None, ..*ctx };
    let classes = class_map.entry(prop_name.to_string()).or_default();
    for keyword in CSS_WIDE_KEYWORDS {
        // A scale key spelled like a keyword reaches the slot, which reads the
        // scale, as a static write of it does.
        if scale.contains_key(keyword) {
            continue;
        }
        let at_breakpoints = breakpoints.breakpoints.keys().map(|bp| serde_json::json!({ bp: keyword }));
        for value in std::iter::once(Value::from(keyword)).chain(at_breakpoints) {
            if let std::collections::hash_map::Entry::Vacant(slot) = classes.entry(key(&value)) {
                if !admits(&value) {
                    continue;
                }
                let styles = resolve_styles(&serde_json::json!({ prop_name: value }), &quiet, true);
                if let Some(class_name) = intern_utility_class(styles, seen, class_prefix, namespace) {
                    slot.insert(class_name);
                }
            }
        }
    }
}

/// Rule kinds within one condition of a layer: declaration consuming rules
/// precede atomic rules, so a same-condition atomic outranks a declaration.
const DECLARATION_RULE: u8 = 0;
const ATOMIC_RULE: u8 = 1;

fn render_utility_layer(
    seen: FxHashMap<String, (String, ResolvedStyles)>,
    breakpoints: &BreakpointMap,
    layer_name: &str,
    slot_entries: Option<Vec<(String, ResolvedStyles, String)>>,
    declarations: &DeclarationUsage,
    class_prefix: &str,
) -> String {
    let mut entries: Vec<(u8, String, ResolvedStyles)> =
        seen.into_values().map(|(name, styles)| (ATOMIC_RULE, name, styles)).collect();
    for (slot_class, slot_styles, _slot_css_prop) in slot_entries.into_iter().flatten() {
        entries.push((ATOMIC_RULE, slot_class, slot_styles));
    }
    entries.extend(declaration_consuming_rules(declarations, breakpoints, class_prefix));
    let binding_classes = render_binding_classes(declarations, class_prefix);

    let mut css = String::new();
    if entries.is_empty() && binding_classes.is_empty() {
        return css;
    }
    writeln!(css, "@layer {} {{", layer_name).unwrap();
    // Binding classes declare only variables, so their position is inert.
    css.push_str(&binding_classes);
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
    let bp_order = |s: &ResolvedStyles| -> u32 {
        if !s.declarations.is_empty() { return 0; }
        if let Some((bp_name, _)) = s.breakpoint_groups().next() {
            return *breakpoints.breakpoints.get(bp_name.as_str()).unwrap_or(&0);
        }
        0
    };
    // Existing canonical order, with the rule kind after the condition: a
    // breakpoint declaration still follows a base atomic rule.
    entries.sort_by(|(kind_a, name_a, styles_a), (kind_b, name_b, styles_b)| {
        let css_prop_a = prop_from(styles_a);
        let css_prop_b = prop_from(styles_b);
        css_property_cascade_key(&css_prop_a)
            .cmp(&css_property_cascade_key(&css_prop_b))
            .then_with(|| css_prop_a.cmp(&css_prop_b))
            .then_with(|| bp_order(styles_a).cmp(&bp_order(styles_b)))
            .then_with(|| kind_a.cmp(kind_b))
            .then_with(|| name_a.cmp(name_b))
    });
    for (_, class_name, styles) in &entries {
        write_utility_rule(&mut css, class_name, styles, breakpoints);
    }
    writeln!(css, "}}").unwrap();
    css
}

/// One consuming rule per member and condition: the base rule, and per
/// breakpoint a rule its media query gates. An unset variable reads as
/// `revert-layer`, so a value without a base key adopts an ancestor's shared
/// members or else leaves lower layers in force.
fn declaration_consuming_rules(
    declarations: &DeclarationUsage,
    breakpoints: &BreakpointMap,
    class_prefix: &str,
) -> Vec<(u8, String, ResolvedStyles)> {
    let mut sorted_bps: Vec<(&String, &u32)> = breakpoints.breakpoints.iter().collect();
    sorted_bps.sort_by_key(|(name, px)| (**px, (*name).clone()));
    let mut rules = Vec::new();
    for (consuming, used) in &declarations.props {
        let names = DeclarationNames::of(class_prefix, &used.prop, &used.binding);
        for member in &used.binding.members {
            let read = |suffix: &str| CssDeclaration {
                property: member.css_property.clone(),
                value: format!("var({}{suffix}, revert-layer)", names.member_var(member)),
            };
            rules.push((
                DECLARATION_RULE,
                consuming.clone(),
                ResolvedStyles { declarations: vec![read("")], pseudo_selectors: vec![], conditioned: vec![] },
            ));
            for (bp, _) in &sorted_bps {
                rules.push((
                    DECLARATION_RULE,
                    format!("{consuming}-{bp}"),
                    ResolvedStyles {
                        declarations: vec![],
                        pseudo_selectors: vec![],
                        conditioned: vec![ConditionedGroup::breakpoint(bp.to_string(), vec![read(&format!("-{bp}"))])],
                    },
                ));
            }
        }
    }
    rules
}

/// The classes declaring member variables for the keys literal usages
/// select. A breakpoint's binding class needs no media wrapper: only that
/// breakpoint's consuming rule reads its variables.
fn render_binding_classes(declarations: &DeclarationUsage, class_prefix: &str) -> String {
    let mut css = String::new();
    for used in declarations.props.values() {
        let names = DeclarationNames::of(class_prefix, &used.prop, &used.binding);
        for (key, breakpoint) in &used.keys {
            let suffix = breakpoint.as_deref().map(|bp| format!("-{bp}")).unwrap_or_default();
            let record = &used.binding.records[key];
            let declarations: Vec<CssDeclaration> = used
                .binding
                .members
                .iter()
                .map(|member| CssDeclaration {
                    property: format!("{}{suffix}", names.member_var(member)),
                    value: record[&member.name].clone(),
                })
                .collect();
            write_declarations(&mut css, &format!(".{}", names.binding_class(key, breakpoint.as_deref())), &declarations);
        }
    }
    css
}

/// The resolved system utility classes; their layer renders once the variable
/// slots joining it are decided, which can depend on the class map.
pub struct ResolvedUtilities {
    seen: FxHashMap<String, (String, ResolvedStyles)>,
    class_map: UtilityClassMap,
    typed: BTreeSet<String>,
    declarations: DeclarationUsage,
    class_prefix: String,
}

/// The declaration props a layer renders consuming rules for, keyed by
/// consuming class, which carries the prop and its declaring identity.
#[derive(Default)]
pub struct DeclarationUsage {
    pub props: BTreeMap<String, DeclarationUse>,
}

pub struct DeclarationUse {
    pub prop: String,
    pub binding: Arc<DeclarationBinding>,
    /// The `(key, breakpoint)` binding classes literal usages apply.
    pub keys: BoundKeys,
}

/// `(key, breakpoint)` pairs; `None` is the base.
pub type BoundKeys = BTreeSet<(String, Option<String>)>;

impl DeclarationUsage {
    fn entry(&mut self, class_prefix: &str, prop: &str, binding: &Arc<DeclarationBinding>) -> &mut DeclarationUse {
        let consuming = DeclarationNames::of(class_prefix, prop, binding).consuming_class();
        self.props.entry(consuming).or_insert_with(|| DeclarationUse {
            prop: prop.to_string(),
            binding: Arc::clone(binding),
            keys: BTreeSet::new(),
        })
    }

    /// Adds a runtime slot's consuming rules, which bind no key statically.
    pub fn consume(&mut self, class_prefix: &str, prop: &str, binding: &Arc<DeclarationBinding>) {
        self.entry(class_prefix, prop, binding);
    }
}

/// The value key function for a prop whose keys are typed or not.
fn value_key(typed: bool) -> fn(&Value) -> String {
    if typed { typed_value_key } else { serialize_value_key }
}

impl ResolvedUtilities {
    /// Whether `value` of `prop` has a class the runtime finds under its key.
    pub fn has_class(&self, prop: &str, value: &Value) -> bool {
        let typed = self.typed.contains(prop);
        runtime_derives_key(value, typed)
            && self.class_map.get(prop).is_some_and(|classes| classes.contains_key(&value_key(typed)(value)))
    }

    /// The system props whose keys are typed, which the runtime reads as one
    /// list to key its lookups.
    pub fn typed_props(&self) -> &BTreeSet<String> {
        &self.typed
    }

    pub fn has_declarations(&self) -> bool {
        !self.declarations.props.is_empty()
    }

    /// Keyword classes for the props whose values arrive at runtime, each with
    /// its runtime scale; `admits` is the static path's admission of a value.
    pub fn add_runtime_keyword_classes<'a>(
        &mut self,
        props: impl IntoIterator<Item = (&'a str, &'a BTreeMap<String, Value>)>,
        breakpoints: &BreakpointMap,
        ctx: &ResolveContext,
        mut admits: impl FnMut(&str, &Value) -> bool,
    ) {
        for (prop_name, scale) in props {
            add_keyword_classes(
                prop_name,
                scale,
                breakpoints,
                ctx,
                &mut |value| admits(prop_name, value),
                &mut self.seen,
                &mut self.class_map,
                &self.class_prefix,
                SYSTEM_UTILITY_NAMESPACE,
            );
        }
    }

    /// `runtime_declarations` are the declaration props with a runtime slot,
    /// whose consuming rules render whether or not a literal binds a key.
    pub fn render(
        mut self,
        breakpoints: &BreakpointMap,
        slot_entries: Option<Vec<(String, ResolvedStyles, String)>>,
        runtime_declarations: &[(String, Arc<DeclarationBinding>)],
    ) -> UtilityOutput {
        for (prop, binding) in runtime_declarations {
            self.declarations.consume(&self.class_prefix, prop, binding);
        }
        let css = render_utility_layer(
            self.seen,
            breakpoints,
            &layer_name("system"),
            slot_entries,
            &self.declarations,
            &self.class_prefix,
        );
        UtilityOutput { css, class_map: self.class_map }
    }
}

/// A literal declaration value's classes: the consuming classes it activates
/// and one binding class per entry. A key outside the scale gets no class.
fn add_declaration_class(
    usage: &UtilityInput,
    binding: &Arc<DeclarationBinding>,
    ctx: &ResolveContext,
    class_map: &mut UtilityClassMap,
    usage_record: &mut DeclarationUsage,
    class_prefix: &str,
) {
    let names = DeclarationNames::of(class_prefix, &usage.prop_name, binding);
    let entries: Vec<(Option<&str>, &Value)> = match usage.value.as_object() {
        Some(entries) if is_responsive_value(&usage.value, ctx.breakpoint_keys) => entries
            .iter()
            .filter(|(_, entry)| !entry.is_null())
            .map(|(key, entry)| (breakpoint_of(key), entry))
            .collect(),
        _ => vec![(None, &usage.value)],
    };
    let mut keys = Vec::with_capacity(entries.len());
    for (breakpoint, entry) in entries {
        let Some(key) = record_key(entry).filter(|key| binding.records.contains_key(key)) else {
            return;
        };
        keys.push((key, breakpoint.map(str::to_string)));
    }
    if keys.is_empty() {
        return;
    }
    let consuming = names.consuming_class();
    let mut classes = vec![consuming.clone()];
    for (key, breakpoint) in &keys {
        if let Some(bp) = breakpoint {
            classes.push(format!("{consuming}-{bp}"));
        }
        classes.push(names.binding_class(key, breakpoint.as_deref()));
    }
    class_map
        .entry(usage.prop_name.clone())
        .or_default()
        .insert(serialize_value_key(&usage.value), classes.join(" "));
    usage_record.entry(class_prefix, &usage.prop_name, binding).keys.extend(keys);
}

pub fn resolve_utility_classes(
    usages: &[UtilityInput],
    ctx: &ResolveContext,
    class_prefix: &str,
) -> ResolvedUtilities {
    let mut class_map = UtilityClassMap::new();
    let mut seen = FxHashMap::default();
    let mut declarations = DeclarationUsage::default();
    let typed: BTreeSet<String> =
        ctx.config.iter().filter(|(_, prop)| prop.keys_typed()).map(|(name, _)| name.clone()).collect();
    for usage in usages {
        let binding = ctx.config.get(&usage.prop_name).and_then(|prop| prop.declaration.binding.as_ref());
        if let Some(binding) = binding {
            add_declaration_class(usage, binding, ctx, &mut class_map, &mut declarations, class_prefix);
            continue;
        }
        add_utility_class(
            usage,
            ctx,
            &mut seen,
            &mut class_map,
            class_prefix,
            SYSTEM_UTILITY_NAMESPACE,
            value_key(typed.contains(&usage.prop_name)),
        );
    }
    ResolvedUtilities { seen, class_map, typed, declarations, class_prefix: class_prefix.to_string() }
}

/// Custom utility CSS, each usage resolved through its owning component's own
/// custom configuration; the class maps are keyed by that component.
pub struct CustomUtilityOutput {
    pub css: String,
    pub class_map: HashMap<String, UtilityClassMap>,
    /// Per component, the callback props whose class map keys are typed.
    pub typed: HashMap<String, BTreeSet<String>>,
}

/// The resolved custom utility classes, rendered like `ResolvedUtilities`.
pub struct ResolvedCustomUtilities {
    seen: FxHashMap<String, (String, ResolvedStyles)>,
    class_map: HashMap<String, UtilityClassMap>,
    typed: HashMap<String, BTreeSet<String>>,
    declarations: DeclarationUsage,
    class_prefix: String,
}

impl ResolvedCustomUtilities {
    /// Whether `value` of `owner`'s `prop` has a class the runtime finds under
    /// its key, typed for a callback prop.
    pub fn has_class(&self, owner: &str, prop: &str, value: &Value) -> bool {
        let typed = self.typed.get(owner).is_some_and(|props| props.contains(prop));
        runtime_derives_key(value, typed)
            && self
                .class_map
                .get(owner)
                .and_then(|classes| classes.get(prop))
                .is_some_and(|classes| classes.contains_key(&value_key(typed)(value)))
    }

    pub fn has_declarations(&self) -> bool {
        !self.declarations.props.is_empty()
    }

    /// Keyword classes for `owner`'s props whose values arrive at runtime,
    /// each with its runtime scale, resolved through `config`, the owner's
    /// own; `admits` is the static path's admission of a value.
    #[allow(clippy::too_many_arguments)]
    pub fn add_runtime_keyword_classes<'a>(
        &mut self,
        owner: &str,
        config: &PropConfigMap,
        props: impl IntoIterator<Item = (&'a str, &'a BTreeMap<String, Value>)>,
        breakpoints: &BreakpointMap,
        ctx: &ResolveContext,
        mut admits: impl FnMut(&str, &Value) -> bool,
    ) {
        let owner_ctx = ResolveContext { config, ..*ctx };
        let classes = self.class_map.entry(owner.to_string()).or_default();
        for (prop_name, scale) in props {
            add_keyword_classes(
                prop_name,
                scale,
                breakpoints,
                &owner_ctx,
                &mut |value| admits(prop_name, value),
                &mut self.seen,
                classes,
                &self.class_prefix,
                CUSTOM_UTILITY_NAMESPACE,
            );
            if config.get(prop_name).is_some_and(PropConfig::keys_typed) {
                self.typed.entry(owner.to_string()).or_default().insert(prop_name.to_string());
            }
        }
    }

    pub fn render(
        mut self,
        breakpoints: &BreakpointMap,
        slot_entries: Option<Vec<(String, ResolvedStyles, String)>>,
        runtime_declarations: &[(String, Arc<DeclarationBinding>)],
    ) -> CustomUtilityOutput {
        for (prop, binding) in runtime_declarations {
            self.declarations.consume(&self.class_prefix, prop, binding);
        }
        let css = render_utility_layer(
            self.seen,
            breakpoints,
            &layer_name("custom"),
            slot_entries,
            &self.declarations,
            &self.class_prefix,
        );
        CustomUtilityOutput { css, class_map: self.class_map, typed: self.typed }
    }
}

pub fn resolve_custom_prop_classes(
    usages: &[(String, UtilityInput)],
    configs: &FxHashMap<&str, &PropConfigMap>,
    ctx: &ResolveContext,
    class_prefix: &str,
    mut resolved: impl FnMut(&str, Vec<TransformFailure>),
) -> ResolvedCustomUtilities {
    let mut class_map: HashMap<String, UtilityClassMap> = HashMap::new();
    let mut typed: HashMap<String, BTreeSet<String>> = HashMap::new();
    let mut seen = FxHashMap::default();
    let mut declarations = DeclarationUsage::default();
    for (owner, usage) in usages {
        let Some(config) = configs.get(owner.as_str()) else {
            continue;
        };
        // Each usage's failures reach `resolved` with its owner.
        let failures = TransformFailureSink::default();
        let owner_ctx = ResolveContext {
            config,
            transform_failures: ctx.transform_failures.map(|_| &failures),
            ..*ctx
        };
        let classes = class_map.entry(owner.clone()).or_default();
        let binding = config.get(&usage.prop_name).and_then(|prop| prop.declaration.binding.as_ref());
        if let Some(binding) = binding {
            add_declaration_class(usage, binding, &owner_ctx, classes, &mut declarations, class_prefix);
            resolved(owner, failures.into_inner());
            continue;
        }
        let typed_keys = config.get(&usage.prop_name).is_some_and(|c| c.keys_typed());
        add_utility_class(usage, &owner_ctx, &mut seen, classes, class_prefix, CUSTOM_UTILITY_NAMESPACE, value_key(typed_keys));
        if typed_keys && classes.contains_key(&usage.prop_name) {
            typed.entry(owner.clone()).or_default().insert(usage.prop_name.clone());
        }
        resolved(owner, failures.into_inner());
    }
    ResolvedCustomUtilities { seen, class_map, typed, declarations, class_prefix: class_prefix.to_string() }
}

/// Must stay in step with the runtime's unitless property set.
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

/// The post-processor's whole unitless set: the predicted list plus the
/// properties it leaves unitless for other reasons.
pub(crate) fn is_unitless_css_property(css_property: &str) -> bool {
    UNITLESS_CSS_PROPERTIES.contains(&css_property)
        || matches!(css_property, "animation-name" | "aspect-ratio" | "scale")
}

/// Whether CSS post-processing would append `px` to `value` on
/// `css_property`, as the pipeline's unit fallback does to a bare number
/// outside parentheses. This list is a subset of the post-processor's
/// unitless set, so a miss here only predicts a rewrite that will not happen.
pub(crate) fn unit_fallback_rewrites(value: &str, css_property: &str) -> bool {
    if UNITLESS_CSS_PROPERTIES.contains(&css_property) || css_property.starts_with("--") {
        return false;
    }
    // A digit run after one of these continues a word (`#b1b1b7`, `ss01`,
    // `U+0025`); must match `WORD_CHAR` in `packages/extract/pipeline/unit-fallback.ts`.
    let continues_word =
        |b: u8| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'#' | b'-' | b'+');
    let bytes = value.as_bytes();
    let mut depth = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => depth -= 1,
            _ if depth > 0 => {}
            quote @ (b'"' | b'\'') => {
                i += 1;
                while i < bytes.len() && bytes[i] != quote {
                    i += 1 + usize::from(bytes[i] == b'\\');
                }
            }
            _ if i > 0 && continues_word(bytes[i - 1]) => {}
            _ => {
                // `[+-]?\d+\.?\d*`, kept as authored only before a letter or `%`.
                let sign = usize::from(matches!(bytes[i], b'-' | b'+'));
                let digits = |from: usize| bytes[from..].iter().take_while(|b| b.is_ascii_digit()).count();
                let whole = digits(i + sign);
                if whole > 0 {
                    let mut end = i + sign + whole;
                    if bytes.get(end) == Some(&b'.') {
                        end += 1 + digits(end + 1);
                    }
                    if !bytes.get(end).is_some_and(|b| b.is_ascii_alphabetic() || *b == b'%') {
                        return true;
                    }
                    i = end;
                    continue;
                }
            }
        }
        i += 1;
    }
    false
}

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

use crate::dynamic_meta::DynamicPropMeta;

pub fn build_variable_slot_entries(
    dynamic_props: &HashMap<String, DynamicPropMeta>,
    breakpoints: &BreakpointMap,
) -> Vec<(String, ResolvedStyles, String)> {
    let mut entries = Vec::new();

    let mut sorted_bps: Vec<(&String, &u32)> = breakpoints.breakpoints.iter().collect();
    sorted_bps.sort_by_key(|(_, px)| *px);

    // A declaration prop's consuming rules render in the declaration band.
    for meta in dynamic_props.values().filter_map(DynamicPropMeta::value) {
        let css_property = camel_to_kebab(&meta.property);
        let declarations = |var: &str, write_current_var: bool| {
            let value = format!("var({var})");
            let mut declarations: Vec<CssDeclaration> = if meta.properties.is_empty() {
                vec![CssDeclaration { property: css_property.clone(), value: value.clone() }]
            } else {
                meta.properties
                    .iter()
                    .map(|p| CssDeclaration { property: camel_to_kebab(p), value: value.clone() })
                    .collect()
            };
            if let Some(current_var) = meta.current_var.as_ref().filter(|_| write_current_var) {
                declarations.push(CssDeclaration { property: current_var.clone(), value });
            }
            declarations
        };
        // A prop with `current_var` writes it as its static path does, and a
        // second slot leaves it alone for a value that reads it, which would
        // otherwise make the variable cyclic.
        let slots: &[(String, bool)] = &match meta.current_var {
            Some(_) => vec![(meta.slot_class.clone(), true), (format!("{}--keep", meta.slot_class), false)],
            None => vec![(meta.slot_class.clone(), false)],
        };

        for (slot_class, write_current_var) in slots {
            let styles = ResolvedStyles {
                declarations: declarations(&meta.var_name, *write_current_var),
                pseudo_selectors: vec![],
                conditioned: vec![],
            };
            entries.push((slot_class.clone(), styles, css_property.clone()));

            // One class per breakpoint: the runtime applies only the breakpoints
            // the callsite provides, so unset ones cannot leak into the cascade.
            for (bp_name, _) in &sorted_bps {
                let bp_var = format!("{}-{}", meta.var_name, bp_name);
                let bp_styles = ResolvedStyles {
                    declarations: vec![],
                    pseudo_selectors: vec![],
                    conditioned: vec![ConditionedGroup::breakpoint(
                        bp_name.to_string(),
                        declarations(&bp_var, *write_current_var),
                    )],
                };
                entries.push((format!("{slot_class}-{bp_name}"), bp_styles, css_property.clone()));
            }
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

    #[test]
    fn unit_fallback_predicts_only_bare_numbers() {
        for (value, property) in [
            ("8", "padding"),
            ("8 16", "margin"),
            ("0 -4", "margin"),
            ("+5", "margin"),
            ("2 solid #333", "border"),
        ] {
            assert!(unit_fallback_rewrites(value, property), "{property}: {value}");
        }
        for (value, property) in [
            ("#b1b1b7", "color"),
            ("1px solid #333", "border"),
            ("0px 0px 0px 1px #000", "box-shadow"),
            ("\"ss01\"", "font-feature-settings"),
            ("\"\\\"1\\\"\"", "content"),
            ("U+0025-00FF", "unicode-range"),
            ("'1'", "content"),
            ("Inter4, sans-serif", "font-family"),
            ("calc(100% - 16)", "width"),
            ("8", "--gap"),
            ("1.5", "line-height"),
        ] {
            assert!(!unit_fallback_rewrites(value, property), "{property}: {value}");
        }
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
                transform_failures: None,
                token_misses: None,
                dropped_keys: None,
            }
        }
    }

    fn container_group(prelude: &str, prop: &str, value: &str) -> ConditionedGroup {
        ConditionedGroup::single(
            Condition::Container(prelude.to_string()),
            vec![CssDeclaration { property: prop.to_string(), value: value.to_string() }],
            ConditionEmitOrder::Raw(0),
        )
    }

    #[test]
    fn condition_block_admitted_into_class_hash() {
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
        assert!(out.contains("@container (min-width: 400px) {\n    .animus-Box-abcd {\n      font-size: 18px;"));
    }

    #[test]
    fn emission_ordering_proof_declarations_pseudo_breakpoint_aliased_raw() {
        let styles = ResolvedStyles {
            declarations: vec![CssDeclaration { property: "display".into(), value: "flex".into() }],
            pseudo_selectors: vec![(
                ":hover".into(),
                vec![CssDeclaration { property: "color".into(), value: "red".into() }],
            )],
            conditioned: vec![
                ConditionedGroup::single(
                    Condition::Supports("@supports (display: grid)".into()),
                    vec![CssDeclaration { property: "display".into(), value: "grid".into() }],
                    ConditionEmitOrder::Raw(0),
                ),
                ConditionedGroup::single(
                    Condition::Media("@media (prefers-reduced-motion: reduce)".into()),
                    vec![CssDeclaration { property: "transition".into(), value: "none".into() }],
                    ConditionEmitOrder::Aliased(500),
                ),
                ConditionedGroup::breakpoint(
                    "sm",
                    vec![CssDeclaration { property: "gap".into(), value: "1rem".into() }],
                ),
            ],
        };
        let mut out = String::new();
        write_rule_block(&mut out, "animus-Box-abcd", &styles, &test_breakpoints());

        let ordered_markers = [
            "display: flex",
            ":hover",
            "@media (min-width: 768px)",
            "@media (prefers-reduced-motion: reduce)",
            "@supports (display: grid)",
        ];
        let mut last = 0usize;
        for marker in ordered_markers {
            let pos = out.find(marker).unwrap_or_else(|| panic!("missing marker {marker} in:\n{out}"));
            assert!(pos >= last, "marker {marker} out of order in:\n{out}");
            last = pos;
        }
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

    use crate::theme::{FlatTheme, PropConfig, PropConfigMap};
    use serde_json::json;

    fn utility_config() -> PropConfigMap {
        let mut config = FxHashMap::default();
        config.insert(
            "p".to_string(),
            PropConfig {
                property: "padding".to_string(),
                properties: vec![],
                negative: false,
                scale: Some(serde_json::Value::String("space".to_string())),
                transform: None,
                transform_id: None,
                current_var: None,
                transform_fn_source: None,
                callback: None,
                strict: None,
                declaration: Default::default(),
            },
        );
        config.insert(
            "mt".to_string(),
            PropConfig {
                property: "marginTop".to_string(),
                properties: vec![],
                negative: false,
                scale: Some(serde_json::Value::String("space".to_string())),
                transform: None,
                transform_id: None,
                current_var: None,
                transform_fn_source: None,
                callback: None,
                strict: None,
                declaration: Default::default(),
            },
        );
        config.insert(
            "display".to_string(),
            PropConfig {
                property: "display".to_string(),
                properties: vec![],
                negative: false,
                scale: None,
                transform: None,
                transform_id: None,
                current_var: None,
                transform_fn_source: None,
                callback: None,
                strict: None,
                declaration: Default::default(),
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
        let out = resolve_utility_classes(&usages, &tc.ctx(), "animus").render(&bp, None, &[]);
        assert!(out.css.contains("@layer anm-system {"));
        assert!(out.css.contains("padding: 0.5rem;"));
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
        let out = resolve_utility_classes(&usages, &tc.ctx(), "animus").render(&bp, None, &[]);
        assert!(out.css.contains("margin-top: 0.5rem;"));
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
        let out1 = resolve_utility_classes(&usages, &tc.ctx(), "animus").render(&bp, None, &[]);
        let out2 = resolve_utility_classes(&usages, &tc.ctx(), "animus").render(&bp, None, &[]);
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
        let out = resolve_utility_classes(&usages, &tc.ctx(), "animus").render(&bp, None, &[]);
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
        let key = serialize_value_key(&json!({ "_": 8, "sm": 16 }));
        assert_eq!(key, "_:8|sm:16");
    }

    #[test]
    fn custom_prop_uses_custom_layer() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let usages = vec![(
            "a.tsx::A".to_string(),
            UtilityInput {
                prop_name: "p".to_string(),
                value: json!(8),
            },
        )];
        let configs: FxHashMap<&str, &PropConfigMap> =
            [("a.tsx::A", &tc.config)].into_iter().collect();
        let out = resolve_custom_prop_classes(&usages, &configs, &tc.ctx(), "animus", |_, _| {}).render(&bp, None, &[]);
        assert!(out.class_map["a.tsx::A"]["p"].contains_key("8"));
        assert!(out.css.contains("@layer anm-custom {"));
        assert!(!out.css.contains("@layer anm-system {"));
    }

    fn keyword_config() -> PropConfigMap {
        let mut config = utility_config();
        let mut px = config["p"].clone();
        px.properties = vec!["paddingLeft".to_string(), "paddingRight".to_string()];
        config.insert("px".to_string(), px);
        let mut bg = config["display"].clone();
        bg.property = "backgroundColor".to_string();
        bg.current_var = Some("--current-bg".to_string());
        config.insert("bg".to_string(), bg);
        let mut sized = config["display"].clone();
        sized.property = "width".to_string();
        sized.transform_fn_source = Some("(v) => v * 2".to_string());
        config.insert("sized".to_string(), sized);
        config
    }

    fn rule_of<'a>(css: &'a str, class: &str) -> &'a str {
        let start = css.find(&format!(".{class} {{")).unwrap_or_else(|| panic!("no rule for {class}:\n{css}"));
        let end = css[start..].find('}').unwrap();
        &css[start..start + end]
    }

    #[test]
    fn runtime_keyword_classes_hold_the_direct_declaration() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(keyword_config(), utility_theme(), &bp);
        let mut resolved = resolve_utility_classes(&[], &tc.ctx(), "animus");
        resolved.add_runtime_keyword_classes(["p", "px", "bg", "sized"].map(|p| (p, &NO_SCALE)), &bp, &tc.ctx(), |_, _| true);
        let out = resolved.render(&bp, None, &[]);

        for keyword in CSS_WIDE_KEYWORDS {
            let class = &out.class_map["p"][keyword];
            assert!(class.starts_with("animus-u-"), "{class}");
            assert_eq!(rule_of(&out.css, class).matches(':').count(), 1, "{}", rule_of(&out.css, class));
            assert!(rule_of(&out.css, class).contains(&format!("padding: {keyword};")));
        }
        let px = rule_of(&out.css, &out.class_map["px"]["inherit"]);
        assert!(px.contains("padding-left: inherit;") && px.contains("padding-right: inherit;"), "{px}");
        let bg = rule_of(&out.css, &out.class_map["bg"]["revert-layer"]);
        assert!(bg.contains("background-color: revert-layer;") && bg.contains("--current-bg: revert-layer;"), "{bg}");
        // A bound transform never sees the keyword, and the key is typed.
        let sized = rule_of(&out.css, &out.class_map["sized"]["\"unset\""]);
        assert!(sized.contains("width: unset;"), "{sized}");
        assert!(!out.class_map["sized"].contains_key("unset"));
        assert!(!out.css.contains("-moz-initial"));
    }

    #[test]
    fn runtime_keyword_classes_cover_every_breakpoint() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(keyword_config(), utility_theme(), &bp);
        let mut resolved = resolve_utility_classes(&[], &tc.ctx(), "animus");
        resolved.add_runtime_keyword_classes([("p", &NO_SCALE), ("sized", &NO_SCALE)], &bp, &tc.ctx(), |_, _| true);
        let out = resolved.render(&bp, None, &[]);

        for (breakpoint, px) in [("xs", 480), ("sm", 768), ("md", 1024), ("lg", 1200), ("xl", 1440)] {
            for keyword in CSS_WIDE_KEYWORDS {
                let class = &out.class_map["p"][&format!("{breakpoint}:{keyword}")];
                let media = format!("@media (min-width: {px}px) {{\n    .{class} {{\n      padding: {keyword};");
                assert!(out.css.contains(&media), "{media}\n{}", out.css);
            }
            let typed = format!("{{\"{breakpoint}\":\"inherit\"}}");
            assert!(out.class_map["sized"].contains_key(&typed), "{typed}");
        }
        assert_eq!(out.class_map["p"].len(), CSS_WIDE_KEYWORDS.len() * 6);
    }

    #[test]
    fn runtime_keyword_classes_reuse_and_keep_static_classes() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(keyword_config(), utility_theme(), &bp);
        let usages = vec![
            UtilityInput { prop_name: "p".to_string(), value: json!("inherit") },
            UtilityInput { prop_name: "p".to_string(), value: json!({ "md": "initial" }) },
        ];
        let statics = resolve_utility_classes(&usages, &tc.ctx(), "animus").render(&bp, None, &[]);
        let mut resolved = resolve_utility_classes(&usages, &tc.ctx(), "animus");
        resolved.add_runtime_keyword_classes([("p", &NO_SCALE)], &bp, &tc.ctx(), |_, _| true);
        let out = resolved.render(&bp, None, &[]);

        assert_eq!(out.class_map["p"]["inherit"], statics.class_map["p"]["inherit"]);
        assert_eq!(out.class_map["p"]["md:initial"], statics.class_map["p"]["md:initial"]);
        let class = &out.class_map["p"]["inherit"];
        assert_eq!(out.css.matches(&format!(".{class} {{")).count(), 1);
    }

    static NO_SCALE: std::collections::BTreeMap<String, Value> = std::collections::BTreeMap::new();

    /// A runtime value spelled like a scale key reaches the slot, which reads
    /// the scale, as a static write of it does.
    #[test]
    fn a_scale_key_spelled_like_a_keyword_keeps_its_scale_value() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(keyword_config(), utility_theme(), &bp);
        let scale: std::collections::BTreeMap<String, Value> =
            [("inherit".to_string(), json!("3px")), ("4".to_string(), json!("0.25rem"))].into_iter().collect();
        let mut resolved = resolve_utility_classes(&[], &tc.ctx(), "animus");
        resolved.add_runtime_keyword_classes([("p", &scale)], &bp, &tc.ctx(), |_, _| true);
        let out = resolved.render(&bp, None, &[]);

        let p = &out.class_map["p"];
        assert!(!p.contains_key("inherit") && !p.contains_key("md:inherit"), "{p:?}");
        assert!(p.contains_key("initial") && p.contains_key("md:unset"), "{p:?}");
        assert!(!out.css.contains("padding: inherit"), "{}", out.css);
    }

    #[test]
    fn runtime_keyword_classes_never_replace_a_static_class() {
        let bp = test_breakpoints();
        let mut tc = TestUtilCtx::new(keyword_config(), utility_theme(), &bp);
        tc.theme.insert("space.inherit".to_string(), "3px".to_string());
        let usages = vec![UtilityInput { prop_name: "p".to_string(), value: json!("inherit") }];
        let mut resolved = resolve_utility_classes(&usages, &tc.ctx(), "animus");
        resolved.add_runtime_keyword_classes([("p", &NO_SCALE)], &bp, &tc.ctx(), |_, _| true);
        let out = resolved.render(&bp, None, &[]);

        assert!(rule_of(&out.css, &out.class_map["p"]["inherit"]).contains("padding: 3px;"));
    }

    #[test]
    fn custom_runtime_keyword_classes_live_in_the_custom_layer() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(keyword_config(), utility_theme(), &bp);
        let configs: FxHashMap<&str, &PropConfigMap> = [("a.tsx::A", &tc.config)].into_iter().collect();
        let mut resolved = resolve_custom_prop_classes(&[], &configs, &tc.ctx(), "animus", |_, _| {});
        resolved.add_runtime_keyword_classes(
            "a.tsx::A",
            &tc.config,
            [("p", &NO_SCALE), ("sized", &NO_SCALE)],
            &bp,
            &tc.ctx(),
            |_, _| true,
        );
        let out = resolved.render(&bp, None, &[]);

        let class = &out.class_map["a.tsx::A"]["p"]["inherit"];
        assert!(class.starts_with("animus-uc-"), "{class}");
        assert!(out.css.contains("@layer anm-custom {") && !out.css.contains("@layer anm-system {"));
        assert!(out.class_map["a.tsx::A"]["sized"].contains_key("\"inherit\""));
        assert!(out.typed["a.tsx::A"].contains("sized"));
        assert!(!out.typed["a.tsx::A"].contains("p"));
    }

    #[test]
    fn class_map_structure() {
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let usages = vec![UtilityInput {
            prop_name: "p".to_string(),
            value: json!(8),
        }];
        let out = resolve_utility_classes(&usages, &tc.ctx(), "animus").render(&bp, None, &[]);
        assert!(out.class_map.contains_key("p"));
        let p_map = &out.class_map["p"];
        assert!(p_map.contains_key("8"));
        let class_name = &p_map["8"];
        assert!(class_name.starts_with("animus-u-"));
        assert!(out.css.contains(class_name.as_str()));
    }

    fn slot_meta(current_var: Option<&str>) -> HashMap<String, DynamicPropMeta> {
        let mut dynamic_props = HashMap::new();
        dynamic_props.insert(
            "bg".to_string(),
            DynamicPropMeta::Value(crate::dynamic_meta::ValuePropMeta {
                var_name: "--animus-bg".to_string(),
                slot_class: "animus-dyn-bg".to_string(),
                property: "backgroundColor".to_string(),
                properties: vec![],
                negative: false,
                strict: false,
                keywords: vec![],
                transform_name: None,
                transform_id: None,
                transform_fn_source: None,
                scale_values: std::collections::BTreeMap::new(),
                current_var: current_var.map(str::to_string),
            }),
        );
        dynamic_props
    }

    fn declarations_of(styles: &ResolvedStyles) -> Vec<(String, String)> {
        styles
            .declarations
            .iter()
            .chain(styles.breakpoint_groups().flat_map(|(_, declarations)| declarations))
            .map(|d| (d.property.clone(), d.value.clone()))
            .collect()
    }

    #[test]
    fn a_current_var_slot_writes_it_and_has_a_slot_that_leaves_it_alone() {
        let entries = build_variable_slot_entries(&slot_meta(Some("--current-bg")), &test_breakpoints());
        let by_class: HashMap<&str, Vec<(String, String)>> =
            entries.iter().map(|(class, styles, _)| (class.as_str(), declarations_of(styles))).collect();
        let decl = |p: &str, v: &str| (p.to_string(), v.to_string());

        assert_eq!(
            by_class["animus-dyn-bg"],
            [decl("background-color", "var(--animus-bg)"), decl("--current-bg", "var(--animus-bg)")]
        );
        assert_eq!(by_class["animus-dyn-bg--keep"], [decl("background-color", "var(--animus-bg)")]);
        assert_eq!(
            by_class["animus-dyn-bg-md"],
            [decl("background-color", "var(--animus-bg-md)"), decl("--current-bg", "var(--animus-bg-md)")]
        );
        assert_eq!(by_class["animus-dyn-bg--keep-md"], [decl("background-color", "var(--animus-bg-md)")]);
        assert_eq!(entries.len(), 12);
    }

    #[test]
    fn a_slot_without_current_var_is_unchanged() {
        let entries = build_variable_slot_entries(&slot_meta(None), &test_breakpoints());
        assert_eq!(entries.len(), 6);
        assert!(entries.iter().all(|(class, styles, _)| !class.contains("--keep")
            && declarations_of(styles).iter().all(|(property, _)| property == "background-color")));
    }

    #[test]
    fn variable_slot_single_property() {
        let mut dynamic_props = HashMap::new();
        dynamic_props.insert(
            "p".to_string(),
            DynamicPropMeta::Value(crate::dynamic_meta::ValuePropMeta {
                var_name: "--animus-p".to_string(),
                slot_class: "animus-dyn-p".to_string(),
                property: "padding".to_string(),
                properties: vec![],
                negative: false,
                strict: false,
                keywords: vec![],
                transform_name: None,
                transform_id: None,
                transform_fn_source: None,
                scale_values: std::collections::BTreeMap::new(),
                current_var: None,
            }),
        );
        let bp = test_breakpoints();
        let entries = build_variable_slot_entries(&dynamic_props, &bp);
        assert_eq!(entries.len(), 6);
        assert_eq!(entries[0].0, "animus-dyn-p");
        assert_eq!(entries[0].1.declarations[0].property, "padding");
        assert_eq!(entries[0].1.declarations[0].value, "var(--animus-p)");
        assert!(entries[0].1.breakpoint_groups().next().is_none());
        assert_eq!(entries.len(), 6);
        assert_eq!(entries[1].0, "animus-dyn-p-xs");
        assert!(entries[1].1.declarations.is_empty());
        let bps1: Vec<_> = entries[1].1.breakpoint_groups().collect();
        assert_eq!(bps1.len(), 1);
        assert_eq!(bps1[0].0, "xs");
        assert_eq!(bps1[0].1[0].value, "var(--animus-p-xs)");
        assert_eq!(entries[2].0, "animus-dyn-p-sm");
        assert_eq!(entries[2].1.breakpoint_groups().next().unwrap().1[0].value, "var(--animus-p-sm)");
        assert_eq!(entries[5].0, "animus-dyn-p-xl");
        assert_eq!(entries[5].1.breakpoint_groups().next().unwrap().1[0].value, "var(--animus-p-xl)");
    }

    #[test]
    fn variable_slot_multi_property() {
        let mut dynamic_props = HashMap::new();
        dynamic_props.insert(
            "px".to_string(),
            DynamicPropMeta::Value(crate::dynamic_meta::ValuePropMeta {
                var_name: "--animus-px".to_string(),
                slot_class: "animus-dyn-px".to_string(),
                property: "padding".to_string(),
                properties: vec!["padding-left".to_string(), "padding-right".to_string()],
                negative: false,
                strict: false,
                keywords: vec![],
                transform_name: None,
                transform_id: None,
                transform_fn_source: None,
                scale_values: std::collections::BTreeMap::new(),
                current_var: None,
            }),
        );
        let bp = test_breakpoints();
        let entries = build_variable_slot_entries(&dynamic_props, &bp);
        assert_eq!(entries.len(), 6);
        assert_eq!(entries[0].1.declarations.len(), 2);
        assert_eq!(entries[0].1.declarations[0].property, "padding-left");
        assert_eq!(entries[0].1.declarations[1].property, "padding-right");
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
            DynamicPropMeta::Value(crate::dynamic_meta::ValuePropMeta {
                var_name: "--animus-p".to_string(),
                slot_class: "animus-dyn-p".to_string(),
                property: "padding".to_string(),
                properties: vec![],
                negative: false,
                strict: false,
                keywords: vec![],
                transform_name: None,
                transform_id: None,
                transform_fn_source: None,
                scale_values: std::collections::BTreeMap::new(),
                current_var: None,
            }),
        );
        let bp = test_breakpoints();
        let tc = TestUtilCtx::new(utility_config(), utility_theme(), &bp);
        let slots = build_variable_slot_entries(&dynamic_props, &bp);
        let usages = vec![UtilityInput { prop_name: "p".to_string(), value: json!(8) }];
        let out = resolve_utility_classes(&usages, &tc.ctx(), "animus").render(&bp, Some(slots), &[]);
        assert!(out.css.contains("animus-dyn-p"));
        assert!(out.css.contains("animus-u-"));
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

        assert!(css.contains(".animus-Root-abc--size-sm .animus-Child-def"));
        assert!(css.contains(".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm"));
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

        let inheritance_pos = css.find(".animus-Root-abc--size-sm .animus-Child-def").unwrap();
        let override_pos = css.find(".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm").unwrap();
        assert!(inheritance_pos < override_pos, "Inheritance rule must come before override rule");
    }

    #[test]
    fn composed_root_default_option_propagates_to_child_slots() {
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

        assert!(
            css.contains(".animus-Root-abc--size-default .animus-Child-def {\n    padding: 4px;"),
            "missing default inheritance rule:\n{css}"
        );
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

        assert!(css.contains(".animus-Root-abc--size-sm .animus-Control-def"));
        assert!(css.contains(".animus-Root-abc--tone-muted .animus-Control-def"));
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

        assert!(css.contains(".animus-Root-abc--size-sm .animus-Child-def:hover"));
        assert!(css.contains(".animus-Root-abc .animus-Child-def.animus-Child-def--size-sm:hover"));
        assert!(css.contains("background-color: blue"));
    }

    #[test]
    fn composed_emits_selector_breakpoint_and_conditioned_groups() {
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
                            ConditionedGroup {
                                conditions: vec![Condition::Breakpoint("sm".to_string())],
                                selector: Some(":hover".to_string()),
                                declarations: vec![CssDeclaration {
                                    property: "gap".to_string(),
                                    value: "1rem".to_string(),
                                }],
                                emit_order: ConditionEmitOrder::Breakpoint,
                            },
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

        let mq_pos = css.find("@media (min-width: 768px)").unwrap();
        let cond_pos = css.find("@container (min-width: 400px)").unwrap();
        assert!(mq_pos < cond_pos, "breakpoint MQ before condition (D4):\n{css}");
    }

    type CompoundConfigList = Vec<CompoundConfig>;

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

    fn default_root() -> ComponentCss {
        make_component_css("animus-Root-abc", "size", &[("sm", "padding", "4px")])
    }

    fn child_with_options(prop: &str, options: &[(&str, &str, &str)]) -> ComponentCss {
        let mut child = make_component_css("animus-Child-def", prop, options);
        child.compounds = vec![compound_styles("display", "flex")];
        child
    }

    fn default_child() -> ComponentCss {
        child_with_options("size", &[("sm", "padding", "4px")])
    }

    fn root_and_child() -> Vec<ComponentCss> {
        vec![default_root(), default_child()]
    }

    /// `axes` are the compound's stored conditions, `shared` the Root's axes.
    fn expand(components: &[ComponentCss], axes: &[(&str, Value)], shared: &[&str]) -> String {
        let configs = vec![(
            "animus-Child-def",
            vec![compound_config("animus-Child-def", 0, axes)],
        )];
        let conditions = conditions_map(&configs);
        let shared: Vec<String> = shared.iter().map(|axis| (*axis).to_string()).collect();
        let families = one_child_family(&shared);
        generate_composed_compound_css(&families, components, &conditions, &test_breakpoints())
    }

    #[test]
    fn shared_axis_compound_expands_to_an_ancestor_selector() {
        let css = expand(&root_and_child(), &[("size", Value::from("sm"))], &["size"]);

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn several_shared_axes_chain_on_the_root_in_conditions_order() {
        let css = expand(
            &root_and_child(),
            &[("tone", Value::from("loud")), ("size", Value::from("sm"))],
            &["size", "tone"],
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm.animus-Root-abc--tone-loud .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn child_only_axes_stay_on_the_child_beside_the_shared_ancestor() {
        let css = expand(
            &root_and_child(),
            &[("size", Value::from("sm")), ("weight", Value::from("bold"))],
            &["size"],
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def.animus-Child-def--weight-bold {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn an_accepted_value_list_groups_the_axis_into_one_is_selector() {
        let css = expand(
            &root_and_child(),
            &[("size", Value::from(vec!["sm", "lg"]))],
            &["size"],
        );

        assert_eq!(
            css,
            "  :is(.animus-Root-abc--size-sm,.animus-Root-abc--size-lg) .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn value_lists_group_each_axis_on_its_own_side() {
        let css = expand(
            &root_and_child(),
            &[
                ("size", Value::from(vec!["sm", "lg"])),
                ("weight", Value::from(vec!["bold", "black"])),
            ],
            &["size"],
        );

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
        let mut root = default_root();
        root.variants[0].default_option = Some("sm".to_string());

        let css = expand(
            &[root, default_child()],
            &[("size", Value::from("sm"))],
            &["size"],
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

        let css = expand(
            &[root, default_child()],
            &[("size", Value::from("sm"))],
            &["size"],
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    fn child_with_defaulted_own_variant(default_option: &str) -> ComponentCss {
        let mut child = default_child();
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
        child
    }

    #[test]
    fn a_child_default_keeps_the_mixed_form_alive_when_the_child_prop_is_omitted() {
        let css = expand(
            &[default_root(), child_with_defaulted_own_variant("bold")],
            &[("size", Value::from("sm")), ("weight", Value::from("bold"))],
            &["size"],
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
        let css = expand(
            &[default_root(), child_with_defaulted_own_variant("light")],
            &[("size", Value::from("sm")), ("weight", Value::from("bold"))],
            &["size"],
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def.animus-Child-def--weight-bold \
             {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn a_compound_on_child_only_axes_stays_flat() {
        let css = expand(
            &root_and_child(),
            &[("weight", Value::from("bold"))],
            &["size"],
        );

        assert_eq!(css, "", "{css}");
    }

    #[test]
    fn an_expanded_compound_carries_its_pseudo_rules() {
        let mut child = default_child();
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

        let css = expand(
            &[default_root(), child],
            &[("size", Value::from(vec!["sm", "lg"]))],
            &["size"],
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
        let child = child_with_options("size", &[("sm", "padding", "4px"), ("lg", "padding", "8px")]);

        let css = expand(
            &[default_root(), child],
            &[("size", Value::from("sm"))],
            &["size"],
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
        let child = child_with_options(
            "size",
            &[
                ("sm", "padding", "4px"),
                ("md", "padding", "6px"),
                ("lg", "padding", "8px"),
            ],
        );

        let css = expand(
            &[default_root(), child],
            &[("size", Value::from(vec!["sm", "md"]))],
            &["size"],
        );

        assert_eq!(
            css,
            "  :is(.animus-Root-abc--size-sm,.animus-Root-abc--size-md) \
             .animus-Child-def:not(.animus-Child-def--size-lg) {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn numeric_accepted_values_keep_their_ancestor_branch() {
        let child = child_with_options(
            "size",
            &[("sm", "padding", "4px"), ("2", "padding", "2px")],
        );

        let css = expand(
            &[default_root(), child],
            &[("size", serde_json::json!(["sm", 2]))],
            &["size"],
        );

        assert_eq!(
            css,
            "  :is(.animus-Root-abc--size-sm,.animus-Root-abc--size-2) \
             .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

    #[test]
    fn a_defaulted_slot_option_on_a_shared_axis_is_never_excluded() {
        let mut child =
            child_with_options("size", &[("sm", "padding", "4px"), ("lg", "padding", "8px")]);
        child.variants[0].default_option = Some("lg".to_string());

        let css = expand(
            &[default_root(), child],
            &[("size", Value::from("sm"))],
            &["size"],
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
        let child = child_with_options("weight", &[("bold", "font-weight", "700")]);

        let css = expand(
            &[default_root(), child],
            &[("size", Value::from("sm"))],
            &["size"],
        );

        assert_eq!(
            css,
            "  .animus-Root-abc--size-sm .animus-Child-def {\n    display: flex;\n  }\n",
            "{css}"
        );
    }

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
        assert!(h3.contains("@cond:bp:sm|:hover{"), "hash admits bp+selector: {}", h3);
    }

    #[test]
    fn composed_selectors_emit_in_outer_cascade_order() {
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

    #[test]
    fn format_pseudo_selector_preserves_descendant_branches() {
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
        assert_eq!(
            format_pseudo_selector("c", ":hover,[data-x]"),
            ".c:hover, .c[data-x]"
        );
        assert_eq!(
            format_pseudo_selector("c", ":disabled,[disabled]"),
            ".c:disabled, .c[disabled]"
        );
        assert_eq!(format_pseudo_selector("c", ":hover"), ".c:hover");
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
        assert_eq!(styles.conditioned.len(), 1, "{:?}", styles.conditioned);
        assert_eq!(
            styles.conditioned[0].selector.as_deref(),
            Some("&:hover .a:is(x, y),&:hover .b")
        );

        let mut out = String::new();
        write_rule_block(&mut out, "C", &styles, &bp);
        assert!(
            out.contains(".C:hover .a:is(x, y), .C:hover .b {"),
            "{}",
            out
        );
        assert!(!out.contains(":hovery)"), "{}", out);
        assert_eq!(out.matches(".C:hover").count(), 2, "{}", out);
    }

    #[test]
    fn pseudo_sort_order_reads_the_whole_first_branch() {
        assert_eq!(pseudo_sort_order(":is(:hover, [data-disabled])"), 200);
        assert_eq!(pseudo_sort_order(":is(:focus, [aria-selected])"), 150);
        assert_eq!(pseudo_sort_order(":hover"), 30);
        assert_eq!(pseudo_sort_order(":hover,:focus"), 30);
        assert_eq!(pseudo_sort_order(":disabled,[disabled]"), 200);
    }
}
