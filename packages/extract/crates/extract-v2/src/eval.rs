//! Stage-argument evaluation — v1 `style_evaluator.rs` ported for the v2
//! spine (increment 11). BUG-COMPATIBILITY CONTRACT (design.md D3): the
//! per-property skip model, structural bails, transform capture, and
//! static-value collection replicate v1 OUTCOMES; v1's test module is
//! carried verbatim below as the executable contract.
//!
//! v2 difference (facts, not spans-into-dropped-arenas): captured
//! transforms carry OWNED SOURCE TEXT (user-authored input — recorded as
//! such per G2), taken from the stored source at capture time.

use oxc::ast::ast::{
    ArrayExpressionElement, Declaration, Expression, ObjectExpression, ObjectPropertyKind,
    Program, PropertyKey, PropertyKind, Statement, VariableDeclarationKind,
};
use oxc::span::Span;
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

/// Stable diagnostic code for selector keys with no substitutable subject
/// (ANI-027). Ancestor-prefixed and repeated subjects are SUPPORTED — the
/// resolver substitutes the class at every unquoted `&` — so the only
/// unrepresentable form left is a key whose every `&` sits inside a quoted
/// attribute value (nothing to anchor the class to).
pub const SELECTOR_UNSUPPORTED_SUBJECT: &str = "animus.selector.unsupported-subject";

/// True when a style key looks selector-shaped (`&` present) but carries no
/// substitutable subject — every `&` is inside quotes.
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

                // Selector-shaped keys whose every `&` is quoted have no
                // substitutable subject: record a coded skip instead of
                // letting theme resolution drop the rule silently (ANI-027).
                // Ancestor and repeated subjects flow through — the resolver
                // substitutes the class at every unquoted `&`.
                if unsupported_selector_key(&key) {
                    skipped.push(unsupported_selector_skip(&key));
                    continue;
                }

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
pub(crate) fn eval_expression_with_statics(
    expr: &Expression<'_>,
    skips: &mut Vec<SkippedProperty>,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<Value, BailError> {
    // `as`/`satisfies`/non-null/parens are erased type-level syntax: a wrapped
    // expression evaluates exactly like its operand (semantic-const-resolution,
    // "Type assertions are transparent to static evaluation").
    let expr = crate::chain_walk::unwrap_type_assertions(expr);
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
            // Nested object: per-property skip applies recursively.
            // If the nested object has a structural bail, convert to a value-level
            // error so the parent can skip this property.
            // Note: captures from nested objects are discarded here — this path is
            // only reached for non-object properties in eval_object_expr (objects are
            // handled directly). This path remains for eval_array_element contexts.
            match eval_object_expr_with_statics(obj, static_values) {
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
            Err(BailError::new(member_expression_skip_reason(
                &member.object,
                member.property.name.as_str(),
                static_values,
            )))
        }
        Expression::ComputedMemberExpression(_) => {
            Err(BailError::new("member expression (non-static)"))
        }

        _ => Err(BailError::new("unsupported expression type")),
    }
}

/// Why an `object.property` value could not be evaluated.
///
/// A bare "member expression (non-static)" names neither the binding nor the
/// contract it failed, so an author reading the skip cannot tell a typo from a
/// keyframes collection the engine never discovered. Everything needed is
/// already at this seam: `static_values` is the same map the engine seeds with
/// the keyframes registry (`engine.rs` injects collections under their
/// imported/exported local binding), so its membership IS the discovery
/// answer. Every reason keeps the `(non-static)` marker so existing skip
/// surfacing is unchanged in kind.
fn member_expression_skip_reason(
    object: &Expression<'_>,
    property: &str,
    static_values: Option<&FxHashMap<String, Value>>,
) -> String {
    let Expression::Identifier(ident) = object else {
        // Nested/computed object — no single binding to name.
        return "member expression (non-static)".to_string();
    };
    let base = ident.name.as_str();
    // Every named reason opens the same way and differs only in what follows.
    let named = format!("member expression '{base}.{property}' (non-static)");
    // No statics at all (the variant stage and a compound's second argument
    // evaluate this way): discovery was never consulted, so keyframes advice
    // would be unactionable noise. Report the missing context instead.
    let Some(sv) = static_values else {
        return format!("{named} — evaluated without extraction-time statics");
    };
    match sv.get(base) {
        Some(Value::Object(_)) => format!(
            "{named} — '{base}' is a discovered collection with no '{property}' member"
        ),
        Some(_) => format!("{named} — '{base}' is not an object binding"),
        None => format!(
            "{named} — '{base}' is not a discovered keyframes collection or extraction-time static binding (collections must be reachable from the system entry)"
        ),
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
///
/// Every recognized key that is not the literal shape this parser can read
/// records a SkippedProperty instead of falling through silently, so an
/// emitted class always has a witness for what it lost. The extraction outcome
/// is unchanged (a non-literal `variants` still yields an empty option map
/// with a surviving `defaultVariant`), but the disappearance now carries a
/// diagnostic — the skip vector returned here becomes `StageFacts::skipped`
/// (facts.rs) → `PipelineState::skip_warnings` (pipeline.rs) → a
/// `kind: "skip"` manifest diagnostic (analyze_css.rs).
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
                        // Identifier-backed base styles resolve through the
                        // same statics as `.styles()` arguments
                        // (semantic-const-resolution, variant stage).
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
                                // `variants: { ...sizes }` IS an object
                                // literal, so it clears the shape check above
                                // and then contributes no options at all —
                                // the same zero-CSS class by a second route.
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
                        // A whole variant map bound to a top-level const —
                        // same-file or imported through the module graph —
                        // resolves to its object-of-objects and produces the
                        // identical manifest as inlining the literal.
                        for (vkey, vstyles) in map {
                            variants.insert(vkey, vstyles);
                        }
                    } else {
                        // A genuinely dynamic map leaves `options: []` while
                        // `defaultVariant` survives; record the loss so the
                        // zero-CSS class has a witness.
                        all_skips.push(skip("variants", "variant map (non-static)"));
                    }
                }
                _ => {} // ignore unknown keys
            }
        } else {
            // `.variant({ ...cfg })` reads as an absent config — no prop, no
            // variants — while the author did supply one. Record the loss at
            // the config level so the disappearance has a witness.
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
    collect_static_values_impl(program, false)
}

/// Strict static values for reachability enrichment. Unlike the style-stage
/// collector, this rejects partially evaluated objects so inferred JSX value
/// sets can never omit a runtime-reachable member.
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
                _ => continue, // Destructuring patterns — skip
            };

            if let Some(init) = &declarator.init {
                // `const sizes = {...} as const` collects exactly like the
                // unwrapped literal (type assertions are erased syntax).
                let init = crate::chain_walk::unwrap_type_assertions(init);
                // Try evaluating the init expression
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

/// Extract the subset of static values that correspond to exported names.
///
/// v1 takes `import_resolver::FileModuleInfo`; the v2 module graph is a
/// later row, so the port accepts the same (local_name, exported_name)
/// pairs directly — semantics identical, coupling deferred.
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


// ─── v1 style_evaluator test module, ported VERBATIM as the
// bug-compatibility contract (design.md D3). Do not "fix" expectations —
// behavioral differences are register material. Source of truth:
// packages/extract/src/style_evaluator.rs tests at the port date.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::owned_ast::{OwnedAst, ParseCounter};

    fn parse_ts(full: String) -> OwnedAst {
        let counter = ParseCounter::new(0);
        OwnedAst::parse("test.ts".into(), full, &counter)
    }

    /// Parse an object expression and return the value + skipped + captured.
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

    /// Parse a `.variant()` argument object and return the config + skips.
    fn parse_variant(source: &str) -> (VariantStageConfig, Vec<SkippedProperty>) {
        parse_variant_with_statics(source, None)
    }

    /// Same, with an extraction-time statics map (ani-015 D3 departure).
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

    // ── variant-stage fall-throughs are recorded skips ───────────────────────

    #[test]
    fn variant_identifier_map_records_skip_instead_of_silent_empty() {
        let (cfg, skips) =
            parse_variant("{ prop: 'size', defaultVariant: 'lg', variants: selectSizes }");
        // Extraction OUTCOME unchanged: options stay empty, default survives.
        assert!(cfg.variants.is_empty(), "{:?}", cfg.variants);
        assert_eq!(cfg.default_variant.as_deref(), Some("lg"));
        assert_eq!(cfg.prop, "size");
        // ...but the disappearance is no longer silent.
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
        // `{ ...sizes }` clears the object-literal shape check and then
        // contributes no options — the same zero-CSS class the identifier
        // form produces, by a route the shape check cannot see.
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
        // `.variant({ ...cfg })` spreads at the CONFIG level: no key ever
        // matches, so the whole stage reads as unauthored — options `[]`,
        // no default — with the author none the wiser.
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
        // Partial extraction: the literal options survive, the spread does not
        // — and the loss is witnessed rather than inferred from a short list.
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
        // Fall-through defaults are unchanged.
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

    // ── the member-expression skip names its binding ─────────────────────────

    #[test]
    fn member_expression_skip_names_undiscovered_collection_and_contract() {
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
            reason.contains("not a discovered keyframes collection"),
            "{reason}"
        );
        assert!(
            reason.contains("reachable from the system entry"),
            "{reason}"
        );
    }

    #[test]
    fn member_expression_skip_names_a_missing_member_of_a_known_collection() {
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
            reason.contains("discovered collection with no 'pulse' member"),
            "{reason}"
        );
    }

    #[test]
    fn member_expression_skip_without_statics_reports_missing_context() {
        // The variant/second-compound-arg path evaluates with NO statics, so
        // discovery was never consulted — keyframes advice there would be
        // unactionable. Name the binding and the missing context instead.
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
        assert!(
            !reason.contains("not a discovered keyframes collection"),
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
        // ani-015 D3: `variants: sizes` with `sizes` in the statics map
        // resolves to the same config as the inline literal; base identifiers
        // resolve too; genuinely-unresolved identifiers keep the skip.
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

        // Without statics the fall-through skip is unchanged (v1 shape).
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
        // Ancestor, leading, and repeated subjects are all SUPPORTED — only
        // a key whose every `&` is quoted has nothing to substitute.
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
