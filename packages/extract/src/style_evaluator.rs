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

/// A property that was skipped during evaluation because its value is non-static.
#[derive(Debug, Clone)]
pub struct SkippedProperty {
    pub key: String,
    pub reason: String,
}

/// Evaluate an ObjectExpression AST node into a serde_json::Value.
///
/// Returns `Ok((value, skipped))` where `skipped` lists properties whose values
/// could not be statically evaluated. Structural errors (spread, computed keys,
/// getters/setters) still bail the entire object with `Err(BailError)`.
pub fn eval_object_expr(
    obj: &ObjectExpression<'_>,
) -> Result<(Value, Vec<SkippedProperty>), BailError> {
    let mut map = Map::new();
    let mut skipped = Vec::new();

    for prop_kind in &obj.properties {
        match prop_kind {
            ObjectPropertyKind::ObjectProperty(prop) => {
                // Structural issues → bail entire object
                if prop.kind != PropertyKind::Init {
                    return Err(BailError::new("getter/setter in style object"));
                }
                if prop.computed {
                    return Err(BailError::new("computed property key in style object"));
                }

                let key = eval_property_key(&prop.key)?;

                // Try to evaluate the value. On failure, skip this property.
                match eval_expression(&prop.value, &mut skipped) {
                    Ok(value) => {
                        map.insert(key, value);
                    }
                    Err(bail) => {
                        // Value-level error: skip this property, continue with the rest.
                        // Check if the value is an object expression that structurally bailed —
                        // still treat as a value-level skip on the parent.
                        skipped.push(SkippedProperty {
                            key,
                            reason: bail.reason,
                        });
                    }
                }
            }
            ObjectPropertyKind::SpreadProperty(_) => {
                // Structural issue → bail entire object
                return Err(BailError::new("spread element in style object"));
            }
        }
    }

    Ok((Value::Object(map), skipped))
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
/// The `skips` accumulator collects any per-property skips from nested objects.
fn eval_expression(
    expr: &Expression<'_>,
    skips: &mut Vec<SkippedProperty>,
) -> Result<Value, BailError> {
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

        Expression::ObjectExpression(obj) => {
            // Nested object: per-property skip applies recursively.
            // If the nested object has a structural bail, convert to a value-level
            // error so the parent can skip this property.
            match eval_object_expr(obj) {
                Ok((value, inner_skips)) => {
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
        ArrayExpressionElement::ObjectExpression(obj) => {
            // Discard per-property skips from nested objects in arrays — arrays
            // in style values are rare (e.g., boxShadow arrays) and partial
            // extraction within them is not meaningful.
            eval_object_expr(obj).map(|(val, _skips)| val)
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
/// Returns the config and any per-property skip warnings from style evaluation.
pub fn parse_variant_arg(
    obj: &ObjectExpression<'_>,
) -> Result<(VariantStageConfig, Vec<SkippedProperty>), BailError> {
    let mut prop = "variant".to_string();
    let mut default_variant = None;
    let mut base = None;
    let mut variants = Map::new();
    let mut all_skips = Vec::new();

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
                            let (val, skips) = eval_object_expr(obj)?;
                            all_skips.extend(skips);
                            base = Some(val);
                        }
                    }
                    "variants" => {
                        if let Expression::ObjectExpression(obj) = &p.value {
                            for vprop in &obj.properties {
                                if let ObjectPropertyKind::ObjectProperty(vp) = vprop {
                                    let vkey = eval_property_key(&vp.key)?;
                                    let mut skips = Vec::new();
                                    let vstyles = eval_expression(&vp.value, &mut skips)?;
                                    all_skips.extend(skips);
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

/// Parse the argument of a `.states({ stateName: { ...styles } })` call.
/// Returns the states map and any per-property skip warnings from style evaluation.
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

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    /// Parse an object expression and return the value + skipped properties.
    fn parse_obj_full(source: &str) -> (Value, Vec<SkippedProperty>) {
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

    /// Parse an object expression, returning just the value (for tests that don't care about skips).
    fn parse_obj(source: &str) -> Value {
        parse_obj_full(source).0
    }

    /// Parse an object expression that should structurally bail (spread, computed key, getter).
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

    // ── Static evaluation tests (unchanged) ──────────────────────────────────

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

    // ── Per-property skip tests (NEW — value-level errors skip, don't bail) ──

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
        // Non-static value inside a pseudo block: skip just that inner property
        let (val, skips) = parse_obj_full(r#"{ '&:hover': { color: dynamicVar, bg: 'red' } }"#);
        assert_eq!(val["&:hover"]["bg"], "red");
        assert!(val["&:hover"].get("color").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "color");
    }

    #[test]
    fn skip_non_static_pseudo_value() {
        // The pseudo block value itself is non-static (not an object)
        let (val, skips) = parse_obj_full(r#"{ '&:hover': someFunction(), color: 'red' }"#);
        assert_eq!(val["color"], "red");
        assert!(val.get("&:hover").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "&:hover");
    }

    #[test]
    fn spread_inside_nested_skips_parent() {
        // Spread in nested object → structural bail in nested → skip the parent property
        let (val, skips) = parse_obj_full(r#"{ '&:hover': { ...hoverOverrides, bg: 'red' }, color: 'blue' }"#);
        assert_eq!(val["color"], "blue");
        assert!(val.get("&:hover").is_none());
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].key, "&:hover");
        assert!(skips[0].reason.contains("spread"));
    }

    // ── Structural bail tests (still bail entire object) ──────────────────────

    #[test]
    fn bail_on_spread() {
        let reason = parse_obj_err(r#"{ ...baseStyles }"#);
        assert!(reason.contains("spread"));
    }

    #[test]
    fn bail_on_spread_even_with_static_props() {
        // Spread at top level ALWAYS bails — even if other properties are static
        let reason = parse_obj_err(r#"{ ...baseStyles, color: 'red' }"#);
        assert!(reason.contains("spread"));
    }
}
