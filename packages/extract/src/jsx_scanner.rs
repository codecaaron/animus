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

        // All other expression types (literals, identifiers, calls, etc.) cannot
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
}
