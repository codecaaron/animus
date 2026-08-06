//! Static JSX attribute-value evaluation.
//!
//! Split out of `jsx_scan.rs` unchanged. The leaf of this module's layering:
//! turns a JSX attribute into a static JSON value, a classified dynamic
//! expression, or a skip. Knows nothing about components, usage, or compose.

use oxc::ast::ast::{
    Expression, JSXAttributeValue, JSXExpression, ObjectPropertyKind, PropertyKey, PropertyKind,
};
use oxc::span::GetSpan;
use serde_json::{Map, Value};

use super::{DynamicExpressionKind, PropValueResult, UsageSpan};

/// Evaluate a JSX attribute value to a static JSON `Value`.
/// Returns `None` for non-static or unsupported forms — this is a silent skip, not an error.
pub(crate) fn eval_jsx_attribute_value(value: &Option<JSXAttributeValue>) -> PropValueResult {
    match value {
        // Bare boolean attribute, e.g. `<Box disabled />` — treat as `true`.
        None => PropValueResult::Static(Value::Bool(true)),

        Some(JSXAttributeValue::StringLiteral(lit)) => {
            PropValueResult::Static(Value::String(lit.value.to_string()))
        }

        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match &container.expression {
                JSXExpression::EmptyExpression(_) => PropValueResult::Skip,
                // JSXExpression @inherits Expression — match directly on static literal variants.
                JSXExpression::StringLiteral(lit) => {
                    PropValueResult::Static(Value::String(lit.value.to_string()))
                }
                JSXExpression::NumericLiteral(lit) => {
                    PropValueResult::Static(make_json_number(lit.value))
                }
                JSXExpression::BooleanLiteral(lit) => {
                    PropValueResult::Static(Value::Bool(lit.value))
                }
                JSXExpression::NullLiteral(_) => PropValueResult::Static(Value::Null),
                JSXExpression::UnaryExpression(unary) => {
                    if unary.operator == oxc::syntax::operator::UnaryOperator::UnaryNegation {
                        if let Expression::NumericLiteral(lit) = &unary.argument {
                            return PropValueResult::Static(make_json_number(-lit.value));
                        }
                    }
                    dynamic_expression(container.expression.to_expression())
                }
                JSXExpression::ObjectExpression(obj) => match eval_static_object(obj) {
                    Some(v) => PropValueResult::Static(v),
                    None => dynamic_expression(container.expression.to_expression()),
                },
                JSXExpression::ParenthesizedExpression(paren) => {
                    match eval_static_expression(&paren.expression) {
                        Some(v) => PropValueResult::Static(v),
                        None => dynamic_expression(&paren.expression),
                    }
                }
                JSXExpression::TemplateLiteral(tpl) if tpl.expressions.is_empty() => {
                    match tpl
                        .quasis
                        .first()
                        .map(|q| Value::String(q.value.raw.to_string()))
                    {
                        Some(v) => PropValueResult::Static(v),
                        None => PropValueResult::Skip,
                    }
                }
                // All dynamic / non-static forms — identifier, call expression,
                // conditional, member expression, template literal with expressions, etc.
                _ => dynamic_expression(container.expression.to_expression()),
            }
        }

        // Element or fragment as attribute value — not a system prop value.
        Some(JSXAttributeValue::Element(_)) | Some(JSXAttributeValue::Fragment(_)) => {
            PropValueResult::Skip
        }
    }
}

fn dynamic_expression(expr: &Expression<'_>) -> PropValueResult {
    let mut expr = expr;
    while let Expression::ParenthesizedExpression(paren) = expr {
        expr = &paren.expression;
    }
    let kind = match expr {
        Expression::Identifier(_) => DynamicExpressionKind::Identifier,
        Expression::ComputedMemberExpression(_)
        | Expression::StaticMemberExpression(_)
        | Expression::PrivateFieldExpression(_) => DynamicExpressionKind::Member,
        Expression::CallExpression(_) => DynamicExpressionKind::Call,
        Expression::ConditionalExpression(_) => DynamicExpressionKind::Conditional,
        Expression::LogicalExpression(_) => DynamicExpressionKind::Logical,
        Expression::TemplateLiteral(_) => DynamicExpressionKind::Template,
        Expression::BinaryExpression(_) => DynamicExpressionKind::Binary,
        Expression::ObjectExpression(_) => DynamicExpressionKind::ResponsiveObjectDynamic,
        Expression::ArrayExpression(_) => DynamicExpressionKind::Array,
        _ => DynamicExpressionKind::Other,
    };
    let span = expr.span();
    PropValueResult::Dynamic {
        kind,
        span: UsageSpan {
            start: span.start,
            end: span.end,
        },
    }
}

// ---------------------------------------------------------------------------
// Static expression evaluation helpers
// ---------------------------------------------------------------------------

/// Evaluate an `Expression` to a static JSON `Value`.
/// Only handles the static subset defined in the spec.
fn eval_static_expression(expr: &Expression) -> Option<Value> {
    match expr {
        Expression::StringLiteral(lit) => Some(Value::String(lit.value.to_string())),
        Expression::NumericLiteral(lit) => Some(make_json_number(lit.value)),
        Expression::BooleanLiteral(lit) => Some(Value::Bool(lit.value)),
        Expression::NullLiteral(_) => Some(Value::Null),

        Expression::UnaryExpression(unary) => {
            if unary.operator == oxc::syntax::operator::UnaryOperator::UnaryNegation {
                if let Expression::NumericLiteral(lit) = &unary.argument {
                    return Some(make_json_number(-lit.value));
                }
            }
            None
        }

        Expression::ObjectExpression(obj) => eval_static_object(obj),

        Expression::ParenthesizedExpression(paren) => eval_static_expression(&paren.expression),

        Expression::TemplateLiteral(tpl) if tpl.expressions.is_empty() => tpl
            .quasis
            .first()
            .map(|q| Value::String(q.value.raw.to_string())),

        _ => None,
    }
}

/// Evaluate an `ObjectExpression` whose keys and values are all statically known.
/// Returns `None` if any property is non-static (computed key, spread, dynamic value).
fn eval_static_object(obj: &oxc::ast::ast::ObjectExpression) -> Option<Value> {
    let mut map = Map::new();

    for prop_kind in &obj.properties {
        match prop_kind {
            ObjectPropertyKind::ObjectProperty(prop) => {
                if prop.kind != PropertyKind::Init || prop.computed {
                    return None;
                }
                let key = eval_property_key(&prop.key)?;
                let val = eval_static_expression(&prop.value)?;
                map.insert(key, val);
            }
            ObjectPropertyKind::SpreadProperty(_) => return None,
        }
    }

    Some(Value::Object(map))
}

/// Evaluate a property key to a `String`.
pub(super) fn eval_property_key(key: &PropertyKey) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
        PropertyKey::StringLiteral(lit) => Some(lit.value.to_string()),
        PropertyKey::NumericLiteral(lit) => Some(lit.value.to_string()),
        _ => None,
    }
}

/// Convert an `f64` to a `serde_json::Value::Number`, preserving integer form where possible.
fn make_json_number(v: f64) -> Value {
    if v.fract() == 0.0 && v.abs() < (i64::MAX as f64) {
        Value::Number(serde_json::Number::from(v as i64))
    } else {
        Value::Number(
            serde_json::Number::from_f64(v).unwrap_or_else(|| serde_json::Number::from(0)),
        )
    }
}
