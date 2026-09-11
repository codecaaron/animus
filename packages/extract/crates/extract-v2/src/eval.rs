//! Stage-argument evaluation into JSON values, with per-property skips for
//! non-static values and captured `transform` functions.

use oxc::ast::ast::{
    ArrayExpressionElement, Declaration, Expression, ObjectExpression, ObjectPropertyKind,
    Program, PropertyKey, PropertyKind, Statement, VariableDeclarationKind,
};
use oxc::span::Span;
use rustc_hash::FxHashMap;
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
}

pub const SELECTOR_UNSUPPORTED_SUBJECT: &str = "animus.selector.unsupported-subject";

pub const KEYFRAMES_UNREGISTERED_REFERENCE: &str = "animus.keyframes.unregistered-reference";

pub(crate) fn unsupported_selector_key(key: &str) -> bool {
    key.contains('&') && !crate::selector_subject::has_subject(key)
}

fn unsupported_selector_skip(key: &str) -> SkippedProperty {
    SkippedProperty {
        key: key.to_string(),
        reason: format!(
            "selector '{key}' has no substitutable '&' subject outside quoted text ({SELECTOR_UNSUPPORTED_SUBJECT})"
        ),
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
                let eligible = keyframes_eligible
                    || matches!(key.as_str(), "animationName" | "animation");

                // Without a coded skip, theme resolution drops the rule
                // silently.
                if unsupported_selector_key(&key) {
                    skipped.push(unsupported_selector_skip(&key));
                    continue;
                }

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
                        _ => {}
                    }
                }

                if let Expression::ObjectExpression(inner_obj) = &prop.value {
                    match eval_object_expr_scoped(inner_obj, static_values, eligible) {
                        Ok((value, inner_skips, inner_captured)) => {
                            skipped.extend(inner_skips);
                            for mut cap in inner_captured {
                                cap.key = format!("{}.{}", key, cap.key);
                                captured.push(cap);
                            }
                            map.insert(key, value);
                        }
                        Err(bail) => {
                            skipped.push(SkippedProperty {
                                key,
                                reason: bail.reason,
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
                        map.insert(key, value);
                    }
                    Err(bail) => {
                        skipped.push(SkippedProperty {
                            key,
                            reason: bail.reason,
                        });
                    }
                }
            }
            ObjectPropertyKind::SpreadProperty(_) => {
                return Err(BailError::new("spread element in style object"));
            }
        }
    }

    Ok((Value::Object(map), skipped, captured))
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
            Err(BailError::new(
                "template literal with expressions (non-static)",
            ))
        }

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
            Err(BailError::new(member_expression_skip_reason(
                &member.object,
                member.property.name.as_str(),
                static_values,
                keyframes_eligible,
            )))
        }
        Expression::ComputedMemberExpression(_) => {
            Err(BailError::new("member expression (non-static)"))
        }

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
    let skip = |key: &str, reason: &str| SkippedProperty {
        key: key.to_string(),
        reason: reason.to_string(),
    };

    for prop_kind in &obj.properties {
        if let ObjectPropertyKind::ObjectProperty(p) = prop_kind {
            let key = eval_property_key(&p.key)?;
            match key.as_str() {
                "prop" => {
                    if let Expression::StringLiteral(lit) = &p.value {
                        prop = lit.value.to_string();
                    } else {
                        all_skips.push(skip("prop", "variant prop name (non-static)"));
                    }
                }
                "defaultVariant" => {
                    if let Expression::StringLiteral(lit) = &p.value {
                        default_variant = Some(lit.value.to_string());
                    } else {
                        all_skips
                            .push(skip("defaultVariant", "default variant name (non-static)"));
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
                        all_skips.push(skip("base", "variant base styles (non-static)"));
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
                                ObjectPropertyKind::SpreadProperty(_) => {
                                    all_skips
                                        .push(skip("variants", "variant map spread (non-static)"));
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
                        all_skips.push(skip("variants", "variant map (non-static)"));
                    }
                }
                _ => {}
            }
        } else {
            all_skips.push(skip(
                "variant config",
                "variant config spread (non-static)",
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
    collect_static_values_impl(program, false)
}

/// Rejects partially evaluated objects, so an inferred JSX value set can
/// never omit a runtime-reachable member.
pub fn collect_complete_static_values(program: &Program<'_>) -> FxHashMap<String, Value> {
    collect_static_values_impl(program, true)
}

fn collect_static_values_impl(
    program: &Program<'_>,
    require_complete: bool,
) -> FxHashMap<String, Value> {
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
                oxc::ast::ast::BindingPattern::BindingIdentifier(ident) => {
                    ident.name.to_string()
                }
                _ => continue,
            };

            if let Some(init) = &declarator.init {
                let init = crate::chain_walk::unwrap_type_assertions(init);
                let mut dummy_skips = Vec::new();
                match init {
                    Expression::ObjectExpression(obj) => {
                        if let Ok((val, skips, captures)) = eval_object_expr(obj) {
                            if !require_complete || (skips.is_empty() && captures.is_empty()) {
                                values.insert(name, val);
                            }
                        }
                    }
                    _ => {
                        if let Ok(val) = eval_expression(init, &mut dummy_skips) {
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
