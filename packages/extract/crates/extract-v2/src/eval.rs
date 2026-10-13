//! Stage-argument evaluation into JSON values, with per-property skips for
//! non-static values and captured `transform` functions.

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, Declaration, Expression, ObjectExpression, ObjectPropertyKind,
    Program, PropertyKey, PropertyKind, Statement, UnaryOperator, VariableDeclarationKind,
};
use oxc::span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::Value;

use crate::flow::{Known, ObjectId, ReasonId, Region, RegionAtom, Uncertainty};
use crate::static_value::{StaticNumber, StaticValue, Unevaluated, UnevaluatedKind};

#[derive(Debug)]
pub struct BailError {
    pub kind: UnevaluatedKind,
    pub reason: String,
}

impl BailError {
    fn new(kind: UnevaluatedKind, reason: impl Into<String>) -> Self {
        Self {
            kind,
            reason: reason.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SkippedProperty {
    pub key: String,
    /// What evaluation could not settle there.
    pub kind: UnevaluatedKind,
    pub reason: String,
    /// Key path of the nested object holding `key`, relative to the
    /// evaluated object; `None` at its top level.
    pub parent: Option<String>,
    /// Source span of what was skipped: the value, or the key when the key
    /// itself is unsupported.
    pub span: Option<(u32, u32)>,
}

fn span_of(span: Span) -> Option<(u32, u32)> {
    Some((span.start, span.end))
}

pub const SELECTOR_UNSUPPORTED_SUBJECT: &str = "animus.selector.unsupported-subject";

pub const KEYFRAMES_UNREGISTERED_REFERENCE: &str = "animus.keyframes.unregistered-reference";

/// A selector key whose `&` lies only in quoted text. An at-rule key is no
/// selector, even with `&` in its prelude.
pub(crate) fn unsupported_selector_key(key: &str) -> bool {
    !key.starts_with('@') && key.contains('&') && !crate::selector_subject::has_subject(key)
}

fn unsupported_selector_skip(key: &str, span: Span) -> SkippedProperty {
    SkippedProperty {
        key: key.to_string(),
        kind: UnevaluatedKind::Selector,
        reason: format!(
            "selector '{key}' has no substitutable '&' subject outside quoted text ({SELECTOR_UNSUPPORTED_SUBJECT})"
        ),
        parent: None,
        span: span_of(span),
    }
}

#[derive(Debug, Clone)]
pub struct CapturedTransform {
    pub key: String,
    pub span: Span,
}

pub fn eval_object_expr(
    obj: &ObjectExpression<'_>,
) -> Result<(StaticValue, Vec<SkippedProperty>, Vec<CapturedTransform>), BailError> {
    eval_object_expr_with_statics(obj, None)
}

pub fn eval_object_expr_with_statics(
    obj: &ObjectExpression<'_>,
    static_values: Option<Statics<'_>>,
) -> Result<(StaticValue, Vec<SkippedProperty>, Vec<CapturedTransform>), BailError> {
    eval_object_expr_scoped(obj, static_values, false)
}

fn eval_object_expr_scoped(
    obj: &ObjectExpression<'_>,
    static_values: Option<Statics<'_>>,
    keyframes_eligible: bool,
) -> Result<(StaticValue, Vec<SkippedProperty>, Vec<CapturedTransform>), BailError> {
    let mut map = StaticValue::Object(Vec::new());
    let mut skipped = Vec::new();
    let mut captured = Vec::new();
    // Keys a spread overwrote with an unevaluated node: each keeps its position
    // until a later known write fills it, and is dropped if none does.
    let mut tombstones = FxHashSet::default();

    for prop_kind in &obj.properties {
        match prop_kind {
            ObjectPropertyKind::ObjectProperty(prop) => {
                if prop.kind != PropertyKind::Init {
                    return Err(BailError::new(UnevaluatedKind::Accessor, "getter/setter in style object"));
                }
                let key = if prop.computed {
                    computed_key(&prop.key, static_values)?
                } else {
                    eval_property_key(&prop.key)?
                };
                // Eligibility is inherited by nested blocks, so only positions under
                // `animationName`/`animation` mint the unregistered-reference code.
                // `animation` is in because the shorthand can embed a keyframe name;
                // the kebab spellings sit outside the typed keyframe surface.
                let eligible = keyframes_eligible
                    || matches!(key.as_str(), "animationName" | "animation");

                // Without a coded skip, theme resolution drops the rule
                // silently.
                if unsupported_selector_key(&key) {
                    skipped.push(unsupported_selector_skip(&key, prop.key.span()));
                    continue;
                }

                let value = crate::chain_walk::unwrap_type_assertions(&prop.value);
                if key == "transform" {
                    match value {
                        Expression::ArrowFunctionExpression(arrow) => {
                            captured.push(CapturedTransform {
                                key: key.clone(),
                                span: arrow.span,
                            });
                            continue;
                        }
                        Expression::FunctionExpression(func) => {
                            captured.push(CapturedTransform {
                                key: key.clone(),
                                span: func.span,
                            });
                            continue;
                        }
                        _ => {}
                    }
                }

                if let Expression::ObjectExpression(inner_obj) = value {
                    match eval_object_expr_scoped(inner_obj, static_values, eligible) {
                        Ok((value, inner_skips, inner_captured)) => {
                            skipped.extend(inner_skips.into_iter().map(|mut skip| {
                                skip.parent = Some(match skip.parent {
                                    Some(parent) => format!("{}.{}", key, parent),
                                    None => key.clone(),
                                });
                                skip
                            }));
                            for mut cap in inner_captured {
                                cap.key = format!("{}.{}", key, cap.key);
                                captured.push(cap);
                            }
                            tombstones.remove(&key);
                            map.insert(&key, value);
                        }
                        Err(bail) => {
                            skipped.push(SkippedProperty {
                                key,
                                kind: bail.kind,
                                reason: bail.reason,
                                parent: None,
                                span: span_of(inner_obj.span),
                            });
                        }
                    }
                    continue;
                }

                match eval_expression_scoped(
                    &prop.value,
                    &mut skipped,
                    static_values,
                    eligible,
                ) {
                    Ok(value) => {
                        tombstones.remove(&key);
                        map.insert(&key, value);
                    }
                    Err(bail) => {
                        skipped.push(SkippedProperty {
                            key,
                            kind: bail.kind,
                            reason: bail.reason,
                            parent: None,
                            span: span_of(prop.value.span()),
                        });
                    }
                }
            }
            ObjectPropertyKind::SpreadProperty(spread) => {
                // A stable static object spreads in authored order: a later
                // key overrides an earlier one and keeps its first position.
                // A lost key overrides too, so no earlier value stands for it.
                let mut spread_value = static_object_at(&spread.argument, static_values)?;
                for (mut path, unevaluated) in take_unevaluated_segments(&mut spread_value) {
                    let key = path.pop().unwrap_or_default();
                    if path.is_empty() {
                        map.insert(&key, StaticValue::Null);
                        tombstones.insert(key.clone());
                    }
                    skipped.push(SkippedProperty {
                        key,
                        kind: unevaluated.kind,
                        reason: unevaluated.clause,
                        parent: (!path.is_empty()).then(|| path.join(".")),
                        span: span_of(spread.span),
                    });
                }
                if let StaticValue::Object(entries) = spread_value {
                    for (key, value) in entries {
                        tombstones.remove(&key);
                        map.insert(&key, value);
                    }
                }
            }
        }
    }

    if let StaticValue::Object(entries) = &mut map {
        entries.retain(|(key, _)| !tombstones.contains(key));
    }
    Ok((map, skipped, captured))
}

/// A computed key whose value is a constant string: a string or an
/// expression-free template literal, or a static binding or member that
/// holds a string. A key read from an unevaluated node bails with its reason.
fn computed_key(
    key: &PropertyKey<'_>,
    static_values: Option<Statics<'_>>,
) -> Result<String, BailError> {
    let unsupported = || BailError::new(UnevaluatedKind::ComputedKey, "computed property key in style object");
    let expr = key.as_expression().ok_or_else(unsupported)?;
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::StringLiteral(lit) => Ok(lit.value.to_string()),
        Expression::TemplateLiteral(tpl) if tpl.expressions.is_empty() => tpl
            .quasis
            .first()
            .and_then(|quasi| quasi.value.cooked)
            .map(|cooked| cooked.to_string())
            .ok_or_else(unsupported),
        other => {
            let statics = static_values.ok_or_else(unsupported)?;
            if let Some(reason) = expression_clause(other, statics) {
                return Err(BailError::new(UnevaluatedKind::ComputedKey, format!("computed property key in style object — {reason}")));
            }
            match static_path_value(other, statics) {
                Some(StaticValue::String(text)) => Ok(text.clone()),
                _ => Err(unsupported()),
            }
        }
    }
}

/// The static value an identifier, or a member path from one, names:
/// `preset`, `presets.pixel`, `presets['pixel']`. `None` for anything else,
/// for an unsettled binding or the `asset` function, and for a member an
/// unevaluated node stands for.
pub(crate) fn static_path_value<'v>(expr: &Expression<'_>, static_values: Statics<'v>) -> Option<&'v StaticValue> {
    let member_of = |parent: &'v StaticValue, key: &str| {
        parent.get(key).filter(|value| !matches!(value, StaticValue::Unevaluated(_)))
    };
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::Identifier(ident) => match static_value(static_values, ident.name.as_str(), &[])? {
            Known::Exact(StaticValue::AssetFunction { .. }) => None,
            Known::Exact(value) => Some(value),
            Known::Finite(_) | Known::Uncertain(_) => None,
        },
        Expression::StaticMemberExpression(member) => {
            member_of(static_path_value(&member.object, static_values)?, member.property.name.as_str())
        }
        Expression::ComputedMemberExpression(member) => {
            let key = match crate::chain_walk::unwrap_type_assertions(&member.expression) {
                Expression::StringLiteral(lit) => lit.value.to_string(),
                other => static_path_value(other, static_values)?.as_str()?.to_string(),
            };
            member_of(static_path_value(&member.object, static_values)?, &key)
        }
        _ => None,
    }
}

/// The clause a diagnostic gives for an identifier or member path that
/// names no static value: its binding is unsettled, or it meets an
/// unevaluated node. Diagnostics only: no decision reads it.
fn expression_clause<'v>(expr: &Expression<'_>, static_values: Statics<'v>) -> Option<&'v str> {
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::Identifier(ident) => uncertain_clause(static_values, ident.name.as_str(), &[]),
        Expression::StaticMemberExpression(member) => expression_clause(&member.object, static_values).or_else(|| {
            match static_path_value(&member.object, static_values)?.get(member.property.name.as_str())? {
                StaticValue::Unevaluated(unevaluated) => Some(unevaluated.clause.as_str()),
                _ => None,
            }
        }),
        Expression::ComputedMemberExpression(member) => expression_clause(&member.object, static_values)
            .or_else(|| expression_clause(&member.expression, static_values)),
        _ => None,
    }
}

/// The static object a spread argument names, or why it names none. An
/// unsettled object names the use that may change it.
fn static_object_at(
    expr: &Expression<'_>,
    static_values: Option<Statics<'_>>,
) -> Result<StaticValue, BailError> {
    if let Some(reason) = static_values.and_then(|sv| expression_clause(expr, sv)) {
        return Err(BailError::new(UnevaluatedKind::Spread, format!("spread of {reason}")));
    }
    match static_values.and_then(|sv| static_path_value(expr, sv)) {
        Some(value @ StaticValue::Object(_)) => Ok(value.clone()),
        Some(_) => Err(BailError::new(UnevaluatedKind::Spread, "spread of a static value that is no object")),
        None => Err(BailError::new(UnevaluatedKind::Spread, "spread element in style object")),
    }
}

fn eval_property_key(key: &PropertyKey<'_>) -> Result<String, BailError> {
    match key {
        PropertyKey::StaticIdentifier(id) => Ok(id.name.to_string()),
        PropertyKey::StringLiteral(lit) => Ok(lit.value.to_string()),
        PropertyKey::NumericLiteral(lit) => Ok(lit.value.to_string()),
        _ => Err(BailError::new(UnevaluatedKind::ComputedKey, "non-static property key")),
    }
}

fn eval_expression(
    expr: &Expression<'_>,
    skips: &mut Vec<SkippedProperty>,
) -> Result<StaticValue, BailError> {
    eval_expression_with_statics(expr, skips, None)
}

pub(crate) fn eval_expression_with_statics(
    expr: &Expression<'_>,
    skips: &mut Vec<SkippedProperty>,
    static_values: Option<Statics<'_>>,
) -> Result<StaticValue, BailError> {
    eval_expression_scoped(expr, skips, static_values, false)
}

/// A numeric literal's value, as JSON spells it: an integer where it is
/// one, else a float.
fn number(value: f64) -> StaticValue {
    let number = if value.fract() == 0.0 && value.abs() < (i64::MAX as f64) {
        serde_json::Number::from(value as i64)
    } else {
        serde_json::Number::from_f64(value).unwrap_or_else(|| serde_json::Number::from(0))
    };
    StaticValue::Number(StaticNumber(number))
}

fn eval_expression_scoped(
    expr: &Expression<'_>,
    skips: &mut Vec<SkippedProperty>,
    static_values: Option<Statics<'_>>,
    keyframes_eligible: bool,
) -> Result<StaticValue, BailError> {
    let expr = crate::chain_walk::unwrap_type_assertions(expr);
    match expr {
        Expression::StringLiteral(lit) => Ok(StaticValue::String(lit.value.to_string())),

        Expression::NumericLiteral(lit) => Ok(number(lit.value)),

        Expression::BooleanLiteral(lit) => Ok(StaticValue::Bool(lit.value)),

        Expression::NullLiteral(_) => Ok(StaticValue::Null),

        Expression::UnaryExpression(unary) => {
            if unary.operator == oxc::syntax::operator::UnaryOperator::UnaryNegation {
                if let Expression::NumericLiteral(lit) = &unary.argument {
                    return Ok(number(-lit.value));
                }
            }
            Err(BailError::new(UnevaluatedKind::Operator, "non-static unary expression"))
        }

        Expression::ObjectExpression(obj) => {
            match eval_object_expr_scoped(obj, static_values, keyframes_eligible) {
                Ok((value, inner_skips, _captures)) => {
                    skips.extend(inner_skips);
                    Ok(value)
                }
                Err(bail) => Err(bail),
            }
        }

        Expression::ArrayExpression(arr) => {
            let mut values = Vec::new();
            for elem in &arr.elements {
                values.push(eval_array_element(elem)?);
            }
            Ok(StaticValue::Array(values))
        }

        Expression::TemplateLiteral(tpl) => {
            if tpl.expressions.is_empty() {
                if let Some(quasi) = tpl.quasis.first() {
                    return Ok(StaticValue::String(quasi.value.raw.to_string()));
                }
            }
            eval_asset_template(tpl, static_values, keyframes_eligible).ok_or_else(|| {
                BailError::new(UnevaluatedKind::Template, "template literal with expressions (non-static)")
            })
        }

        Expression::Identifier(ident) => {
            if let Some(sv) = static_values {
                match static_value(sv, ident.name.as_str(), &[]) {
                    // A static something may change before the read is no
                    // value: the runtime reads whatever it holds then.
                    Some(Known::Finite(_) | Known::Uncertain(_)) => {
                        let clause = uncertain_clause(sv, ident.name.as_str(), &[]).unwrap_or_default();
                        return Err(BailError::new(
                            UnevaluatedKind::Reference,
                            format!("variable reference (non-static) — {clause}"),
                        ));
                    }
                    Some(Known::Exact(StaticValue::AssetFunction { .. })) | None => {}
                    Some(Known::Exact(value)) => return Ok(value.clone()),
                }
            }
            Err(BailError::new(UnevaluatedKind::Reference, "variable reference (non-static)"))
        }
        Expression::CallExpression(call) => eval_asset_call(call, static_values)
            .unwrap_or_else(|| Err(BailError::new(UnevaluatedKind::Call, "function call (non-static)"))),
        Expression::ArrowFunctionExpression(_) => {
            Err(BailError::new(UnevaluatedKind::Function, "arrow function (non-static)"))
        }
        Expression::FunctionExpression(_) => Err(BailError::new(UnevaluatedKind::Function, "function (non-static)")),
        Expression::TaggedTemplateExpression(_) => {
            Err(BailError::new(UnevaluatedKind::Template, "tagged template (non-static)"))
        }
        Expression::StaticMemberExpression(member) => {
            if let Some(value) = static_values.and_then(|sv| static_path_value(expr, sv)) {
                return Ok(value.clone());
            }
            if let Some(reason) = static_values.and_then(|sv| expression_clause(expr, sv)) {
                return Err(BailError::new(UnevaluatedKind::Reference, format!("member expression (non-static) — {reason}")));
            }
            Err(BailError::new(UnevaluatedKind::Reference, member_expression_skip_reason(
                &member.object,
                member.property.name.as_str(),
                static_values,
                keyframes_eligible,
            )))
        }
        Expression::ComputedMemberExpression(_) => static_values
            .and_then(|sv| static_path_value(expr, sv))
            .cloned()
            .ok_or_else(|| match static_values.and_then(|sv| expression_clause(expr, sv)) {
                Some(reason) => BailError::new(UnevaluatedKind::Reference, format!("member expression (non-static) — {reason}")),
                None => BailError::new(UnevaluatedKind::Reference, "member expression (non-static)"),
            }),

        _ => Err(BailError::new(expression_kind(expr), "unsupported expression type")),
    }
}

/// What kind of expression evaluation could not settle, by its form;
/// `Unsupported` only where no specific kind applies.
fn expression_kind(expr: &Expression<'_>) -> UnevaluatedKind {
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::BinaryExpression(_)
        | Expression::LogicalExpression(_)
        | Expression::ConditionalExpression(_)
        | Expression::UnaryExpression(_)
        | Expression::UpdateExpression(_)
        | Expression::AssignmentExpression(_)
        | Expression::SequenceExpression(_)
        | Expression::AwaitExpression(_) => UnevaluatedKind::Operator,
        Expression::CallExpression(_) | Expression::NewExpression(_) | Expression::ChainExpression(_) => {
            UnevaluatedKind::Call
        }
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) | Expression::ClassExpression(_) => {
            UnevaluatedKind::Function
        }
        Expression::TemplateLiteral(_) | Expression::TaggedTemplateExpression(_) => UnevaluatedKind::Template,
        Expression::Identifier(_)
        | Expression::StaticMemberExpression(_)
        | Expression::ComputedMemberExpression(_)
        | Expression::PrivateFieldExpression(_)
        | Expression::ThisExpression(_) => UnevaluatedKind::Reference,
        _ => UnevaluatedKind::Unsupported,
    }
}

fn member_expression_skip_reason(
    object: &Expression<'_>,
    property: &str,
    static_values: Option<Statics<'_>>,
    keyframes_eligible: bool,
) -> String {
    let Expression::Identifier(ident) = object else {
        return "member expression (non-static)".to_string();
    };
    let base = ident.name.as_str();
    let named = format!("member expression '{base}.{property}' (non-static)");
    // Callers without statics (array elements, module-statics collection)
    // never reach manifest diagnostics, so keyframe advice is unactionable.
    let Some(sv) = static_values else {
        return format!("{named} — evaluated without extraction-time statics");
    };
    let value = match static_value(sv, base, &[]) {
        Some(Known::Finite(_) | Known::Uncertain(_)) => {
            return format!("{named} — {}", uncertain_clause(sv, base, &[]).unwrap_or_default())
        }
        Some(Known::Exact(value)) => Some(value),
        None => None,
    };
    match value {
        Some(StaticValue::Object(_)) => format!(
            "{named} — '{base}' is a registered collection with no '{property}' member"
        ),
        Some(_) => format!("{named} — '{base}' is not an object binding"),
        None if keyframes_eligible => format!(
            "{named} — '{base}' is neither a registered keyframe collection nor an extraction-time static binding; if it is a keyframe collection, register it on the system between build() and seal() under the key '{base}' — the registration key must equal the export name ({KEYFRAMES_UNREGISTERED_REFERENCE})"
        ),
        None => format!("{named} — '{base}' is not an extraction-time static binding"),
    }
}

fn eval_array_element(elem: &ArrayExpressionElement<'_>) -> Result<StaticValue, BailError> {
    match elem {
        ArrayExpressionElement::StringLiteral(lit) => Ok(StaticValue::String(lit.value.to_string())),
        ArrayExpressionElement::NumericLiteral(lit) => Ok(number(lit.value)),
        ArrayExpressionElement::BooleanLiteral(lit) => Ok(StaticValue::Bool(lit.value)),
        ArrayExpressionElement::NullLiteral(_) => Ok(StaticValue::Null),
        ArrayExpressionElement::ObjectExpression(obj) => {
            eval_object_expr(obj).map(|(val, _skips, _captures)| val)
        }
        ArrayExpressionElement::ArrayExpression(arr) => {
            let mut values = Vec::new();
            for inner in &arr.elements {
                match inner {
                    ArrayExpressionElement::Elision(_) => values.push(StaticValue::Null),
                    ArrayExpressionElement::SpreadElement(_) => {
                        return Err(BailError::new(UnevaluatedKind::Spread, "spread in nested array"))
                    }
                    other => values.push(eval_array_element(other)?),
                }
            }
            Ok(StaticValue::Array(values))
        }
        ArrayExpressionElement::Identifier(_) => {
            Err(BailError::new(UnevaluatedKind::Reference, "variable reference in array (non-static)"))
        }
        ArrayExpressionElement::CallExpression(_) => {
            Err(BailError::new(UnevaluatedKind::Call, "function call in array (non-static)"))
        }
        ArrayExpressionElement::SpreadElement(_) => Err(BailError::new(UnevaluatedKind::Spread, "spread in array")),
        ArrayExpressionElement::Elision(_) => Ok(StaticValue::Null),
        other => Err(BailError::new(
            other.as_expression().map_or(UnevaluatedKind::Unsupported, expression_kind),
            "unsupported array element",
        )),
    }
}

#[derive(Debug)]
pub struct VariantStageConfig {
    pub prop: String,
    pub default_variant: Option<String>,
    pub base: Option<StaticValue>,
    /// The variants by name, in authored order.
    pub variants: StaticValue,
}

pub fn parse_variant_arg(
    obj: &ObjectExpression<'_>,
    static_values: Option<Statics<'_>>,
) -> Result<(VariantStageConfig, Vec<SkippedProperty>), BailError> {
    let mut prop = "variant".to_string();
    let mut default_variant = None;
    let mut base = None;
    let mut variants = StaticValue::Object(Vec::new());
    let mut all_skips = Vec::new();
    let skip = |key: &str, kind: UnevaluatedKind, reason: &str, span: Span| SkippedProperty {
        key: key.to_string(),
        kind,
        reason: reason.to_string(),
        parent: None,
        span: span_of(span),
    };

    for prop_kind in &obj.properties {
        if let ObjectPropertyKind::ObjectProperty(p) = prop_kind {
            let key = eval_property_key(&p.key)?;
            match key.as_str() {
                "prop" => {
                    if let Expression::StringLiteral(lit) = &p.value {
                        prop = lit.value.to_string();
                    } else {
                        all_skips.push(skip("prop", expression_kind(&p.value), "variant prop name (non-static)", p.value.span()));
                    }
                }
                "defaultVariant" => {
                    if let Expression::StringLiteral(lit) = &p.value {
                        default_variant = Some(lit.value.to_string());
                    } else {
                        all_skips.push(skip(
                            "defaultVariant",
                            expression_kind(&p.value),
                            "default variant name (non-static)",
                            p.value.span(),
                        ));
                    }
                }
                "base" => {
                    if let Expression::ObjectExpression(obj) = &p.value {
                        let (val, skips, _captures) =
                            eval_object_expr_with_statics(obj, static_values)?;
                        all_skips.extend(skips);
                        base = Some(val);
                    } else {
                        // A value that evaluates is no object; one that does
                        // not keeps the kind evaluation gave it.
                        match eval_expression_with_statics(&p.value, &mut Vec::new(), static_values) {
                            Ok(object @ StaticValue::Object(_)) => base = Some(object),
                            evaluated => {
                                let kind = evaluated.err().map_or(UnevaluatedKind::Unsupported, |bail| bail.kind);
                                all_skips.push(skip("base", kind, "variant base styles (non-static)", p.value.span()));
                            }
                        }
                    }
                }
                "variants" => {
                    if let Expression::ObjectExpression(obj) = &p.value {
                        for vprop in &obj.properties {
                            match vprop {
                                ObjectPropertyKind::ObjectProperty(vp) => {
                                    let vkey = eval_property_key(&vp.key)?;
                                    let mut skips = Vec::new();
                                    let vstyles = eval_expression_with_statics(
                                        &vp.value,
                                        &mut skips,
                                        static_values,
                                    )?;
                                    all_skips.extend(skips);
                                    variants.insert(&vkey, vstyles);
                                }
                                ObjectPropertyKind::SpreadProperty(spread) => {
                                    all_skips.push(skip(
                                        "variants",
                                        UnevaluatedKind::Spread,
                                        "variant map spread (non-static)",
                                        spread.span,
                                    ));
                                }
                            }
                        }
                    } else {
                        match eval_expression_with_statics(&p.value, &mut Vec::new(), static_values) {
                            Ok(StaticValue::Object(entries)) => {
                                for (vkey, vstyles) in entries {
                                    variants.insert(&vkey, vstyles);
                                }
                            }
                            evaluated => {
                                let kind = evaluated.err().map_or(UnevaluatedKind::Unsupported, |bail| bail.kind);
                                all_skips.push(skip("variants", kind, "variant map (non-static)", p.value.span()));
                            }
                        }
                    }
                }
                _ => {}
            }
        } else {
            all_skips.push(skip(
                "variant config",
                UnevaluatedKind::Spread,
                "variant config spread (non-static)",
                prop_kind.span(),
            ));
        }
    }

    Ok((
        VariantStageConfig {
            prop,
            default_variant,
            base,
            variants,
        },
        all_skips,
    ))
}

#[allow(dead_code)]
pub fn parse_states_arg(
    obj: &ObjectExpression<'_>,
) -> Result<(StaticValue, Vec<SkippedProperty>), BailError> {
    let mut states = StaticValue::Object(Vec::new());
    let mut all_skips = Vec::new();

    for prop_kind in &obj.properties {
        match prop_kind {
            ObjectPropertyKind::ObjectProperty(p) => {
                let key = eval_property_key(&p.key)?;
                let mut skips = Vec::new();
                let styles = eval_expression(&p.value, &mut skips)?;
                all_skips.extend(skips);
                states.insert(&key, styles);
            }
            ObjectPropertyKind::SpreadProperty(_) => {
                return Err(BailError::new(UnevaluatedKind::Spread, "spread in states config"));
            }
        }
    }

    Ok((states, all_skips))
}

pub fn collect_static_values(program: &Program<'_>, module: &str) -> FxHashMap<String, StaticValue> {
    collect_static_values_impl(program, module, false, false)
}

/// The static values of a file in an installed or external package, where a
/// relative `asset()` specifier would resolve from the wrong origin.
pub fn collect_package_static_values(program: &Program<'_>, module: &str) -> FxHashMap<String, StaticValue> {
    collect_static_values_impl(program, module, false, true)
}

/// Rejects partially evaluated objects, so an inferred JSX value set can
/// never omit a runtime-reachable member.
pub fn collect_complete_static_values(program: &Program<'_>, module: &str) -> FxHashMap<String, StaticValue> {
    collect_static_values_impl(program, module, true, false)
}

fn collect_static_values_impl(
    program: &Program<'_>,
    module: &str,
    require_complete: bool,
    in_package: bool,
) -> FxHashMap<String, StaticValue> {
    // Style values may call `asset()`; JSX usage values never read it.
    let assets = if require_complete { FxHashMap::default() } else { asset_bindings(program, in_package) };
    let mut values: FxHashMap<String, StaticValue> = assets.clone();
    let undefined_bound = !require_complete && module_binds(program, "undefined");

    for stmt in &program.body {
        let decl = match stmt {
            Statement::VariableDeclaration(decl) if decl.kind == VariableDeclarationKind::Const => {
                decl
            }
            Statement::ExportDeclaration(export) => {
                if let Declaration::VariableDeclaration(decl) = &export.declaration {
                    if decl.kind == VariableDeclarationKind::Const {
                        decl
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            }
            _ => continue,
        };

        for declarator in &decl.declarations {
            let name = match &declarator.id {
                oxc::ast::ast::BindingPattern::BindingIdentifier(ident) => {
                    ident.name.to_string()
                }
                _ => continue,
            };

            if let Some(init) = &declarator.init {
                // Style values read earlier consts, as source order runs them;
                // JSX usage values keep reading literals only.
                let scope = if require_complete { &assets } else { &values };
                if let Some(val) = const_value(init, &name, Statics::of(scope, module), require_complete, undefined_bound) {
                    values.insert(name, val);
                }
            }
        }
    }

    values
}

/// A const initializer's static value, reading `scope`.
fn const_value(
    init: &Expression<'_>,
    name: &str,
    scope: Statics<'_>,
    require_complete: bool,
    undefined_bound: bool,
) -> Option<StaticValue> {
    match crate::chain_walk::unwrap_type_assertions(init) {
        Expression::ObjectExpression(obj) => {
            let (mut val, skips, captures) = eval_object_expr_scoped(obj, Some(scope), false).ok()?;
            if !require_complete {
                mark_lost_values(&mut val, &LostValueSource { obj, name, undefined_bound }, &skips, &captures);
                Some(val)
            } else {
                (skips.is_empty() && captures.is_empty()).then_some(val)
            }
        }
        init => {
            let mut skips = Vec::new();
            let val = eval_expression_with_statics(init, &mut skips, Some(scope)).ok()?;
            (!require_complete || skips.is_empty()).then_some(val)
        }
    }
}

/// The style value of module-scope const `name` when its initializer reads
/// no other const, as every style value was read before const initializers
/// read earlier consts. `None` when that initializer has no static value
/// then: a spread, member or computed key of another const.
pub(crate) fn pre_read_static(program: &Program<'_>, module: &str, name: &str, in_package: bool) -> Option<StaticValue> {
    let declarator = program.body.iter().find_map(|stmt| {
        let decl = match stmt {
            Statement::VariableDeclaration(decl) => decl,
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(decl) => decl,
                _ => return None,
            },
            _ => return None,
        };
        (decl.kind == VariableDeclarationKind::Const).then_some(())?;
        decl.declarations.iter().find(|declarator| {
            matches!(&declarator.id, oxc::ast::ast::BindingPattern::BindingIdentifier(ident) if ident.name == name)
        })
    })?;
    let assets = asset_bindings(program, in_package);
    const_value(declarator.init.as_ref()?, name, Statics::of(&assets, module), false, module_binds(program, "undefined"))
}

struct LostValueSource<'s, 'a> {
    obj: &'s ObjectExpression<'a>,
    name: &'s str,
    undefined_bound: bool,
}

/// Puts an unevaluated node where a const object holds what evaluation
/// could not carry statically (a skipped key, or a captured `transform`
/// callback, which only a `.props()` config loses), so whichever stage reads
/// the const can report it. Stage readers take the nodes with
/// `take_unevaluated` or `take_unevaluated_custom_props`; only serialized
/// statics strip them silently. A member read of one is a miss.
fn mark_lost_values(
    value: &mut StaticValue,
    source: &LostValueSource<'_, '_>,
    skips: &[SkippedProperty],
    captures: &[CapturedTransform],
) {
    for capture in captures {
        let parent = capture.key.strip_suffix(".transform");
        mark_lost_value(
            value,
            parent,
            "transform",
            UnevaluatedKind::CapturedTransform,
            format!("an inline function in const '{}'", source.name),
        );
    }
    for skip in skips {
        let absent = skip.key == "transform"
            && transform_value_at(source.obj, skip.parent.as_deref())
                .is_some_and(|expr| is_absent_value(expr, source.undefined_bound));
        if !absent {
            mark_lost_value(
                value,
                skip.parent.as_deref(),
                &skip.key,
                skip.kind,
                format!("{} in const '{}'", skip.reason, source.name),
            );
        }
    }
}

fn mark_lost_value(
    value: &mut StaticValue,
    parent: Option<&str>,
    key: &str,
    kind: UnevaluatedKind,
    clause: String,
) {
    let mut current = value;
    for segment in parent.into_iter().flat_map(|path| path.split('.')) {
        match current.get_mut(segment) {
            Some(next) => current = next,
            None => return,
        }
    }
    current.insert(key, StaticValue::Unevaluated(Unevaluated { kind, clause }));
}

/// A static binding some use may change before a style reads it: every
/// read refuses, uncertain as Flow's `Stable` exposure of the binding says
/// (`uncertainty`), and diagnostics name `reason`. `held` is the binding's
/// `pre_read_static` value, which serialized facts carry.
#[derive(Debug, Clone)]
pub(crate) struct Unsettled {
    pub(crate) reason: String,
    pub(crate) uncertainty: Uncertainty,
    pub(crate) held: Option<StaticValue>,
}

/// The static values a reader sees in one module, with the bindings that
/// are unsettled. Every read of a binding goes through `static_value`.
#[derive(Clone, Copy)]
pub struct Statics<'s> {
    values: &'s FxHashMap<String, StaticValue>,
    unsettled: Option<&'s FxHashMap<String, Unsettled>>,
    module: &'s str,
}

impl<'s> Statics<'s> {
    pub(crate) fn new(
        values: &'s FxHashMap<String, StaticValue>,
        unsettled: &'s FxHashMap<String, Unsettled>,
        module: &'s str,
    ) -> Self {
        Self { values, unsettled: Some(unsettled), module }
    }

    /// `module`'s static values, none of them unsettled.
    pub(crate) fn of(values: &'s FxHashMap<String, StaticValue>, module: &'s str) -> Self {
        Self { values, unsettled: None, module }
    }

    /// Statics that read nothing, so they name no module.
    pub(crate) fn empty() -> Statics<'static> {
        static EMPTY: std::sync::OnceLock<FxHashMap<String, StaticValue>> = std::sync::OnceLock::new();
        Statics { values: EMPTY.get_or_init(FxHashMap::default), unsettled: None, module: "" }
    }

    /// Whether `name` has a static value.
    pub(crate) fn contains(self, name: &str) -> bool {
        self.values.contains_key(name)
    }

    /// Whether no binding has a static value.
    pub(crate) fn is_empty(self) -> bool {
        self.values.is_empty()
    }
}

/// The unevaluated node on `path` within `value`, with the path to it, if
/// any; the path stops there, as a read does.
fn unevaluated_on<'v>(value: &'v StaticValue, path: &[&str]) -> Option<(&'v Unevaluated, Vec<String>)> {
    let mut current = value;
    let mut at = Vec::new();
    for segment in path {
        if let StaticValue::Unevaluated(unevaluated) = current {
            return Some((unevaluated, at));
        }
        current = current.get(segment)?;
        at.push((*segment).to_string());
    }
    match current {
        StaticValue::Unevaluated(unevaluated) => Some((unevaluated, at)),
        _ => None,
    }
}

/// What binding `name` holds at member `path` (spec §6.2 F1a), or `None`
/// for a binding with no static value or a path to no member. It is
/// `Exact` only where evaluation settled every node on the path and Flow
/// saw nothing that may change the binding. An unevaluated node is
/// uncertain at its path in the binding's object; an unsettled binding as
/// Flow's exposure of it says, joined with an unevaluated node of its held
/// value.
pub(crate) fn static_value<'s>(statics: Statics<'s>, name: &str, path: &[&str]) -> Option<Known<&'s StaticValue>> {
    let node = |unevaluated: &Unevaluated, at: Vec<String>| {
        Uncertainty::new(
            ReasonId::Unevaluated(unevaluated.kind),
            Region::of(RegionAtom::Path(ObjectId::new(statics.module, name), at)),
        )
    };
    if let Some(unsettled) = statics.unsettled.and_then(|unsettled| unsettled.get(name)) {
        let held = unsettled.held.as_ref().and_then(|held| unevaluated_on(held, path));
        return Some(Known::Uncertain(match held {
            Some((unevaluated, at)) => unsettled.uncertainty.clone().join(node(unevaluated, at)),
            None => unsettled.uncertainty.clone(),
        }));
    }
    let value = statics.values.get(name)?;
    if let Some((unevaluated, at)) = unevaluated_on(value, path) {
        return Some(Known::Uncertain(node(unevaluated, at)));
    }
    let mut current = value;
    for segment in path {
        current = current.get(segment)?;
    }
    Some(Known::Exact(current))
}

/// The clause a diagnostic gives where binding `name` at member `path` is
/// uncertain: the unsettled binding's use, or the unevaluated node's
/// clause. Diagnostics only: no decision reads it.
pub(crate) fn uncertain_clause<'s>(statics: Statics<'s>, name: &str, path: &[&str]) -> Option<&'s str> {
    if let Some(unsettled) = statics.unsettled.and_then(|unsettled| unsettled.get(name)) {
        return Some(&unsettled.reason);
    }
    unevaluated_on(statics.values.get(name)?, path).map(|(unevaluated, _)| unevaluated.clause.as_str())
}

/// A static value as JSON, for a stage's config and serialized facts. The
/// `asset` function is spelled as the object `{ "$animus.asset": scope }`,
/// as those outputs carry it; no unevaluated node remains where JSON is
/// written, since every reader takes them first.
pub(crate) fn plain(value: &StaticValue) -> Value {
    match value {
        StaticValue::Null | StaticValue::Unevaluated(_) => Value::Null,
        StaticValue::Bool(flag) => Value::Bool(*flag),
        StaticValue::Number(StaticNumber(number)) => Value::Number(number.clone()),
        StaticValue::String(text) => Value::String(text.clone()),
        StaticValue::Array(items) => Value::Array(items.iter().map(plain).collect()),
        StaticValue::Object(entries) => {
            Value::Object(entries.iter().map(|(key, value)| (key.clone(), plain(value))).collect())
        }
        StaticValue::AssetFunction { in_project } => {
            serde_json::json!({ ASSET_FUNCTION: if *in_project { ASSET_IN_PROJECT } else { ASSET_IN_PACKAGE } })
        }
    }
}

/// How JSON spells the `asset` function, a local bound to
/// `@animus-ui/system`'s `asset`, by its scope: in a project file the host
/// resolves a relative specifier as every relative `asset()` is resolved,
/// from the project root; in a package file that would be the wrong origin.
const ASSET_FUNCTION: &str = "$animus.asset";
const ASSET_IN_PROJECT: &str = "project";
const ASSET_IN_PACKAGE: &str = "package";

/// The placeholder `asset()` returns: the host substitutes the resolved URL.
pub(crate) const ASSET_PLACEHOLDER_PREFIX: &str = "animus-asset:";

/// A specifier `asset()` resolves against the declaring file's directory.
fn is_relative_specifier(specifier: &str) -> bool {
    specifier.starts_with("./") || specifier.starts_with("../")
}

/// `asset('literal')` through a local bound to the `asset` function, as the
/// placeholder it returns; `None` for any other call.
fn eval_asset_call(
    call: &oxc::ast::ast::CallExpression<'_>,
    static_values: Option<Statics<'_>>,
) -> Option<Result<StaticValue, BailError>> {
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let Known::Exact(&StaticValue::AssetFunction { in_project: relative_allowed }) =
        static_value(static_values?, callee.name.as_str(), &[])?
    else {
        return None;
    };
    let [Argument::StringLiteral(specifier)] = call.arguments.as_slice() else {
        return Some(Err(BailError::new(UnevaluatedKind::Call, "asset() of a non-literal specifier (non-static)")));
    };
    if is_relative_specifier(&specifier.value) && !relative_allowed {
        return Some(Err(BailError::new(UnevaluatedKind::Call, 
            "asset() of a relative specifier in a package file, which would resolve from the wrong origin (non-static)",
        )));
    }
    Some(Ok(StaticValue::String(format!("{ASSET_PLACEHOLDER_PREFIX}{}", specifier.value))))
}

/// A template whose every expression is a static string or number and which
/// carries an `asset()` placeholder, as its text. Other templates with
/// expressions stay non-static.
fn eval_asset_template(
    tpl: &oxc::ast::ast::TemplateLiteral<'_>,
    static_values: Option<Statics<'_>>,
    keyframes_eligible: bool,
) -> Option<StaticValue> {
    let mut parts = Vec::with_capacity(tpl.expressions.len());
    for expression in &tpl.expressions {
        let mut skips = Vec::new();
        let part = match eval_expression_scoped(expression, &mut skips, static_values, keyframes_eligible).ok()? {
            StaticValue::String(text) => text,
            StaticValue::Number(StaticNumber(number)) => number.to_string(),
            _ => return None,
        };
        parts.push(part);
    }
    if !parts.iter().any(|part| part.contains(ASSET_PLACEHOLDER_PREFIX)) {
        return None;
    }
    let mut text = String::new();
    for (index, quasi) in tpl.quasis.iter().enumerate() {
        text.push_str(&quasi.value.raw);
        if let Some(part) = parts.get(index) {
            text.push_str(part);
        }
    }
    Some(StaticValue::String(text))
}

/// Whether a value holds an `asset()` placeholder with a relative
/// specifier, which only its own file may use.
pub(crate) fn carries_relative_asset(value: &StaticValue) -> bool {
    match value {
        StaticValue::String(text) => text
            .match_indices(ASSET_PLACEHOLDER_PREFIX)
            .any(|(at, prefix)| is_relative_specifier(&text[at + prefix.len()..])),
        StaticValue::Array(items) => items.iter().any(carries_relative_asset),
        StaticValue::Object(entries) => entries.iter().any(|(_, value)| carries_relative_asset(value)),
        _ => false,
    }
}

/// The module's locals imported as `asset` from `@animus-ui/system`, bound to
/// the `asset` function for a project or a package file.
fn asset_bindings(program: &Program<'_>, in_package: bool) -> FxHashMap<String, StaticValue> {
    let mut bindings = FxHashMap::default();
    for stmt in &program.body {
        let Statement::ImportDeclaration(import) = stmt else {
            continue;
        };
        if !crate::usage_facts::is_animus_system_specifier(&import.source.value) {
            continue;
        }
        for specifier in import.specifiers.iter().flatten() {
            if let oxc::ast::ast::ImportDeclarationSpecifier::ImportSpecifier(named) = specifier {
                if named.imported.name() == "asset" {
                    bindings.insert(
                        named.local.name.to_string(),
                        StaticValue::AssetFunction { in_project: !in_package },
                    );
                }
            }
        }
    }
    bindings
}

/// What a `.props()` value lost through const configs, as `(prop, reason)`;
/// `skipped` holds the losses inside a config, as per-property skips.
#[derive(Default)]
pub(crate) struct LostCustomProps {
    pub transforms: Vec<(String, String)>,
    pub configs: Vec<(String, String)>,
    pub skipped: Vec<(String, String)>,
}

/// Takes the unevaluated top-level custom prop configs and their
/// `transform` from a `.props()` value, then takes every other unevaluated
/// node as a skip.
pub(crate) fn take_unevaluated_custom_props(value: &mut StaticValue) -> LostCustomProps {
    let mut lost = LostCustomProps::default();
    if let Some(configs) = value.entries_mut() {
        configs.retain(|(prop, config)| match config {
            StaticValue::Unevaluated(unevaluated) => {
                lost.configs.push((prop.clone(), unevaluated.clause.clone()));
                false
            }
            _ => true,
        });
        for (prop, config) in configs.iter_mut() {
            let Some(entries) = config.entries_mut() else {
                continue;
            };
            let transform = entries
                .iter()
                .position(|(key, value)| key == "transform" && matches!(value, StaticValue::Unevaluated(_)));
            if let Some(at) = transform {
                // Removed as JSON's map removed it, the last entry taking its
                // place, since the order decides the config's class.
                if let (_, StaticValue::Unevaluated(unevaluated)) = entries.swap_remove(at) {
                    lost.transforms.push((prop.clone(), unevaluated.clause));
                }
            }
        }
    }
    lost.skipped = take_unevaluated(value);
    lost
}

/// Removes the unevaluated nodes from a stage value reached through a const,
/// returning each, as a dotted path, with its clause. A captured inline
/// `transform` is removed without a skip.
pub(crate) fn take_unevaluated(value: &mut StaticValue) -> Vec<(String, String)> {
    take_unevaluated_segments(value)
        .into_iter()
        .map(|(path, unevaluated)| (path.join("."), unevaluated.clause))
        .collect()
}

/// `take_unevaluated` with each path as its key segments, since a selector
/// key can itself contain a dot.
fn take_unevaluated_segments(value: &mut StaticValue) -> Vec<(Vec<String>, Unevaluated)> {
    let mut lost = Vec::new();
    collect_unevaluated(value, &[], &mut lost);
    lost
}

/// Each unevaluated node an object entry holds, with its key segments; an
/// array's items are read at the array's own path.
fn collect_unevaluated(value: &mut StaticValue, path: &[String], lost: &mut Vec<(Vec<String>, Unevaluated)>) {
    match value {
        StaticValue::Array(items) => items.iter_mut().for_each(|item| collect_unevaluated(item, path, lost)),
        value => {
            let Some(entries) = value.entries_mut() else { return };
            entries.retain_mut(|(key, child)| {
                let at = [path, std::slice::from_ref(key)].concat();
                match child {
                    StaticValue::Unevaluated(unevaluated) => {
                        if unevaluated.kind != UnevaluatedKind::CapturedTransform {
                            lost.push((at, unevaluated.clone()));
                        }
                        false
                    }
                    child => {
                        collect_unevaluated(child, &at, lost);
                        true
                    }
                }
            });
        }
    }
}

/// Removes every unevaluated node without reporting: serialized statics are
/// not a stage reader, so the stage that later reads one reports its losses.
pub(crate) fn strip_unevaluated(value: &mut StaticValue) {
    take_unevaluated_segments(value);
}

/// Whether a module-scope declaration or import binds `name`; chain and
/// const initializers are top-level, so only module scope can shadow there.
pub(crate) fn module_binds(program: &Program<'_>, name: &str) -> bool {
    let declares = |decl: &Declaration<'_>| match decl {
        Declaration::VariableDeclaration(var) => var
            .declarations
            .iter()
            .any(|d| d.id.get_binding_identifiers().iter().any(|id| id.name == name)),
        Declaration::FunctionDeclaration(func) => func.id.as_ref().is_some_and(|id| id.name == name),
        Declaration::ClassDeclaration(class) => class.id.as_ref().is_some_and(|id| id.name == name),
        Declaration::TSEnumDeclaration(decl) => decl.id.name == name,
        Declaration::TSImportEqualsDeclaration(decl) => decl.id.name == name,
        Declaration::TSNamespaceDeclaration(decl) => decl.id.name == name,
        // `declare module 'x' {}` names a module, and binds nothing.
        _ => false,
    };
    program.body.iter().any(|stmt| match stmt {
        Statement::ImportDeclaration(import) => import
            .specifiers
            .iter()
            .flatten()
            .any(|spec| spec.local().name == name),
        Statement::ExportDeclaration(export) => declares(&export.declaration),
        Statement::ExportDefaultDeclaration(export) => match &export.declaration {
            oxc::ast::ast::ExportDefaultDeclarationKind::FunctionDeclaration(func) => {
                func.id.as_ref().is_some_and(|id| id.name == name)
            }
            oxc::ast::ast::ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                class.id.as_ref().is_some_and(|id| id.name == name)
            }
            _ => false,
        },
        other => other.as_declaration().is_some_and(declares),
    })
}

/// An explicitly absent transform: unshadowed `undefined` or `void 0`.
pub(crate) fn is_absent_value(expr: &Expression<'_>, undefined_bound: bool) -> bool {
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::Identifier(id) => id.name == "undefined" && !undefined_bound,
        Expression::UnaryExpression(unary) => {
            unary.operator == UnaryOperator::Void
                && matches!(unary.argument, Expression::NumericLiteral(_))
        }
        _ => false,
    }
}

/// The `transform` value the evaluator read in the object at `parent`
/// (a skip's key path), following its nested-object descent.
pub(crate) fn transform_value_at<'s, 'a>(
    obj: &'s ObjectExpression<'a>,
    parent: Option<&str>,
) -> Option<&'s Expression<'a>> {
    let mut current = obj;
    for segment in parent.into_iter().flat_map(|path| path.split('.')) {
        match crate::chain_walk::unwrap_type_assertions(last_property(current, segment)?) {
            Expression::ObjectExpression(inner) => current = inner,
            _ => return None,
        }
    }
    last_property(current, "transform")
}

fn last_property<'s, 'a>(obj: &'s ObjectExpression<'a>, key: &str) -> Option<&'s Expression<'a>> {
    obj.properties.iter().rev().find_map(|prop| match prop {
        ObjectPropertyKind::ObjectProperty(prop)
            if !prop.computed && eval_property_key(&prop.key).is_ok_and(|k| k == key) =>
        {
            Some(&prop.value)
        }
        _ => None,
    })
}

pub fn collect_static_exports(
    exports_pairs: &[(Option<String>, String)],
    static_values: &FxHashMap<String, Value>,
) -> FxHashMap<String, Value> {
    let mut exports = FxHashMap::default();

    for (local_name, exported_name) in exports_pairs {
        if let Some(local) = local_name {
            if let Some(value) = static_values.get(local) {
                exports.insert(exported_name.clone(), value.clone());
            }
        }
    }

    exports
}


#[cfg(test)]
mod tests {

    /// A statics map as JSON, for assertions.
    fn plain_map(values: FxHashMap<String, StaticValue>) -> FxHashMap<String, Value> {
        values.iter().map(|(name, value)| (name.clone(), plain(value))).collect()
    }

    /// JSON test data as a static value.
    fn from_json(value: &Value) -> StaticValue {
        match value {
            Value::Null => StaticValue::Null,
            Value::Bool(flag) => StaticValue::Bool(*flag),
            Value::Number(number) => StaticValue::Number(StaticNumber(number.clone())),
            Value::String(text) => StaticValue::String(text.clone()),
            Value::Array(items) => StaticValue::Array(items.iter().map(from_json).collect()),
            Value::Object(entries) => {
                StaticValue::Object(entries.iter().map(|(key, value)| (key.clone(), from_json(value))).collect())
            }
        }
    }

    fn statics_of(values: &FxHashMap<String, Value>) -> FxHashMap<String, StaticValue> {
        values.iter().map(|(name, value)| (name.clone(), from_json(value))).collect()
    }
    use super::*;
    use serde_json::Map;
    use crate::owned_ast::{OwnedAst, ParseCounter};

    fn parse_ts(full: String) -> OwnedAst {
        let counter = ParseCounter::new(0);
        OwnedAst::parse("test.ts".into(), full, &counter)
    }

    fn parse_obj_all(source: &str) -> (Value, Vec<SkippedProperty>, Vec<CapturedTransform>) {
        let ast = parse_ts(format!("const x = {};", source));
        let program = ast.program();

        if let Some(oxc::ast::ast::Statement::VariableDeclaration(decl)) = program.body.first() {
            if let Some(declarator) = decl.declarations.first() {
                if let Some(Expression::ObjectExpression(obj)) = &declarator.init {
                    let (value, skips, captures) = eval_object_expr(obj).unwrap();
                    return (plain(&value), skips, captures);
                }
            }
        }
        panic!("failed to parse object expression");
    }

    fn parse_obj_full(source: &str) -> (Value, Vec<SkippedProperty>) {
        let (val, skips, _captures) = parse_obj_all(source);
        (val, skips)
    }

    fn parse_obj(source: &str) -> Value {
        parse_obj_full(source).0
    }

    fn parse_obj_err(source: &str) -> String {
        let ast = parse_ts(format!("const x = {};", source));
        let program = ast.program();

        if let Some(oxc::ast::ast::Statement::VariableDeclaration(decl)) = program.body.first() {
            if let Some(declarator) = decl.declarations.first() {
                if let Some(Expression::ObjectExpression(obj)) = &declarator.init {
                    return eval_object_expr(obj).unwrap_err().reason;
                }
            }
        }
        panic!("failed to parse");
    }

    fn parse_variant(source: &str) -> (VariantStageConfig, Vec<SkippedProperty>) {
        parse_variant_with_statics(source, None)
    }

    fn parse_variant_with_statics(
        source: &str,
        sv: Option<&FxHashMap<String, Value>>,
    ) -> (VariantStageConfig, Vec<SkippedProperty>) {
        let ast = parse_ts(format!("const x = {};", source));
        let program = ast.program();

        if let Some(oxc::ast::ast::Statement::VariableDeclaration(decl)) = program.body.first() {
            if let Some(declarator) = decl.declarations.first() {
                if let Some(Expression::ObjectExpression(obj)) = &declarator.init {
                    let typed = sv.map(statics_of);
                    return parse_variant_arg(obj, typed.as_ref().map(|typed| Statics::of(typed, "test.ts"))).unwrap();
                }
            }
        }
        panic!("failed to parse variant config object");
    }

    /// Contract: a skip carries the kind of what evaluation could not
    /// settle, from its own site (spec §6.2, `Unevaluated(kind)`).
    #[test]
    fn a_skip_carries_the_kind_of_what_evaluation_could_not_settle() {
        let object_kind = |source: &str| {
            let (_, skips, _) = parse_obj_all(source);
            skips.iter().map(|skip| skip.kind).collect::<Vec<_>>()
        };
        let variant_kind = |source: &str| {
            let (_, skips) = parse_variant(source);
            skips.iter().map(|skip| skip.kind).collect::<Vec<_>>()
        };
        assert_eq!(object_kind("{ a: unknown + 1 }"), [UnevaluatedKind::Operator]);
        assert_eq!(object_kind("{ a: [() => 1] }"), [UnevaluatedKind::Function]);
        assert_eq!(object_kind("{ a: [`x${unknown}`] }"), [UnevaluatedKind::Template]);
        assert_eq!(object_kind("{ a: [!unknown] }"), [UnevaluatedKind::Operator]);
        assert_eq!(object_kind("{ a: [unknown.x] }"), [UnevaluatedKind::Reference]);
        assert_eq!(variant_kind("{ prop: 'size', variants: { sm: {}, ...rest } }"), [UnevaluatedKind::Spread]);
        assert_eq!(variant_kind("{ prop: 'size', variants: selectSizes }"), [UnevaluatedKind::Reference]);
        assert_eq!(variant_kind("{ prop: name, variants: {} }"), [UnevaluatedKind::Reference]);
    }

    /// Contract (spec §6.2 F1a): `static_value` is `Exact` only where
    /// evaluation settled every node on the path and nothing may change the
    /// binding. An unevaluated node is `Unevaluated(kind)` at its path in the
    /// binding's object; an unsettled binding is Flow's exposure of it,
    /// joined with an unevaluated node of its held value.
    #[test]
    fn a_static_read_is_known_as_evaluation_and_flow_leave_it() {
        use crate::flow::{ChangeKind, Known, ObjectId, ReasonId, Region, RegionAtom, Uncertainty};
        let ast = parse_ts("const preset = { size: 4, tone: pick() };".to_string());
        let values = collect_static_values(ast.program(), "m.ts");
        let path = |segments: &[&str]| segments.iter().map(|segment| segment.to_string()).collect::<Vec<_>>();
        let unevaluated = Uncertainty::new(
            ReasonId::Unevaluated(UnevaluatedKind::Call),
            Region::of(RegionAtom::Path(ObjectId::new("m.ts", "preset"), path(&["tone"]))),
        );
        let statics = Statics::of(&values, "m.ts");

        assert_eq!(
            static_value(statics, "preset", &["size"]),
            Some(Known::Exact(&StaticValue::Number(StaticNumber(4.into())))),
        );
        assert_eq!(static_value(statics, "preset", &["tone"]), Some(Known::Uncertain(unevaluated.clone())));

        let written = Uncertainty::new(
            ReasonId::Changed(ChangeKind::Write),
            Region::of(RegionAtom::Path(ObjectId::new("m.ts", "preset"), path(&["size"]))),
        );
        let unsettled = FxHashMap::from_iter([(
            "preset".to_string(),
            Unsettled { reason: "preset.size is written".to_string(), uncertainty: written.clone(), held: values.get("preset").cloned() },
        )]);
        let none = FxHashMap::default();
        let held = Statics::new(&none, &unsettled, "m.ts");

        assert_eq!(static_value(held, "preset", &["size"]), Some(Known::Uncertain(written.clone())));
        assert_eq!(static_value(held, "preset", &["tone"]), Some(Known::Uncertain(written.join(unevaluated))));
        assert_eq!(uncertain_clause(held, "preset", &["tone"]), Some("preset.size is written"));
    }

    #[test]
    fn variant_identifier_map_records_skip_instead_of_silent_empty() {
        let (cfg, skips) =
            parse_variant("{ prop: 'size', defaultVariant: 'lg', variants: selectSizes }");
        assert!(plain(&cfg.variants).as_object().is_some_and(Map::is_empty), "{:?}", cfg.variants);
        assert_eq!(cfg.default_variant.as_deref(), Some("lg"));
        assert_eq!(cfg.prop, "size");
        assert_eq!(skips.len(), 1, "{:?}", skips);
        assert_eq!(skips[0].key, "variants");
        assert!(
            skips[0].reason.contains("variant map (non-static)"),
            "{}",
            skips[0].reason
        );
    }

    #[test]
    fn variant_spread_map_records_skip_instead_of_silent_empty() {
        let (cfg, skips) =
            parse_variant("{ prop: 'size', defaultVariant: 'lg', variants: { ...sizes } }");
        assert!(plain(&cfg.variants).as_object().is_some_and(Map::is_empty), "{:?}", cfg.variants);
        assert_eq!(cfg.default_variant.as_deref(), Some("lg"));
        assert_eq!(skips.len(), 1, "{:?}", skips);
        assert_eq!(skips[0].key, "variants");
        assert!(
            skips[0].reason.contains("variant map spread (non-static)"),
            "{}",
            skips[0].reason
        );
    }

    #[test]
    fn variant_config_spread_records_skip_instead_of_silent_absence() {
        let (cfg, skips) = parse_variant("{ ...cfg }");
        assert!(plain(&cfg.variants).as_object().is_some_and(Map::is_empty), "{:?}", cfg.variants);
        assert_eq!(cfg.default_variant, None);
        assert_eq!(skips.len(), 1, "{:?}", skips);
        assert_eq!(skips[0].key, "variant config");
        assert!(
            skips[0].reason.contains("variant config spread (non-static)"),
            "{}",
            skips[0].reason
        );
    }

    #[test]
    fn variant_spread_alongside_literal_options_still_records_the_spread() {
        let (cfg, skips) =
            parse_variant("{ prop: 'size', variants: { sm: { p: 8 }, ...rest } }");
        assert_eq!(plain(&cfg.variants).as_object().map_or(0, Map::len), 1);
        assert_eq!(skips.len(), 1, "{:?}", skips);
        assert!(
            skips[0].reason.contains("variant map spread (non-static)"),
            "{}",
            skips[0].reason
        );
    }

    #[test]
    fn variant_literal_map_records_no_extra_skip() {
        let (cfg, skips) = parse_variant(
            "{ prop: 'size', defaultVariant: 'lg', base: { p: 4 }, variants: { sm: { p: 8 }, lg: { p: 16 } } }",
        );
        assert_eq!(plain(&cfg.variants).as_object().map_or(0, Map::len), 2);
        assert!(cfg.base.is_some());
        assert!(skips.is_empty(), "{:?}", skips);
    }

    #[test]
    fn variant_non_literal_prop_default_and_base_record_skips() {
        let (cfg, skips) = parse_variant(
            "{ prop: propName, defaultVariant: fallback, base: sharedBase, variants: {} }",
        );
        assert_eq!(cfg.prop, "variant");
        assert!(cfg.default_variant.is_none());
        assert!(cfg.base.is_none());
        let keys: Vec<&str> = skips.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(skips.len(), 3, "{:?}", skips);
        assert!(keys.contains(&"prop"), "{:?}", skips);
        assert!(keys.contains(&"defaultVariant"), "{:?}", skips);
        assert!(keys.contains(&"base"), "{:?}", skips);
        assert!(
            skips.iter().all(|s| s.reason.contains("non-static")),
            "{:?}",
            skips
        );
    }

    #[test]
    fn eval_simple_object() {
        let val = parse_obj(r#"{ p: 0, display: 'inline-flex', borderRadius: 4 }"#);
        assert_eq!(val["p"], 0);
        assert_eq!(val["display"], "inline-flex");
        assert_eq!(val["borderRadius"], 4);
    }

    #[test]
    fn eval_nested_pseudo() {
        let val = parse_obj(r#"{ '&:hover': { color: 'primary' } }"#);
        assert_eq!(val["&:hover"]["color"], "primary");
    }

    #[test]
    fn eval_responsive_object() {
        let val = parse_obj(r#"{ fontSize: { _: 16, xs: 18 } }"#);
        assert_eq!(val["fontSize"]["_"], 16);
        assert_eq!(val["fontSize"]["xs"], 18);
    }

    #[test]
    fn eval_string_keys() {
        let val = parse_obj(r#"{ '&:nth-child(even)': { bg: 'muted' } }"#);
        assert_eq!(val["&:nth-child(even)"]["bg"], "muted");
    }

    #[test]
    fn eval_negative_number() {
        let val = parse_obj(r#"{ top: -1 }"#);
        assert_eq!(val["top"], -1);
    }

    #[test]
    fn eval_boolean_value() {
        let val = parse_obj(r#"{ hidden: true }"#);
        assert_eq!(val["hidden"], true);
    }

    #[test]
    fn eval_array_value() {
        let val = parse_obj(r#"{ p: [8, 12, 16] }"#);
        let arr = val["p"].as_array().unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0], 8);
    }

    #[test]
    fn eval_static_template_literal() {
        let val = parse_obj(r#"{ content: '""' }"#);
        assert_eq!(val["content"], "\"\"");
    }

    #[test]
    fn skip_variable_reference_keep_others() {
        let (val, skips) = parse_obj_full(r#"{ color: someVariable, display: 'flex' }"#);
        assert_eq!(val["display"], "flex");
        assert!(val.get("color").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "color");
        assert!(skips[0].reason.contains("non-static"));
    }

    #[test]
    fn skip_function_call_keep_others() {
        let (val, skips) = parse_obj_full(r#"{ background: arr.join(''), p: 16 }"#);
        assert_eq!(val["p"], 16);
        assert!(val.get("background").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "background");
    }

    #[test]
    fn skip_template_with_expression_keep_others() {
        let (val, skips) = parse_obj_full("{ animation: `${flow} 5s`, opacity: 1 }");
        assert_eq!(val["opacity"], 1);
        assert!(val.get("animation").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "animation");
    }

    #[test]
    fn skip_member_expression_keep_others() {
        let (val, skips) = parse_obj_full(r#"{ color: theme.colors.primary, padding: '8px' }"#);
        assert_eq!(val["padding"], "8px");
        assert!(val.get("color").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "color");
    }

    #[test]
    fn skip_all_non_static_returns_empty() {
        let (val, skips) = parse_obj_full(r#"{ bg: dynamicA, color: dynamicB }"#);
        assert_eq!(val.as_object().unwrap().len(), 0);
        assert_eq!(skips.len(), 2);
    }

    #[test]
    fn skip_inside_pseudo_selector() {
        let (val, skips) = parse_obj_full(r#"{ '&:hover': { color: dynamicVar, bg: 'red' } }"#);
        assert_eq!(val["&:hover"]["bg"], "red");
        assert!(val["&:hover"].get("color").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "color");
    }

    #[test]
    fn skip_non_static_pseudo_value() {
        let (val, skips) = parse_obj_full(r#"{ '&:hover': someFunction(), color: 'red' }"#);
        assert_eq!(val["color"], "red");
        assert!(val.get("&:hover").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "&:hover");
    }

    #[test]
    fn spread_inside_nested_skips_parent() {
        let (val, skips) = parse_obj_full(r#"{ '&:hover': { ...hoverOverrides, bg: 'red' }, color: 'blue' }"#);
        assert_eq!(val["color"], "blue");
        assert!(val.get("&:hover").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "&:hover");
        assert!(skips[0].reason.contains("spread"));
    }

    #[test]
    fn bail_on_spread() {
        let reason = parse_obj_err(r#"{ ...baseStyles }"#);
        assert!(reason.contains("spread"));
    }

    #[test]
    fn bail_on_spread_even_with_static_props() {
        let reason = parse_obj_err(r#"{ ...baseStyles, color: 'red' }"#);
        assert!(reason.contains("spread"));
    }

    #[test]
    fn capture_arrow_on_transform_field() {
        let (val, skips, captured) = parse_obj_all(
            r#"{ property: 'flexBasis', transform: (v) => v + 'px' }"#,
        );
        assert_eq!(val["property"], "flexBasis");
        assert!(val.get("transform").is_none());
        assert_eq!(skips.len(), 0);
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].key, "transform");
    }

    #[test]
    fn capture_function_expr_on_transform_field() {
        let (val, _skips, captured) = parse_obj_all(
            r#"{ property: 'gap', transform: function(v) { return v + 'px'; } }"#,
        );
        assert_eq!(val["property"], "gap");
        assert!(val.get("transform").is_none());
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].key, "transform");
    }

    #[test]
    fn identifier_on_transform_field_still_skips() {
        let (val, skips, captured) = parse_obj_all(
            r#"{ property: 'flexBasis', transform: myTransform }"#,
        );
        assert_eq!(val["property"], "flexBasis");
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "transform");
        assert!(skips[0].reason.contains("non-static"));
        assert_eq!(captured.len(), 0);
    }

    #[test]
    fn string_literal_on_transform_field_still_evaluates() {
        let (val, skips, captured) = parse_obj_all(
            r#"{ property: 'flexBasis', transform: 'size' }"#,
        );
        assert_eq!(val["property"], "flexBasis");
        assert_eq!(val["transform"], "size");
        assert_eq!(skips.len(), 0);
        assert_eq!(captured.len(), 0);
    }

    #[test]
    fn arrow_on_non_transform_field_still_bails() {
        let (val, skips, captured) = parse_obj_all(
            r#"{ property: 'flexBasis', scale: (v) => v * 2 }"#,
        );
        assert_eq!(val["property"], "flexBasis");
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "scale");
        assert!(skips[0].reason.contains("arrow function"));
        assert_eq!(captured.len(), 0);
    }

    #[test]
    fn nested_object_with_transform_capture_prefixes_key() {
        let (val, skips, captured) = parse_obj_all(
            r#"{ sizing: { property: 'flexBasis', transform: (v) => v + 'px' } }"#,
        );
        assert_eq!(val["sizing"]["property"], "flexBasis");
        assert!(val["sizing"].get("transform").is_none());
        assert_eq!(skips.len(), 0);
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].key, "sizing.transform");
    }

    #[test]
    fn multiple_nested_transforms_captured() {
        let (val, _skips, captured) = parse_obj_all(
            r#"{ sizing: { property: 'flexBasis', transform: (v) => v + 'px' }, ratio: { property: 'width', transform: (v) => v * 100 + '%' } }"#,
        );
        assert_eq!(val["sizing"]["property"], "flexBasis");
        assert_eq!(val["ratio"]["property"], "width");
        assert_eq!(captured.len(), 2);
        let keys: Vec<&str> = captured.iter().map(|c| c.key.as_str()).collect();
        assert!(keys.contains(&"sizing.transform"));
        assert!(keys.contains(&"ratio.transform"));
    }

    #[test]
    fn intra_file_numeric_const_resolution() {
        let source = r#"const GAP = 16;
const Component = { gap: GAP };"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = plain_map(collect_static_values(result_program, "test.ts"));
        assert_eq!(values.get("GAP"), Some(&Value::Number(16.into())));
    }

    #[test]
    fn intra_file_string_const_resolution() {
        let source = r#"const COLOR = 'red';"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = plain_map(collect_static_values(result_program, "test.ts"));
        assert_eq!(values.get("COLOR"), Some(&Value::String("red".to_string())));
    }

    #[test]
    fn non_static_const_not_collected() {
        let source = r#"const val = getSpacing();"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = plain_map(collect_static_values(result_program, "test.ts"));
        assert!(!values.contains_key("val"));
    }

    #[test]
    fn let_declaration_not_collected() {
        let source = r#"let gap = 16;"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = plain_map(collect_static_values(result_program, "test.ts"));
        assert!(!values.contains_key("gap"));
    }

    #[test]
    fn const_object_collected() {
        let source = r#"const config = { gap: 16, display: 'flex' };"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = plain_map(collect_static_values(result_program, "test.ts"));
        let config = &values["config"];
        assert_eq!(config["gap"], 16);
        assert_eq!(config["display"], "flex");
    }

    #[test]
    fn identifier_resolved_via_static_values() {
        let mut sv = FxHashMap::default();
        sv.insert("GAP".to_string(), Value::Number(16.into()));

        let (val, skips, _) = parse_obj_with_statics("{ gap: GAP }", Some(&sv));
        assert_eq!(val["gap"], 16);
        assert!(skips.is_empty());
    }

    #[test]
    fn identifier_not_in_static_values_skips() {
        let sv = FxHashMap::default();

        let (_, skips, _) = parse_obj_with_statics("{ gap: UNKNOWN }", Some(&sv));
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "gap");
    }

    #[test]
    fn exported_const_collected() {
        let source = r#"export const SPACING = 8;"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = plain_map(collect_static_values(result_program, "test.ts"));
        assert_eq!(values.get("SPACING"), Some(&Value::Number(8.into())));
    }

    #[test]
    fn member_expression_resolved_via_static_values_object() {
        let mut sv = FxHashMap::default();
        let mut motion = Map::new();
        motion.insert("ember".to_string(), Value::String("animus-kf-abc".to_string()));
        motion.insert("flow".to_string(), Value::String("animus-kf-xyz".to_string()));
        sv.insert("motion".to_string(), Value::Object(motion));

        let (val, skips, _) =
            parse_obj_with_statics("{ animationName: motion.ember }", Some(&sv));
        assert_eq!(val["animationName"], "animus-kf-abc");
        assert!(skips.is_empty());
    }

    #[test]
    fn member_expression_unknown_key_skips() {
        let mut sv = FxHashMap::default();
        let mut motion = Map::new();
        motion.insert("ember".to_string(), Value::String("animus-kf-abc".to_string()));
        sv.insert("motion".to_string(), Value::Object(motion));

        let (val, skips, _) =
            parse_obj_with_statics("{ animationName: motion.unknown }", Some(&sv));
        assert!(val.get("animationName").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "animationName");
    }

    #[test]
    fn member_expression_base_not_in_statics_skips() {
        let sv = FxHashMap::default();
        let (val, skips, _) =
            parse_obj_with_statics("{ animationName: motion.ember }", Some(&sv));
        assert!(val.get("animationName").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "animationName");
    }

    #[test]
    fn member_expression_falls_back_when_base_is_not_object() {
        let mut sv = FxHashMap::default();
        sv.insert("GAP".to_string(), Value::Number(16.into()));
        let (val, skips, _) =
            parse_obj_with_statics("{ animationName: GAP.nested }", Some(&sv));
        assert!(val.get("animationName").is_none());
        assert_eq!(skips.len(), 1);
    }

    #[test]
    fn member_expression_keeps_other_static_props() {
        let mut sv = FxHashMap::default();
        let mut motion = Map::new();
        motion.insert("ember".to_string(), Value::String("animus-kf-abc".to_string()));
        sv.insert("motion".to_string(), Value::Object(motion));

        let (val, skips, _) = parse_obj_with_statics(
            "{ animationName: motion.ember, animationDuration: '5s' }",
            Some(&sv),
        );
        assert_eq!(val["animationName"], "animus-kf-abc");
        assert_eq!(val["animationDuration"], "5s");
        assert!(skips.is_empty());
    }

    #[test]
    fn member_expression_skip_codes_an_unregistered_collection_and_names_the_repair() {
        let sv = FxHashMap::default();
        let (_, skips, _) = parse_obj_with_statics("{ animationName: motion.pulse }", Some(&sv));
        assert_eq!(skips.len(), 1, "{:?}", skips);
        let reason = &skips[0].reason;
        assert!(
            reason.contains("member expression 'motion.pulse'"),
            "{reason}"
        );
        assert!(reason.contains("non-static"), "{reason}");
        assert!(
            reason.contains("is neither a registered keyframe collection"),
            "{reason}"
        );
        assert!(
            reason.contains("register it on the system between build() and seal()"),
            "{reason}"
        );
        assert!(
            reason.contains("the registration key must equal the export name"),
            "{reason}"
        );
        assert!(
            reason.ends_with(&format!("({KEYFRAMES_UNREGISTERED_REFERENCE})")),
            "{reason}"
        );
        assert_eq!(
            crate::analyze_css::diagnostic_code_from_message(reason).as_deref(),
            Some(KEYFRAMES_UNREGISTERED_REFERENCE),
            "{reason}"
        );
    }

    #[test]
    fn keyframes_code_is_scoped_to_animation_name_properties() {
        let sv = FxHashMap::default();
        let (_, skips, _) = parse_obj_with_statics("{ color: palette.brand }", Some(&sv));
        assert_eq!(skips.len(), 1, "{:?}", skips);
        let reason = &skips[0].reason;
        assert!(
            reason.contains("member expression 'palette.brand'"),
            "{reason}"
        );
        assert!(
            reason.contains("'palette' is not an extraction-time static binding"),
            "{reason}"
        );
        assert!(
            !reason.contains("keyframe") && !reason.contains("build() and seal()"),
            "keyframes advice must not leak onto unrelated properties: {reason}"
        );
        assert_eq!(
            crate::analyze_css::diagnostic_code_from_message(reason),
            None,
            "{reason}"
        );
    }

    #[test]
    fn keyframes_code_fires_through_the_responsive_form() {
        let sv = FxHashMap::default();
        let (_, skips, _) =
            parse_obj_with_statics("{ animationName: { _: motion.pulse } }", Some(&sv));
        assert_eq!(skips.len(), 1, "{:?}", skips);
        let reason = &skips[0].reason;
        assert_eq!(
            crate::analyze_css::diagnostic_code_from_message(reason).as_deref(),
            Some(KEYFRAMES_UNREGISTERED_REFERENCE),
            "{reason}"
        );
    }

    #[test]
    fn responsive_form_of_an_unrelated_property_stays_uncoded() {
        let sv = FxHashMap::default();
        let (_, skips, _) =
            parse_obj_with_statics("{ color: { _: palette.brand } }", Some(&sv));
        assert_eq!(skips.len(), 1, "{:?}", skips);
        let reason = &skips[0].reason;
        assert!(
            reason.contains("'palette' is not an extraction-time static binding"),
            "{reason}"
        );
        assert_eq!(
            crate::analyze_css::diagnostic_code_from_message(reason),
            None,
            "{reason}"
        );
    }

    #[test]
    fn member_expression_skip_names_a_missing_member_of_a_registered_collection() {
        let mut sv = FxHashMap::default();
        let mut motion = Map::new();
        motion.insert("ember".to_string(), Value::String("animus-kf-abc".to_string()));
        sv.insert("motion".to_string(), Value::Object(motion));

        let (_, skips, _) = parse_obj_with_statics("{ animationName: motion.pulse }", Some(&sv));
        assert_eq!(skips.len(), 1, "{:?}", skips);
        let reason = &skips[0].reason;
        assert!(
            reason.contains("member expression 'motion.pulse'"),
            "{reason}"
        );
        assert!(
            reason.contains("registered collection with no 'pulse' member"),
            "{reason}"
        );
        assert_eq!(
            crate::analyze_css::diagnostic_code_from_message(reason),
            None,
            "{reason}"
        );
    }

    #[test]
    fn member_expression_skip_without_statics_reports_missing_context() {
        let (_, skips) = parse_obj_full("{ animationName: motion.pulse }");
        assert_eq!(skips.len(), 1, "{:?}", skips);
        let reason = &skips[0].reason;
        assert!(
            reason.contains("member expression 'motion.pulse'"),
            "{reason}"
        );
        assert!(
            reason.contains("evaluated without extraction-time statics"),
            "{reason}"
        );
        assert_eq!(
            crate::analyze_css::diagnostic_code_from_message(reason),
            None,
            "{reason}"
        );
    }

    #[test]
    fn computed_member_expression_keeps_the_bare_reason() {
        let (_, skips) = parse_obj_full("{ animationName: motion[key] }");
        assert_eq!(skips.len(), 1, "{:?}", skips);
        assert_eq!(skips[0].reason, "member expression (non-static)");
    }

    fn parse_obj_with_statics(
        source: &str,
        sv: Option<&FxHashMap<String, Value>>,
    ) -> (Value, Vec<SkippedProperty>, Vec<CapturedTransform>) {
        let ast = parse_ts(format!("const x = {};", source));
        let program = ast.program();

        if let Some(Statement::VariableDeclaration(decl)) = program.body.first() {
            if let Some(declarator) = decl.declarations.first() {
                if let Some(Expression::ObjectExpression(obj)) = &declarator.init {
                    let typed = sv.map(statics_of);
                    let (value, skips, captures) =
                        eval_object_expr_with_statics(obj, typed.as_ref().map(|typed| Statics::of(typed, "test.ts"))).unwrap();
                    return (plain(&value), skips, captures);
                }
            }
        }
        panic!("failed to parse test object");
    }

    #[test]
    fn variant_map_resolves_from_statics() {
        let mut sv = FxHashMap::default();
        sv.insert(
            "sizes".to_string(),
            serde_json::json!({ "sm": { "height": 32 }, "md": { "height": 40 } }),
        );
        sv.insert("emphasis".to_string(), serde_json::json!({ "fontWeight": 700 }));
        let (cfg, skips) = parse_variant_with_statics(
            "{ prop: 'size', defaultVariant: 'md', base: emphasis, variants: sizes }",
            Some(&sv),
        );
        assert!(skips.is_empty(), "{:?}", skips);
        assert_eq!(cfg.prop, "size");
        assert_eq!(cfg.default_variant.as_deref(), Some("md"));
        assert_eq!(cfg.base.as_ref().map(plain), Some(serde_json::json!({ "fontWeight": 700 })));
        assert_eq!(plain(&cfg.variants).as_object().map_or(0, Map::len), 2);
        assert_eq!(plain(&cfg.variants)["sm"], serde_json::json!({ "height": 32 }));

        let (cfg2, skips2) = parse_variant(
            "{ prop: 'size', defaultVariant: 'md', variants: sizes }",
        );
        assert!(plain(&cfg2.variants).as_object().is_some_and(Map::is_empty));
        assert_eq!(skips2.len(), 1);
        assert!(skips2[0].reason.contains("variant map (non-static)"));
    }

    #[test]
    fn as_const_declarations_collect_into_statics() {
        let ast = parse_ts(
            "const sizes = { sm: { height: 32 } } as const;\nconst gap = 16 as const;\nconst theme = { gap: 8 } satisfies Record<string, number>;\n".to_string(),
        );
        let statics = plain_map(collect_static_values(ast.program(), "test.ts"));
        assert_eq!(
            statics.get("sizes"),
            Some(&serde_json::json!({ "sm": { "height": 32 } }))
        );
        assert_eq!(statics.get("gap"), Some(&serde_json::json!(16)));
        assert_eq!(statics.get("theme"), Some(&serde_json::json!({ "gap": 8 })));
    }

    #[test]
    fn wrapped_values_evaluate_like_their_operands() {
        let (val, skips) = parse_obj_full(
            "{ gap: (8), color: 'red' as const, width: 4 as number }",
        );
        assert!(skips.is_empty(), "{:?}", skips);
        assert_eq!(val["gap"], 8);
        assert_eq!(val["color"], "red");
        assert_eq!(val["width"], 4);
    }

    #[test]
    fn unsupported_selector_key_predicate() {
        assert!(unsupported_selector_key(r#"[data-x="a&b"]"#));
        assert!(unsupported_selector_key("[data-x='&']"));
        assert!(!unsupported_selector_key(r#"[aria-sort="ascending"] &"#));
        assert!(!unsupported_selector_key(".group:hover &"));
        assert!(!unsupported_selector_key("&:hover"));
        assert!(!unsupported_selector_key("& + &"));
        assert!(!unsupported_selector_key("color"));
        assert!(!unsupported_selector_key("_hover"));
        assert!(!unsupported_selector_key(r#"@scope ([data-x="&"])"#));
    }

    #[test]
    fn quoted_only_subject_key_records_coded_skip_and_omits_property() {
        let (val, skips) = parse_obj_full(
            r#"{ '[data-x="a&b"]': { color: 'red' }, color: 'blue' }"#,
        );
        assert_eq!(skips.len(), 1, "{:?}", skips);
        assert!(
            skips[0].reason.contains(SELECTOR_UNSUPPORTED_SUBJECT),
            "{}",
            skips[0].reason
        );
        let obj = val.as_object().unwrap();
        assert!(!obj.contains_key(r#"[data-x="a&b"]"#));
        assert_eq!(obj.get("color"), Some(&Value::String("blue".into())));
    }

    #[test]
    fn ancestor_and_repeated_subject_keys_flow_through() {
        let (val, skips) = parse_obj_full(
            r#"{ '[aria-sort="ascending"] &': { color: 'red' }, '&:hover': { color: 'blue' }, '& + &': { gap: 4 }, '&:hover': { '.parent &': { color: 'green' } } }"#,
        );
        assert!(skips.is_empty(), "{:?}", skips);
        let obj = val.as_object().unwrap();
        assert!(obj.contains_key(r#"[aria-sort="ascending"] &"#));
        assert!(obj.contains_key("& + &"));
        let hover = obj.get("&:hover").unwrap().as_object().unwrap();
        assert!(hover.contains_key(".parent &"));
    }
}
