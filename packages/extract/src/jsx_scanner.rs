use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    Declaration, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild,
    JSXElementName, JSXExpression, ObjectPropertyKind, Program, PropertyKey, PropertyKind,
    Statement,
};
use serde_json::{Map, Value};

/// A system prop usage found in JSX.
#[derive(Debug, Clone)]
pub struct SystemPropUsage {
    pub prop_name: String,
    pub value: Value,
    /// Which component binding this was found on.
    pub binding: String,
}

/// Scan JSX elements in a parsed program for system prop usages.
///
/// `component_props` maps component binding names to their set of active system prop names.
/// Example: `{ "Box": {"p", "m", "mt", "display"}, "Text": {"fontSize", "color"} }`
///
/// Returns a deduplicated list of `SystemPropUsage` found across all JSX elements.
/// Deduplication key is `(prop_name, serde_json::to_string(&value))`.
pub fn scan_jsx<'a>(
    program: &Program<'a>,
    component_props: &HashMap<String, HashSet<String>>,
) -> Vec<SystemPropUsage> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut results: Vec<SystemPropUsage> = Vec::new();

    for stmt in &program.body {
        collect_from_statement(stmt, component_props, &mut seen, &mut results);
    }

    results
}

// ---------------------------------------------------------------------------
// Statement walking
// ---------------------------------------------------------------------------

fn collect_from_statement<'a>(
    stmt: &Statement<'a>,
    component_props: &HashMap<String, HashSet<String>>,
    seen: &mut HashSet<String>,
    results: &mut Vec<SystemPropUsage>,
) {
    match stmt {
        Statement::ExpressionStatement(expr_stmt) => {
            collect_from_expression(&expr_stmt.expression, component_props, seen, results);
        }

        Statement::VariableDeclaration(decl) => {
            for declarator in &decl.declarations {
                if let Some(init) = &declarator.init {
                    collect_from_expression(init, component_props, seen, results);
                }
            }
        }

        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &ret.argument {
                collect_from_expression(arg, component_props, seen, results);
            }
        }

        Statement::FunctionDeclaration(func) => {
            if let Some(body) = &func.body {
                for s in &body.statements {
                    collect_from_statement(s, component_props, seen, results);
                }
            }
        }

        Statement::ExportDefaultDeclaration(export) => {
            use oxc_ast::ast::ExportDefaultDeclarationKind;
            match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(func) => {
                    if let Some(body) = &func.body {
                        for s in &body.statements {
                            collect_from_statement(s, component_props, seen, results);
                        }
                    }
                }
                ExportDefaultDeclarationKind::ArrowFunctionExpression(arrow) => {
                    for s in &arrow.body.statements {
                        collect_from_statement(s, component_props, seen, results);
                    }
                }
                other => {
                    // ExportDefaultDeclarationKind inherits Expression variants.
                    // Use as_expression() to handle JSX / expression default exports.
                    if let Some(expr) = other.as_expression() {
                        collect_from_expression(expr, component_props, seen, results);
                    }
                }
            }
        }

        Statement::ExportNamedDeclaration(export) => {
            if let Some(decl) = &export.declaration {
                match decl {
                    Declaration::VariableDeclaration(var) => {
                        for declarator in &var.declarations {
                            if let Some(init) = &declarator.init {
                                collect_from_expression(init, component_props, seen, results);
                            }
                        }
                    }
                    Declaration::FunctionDeclaration(func) => {
                        if let Some(body) = &func.body {
                            for s in &body.statements {
                                collect_from_statement(s, component_props, seen, results);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        Statement::BlockStatement(block) => {
            for s in &block.body {
                collect_from_statement(s, component_props, seen, results);
            }
        }

        Statement::IfStatement(if_stmt) => {
            collect_from_statement(&if_stmt.consequent, component_props, seen, results);
            if let Some(alt) = &if_stmt.alternate {
                collect_from_statement(alt, component_props, seen, results);
            }
        }

        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Expression walking
// ---------------------------------------------------------------------------

fn collect_from_expression<'a>(
    expr: &Expression<'a>,
    component_props: &HashMap<String, HashSet<String>>,
    seen: &mut HashSet<String>,
    results: &mut Vec<SystemPropUsage>,
) {
    match expr {
        Expression::JSXElement(jsx_elem) => {
            // Collect props on this element, then recurse into children.
            collect_from_jsx_opening(
                &jsx_elem.opening_element.name,
                &jsx_elem.opening_element.attributes,
                component_props,
                seen,
                results,
            );
            for child in &jsx_elem.children {
                collect_from_jsx_child(child, component_props, seen, results);
            }
        }

        Expression::JSXFragment(frag) => {
            for child in &frag.children {
                collect_from_jsx_child(child, component_props, seen, results);
            }
        }

        Expression::ArrowFunctionExpression(arrow) => {
            for s in &arrow.body.statements {
                collect_from_statement(s, component_props, seen, results);
            }
        }

        Expression::FunctionExpression(func) => {
            if let Some(body) = &func.body {
                for s in &body.statements {
                    collect_from_statement(s, component_props, seen, results);
                }
            }
        }

        Expression::ConditionalExpression(cond) => {
            collect_from_expression(&cond.consequent, component_props, seen, results);
            collect_from_expression(&cond.alternate, component_props, seen, results);
        }

        Expression::LogicalExpression(logical) => {
            collect_from_expression(&logical.left, component_props, seen, results);
            collect_from_expression(&logical.right, component_props, seen, results);
        }

        Expression::SequenceExpression(seq) => {
            for e in &seq.expressions {
                collect_from_expression(e, component_props, seen, results);
            }
        }

        Expression::ParenthesizedExpression(paren) => {
            collect_from_expression(&paren.expression, component_props, seen, results);
        }

        Expression::AssignmentExpression(assign) => {
            collect_from_expression(&assign.right, component_props, seen, results);
        }

        // Walk into call expression arguments — critical for .map(), .filter(),
        // .reduce() callbacks that contain JSX (e.g., items.map(x => <Comp />))
        Expression::CallExpression(call) => {
            for arg in &call.arguments {
                if let Some(expr) = arg.as_expression() {
                    collect_from_expression(expr, component_props, seen, results);
                }
            }
        }

        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Core JSX opening-element processor (shared between expression and child walkers)
// ---------------------------------------------------------------------------

fn collect_from_jsx_opening<'a>(
    name: &JSXElementName<'a>,
    attributes: &[JSXAttributeItem<'a>],
    component_props: &HashMap<String, HashSet<String>>,
    seen: &mut HashSet<String>,
    results: &mut Vec<SystemPropUsage>,
) {
    let tag_name: Option<&str> = match name {
        JSXElementName::Identifier(id) => Some(id.name.as_str()),
        JSXElementName::IdentifierReference(id) => Some(id.name.as_str()),
        _ => None,
    };

    let Some(tag) = tag_name else {
        return;
    };

    let Some(active_props) = component_props.get(tag) else {
        return;
    };

    let binding = tag.to_string();

    for attr_item in attributes {
        match attr_item {
            JSXAttributeItem::Attribute(attr) => {
                let attr_name: Option<&str> = match &attr.name {
                    JSXAttributeName::Identifier(id) => Some(id.name.as_str()),
                    JSXAttributeName::NamespacedName(_) => None,
                };

                let Some(prop_name) = attr_name else {
                    continue;
                };

                if !active_props.contains(prop_name) {
                    continue;
                }

                let Some(value) = eval_jsx_attribute_value(&attr.value) else {
                    continue;
                };

                let dedup_key = format!(
                    "{}:{}",
                    prop_name,
                    serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string())
                );

                if seen.insert(dedup_key) {
                    results.push(SystemPropUsage {
                        prop_name: prop_name.to_string(),
                        value,
                        binding: binding.clone(),
                    });
                }
            }
            // SpreadAttributes are silently skipped per spec.
            JSXAttributeItem::SpreadAttribute(_) => {}
        }
    }
}

// ---------------------------------------------------------------------------
// JSX child walking
// ---------------------------------------------------------------------------

fn collect_from_jsx_child<'a>(
    child: &JSXChild<'a>,
    component_props: &HashMap<String, HashSet<String>>,
    seen: &mut HashSet<String>,
    results: &mut Vec<SystemPropUsage>,
) {
    match child {
        JSXChild::Element(elem) => {
            collect_from_jsx_opening(
                &elem.opening_element.name,
                &elem.opening_element.attributes,
                component_props,
                seen,
                results,
            );
            for nested in &elem.children {
                collect_from_jsx_child(nested, component_props, seen, results);
            }
        }

        JSXChild::Fragment(frag) => {
            for c in &frag.children {
                collect_from_jsx_child(c, component_props, seen, results);
            }
        }

        JSXChild::ExpressionContainer(container) => {
            // JSXExpression @inherits Expression — the interesting case is a nested JSXElement.
            // We only need to recurse into expression children that may contain more JSX.
            collect_from_jsx_expression(&container.expression, component_props, seen, results);
        }

        JSXChild::Text(_) | JSXChild::Spread(_) => {}
    }
}

/// Walk a `JSXExpression` (which inherits all `Expression` variants plus `EmptyExpression`).
/// We only care about descending into sub-expressions that can contain more JSX.
fn collect_from_jsx_expression<'a>(
    jsx_expr: &JSXExpression<'a>,
    component_props: &HashMap<String, HashSet<String>>,
    seen: &mut HashSet<String>,
    results: &mut Vec<SystemPropUsage>,
) {
    match jsx_expr {
        // The EmptyExpression `{}` — nothing to do.
        JSXExpression::EmptyExpression(_) => {}

        // JSXExpression inherits all Expression variants, so match on the ones that
        // can contain nested JSX elements.
        JSXExpression::JSXElement(elem) => {
            collect_from_jsx_opening(
                &elem.opening_element.name,
                &elem.opening_element.attributes,
                component_props,
                seen,
                results,
            );
            for child in &elem.children {
                collect_from_jsx_child(child, component_props, seen, results);
            }
        }

        JSXExpression::JSXFragment(frag) => {
            for child in &frag.children {
                collect_from_jsx_child(child, component_props, seen, results);
            }
        }

        JSXExpression::ParenthesizedExpression(paren) => {
            collect_from_expression(&paren.expression, component_props, seen, results);
        }

        JSXExpression::ConditionalExpression(cond) => {
            collect_from_expression(&cond.consequent, component_props, seen, results);
            collect_from_expression(&cond.alternate, component_props, seen, results);
        }

        JSXExpression::LogicalExpression(logical) => {
            collect_from_expression(&logical.left, component_props, seen, results);
            collect_from_expression(&logical.right, component_props, seen, results);
        }

        JSXExpression::ArrowFunctionExpression(arrow) => {
            for s in &arrow.body.statements {
                collect_from_statement(s, component_props, seen, results);
            }
        }

        // Walk into call expression arguments — critical for .map(), .filter(),
        // .reduce() callbacks that contain JSX inside expression containers
        JSXExpression::CallExpression(call) => {
            for arg in &call.arguments {
                if let Some(expr) = arg.as_expression() {
                    collect_from_expression(expr, component_props, seen, results);
                }
            }
        }

        // All other expression types (literals, identifiers, etc.) cannot
        // contain JSX children we need to walk further.
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// JSX attribute value evaluation
// ---------------------------------------------------------------------------

/// Evaluate a JSX attribute value to a static JSON `Value`.
/// Returns `None` for non-static or unsupported forms — this is a silent skip, not an error.
fn eval_jsx_attribute_value(value: &Option<JSXAttributeValue>) -> Option<Value> {
    match value {
        // Bare boolean attribute, e.g. `<Box disabled />` — treat as `true`.
        None => Some(Value::Bool(true)),

        Some(JSXAttributeValue::StringLiteral(lit)) => Some(Value::String(lit.value.to_string())),

        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match &container.expression {
                JSXExpression::EmptyExpression(_) => None,
                // JSXExpression @inherits Expression — match directly on static literal variants.
                JSXExpression::StringLiteral(lit) => Some(Value::String(lit.value.to_string())),
                JSXExpression::NumericLiteral(lit) => Some(make_json_number(lit.value)),
                JSXExpression::BooleanLiteral(lit) => Some(Value::Bool(lit.value)),
                JSXExpression::NullLiteral(_) => Some(Value::Null),
                JSXExpression::UnaryExpression(unary) => {
                    if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation {
                        if let Expression::NumericLiteral(lit) = &unary.argument {
                            return Some(make_json_number(-lit.value));
                        }
                    }
                    None
                }
                JSXExpression::ObjectExpression(obj) => eval_static_object(obj),
                JSXExpression::ParenthesizedExpression(paren) => {
                    eval_static_expression(&paren.expression)
                }
                JSXExpression::TemplateLiteral(tpl) if tpl.expressions.is_empty() => {
                    tpl.quasis
                        .first()
                        .map(|q| Value::String(q.value.raw.to_string()))
                }
                // All dynamic / non-static forms are silently skipped.
                _ => None,
            }
        }

        // Element or fragment as attribute value — not a static system prop.
        Some(JSXAttributeValue::Element(_)) | Some(JSXAttributeValue::Fragment(_)) => None,
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
            if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation {
                if let Expression::NumericLiteral(lit) = &unary.argument {
                    return Some(make_json_number(-lit.value));
                }
            }
            None
        }

        Expression::ObjectExpression(obj) => eval_static_object(obj),

        Expression::ParenthesizedExpression(paren) => eval_static_expression(&paren.expression),

        Expression::TemplateLiteral(tpl) if tpl.expressions.is_empty() => {
            tpl.quasis
                .first()
                .map(|q| Value::String(q.value.raw.to_string()))
        }

        _ => None,
    }
}

/// Evaluate an `ObjectExpression` whose keys and values are all statically known.
/// Returns `None` if any property is non-static (computed key, spread, dynamic value).
fn eval_static_object(obj: &oxc_ast::ast::ObjectExpression) -> Option<Value> {
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
fn eval_property_key(key: &PropertyKey) -> Option<String> {
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

// ---------------------------------------------------------------------------
// Usage tracking types
// ---------------------------------------------------------------------------

/// Information about a component's variant/state configuration for usage tracking
#[derive(Debug, Clone)]
pub struct ComponentUsageConfig {
    /// Map of variant prop name → (set of option names, optional default)
    pub variants: HashMap<String, (HashSet<String>, Option<String>)>,
    /// Set of state prop names
    pub states: HashSet<String>,
}

/// Variant usage found at a JSX callsite
#[derive(Debug, Clone)]
pub struct VariantUsage {
    pub component_binding: String,
    pub variant_prop: String,
    /// The value: a literal string, "__dynamic__" for non-static, "__default__" for prop absence
    pub value: String,
}

/// State usage found at a JSX callsite
#[derive(Debug, Clone)]
pub struct StateUsage {
    pub component_binding: String,
    pub state_name: String,
}

/// Complete usage scan results from one file
#[derive(Debug, Clone, Default)]
pub struct UsageScanResult {
    pub system_prop_usages: Vec<SystemPropUsage>,
    pub variant_usages: Vec<VariantUsage>,
    pub state_usages: Vec<StateUsage>,
    pub rendered_components: HashSet<String>,
}

// ---------------------------------------------------------------------------
// Usage scanning — public entry point
// ---------------------------------------------------------------------------

/// Scan JSX elements for system prop values AND variant/state/component usage.
/// This is an extended version of scan_jsx that also tracks behavioral usage.
///
/// `component_configs` maps binding name → ComponentUsageConfig (variant/state info)
/// `component_props` maps binding name → active system prop names (same as scan_jsx)
pub fn scan_jsx_usage<'a>(
    program: &Program<'a>,
    component_props: &HashMap<String, HashSet<String>>,
    component_configs: &HashMap<String, ComponentUsageConfig>,
) -> UsageScanResult {
    let mut result = UsageScanResult::default();
    // Dedup set for system props (same logic as scan_jsx)
    let mut seen: HashSet<String> = HashSet::new();

    for stmt in &program.body {
        collect_usage_from_statement(
            stmt,
            component_props,
            component_configs,
            &mut seen,
            &mut result,
        );
    }

    result
}

// ---------------------------------------------------------------------------
// Usage statement walking
// ---------------------------------------------------------------------------

fn collect_usage_from_statement<'a>(
    stmt: &Statement<'a>,
    component_props: &HashMap<String, HashSet<String>>,
    component_configs: &HashMap<String, ComponentUsageConfig>,
    seen: &mut HashSet<String>,
    result: &mut UsageScanResult,
) {
    match stmt {
        Statement::ExpressionStatement(expr_stmt) => {
            collect_usage_from_expression(
                &expr_stmt.expression,
                component_props,
                component_configs,
                seen,
                result,
            );
        }

        Statement::VariableDeclaration(decl) => {
            for declarator in &decl.declarations {
                if let Some(init) = &declarator.init {
                    collect_usage_from_expression(
                        init,
                        component_props,
                        component_configs,
                        seen,
                        result,
                    );
                }
            }
        }

        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &ret.argument {
                collect_usage_from_expression(
                    arg,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        Statement::FunctionDeclaration(func) => {
            if let Some(body) = &func.body {
                for s in &body.statements {
                    collect_usage_from_statement(
                        s,
                        component_props,
                        component_configs,
                        seen,
                        result,
                    );
                }
            }
        }

        Statement::ExportDefaultDeclaration(export) => {
            use oxc_ast::ast::ExportDefaultDeclarationKind;
            match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(func) => {
                    if let Some(body) = &func.body {
                        for s in &body.statements {
                            collect_usage_from_statement(
                                s,
                                component_props,
                                component_configs,
                                seen,
                                result,
                            );
                        }
                    }
                }
                ExportDefaultDeclarationKind::ArrowFunctionExpression(arrow) => {
                    for s in &arrow.body.statements {
                        collect_usage_from_statement(
                            s,
                            component_props,
                            component_configs,
                            seen,
                            result,
                        );
                    }
                }
                other => {
                    if let Some(expr) = other.as_expression() {
                        collect_usage_from_expression(
                            expr,
                            component_props,
                            component_configs,
                            seen,
                            result,
                        );
                    }
                }
            }
        }

        Statement::ExportNamedDeclaration(export) => {
            if let Some(decl) = &export.declaration {
                match decl {
                    Declaration::VariableDeclaration(var) => {
                        for declarator in &var.declarations {
                            if let Some(init) = &declarator.init {
                                collect_usage_from_expression(
                                    init,
                                    component_props,
                                    component_configs,
                                    seen,
                                    result,
                                );
                            }
                        }
                    }
                    Declaration::FunctionDeclaration(func) => {
                        if let Some(body) = &func.body {
                            for s in &body.statements {
                                collect_usage_from_statement(
                                    s,
                                    component_props,
                                    component_configs,
                                    seen,
                                    result,
                                );
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        Statement::BlockStatement(block) => {
            for s in &block.body {
                collect_usage_from_statement(
                    s,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        Statement::IfStatement(if_stmt) => {
            collect_usage_from_statement(
                &if_stmt.consequent,
                component_props,
                component_configs,
                seen,
                result,
            );
            if let Some(alt) = &if_stmt.alternate {
                collect_usage_from_statement(
                    alt,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Usage expression walking
// ---------------------------------------------------------------------------

fn collect_usage_from_expression<'a>(
    expr: &Expression<'a>,
    component_props: &HashMap<String, HashSet<String>>,
    component_configs: &HashMap<String, ComponentUsageConfig>,
    seen: &mut HashSet<String>,
    result: &mut UsageScanResult,
) {
    match expr {
        Expression::JSXElement(jsx_elem) => {
            collect_usage_from_jsx_opening(
                &jsx_elem.opening_element.name,
                &jsx_elem.opening_element.attributes,
                component_props,
                component_configs,
                seen,
                result,
            );
            for child in &jsx_elem.children {
                collect_usage_from_jsx_child(
                    child,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        Expression::JSXFragment(frag) => {
            for child in &frag.children {
                collect_usage_from_jsx_child(
                    child,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        Expression::ArrowFunctionExpression(arrow) => {
            for s in &arrow.body.statements {
                collect_usage_from_statement(
                    s,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        Expression::FunctionExpression(func) => {
            if let Some(body) = &func.body {
                for s in &body.statements {
                    collect_usage_from_statement(
                        s,
                        component_props,
                        component_configs,
                        seen,
                        result,
                    );
                }
            }
        }

        Expression::ConditionalExpression(cond) => {
            collect_usage_from_expression(
                &cond.consequent,
                component_props,
                component_configs,
                seen,
                result,
            );
            collect_usage_from_expression(
                &cond.alternate,
                component_props,
                component_configs,
                seen,
                result,
            );
        }

        Expression::LogicalExpression(logical) => {
            collect_usage_from_expression(
                &logical.left,
                component_props,
                component_configs,
                seen,
                result,
            );
            collect_usage_from_expression(
                &logical.right,
                component_props,
                component_configs,
                seen,
                result,
            );
        }

        Expression::SequenceExpression(seq) => {
            for e in &seq.expressions {
                collect_usage_from_expression(
                    e,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        Expression::ParenthesizedExpression(paren) => {
            collect_usage_from_expression(
                &paren.expression,
                component_props,
                component_configs,
                seen,
                result,
            );
        }

        Expression::AssignmentExpression(assign) => {
            collect_usage_from_expression(
                &assign.right,
                component_props,
                component_configs,
                seen,
                result,
            );
        }

        // Walk into call expression arguments — critical for .map(), .filter(),
        // .reduce() callbacks that contain JSX (e.g., items.map(x => <Comp />))
        Expression::CallExpression(call) => {
            for arg in &call.arguments {
                if let Some(expr) = arg.as_expression() {
                    collect_usage_from_expression(
                        expr,
                        component_props,
                        component_configs,
                        seen,
                        result,
                    );
                }
            }
        }

        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Core usage JSX opening-element processor
// ---------------------------------------------------------------------------

fn collect_usage_from_jsx_opening<'a>(
    name: &JSXElementName<'a>,
    attributes: &[JSXAttributeItem<'a>],
    component_props: &HashMap<String, HashSet<String>>,
    component_configs: &HashMap<String, ComponentUsageConfig>,
    seen: &mut HashSet<String>,
    result: &mut UsageScanResult,
) {
    let tag_name: Option<&str> = match name {
        JSXElementName::Identifier(id) => Some(id.name.as_str()),
        JSXElementName::IdentifierReference(id) => Some(id.name.as_str()),
        _ => None,
    };

    let Some(tag) = tag_name else {
        return;
    };

    // Check if this component is tracked by either system props or usage config
    let has_props = component_props.contains_key(tag);
    let has_config = component_configs.contains_key(tag);

    if !has_props && !has_config {
        return;
    }

    let binding = tag.to_string();

    // Track that this component was rendered
    result.rendered_components.insert(binding.clone());

    // Gather active system props for this component (if any)
    let active_props = component_props.get(tag);

    // Track which variant props have been seen (for absence detection)
    let mut seen_variant_props: HashSet<String> = HashSet::new();

    for attr_item in attributes {
        match attr_item {
            JSXAttributeItem::Attribute(attr) => {
                let attr_name: Option<&str> = match &attr.name {
                    JSXAttributeName::Identifier(id) => Some(id.name.as_str()),
                    JSXAttributeName::NamespacedName(_) => None,
                };

                let Some(prop_name) = attr_name else {
                    continue;
                };

                // --- System prop collection (same as scan_jsx) ---
                if let Some(props) = active_props {
                    if props.contains(prop_name) {
                        if let Some(value) = eval_jsx_attribute_value(&attr.value) {
                            let dedup_key = format!(
                                "{}:{}",
                                prop_name,
                                serde_json::to_string(&value)
                                    .unwrap_or_else(|_| "null".to_string())
                            );
                            if seen.insert(dedup_key) {
                                result.system_prop_usages.push(SystemPropUsage {
                                    prop_name: prop_name.to_string(),
                                    value,
                                    binding: binding.clone(),
                                });
                            }
                        }
                    }
                }

                // --- Variant and state collection ---
                if let Some(config) = component_configs.get(tag) {
                    // Variant prop?
                    if config.variants.contains_key(prop_name) {
                        seen_variant_props.insert(prop_name.to_string());

                        let variant_value = classify_jsx_attribute_as_variant_value(&attr.value);
                        result.variant_usages.push(VariantUsage {
                            component_binding: binding.clone(),
                            variant_prop: prop_name.to_string(),
                            value: variant_value,
                        });
                    }

                    // State prop? (any value counts as used)
                    if config.states.contains(prop_name) {
                        result.state_usages.push(StateUsage {
                            component_binding: binding.clone(),
                            state_name: prop_name.to_string(),
                        });
                    }
                }
            }
            // SpreadAttributes are silently skipped per spec.
            JSXAttributeItem::SpreadAttribute(_) => {}
        }
    }

    // Detect absent variant props — emit __default__ for each unseen variant prop
    if let Some(config) = component_configs.get(tag) {
        for variant_prop in config.variants.keys() {
            if !seen_variant_props.contains(variant_prop) {
                result.variant_usages.push(VariantUsage {
                    component_binding: binding.clone(),
                    variant_prop: variant_prop.clone(),
                    value: "__default__".to_string(),
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Usage JSX child walking
// ---------------------------------------------------------------------------

fn collect_usage_from_jsx_child<'a>(
    child: &JSXChild<'a>,
    component_props: &HashMap<String, HashSet<String>>,
    component_configs: &HashMap<String, ComponentUsageConfig>,
    seen: &mut HashSet<String>,
    result: &mut UsageScanResult,
) {
    match child {
        JSXChild::Element(elem) => {
            collect_usage_from_jsx_opening(
                &elem.opening_element.name,
                &elem.opening_element.attributes,
                component_props,
                component_configs,
                seen,
                result,
            );
            for nested in &elem.children {
                collect_usage_from_jsx_child(
                    nested,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        JSXChild::Fragment(frag) => {
            for c in &frag.children {
                collect_usage_from_jsx_child(
                    c,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        JSXChild::ExpressionContainer(container) => {
            collect_usage_from_jsx_expression(
                &container.expression,
                component_props,
                component_configs,
                seen,
                result,
            );
        }

        JSXChild::Text(_) | JSXChild::Spread(_) => {}
    }
}

/// Walk a `JSXExpression` for usage tracking — mirrors the original but with usage context.
fn collect_usage_from_jsx_expression<'a>(
    jsx_expr: &JSXExpression<'a>,
    component_props: &HashMap<String, HashSet<String>>,
    component_configs: &HashMap<String, ComponentUsageConfig>,
    seen: &mut HashSet<String>,
    result: &mut UsageScanResult,
) {
    match jsx_expr {
        JSXExpression::EmptyExpression(_) => {}

        JSXExpression::JSXElement(elem) => {
            collect_usage_from_jsx_opening(
                &elem.opening_element.name,
                &elem.opening_element.attributes,
                component_props,
                component_configs,
                seen,
                result,
            );
            for child in &elem.children {
                collect_usage_from_jsx_child(
                    child,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        JSXExpression::JSXFragment(frag) => {
            for child in &frag.children {
                collect_usage_from_jsx_child(
                    child,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        JSXExpression::ParenthesizedExpression(paren) => {
            collect_usage_from_expression(
                &paren.expression,
                component_props,
                component_configs,
                seen,
                result,
            );
        }

        JSXExpression::ConditionalExpression(cond) => {
            collect_usage_from_expression(
                &cond.consequent,
                component_props,
                component_configs,
                seen,
                result,
            );
            collect_usage_from_expression(
                &cond.alternate,
                component_props,
                component_configs,
                seen,
                result,
            );
        }

        JSXExpression::LogicalExpression(logical) => {
            collect_usage_from_expression(
                &logical.left,
                component_props,
                component_configs,
                seen,
                result,
            );
            collect_usage_from_expression(
                &logical.right,
                component_props,
                component_configs,
                seen,
                result,
            );
        }

        JSXExpression::ArrowFunctionExpression(arrow) => {
            for s in &arrow.body.statements {
                collect_usage_from_statement(
                    s,
                    component_props,
                    component_configs,
                    seen,
                    result,
                );
            }
        }

        // Walk into call expression arguments — critical for .map(), .filter(),
        // .reduce() callbacks that contain JSX inside expression containers
        JSXExpression::CallExpression(call) => {
            for arg in &call.arguments {
                if let Some(expr) = arg.as_expression() {
                    collect_usage_from_expression(
                        expr,
                        component_props,
                        component_configs,
                        seen,
                        result,
                    );
                }
            }
        }

        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Variant value classifier
// ---------------------------------------------------------------------------

/// Classify a JSX attribute value for variant tracking.
///
/// - String literal (bare or `{...}`) → return the string
/// - Any non-static expression (identifier, call, conditional, etc.) → "__dynamic__"
/// - Absent value (bare boolean prop like `<Foo variant />`) → "__dynamic__" (treat as non-static)
///
/// Note: absent variant props are handled separately via absence detection after the attribute loop.
/// This function only classifies a present attribute's value.
fn classify_jsx_attribute_as_variant_value(value: &Option<JSXAttributeValue>) -> String {
    match value {
        // Bare attribute with no value: `<Button variant />` — not a meaningful variant value;
        // treat as dynamic since there's no string option to match.
        None => "__dynamic__".to_string(),

        Some(JSXAttributeValue::StringLiteral(lit)) => lit.value.to_string(),

        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match &container.expression {
                JSXExpression::StringLiteral(lit) => lit.value.to_string(),
                // Any non-static form → dynamic
                _ => "__dynamic__".to_string(),
            }
        }

        // Element/fragment values — not a string option
        Some(JSXAttributeValue::Element(_)) | Some(JSXAttributeValue::Fragment(_)) => {
            "__dynamic__".to_string()
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn parse_and_scan(
        source: &str,
        component_props: HashMap<String, HashSet<String>>,
    ) -> Vec<SystemPropUsage> {
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::tsx()).parse();
        scan_jsx(&result.program, &component_props)
    }

    fn box_with_props(props: &[&str]) -> HashMap<String, HashSet<String>> {
        let mut map = HashMap::new();
        map.insert(
            "Box".to_string(),
            props.iter().map(|s| s.to_string()).collect(),
        );
        map
    }

    // ------------------------------------------------------------------
    // 1. Numeric prop
    // ------------------------------------------------------------------
    #[test]
    fn collects_numeric_prop() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box p={8} />;
            }
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "p");
        assert_eq!(usages[0].value, 8);
        assert_eq!(usages[0].binding, "Box");
    }

    // ------------------------------------------------------------------
    // 2. String prop (bare string attribute)
    // ------------------------------------------------------------------
    #[test]
    fn collects_string_prop() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box display="flex" />;
            }
            "#,
            box_with_props(&["display"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "display");
        assert_eq!(usages[0].value, "flex");
    }

    // ------------------------------------------------------------------
    // 3. Responsive object prop
    // ------------------------------------------------------------------
    #[test]
    fn collects_responsive_object() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box mt={{ _: 8, sm: 16 }} />;
            }
            "#,
            box_with_props(&["mt"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "mt");
        assert_eq!(usages[0].value["_"], 8);
        assert_eq!(usages[0].value["sm"], 16);
    }

    // ------------------------------------------------------------------
    // 4. Skips prop not in the active group set
    // ------------------------------------------------------------------
    #[test]
    fn skips_non_group_prop() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box variant="fill" p={8} />;
            }
            "#,
            box_with_props(&["p"]), // "variant" is NOT in the active set
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "p");
        assert_eq!(usages[0].value, 8);
    }

    // ------------------------------------------------------------------
    // 5. Skips unknown component
    // ------------------------------------------------------------------
    #[test]
    fn skips_unknown_component() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Unknown p={8} />;
            }
            "#,
            box_with_props(&["p"]), // "Unknown" is not in map
        );
        assert!(usages.is_empty());
    }

    // ------------------------------------------------------------------
    // 6. Skips dynamic (non-static) value — identifier reference
    // ------------------------------------------------------------------
    #[test]
    fn skips_dynamic_value() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box p={spacing} />;
            }
            "#,
            box_with_props(&["p"]),
        );
        assert!(usages.is_empty());
    }

    // ------------------------------------------------------------------
    // 7. Deduplicates identical (prop, value) pairs
    // ------------------------------------------------------------------
    #[test]
    fn deduplicates_same_value() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return (
                    <div>
                        <Box p={8} />
                        <Box p={8} />
                    </div>
                );
            }
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "p");
        assert_eq!(usages[0].value, 8);
    }

    // ------------------------------------------------------------------
    // 8. Different values for the same prop are kept as separate entries
    // ------------------------------------------------------------------
    #[test]
    fn different_values_kept() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return (
                    <div>
                        <Box p={8} />
                        <Box p={16} />
                    </div>
                );
            }
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 2);
        let values: HashSet<i64> = usages
            .iter()
            .map(|u| u.value.as_i64().unwrap())
            .collect();
        assert!(values.contains(&8));
        assert!(values.contains(&16));
    }

    // ------------------------------------------------------------------
    // 9. Nested JSX inside a function body is found
    // ------------------------------------------------------------------
    #[test]
    fn nested_jsx_found() {
        let usages = parse_and_scan(
            r#"
            function Card() {
                return (
                    <Box display="flex">
                        <Box p={12} />
                    </Box>
                );
            }
            "#,
            box_with_props(&["display", "p"]),
        );
        assert_eq!(usages.len(), 2);
        let names: HashSet<&str> = usages.iter().map(|u| u.prop_name.as_str()).collect();
        assert!(names.contains("display"));
        assert!(names.contains("p"));
    }

    // ------------------------------------------------------------------
    // Bonus: negative numeric value
    // ------------------------------------------------------------------
    #[test]
    fn collects_negative_number() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box mt={-4} />;
            }
            "#,
            box_with_props(&["mt"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].value, -4);
    }

    // ------------------------------------------------------------------
    // Bonus: multiple components sharing the same prop name — deduplication
    // still applies by (prop_name, value), not by binding.
    // ------------------------------------------------------------------
    #[test]
    fn multiple_components_same_prop_name() {
        let mut component_props: HashMap<String, HashSet<String>> = HashMap::new();
        component_props.insert(
            "Box".to_string(),
            ["p"].iter().map(|s| s.to_string()).collect(),
        );
        component_props.insert(
            "Text".to_string(),
            ["p"].iter().map(|s| s.to_string()).collect(),
        );

        // Both use p={8} — still deduplicated to one entry.
        let usages = parse_and_scan(
            r#"
            function App() {
                return (
                    <div>
                        <Box p={8} />
                        <Text p={8} />
                    </div>
                );
            }
            "#,
            component_props,
        );
        assert_eq!(usages.len(), 1, "same (prop, value) deduped across components");
    }

    // ------------------------------------------------------------------
    // Bonus: call expression value is skipped
    // ------------------------------------------------------------------
    #[test]
    fn skips_call_expression_value() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box p={getSpacing()} />;
            }
            "#,
            box_with_props(&["p"]),
        );
        assert!(usages.is_empty());
    }

    // ------------------------------------------------------------------
    // Bonus: conditional expression value is skipped
    // ------------------------------------------------------------------
    #[test]
    fn skips_conditional_expression_value() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box display={isOpen ? 'block' : 'none'} />;
            }
            "#,
            box_with_props(&["display"]),
        );
        assert!(usages.is_empty());
    }

    // ------------------------------------------------------------------
    // Bonus: spread attributes are silently skipped, other props collected
    // ------------------------------------------------------------------
    #[test]
    fn skips_spread_attributes() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box {...props} p={4} />;
            }
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "p");
    }

    // ------------------------------------------------------------------
    // Bonus: JSX inside a variable initializer is found
    // ------------------------------------------------------------------
    #[test]
    fn jsx_in_variable_initializer() {
        let usages = parse_and_scan(
            r#"
            const el = <Box p={24} />;
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].value, 24);
    }

    // ==================================================================
    // scan_jsx_usage tests
    // ==================================================================

    /// Build a parse + scan_jsx_usage helper
    fn parse_and_scan_usage(
        source: &str,
        component_props: HashMap<String, HashSet<String>>,
        component_configs: HashMap<String, ComponentUsageConfig>,
    ) -> UsageScanResult {
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::tsx()).parse();
        scan_jsx_usage(&result.program, &component_props, &component_configs)
    }

    /// Build a ComponentUsageConfig for Button with a single "variant" prop
    /// that has options "fill" and "stroke", default "fill".
    fn button_config_variant() -> HashMap<String, ComponentUsageConfig> {
        let mut variants = HashMap::new();
        let options: HashSet<String> = ["fill", "stroke"].iter().map(|s| s.to_string()).collect();
        variants.insert(
            "variant".to_string(),
            (options, Some("fill".to_string())),
        );
        let config = ComponentUsageConfig {
            variants,
            states: HashSet::new(),
        };
        let mut map = HashMap::new();
        map.insert("Button".to_string(), config);
        map
    }

    /// Build a ComponentUsageConfig for Layout with a "sidebar" state.
    fn layout_config_state() -> HashMap<String, ComponentUsageConfig> {
        let mut states = HashSet::new();
        states.insert("sidebar".to_string());
        let config = ComponentUsageConfig {
            variants: HashMap::new(),
            states,
        };
        let mut map = HashMap::new();
        map.insert("Layout".to_string(), config);
        map
    }

    // ------------------------------------------------------------------
    // scan_usage_collects_variant_value
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_collects_variant_value() {
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Button variant="stroke" />;
            }
            "#,
            HashMap::new(),
            button_config_variant(),
        );
        assert_eq!(result.variant_usages.len(), 1);
        assert_eq!(result.variant_usages[0].component_binding, "Button");
        assert_eq!(result.variant_usages[0].variant_prop, "variant");
        assert_eq!(result.variant_usages[0].value, "stroke");
    }

    // ------------------------------------------------------------------
    // scan_usage_collects_dynamic_variant
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_collects_dynamic_variant() {
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Button variant={x} />;
            }
            "#,
            HashMap::new(),
            button_config_variant(),
        );
        assert_eq!(result.variant_usages.len(), 1);
        assert_eq!(result.variant_usages[0].value, "__dynamic__");
    }

    // ------------------------------------------------------------------
    // scan_usage_detects_absent_variant
    // When a tracked component is rendered WITHOUT the variant prop, we emit __default__.
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_detects_absent_variant() {
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Button />;
            }
            "#,
            HashMap::new(),
            button_config_variant(),
        );
        assert_eq!(result.variant_usages.len(), 1);
        assert_eq!(result.variant_usages[0].component_binding, "Button");
        assert_eq!(result.variant_usages[0].variant_prop, "variant");
        assert_eq!(result.variant_usages[0].value, "__default__");
    }

    // ------------------------------------------------------------------
    // scan_usage_collects_state
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_collects_state() {
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Layout sidebar />;
            }
            "#,
            HashMap::new(),
            layout_config_state(),
        );
        assert_eq!(result.state_usages.len(), 1);
        assert_eq!(result.state_usages[0].component_binding, "Layout");
        assert_eq!(result.state_usages[0].state_name, "sidebar");
    }

    // ------------------------------------------------------------------
    // scan_usage_tracks_rendered_component
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_tracks_rendered_component() {
        let mut configs: HashMap<String, ComponentUsageConfig> = HashMap::new();
        configs.insert(
            "Box".to_string(),
            ComponentUsageConfig {
                variants: HashMap::new(),
                states: HashSet::new(),
            },
        );
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Box />;
            }
            "#,
            HashMap::new(),
            configs,
        );
        assert!(result.rendered_components.contains("Box"));
    }

    // ------------------------------------------------------------------
    // scan_usage_still_collects_system_props
    // Verify SystemPropUsage still works alongside new tracking.
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_still_collects_system_props() {
        let mut component_props: HashMap<String, HashSet<String>> = HashMap::new();
        component_props.insert(
            "Button".to_string(),
            ["p"].iter().map(|s| s.to_string()).collect(),
        );

        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Button p={8} variant="stroke" />;
            }
            "#,
            component_props,
            button_config_variant(),
        );

        // System prop collected
        assert_eq!(result.system_prop_usages.len(), 1);
        assert_eq!(result.system_prop_usages[0].prop_name, "p");
        assert_eq!(result.system_prop_usages[0].value, 8);

        // Variant also collected
        assert_eq!(result.variant_usages.len(), 1);
        assert_eq!(result.variant_usages[0].value, "stroke");

        // Component tracked
        assert!(result.rendered_components.contains("Button"));
    }
}
