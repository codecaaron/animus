use oxc_ast::ast::{
    ArrayExpressionElement, Declaration, Expression, ObjectExpression, ObjectPropertyKind,
    Program, PropertyKey, PropertyKind, Statement, VariableDeclarationKind,
};
use oxc_span::Span;
use rustc_hash::FxHashMap;
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

/// A function expression captured from a `transform` field instead of being evaluated.
/// The span references the source text of the function body.
#[derive(Debug, Clone)]
pub struct CapturedTransform {
    /// Dotted key path (e.g., "sizing.transform" for nested `{ sizing: { transform: fn } }`).
    pub key: String,
    /// Source span of the function expression in the parsed AST.
    pub span: Span,
}

/// Evaluate an ObjectExpression AST node into a serde_json::Value.
///
/// Returns `Ok((value, skipped, captured))` where:
/// - `skipped` lists properties whose values could not be statically evaluated
/// - `captured` lists function expressions captured from `transform` fields
///
/// Structural errors (spread, computed keys, getters/setters) still bail the
/// entire object with `Err(BailError)`.
pub fn eval_object_expr(
    obj: &ObjectExpression<'_>,
) -> Result<(Value, Vec<SkippedProperty>, Vec<CapturedTransform>), BailError> {
    eval_object_expr_with_statics(obj, None)
}

/// Evaluate an ObjectExpression with optional static value context for identifier resolution.
pub fn eval_object_expr_with_statics(
    obj: &ObjectExpression<'_>,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<(Value, Vec<SkippedProperty>, Vec<CapturedTransform>), BailError> {
    let mut map = Map::new();
    let mut skipped = Vec::new();
    let mut captured = Vec::new();

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

                // Special case: capture function expressions on `transform` fields
                if key == "transform" {
                    match &prop.value {
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
                        // Other expressions (string literals, identifiers, etc.)
                        // fall through to normal evaluation below
                        _ => {}
                    }
                }

                // Handle nested objects directly to propagate inner captures
                if let Expression::ObjectExpression(inner_obj) = &prop.value {
                    match eval_object_expr_with_statics(inner_obj, static_values) {
                        Ok((value, inner_skips, inner_captured)) => {
                            skipped.extend(inner_skips);
                            // Prefix inner captures with the outer key
                            for mut cap in inner_captured {
                                cap.key = format!("{}.{}", key, cap.key);
                                captured.push(cap);
                            }
                            map.insert(key, value);
                        }
                        Err(bail) => {
                            // Nested structural bail → skip this property on the parent
                            skipped.push(SkippedProperty {
                                key,
                                reason: bail.reason,
                            });
                        }
                    }
                    continue;
                }

                // Try to evaluate the value. On failure, skip this property.
                match eval_expression_with_statics(&prop.value, &mut skipped, static_values) {
                    Ok(value) => {
                        map.insert(key, value);
                    }
                    Err(bail) => {
                        // Value-level error: skip this property, continue with the rest.
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

    Ok((Value::Object(map), skipped, captured))
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
    eval_expression_with_statics(expr, skips, None)
}

/// Evaluate an expression with optional static value context for identifier resolution.
fn eval_expression_with_statics(
    expr: &Expression<'_>,
    skips: &mut Vec<SkippedProperty>,
    static_values: Option<&FxHashMap<String, Value>>,
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
            // Note: captures from nested objects are discarded here — this path is
            // only reached for non-object properties in eval_object_expr (objects are
            // handled directly). This path remains for eval_array_element contexts.
            match eval_object_expr(obj) {
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

        // Identifier: check static value map first, then bail if not resolved
        Expression::Identifier(ident) => {
            if let Some(sv) = static_values {
                if let Some(val) = sv.get(ident.name.as_str()) {
                    return Ok(val.clone());
                }
            }
            Err(BailError::new("variable reference (non-static)"))
        }
        Expression::CallExpression(_) => Err(BailError::new("function call (non-static)")),
        Expression::ArrowFunctionExpression(_) => {
            Err(BailError::new("arrow function (non-static)"))
        }
        Expression::FunctionExpression(_) => Err(BailError::new("function (non-static)")),
        Expression::TaggedTemplateExpression(_) => {
            Err(BailError::new("tagged template (non-static)"))
        }
        // Static member expression: resolve `object.property` when `object`
        // is an Identifier bound in `static_values` to a JSON object. This
        // covers cases like `animationName: motion.ember` where `motion` is
        // an extraction-time binding carrying a keyframes collection map.
        // Only single-hop lookups are supported; deeper chains fall through.
        Expression::StaticMemberExpression(member) => {
            if let Some(sv) = static_values {
                if let Expression::Identifier(ident) = &member.object {
                    if let Some(Value::Object(map)) = sv.get(ident.name.as_str()) {
                        if let Some(val) = map.get(member.property.name.as_str()) {
                            return Ok(val.clone());
                        }
                    }
                }
            }
            Err(BailError::new("member expression (non-static)"))
        }
        Expression::ComputedMemberExpression(_) => {
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
                            let (val, skips, _captures) = eval_object_expr(obj)?;
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

/// Collect statically-evaluable top-level `const` declarations from a parsed program.
///
/// Walks `program.body` for `const` variable declarations, evaluates init expressions,
/// and returns a map of `binding_name → Value` for successfully evaluated declarations.
/// `let`/`var` declarations are skipped (mutable, cannot be statically guaranteed).
/// Non-static init expressions (function calls, identifiers, etc.) are silently skipped.
pub fn collect_static_values(program: &Program<'_>) -> FxHashMap<String, Value> {
    let mut values = FxHashMap::default();

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
                oxc_ast::ast::BindingPattern::BindingIdentifier(ident) => {
                    ident.name.to_string()
                }
                _ => continue, // Destructuring patterns — skip
            };

            if let Some(init) = &declarator.init {
                // Try evaluating the init expression
                let mut dummy_skips = Vec::new();
                match init {
                    Expression::ObjectExpression(obj) => {
                        if let Ok((val, _skips, _captures)) = eval_object_expr(obj) {
                            values.insert(name, val);
                        }
                    }
                    _ => {
                        if let Ok(val) = eval_expression(init, &mut dummy_skips) {
                            values.insert(name, val);
                        }
                    }
                }
            }
        }
    }

    values
}

/// Extract the subset of static values that correspond to exported names.
///
/// Given a file's module info exports and its static values map, returns
/// only the values that are exported (mapped by export name).
pub fn collect_static_exports(
    module_info: &crate::import_resolver::FileModuleInfo,
    static_values: &FxHashMap<String, Value>,
) -> FxHashMap<String, Value> {
    let mut exports = FxHashMap::default();

    for export in &module_info.exports {
        // The export's local_name is the binding in this file.
        // The export's exported_name is how it's visible to importers.
        if let Some(ref local) = export.local_name {
            if let Some(value) = static_values.get(local) {
                exports.insert(export.exported_name.clone(), value.clone());
            }
        }
    }

    exports
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    /// Parse an object expression and return the value + skipped + captured.
    fn parse_obj_all(source: &str) -> (Value, Vec<SkippedProperty>, Vec<CapturedTransform>) {
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

    /// Parse an object expression and return the value + skipped properties.
    fn parse_obj_full(source: &str) -> (Value, Vec<SkippedProperty>) {
        let (val, skips, _captures) = parse_obj_all(source);
        (val, skips)
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

    // ── Transform function capture tests ─────────────────────────────────────

    #[test]
    fn capture_arrow_on_transform_field() {
        let (val, skips, captured) = parse_obj_all(
            r#"{ property: 'flexBasis', transform: (v) => v + 'px' }"#,
        );
        // Static property evaluates normally
        assert_eq!(val["property"], "flexBasis");
        // Transform is captured, not in JSON
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
        // Identifier → skipped (not captured)
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
        // Arrow on `scale` field → skipped (bailed), not captured
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
        // Nested object evaluates, with transform captured
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

    // -----------------------------------------------------------------------
    // Static const resolution tests
    // -----------------------------------------------------------------------

    #[test]
    fn intra_file_numeric_const_resolution() {
        let source = r#"const GAP = 16;
const Component = { gap: GAP };"#;
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::ts()).parse();
        let values = collect_static_values(&result.program);
        assert_eq!(values.get("GAP"), Some(&Value::Number(16.into())));
    }

    #[test]
    fn intra_file_string_const_resolution() {
        let source = r#"const COLOR = 'red';"#;
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::ts()).parse();
        let values = collect_static_values(&result.program);
        assert_eq!(values.get("COLOR"), Some(&Value::String("red".to_string())));
    }

    #[test]
    fn non_static_const_not_collected() {
        let source = r#"const val = getSpacing();"#;
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::ts()).parse();
        let values = collect_static_values(&result.program);
        assert!(values.get("val").is_none());
    }

    #[test]
    fn let_declaration_not_collected() {
        let source = r#"let gap = 16;"#;
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::ts()).parse();
        let values = collect_static_values(&result.program);
        assert!(values.get("gap").is_none());
    }

    #[test]
    fn const_object_collected() {
        let source = r#"const config = { gap: 16, display: 'flex' };"#;
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::ts()).parse();
        let values = collect_static_values(&result.program);
        let config = values.get("config").unwrap();
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
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::ts()).parse();
        let values = collect_static_values(&result.program);
        assert_eq!(values.get("SPACING"), Some(&Value::Number(8.into())));
    }

    // ── Member-expression resolution via static_values ──────────────────────
    // These cover the keyframes binding-substitution path: `motion.ember`
    // resolves when `motion` is bound to a JSON object in the static-values
    // map.

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
        // Base resolves to a scalar (not an object) → skip, do not panic.
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

    fn parse_obj_with_statics(
        source: &str,
        sv: Option<&FxHashMap<String, Value>>,
    ) -> (Value, Vec<SkippedProperty>, Vec<CapturedTransform>) {
        let allocator = Allocator::default();
        let full = format!("const x = {};", source);
        let result = Parser::new(&allocator, &full, SourceType::ts()).parse();
        let program = &result.program;

        if let Some(Statement::VariableDeclaration(decl)) = program.body.first() {
            if let Some(declarator) = decl.declarations.first() {
                if let Some(Expression::ObjectExpression(obj)) = &declarator.init {
                    return eval_object_expr_with_statics(obj, sv).unwrap();
                }
            }
        }
        panic!("failed to parse test object");
    }
}
