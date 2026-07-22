//! Theme/scale resolution — v1 `theme_resolver.rs` ported VERBATIM
//! (row 07 Task 07.4). Consumes evaluated style Values (facts) + the flat
//! theme; produces CssDeclarations. Bug-compat contracts carried whole:
//! shorthand-tier cascade ordering, token-alias resolution ({scale.path}
//! → var()) INCLUDING the unresolvable-alias raw passthrough (register
//! known-quirk; baselined by the seam battery), contextual vars,
//! responsive objects, pseudo/selector merging, and the silent eval-error
//! fallback at the transform seam (baselined: content: \r).
//! v1's test module is carried verbatim below as the executable contract.

use rustc_hash::{FxHashMap, FxHashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::evaluator::TransformEvaluator;

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

// ---------------------------------------------------------------------------
// CSS color-family pass-through properties.
// These properties typecheck via `ThemedCSSProps` in the TS contract (scale
// values autocomplete against `colors`) but are NOT registered in propConfig.
// When used inside nested selector blocks (_aliased or raw &:pseudo), their
// string values SHALL resolve via the `colors` scale so authoring feedback
// matches the TS surface.
// ---------------------------------------------------------------------------
const COLOR_FAMILY_PASS_THROUGH: &[&str] = &[
    "outlineColor",
    "caretColor",
    "accentColor",
    "textDecorationColor",
    "columnRuleColor",
    "borderBlockColor",
    "borderInlineColor",
    "borderBlockStartColor",
    "borderBlockEndColor",
    "borderInlineStartColor",
    "borderInlineEndColor",
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
pub type PropConfigMap = FxHashMap<String, PropConfig>;

/// The flattened theme: "scale.key" → "css_value".
pub type FlatTheme = FxHashMap<String, String>;

/// Map of token paths to CSS variable names: "colors.primary" → "--color-primary".
pub type VariableMap = FxHashMap<String, String>;

/// Contextual vars registry: scale_name → [var_name]. CSS prop derived as --{name}.
pub type ContextualVarsMap = FxHashMap<String, Vec<String>>;

/// Selector alias map: "_hover" → "&:hover", "_disabled" → "&:disabled, &[disabled], ..."
pub type SelectorAliasesMap = FxHashMap<String, String>;

/// One registered condition alias (design D3). Mirror of the TS
/// `ConditionAlias { value, order, kind }` serialized into the manifest
/// `conditionAliases` field. `value` is the full at-rule string, `kind` is
/// `"media" | "container" | "supports"` (inferred TS-side from the prefix),
/// `order` is the registry cascade order.
#[derive(Debug, Clone, Deserialize)]
pub struct ConditionAliasEntry {
    pub value: String,
    pub order: u32,
    pub kind: String,
}

impl ConditionAliasEntry {
    /// Build the axis `Condition` for this alias from its kind + value.
    /// An unrecognized kind falls back to `Media` (kind is TS-inferred and
    /// therefore always one of the three, but the resolver stays total).
    pub fn to_condition(&self) -> Condition {
        match self.kind.as_str() {
            "container" => Condition::Container(self.value.clone()),
            "supports" => Condition::Supports(self.value.clone()),
            _ => Condition::Media(self.value.clone()),
        }
    }
}

/// Condition alias registry: "_motionReduce" → { value, order, kind }.
pub type ConditionAliasesMap = FxHashMap<String, ConditionAliasEntry>;

/// Infer the axis `Condition` from a RAW `@`-prefixed block key (design D2/D3):
/// the at-rule prefix names the kind, and the full key is the verbatim
/// prelude. Returns `None` for unknown prefixes (the type layer rejects them
/// in inc 04; the resolver silently ignores them here).
pub fn condition_from_raw_key(key: &str) -> Option<Condition> {
    if key.starts_with("@media") {
        Some(Condition::Media(key.to_string()))
    } else if key.starts_with("@container") {
        Some(Condition::Container(key.to_string()))
    } else if key.starts_with("@supports") {
        Some(Condition::Supports(key.to_string()))
    } else {
        None
    }
}

/// Shared immutable context for style resolution. Constructed once per extraction run
/// and threaded by reference through every `resolve_styles` call.
pub struct ResolveContext<'a> {
    pub config: &'a PropConfigMap,
    pub theme: &'a FlatTheme,
    pub variable_map: &'a VariableMap,
    pub contextual_vars: &'a ContextualVarsMap,
    pub breakpoint_keys: &'a FxHashSet<String>,
    pub selector_aliases: &'a SelectorAliasesMap,
    /// Registered condition aliases (`_motionReduce` → { value, order, kind }).
    pub condition_aliases: &'a ConditionAliasesMap,
    pub transform_evaluator: Option<&'a crate::evaluator::TransformEvaluator>,
}

/// A resolved CSS property-value pair.
#[derive(Debug, Clone, PartialEq)]
pub struct CssDeclaration {
    pub property: String,
    pub value: String,
}

/// A condition under which a declaration group applies — the single ordered
/// condition axis (design D1). `Breakpoint` resolves through `BreakpointMap`;
/// the `Media`/`Container`/`Supports` kinds each carry the FULL at-rule
/// prelude string (e.g. `@container card (min-width: 400px)`) and are emitted
/// verbatim (design D2/D4, inc 03).
#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    /// Theme-derived breakpoint name (emitted via `BreakpointMap`).
    Breakpoint(String),
    /// Raw or alias-resolved `@media` at-rule prelude (full string).
    Media(String),
    /// Raw or alias-resolved `@container` at-rule prelude (full string).
    Container(String),
    /// Raw or alias-resolved `@supports` at-rule prelude (full string).
    Supports(String),
}

impl Condition {
    /// The verbatim at-rule prelude for a non-breakpoint condition
    /// (`@media …` / `@container …` / `@supports …`). Breakpoints resolve
    /// through `BreakpointMap` and return `None` here.
    pub fn prelude(&self) -> Option<&str> {
        match self {
            Condition::Breakpoint(_) => None,
            Condition::Media(q) | Condition::Container(q) | Condition::Supports(q) => Some(q),
        }
    }
}

/// Emission-ordering discriminator for a conditioned group (design D4).
/// Within a rule, the total order is: declarations → pseudos → breakpoint
/// media queries (px ascending) → aliased conditions (registry `order`) →
/// raw condition keys (source order).
#[derive(Debug, Clone, PartialEq)]
pub enum ConditionEmitOrder {
    /// Breakpoint-kind group — ordered by px ascending via `BreakpointMap`.
    Breakpoint,
    /// Registered condition alias — ordered by its registry `order`.
    Aliased(u32),
    /// Raw at-rule block key — ordered by source appearance index.
    Raw(usize),
}

/// One conditioned declaration group: a condition stack (outermost first),
/// an optional selector inside the conditions, and the declarations.
#[derive(Debug, Clone, PartialEq)]
pub struct ConditionedGroup {
    pub conditions: Vec<Condition>,
    /// Selector within the conditions (`None` = the component's own rule).
    pub selector: Option<String>,
    pub declarations: Vec<CssDeclaration>,
    /// How this group orders against its siblings at emission (design D4).
    pub emit_order: ConditionEmitOrder,
}

impl ConditionedGroup {
    /// Single-breakpoint group with no selector — the shape every legacy
    /// `responsive` entry maps onto.
    pub fn breakpoint(bp: impl Into<String>, declarations: Vec<CssDeclaration>) -> Self {
        Self {
            conditions: vec![Condition::Breakpoint(bp.into())],
            selector: None,
            declarations,
            emit_order: ConditionEmitOrder::Breakpoint,
        }
    }

    /// A single non-breakpoint condition group (aliased or raw), no nested
    /// selector (nesting lands with inc 05).
    pub fn single(condition: Condition, declarations: Vec<CssDeclaration>, emit_order: ConditionEmitOrder) -> Self {
        Self {
            conditions: vec![condition],
            selector: None,
            declarations,
            emit_order,
        }
    }
}

/// Compose a nested selector against an outer composed selector context
/// (inc 05, design D5). Both sides may be comma-separated; composition is
/// the cartesian product of the parts. Inner parts follow the same grammar
/// as top-level selector keys/alias values: `&`-prefixed (the `&` replaced
/// by the outer composition, preserving whatever follows — including a
/// descendant space) or bare `:`/`::` pseudo (appended). The result is in
/// the STORED normalized form (no leading `&`, class anchor added at
/// emission time).
fn compose_selectors(outer: &str, inner_raw: &str) -> String {
    let outer_parts: Vec<&str> = outer.split(", ").collect();
    let mut composed: Vec<String> = Vec::new();
    for inner_part in inner_raw.split(',') {
        let inner_norm = normalize_pseudo_selector(inner_part);
        for outer_part in &outer_parts {
            composed.push(format!("{}{}", outer_part, inner_norm));
        }
    }
    composed.join(", ")
}

/// The resolution frame for nested block descent (inc 05): the composed
/// selector context and condition stack under which declarations sink.
#[derive(Clone, Default)]
struct NestFrame {
    /// Composed selector in stored normalized form (`":hover .icon"`).
    selector: Option<String>,
    /// Condition stack, outermost first.
    conditions: Vec<Condition>,
    /// Emission order of the OUTERMOST non-breakpoint condition — the
    /// whole stack orders by its outermost block (design D4).
    emit_order: Option<ConditionEmitOrder>,
}

impl NestFrame {
    fn with_selector(&self, inner_raw: &str) -> Self {
        let composed = match &self.selector {
            Some(outer) => compose_selectors(outer, inner_raw),
            None => normalize_pseudo_selector(inner_raw),
        };
        Self {
            selector: Some(composed),
            conditions: self.conditions.clone(),
            emit_order: self.emit_order.clone(),
        }
    }

    fn with_condition(&self, condition: Condition, order: ConditionEmitOrder) -> Self {
        let mut conditions = self.conditions.clone();
        conditions.push(condition);
        Self {
            selector: self.selector.clone(),
            conditions,
            emit_order: Some(self.emit_order.clone().unwrap_or(order)),
        }
    }
}

/// Result of resolving a style object.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResolvedStyles {
    /// Regular CSS declarations.
    pub declarations: Vec<CssDeclaration>,
    /// Pseudo-selector groups: selector → declarations.
    ///
    /// SINGLE-HOME RULE (inc 05): UNCONDITIONED selector groups live here
    /// and ONLY here — `ConditionedGroup { conditions: [], selector: Some }`
    /// is a forbidden second representation (unconstructible today: every
    /// group constructor pushes ≥ 1 condition, and condition-free selector
    /// frames sink here). Rehoming would change class-hash coverage
    /// (pseudo content is deliberately unhashed; condition groups are
    /// hashed) and break byte-identity.
    pub pseudo_selectors: Vec<(String, Vec<CssDeclaration>)>,
    /// Conditioned declaration groups, insertion-ordered (design D1).
    pub conditioned: Vec<ConditionedGroup>,
}

impl ResolvedStyles {
    /// Legacy `responsive` view: breakpoint-kind groups with no selector,
    /// in insertion order.
    pub fn breakpoint_groups(&self) -> impl Iterator<Item = (&String, &Vec<CssDeclaration>)> {
        self.conditioned.iter().filter_map(|g| match (g.conditions.as_slice(), &g.selector) {
            ([Condition::Breakpoint(bp)], None) => Some((bp, &g.declarations)),
            _ => None,
        })
    }

    /// Legacy `responsive_pseudos` view: breakpoint-kind groups that carry a
    /// selector, in insertion order.
    ///
    /// No producer today — the legacy bucket was dead-write and nothing
    /// constructs selector-bearing groups yet; the first real producer is
    /// nested resolution (inc 05). Note for that increment: the composed
    /// emitter now wraps per-(breakpoint, selector) triple, not per-bp as
    /// the legacy nested shape grouped — revisit deliberately at
    /// population time.
    pub fn breakpoint_selector_groups(
        &self,
    ) -> impl Iterator<Item = (&String, &String, &Vec<CssDeclaration>)> {
        self.conditioned.iter().filter_map(|g| match (g.conditions.as_slice(), &g.selector) {
            ([Condition::Breakpoint(bp)], Some(sel)) => Some((bp, sel, &g.declarations)),
            _ => None,
        })
    }

    /// Non-breakpoint conditioned groups (Media/Container/Supports) in
    /// deterministic emission order (design D4): aliased conditions first,
    /// sorted by registry `order`, then raw condition keys in source order.
    /// Breakpoint-kind groups are excluded (they emit before these via
    /// `breakpoint_groups`).
    pub fn conditioned_emission_order(&self) -> Vec<&ConditionedGroup> {
        let mut groups: Vec<&ConditionedGroup> = self
            .conditioned
            .iter()
            .filter(|g| !matches!(g.emit_order, ConditionEmitOrder::Breakpoint))
            .collect();
        // Stable sort by (is_raw, key): aliased(order) < raw(source_index).
        groups.sort_by_key(|g| match &g.emit_order {
            ConditionEmitOrder::Aliased(order) => (0usize, *order as usize),
            ConditionEmitOrder::Raw(idx) => (1usize, *idx),
            ConditionEmitOrder::Breakpoint => (2usize, 0usize),
        });
        groups
    }

    /// Find-or-insert the selectorless group for `bp`, returning its
    /// declarations for in-place extension (legacy merge semantics).
    pub fn breakpoint_decls_mut(&mut self, bp: &str) -> &mut Vec<CssDeclaration> {
        let pos = self.conditioned.iter().position(|g| {
            matches!(
                (g.conditions.as_slice(), &g.selector),
                ([Condition::Breakpoint(b)], None) if b == bp
            )
        });
        let idx = match pos {
            Some(i) => i,
            None => {
                self.conditioned.push(ConditionedGroup::breakpoint(bp, vec![]));
                self.conditioned.len() - 1
            }
        };
        &mut self.conditioned[idx].declarations
    }
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

    // Source-order index for RAW `@`-prefixed condition keys (design D4:
    // raw condition keys emit in source order). Incremented as each raw
    // at-rule block key is encountered in cascade-tier-stable iteration
    // order (all `@`/`_` keys share tier 3, so their relative order is
    // source order).
    let mut raw_condition_index = 0usize;

    for (key, value) in entries {
        // Check if this is a selector alias (_hover, _disabled, etc.) or a
        // registered condition alias (_motionReduce, _cardSm, …). Selector
        // aliases take precedence when a name is registered as both.
        if key.starts_with('_') {
            if let Some(alias_selector) = ctx.selector_aliases.get(key) {
                if let Some(nested_obj) = value.as_object() {
                    // Recursive descent (inc 05, D5): the block body may nest
                    // further selectors, conditions, and responsive maps.
                    let frame = NestFrame::default().with_selector(alias_selector);
                    let inject = auto_content && (key == "_before" || key == "_after");
                    resolve_block_entries(
                        nested_obj, ctx, &frame, auto_content, inject, &mut result, &mut raw_condition_index,
                    );
                }
            } else if let Some(cond_alias) = ctx.condition_aliases.get(key) {
                // Registered condition alias → condition axis, ordered by
                // its registry `order` (design D4). Body recurses (D5).
                if let Some(nested_obj) = value.as_object() {
                    let frame = NestFrame::default().with_condition(
                        cond_alias.to_condition(),
                        ConditionEmitOrder::Aliased(cond_alias.order),
                    );
                    resolve_block_entries(
                        nested_obj, ctx, &frame, auto_content, false, &mut result, &mut raw_condition_index,
                    );
                }
            }
            continue;
        }

        // Check if this is a raw pseudo-selector
        if key.starts_with('&') || key.starts_with(':') {
            if let Some(nested_obj) = value.as_object() {
                let frame = NestFrame::default().with_selector(key);
                resolve_block_entries(
                    nested_obj, ctx, &frame, auto_content, false, &mut result, &mut raw_condition_index,
                );
            }
            continue;
        }

        // Check if this is a RAW at-rule condition block key (design D2):
        // `@media …` / `@container …` / `@supports …`. The kind is inferred
        // from the prefix and the full key is the verbatim prelude. Unknown
        // prefixes are ignored here (type layer rejects them — inc 04).
        if key.starts_with('@') {
            if let Some(condition) = condition_from_raw_key(key) {
                let idx = raw_condition_index;
                raw_condition_index += 1;
                if let Some(nested_obj) = value.as_object() {
                    let frame = NestFrame::default()
                        .with_condition(condition, ConditionEmitOrder::Raw(idx));
                    resolve_block_entries(
                        nested_obj, ctx, &frame, auto_content, false, &mut result, &mut raw_condition_index,
                    );
                }
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
                ctx.transform_evaluator,
                &mut result,
            );
            continue;
        }

        // Regular prop resolution
        let declarations =
            resolve_single_prop(key, value, ctx.config, ctx.theme, ctx.variable_map, ctx.contextual_vars, ctx.transform_evaluator);
        result.declarations.extend(declarations);
    }

    result
}

/// Recursive block resolution (inc 05, design D5): resolve one nested block's
/// entries under a `NestFrame`, descending into further selector/condition
/// blocks and sinking this block's own declarations at the end.
///
/// Sink rules (byte-compat with the pre-recursion depth-1 behavior):
/// - frame has NO conditions (pure selector): merge into `pseudo_selectors`,
///   even when empty (legacy merged empty blocks too).
/// - frame has conditions: push one `ConditionedGroup` per block instance,
///   skipping empty declaration sets (legacy skipped empty condition blocks).
/// - nested responsive values: the `_` slot joins this block's declarations;
///   breakpoint slots form `[frame.conditions…, Breakpoint(bp)]` groups under
///   the frame's selector — the at-rule nests INSIDE the outer block
///   (spec: "Responsive value map inside a condition block").
#[allow(clippy::too_many_arguments)]
fn resolve_block_entries(
    obj: &Map<String, Value>,
    ctx: &ResolveContext,
    frame: &NestFrame,
    auto_content: bool,
    inject_content: bool,
    result: &mut ResolvedStyles,
    raw_condition_index: &mut usize,
) {
    // Same cascade-tier ordering as the top level.
    let mut entries: Vec<(&String, &Value)> = obj.iter().collect();
    entries.sort_by(|(a, _), (b, _)| {
        prop_cascade_tier(a, ctx.config).cmp(&prop_cascade_tier(b, ctx.config))
    });

    // F1 (inc-05 review): children push their groups into `result` during
    // iteration, but this block's OWN declaration group must precede them
    // (spec: base declarations "followed by" their breakpoint overrides
    // inside a condition block — otherwise the override is cascade-dead at
    // equal specificity). Remember where this block's children start so the
    // frame's own group can be inserted before them at sink time.
    let child_groups_start = result.conditioned.len();

    let mut plain_decls: Vec<CssDeclaration> = Vec::new();

    for (key, value) in entries {
        if key.starts_with('_') {
            if let Some(alias_selector) = ctx.selector_aliases.get(key) {
                if let Some(nested_obj) = value.as_object() {
                    let child = frame.with_selector(alias_selector);
                    let inject = auto_content && (key == "_before" || key == "_after");
                    resolve_block_entries(
                        nested_obj, ctx, &child, auto_content, inject, result, raw_condition_index,
                    );
                }
            } else if let Some(cond_alias) = ctx.condition_aliases.get(key) {
                if let Some(nested_obj) = value.as_object() {
                    let child = frame.with_condition(
                        cond_alias.to_condition(),
                        ConditionEmitOrder::Aliased(cond_alias.order),
                    );
                    resolve_block_entries(
                        nested_obj, ctx, &child, auto_content, false, result, raw_condition_index,
                    );
                }
            }
            continue;
        }

        if key.starts_with('&') || key.starts_with(':') {
            if let Some(nested_obj) = value.as_object() {
                let child = frame.with_selector(key);
                resolve_block_entries(
                    nested_obj, ctx, &child, auto_content, false, result, raw_condition_index,
                );
            }
            continue;
        }

        if key.starts_with('@') {
            if let Some(condition) = condition_from_raw_key(key) {
                let idx = *raw_condition_index;
                *raw_condition_index += 1;
                if let Some(nested_obj) = value.as_object() {
                    let child = frame.with_condition(condition, ConditionEmitOrder::Raw(idx));
                    resolve_block_entries(
                        nested_obj, ctx, &child, auto_content, false, result, raw_condition_index,
                    );
                }
            }
            continue;
        }

        if is_responsive_value(value, ctx.breakpoint_keys) {
            if let Some(vobj) = value.as_object() {
                for (bp_key, bp_value) in vobj {
                    let declarations = resolve_single_prop(
                        key, bp_value, ctx.config, ctx.theme, ctx.variable_map, ctx.contextual_vars, ctx.transform_evaluator,
                    );
                    if bp_key == "_" {
                        plain_decls.extend(declarations);
                    } else if !declarations.is_empty() {
                        push_nested_breakpoint_group(result, frame, bp_key, declarations);
                    }
                }
            }
            continue;
        }

        // Nested-block pass-through for color-family CSS props (same rule as
        // the legacy flat resolver): not in propConfig but in the color
        // family → resolve via the `colors` scale per the ThemedCSSProps
        // contract; unknown keys fall through to normal pass-through.
        if !ctx.config.contains_key(key.as_str())
            && COLOR_FAMILY_PASS_THROUGH.contains(&key.as_str())
        {
            if let Some(resolved) = resolve_color_family_pass_through(
                value, ctx.theme, ctx.variable_map, ctx.contextual_vars,
            ) {
                plain_decls.push(CssDeclaration {
                    property: camel_to_kebab(key),
                    value: resolved,
                });
                continue;
            }
        }

        let declarations = resolve_single_prop(
            key, value, ctx.config, ctx.theme, ctx.variable_map, ctx.contextual_vars, ctx.transform_evaluator,
        );
        plain_decls.extend(declarations);
    }

    // Auto-default content: "" for _before / _after blocks (any depth, base
    // definitions only — same rule as the legacy depth-1 injection).
    if inject_content && !plain_decls.iter().any(|d| d.property == "content") {
        plain_decls.insert(
            0,
            CssDeclaration {
                property: "content".to_string(),
                value: "\"\"".to_string(),
            },
        );
    }

    if frame.conditions.is_empty() {
        if let Some(sel) = &frame.selector {
            merge_pseudo_selectors(&mut result.pseudo_selectors, sel.clone(), plain_decls);
        }
    } else if !plain_decls.is_empty() {
        result.conditioned.insert(
            child_groups_start,
            ConditionedGroup {
                conditions: frame.conditions.clone(),
                selector: frame.selector.clone(),
                declarations: plain_decls,
                emit_order: frame
                    .emit_order
                    .clone()
                    .unwrap_or(ConditionEmitOrder::Breakpoint),
            },
        );
    }
}

/// Find-or-create the `[frame.conditions…, Breakpoint(bp)]` group under the
/// frame's selector and extend its declarations (one group per composed
/// target, merged across props within the same block).
fn push_nested_breakpoint_group(
    result: &mut ResolvedStyles,
    frame: &NestFrame,
    bp: &str,
    declarations: Vec<CssDeclaration>,
) {
    let mut conditions = frame.conditions.clone();
    conditions.push(Condition::Breakpoint(bp.to_string()));
    let emit_order = frame
        .emit_order
        .clone()
        .unwrap_or(ConditionEmitOrder::Breakpoint);
    let pos = result.conditioned.iter().position(|g| {
        g.conditions == conditions && g.selector == frame.selector && g.emit_order == emit_order
    });
    match pos {
        Some(i) => result.conditioned[i].declarations.extend(declarations),
        None => result.conditioned.push(ConditionedGroup {
            conditions,
            selector: frame.selector.clone(),
            declarations,
            emit_order,
        }),
    }
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
fn is_responsive_value(value: &Value, breakpoint_keys: &FxHashSet<String>) -> bool {
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
// This internal pipeline boundary keeps its explicit dataflow visible.
#[allow(clippy::too_many_arguments)]
fn resolve_responsive_prop(
    prop_name: &str,
    value: &Value,
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
    evaluator: Option<&TransformEvaluator>,
    result: &mut ResolvedStyles,
) {
    let obj = match value.as_object() {
        Some(o) => o,
        None => return,
    };

    for (bp_key, bp_value) in obj {
        let declarations =
            resolve_single_prop(prop_name, bp_value, config, theme, variable_map, contextual_vars, evaluator);
        if bp_key == "_" {
            // Default (no media query)
            result.declarations.extend(declarations);
        } else {
            // Find existing breakpoint group or create new (insertion order kept)
            result.breakpoint_decls_mut(bp_key).extend(declarations);
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
    evaluator: Option<&TransformEvaluator>,
) -> Vec<CssDeclaration> {
    // Sort props by cascade tier (same as resolve_styles).
    let mut entries: Vec<(&String, &Value)> = obj.iter().collect();
    entries.sort_by(|(a, _), (b, _)| {
        prop_cascade_tier(a, config).cmp(&prop_cascade_tier(b, config))
    });

    let mut declarations = Vec::new();
    for (key, value) in entries {
        // Nested-block pass-through for color-family CSS props: when a prop is not
        // in propConfig but IS in the color family, resolve its string value via
        // the `colors` scale to honor the ThemedCSSProps TS contract. Unknown keys
        // fall through to the normal pass-through path below (literal emission).
        if !config.contains_key(key.as_str())
            && COLOR_FAMILY_PASS_THROUGH.contains(&key.as_str())
        {
            if let Some(resolved) = resolve_color_family_pass_through(
                value,
                theme,
                variable_map,
                contextual_vars,
            ) {
                declarations.push(CssDeclaration {
                    property: camel_to_kebab(key),
                    value: resolved,
                });
                continue;
            }
        }

        declarations.extend(resolve_single_prop(
            key,
            value,
            config,
            theme,
            variable_map,
            contextual_vars,
            evaluator,
        ));
    }
    declarations
}

/// Resolve a bare string value against the `colors` scale. Returns `Some(css)`
/// when the value is a recognized scale key (including contextual vars) and
/// `None` otherwise — callers fall through to literal emission.
///
/// Scoped to pass-through CSS props in the color family; see
/// `COLOR_FAMILY_PASS_THROUGH` and `resolve_flat_styles` for the call site.
fn resolve_color_family_pass_through(
    value: &Value,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
) -> Option<String> {
    let Value::String(raw) = value else {
        return None;
    };

    // Theme scale lookup: "primary" → theme.get("colors.primary") → "var(--color-primary)"
    let lookup_key = format!("colors.{}", raw);
    if let Some(theme_value) = theme.get(&lookup_key) {
        return Some(resolve_token_aliases(
            theme_value,
            theme,
            variable_map,
            contextual_vars,
        ));
    }

    // Contextual-var fallback (color-mode-adaptive bindings registered under "colors").
    if let Some(ctx) = resolve_contextual_var("colors", raw, contextual_vars) {
        return Some(ctx);
    }

    None
}

/// Resolve a single prop to one or more CSS declarations.
fn resolve_single_prop(
    prop_name: &str,
    value: &Value,
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
    evaluator: Option<&TransformEvaluator>,
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
        let rv = resolve_value(value, prop_config, theme, evaluator);
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
fn resolve_value(
    value: &Value,
    config: &PropConfig,
    theme: &FlatTheme,
    evaluator: Option<&TransformEvaluator>,
) -> Option<String> {
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
                Value::Array(arr)
                    if !arr.is_empty() => {
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
                _ => {}
            }
        }
    }

    let final_value = resolved.as_ref().unwrap_or(&lookup_value);

    // 2. Evaluate transform if configured (in-process via boa_engine).
    // Apply transform when: scale resolved, no scale configured, or scale is an
    // empty array (createScale phantom — value passes through to transform).
    if let Some(transform_name) = &config.transform {
        let scale_is_empty_array = matches!(&config.scale, Some(Value::Array(a)) if a.is_empty());
        let use_transform = resolved.is_some() || config.scale.is_none() || scale_is_empty_array;
        if use_transform {
            if let Some(eval) = evaluator {
                match eval.evaluate(transform_name, final_value) {
                    Ok(css) => {
                        return Some(if is_negative {
                            negate_css_value(&css)
                        } else {
                            css
                        });
                    }
                    Err(_) => {
                        // Fall through to raw value on eval failure
                    }
                }
            } else if let Some(raw_str) = value_to_css_string(final_value) {
                // No evaluator available — emit placeholder for legacy path
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
    if let Some(stripped) = val.strip_prefix('-') {
        // Already negative (double negation) → strip the minus
        stripped.to_string()
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
    if let Some(rest) = s.strip_prefix("Webkit") {
        return format!("-webkit-{}", camel_to_kebab_inner(rest));
    }
    if let Some(rest) = s.strip_prefix("Moz") {
        return format!("-moz-{}", camel_to_kebab_inner(rest));
    }
    if s.starts_with("ms") && s.chars().nth(2).is_some_and(|c| c.is_uppercase()) {
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
/// transforms, token aliases).
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
                    ctx.transform_evaluator,
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
            ctx.transform_evaluator,
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

/// Resolve a single keyframes block (from the top-level `keyframes()` primitive)
/// into `@keyframes <name> { ... }` CSS. The block shape is `{ name, frames }`
/// where `frames` is `{ "0%" → { prop → value }, ... }`. Each frame's styles
/// resolve through prop config (scale lookups, transforms, token aliases) —
/// identical to the structured `@keyframes` selector form inside
/// `createGlobalStyles`.
pub fn resolve_keyframes_block(block: &Value, ctx: &ResolveContext) -> String {
    let obj = match block.as_object() {
        Some(o) => o,
        None => return String::new(),
    };

    let name = match obj.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return String::new(),
    };

    let frames = match obj.get("frames").and_then(|v| v.as_object()) {
        Some(f) => f,
        None => return String::new(),
    };

    let mut rendered_frames: Vec<String> = Vec::new();
    for (pct, frame_styles) in frames {
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
            ctx.transform_evaluator,
        );
        if !decls.is_empty() {
            let decl_str: String = decls
                .iter()
                .map(|d| format!("    {}: {};", d.property, d.value))
                .collect::<Vec<_>>()
                .join("\n");
            rendered_frames.push(format!("  {} {{\n{}\n  }}", pct, decl_str));
        }
    }

    if rendered_frames.is_empty() {
        return String::new();
    }

    format!("@keyframes {} {{\n{}\n}}", name, rendered_frames.join("\n"))
}

/// Resolve all keyframes collections into a single CSS string.
///
/// Input: `{ exportName → { keyName → { name, frames } } }`. Each exported
/// `keyframes()` collection carries one entry per named keyframe; each named
/// keyframe emits its own `@keyframes <name> { ... }` block. The `name` is the
/// runtime-generated stable hash from the `keyframes()` factory (authored in
/// `packages/system/src/keyframes.ts`) and becomes the `@keyframes <name>`
/// identifier; identical frame bodies across keys dedupe naturally because
/// `name` is derived from the frame body.
pub fn resolve_all_keyframes_blocks(
    blocks: &Value,
    ctx: &ResolveContext,
) -> String {
    let block_map = match blocks.as_object() {
        Some(o) => o,
        None => return String::new(),
    };

    let mut parts: Vec<String> = Vec::new();
    for (_export_name, collection) in block_map {
        let coll_obj = match collection.as_object() {
            Some(o) => o,
            None => continue,
        };
        for (_key_name, block) in coll_obj {
            let css = resolve_keyframes_block(block, ctx);
            if !css.is_empty() {
                parts.push(css);
            }
        }
    }

    parts.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    macro_rules! map {
        ($( $key:expr => $val:expr ),* $(,)?) => {{
            let mut m = FxHashMap::default();
            $( m.insert($key.to_string(), $val); )*
            m
        }};
    }

    macro_rules! set {
        ($( $val:expr ),* $(,)?) => {{
            let mut s = FxHashSet::default();
            $( s.insert($val.to_string()); )*
            s
        }};
    }

    fn test_config() -> PropConfigMap {
        let mut config = FxHashMap::default();
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
        map! {
            "space.0" => "0".to_string(),
            "space.8" => "0.5rem".to_string(),
            "space.16" => "1rem".to_string(),
            "space.24" => "1.5rem".to_string(),
            "space.32" => "2rem".to_string(),
            "colors.background" => "var(--colors-background)".to_string(),
            "colors.primary" => "var(--colors-primary)".to_string(),
            "radii.4" => "4px".to_string(),
        }
    }

    fn empty_variable_map() -> VariableMap {
        FxHashMap::default()
    }

    fn empty_selector_aliases() -> SelectorAliasesMap {
        FxHashMap::default()
    }

    fn test_bp_keys() -> FxHashSet<String> {
        set!["_", "xs", "sm", "md", "lg", "xl"]
    }

    /// Owns all resolution data and provides a `ctx()` method for borrowing.
    struct TestCtxOwner {
        config: PropConfigMap,
        theme: FlatTheme,
        variable_map: VariableMap,
        contextual_vars: ContextualVarsMap,
        breakpoint_keys: FxHashSet<String>,
        selector_aliases: SelectorAliasesMap,
        condition_aliases: ConditionAliasesMap,
    }

    impl TestCtxOwner {
        fn new() -> Self {
            Self {
                config: test_config(),
                theme: test_theme(),
                variable_map: empty_variable_map(),
                contextual_vars: ContextualVarsMap::default(),
                breakpoint_keys: test_bp_keys(),
                selector_aliases: empty_selector_aliases(),
                condition_aliases: ConditionAliasesMap::default(),
            }
        }

        fn with_aliases(mut self) -> Self {
            self.selector_aliases = test_selector_aliases();
            self.breakpoint_keys = FxHashSet::default();
            self
        }

        fn with_conditions(mut self) -> Self {
            self.condition_aliases = test_condition_aliases();
            self.selector_aliases = test_selector_aliases();
            self
        }

        fn ctx(&self) -> ResolveContext<'_> {
            ResolveContext {
                config: &self.config,
                theme: &self.theme,
                variable_map: &self.variable_map,
                contextual_vars: &self.contextual_vars,
                breakpoint_keys: &self.breakpoint_keys,
                selector_aliases: &self.selector_aliases,
                condition_aliases: &self.condition_aliases,
                transform_evaluator: None,
            }
        }
    }

    fn test_condition_aliases() -> ConditionAliasesMap {
        let mut m = ConditionAliasesMap::default();
        m.insert(
            "_motionReduce".to_string(),
            ConditionAliasEntry {
                value: "@media (prefers-reduced-motion: reduce)".to_string(),
                order: 500,
                kind: "media".to_string(),
            },
        );
        m.insert(
            "_cardSm".to_string(),
            ConditionAliasEntry {
                value: "@container card (min-width: 400px)".to_string(),
                order: 510,
                kind: "container".to_string(),
            },
        );
        m.insert(
            "_hasGrid".to_string(),
            ConditionAliasEntry {
                value: "@supports (display: grid)".to_string(),
                order: 520,
                kind: "supports".to_string(),
            },
        );
        m
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
        let bps: Vec<_> = resolved.breakpoint_groups().collect();
        assert_eq!(bps.len(), 1);
        assert_eq!(bps[0].0, "sm");
        assert_eq!(bps[0].1[0].value, "1rem");
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
        map! {
            "colors.primary" => "--color-primary".to_string(),
            "colors.background" => "--color-background".to_string(),
            "colors.pink.600" => "--color-pink-600".to_string(),
        }
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
        let result = resolve_token_aliases("{colors.primary}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "var(--color-primary)");
    }

    #[test]
    fn alias_literal_resolution() {
        let theme = test_theme();
        let vars = empty_variable_map();
        let result = resolve_token_aliases("{space.8}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "0.5rem");
    }

    #[test]
    fn alias_in_compound_value() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("1px solid {colors.primary}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "1px solid var(--color-primary)");
    }

    #[test]
    fn alias_multiple_in_one_value() {
        let theme = test_theme();
        let vars = empty_variable_map();
        let result = resolve_token_aliases("{space.8} {space.16}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "0.5rem 1rem");
    }

    #[test]
    fn alias_alpha_50() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary/50}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "color-mix(in srgb, var(--color-primary) 50%, transparent)");
    }

    #[test]
    fn alias_alpha_100_identity() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary/100}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "var(--color-primary)");
    }

    #[test]
    fn alias_alpha_0_transparent() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.primary/0}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "transparent");
    }

    #[test]
    fn alias_nested_dot_path() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("{colors.pink.600}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "var(--color-pink-600)");
    }

    #[test]
    fn alias_unresolved_passthrough() {
        let theme = test_theme();
        let vars = empty_variable_map();
        let result = resolve_token_aliases("{colors.nonexistent}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "{colors.nonexistent}");
    }

    #[test]
    fn alias_no_braces_passthrough() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("1px solid red", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "1px solid red");
    }

    #[test]
    fn alias_alpha_in_compound() {
        let theme = test_theme();
        let vars = test_variable_map();
        let result = resolve_token_aliases("0 4px 12px {colors.primary/20}", &theme, &vars, &ContextualVarsMap::default());
        assert_eq!(result, "0 4px 12px color-mix(in srgb, var(--color-primary) 20%, transparent)");
    }

    // --- Selector alias tests ---

    fn test_selector_aliases() -> SelectorAliasesMap {
        map! {
            "_hover" => "&:hover".to_string(),
            "_active" => "&:active".to_string(),
            "_disabled" => "&:disabled, &[disabled], &[aria-disabled=\"true\"], &[data-disabled]".to_string(),
            "_before" => "&::before".to_string(),
            "_after" => "&::after".to_string(),
            "_focus" => "&:focus".to_string(),
        }
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

    // --- Color-family pass-through resolution inside nested selector blocks ---

    #[test]
    fn color_family_pass_through_resolves_in_aliased_block() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({
            "_hover": { "outlineColor": "primary" }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        let hover_decls = &resolved.pseudo_selectors[0].1;
        assert_eq!(hover_decls[0].property, "outline-color");
        assert_eq!(hover_decls[0].value, "var(--colors-primary)");
    }

    #[test]
    fn color_family_pass_through_resolves_in_raw_pseudo_block() {
        let owner = TestCtxOwner::new();
        let styles = json!({
            "&:hover": { "outlineColor": "primary" }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        let hover_decls = &resolved.pseudo_selectors[0].1;
        assert_eq!(hover_decls[0].property, "outline-color");
        assert_eq!(hover_decls[0].value, "var(--colors-primary)");
    }

    #[test]
    fn color_family_pass_through_at_top_level_stays_literal() {
        // Per task 3.4 / D2: top-level behavior unchanged — literal emission preserved.
        let owner = TestCtxOwner::new();
        let styles = json!({ "outlineColor": "primary" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "outline-color");
        assert_eq!(resolved.declarations[0].value, "primary");
    }

    #[test]
    fn color_family_unknown_scale_key_falls_through_to_literal() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({
            "_hover": { "outlineColor": "nonexistent" }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        let hover_decls = &resolved.pseudo_selectors[0].1;
        assert_eq!(hover_decls[0].property, "outline-color");
        assert_eq!(hover_decls[0].value, "nonexistent");
    }

    #[test]
    fn non_color_pass_through_in_aliased_stays_literal() {
        // `cursor` is pass-through but not in the color family — must not resolve.
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({
            "_hover": { "cursor": "pointer" }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        let hover_decls = &resolved.pseudo_selectors[0].1;
        assert_eq!(hover_decls[0].property, "cursor");
        assert_eq!(hover_decls[0].value, "pointer");
    }

    #[test]
    fn registered_color_prop_in_aliased_still_resolves() {
        // Regression guard: `color` is propConfig-registered and must continue
        // to resolve via its existing scale-lookup path (not the new bypass).
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({
            "_hover": { "color": "primary" }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        let hover_decls = &resolved.pseudo_selectors[0].1;
        assert_eq!(hover_decls[0].property, "color");
        assert_eq!(hover_decls[0].value, "var(--colors-primary)");
    }

    #[test]
    fn color_family_brace_syntax_still_resolves_in_aliased_block() {
        // Brace-wrapped token refs `{colors.primary}` should continue to resolve
        // via the existing `resolve_token_aliases` path regardless of the new
        // bare-key fallback.
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({
            "_hover": { "outlineColor": "{colors.primary}" }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        let hover_decls = &resolved.pseudo_selectors[0].1;
        assert_eq!(hover_decls[0].property, "outline-color");
        assert_eq!(hover_decls[0].value, "var(--colors-primary)");
    }

    // ------------------------------------------------------------------
    // Condition-block resolution (inc 03 — D2/D3/D4)
    // ------------------------------------------------------------------

    fn only_cond(resolved: &ResolvedStyles) -> &ConditionedGroup {
        assert_eq!(resolved.conditioned.len(), 1, "expected one conditioned group");
        &resolved.conditioned[0]
    }

    #[test]
    fn raw_container_block_resolves_kind_and_prelude() {
        // container-query-support: "Basic container condition".
        let owner = TestCtxOwner::new();
        let styles = json!({ "@container (min-width: 400px)": { "p": 16 } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions, vec![Condition::Container("@container (min-width: 400px)".to_string())]);
        assert!(g.selector.is_none());
        assert_eq!(g.declarations.len(), 1);
        assert_eq!(g.declarations[0].property, "padding");
        assert_eq!(g.declarations[0].value, "1rem");
        assert!(matches!(g.emit_order, ConditionEmitOrder::Raw(0)));
    }

    #[test]
    fn raw_named_container_prelude_preserved_verbatim() {
        // container-query-support: "Named container query".
        let owner = TestCtxOwner::new();
        let styles = json!({ "@container card (min-width: 400px)": { "display": "grid" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions[0].prelude(), Some("@container card (min-width: 400px)"));
        assert_eq!(g.declarations[0].value, "grid");
    }

    #[test]
    fn container_unit_transits_pass_through_verbatim() {
        // inc 01 spike: container-relative units transit unchanged (D11).
        let owner = TestCtxOwner::new();
        let styles = json!({ "@container card (min-width: 400px)": { "width": "50cqw" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        // `width` has a `size` transform (no evaluator in tests → placeholder),
        // proving the cq-unit string enters the transform seam intact.
        let g = only_cond(&resolved);
        assert_eq!(g.declarations[0].property, "width");
        assert_eq!(g.declarations[0].value, "__TRANSFORM__size__50cqw__");
    }

    #[test]
    fn empty_container_block_emits_no_group() {
        // container-query-support: "No rule emitted for empty container block".
        let owner = TestCtxOwner::new();
        let styles = json!({ "@container (min-width: 400px)": {} });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.conditioned.is_empty());
    }

    #[test]
    fn raw_media_feature_block_resolves() {
        // media-condition-aliases: "Reduced motion query".
        let owner = TestCtxOwner::new();
        let styles = json!({ "@media (prefers-reduced-motion: reduce)": { "display": "none" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions, vec![Condition::Media("@media (prefers-reduced-motion: reduce)".to_string())]);
        assert_eq!(g.declarations[0].value, "none");
    }

    #[test]
    fn raw_supports_block_resolves_tokens_and_shorthands() {
        // supports-condition-blocks: "Basic supports condition" (token + shorthand).
        let owner = TestCtxOwner::new();
        let styles = json!({ "@supports (display: grid)": { "color": "primary", "p": 8 } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions, vec![Condition::Supports("@supports (display: grid)".to_string())]);
        // token resolution (color → var) + shorthand (p → padding 0.5rem)
        assert!(g.declarations.iter().any(|d| d.property == "color" && d.value == "var(--colors-primary)"));
        assert!(g.declarations.iter().any(|d| d.property == "padding" && d.value == "0.5rem"));
    }

    #[test]
    fn unknown_at_rule_prefix_ignored() {
        // selector-alias-registry: "Misspelled at-rule prefix" — resolver
        // silently drops it (the type layer errors in inc 04).
        let owner = TestCtxOwner::new();
        let styles = json!({ "@containr card (min-width: 400px)": { "p": 8 }, "p": 4 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.conditioned.is_empty());
        assert_eq!(resolved.declarations.len(), 1); // the valid `p: 4` survives
    }

    #[test]
    fn registered_media_alias_resolves() {
        // media-condition-aliases: "Media alias in a style object" + token body.
        let owner = TestCtxOwner::new().with_conditions();
        let styles = json!({ "_motionReduce": { "color": "primary" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions, vec![Condition::Media("@media (prefers-reduced-motion: reduce)".to_string())]);
        assert_eq!(g.declarations[0].value, "var(--colors-primary)");
        assert!(matches!(g.emit_order, ConditionEmitOrder::Aliased(500)));
    }

    #[test]
    fn registered_container_alias_resolves() {
        // container-query-support: "Container alias in a style object".
        let owner = TestCtxOwner::new().with_conditions();
        let styles = json!({ "_cardSm": { "display": "grid" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions, vec![Condition::Container("@container card (min-width: 400px)".to_string())]);
        assert!(matches!(g.emit_order, ConditionEmitOrder::Aliased(510)));
    }

    #[test]
    fn registered_supports_alias_resolves() {
        // supports-condition-blocks: "Supports alias in a style object".
        let owner = TestCtxOwner::new().with_conditions();
        let styles = json!({ "_hasGrid": { "display": "grid" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions, vec![Condition::Supports("@supports (display: grid)".to_string())]);
        assert!(matches!(g.emit_order, ConditionEmitOrder::Aliased(520)));
    }

    #[test]
    fn unregistered_condition_alias_ignored() {
        let owner = TestCtxOwner::new().with_conditions();
        // _notRegistered is neither a selector nor a condition alias → dropped.
        let styles = json!({ "_notRegistered": { "p": 8 }, "p": 4 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.conditioned.is_empty());
        assert_eq!(resolved.declarations.len(), 1);
    }

    #[test]
    fn selector_alias_wins_over_condition_alias_same_name() {
        // Precedence: a `_` name registered as a selector alias resolves as a
        // pseudo, not a condition (selector_aliases checked first).
        let mut owner = TestCtxOwner::new().with_conditions();
        owner.selector_aliases.insert("_dual".to_string(), "&:hover".to_string());
        owner.condition_aliases.insert(
            "_dual".to_string(),
            ConditionAliasEntry { value: "@media print".to_string(), order: 530, kind: "media".to_string() },
        );
        let styles = json!({ "_dual": { "color": "primary" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        assert!(resolved.conditioned.is_empty());
    }

    #[test]
    fn value_position_condition_key_produces_no_condition_group() {
        // media-condition-aliases: "Condition alias in value position produces
        // no media rule" — value-position maps admit only `_`/breakpoint keys.
        let owner = TestCtxOwner::new().with_conditions();
        let styles = json!({ "p": { "_motionReduce": 12 } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        // `{ _motionReduce: 12 }` is not a responsive value (key not `_`/bp),
        // so `p`'s value is a non-stringifiable object → dropped, no condition.
        assert!(resolved.conditioned.is_empty());
    }

    #[test]
    fn container_establishment_longhands_emit_as_pass_through_declarations() {
        // container-query-support: "Establishing a named container" (design D7 —
        // plain pass-through declarations, no dedicated machinery). Evidence of
        // record for the inc-07 typecheck-only landing.
        let owner = TestCtxOwner::new();
        let styles = json!({ "containerType": "inline-size", "containerName": "card" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.conditioned.is_empty());
        let decls: Vec<(&str, &str)> = resolved
            .declarations
            .iter()
            .map(|d| (d.property.as_str(), d.value.as_str()))
            .collect();
        assert!(decls.contains(&("container-type", "inline-size")), "{decls:?}");
        assert!(decls.contains(&("container-name", "card")), "{decls:?}");
    }

    #[test]
    fn container_establishment_shorthand_emits_as_pass_through_declaration() {
        // container-query-support: "Container shorthand" (design D7).
        let owner = TestCtxOwner::new();
        let styles = json!({ "container": "card / inline-size" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations.len(), 1);
        assert_eq!(resolved.declarations[0].property, "container");
        assert_eq!(resolved.declarations[0].value, "card / inline-size");
    }

    #[test]
    fn condition_emission_order_alias_before_raw_and_by_registry() {
        // stylesheet-assembly: aliased conditions precede raw keys; raw keys
        // keep source order; aliased sort by registry order.
        let owner = TestCtxOwner::new().with_conditions();
        let styles = json!({
            "@supports (display: grid)": { "display": "grid" },
            "@container (min-width: 400px)": { "p": 8 },
            "_cardSm": { "display": "grid" },
            "_motionReduce": { "display": "none" },
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let ordered = resolved.conditioned_emission_order();
        assert_eq!(ordered.len(), 4);
        // aliased first, by registry order: _motionReduce(500) then _cardSm(510)
        assert!(matches!(ordered[0].emit_order, ConditionEmitOrder::Aliased(500)));
        assert!(matches!(ordered[1].emit_order, ConditionEmitOrder::Aliased(510)));
        // then raw, in source order: @supports (idx 0) then @container (idx 1)
        assert_eq!(ordered[2].conditions[0].prelude(), Some("@supports (display: grid)"));
        assert_eq!(ordered[3].conditions[0].prelude(), Some("@container (min-width: 400px)"));
    }

    // ---- inc 05: recursive nested resolution (design D5) ----

    #[test]
    fn nested_alias_in_alias_composes_selector() {
        let owner = TestCtxOwner::new();
        let mut aliases = SelectorAliasesMap::default();
        aliases.insert("_hover".into(), "&:hover".into());
        aliases.insert("_before".into(), "&::before".into());
        aliases.insert("_active".into(), "&:active".into());
        let owner = TestCtxOwner { selector_aliases: aliases, ..owner };
        let styles = json!({ "_hover": { "_before": { "opacity": 1 } }, "_active": { "_before": { "opacity": 0.5 } } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let hover: Vec<_> = resolved.pseudo_selectors.iter().filter(|(s, _)| s == ":hover::before").collect();
        assert_eq!(hover.len(), 1, "composed :hover::before entry: {:?}", resolved.pseudo_selectors);
        // Auto-content applies to nested _before under base definitions.
        assert_eq!(hover[0].1[0].property, "content");
        assert!(hover[0].1.iter().any(|d| d.property == "opacity" && d.value == "1"));
        // Ordering: hover-composed entry precedes active-composed entry (insertion).
        let hi = resolved.pseudo_selectors.iter().position(|(s, _)| s == ":hover::before").unwrap();
        let ai = resolved.pseudo_selectors.iter().position(|(s, _)| s == ":active::before").unwrap();
        assert!(hi < ai);
        // Depth-2 content did NOT flatten into :hover itself.
        assert!(!resolved.pseudo_selectors.iter().any(|(s, d)| s == ":hover" && d.iter().any(|x| x.property == "opacity")));
    }

    #[test]
    fn nested_raw_descendant_with_alias_and_reverse() {
        let owner = TestCtxOwner::new();
        let mut aliases = SelectorAliasesMap::default();
        aliases.insert("_hover".into(), "&:hover".into());
        let owner = TestCtxOwner { selector_aliases: aliases, ..owner };
        let styles = json!({
            "& .icon": { "_hover": { "color": "primary" } },
            "_hover": { "& .icon2": { "color": "primary" } }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.pseudo_selectors.iter().any(|(s, d)| s == " .icon:hover" && d[0].value == "var(--colors-primary)"));
        assert!(resolved.pseudo_selectors.iter().any(|(s, _)| s == ":hover .icon2"));
    }

    #[test]
    fn nested_condition_inside_selector_and_reverse() {
        let owner = TestCtxOwner::new();
        let mut aliases = SelectorAliasesMap::default();
        aliases.insert("_hover".into(), "&:hover".into());
        let owner = TestCtxOwner { selector_aliases: aliases, ..owner };
        let styles = json!({
            "_hover": { "@container (min-width: 400px)": { "p": 16 } },
            "@supports (display: grid)": { "_hover": { "p": 8 } }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.conditioned.len(), 2);
        let container = resolved.conditioned.iter().find(|g| matches!(g.conditions.as_slice(), [Condition::Container(_)])).unwrap();
        assert_eq!(container.selector.as_deref(), Some(":hover"));
        assert_eq!(container.declarations[0].value, "1rem");
        let supports = resolved.conditioned.iter().find(|g| matches!(g.conditions.as_slice(), [Condition::Supports(_)])).unwrap();
        assert_eq!(supports.selector.as_deref(), Some(":hover"));
        assert_eq!(supports.declarations[0].value, "0.5rem");
    }

    #[test]
    fn nested_stacked_conditions_outermost_first() {
        let owner = TestCtxOwner::new();
        let styles = json!({
            "@supports (display: grid)": { "@container (min-width: 400px)": { "display": "grid" } }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.conditioned.len(), 1);
        let g = &resolved.conditioned[0];
        assert!(matches!(g.conditions.as_slice(), [Condition::Supports(_), Condition::Container(_)]));
        assert_eq!(g.emit_order, ConditionEmitOrder::Raw(0));
        assert!(g.selector.is_none());
    }

    #[test]
    fn nested_responsive_map_inside_condition_block() {
        let owner = TestCtxOwner::new();
        let styles = json!({
            "@container (min-width: 400px)": { "fontSize": { "_": "14px", "sm": "16px" } }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let base = resolved.conditioned.iter().find(|g| g.conditions.len() == 1).unwrap();
        assert!(base.declarations.iter().any(|d| d.property == "font-size" && d.value == "14px"));
        let nested = resolved.conditioned.iter().find(|g| g.conditions.len() == 2).unwrap();
        assert!(matches!(&nested.conditions[1], Condition::Breakpoint(bp) if bp == "sm"));
        assert_eq!(nested.declarations[0].value, "16px");
        assert_eq!(nested.emit_order, ConditionEmitOrder::Raw(0));
        // F1 (inc-05 review): the block's own declarations group must PRECEDE
        // its breakpoint child, or the override is cascade-dead.
        let base_idx = resolved.conditioned.iter().position(|g| g.conditions.len() == 1).unwrap();
        let nested_idx = resolved.conditioned.iter().position(|g| g.conditions.len() == 2).unwrap();
        assert!(base_idx < nested_idx, "base group must precede its breakpoint override");
    }

    #[test]
    fn nested_responsive_map_inside_selector_block() {
        let owner = TestCtxOwner::new();
        let mut aliases = SelectorAliasesMap::default();
        aliases.insert("_hover".into(), "&:hover".into());
        let owner = TestCtxOwner { selector_aliases: aliases, ..owner };
        let styles = json!({ "_hover": { "p": { "_": 8, "sm": 16 } } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.pseudo_selectors.iter().any(|(s, d)| s == ":hover" && d[0].value == "0.5rem"));
        let groups: Vec<_> = resolved.breakpoint_selector_groups().collect();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].0, "sm");
        assert_eq!(groups[0].1, ":hover");
        assert_eq!(groups[0].2[0].value, "1rem");
    }

    #[test]
    fn nested_depth_eight_composes_without_loss() {
        let owner = TestCtxOwner::new();
        let styles = json!({
            "&:a1": { "&:a2": { "&:a3": { "&:a4": { "&:a5": { "&:a6": { "&:a7": { "&:a8": { "color": "primary" } } } } } } } }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.pseudo_selectors.iter().any(|(s, d)| s == ":a1:a2:a3:a4:a5:a6:a7:a8" && d[0].value == "var(--colors-primary)"));
    }
}
