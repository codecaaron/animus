//! Theme and scale resolution: evaluated style values and the flat theme
//! produce CSS declarations, shorthand tiers ordered before longhands.

use std::borrow::Cow;
use std::cell::RefCell;

use rustc_hash::{FxHashMap, FxHashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::css_tokens::{decoded_identifier, tokenize, variable_reads};
use crate::evaluator::{EvalError, TransformEvaluator};

// Not registered in propConfig, but typed against the `colors` scale in TS:
// their string values resolve through that scale at every position.
pub(crate) const COLOR_FAMILY_PASS_THROUGH: &[&str] = &[
    "outlineColor",
    "caretColor",
    "accentColor",
    "textDecorationColor",
    "textEmphasisColor",
    "columnRuleColor",
    "backgroundColor",
    "floodColor",
    "lightingColor",
    "stopColor",
    "scrollbarColor",
    "borderBlockColor",
    "borderInlineColor",
    "borderBlockStartColor",
    "borderBlockEndColor",
    "borderInlineStartColor",
    "borderInlineEndColor",
];

fn prop_cascade_tier(prop_name: &str, config: &PropConfigMap) -> (usize, usize) {
    match config.get(prop_name) {
        Some(pc) => {
            let is_shorthand = crate::declarations::is_shorthand(&crate::css::css_property_name(&pc.property));
            if is_shorthand {
                if pc.properties.is_empty() {
                    (0, 0)
                } else {
                    (1, 1000 - pc.properties.len())
                }
            } else {
                (2, 0)
            }
        }
        None => (3, 0),
    }
}

/// The CSS properties a style-object entry sets: a registered prop's, or the
/// property a raw key names; none for a selector or condition key.
fn entry_properties(key: &str, config: &PropConfigMap) -> Vec<String> {
    match config.get(key) {
        Some(pc) => match pc.declaration_binding() {
            Some(binding) => binding.members.iter().map(|member| member.css_property.clone()).collect(),
            None => pc.css_properties().iter().map(|property| crate::css::css_property_name(property)).collect(),
        },
        None if key.starts_with("--") => vec![key.to_string()],
        None if key.chars().all(|ch| ch.is_ascii_alphanumeric()) => vec![crate::css::css_property_name(key)],
        None => Vec::new(),
    }
}

/// A style object's entries in cascade order: by tier, except that an entry
/// moves ahead of every entry whose properties it strictly contains,
/// whatever their tiers, so a longhand always beats its shorthand. Entries
/// keep their relative order otherwise; selectors and conditions never move
/// past each other.
fn cascade_order<'a>(obj: &'a Map<String, Value>, config: &PropConfigMap) -> Vec<(&'a String, &'a Value)> {
    let mut entries: Vec<(&String, &Value)> = obj.iter().collect();
    entries.sort_by_key(|(key, _)| prop_cascade_tier(key, config));
    let properties: Vec<Vec<String>> = entries.iter().map(|(key, _)| entry_properties(key, config)).collect();
    let resets: Vec<_> =
        properties.iter().map(|set| crate::declarations::reset_set(set.iter().map(String::as_str))).collect();
    let broader = |a: usize, b: usize| {
        !resets[b].is_empty() && resets[a].len() > resets[b].len() && resets[a].is_superset(&resets[b])
    };
    let mut pending: Vec<usize> = (0..entries.len()).collect();
    let mut ordered = Vec::with_capacity(entries.len());
    while !pending.is_empty() {
        // Strict containment is acyclic, so some entry is always free.
        let free = pending.iter().position(|&entry| !pending.iter().any(|&other| broader(other, entry))).unwrap_or(0);
        ordered.push(entries[pending.remove(free)]);
    }
    ordered
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PropConfig {
    /// Empty for a declaration prop, whose records name its properties.
    #[serde(default)]
    pub property: String,
    #[serde(default)]
    pub properties: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub negative: bool,
    #[serde(default)]
    pub scale: Option<Value>,
    /// The bound transform's readable name, for diagnostics.
    #[serde(default)]
    pub transform: Option<String>,
    /// The registry key of the bound definition; `None` binds nothing.
    #[serde(default, rename = "transformId", skip_serializing_if = "Option::is_none")]
    pub transform_id: Option<String>,
    #[serde(default, rename = "currentVar")]
    pub current_var: Option<String>,
    /// The callback as an expression of the declaring chain's module: the
    /// captured inline function or reference, or for an inherited callback
    /// a read from the extended parent's runtime component.
    #[serde(default, rename = "transformFnSource")]
    pub transform_fn_source: Option<String>,
    /// The component callback the prop binds. Once its definition passes
    /// admission, extraction evaluates known values through it, while
    /// `transform_fn_source` still delivers the callback for the rest.
    #[serde(skip)]
    pub callback: Option<crate::transforms::CallbackBinding>,
    /// `Some(true)` limits values to the scale. Custom props default to it;
    /// a system config that predates the field keeps raw values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
    #[serde(flatten)]
    pub declaration: crate::declarations::DeclarationFields,
}

impl PropConfig {
    /// The bound records of a declaration prop; `None` for a value prop.
    pub fn declaration_binding(&self) -> Option<&crate::declarations::DeclarationBinding> {
        self.declaration.binding.as_deref()
    }

    /// The CSS properties the prop sets: its `properties`, or else its
    /// `property`.
    pub fn css_properties(&self) -> &[String] {
        if self.properties.is_empty() {
            std::slice::from_ref(&self.property)
        } else {
            &self.properties
        }
    }

    /// The bound definition's registry key and readable name.
    pub fn bound_definition(&self) -> Option<(&str, &str)> {
        Some((self.transform_id.as_deref()?, self.transform.as_deref()?))
    }

    /// Whether its static lookup keys keep the authored value's type: a
    /// callback, inline or configured, can tell `100` from `"100"`.
    pub fn keys_typed(&self) -> bool {
        self.transform_fn_source.is_some() || self.bound_definition().is_some()
    }
}

/// A configuration that predates identities keys each definition by its
/// readable name; bind its props to those keys.
pub fn key_unidentified_transforms(config: &mut PropConfigMap) {
    for prop in config.values_mut() {
        if prop.transform_id.is_none() && prop.transform_fn_source.is_none() {
            prop.transform_id = prop.transform.clone();
        }
    }
}

pub type PropConfigMap = FxHashMap<String, PropConfig>;

pub type FlatTheme = FxHashMap<String, String>;

pub type VariableMap = FxHashMap<String, String>;

pub use crate::property_names::{ContextualVar, ContextualVarsMap};

pub type SelectorAliasesMap = FxHashMap<String, String>;

#[derive(Debug, Clone, Deserialize)]
pub struct ConditionAliasEntry {
    pub value: String,
    pub order: u32,
    pub kind: String,
}

impl ConditionAliasEntry {
    pub fn to_condition(&self) -> Condition {
        match self.kind.as_str() {
            "container" => Condition::Container(self.value.clone()),
            "supports" => Condition::Supports(self.value.clone()),
            _ => Condition::Media(self.value.clone()),
        }
    }
}

pub type ConditionAliasesMap = FxHashMap<String, ConditionAliasEntry>;

/// An alias's condition, with declared contextual variables in a style query
/// given their final names.
fn alias_condition(alias: &ConditionAliasEntry, contextual_vars: &ContextualVarsMap) -> Condition {
    match contextual_vars.rename_authored(&alias.value) {
        Cow::Borrowed(_) => alias.to_condition(),
        Cow::Owned(value) => ConditionAliasEntry { value, ..alias.clone() }.to_condition(),
    }
}

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

#[derive(Debug, Clone, PartialEq)]
pub struct TransformFailure {
    pub transform_name: String,
    pub prop: String,
    pub failure: EvalError,
    pub variant_origin: Option<(String, String)>,
}

pub type TransformFailureSink = RefCell<Vec<TransformFailure>>;

/// An authored value whose entries name nothing on a strict, populated scale;
/// the whole prop is omitted.
#[derive(Debug, Clone, PartialEq)]
pub struct StrictTokenMiss {
    pub prop: String,
    pub value: Value,
    /// Each rejected entry, with its breakpoint key when the value is responsive.
    pub rejected: Vec<(Option<String>, Value)>,
    /// The variant axis and option (`None` for its base) the value was
    /// resolved under, so an inherited declaration can be told apart.
    pub variant_origin: Option<(String, Option<String>)>,
}

pub type StrictTokenMissSink = RefCell<Vec<StrictTokenMiss>>;

/// A style-object key whose block no rule emits, so its styling is lost.
pub const UNRECOGNIZED_STYLE_KEY: &str = "animus.style.unrecognized-key";

/// A style-object key given an object that resolves to nothing.
#[derive(Debug, Clone, PartialEq)]
pub enum DroppedStyleKey {
    /// `_name` is neither a registered selector nor a condition alias.
    UnregisteredAlias(String),
    /// A registered prop given an object whose keys are not all breakpoints.
    NonResponsiveObject(String),
    /// Any other key, such as an HTML element name written without `&`.
    UnrecognizedKey(String),
}

pub type DroppedStyleKeySink = RefCell<Vec<DroppedStyleKey>>;

pub struct ResolveContext<'a> {
    pub config: &'a PropConfigMap,
    pub theme: &'a FlatTheme,
    pub variable_map: &'a VariableMap,
    pub contextual_vars: &'a ContextualVarsMap,
    pub breakpoint_keys: &'a FxHashSet<String>,
    pub selector_aliases: &'a SelectorAliasesMap,
    pub condition_aliases: &'a ConditionAliasesMap,
    pub transform_evaluator: Option<&'a crate::evaluator::TransformEvaluator>,
    pub transform_failures: Option<&'a TransformFailureSink>,
    pub token_misses: Option<&'a StrictTokenMissSink>,
    pub dropped_keys: Option<&'a DroppedStyleKeySink>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CssDeclaration {
    pub property: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    Breakpoint(String),
    Media(String),
    Container(String),
    Supports(String),
}

impl Condition {
    pub fn prelude(&self) -> Option<&str> {
        match self {
            Condition::Breakpoint(_) => None,
            Condition::Media(q) | Condition::Container(q) | Condition::Supports(q) => Some(q),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConditionEmitOrder {
    Breakpoint,
    Aliased(u32),
    Raw(usize),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConditionedGroup {
    pub conditions: Vec<Condition>,
    pub selector: Option<String>,
    pub declarations: Vec<CssDeclaration>,
    pub emit_order: ConditionEmitOrder,
}

impl ConditionedGroup {
    pub fn breakpoint(bp: impl Into<String>, declarations: Vec<CssDeclaration>) -> Self {
        Self {
            conditions: vec![Condition::Breakpoint(bp.into())],
            selector: None,
            declarations,
            emit_order: ConditionEmitOrder::Breakpoint,
        }
    }

    pub fn single(condition: Condition, declarations: Vec<CssDeclaration>, emit_order: ConditionEmitOrder) -> Self {
        Self {
            conditions: vec![condition],
            selector: None,
            declarations,
            emit_order,
        }
    }
}

fn compose_selectors(outer: &str, inner_raw: &str) -> String {
    let outer_parts = split_top_level_commas(outer);
    let mut composed: Vec<String> = Vec::new();
    for inner_part in normalize_pseudo_branches(inner_raw) {
        for outer_part in &outer_parts {
            composed.push(crate::selector_subject::substitute_subjects(
                &inner_part,
                outer_part,
            ));
        }
    }
    composed.join(",")
}

#[derive(Clone, Default)]
struct NestFrame {
    selector: Option<String>,
    conditions: Vec<Condition>,
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

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResolvedStyles {
    pub declarations: Vec<CssDeclaration>,
    /// Unconditioned selector groups live only here; a conditioned group with
    /// an empty stack would change class-hash coverage and byte-identity.
    pub pseudo_selectors: Vec<(String, Vec<CssDeclaration>)>,
    pub conditioned: Vec<ConditionedGroup>,
}

impl ResolvedStyles {
    pub fn breakpoint_groups(&self) -> impl Iterator<Item = (&String, &Vec<CssDeclaration>)> {
        self.conditioned.iter().filter_map(|g| match (g.conditions.as_slice(), &g.selector) {
            ([Condition::Breakpoint(bp)], None) => Some((bp, &g.declarations)),
            _ => None,
        })
    }

    pub fn breakpoint_selector_groups(
        &self,
    ) -> impl Iterator<Item = (&String, &String, &Vec<CssDeclaration>)> {
        self.conditioned.iter().filter_map(|g| match (g.conditions.as_slice(), &g.selector) {
            ([Condition::Breakpoint(bp)], Some(sel)) => Some((bp, sel, &g.declarations)),
            _ => None,
        })
    }

    pub fn conditioned_emission_order(&self) -> Vec<&ConditionedGroup> {
        let mut groups: Vec<&ConditionedGroup> = self
            .conditioned
            .iter()
            .filter(|g| !matches!(g.emit_order, ConditionEmitOrder::Breakpoint))
            .collect();
        groups.sort_by_key(|g| match &g.emit_order {
            ConditionEmitOrder::Aliased(order) => (0usize, *order as usize),
            ConditionEmitOrder::Raw(idx) => (1usize, *idx),
            ConditionEmitOrder::Breakpoint => (2usize, 0usize),
        });
        groups
    }

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

    let entries = cascade_order(obj, ctx.config);

    let mut raw_condition_index = 0usize;

    for (key, value) in entries {
        if key.starts_with('_') {
            if let Some(alias_selector) = ctx.selector_aliases.get(key) {
                if let Some(nested_obj) = value.as_object() {
                    let frame = NestFrame::default().with_selector(alias_selector);
                    let inject = auto_content && (key == "_before" || key == "_after");
                    resolve_block_entries(
                        nested_obj, ctx, &frame, auto_content, inject, &mut result, &mut raw_condition_index,
                    );
                }
            } else if let Some(cond_alias) = ctx.condition_aliases.get(key) {
                if let Some(nested_obj) = value.as_object() {
                    let frame = NestFrame::default().with_condition(
                        alias_condition(cond_alias, ctx.contextual_vars),
                        ConditionEmitOrder::Aliased(cond_alias.order),
                    );
                    resolve_block_entries(
                        nested_obj, ctx, &frame, auto_content, false, &mut result, &mut raw_condition_index,
                    );
                }
            } else if value.is_object() {
                record_dropped_key(ctx, DroppedStyleKey::UnregisteredAlias(key.clone()));
            }
            continue;
        }

        if crate::selector_subject::has_subject(key) || key.starts_with(':') {
            if let Some(nested_obj) = value.as_object() {
                let frame = NestFrame::default().with_selector(key);
                resolve_block_entries(
                    nested_obj, ctx, &frame, auto_content, false, &mut result, &mut raw_condition_index,
                );
            }
            continue;
        }

        if key.starts_with('@') {
            if let Some(condition) = condition_from_raw_key(&ctx.contextual_vars.rename_authored(key)) {
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

        if omit_strict_token_miss(key, value, ctx) {
            continue;
        }

        if is_responsive_value(value, ctx.breakpoint_keys) {
            resolve_responsive_prop(
                key,
                value,
                ctx.config,
                ctx.theme,
                ctx.variable_map,
                ctx.contextual_vars,
                ctx.transform_evaluator,
                ctx.transform_failures,
                &mut result,
            );
            continue;
        }

        result.declarations.extend(resolve_entry(key, value, ctx));
    }

    result
}

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
    let entries = cascade_order(obj, ctx.config);

    // This block's own declarations must precede its children's groups, or
    // the breakpoint override is cascade-dead at equal specificity.
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
                        alias_condition(cond_alias, ctx.contextual_vars),
                        ConditionEmitOrder::Aliased(cond_alias.order),
                    );
                    resolve_block_entries(
                        nested_obj, ctx, &child, auto_content, false, result, raw_condition_index,
                    );
                }
            } else if value.is_object() {
                record_dropped_key(ctx, DroppedStyleKey::UnregisteredAlias(key.clone()));
            }
            continue;
        }

        if crate::selector_subject::has_subject(key) || key.starts_with(':') {
            if let Some(nested_obj) = value.as_object() {
                let child = frame.with_selector(key);
                resolve_block_entries(
                    nested_obj, ctx, &child, auto_content, false, result, raw_condition_index,
                );
            }
            continue;
        }

        if key.starts_with('@') {
            if let Some(condition) = condition_from_raw_key(&ctx.contextual_vars.rename_authored(key)) {
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

        if omit_strict_token_miss(key, value, ctx) {
            continue;
        }

        if is_responsive_value(value, ctx.breakpoint_keys) {
            if let Some(vobj) = value.as_object() {
                for (bp_key, bp_value) in vobj {
                    let declarations = resolve_single_prop(
                        key, bp_value, ctx.config, ctx.theme, ctx.variable_map, ctx.contextual_vars, ctx.transform_evaluator, ctx.transform_failures,
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

        plain_decls.extend(resolve_entry(key, value, ctx));
    }

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

fn record_dropped_key(ctx: &ResolveContext, dropped: DroppedStyleKey) {
    if let Some(sink) = ctx.dropped_keys {
        sink.borrow_mut().push(dropped);
    }
}

/// One non-responsive entry's declarations. An object value that yields
/// none, and failed no transform (which reports itself), is a dropped key.
fn resolve_entry(key: &str, value: &Value, ctx: &ResolveContext) -> Vec<CssDeclaration> {
    let failures = || ctx.transform_failures.map_or(0, |sink| sink.borrow().len());
    let failures_before = failures();
    let declarations = resolve_single_prop(
        key, value, ctx.config, ctx.theme, ctx.variable_map, ctx.contextual_vars, ctx.transform_evaluator, ctx.transform_failures,
    );
    if declarations.is_empty() && value.is_object() && failures() == failures_before {
        let key = key.to_string();
        record_dropped_key(
            ctx,
            if ctx.config.contains_key(&key) {
                DroppedStyleKey::NonResponsiveObject(key)
            } else {
                DroppedStyleKey::UnrecognizedKey(key)
            },
        );
    }
    declarations
}

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

pub fn merge_pseudo_selectors(
    pseudo_selectors: &mut Vec<(String, Vec<CssDeclaration>)>,
    selector: String,
    new_declarations: Vec<CssDeclaration>,
) {
    if let Some((_, existing)) = pseudo_selectors.iter_mut().find(|(s, _)| *s == selector) {
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

pub(crate) fn is_responsive_value(value: &Value, breakpoint_keys: &FxHashSet<String>) -> bool {
    if let Some(obj) = value.as_object() {
        !obj.is_empty()
            && obj
                .keys()
                .all(|k| k == "_" || breakpoint_keys.contains(k))
    } else {
        false
    }
}

#[allow(clippy::too_many_arguments)]
fn resolve_responsive_prop(
    prop_name: &str,
    value: &Value,
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
    evaluator: Option<&TransformEvaluator>,
    failures: Option<&TransformFailureSink>,
    result: &mut ResolvedStyles,
) {
    let obj = match value.as_object() {
        Some(o) => o,
        None => return,
    };

    for (bp_key, bp_value) in obj {
        let declarations =
            resolve_single_prop(prop_name, bp_value, config, theme, variable_map, contextual_vars, evaluator, failures);
        if bp_key == "_" {
            result.declarations.extend(declarations);
        } else {
            result.breakpoint_decls_mut(bp_key).extend(declarations);
        }
    }
}

fn resolve_flat_styles(obj: &Map<String, Value>, ctx: &ResolveContext) -> Vec<CssDeclaration> {
    let entries = cascade_order(obj, ctx.config);

    let mut declarations = Vec::new();
    for (key, value) in entries {
        if omit_strict_token_miss(key, value, ctx) {
            continue;
        }
        declarations.extend(resolve_single_prop(
            key,
            value,
            ctx.config,
            ctx.theme,
            ctx.variable_map,
            ctx.contextual_vars,
            ctx.transform_evaluator,
            ctx.transform_failures,
        ));
    }
    declarations
}

fn resolve_color_family_pass_through(
    value: &Value,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
) -> Option<String> {
    let Value::String(raw) = value else {
        return None;
    };

    let lookup_key = format!("colors.{}", raw);
    if let Some(theme_value) = theme.get(&lookup_key) {
        return Some(resolve_token_aliases(
            theme_value,
            theme,
            variable_map,
            contextual_vars,
        ));
    }

    if let Some(ctx) = resolve_contextual_var("colors", raw, contextual_vars) {
        return Some(ctx);
    }

    None
}

/// Whether a prop with `current_var` also writes `value` to it: a value that
/// reads the variable, directly or inside another `var()`'s fallback, leaves
/// it alone, since writing it would make the variable cyclic wherever that
/// read is used. A read is a function token whose decoded name is `var` in
/// any case, with the decoded variable name as its first argument; comments,
/// quoted strings and `url()` read nothing. The runtime resolver keeps an
/// identical predicate.
pub fn writes_current_var(value: &str, current_var: &str) -> bool {
    if !value.contains('(') {
        return true;
    }
    let destination = decoded_identifier(current_var);
    let tokens = tokenize(value);
    let reads_destination = variable_reads(&tokens).any(|name| name == destination);
    !reads_destination
}

#[allow(clippy::too_many_arguments)]
fn resolve_single_prop(
    prop_name: &str,
    value: &Value,
    config: &PropConfigMap,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
    evaluator: Option<&TransformEvaluator>,
    failures: Option<&TransformFailureSink>,
) -> Vec<CssDeclaration> {
    let prop_config = match config.get(prop_name) {
        Some(c) => c,
        None => {
            if COLOR_FAMILY_PASS_THROUGH.contains(&prop_name) {
                if let Some(resolved) =
                    resolve_color_family_pass_through(value, theme, variable_map, contextual_vars)
                {
                    return vec![CssDeclaration {
                        property: crate::css::css_property_name(prop_name),
                        value: resolved,
                    }];
                }
            }
            if let Some(css_value) = value_to_css_string(value) {
                // Authored text is renamed before any token substitution, so
                // a token's own final name is never renamed again.
                let resolved = resolve_token_aliases(
                    &contextual_vars.rename_authored(&css_value),
                    theme,
                    variable_map,
                    contextual_vars,
                );
                return vec![CssDeclaration {
                    property: contextual_vars.emitted_property(&crate::css::css_property_name(prop_name)).into_owned(),
                    value: resolved,
                }];
            }
            return vec![];
        }
    };

    if let Some(binding) = prop_config.declaration_binding() {
        return binding
            .record(value)
            .map(|record| {
                binding
                    .members
                    .iter()
                    .map(|member| CssDeclaration {
                        property: member.css_property.clone(),
                        value: record[&member.name].clone(),
                    })
                    .collect()
            })
            .unwrap_or_default();
    }

    let Some(resolved) = resolve_value(prop_name, value, prop_config, theme, evaluator, failures) else {
        return vec![];
    };
    // Only the authored value is renamed: a scale token or transform result
    // passes through as resolved.
    let resolved = if value_to_css_string(value).as_deref() == Some(resolved.as_str()) {
        contextual_vars.rename_authored(&resolved).into_owned()
    } else {
        resolved
    };
    let resolved_value = finish_value(&resolved, value, prop_config, theme, variable_map, contextual_vars);

    let mut declarations: Vec<CssDeclaration> = prop_config
        .css_properties()
        .iter()
        .map(|css_prop| CssDeclaration {
            property: contextual_vars.emitted_property(&crate::css::css_property_name(css_prop)).into_owned(),
            value: resolved_value.clone(),
        })
        .collect();

    if let Some(current_var) = &prop_config.current_var {
        let current_var = contextual_vars.emitted_property(current_var);
        if writes_current_var(&resolved_value, &current_var) {
            declarations.push(CssDeclaration {
                property: current_var.into_owned(),
                value: resolved_value,
            });
        }
    }

    declarations
}

/// The CSS a resolved value becomes: token aliases resolve, and a result
/// equal to the authored value may name a contextual variable of the prop's
/// scale.
fn finish_value(
    resolved: &str,
    authored: &Value,
    config: &PropConfig,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
) -> String {
    let aliased = resolve_token_aliases(resolved, theme, variable_map, contextual_vars);
    match (authored, &config.scale) {
        (Value::String(text), Some(Value::String(scale))) if aliased == *text => {
            resolve_contextual_var(scale, text, contextual_vars).unwrap_or(aliased)
        }
        _ => aliased,
    }
}

fn resolve_contextual_var(
    scale_name: &str,
    value: &str,
    contextual_vars: &ContextualVarsMap,
) -> Option<String> {
    contextual_vars
        .in_scale(scale_name, value)
        .map(|var| contextual_var_reference(&var.var))
}

/// The CSS a contextual variable token resolves to.
pub(crate) fn contextual_var_reference(name: &str) -> String {
    format!("var(--{})", name)
}

fn resolve_value(
    prop_name: &str,
    value: &Value,
    config: &PropConfig,
    theme: &FlatTheme,
    evaluator: Option<&TransformEvaluator>,
    failures: Option<&TransformFailureSink>,
) -> Option<String> {
    let (resolved, is_negative) = lookup_scale_token(value, config, theme)
        .map_or((None, false), |(token, negated)| (Some(token), negated));
    let final_value = resolved.as_ref().unwrap_or(value);
    // A CSS-wide keyword is a cascade instruction, not a value: no transform
    // sees it. A scale key spelled like one resolved above, as a token.
    if resolved.is_none() && is_css_wide_keyword(value) {
        return value_to_css_string(value);
    }

    // A name bound to no definition was reported at its declaration; a
    // component callback binds its definition once admitted.
    let binding = config.bound_definition().or_else(|| {
        let definition = &config.callback.as_ref()?.definition;
        evaluator?.is_registered(&definition.key).then_some((definition.key.as_str(), definition.name.as_str()))
    });
    // As at runtime, the bound transform takes every value that reaches it:
    // a scale's token, or a value missing a non-strict scale.
    if let Some((transform_key, transform_name)) = binding {
        if let Some(eval) = evaluator {
            match eval.evaluate(transform_key, transform_name, final_value) {
                Ok(css) => {
                    return Some(if is_negative {
                        negate_css_value(&css)
                    } else {
                        css
                    });
                }
                // A throw, or a decline where no runtime slot exists (the
                // usage gate keeps JSX declines away), is reported and
                // applies the raw value.
                Err(err) => {
                    if let Some(sink) = failures {
                        sink.borrow_mut().push(TransformFailure {
                            transform_name: transform_name.to_string(),
                            prop: prop_name.to_string(),
                            failure: err.clone(),
                            variant_origin: None,
                        });
                    }
                    if matches!(err, EvalError::InvalidResultShape { .. }) {
                        return None;
                    }
                }
            }
        } else if let Some(raw_str) = value_to_css_string(final_value) {
            let css = format!("__TRANSFORM__{}__{}__", transform_name, raw_str);
            return Some(if is_negative {
                negate_css_value(&css)
            } else {
                css
            });
        }
    }

    let css = value_to_css_string(final_value);
    if is_negative {
        css.map(|v| negate_css_value(&v))
    } else {
        css
    }
}

/// Authored keys win; only an admitted negative falls back to its positive
/// counterpart, returned with `true` so the caller negates it.
fn lookup_scale_token(value: &Value, config: &PropConfig, theme: &FlatTheme) -> Option<(Value, bool)> {
    if let Some(token) = lookup_scale_value(value, config, theme) {
        return Some((token, false));
    }
    if !config.negative {
        return None;
    }
    let number = value.as_f64().filter(|number| *number < 0.0)?;
    let absolute = value.as_i64().map_or_else(
        || serde_json::json!(-number),
        |integer| serde_json::json!(integer.unsigned_abs()),
    );
    lookup_scale_value(&absolute, config, theme).map(|token| (token, true))
}

/// Whether `value` is one of the CSS-wide keywords, which no transform sees.
fn is_css_wide_keyword(value: &Value) -> bool {
    value.as_str().is_some_and(|text| crate::css::CSS_WIDE_KEYWORDS.contains(&text))
}

/// Whether every entry of `value` is a CSS-wide keyword no scale key
/// resolves, so no transform sees any of it.
pub(crate) fn skips_transforms(config: &PropConfig, value: &Value, ctx: &ResolveContext) -> bool {
    let skips = |entry: &Value| is_css_wide_keyword(entry) && lookup_scale_token(entry, config, ctx.theme).is_none();
    match value.as_object() {
        Some(entries) if is_responsive_value(value, ctx.breakpoint_keys) => entries.values().all(skips),
        _ => skips(value),
    }
}

/// Whether extraction can resolve every entry of `value` through the prop's
/// admitted callback with the meaning the runtime gives it; otherwise the
/// whole value stays on the runtime path. An isolated evaluation can exhaust
/// its budget or read the host, and extraction or its CSS post-processing
/// can rewrite a string result the runtime applies verbatim, such as a bare
/// number or token syntax. A throw or an invalid result keeps its build-time
/// policy.
pub(crate) fn extracts_callback_value(
    config: &PropConfig,
    key: &str,
    name: &str,
    value: &Value,
    ctx: &ResolveContext,
) -> bool {
    let Some(evaluator) = ctx.transform_evaluator else {
        return false;
    };
    let rewritten = |entry: &Value, css: &str| {
        finish_value(css, entry, config, ctx.theme, ctx.variable_map, ctx.contextual_vars) != css
            || config
                .css_properties()
                .iter()
                .any(|property| crate::css::unit_fallback_rewrites(css, &crate::css::css_property_name(property)))
    };
    let evaluated = |entry: &Value| {
        if !(entry.is_string() || entry.is_number()) {
            return false;
        }
        let token = lookup_scale_token(entry, config, ctx.theme);
        if token.is_none() && is_css_wide_keyword(entry) {
            return true;
        }
        let input = token.as_ref().map_or(entry, |(token, _)| token);
        match evaluator.evaluate_callback(key, name, input) {
            Ok(scalar) => scalar.numeric || !rewritten(entry, &scalar.css),
            Err(EvalError::Unevaluable) => false,
            Err(_) => true,
        }
    };
    match value.as_object() {
        Some(entries) if is_responsive_value(value, ctx.breakpoint_keys) => {
            entries.values().all(evaluated)
        }
        _ => evaluated(value),
    }
}

/// [`extracts_callback_value`] for a value whose lookup the runtime makes:
/// a prop bound to an admitted configured definition follows the runtime's
/// result; any other value extracts as before.
pub(crate) fn extracts_configured_value(config: &PropConfig, value: &Value, ctx: &ResolveContext) -> bool {
    match (config.bound_definition(), ctx.transform_evaluator) {
        (Some((key, name)), Some(evaluator)) if evaluator.is_registered(key) => {
            extracts_callback_value(config, key, name, value, ctx)
        }
        _ => true,
    }
}

/// Records a strict-scale miss; a miss omits every entry of the prop, so no
/// breakpoint keeps a partial contribution.
fn omit_strict_token_miss(prop_name: &str, value: &Value, ctx: &ResolveContext) -> bool {
    let Some(miss) = ctx
        .config
        .get(prop_name)
        .and_then(|config| strict_token_miss_of(prop_name, config, value, ctx))
    else {
        return false;
    };
    if let Some(sink) = ctx.token_misses {
        sink.borrow_mut().push(miss);
    }
    true
}

/// The miss `value` makes on `prop_name`'s strict, populated scale, if any.
pub(crate) fn strict_token_miss_of(
    prop_name: &str,
    config: &PropConfig,
    value: &Value,
    ctx: &ResolveContext,
) -> Option<StrictTokenMiss> {
    let rejected = strict_token_misses(config, value, ctx);
    (!rejected.is_empty()).then(|| StrictTokenMiss {
        prop: prop_name.to_string(),
        value: value.clone(),
        rejected,
        variant_origin: None,
    })
}

/// The runtime rejects a value only where extraction would omit it.
pub fn is_strict_scale(config: &PropConfig, theme: &FlatTheme) -> bool {
    config.strict == Some(true) && scale_is_populated(config, theme)
}

/// The entries of `value` that a strict, populated scale rejects; empty when
/// the prop admits the whole value or keeps raw values.
fn strict_token_misses(
    config: &PropConfig,
    value: &Value,
    ctx: &ResolveContext,
) -> Vec<(Option<String>, Value)> {
    // A declaration prop is strict by nature: only its scale's keys apply.
    if let Some(binding) = config.declaration_binding() {
        return match value.as_object() {
            Some(entries) if is_responsive_value(value, ctx.breakpoint_keys) => entries
                .iter()
                .filter(|(_, entry)| !entry.is_null() && binding.record(entry).is_none())
                .map(|(breakpoint, entry)| (Some(breakpoint.clone()), entry.clone()))
                .collect(),
            _ if binding.record(value).is_none() => vec![(None, value.clone())],
            _ => vec![],
        };
    }
    if config.strict != Some(true) {
        return vec![];
    }
    let miss = |entry: &Value| is_strict_token_miss(entry, config, ctx.theme, ctx.contextual_vars);
    let rejected: Vec<(Option<String>, Value)> = match value.as_object() {
        Some(entries) if is_responsive_value(value, ctx.breakpoint_keys) => entries
            .iter()
            .filter(|(_, entry)| miss(entry))
            .map(|(breakpoint, entry)| (Some(breakpoint.clone()), entry.clone()))
            .collect(),
        _ if miss(value) => vec![(None, value.clone())],
        _ => vec![],
    };
    if rejected.is_empty() || !scale_is_populated(config, ctx.theme) {
        return vec![];
    }
    rejected
}

/// An empty or absent scale admits raw values whatever its strictness.
fn scale_is_populated(config: &PropConfig, theme: &FlatTheme) -> bool {
    match &config.scale {
        Some(Value::String(name)) => {
            let prefix = format!("{name}.");
            theme.keys().any(|key| key.starts_with(&prefix))
        }
        Some(Value::Object(values)) => !values.is_empty(),
        Some(Value::Array(values)) => !values.is_empty(),
        _ => false,
    }
}

fn is_strict_token_miss(
    value: &Value,
    config: &PropConfig,
    theme: &FlatTheme,
    contextual_vars: &ContextualVarsMap,
) -> bool {
    lookup_scale_token(value, config, theme).is_none()
        && !is_contextual_token(value, config, contextual_vars)
        && !admitted_without_token(value, config)
}

/// A contextual variable declared on the prop's named scale is one of its tokens.
fn is_contextual_token(value: &Value, config: &PropConfig, contextual_vars: &ContextualVarsMap) -> bool {
    match (value, &config.scale) {
        (Value::String(name), Some(Value::String(scale))) => {
            resolve_contextual_var(scale, name, contextual_vars).is_some()
        }
        _ => false,
    }
}

const CONTAINER_UNITS: &[&str] = &["cqw", "cqi", "cqh", "cqb", "cqmin", "cqmax"];
const SIZE_UNITS: &[&str] = &["px", "rem", "vh", "vw", "vmax", "vmin", "%"];

/// Values a strict prop's public type admits beside its tokens: zero, the
/// CSS-wide and per-property keywords of `css_keywords.json`, container units,
/// token references, and the lengths size properties take. Must stay in step
/// with the runtime resolver's rule.
fn admitted_without_token(value: &Value, config: &PropConfig) -> bool {
    match value {
        Value::Number(number) => number.as_f64() == Some(0.0),
        Value::String(text) => {
            text == "0"
                || css_keywords(&config.property).any(|keyword| keyword == text)
                || text.contains('{')
                || is_number_with_unit(text, CONTAINER_UNITS)
                || (is_size_property(&config.property)
                    && (is_number_with_unit(text, SIZE_UNITS) || text.starts_with("calc(")))
        }
        _ => true,
    }
}

#[derive(Deserialize)]
struct CssKeywords {
    globals: Vec<String>,
    properties: FxHashMap<String, Vec<String>>,
}

/// Generated from the public strict types and checked against
/// those types by `packages/extract/scripts/css-keywords.ts`.
fn css_keyword_table() -> &'static CssKeywords {
    static TABLE: std::sync::OnceLock<CssKeywords> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str(include_str!("css_keywords.json"))
            .expect("css_keywords.json is generated valid JSON")
    })
}

/// The CSS-wide keywords followed by `property`'s own keywords.
pub fn css_keywords(property: &str) -> impl Iterator<Item = &'static str> {
    let table = css_keyword_table();
    table
        .globals
        .iter()
        .chain(table.properties.get(property).into_iter().flatten())
        .map(String::as_str)
}

/// A CSS `<number>`, exponent included, followed by one of `units`.
fn is_number_with_unit(text: &str, units: &[&str]) -> bool {
    units
        .iter()
        .any(|unit| text.strip_suffix(unit).is_some_and(is_css_number))
}

fn is_css_number(text: &str) -> bool {
    let unsigned = text.strip_prefix(['-', '+']).unwrap_or(text);
    let (mantissa, exponent) = match unsigned.find(['e', 'E']) {
        Some(at) => (&unsigned[..at], Some(&unsigned[at + 1..])),
        None => (unsigned, None),
    };
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    let mantissa_ok = match mantissa.split_once('.') {
        Some((whole, fraction)) => (whole.is_empty() || digits(whole)) && digits(fraction),
        None => digits(mantissa),
    };
    mantissa_ok
        && exponent.is_none_or(|exponent| digits(exponent.strip_prefix(['-', '+']).unwrap_or(exponent)))
}

fn is_size_property(property: &str) -> bool {
    matches!(property, "left" | "right" | "top" | "bottom" | "inset" | "width" | "height")
        || ["Width", "Height", "-width", "-height"]
            .iter()
            .any(|suffix| property.ends_with(suffix))
}

fn lookup_scale_value(value: &Value, config: &PropConfig, theme: &FlatTheme) -> Option<Value> {
    let scale = config.scale.as_ref()?;
    let key = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    if key.is_empty() {
        return None;
    }
    match scale {
        Value::String(name) => theme.get(&format!("{name}.{key}")).cloned().map(Value::String),
        Value::Object(values) => values.get(&key).cloned(),
        // Keyed as the runtime keys an array scale's entries, so `"8"` and `8`
        // agree on both paths.
        Value::Array(values) => values.iter().find(|candidate| match candidate {
            Value::String(entry) => *entry == key,
            Value::Number(entry) => entry.to_string() == key,
            _ => false,
        }).cloned(),
        _ => None,
    }
}

fn negate_css_value(val: &str) -> String {
    if val.contains('(') {
        format!("calc({val} * -1)")
    } else if val == "0" || val == "-0" {
        "0".to_string()
    } else if let Some(stripped) = val.strip_prefix('-') {
        stripped.to_string()
    } else {
        format!("-{}", val.strip_prefix('+').unwrap_or(val))
    }
}

fn resolve_token_aliases(
    value: &str,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
) -> String {
    resolve_aliases_within(value, theme, variable_map, contextual_vars, 0)
}

/// How deep a theme literal's own aliases expand. The theme build already
/// rejects a reference cycle; past this depth an alias stays unresolved and
/// is reported as one.
const ALIAS_DEPTH_LIMIT: usize = 16;

fn resolve_aliases_within(
    value: &str,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
    depth: usize,
) -> String {
    if !value.contains('{') {
        return value.to_string();
    }

    let mut result = String::with_capacity(value.len());
    let mut chars = value.char_indices().peekable();

    while let Some((i, ch)) = chars.next() {
        if ch == '{' {
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
                let resolved = resolve_single_alias(alias_content, theme, variable_map, contextual_vars, depth);
                result.push_str(&resolved);
            } else {
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

/// A colour token's opacity modifier: a percentage from 0 to 100, decimals
/// allowed (`/2.6`), as the text it writes; `None` for anything else.
pub(crate) fn opacity_percentage(modifier: &str) -> Option<String> {
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    let well_formed = match modifier.split_once('.') {
        Some((whole, fraction)) => digits(whole) && digits(fraction),
        None => digits(modifier),
    };
    let percentage: f64 = modifier.parse().ok().filter(|_| well_formed)?;
    (percentage <= 100.0).then(|| percentage.to_string())
}

fn resolve_single_alias(
    content: &str,
    theme: &FlatTheme,
    variable_map: &VariableMap,
    contextual_vars: &ContextualVarsMap,
    depth: usize,
) -> String {
    // A malformed modifier keeps its old reading: an integer, or none.
    let (token_path, alpha) = match content.split_once('/') {
        Some((path, modifier)) => (
            path,
            opacity_percentage(modifier).or_else(|| modifier.parse::<u32>().ok().map(|integer| integer.to_string())),
        ),
        None => (content, None),
    };

    let flat_key = dot_path_to_flat_key(token_path);

    let resolved = if let Some(var_name) = variable_map.get(&flat_key) {
        format!("var({})", var_name)
    } else if let Some(literal) = theme.get(&flat_key) {
        // A literal can itself hold aliases, a contextual variable among
        // them, when the theme was built before they resolved there.
        if literal.contains('{') && depth < ALIAS_DEPTH_LIMIT {
            resolve_aliases_within(literal, theme, variable_map, contextual_vars, depth + 1)
        } else {
            literal.clone()
        }
    } else if let Some(dot_idx) = token_path.find('.') {
        let scale_name = &token_path[..dot_idx];
        let var_name = &token_path[dot_idx + 1..];
        if let Some(ctx_resolved) = resolve_contextual_var(scale_name, var_name, contextual_vars) {
            ctx_resolved
        } else {
            return format!("{{{}}}", content);
        }
    } else {
        return format!("{{{}}}", content);
    };

    match alpha.as_deref() {
        Some("0") => "transparent".to_string(),
        Some("100") | None => resolved,
        Some(pct) => {
            format!("color-mix(in srgb, {} {}%, transparent)", resolved, pct)
        }
    }
}

fn dot_path_to_flat_key(path: &str) -> String {
    path.to_string()
}

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

fn scan_top_level_commas(selector: &str, mut on_comma: impl FnMut(usize) -> bool) {
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    // Checked after the match so the side-effecting callback never runs
    // from inside a match guard.
    let mut stop = false;

    for (i, c) in selector.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            _ if quote == Some(c) => quote = None,
            _ if quote.is_some() => {}
            '\'' | '"' => quote = Some(c),
            '(' => paren_depth += 1,
            ')' => paren_depth = paren_depth.saturating_sub(1),
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            ',' if paren_depth == 0 && bracket_depth == 0 => stop = !on_comma(i),
            _ => {}
        }
        if stop {
            return;
        }
    }
}

pub fn split_top_level_commas(selector: &str) -> Vec<&str> {
    let mut parts: Vec<&str> = Vec::new();
    let mut start = 0usize;
    scan_top_level_commas(selector, |i| {
        parts.push(&selector[start..i]);
        // ',' is ASCII, so `i + 1` is a char boundary.
        start = i + 1;
        true
    });
    parts.push(&selector[start..]);
    parts
}

pub fn first_top_level_branch(selector: &str) -> &str {
    let mut end = selector.len();
    scan_top_level_commas(selector, |i| {
        end = i;
        false
    });
    &selector[..end]
}

fn normalize_pseudo_selector(selector: &str) -> String {
    normalize_pseudo_branches(selector).join(",")
}

fn normalize_pseudo_branches(selector: &str) -> Vec<String> {
    split_top_level_commas(selector)
        .into_iter()
        .map(|part| {
            let trimmed = part.trim();
            let with_subject = if crate::selector_subject::has_subject(trimmed) {
                trimmed.to_string()
            } else {
                format!("&{}", trimmed)
            };
            match with_subject.as_str() {
                "&:before" | "&:after" | "&:first-line" | "&:first-letter" => {
                    format!("&:{}", &with_subject[1..])
                }
                _ => with_subject,
            }
        })
        .collect()
}

pub fn resolve_global_block(
    block: &Value,
    ctx: &ResolveContext,
) -> String {
    let selectors = match block.as_object() {
        Some(o) => o,
        None => return String::new(),
    };

    let mut rules: Vec<String> = Vec::new();
    let breakpoints = crate::analyze_css::extract_breakpoints(ctx.theme);

    for (selector, style_obj) in selectors {
        if selector.starts_with("@keyframes") {
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
                let decls = resolve_flat_styles(frame_obj, ctx);
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

        let Some(style_map) = style_obj.as_object() else {
            continue;
        };
        // An at-rule selector (`@font-face`, `@page`) holds declarations
        // only, as before; nesting under one is not supported.
        if selector.starts_with('@') {
            let decls = resolve_flat_styles(style_map, ctx);
            if !decls.is_empty() {
                rules.push(global_rule(selector, &decls, 0));
            }
            continue;
        }
        // The resolver components use: nested `&` selectors, aliases,
        // breakpoints and at-rule conditions, with the global's selector as
        // the subject; `_before`/`_after` gain `content` as on a component.
        let resolved = resolve_styles(style_obj, ctx, true);
        push_global_rules(&mut rules, selector, &resolved, &breakpoints);
    }

    rules.join("\n\n")
}

/// One rule, its declarations indented under it, at `depth` levels deep.
fn global_rule(selector: &str, declarations: &[CssDeclaration], depth: usize) -> String {
    let pad = "  ".repeat(depth);
    let body: String = declarations
        .iter()
        .map(|d| format!("{pad}  {}: {};", d.property, d.value))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{pad}{selector} {{\n{body}\n{pad}}}")
}

/// A rule wrapped in each prelude, outermost first.
fn global_conditioned_rule(preludes: &[String], selector: &str, declarations: &[CssDeclaration]) -> String {
    let mut out = String::new();
    for (depth, prelude) in preludes.iter().enumerate() {
        out.push_str(&"  ".repeat(depth));
        out.push_str(prelude);
        out.push_str(" {\n");
    }
    out.push_str(&global_rule(selector, declarations, preludes.len()));
    for depth in (0..preludes.len()).rev() {
        out.push('\n');
        out.push_str(&"  ".repeat(depth));
        out.push('}');
    }
    out
}

/// A global's rules in the order components emit them, except that nested
/// selectors keep the resolver's order (authored, with a block after the
/// blocks nested inside it): the base rule, nested selectors, breakpoints by
/// width, then the other conditions.
fn push_global_rules(
    rules: &mut Vec<String>,
    selector: &str,
    resolved: &ResolvedStyles,
    breakpoints: &crate::css::BreakpointMap,
) {
    // Each branch trimmed, or `a , b` would compose to the descendant `a :hover`.
    let branches = split_top_level_commas(selector)
        .iter()
        .map(|branch| branch.trim())
        .collect::<Vec<_>>()
        .join(", ");
    let subject = |nested: &Option<String>| match nested {
        Some(inner) => compose_selectors(&branches, inner),
        None => selector.to_string(),
    };
    if !resolved.declarations.is_empty() {
        rules.push(global_rule(selector, &resolved.declarations, 0));
    }
    for (nested, declarations) in &resolved.pseudo_selectors {
        if !declarations.is_empty() {
            rules.push(global_rule(&subject(&Some(nested.clone())), declarations, 0));
        }
    }
    let width = |bp: &str| breakpoints.breakpoints.get(bp).copied().unwrap_or(0);
    let mut by_width: Vec<&ConditionedGroup> = resolved
        .conditioned
        .iter()
        .filter(|g| matches!(g.conditions.as_slice(), [Condition::Breakpoint(_)]))
        .collect();
    by_width.sort_by_key(|g| match g.conditions.as_slice() {
        [Condition::Breakpoint(bp)] => (g.selector.is_some(), width(bp)),
        _ => (false, 0),
    });
    for group in by_width {
        let [Condition::Breakpoint(bp)] = group.conditions.as_slice() else {
            continue;
        };
        if let (Some(query), false) = (breakpoints.media_query(bp), group.declarations.is_empty()) {
            rules.push(global_conditioned_rule(&[query], &subject(&group.selector), &group.declarations));
        }
    }
    for group in resolved.conditioned_emission_order() {
        if group.declarations.is_empty() {
            continue;
        }
        let preludes: Option<Vec<String>> = group
            .conditions
            .iter()
            .map(|condition| match condition {
                Condition::Breakpoint(bp) => breakpoints.media_query(bp),
                other => other.prelude().map(str::to_string),
            })
            .collect();
        if let Some(preludes) = preludes.filter(|p| !p.is_empty()) {
            rules.push(global_conditioned_rule(&preludes, &subject(&group.selector), &group.declarations));
        }
    }
}

/// The global blocks that emit inside `anm-global`, in registration order.
pub fn resolve_all_global_blocks(
    blocks: &Value,
    ctx: &ResolveContext,
) -> String {
    resolve_global_blocks(blocks, ctx, false)
}

/// The global blocks registered `unlayered`, which emit outside every
/// cascade layer, in registration order.
pub fn resolve_unlayered_global_blocks(blocks: &Value, ctx: &ResolveContext) -> String {
    resolve_global_blocks(blocks, ctx, true)
}

fn resolve_global_blocks(blocks: &Value, ctx: &ResolveContext, unlayered: bool) -> String {
    let block_map = match blocks.as_object() {
        Some(o) => o,
        None => return String::new(),
    };

    let mut parts: Vec<String> = Vec::new();
    for (_name, block) in block_map {
        let (styles, faces, block_unlayered) = match block.as_object() {
            Some(obj)
                if obj.get("styles").map(|s| s.is_object()).unwrap_or(false)
                    && obj.keys().all(|k| k == "styles" || k == "fontFaces" || k == "unlayered") =>
            {
                (obj.get("styles").unwrap(), obj.get("fontFaces"), obj.get("unlayered") == Some(&Value::Bool(true)))
            }
            _ => (block, None, false),
        };
        if block_unlayered != unlayered {
            continue;
        }
        if let Some(faces) = faces {
            let css = render_font_faces(faces, ctx);
            if !css.is_empty() {
                parts.push(css);
            }
        }
        let css = resolve_global_block(styles, ctx);
        if !css.is_empty() {
            parts.push(css);
        }
    }

    parts.join("\n\n")
}

fn render_font_faces(faces: &Value, ctx: &ResolveContext) -> String {
    let list = match faces.as_array() {
        Some(l) => l,
        None => return String::new(),
    };
    let mut blocks: Vec<String> = Vec::new();
    for face in list {
        let obj = match face.as_object() {
            Some(o) => o,
            None => continue,
        };
        let family = match obj.get("family").and_then(|v| v.as_str()) {
            Some(f) => f,
            None => continue,
        };
        let srcs = match obj.get("src").and_then(|v| v.as_array()) {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };
        let family = resolve_token_aliases(
            family,
            ctx.theme,
            ctx.variable_map,
            ctx.contextual_vars,
        );
        let mut src_parts: Vec<String> = Vec::new();
        for entry in srcs {
            let entry = match entry.as_object() {
                Some(e) => e,
                None => continue,
            };
            let url = match entry.get("url").and_then(|v| v.as_str()) {
                Some(u) => u,
                None => continue,
            };
            match entry.get("format").and_then(|v| v.as_str()) {
                Some(fmt) => {
                    src_parts.push(format!("url('{url}') format('{fmt}')"))
                }
                None => src_parts.push(format!("url('{url}')")),
            }
        }
        if src_parts.is_empty() {
            continue;
        }
        let mut decls = vec![
            format!("font-family: {family};"),
            format!("src: {};", src_parts.join(", ")),
        ];
        for (key, css_name) in [
            ("style", "font-style"),
            ("weight", "font-weight"),
            ("stretch", "font-stretch"),
            ("display", "font-display"),
            ("unicodeRange", "unicode-range"),
        ] {
            if let Some(v) = obj.get(key).and_then(|v| v.as_str()) {
                decls.push(format!("{css_name}: {v};"));
            }
        }
        blocks.push(format!("@font-face {{ {} }}", decls.join(" ")));
    }
    blocks.join("\n")
}

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
        let decls = resolve_flat_styles(frame_obj, ctx);
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

    /// The runtime resolver keeps an identical predicate and pins these
    /// same resolved values; the source each one comes from is noted.
    #[test]
    fn a_value_reading_its_own_current_var_skips_the_write() {
        for (resolved, writes) in [
            ("var(--current-bg)", false),                                      // 'current-bg'
            ("color-mix(in srgb, var(--current-bg) 85%, transparent)", false), // '{colors.current-bg/85}'
            ("var(--current-bg, red)", false),
            ("var(--current-bg,red)", false),
            ("var( --current-bg )", false),
            ("VAR(--current-bg)", false),
            ("Var(\n  --current-bg ,red)", false),
            ("var(--current-bg /* c */)", false),
            ("var(/* c */ --current-bg\t,\x0cred)", false),
            ("var(\u{feff}--current-bg)", true),
            ("var(--current-bg\u{85})", true),
            ("var(--color-ink)", true),                                        // 'ink'
            ("#0af", true),
            ("var(--current-bg-alt)", true),
            ("var(--Current-bg)", true),
            ("var(--other, var(--current-bg))", false),
            ("VAR(--other, VAR(--current-bg))", false),
            ("var(--other, calc(var(--current-bg) + 1px))", false),
            (r"var(--\63 urrent-bg)", false),
            (r"var(--\000063urrent-bg)", false),
            (r"v\61r(--current-bg)", false),
            ("myvar(--current-bg)", true),
            ("myvar(var(--current-bg))", false),
            ("var(/**/--current-bg/**/, blue)", false),
            ("var/**/(--current-bg)", true),
            ("\"var(--current-bg)\" red", true),
            ("var(--current-bg, var(--other))", false),
            ("var(--other, var(--current-bg)) var(--current-bg)", false),
            ("calc(var(--other, 1px) + var(--current-bg))", false),
            ("var(--other, \"(\") var(--current-bg)", false),
            ("/* var(--current-bg) */ red", true),
        ] {
            assert_eq!(writes_current_var(resolved, "--current-bg"), writes, "{resolved}");
        }
    }

    fn test_config() -> PropConfigMap {
        let mut config = FxHashMap::default();
        config.insert(
            "p".to_string(),
            PropConfig {
                property: "padding".to_string(),
                properties: vec![],
                negative: false,
                scale: Some(Value::String("space".to_string())),
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
            "px".to_string(),
            PropConfig {
                property: "padding".to_string(),
                properties: vec!["paddingLeft".to_string(), "paddingRight".to_string()],
                negative: false,
                scale: Some(Value::String("space".to_string())),
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
            "py".to_string(),
            PropConfig {
                property: "padding".to_string(),
                properties: vec!["paddingTop".to_string(), "paddingBottom".to_string()],
                negative: false,
                scale: Some(Value::String("space".to_string())),
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
            "pl".to_string(),
            PropConfig {
                property: "paddingLeft".to_string(),
                properties: vec![],
                negative: false,
                scale: Some(Value::String("space".to_string())),
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
            "width".to_string(),
            PropConfig {
                property: "width".to_string(),
                properties: vec![],
                negative: false,
                scale: None,
                transform: Some("size".to_string()),
                transform_id: Some("size".to_string()),
                current_var: None,
                transform_fn_source: None,
                callback: None,
                strict: None,
                declaration: Default::default(),
            },
        );
        config.insert(
            "color".to_string(),
            PropConfig {
                property: "color".to_string(),
                properties: vec![],
                negative: false,
                scale: Some(Value::String("colors".to_string())),
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
        config.insert(
            "borderRadius".to_string(),
            PropConfig {
                property: "borderRadius".to_string(),
                properties: vec![],
                negative: false,
                scale: Some(Value::String("radii".to_string())),
                transform: Some("size".to_string()),
                transform_id: Some("size".to_string()),
                current_var: None,
                transform_fn_source: None,
                callback: None,
                strict: None,
                declaration: Default::default(),
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
                transform_failures: None,
                token_misses: None,
                dropped_keys: None,
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
        assert_eq!(resolved.pseudo_selectors[0].0, "&:hover");
        assert_eq!(resolved.pseudo_selectors[0].1[0].value, "var(--colors-primary)");
    }

    #[test]
    fn resolve_responsive() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "p": { "_": 8, "sm": 16 } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations.len(), 1);
        assert_eq!(resolved.declarations[0].value, "0.5rem");
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
    fn resolve_scale_with_transform_placeholder() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "borderRadius": 4 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "border-radius");
        assert_eq!(resolved.declarations[0].value, "__TRANSFORM__size__4px__");
    }

    fn resolve_with_failing_transform(source: &str) -> (ResolvedStyles, Vec<TransformFailure>) {
        let owner = TestCtxOwner::new();
        let evaluator = TransformEvaluator::new();
        evaluator.register("size", source).unwrap();
        let sink = TransformFailureSink::default();
        let mut ctx = owner.ctx();
        ctx.transform_evaluator = Some(&evaluator);
        ctx.transform_failures = Some(&sink);
        let styles = json!({ "width": 5 });
        let resolved = resolve_styles(&styles, &ctx, true);
        let failures = sink.borrow().clone();
        (resolved, failures)
    }

    #[test]
    fn object_transform_result_drops_declaration_and_records_invalid_shape() {
        let (resolved, failures) = resolve_with_failing_transform("(v) => ({ w: v })");
        assert!(resolved.declarations.is_empty(), "{:?}", resolved.declarations);
        assert_eq!(
            failures,
            vec![TransformFailure {
                transform_name: "size".to_string(),
                prop: "width".to_string(),
                failure: EvalError::InvalidResultShape { shape: "object".to_string() },
                variant_origin: None,
            }]
        );
    }

    #[test]
    fn nan_transform_result_drops_declaration_and_records_non_finite_shape() {
        let (resolved, failures) = resolve_with_failing_transform("(v) => NaN");
        assert!(resolved.declarations.is_empty(), "{:?}", resolved.declarations);
        assert_eq!(failures.len(), 1, "{:?}", failures);
        assert_eq!(
            failures[0].failure,
            EvalError::InvalidResultShape { shape: "non-finite-number".to_string() }
        );
    }

    #[test]
    fn throwing_transform_keeps_raw_value_fallback_and_records_throw() {
        let (resolved, failures) =
            resolve_with_failing_transform("(v) => { throw new Error('kaboom') }");
        assert_eq!(resolved.declarations.len(), 1, "{:?}", resolved.declarations);
        assert_eq!(resolved.declarations[0].property, "width");
        assert_eq!(resolved.declarations[0].value, "5");
        assert_eq!(failures.len(), 1, "{:?}", failures);
        assert_eq!(failures[0].transform_name, "size");
        assert_eq!(failures[0].prop, "width");
        match &failures[0].failure {
            EvalError::Throw { message } => {
                assert!(message.contains("kaboom"), "{}", message)
            }
            other => panic!("expected Throw, got {:?}", other),
        }
    }

    #[test]
    fn strict_scale_admission_matches_the_runtime_rule() {
        let mut owner = TestCtxOwner::new();
        let p = owner.config.get_mut("p").unwrap();
        p.strict = Some(true);
        p.negative = true;
        owner.contextual_vars.insert(
            "space".to_string(),
            vec![ContextualVar { name: "gutter".to_string(), var: "gutter".to_string() }],
        );
        let property = |name: &str| PropConfig { property: name.to_string(), ..owner.config["p"].clone() };
        let ctx = owner.ctx();
        let miss = |config: &PropConfig, value: Value| !strict_token_misses(config, &value, &ctx).is_empty();
        let p = &owner.config["p"];
        for admitted in [
            json!(8), json!(-8), json!("8"), json!(0), json!("0"), json!("inherit"),
            json!("-moz-initial"), json!("revert-layer"), json!("gutter"), json!("2cqi"),
            json!("-1.5cqmin"), json!("1e2cqi"), json!("{space.8}"), json!({ "_": 8, "sm": -16 }),
        ] {
            assert!(!miss(p, admitted.clone()), "{admitted} should be admitted");
        }
        for rejected in [
            json!(13), json!(-13), json!("2.5rem"), json!("var(--x)"), json!("#fff"),
            json!("-17"), json!("10px"), json!("lg"), json!("auto"), json!("1e2"),
            json!({ "_": 8, "sm": 13 }), json!({ "_": 8, "sm": "lg" }),
        ] {
            assert!(miss(p, rejected.clone()), "{rejected} should miss");
        }
        assert!(!miss(&property("margin"), json!("auto")));
        assert!(!miss(&property("color"), json!("currentColor")));
        assert!(miss(&property("color"), json!("currentcolor")));
        assert!(miss(&property("color"), json!("banana")));
        let width = property("maxWidth");
        for admitted in ["10px", "1e2px", ".5E-1rem", "calc(1px + 2px)", "fit-content"] {
            assert!(!miss(&width, json!(admitted)), "{admitted} should be admitted");
        }
        for rejected in ["min(1px, 2px)", "1.px", "0x10px", "1e2.5px", "stretch"] {
            assert!(miss(&width, json!(rejected)), "{rejected} should miss");
        }
        assert!(miss(&width, json!(12)));
        assert!(miss(&PropConfig { negative: false, ..p.clone() }, json!(-8)));
        assert!(!miss(&PropConfig { strict: Some(false), ..p.clone() }, json!(13)));
        assert!(!miss(&PropConfig { strict: None, ..p.clone() }, json!(13)));
        let empty = PropConfig { scale: Some(Value::String("sizes".to_string())), ..p.clone() };
        assert!(!miss(&empty, json!(13)));
        let array = PropConfig { scale: Some(json!([8, "auto-fit"])), negative: false, ..p.clone() };
        assert!(!miss(&array, json!("8")));
        assert!(!miss(&array, json!(8)));
        assert!(miss(&array, json!(16)));
    }

    #[test]
    fn strict_scale_miss_omits_every_entry_of_the_prop() {
        let mut owner = TestCtxOwner::new();
        owner.config.get_mut("p").unwrap().strict = Some(true);
        let sink = StrictTokenMissSink::default();
        let mut ctx = owner.ctx();
        ctx.token_misses = Some(&sink);
        let styles = json!({ "p": { "_": 8, "sm": 13 }, "px": 8, "&:hover": { "p": 13 } });
        let resolved = resolve_styles(&styles, &ctx, false);
        let all: Vec<&CssDeclaration> = resolved
            .declarations
            .iter()
            .chain(resolved.conditioned.iter().flat_map(|g| &g.declarations))
            .chain(resolved.pseudo_selectors.iter().flat_map(|(_, d)| d))
            .collect();
        assert!(all.iter().all(|d| d.property != "padding"), "{all:?}");
        assert!(all.iter().any(|d| d.property == "padding-left"), "{all:?}");
        let misses = sink.borrow();
        assert_eq!(
            misses.iter().map(|m| (m.prop.as_str(), m.rejected.clone())).collect::<Vec<_>>(),
            vec![
                ("p", vec![(Some("sm".to_string()), json!(13))]),
                ("p", vec![(None, json!(13))]),
            ]
        );
    }

    fn test_variable_map() -> VariableMap {
        map! {
            "colors.primary" => "--color-primary".to_string(),
            "colors.background" => "--color-background".to_string(),
            "colors.pink.600" => "--color-pink-600".to_string(),
        }
    }

    #[test]
    fn dot_path_conversion() {
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
        assert_eq!(resolved.pseudo_selectors[0].0, "&:hover");
        assert_eq!(resolved.pseudo_selectors[0].1[0].value, "var(--colors-primary)");
    }

    #[test]
    fn resolve_selector_alias_disabled_compound() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({ "_disabled": { "p": 8 } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
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
        assert_eq!(resolved.pseudo_selectors[0].0, "&::before");
        assert_eq!(resolved.pseudo_selectors[0].1[0].property, "content");
        assert_eq!(resolved.pseudo_selectors[0].1[0].value, "\"\"");
        assert_eq!(resolved.pseudo_selectors[0].1[1].property, "display");
    }

    #[test]
    fn resolve_after_explicit_content_no_autodefault() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({ "_after": { "content": "\"→\"", "display": "block" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let content_count = resolved.pseudo_selectors[0].1.iter().filter(|d| d.property == "content").count();
        assert_eq!(content_count, 1);
        assert_eq!(resolved.pseudo_selectors[0].1.iter().find(|d| d.property == "content").unwrap().value, "\"→\"");
    }

    #[test]
    fn raw_before_no_content_autodefault() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({ "&::before": { "display": "block" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let has_content = resolved.pseudo_selectors[0].1.iter().any(|d| d.property == "content");
        assert!(!has_content, "Raw &::before should not auto-inject content");
    }

    #[test]
    fn merge_alias_and_raw_same_selector() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({
            "_hover": { "color": "primary" },
            "&:hover": { "p": 8 }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 1);
        assert_eq!(resolved.pseudo_selectors[0].0, "&:hover");
        assert!(resolved.pseudo_selectors[0].1.iter().any(|d| d.property == "color"));
        assert!(resolved.pseudo_selectors[0].1.iter().any(|d| d.property == "padding"));
    }

    #[test]
    fn unknown_alias_key_ignored() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({ "_groupHover": { "color": "primary" }, "p": 8 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.pseudo_selectors.len(), 0);
        assert_eq!(resolved.declarations.len(), 1);
    }

    #[test]
    fn variant_level_before_no_content_autodefault() {
        let owner = TestCtxOwner::new().with_aliases();
        let styles = json!({ "_before": { "color": "primary" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), false);
        let has_content = resolved.pseudo_selectors[0].1.iter().any(|d| d.property == "content");
        assert!(!has_content, "Variant-level _before should not auto-inject content");
    }

    #[test]
    fn prop_cascade_tier_ordering() {
        let config = test_config();
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
        let px_tier = prop_cascade_tier("px", &config);
        let py_tier = prop_cascade_tier("py", &config);
        assert_eq!(px_tier, py_tier, "px and py should have equal cascade tier");
    }

    #[test]
    fn shorthand_before_longhand_in_resolve() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "px": 16, "pl": 8 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);

        assert_eq!(resolved.declarations.len(), 3);

        let pl_positions: Vec<usize> = resolved.declarations.iter()
            .enumerate()
            .filter(|(_, d)| d.property == "padding-left")
            .map(|(i, _)| i)
            .collect();
        assert_eq!(pl_positions.len(), 2, "should have two padding-left declarations");

        assert_eq!(resolved.declarations[pl_positions[0]].value, "1rem");
        assert_eq!(resolved.declarations[pl_positions[1]].value, "0.5rem");
    }

    #[test]
    fn shorthand_before_longhand_reversed_source_order() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "pl": 8, "px": 16 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);

        assert_eq!(resolved.declarations.len(), 3);
        assert_eq!(resolved.declarations[0].property, "padding-left");
        assert_eq!(resolved.declarations[0].value, "1rem");
        assert_eq!(resolved.declarations[1].property, "padding-right");
        assert_eq!(resolved.declarations[1].value, "1rem");
        assert_eq!(resolved.declarations[2].property, "padding-left");
        assert_eq!(resolved.declarations[2].value, "0.5rem");
    }

    #[test]
    fn true_shorthand_before_multi_target_before_longhand() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "pl": 8, "px": 16, "p": 24 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);

        assert_eq!(resolved.declarations[0].property, "padding");
        assert_eq!(resolved.declarations[0].value, "1.5rem");
        assert_eq!(resolved.declarations[1].property, "padding-left");
        assert_eq!(resolved.declarations[1].value, "1rem");
        assert_eq!(resolved.declarations[2].property, "padding-right");
        assert_eq!(resolved.declarations[2].value, "1rem");
        assert_eq!(resolved.declarations[3].property, "padding-left");
        assert_eq!(resolved.declarations[3].value, "0.5rem");
    }

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
    fn color_family_pass_through_at_top_level_resolves() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "outlineColor": "primary" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "outline-color");
        assert_eq!(resolved.declarations[0].value, "var(--colors-primary)");
    }

    #[test]
    fn background_color_pass_through_resolves_at_top_level() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "backgroundColor": "primary" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "background-color");
        assert_eq!(resolved.declarations[0].value, "var(--colors-primary)");
    }

    #[test]
    fn background_color_non_token_value_passes_through_literally() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "backgroundColor": "rgb(1 2 3)" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "background-color");
        assert_eq!(resolved.declarations[0].value, "rgb(1 2 3)");
    }

    #[test]
    fn font_faces_render_ahead_of_selector_rules_in_wrapped_blocks() {
        let owner = TestCtxOwner::new();
        let blocks = json!({
            "globals": {
                "styles": { "body": { "color": "red" } },
                "fontFaces": [{
                    "family": "Inter",
                    "src": [{ "url": "/fonts/inter.woff2", "format": "woff2" }],
                    "weight": "100 900",
                    "display": "swap"
                }]
            }
        });
        let css = resolve_all_global_blocks(&blocks, &owner.ctx());
        let face = css.find("@font-face").expect("font-face rendered");
        let rule = css.find("body").expect("selector rule rendered");
        assert!(face < rule, "font-face must precede selector rules:\n{css}");
        assert!(css.contains(
            "@font-face { font-family: Inter; src: url('/fonts/inter.woff2') format('woff2'); font-weight: 100 900; font-display: swap; }"
        ), "unexpected font-face rendering:\n{css}");
    }

    #[test]
    fn font_face_urls_pass_through_byte_exact() {
        let owner = TestCtxOwner::new();
        let blocks = json!({
            "globals": {
                "styles": {},
                "fontFaces": [{
                    "family": "Inter",
                    "src": [{ "url": "./assets/inter.woff2" }]
                }]
            }
        });
        let css = resolve_all_global_blocks(&blocks, &owner.ctx());
        assert!(css.contains("src: url('./assets/inter.woff2');"));
    }

    #[test]
    fn font_face_asset_placeholder_passes_through_byte_exact() {
        let owner = TestCtxOwner::new();
        let blocks = json!({
            "globals": {
                "styles": {},
                "fontFaces": [{
                    "family": "Inter",
                    "src": [{
                        "url": "animus-asset:@acme/tokens/fonts/inter.woff2",
                        "format": "woff2"
                    }]
                }]
            }
        });
        let css = resolve_all_global_blocks(&blocks, &owner.ctx());
        assert!(
            css.contains(
                "src: url('animus-asset:@acme/tokens/fonts/inter.woff2') format('woff2');"
            ),
            "placeholder must survive byte-exact:\n{css}"
        );
    }

    #[test]
    fn font_face_family_resolves_font_scale_token() {
        let mut owner = TestCtxOwner::new();
        owner
            .theme
            .insert("fonts.body".to_string(), "Inter, sans-serif".to_string());
        let blocks = json!({
            "globals": {
                "styles": {},
                "fontFaces": [{
                    "family": "{fonts.body}",
                    "src": [{ "url": "/fonts/inter.woff2" }]
                }]
            }
        });
        let css = resolve_all_global_blocks(&blocks, &owner.ctx());
        assert!(
            css.contains("font-family: Inter, sans-serif;"),
            "family token unresolved:\n{css}"
        );
    }

    #[test]
    fn legacy_bare_selector_map_blocks_resolve_unchanged() {
        let owner = TestCtxOwner::new();
        let wrapped = json!({
            "globals": { "styles": { "body": { "color": "red" } }, "fontFaces": [] }
        });
        let legacy = json!({ "globals": { "body": { "color": "red" } } });
        let wrapped_css = resolve_all_global_blocks(&wrapped, &owner.ctx());
        let legacy_css = resolve_all_global_blocks(&legacy, &owner.ctx());
        assert_eq!(wrapped_css, legacy_css);
        assert!(!legacy_css.contains("@font-face"));
    }

    #[test]
    fn dotted_literal_on_non_color_prop_stays_untouched() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "fontFamily": "brand.sans" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "font-family");
        assert_eq!(resolved.declarations[0].value, "brand.sans");
    }

    #[test]
    fn color_family_pass_through_resolves_in_responsive_slot() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "outlineColor": { "_": "primary", "sm": "background" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations[0].property, "outline-color");
        assert_eq!(resolved.declarations[0].value, "var(--colors-primary)");
        let sm: Vec<(&String, &Vec<CssDeclaration>)> = resolved.breakpoint_groups().collect();
        assert_eq!(sm.len(), 1);
        assert_eq!(sm[0].0, "sm");
        assert_eq!(sm[0].1[0].property, "outline-color");
        assert_eq!(sm[0].1[0].value, "var(--colors-background)");
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

    fn only_cond(resolved: &ResolvedStyles) -> &ConditionedGroup {
        assert_eq!(resolved.conditioned.len(), 1, "expected one conditioned group");
        &resolved.conditioned[0]
    }

    #[test]
    fn raw_container_block_resolves_kind_and_prelude() {
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
        let owner = TestCtxOwner::new();
        let styles = json!({ "@container card (min-width: 400px)": { "display": "grid" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions[0].prelude(), Some("@container card (min-width: 400px)"));
        assert_eq!(g.declarations[0].value, "grid");
    }

    #[test]
    fn container_unit_transits_pass_through_verbatim() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "@container card (min-width: 400px)": { "width": "50cqw" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.declarations[0].property, "width");
        assert_eq!(g.declarations[0].value, "__TRANSFORM__size__50cqw__");
    }

    #[test]
    fn empty_container_block_emits_no_group() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "@container (min-width: 400px)": {} });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.conditioned.is_empty());
    }

    #[test]
    fn raw_media_feature_block_resolves() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "@media (prefers-reduced-motion: reduce)": { "display": "none" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions, vec![Condition::Media("@media (prefers-reduced-motion: reduce)".to_string())]);
        assert_eq!(g.declarations[0].value, "none");
    }

    #[test]
    fn raw_supports_block_resolves_tokens_and_shorthands() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "@supports (display: grid)": { "color": "primary", "p": 8 } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions, vec![Condition::Supports("@supports (display: grid)".to_string())]);
        assert!(g.declarations.iter().any(|d| d.property == "color" && d.value == "var(--colors-primary)"));
        assert!(g.declarations.iter().any(|d| d.property == "padding" && d.value == "0.5rem"));
    }

    #[test]
    fn unknown_at_rule_prefix_ignored() {
        let owner = TestCtxOwner::new();
        let styles = json!({ "@containr card (min-width: 400px)": { "p": 8 }, "p": 4 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.conditioned.is_empty());
        assert_eq!(resolved.declarations.len(), 1);
    }

    #[test]
    fn registered_media_alias_resolves() {
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
        let owner = TestCtxOwner::new().with_conditions();
        let styles = json!({ "_cardSm": { "display": "grid" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        let g = only_cond(&resolved);
        assert_eq!(g.conditions, vec![Condition::Container("@container card (min-width: 400px)".to_string())]);
        assert!(matches!(g.emit_order, ConditionEmitOrder::Aliased(510)));
    }

    #[test]
    fn registered_supports_alias_resolves() {
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
        let styles = json!({ "_notRegistered": { "p": 8 }, "p": 4 });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.conditioned.is_empty());
        assert_eq!(resolved.declarations.len(), 1);
    }

    #[test]
    fn selector_alias_wins_over_condition_alias_same_name() {
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
        let owner = TestCtxOwner::new().with_conditions();
        let styles = json!({ "p": { "_motionReduce": 12 } });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.conditioned.is_empty());
    }

    #[test]
    fn container_establishment_longhands_emit_as_pass_through_declarations() {
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
        let owner = TestCtxOwner::new();
        let styles = json!({ "container": "card / inline-size" });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert_eq!(resolved.declarations.len(), 1);
        assert_eq!(resolved.declarations[0].property, "container");
        assert_eq!(resolved.declarations[0].value, "card / inline-size");
    }

    #[test]
    fn condition_emission_order_alias_before_raw_and_by_registry() {
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
        assert!(matches!(ordered[0].emit_order, ConditionEmitOrder::Aliased(500)));
        assert!(matches!(ordered[1].emit_order, ConditionEmitOrder::Aliased(510)));
        assert_eq!(ordered[2].conditions[0].prelude(), Some("@supports (display: grid)"));
        assert_eq!(ordered[3].conditions[0].prelude(), Some("@container (min-width: 400px)"));
    }

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
        let hover: Vec<_> = resolved.pseudo_selectors.iter().filter(|(s, _)| s == "&:hover::before").collect();
        assert_eq!(hover.len(), 1, "composed :hover::before entry: {:?}", resolved.pseudo_selectors);
        assert_eq!(hover[0].1[0].property, "content");
        assert!(hover[0].1.iter().any(|d| d.property == "opacity" && d.value == "1"));
        let hi = resolved.pseudo_selectors.iter().position(|(s, _)| s == "&:hover::before").unwrap();
        let ai = resolved.pseudo_selectors.iter().position(|(s, _)| s == "&:active::before").unwrap();
        assert!(hi < ai);
        assert!(!resolved.pseudo_selectors.iter().any(|(s, d)| s == "&:hover" && d.iter().any(|x| x.property == "opacity")));
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
        assert!(resolved.pseudo_selectors.iter().any(|(s, d)| s == "& .icon:hover" && d[0].value == "var(--colors-primary)"));
        assert!(resolved.pseudo_selectors.iter().any(|(s, _)| s == "&:hover .icon2"));
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
        assert_eq!(container.selector.as_deref(), Some("&:hover"));
        assert_eq!(container.declarations[0].value, "1rem");
        let supports = resolved.conditioned.iter().find(|g| matches!(g.conditions.as_slice(), [Condition::Supports(_)])).unwrap();
        assert_eq!(supports.selector.as_deref(), Some("&:hover"));
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
        assert!(resolved.pseudo_selectors.iter().any(|(s, d)| s == "&:hover" && d[0].value == "0.5rem"));
        let groups: Vec<_> = resolved.breakpoint_selector_groups().collect();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].0, "sm");
        assert_eq!(groups[0].1, "&:hover");
        assert_eq!(groups[0].2[0].value, "1rem");
    }

    #[test]
    fn split_top_level_commas_tracks_depth_and_quotes() {
        assert_eq!(split_top_level_commas(":hover,:focus"), vec![":hover", ":focus"]);
        assert_eq!(
            split_top_level_commas(":is(:focus-visible, [data-focus-visible])"),
            vec![":is(:focus-visible, [data-focus-visible])"]
        );
        assert_eq!(
            split_top_level_commas("[data-label=\"a,b\"]"),
            vec!["[data-label=\"a,b\"]"]
        );
        assert_eq!(
            split_top_level_commas("[data-label='a,b'],x"),
            vec!["[data-label='a,b']", "x"]
        );
        assert_eq!(
            split_top_level_commas(":has(+ [data-part=\"trailing\"]),:last-child"),
            vec![":has(+ [data-part=\"trailing\"])", ":last-child"]
        );
        assert_eq!(split_top_level_commas("a\\,b"), vec!["a\\,b"]);
        assert_eq!(split_top_level_commas(""), vec![""]);
        assert_eq!(split_top_level_commas("a,"), vec!["a", ""]);
    }

    #[test]
    fn split_top_level_commas_swallows_the_tail_of_unbalanced_input() {
        assert_eq!(split_top_level_commas("[a=\"x,y"), vec!["[a=\"x,y"]);
        assert_eq!(split_top_level_commas(":is(a,b"), vec![":is(a,b"]);
        assert_eq!(split_top_level_commas("a\\"), vec!["a\\"]);
        assert_eq!(split_top_level_commas("a),b"), vec!["a)", "b"]);
    }

    #[test]
    fn first_top_level_branch_matches_the_full_split() {
        for input in [
            ":hover,:focus",
            ":is(:hover, [data-disabled]),x",
            " p + ul, ul + p",
            "[data-label=\"a,b\"]",
            "",
            "a,",
            "[a=\"x,y",
        ] {
            assert_eq!(
                first_top_level_branch(input),
                split_top_level_commas(input)[0],
                "input: {input:?}"
            );
        }
    }

    #[test]
    fn normalize_pseudo_selector_keeps_descendant_combinators() {
        assert_eq!(
            normalize_pseudo_selector("& p + ul, & ul + p"),
            "& p + ul,& ul + p"
        );
        assert_eq!(normalize_pseudo_selector("& strong, & b"), "& strong,& b");
        assert_eq!(
            normalize_pseudo_selector("& tr > *:last-child, & tr > *:has(+ [data-part=\"trailing\"])"),
            "& tr > *:last-child,& tr > *:has(+ [data-part=\"trailing\"])"
        );
    }

    #[test]
    fn normalize_pseudo_selector_ampersand_adjacent_list_has_no_artifact_space() {
        assert_eq!(
            normalize_pseudo_selector("&:hover, &[data-x]"),
            "&:hover,&[data-x]"
        );
        assert_eq!(
            normalize_pseudo_selector("&:disabled, &[disabled]"),
            "&:disabled,&[disabled]"
        );
        assert_eq!(
            normalize_pseudo_selector(
                "&:disabled, &[disabled], &[aria-disabled=\"true\"], &[data-disabled]"
            ),
            "&:disabled,&[disabled],&[aria-disabled=\"true\"],&[data-disabled]"
        );
    }

    #[test]
    fn normalize_pseudo_selector_preserves_functional_and_quoted_commas() {
        assert_eq!(
            normalize_pseudo_selector("& [data-part=\"add-row\"] :is(:focus-visible, [data-focus-visible])"),
            "& [data-part=\"add-row\"] :is(:focus-visible, [data-focus-visible])"
        );
        assert_eq!(
            normalize_pseudo_selector("&[data-pinned]:is([data-active=\"true\"], [data-mode=\"edit\"])"),
            "&[data-pinned]:is([data-active=\"true\"], [data-mode=\"edit\"])"
        );
        assert_eq!(
            normalize_pseudo_selector("&[data-label=\"a,b\"]"),
            "&[data-label=\"a,b\"]"
        );
    }

    #[test]
    fn compose_selectors_does_not_cartesian_functional_arguments() {
        assert_eq!(
            compose_selectors("&:hover", "& .x:is(a, b)"),
            "&:hover .x:is(a, b)"
        );
        assert_eq!(
            compose_selectors("&:hover,&:focus", "& .a, & .b"),
            "&:hover .a,&:focus .a,&:hover .b,&:focus .b"
        );
        assert_eq!(
            compose_selectors("& .icon", "&:hover"),
            "& .icon:hover"
        );
    }

    #[test]
    fn nested_depth_eight_composes_without_loss() {
        let owner = TestCtxOwner::new();
        let styles = json!({
            "&:a1": { "&:a2": { "&:a3": { "&:a4": { "&:a5": { "&:a6": { "&:a7": { "&:a8": { "color": "primary" } } } } } } } }
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), true);
        assert!(resolved.pseudo_selectors.iter().any(|(s, d)| s == "&:a1:a2:a3:a4:a5:a6:a7:a8" && d[0].value == "var(--colors-primary)"));
    }

    /// `tone` is declared under a prefix; `acme-tone` is declared too, so it
    /// is never an alias; `gap`'s final spelling `acme-gap` is. The theme's
    /// `colors.brand` already holds a final name, as system load leaves it.
    fn prefixed_owner() -> TestCtxOwner {
        let mut owner = TestCtxOwner::new();
        owner.contextual_vars = serde_json::from_str(
            r#"{"colors":[{"name":"tone","var":"acme-tone"},{"name":"acme-tone","var":"acme-acme-tone"}],
                "space":[{"name":"gap","var":"acme-gap"}]}"#,
        )
        .unwrap();
        owner.theme.insert("colors.brand".into(), "var(--acme-tone, red)".into());
        let base = owner.config["color"].clone();
        owner.config.insert(
            "tint".into(),
            PropConfig { property: "--tone".into(), current_var: Some("--tone".into()), ..base },
        );
        owner
    }

    fn declarations_of(resolved: &ResolvedStyles) -> Vec<String> {
        resolved.declarations.iter().map(|d| format!("{}: {}", d.property, d.value)).collect()
    }

    #[test]
    fn declared_names_take_their_final_name_wherever_they_are_written() {
        let owner = prefixed_owner();
        let styles = json!({
            "color": "tone",
            "p": "acme-gap",
            "outlineColor": "tone",
            "caretColor": "brand",
            "--tone": "red",
            "--acme-tone": "blue",
            "--other": "var(--tone, var(--gap, 1px))",
            "transition": "--tone 1s, --other 2s",
            "content": "\"var(--tone)\"",
            "tint": "red",
            "--mix": "{colors.brand}",
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), false);
        let declarations = declarations_of(&resolved);
        for expected in [
            "color: var(--acme-tone)",
            "padding: var(--acme-gap)",
            "outline-color: var(--acme-tone)",
            "caret-color: var(--acme-tone, red)",
            "--acme-tone: red",
            "--acme-acme-tone: blue",
            "--other: var(--acme-tone, var(--acme-gap, 1px))",
            "transition: --acme-tone 1s, --other 2s",
            "content: \"var(--tone)\"",
            "--mix: var(--acme-tone, red)",
        ] {
            assert!(declarations.iter().any(|d| d == expected), "missing `{expected}` in {declarations:#?}");
        }
        assert!(
            !declarations.iter().any(|d| d.starts_with("--tone") || d.contains("acme-acme-acme")),
            "{declarations:#?}"
        );
        assert!(declarations.iter().any(|d| d == "--acme-tone: red"), "{declarations:#?}");
    }

    #[test]
    fn a_strict_scale_admits_the_declared_and_the_final_spelling() {
        let mut owner = prefixed_owner();
        owner.config.get_mut("p").unwrap().strict = Some(true);
        let ctx = owner.ctx();
        let p = &owner.config["p"];
        for admitted in [json!("gap"), json!("acme-gap")] {
            assert!(strict_token_misses(p, &admitted, &ctx).is_empty(), "{admitted}");
        }
        assert!(!strict_token_misses(p, &json!("acme-acme-gap"), &ctx).is_empty());
    }

    #[test]
    fn a_style_query_names_the_final_property() {
        let owner = prefixed_owner();
        let styles = json!({ "@container style(--tone: dark)": { "--gap": "2px" } });
        let resolved = resolve_styles(&styles, &owner.ctx(), false);
        let group = &resolved.conditioned[0];
        assert_eq!(group.conditions, [Condition::Container("@container style(--acme-tone: dark)".into())]);
        assert_eq!(group.declarations[0].property, "--acme-gap");
    }

    #[test]
    fn a_keyframe_sets_the_final_property() {
        let owner = prefixed_owner();
        let block = json!({ "name": "pulse", "frames": { "to": { "--tone": "var(--gap)" } } });
        assert_eq!(
            resolve_keyframes_block(&block, &owner.ctx()),
            "@keyframes pulse {\n  to {\n    --acme-tone: var(--acme-gap);\n  }\n}"
        );
    }

    #[test]
    fn the_legacy_string_form_resolves_exactly_as_before() {
        let mut owner = TestCtxOwner::new();
        owner.contextual_vars = serde_json::from_str(r#"{"colors":["tone"],"space":["gap"]}"#).unwrap();
        let styles = json!({
            "color": "tone",
            "p": "gap",
            "--tone": "red",
            "--other": "var(--tone, var(--gap, 1px))",
            "transition": "--tone 1s",
            "@container style(--tone: dark)": { "--gap": "2px" },
        });
        let resolved = resolve_styles(&styles, &owner.ctx(), false);
        assert_eq!(
            declarations_of(&resolved),
            [
                "padding: var(--gap)",
                "color: var(--tone)",
                "--tone: red",
                "--other: var(--tone, var(--gap, 1px))",
                "transition: --tone 1s",
            ]
        );
        assert_eq!(
            resolved.conditioned[0].conditions,
            [Condition::Container("@container style(--tone: dark)".into())]
        );
    }
}
