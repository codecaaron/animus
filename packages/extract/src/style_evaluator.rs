use oxc_ast::ast::{
    Argument, ArrayExpressionElement, Expression, ObjectExpression, ObjectPropertyKind, PropertyKey,
    PropertyKind,
};
use serde_json::{Map, Value};

/// Error when a style value cannot be statically evaluated.
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

/// Evaluate an ObjectExpression AST node into a serde_json::Value.
/// Returns Err(BailError) if any value is non-static.
pub fn eval_object_expr(obj: &ObjectExpression<'_>) -> Result<Value, BailError> {
    let mut map = Map::new();

    for prop_kind in &obj.properties {
        match prop_kind {
            ObjectPropertyKind::ObjectProperty(prop) => {
                if prop.kind != PropertyKind::Init {
                    return Err(BailError::new("getter/setter in style object"));
                }
                if prop.computed {
                    return Err(BailError::new("computed property key in style object"));
                }

                let key = eval_property_key(&prop.key)?;
                let value = eval_expression(&prop.value)?;
                map.insert(key, value);
            }
            ObjectPropertyKind::SpreadProperty(_) => {
                return Err(BailError::new("spread element in style object"));
            }
        }
    }

    Ok(Value::Object(map))
}

/// Evaluate a property key to a string.
fn eval_property_key(key: &PropertyKey<'_>) -> Result<String, BailError> {
    match key {
        PropertyKey::StaticIdentifier(id) => Ok(id.name.to_string()),
        PropertyKey::StringLiteral(lit) => Ok(lit.value.to_string()),
        PropertyKey::NumericLiteral(lit) => Ok(lit.value.to_string()),
        _ => Err(BailError::new("non-static property key")),
    }
}

/// Evaluate an expression to a JSON value.
fn eval_expression(expr: &Expression<'_>) -> Result<Value, BailError> {
    match expr {
        Expression::StringLiteral(lit) => Ok(Value::String(lit.value.to_string())),

        Expression::NumericLiteral(lit) => {
            // Preserve integer vs float distinction
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
            // Handle negative numbers: -1, -0.5
            if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation {
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

        Expression::ObjectExpression(obj) => eval_object_expr(obj),

        Expression::ArrayExpression(arr) => {
            let mut values = Vec::new();
            for elem in &arr.elements {
                values.push(eval_array_element(elem)?);
            }
            Ok(Value::Array(values))
        }

        Expression::TemplateLiteral(tpl) => {
            // Only static template literals (no expressions) are allowed
            if tpl.expressions.is_empty() {
                // Single quasi with no expressions
                if let Some(quasi) = tpl.quasis.first() {
                    return Ok(Value::String(quasi.value.raw.to_string()));
                }
            }
            Err(BailError::new(
                "template literal with expressions (non-static)",
            ))
        }

        // All non-static expression types
        Expression::Identifier(_) => Err(BailError::new("variable reference (non-static)")),
        Expression::CallExpression(_) => Err(BailError::new("function call (non-static)")),
        Expression::ArrowFunctionExpression(_) => {
            Err(BailError::new("arrow function (non-static)"))
        }
        Expression::FunctionExpression(_) => Err(BailError::new("function (non-static)")),
        Expression::TaggedTemplateExpression(_) => {
            Err(BailError::new("tagged template (non-static)"))
        }
        Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_) => {
            Err(BailError::new("member expression (non-static)"))
        }

        _ => Err(BailError::new("unsupported expression type")),
    }
}

/// Evaluate an array element directly (without casting to Expression).
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
        ArrayExpressionElement::ObjectExpression(obj) => eval_object_expr(obj),
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

/// Parsed representation of a `.variant()` call argument.
#[derive(Debug)]
pub struct VariantStageConfig {
    /// The prop name (default: "variant")
    pub prop: String,
    /// Default variant option name
    pub default_variant: Option<String>,
    /// Base styles shared across all variant options
    pub base: Option<Value>,
    /// Map of variant option name → styles
    pub variants: Map<String, Value>,
}

/// Parse the argument of a `.variant({ prop?, defaultVariant?, base?, variants: {...} })` call.
pub fn parse_variant_arg(obj: &ObjectExpression<'_>) -> Result<VariantStageConfig, BailError> {
    let mut prop = "variant".to_string();
    let mut default_variant = None;
    let mut base = None;
    let mut variants = Map::new();

    for prop_kind in &obj.properties {
        match prop_kind {
            ObjectPropertyKind::ObjectProperty(p) => {
                let key = eval_property_key(&p.key)?;
                match key.as_str() {
                    "prop" => {
                        if let Expression::StringLiteral(lit) = &p.value {
                            prop = lit.value.to_string();
                        }
                    }
                    "defaultVariant" => {
                        if let Expression::StringLiteral(lit) = &p.value {
                            default_variant = Some(lit.value.to_string());
                        }
                    }
                    "base" => {
                        if let Expression::ObjectExpression(obj) = &p.value {
                            base = Some(eval_object_expr(obj)?);
                        }
                    }
                    "variants" => {
                        if let Expression::ObjectExpression(obj) = &p.value {
                            for vprop in &obj.properties {
                                if let ObjectPropertyKind::ObjectProperty(vp) = vprop {
                                    let vkey = eval_property_key(&vp.key)?;
                                    let vstyles = eval_expression(&vp.value)?;
                                    variants.insert(vkey, vstyles);
                                }
                            }
                        }
                    }
                    _ => {} // ignore unknown keys
                }
            }
            _ => {}
        }
    }

    Ok(VariantStageConfig {
        prop,
        default_variant,
        base,
        variants,
    })
}

/// Parse the argument of a `.states({ stateName: { ...styles } })` call.
pub fn parse_states_arg(obj: &ObjectExpression<'_>) -> Result<Map<String, Value>, BailError> {
    let mut states = Map::new();

    for prop_kind in &obj.properties {
        match prop_kind {
            ObjectPropertyKind::ObjectProperty(p) => {
                let key = eval_property_key(&p.key)?;
                let styles = eval_expression(&p.value)?;
                states.insert(key, styles);
            }
            ObjectPropertyKind::SpreadProperty(_) => {
                return Err(BailError::new("spread in states config"));
            }
        }
    }

    Ok(states)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn parse_obj(source: &str) -> Value {
        let allocator = Allocator::default();
        let full = format!("const x = {};", source);
        let result = Parser::new(&allocator, &full, SourceType::ts()).parse();
        let program = &result.program;

        if let Some(oxc_ast::ast::Statement::VariableDeclaration(decl)) = program.body.first() {
            if let Some(declarator) = decl.declarations.first() {
                if let Some(Expression::ObjectExpression(obj)) = &declarator.init {
                    return eval_object_expr(obj).unwrap();
                }
            }
        }
        panic!("failed to parse object expression");
    }

    fn parse_obj_err(source: &str) -> String {
        let allocator = Allocator::default();
        let full = format!("const x = {};", source);
        let result = Parser::new(&allocator, &full, SourceType::ts()).parse();
        let program = &result.program;

        if let Some(oxc_ast::ast::Statement::VariableDeclaration(decl)) = program.body.first() {
            if let Some(declarator) = decl.declarations.first() {
                if let Some(Expression::ObjectExpression(obj)) = &declarator.init {
                    return eval_object_expr(obj).unwrap_err().reason;
                }
            }
        }
        panic!("failed to parse");
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
    fn bail_on_variable_reference() {
        let reason = parse_obj_err(r#"{ color: someVariable }"#);
        assert!(reason.contains("non-static"));
    }

    #[test]
    fn bail_on_function_call() {
        let reason = parse_obj_err(r#"{ color: darken(0.1, 'red') }"#);
        assert!(reason.contains("non-static"));
    }

    #[test]
    fn bail_on_template_with_expression() {
        let reason = parse_obj_err("{ animation: `${flow} 5s` }");
        assert!(reason.contains("non-static"));
    }

    #[test]
    fn bail_on_spread() {
        let reason = parse_obj_err(r#"{ ...baseStyles }"#);
        assert!(reason.contains("spread"));
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
        // Static template literal with no expressions
        let val = parse_obj(r#"{ content: '""' }"#);
        assert_eq!(val["content"], "\"\"");
    }
}
