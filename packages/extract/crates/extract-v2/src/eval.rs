//! Stage-argument evaluation into JSON values, with per-property skips for
//! non-static values and captured `transform` functions.

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, Declaration, Expression, ObjectExpression, ObjectPropertyKind,
    Program, PropertyKey, PropertyKind, Statement, UnaryOperator, VariableDeclarationKind,
};
use oxc::span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::{Map, Value};

#[derive(Debug)]
pub struct BailError {
    pub reason: String,
}

impl BailError {
    fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SkippedProperty {
    pub key: String,
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
) -> Result<(Value, Vec<SkippedProperty>, Vec<CapturedTransform>), BailError> {
    eval_object_expr_with_statics(obj, None)
}

pub fn eval_object_expr_with_statics(
    obj: &ObjectExpression<'_>,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<(Value, Vec<SkippedProperty>, Vec<CapturedTransform>), BailError> {
    eval_object_expr_scoped(obj, static_values, false)
}

fn eval_object_expr_scoped(
    obj: &ObjectExpression<'_>,
    static_values: Option<&FxHashMap<String, Value>>,
    keyframes_eligible: bool,
) -> Result<(Value, Vec<SkippedProperty>, Vec<CapturedTransform>), BailError> {
    let mut map = Map::new();
    let mut skipped = Vec::new();
    let mut captured = Vec::new();
    // Keys a spread overwrote with a lost value: each keeps its position
    // until a later known write fills it, and is dropped if none does.
    let mut tombstones = FxHashSet::default();

    for prop_kind in &obj.properties {
        match prop_kind {
            ObjectPropertyKind::ObjectProperty(prop) => {
                if prop.kind != PropertyKind::Init {
                    return Err(BailError::new("getter/setter in style object"));
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
                            map.insert(key, value);
                        }
                        Err(bail) => {
                            skipped.push(SkippedProperty {
                                key,
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
                        map.insert(key, value);
                    }
                    Err(bail) => {
                        skipped.push(SkippedProperty {
                            key,
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
                for (mut path, reason) in take_lost_segments(&mut spread_value) {
                    let key = path.pop().unwrap_or_default();
                    if path.is_empty() {
                        map.insert(key.clone(), Value::Null);
                        tombstones.insert(key.clone());
                    }
                    skipped.push(SkippedProperty {
                        key,
                        reason,
                        parent: (!path.is_empty()).then(|| path.join(".")),
                        span: span_of(spread.span),
                    });
                }
                if let Value::Object(entries) = spread_value {
                    for (key, value) in entries {
                        tombstones.remove(&key);
                        map.insert(key, value);
                    }
                }
            }
        }
    }

    map.retain(|key, _| !tombstones.contains(key));
    Ok((Value::Object(map), skipped, captured))
}

/// A computed key whose value is a constant string: a string or an
/// expression-free template literal, or a static binding or member that
/// holds a string. A key read from a lost value bails with its reason.
fn computed_key(
    key: &PropertyKey<'_>,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<String, BailError> {
    let unsupported = || BailError::new("computed property key in style object");
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
            if let Some(reason) = lost_path_reason(other, statics) {
                return Err(BailError::new(format!("computed property key in style object — {reason}")));
            }
            match static_path_value(other, statics) {
                Some(Value::String(text)) => Ok(text.clone()),
                _ => Err(unsupported()),
            }
        }
    }
}

/// The static value an identifier, or a member path from one, names:
/// `preset`, `presets.pixel`, `presets['pixel']`. `None` for anything else,
/// and for a member a lost-value marker stands in for.
pub(crate) fn static_path_value<'v>(
    expr: &Expression<'_>,
    static_values: &'v FxHashMap<String, Value>,
) -> Option<&'v Value> {
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::Identifier(ident) => static_values
            .get(ident.name.as_str())
            .filter(|value| asset_function(value).is_none()),
        Expression::StaticMemberExpression(member) => {
            let parent = static_path_value(&member.object, static_values)?;
            lost_value_reason(parent).is_none().then_some(())?;
            parent
                .as_object()?
                .get(member.property.name.as_str())
                .filter(|value| lost_value_reason(value).is_none())
        }
        Expression::ComputedMemberExpression(member) => {
            let key = match crate::chain_walk::unwrap_type_assertions(&member.expression) {
                Expression::StringLiteral(lit) => lit.value.to_string(),
                other => static_path_value(other, static_values)?.as_str()?.to_string(),
            };
            let parent = static_path_value(&member.object, static_values)?;
            lost_value_reason(parent).is_none().then_some(())?;
            parent.as_object()?.get(&key).filter(|value| lost_value_reason(value).is_none())
        }
        _ => None,
    }
}

/// The reason of the lost-value marker an identifier or member path meets.
fn lost_path_reason<'v>(expr: &Expression<'_>, static_values: &'v FxHashMap<String, Value>) -> Option<&'v str> {
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::Identifier(ident) => lost_value_reason(static_values.get(ident.name.as_str())?),
        Expression::StaticMemberExpression(member) => lost_path_reason(&member.object, static_values).or_else(|| {
            let parent = static_path_value(&member.object, static_values)?;
            lost_value_reason(parent.get(member.property.name.as_str())?)
        }),
        Expression::ComputedMemberExpression(member) => lost_path_reason(&member.object, static_values)
            .or_else(|| lost_path_reason(&member.expression, static_values)),
        _ => None,
    }
}

/// The static object a spread argument names, or why it names none. An
/// object whose stability the analysis could not prove is a marker naming
/// the use that makes it unstable.
fn static_object_at(
    expr: &Expression<'_>,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<Value, BailError> {
    if let Some(reason) = static_values.and_then(|sv| lost_path_reason(expr, sv)) {
        return Err(BailError::new(format!("spread of {reason}")));
    }
    match static_values.and_then(|sv| static_path_value(expr, sv)) {
        Some(value) if value.is_object() => Ok(value.clone()),
        Some(_) => Err(BailError::new("spread of a static value that is no object")),
        None => Err(BailError::new("spread element in style object")),
    }
}

fn eval_property_key(key: &PropertyKey<'_>) -> Result<String, BailError> {
    match key {
        PropertyKey::StaticIdentifier(id) => Ok(id.name.to_string()),
        PropertyKey::StringLiteral(lit) => Ok(lit.value.to_string()),
        PropertyKey::NumericLiteral(lit) => Ok(lit.value.to_string()),
        _ => Err(BailError::new("non-static property key")),
    }
}

fn eval_expression(
    expr: &Expression<'_>,
    skips: &mut Vec<SkippedProperty>,
) -> Result<Value, BailError> {
    eval_expression_with_statics(expr, skips, None)
}

pub(crate) fn eval_expression_with_statics(
    expr: &Expression<'_>,
    skips: &mut Vec<SkippedProperty>,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<Value, BailError> {
    eval_expression_scoped(expr, skips, static_values, false)
}

fn eval_expression_scoped(
    expr: &Expression<'_>,
    skips: &mut Vec<SkippedProperty>,
    static_values: Option<&FxHashMap<String, Value>>,
    keyframes_eligible: bool,
) -> Result<Value, BailError> {
    let expr = crate::chain_walk::unwrap_type_assertions(expr);
    match expr {
        Expression::StringLiteral(lit) => Ok(Value::String(lit.value.to_string())),

        Expression::NumericLiteral(lit) => {
            if lit.value.fract() == 0.0 && lit.value.abs() < (i64::MAX as f64) {
                Ok(Value::Number(
                    serde_json::Number::from(lit.value as i64),
                ))
            } else {
                Ok(Value::Number(
                    serde_json::Number::from_f64(lit.value)
                        .unwrap_or_else(|| serde_json::Number::from(0)),
                ))
            }
        }

        Expression::BooleanLiteral(lit) => Ok(Value::Bool(lit.value)),

        Expression::NullLiteral(_) => Ok(Value::Null),

        Expression::UnaryExpression(unary) => {
            if unary.operator == oxc::syntax::operator::UnaryOperator::UnaryNegation {
                if let Expression::NumericLiteral(lit) = &unary.argument {
                    let val = -lit.value;
                    if val.fract() == 0.0 && val.abs() < (i64::MAX as f64) {
                        return Ok(Value::Number(serde_json::Number::from(val as i64)));
                    } else {
                        return Ok(Value::Number(
                            serde_json::Number::from_f64(val)
                                .unwrap_or_else(|| serde_json::Number::from(0)),
                        ));
                    }
                }
            }
            Err(BailError::new("non-static unary expression"))
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
            Ok(Value::Array(values))
        }

        Expression::TemplateLiteral(tpl) => {
            if tpl.expressions.is_empty() {
                if let Some(quasi) = tpl.quasis.first() {
                    return Ok(Value::String(quasi.value.raw.to_string()));
                }
            }
            eval_asset_template(tpl, static_values, keyframes_eligible).ok_or_else(|| {
                BailError::new("template literal with expressions (non-static)")
            })
        }

        Expression::Identifier(ident) => {
            if let Some(sv) = static_values {
                if let Some(val) = sv.get(ident.name.as_str()).filter(|val| asset_function(val).is_none()) {
                    return Ok(val.clone());
                }
            }
            Err(BailError::new("variable reference (non-static)"))
        }
        Expression::CallExpression(call) => eval_asset_call(call, static_values)
            .unwrap_or_else(|| Err(BailError::new("function call (non-static)"))),
        Expression::ArrowFunctionExpression(_) => {
            Err(BailError::new("arrow function (non-static)"))
        }
        Expression::FunctionExpression(_) => Err(BailError::new("function (non-static)")),
        Expression::TaggedTemplateExpression(_) => {
            Err(BailError::new("tagged template (non-static)"))
        }
        Expression::StaticMemberExpression(member) => {
            if let Some(val) = static_values.and_then(|sv| static_path_value(expr, sv)) {
                return Ok(val.clone());
            }
            Err(BailError::new(member_expression_skip_reason(
                &member.object,
                member.property.name.as_str(),
                static_values,
                keyframes_eligible,
            )))
        }
        Expression::ComputedMemberExpression(_) => static_values
            .and_then(|sv| static_path_value(expr, sv))
            .cloned()
            .ok_or_else(|| BailError::new("member expression (non-static)")),

        _ => Err(BailError::new("unsupported expression type")),
    }
}

fn member_expression_skip_reason(
    object: &Expression<'_>,
    property: &str,
    static_values: Option<&FxHashMap<String, Value>>,
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
    match sv.get(base) {
        Some(value) if lost_value_reason(value).is_some() => {
            format!("{named} — {}", lost_value_reason(value).unwrap_or_default())
        }
        Some(Value::Object(_)) => format!(
            "{named} — '{base}' is a registered collection with no '{property}' member"
        ),
        Some(_) => format!("{named} — '{base}' is not an object binding"),
        None if keyframes_eligible => format!(
            "{named} — '{base}' is neither a registered keyframe collection nor an extraction-time static binding; if it is a keyframe collection, register it on the system between build() and seal() under the key '{base}' — the registration key must equal the export name ({KEYFRAMES_UNREGISTERED_REFERENCE})"
        ),
        None => format!("{named} — '{base}' is not an extraction-time static binding"),
    }
}

fn eval_array_element(elem: &ArrayExpressionElement<'_>) -> Result<Value, BailError> {
    match elem {
        ArrayExpressionElement::StringLiteral(lit) => Ok(Value::String(lit.value.to_string())),
        ArrayExpressionElement::NumericLiteral(lit) => {
            if lit.value.fract() == 0.0 && lit.value.abs() < (i64::MAX as f64) {
                Ok(Value::Number(serde_json::Number::from(lit.value as i64)))
            } else {
                Ok(Value::Number(
                    serde_json::Number::from_f64(lit.value)
                        .unwrap_or_else(|| serde_json::Number::from(0)),
                ))
            }
        }
        ArrayExpressionElement::BooleanLiteral(lit) => Ok(Value::Bool(lit.value)),
        ArrayExpressionElement::NullLiteral(_) => Ok(Value::Null),
        ArrayExpressionElement::ObjectExpression(obj) => {
            eval_object_expr(obj).map(|(val, _skips, _captures)| val)
        }
        ArrayExpressionElement::ArrayExpression(arr) => {
            let mut values = Vec::new();
            for inner in &arr.elements {
                match inner {
                    ArrayExpressionElement::Elision(_) => values.push(Value::Null),
                    ArrayExpressionElement::SpreadElement(_) => {
                        return Err(BailError::new("spread in nested array"))
                    }
                    other => values.push(eval_array_element(other)?),
                }
            }
            Ok(Value::Array(values))
        }
        ArrayExpressionElement::Identifier(_) => {
            Err(BailError::new("variable reference in array (non-static)"))
        }
        ArrayExpressionElement::CallExpression(_) => {
            Err(BailError::new("function call in array (non-static)"))
        }
        ArrayExpressionElement::SpreadElement(_) => Err(BailError::new("spread in array")),
        ArrayExpressionElement::Elision(_) => Ok(Value::Null),
        _ => Err(BailError::new("unsupported array element")),
    }
}

#[derive(Debug)]
pub struct VariantStageConfig {
    pub prop: String,
    pub default_variant: Option<String>,
    pub base: Option<Value>,
    pub variants: Map<String, Value>,
}

pub fn parse_variant_arg(
    obj: &ObjectExpression<'_>,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<(VariantStageConfig, Vec<SkippedProperty>), BailError> {
    let mut prop = "variant".to_string();
    let mut default_variant = None;
    let mut base = None;
    let mut variants = Map::new();
    let mut all_skips = Vec::new();
    let skip = |key: &str, reason: &str, span: Span| SkippedProperty {
        key: key.to_string(),
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
                        all_skips.push(skip("prop", "variant prop name (non-static)", p.value.span()));
                    }
                }
                "defaultVariant" => {
                    if let Expression::StringLiteral(lit) = &p.value {
                        default_variant = Some(lit.value.to_string());
                    } else {
                        all_skips.push(skip(
                            "defaultVariant",
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
                    } else if let Ok(Value::Object(map)) = eval_expression_with_statics(
                        &p.value,
                        &mut Vec::new(),
                        static_values,
                    ) {
                        base = Some(Value::Object(map));
                    } else {
                        all_skips.push(skip("base", "variant base styles (non-static)", p.value.span()));
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
                                    variants.insert(vkey, vstyles);
                                }
                                ObjectPropertyKind::SpreadProperty(spread) => {
                                    all_skips.push(skip(
                                        "variants",
                                        "variant map spread (non-static)",
                                        spread.span,
                                    ));
                                }
                            }
                        }
                    } else if let Ok(Value::Object(map)) = eval_expression_with_statics(
                        &p.value,
                        &mut Vec::new(),
                        static_values,
                    ) {
                        for (vkey, vstyles) in map {
                            variants.insert(vkey, vstyles);
                        }
                    } else {
                        all_skips.push(skip("variants", "variant map (non-static)", p.value.span()));
                    }
                }
                _ => {}
            }
        } else {
            all_skips.push(skip(
                "variant config",
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
) -> Result<(Map<String, Value>, Vec<SkippedProperty>), BailError> {
    let mut states = Map::new();
    let mut all_skips = Vec::new();

    for prop_kind in &obj.properties {
        match prop_kind {
            ObjectPropertyKind::ObjectProperty(p) => {
                let key = eval_property_key(&p.key)?;
                let mut skips = Vec::new();
                let styles = eval_expression(&p.value, &mut skips)?;
                all_skips.extend(skips);
                states.insert(key, styles);
            }
            ObjectPropertyKind::SpreadProperty(_) => {
                return Err(BailError::new("spread in states config"));
            }
        }
    }

    Ok((states, all_skips))
}

pub fn collect_static_values(program: &Program<'_>) -> FxHashMap<String, Value> {
    collect_static_values_impl(program, false, false)
}

/// The static values of a file in an installed or external package, where a
/// relative `asset()` specifier would resolve from the wrong origin.
pub fn collect_package_static_values(program: &Program<'_>) -> FxHashMap<String, Value> {
    collect_static_values_impl(program, false, true)
}

/// Rejects partially evaluated objects, so an inferred JSX value set can
/// never omit a runtime-reachable member.
pub fn collect_complete_static_values(program: &Program<'_>) -> FxHashMap<String, Value> {
    collect_static_values_impl(program, true, false)
}

fn collect_static_values_impl(
    program: &Program<'_>,
    require_complete: bool,
    in_package: bool,
) -> FxHashMap<String, Value> {
    // Style values may call `asset()`; JSX usage values never read it.
    let assets = if require_complete { FxHashMap::default() } else { asset_bindings(program, in_package) };
    let mut values = assets.clone();
    let undefined_bound = !require_complete && module_binds(program, "undefined");

    for stmt in &program.body {
        let decl = match stmt {
            Statement::VariableDeclaration(decl) if decl.kind == VariableDeclarationKind::Const => {
                decl
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(ref decl)) = export.declaration {
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
                let init = crate::chain_walk::unwrap_type_assertions(init);
                let mut dummy_skips = Vec::new();
                // Style values read earlier consts, as source order runs them;
                // JSX usage values keep reading literals only.
                let scope = if require_complete { &assets } else { &values };
                match init {
                    Expression::ObjectExpression(obj) => {
                        if let Ok((mut val, skips, captures)) = eval_object_expr_scoped(obj, Some(scope), false) {
                            if !require_complete {
                                let lost = LostValueSource {
                                    obj,
                                    name: &name,
                                    undefined_bound,
                                };
                                mark_lost_values(&mut val, &lost, &skips, &captures);
                                values.insert(name, val);
                            } else if skips.is_empty() && captures.is_empty() {
                                values.insert(name, val);
                            }
                        }
                    }
                    _ => {
                        if let Ok(val) = eval_expression_with_statics(init, &mut dummy_skips, Some(scope)) {
                            if !require_complete || dummy_skips.is_empty() {
                                values.insert(name, val);
                            }
                        }
                    }
                }
            }
        }
    }

    values
}

/// Marks a value a const object cannot carry statically — a skipped key or
/// a captured `transform` callback — so whichever stage reads the const can
/// report what it lost. Stage readers take markers with `take_lost_values`
/// or `take_lost_custom_props`; only serialized statics strip them silently.
/// A member read of a marked key is a miss.
const LOST_VALUE: &str = "$animus.lost";

/// Set on a marker for a captured inline `transform` callback, which only a
/// `.props()` config can lose: other stages capture it, as inline.
const LOST_CAPTURE: &str = "$animus.capture";

struct LostValueSource<'s, 'a> {
    obj: &'s ObjectExpression<'a>,
    name: &'s str,
    undefined_bound: bool,
}

fn mark_lost_values(
    value: &mut Value,
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
            format!("an inline function in const '{}'", source.name),
            true,
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
                format!("{} in const '{}'", skip.reason, source.name),
                false,
            );
        }
    }
}

fn mark_lost_value(
    value: &mut Value,
    parent: Option<&str>,
    key: &str,
    reason: String,
    capture: bool,
) {
    let mut current = value;
    for segment in parent.into_iter().flat_map(|path| path.split('.')) {
        match current.get_mut(segment) {
            Some(next) => current = next,
            None => return,
        }
    }
    if let Some(object) = current.as_object_mut() {
        let mut marker = Map::new();
        marker.insert(LOST_VALUE.to_string(), Value::String(reason));
        if capture {
            marker.insert(LOST_CAPTURE.to_string(), Value::Bool(true));
        }
        object.insert(key.to_string(), Value::Object(marker));
    }
}

/// A marker that stands in for a static value no reader may use, saying why.
pub(crate) fn lost_marker(reason: String) -> Value {
    let mut marker = Map::new();
    marker.insert(LOST_VALUE.to_string(), Value::String(reason));
    Value::Object(marker)
}

/// Why a static value is no usable value, when a marker stands in for it.
pub(crate) fn lost_value_reason(value: &Value) -> Option<&str> {
    value.as_object()?.get(LOST_VALUE)?.as_str()
}

/// The static value a dotted path from a binding names, through members
/// no marker stands in for; the last step may be a marker, so a reader can
/// report it.
pub(crate) fn static_path<'v>(statics: &'v FxHashMap<String, Value>, path: &str) -> Option<&'v Value> {
    let mut segments = path.split('.');
    let mut current = statics.get(segments.next()?)?;
    for segment in segments {
        if lost_value_reason(current).is_some() {
            return Some(current);
        }
        current = current.as_object()?.get(segment)?;
    }
    Some(current)
}

/// Among a file's static values, a local bound to `@animus-ui/system`'s
/// `asset`: evaluation calls it, and no read takes it as a value. Its scope
/// says whether a relative specifier may evaluate: in a project file the
/// host resolves it as every relative `asset()` is resolved, from the
/// project root; in a package file that would be the wrong origin.
const ASSET_FUNCTION: &str = "$animus.asset";
const ASSET_IN_PROJECT: &str = "project";
const ASSET_IN_PACKAGE: &str = "package";

/// The placeholder `asset()` returns: the host substitutes the resolved URL.
pub(crate) const ASSET_PLACEHOLDER_PREFIX: &str = "animus-asset:";

/// Whether relative specifiers may evaluate, for a value that is the
/// `asset` function; `None` for any other value.
fn asset_function(value: &Value) -> Option<bool> {
    match value.as_object()?.get(ASSET_FUNCTION)?.as_str()? {
        ASSET_IN_PROJECT => Some(true),
        _ => Some(false),
    }
}

/// A specifier `asset()` resolves against the declaring file's directory.
fn is_relative_specifier(specifier: &str) -> bool {
    specifier.starts_with("./") || specifier.starts_with("../")
}

/// `asset('literal')` through a local bound to the `asset` function, as the
/// placeholder it returns; `None` for any other call.
fn eval_asset_call(
    call: &oxc::ast::ast::CallExpression<'_>,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Option<Result<Value, BailError>> {
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let relative_allowed = asset_function(static_values?.get(callee.name.as_str())?)?;
    let [Argument::StringLiteral(specifier)] = call.arguments.as_slice() else {
        return Some(Err(BailError::new("asset() of a non-literal specifier (non-static)")));
    };
    if is_relative_specifier(&specifier.value) && !relative_allowed {
        return Some(Err(BailError::new(
            "asset() of a relative specifier in a package file, which would resolve from the wrong origin (non-static)",
        )));
    }
    Some(Ok(Value::String(format!("{ASSET_PLACEHOLDER_PREFIX}{}", specifier.value))))
}

/// A template whose every expression is a static string or number and which
/// carries an `asset()` placeholder, as its text. Other templates with
/// expressions stay non-static.
fn eval_asset_template(
    tpl: &oxc::ast::ast::TemplateLiteral<'_>,
    static_values: Option<&FxHashMap<String, Value>>,
    keyframes_eligible: bool,
) -> Option<Value> {
    let mut parts = Vec::with_capacity(tpl.expressions.len());
    for expression in &tpl.expressions {
        let mut skips = Vec::new();
        let part = match eval_expression_scoped(expression, &mut skips, static_values, keyframes_eligible).ok()? {
            Value::String(text) => text,
            Value::Number(number) => number.to_string(),
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
    Some(Value::String(text))
}

/// Whether a value holds an `asset()` placeholder with a relative
/// specifier, which only its own file may use.
pub(crate) fn carries_relative_asset(value: &Value) -> bool {
    match value {
        Value::String(text) => text
            .match_indices(ASSET_PLACEHOLDER_PREFIX)
            .any(|(at, prefix)| is_relative_specifier(&text[at + prefix.len()..])),
        Value::Array(items) => items.iter().any(carries_relative_asset),
        Value::Object(entries) => entries.values().any(carries_relative_asset),
        _ => false,
    }
}

/// The module's locals imported as `asset` from `@animus-ui/system`, bound to
/// the `asset` function for a project or a package file.
fn asset_bindings(program: &Program<'_>, in_package: bool) -> FxHashMap<String, Value> {
    let scope = if in_package { ASSET_IN_PACKAGE } else { ASSET_IN_PROJECT };
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
                        serde_json::json!({ ASSET_FUNCTION: scope }),
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

/// Takes the markers on top-level custom prop configs and their `transform`
/// from a `.props()` value, then takes every other marker as a skip.
pub(crate) fn take_lost_custom_props(value: &mut Value) -> LostCustomProps {
    let mut lost = LostCustomProps::default();
    if let Some(configs) = value.as_object_mut() {
        configs.retain(|prop, config| match lost_value_reason(config) {
            Some(reason) => {
                lost.configs.push((prop.clone(), reason.to_string()));
                false
            }
            None => true,
        });
        for (prop, config) in configs.iter_mut() {
            let Some(config) = config.as_object_mut() else {
                continue;
            };
            let reason = config
                .get("transform")
                .and_then(lost_value_reason)
                .map(str::to_string);
            if let Some(reason) = reason {
                config.remove("transform");
                lost.transforms.push((prop.clone(), reason));
            }
        }
    }
    lost.skipped = take_lost_values(value);
    lost
}

/// Removes the lost-value markers from a stage value reached through a const,
/// returning each lost property, as a dotted path, with its reason. A
/// captured inline `transform` is removed without a skip.
pub(crate) fn take_lost_values(value: &mut Value) -> Vec<(String, String)> {
    take_lost_segments(value)
        .into_iter()
        .map(|(path, reason)| (path.join("."), reason))
        .collect()
}

/// `take_lost_values` with each path as its key segments, since a selector
/// key can itself contain a dot.
fn take_lost_segments(value: &mut Value) -> Vec<(Vec<String>, String)> {
    let mut lost = Vec::new();
    collect_lost_values(value, &[], &mut lost);
    lost
}

fn collect_lost_values(value: &mut Value, path: &[String], lost: &mut Vec<(Vec<String>, String)>) {
    match value {
        Value::Object(map) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                let at = [path, std::slice::from_ref(&key)].concat();
                let Some(child) = map.get_mut(&key) else {
                    continue;
                };
                match lost_value_reason(child).map(str::to_string) {
                    Some(reason) => {
                        if child.get(LOST_CAPTURE).is_none() {
                            lost.push((at, reason));
                        }
                        map.shift_remove(&key);
                    }
                    None => collect_lost_values(child, &at, lost),
                }
            }
        }
        Value::Array(items) => items
            .iter_mut()
            .for_each(|v| collect_lost_values(v, path, lost)),
        _ => {}
    }
}

/// Removes every marker without reporting: serialized statics are not a
/// stage reader, so the stage that later reads one reports its losses.
pub(crate) fn strip_lost_values(value: &mut Value) {
    take_lost_values(value);
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
        Declaration::TSModuleDeclaration(decl) => decl.id.name() == name,
        _ => false,
    };
    program.body.iter().any(|stmt| match stmt {
        Statement::ImportDeclaration(import) => import
            .specifiers
            .iter()
            .flatten()
            .any(|spec| spec.local().name == name),
        Statement::ExportNamedDeclaration(export) => export.declaration.as_ref().is_some_and(declares),
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
    use super::*;
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
                    return eval_object_expr(obj).unwrap();
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
                    return parse_variant_arg(obj, sv).unwrap();
                }
            }
        }
        panic!("failed to parse variant config object");
    }

    #[test]
    fn variant_identifier_map_records_skip_instead_of_silent_empty() {
        let (cfg, skips) =
            parse_variant("{ prop: 'size', defaultVariant: 'lg', variants: selectSizes }");
        assert!(cfg.variants.is_empty(), "{:?}", cfg.variants);
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
        assert!(cfg.variants.is_empty(), "{:?}", cfg.variants);
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
        assert!(cfg.variants.is_empty(), "{:?}", cfg.variants);
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
        assert_eq!(cfg.variants.len(), 1);
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
        assert_eq!(cfg.variants.len(), 2);
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
        let values = collect_static_values(result_program);
        assert_eq!(values.get("GAP"), Some(&Value::Number(16.into())));
    }

    #[test]
    fn intra_file_string_const_resolution() {
        let source = r#"const COLOR = 'red';"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = collect_static_values(result_program);
        assert_eq!(values.get("COLOR"), Some(&Value::String("red".to_string())));
    }

    #[test]
    fn non_static_const_not_collected() {
        let source = r#"const val = getSpacing();"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = collect_static_values(result_program);
        assert!(!values.contains_key("val"));
    }

    #[test]
    fn let_declaration_not_collected() {
        let source = r#"let gap = 16;"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = collect_static_values(result_program);
        assert!(!values.contains_key("gap"));
    }

    #[test]
    fn const_object_collected() {
        let source = r#"const config = { gap: 16, display: 'flex' };"#;
        let ast = parse_ts(source.to_string());
        let result_program = ast.program();
        let values = collect_static_values(result_program);
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
        let values = collect_static_values(result_program);
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
                    return eval_object_expr_with_statics(obj, sv).unwrap();
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
        assert_eq!(cfg.base, Some(serde_json::json!({ "fontWeight": 700 })));
        assert_eq!(cfg.variants.len(), 2);
        assert_eq!(cfg.variants["sm"], serde_json::json!({ "height": 32 }));

        let (cfg2, skips2) = parse_variant(
            "{ prop: 'size', defaultVariant: 'md', variants: sizes }",
        );
        assert!(cfg2.variants.is_empty());
        assert_eq!(skips2.len(), 1);
        assert!(skips2[0].reason.contains("variant map (non-static)"));
    }

    #[test]
    fn as_const_declarations_collect_into_statics() {
        let ast = parse_ts(
            "const sizes = { sm: { height: 32 } } as const;\nconst gap = 16 as const;\nconst theme = { gap: 8 } satisfies Record<string, number>;\n".to_string(),
        );
        let statics = collect_static_values(ast.program());
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
