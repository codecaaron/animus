//! Static JSX attribute-value evaluation: an attribute becomes a static
//! JSON value, a classified dynamic expression, or a skip.

use oxc::ast::ast::{
    Expression, JSXAttributeValue, JSXExpression, ObjectPropertyKind, PropertyKey, PropertyKind,
};
use oxc::span::GetSpan;
use serde_json::{Map, Value};

use super::{DynamicExpressionKind, PropValueResult, UsageSpan};

pub(crate) fn eval_jsx_attribute_value(value: &Option<JSXAttributeValue>) -> PropValueResult {
    match value {
        // A valueless attribute (`<Box disabled />`) is `true`.
        None => PropValueResult::Static(Value::Bool(true)),

        // An entity may spell a lone surrogate (`&#xD800;`), which has no
        // static text (`eval::literal_string`).
        Some(JSXAttributeValue::StringLiteral(lit)) => match crate::eval::literal_string(lit) {
            Some(text) => PropValueResult::Static(Value::String(text.to_string())),
            None => dynamic(DynamicExpressionKind::Other, lit.span),
        },

        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                return PropValueResult::Skip;
            }
            // Runtime-erased TypeScript wrappers and parentheses hold the
            // same value.
            let expr = crate::chain_walk::unwrap_type_assertions(container.expression.to_expression());
            eval_static_expression(expr).map_or_else(|| dynamic_expression(expr), PropValueResult::Static)
        }

        Some(JSXAttributeValue::Element(_)) | Some(JSXAttributeValue::Fragment(_)) => {
            PropValueResult::Skip
        }
    }
}

fn dynamic_expression(expr: &Expression<'_>) -> PropValueResult {
    let expr = crate::chain_walk::unwrap_type_assertions(expr);
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
    dynamic(kind, expr.span())
}

fn dynamic(kind: DynamicExpressionKind, span: oxc::span::Span) -> PropValueResult {
    PropValueResult::Dynamic { kind, span: UsageSpan { start: span.start, end: span.end } }
}

pub(crate) fn eval_static_expression(expr: &Expression) -> Option<Value> {
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::StringLiteral(lit) => crate::eval::literal_string(lit).map(|text| Value::String(text.to_string())),
        Expression::NumericLiteral(lit) => make_json_number(lit.value),
        Expression::BooleanLiteral(lit) => Some(Value::Bool(lit.value)),
        Expression::NullLiteral(_) => Some(Value::Null),

        Expression::UnaryExpression(unary) => {
            if unary.operator == oxc::syntax::operator::UnaryOperator::UnaryNegation {
                if let Expression::NumericLiteral(lit) = &unary.argument {
                    return make_json_number(-lit.value);
                }
            }
            None
        }

        Expression::ObjectExpression(obj) => eval_static_object(obj),

        // Its cooked text is what the runtime gets: `\x72ed` is `red`.
        Expression::TemplateLiteral(tpl) if tpl.expressions.is_empty() => {
            crate::eval::cooked_text(tpl.quasis.first()?).map(|text| Value::String(text.to_string()))
        }

        _ => None,
    }
}

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

pub(crate) fn eval_property_key(key: &PropertyKey) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
        PropertyKey::StringLiteral(lit) => crate::eval::literal_string(lit).map(str::to_string),
        // The name a number writes, `String(n)`, where the walk can spell it.
        PropertyKey::NumericLiteral(lit) => crate::eval::js_number_key(lit.value),
        _ => None,
    }
}

/// A number's static value (`eval::json_number`); `None` for Infinity and
/// NaN.
pub(crate) fn make_json_number(v: f64) -> Option<Value> {
    crate::eval::json_number(v).map(Value::Number)
}
