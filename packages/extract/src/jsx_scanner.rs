use std::marker::PhantomData;

use rustc_hash::{FxHashMap, FxHashSet};

use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Declaration, Expression, JSXAttributeItem,
    JSXAttributeName, JSXAttributeValue, JSXElementName, JSXExpression, JSXMemberExpression,
    JSXOpeningElement, ObjectPropertyKind, Program, PropertyKey, PropertyKind, Statement,
};
use oxc_ast_visit::Visit;
use serde_json::{Map, Value};

/// A system prop usage found in JSX.
#[derive(Debug, Clone)]
pub struct SystemPropUsage {
    pub prop_name: String,
    pub value: Value,
    /// Which component binding this was found on. Retained for future per-component usage tracking.
    #[allow(dead_code)]
    pub binding: String,
}

/// A dynamic prop usage found in JSX — the prop received a non-static value
/// (identifier, call expression, conditional, etc.).
#[derive(Debug, Clone)]
pub struct DynamicPropUsage {
    pub prop_name: String,
    pub binding: String,
}

/// Result of evaluating a JSX attribute value.
enum PropValueResult {
    /// Static literal value — extractable to utility class.
    Static(Value),
    /// Dynamic expression — triggers CSS variable slot generation.
    Dynamic,
    /// Skip entirely — spreads, empty expressions, non-prop attributes.
    Skip,
}

/// Result of scanning JSX for custom prop usages (static + dynamic).
pub struct CustomPropScanResult {
    pub static_usages: Vec<SystemPropUsage>,
    pub dynamic_usages: Vec<DynamicPropUsage>,
}

/// Scan JSX elements in a parsed program for system prop usages.
///
/// `component_props` maps component binding names to their set of active system prop names.
/// Example: `{ "Box": {"p", "m", "mt", "display"}, "Text": {"fontSize", "color"} }`
///
/// Returns deduplicated static usages and dynamic usages found across all JSX elements.
/// Static deduplication key is `(prop_name, serde_json::to_string(&value))`.
/// Dynamic deduplication key is `(binding, prop_name)` — scoped per component.
pub fn scan_jsx<'a>(
    program: &Program<'a>,
    component_props: &FxHashMap<String, FxHashSet<String>>,
    member_expr_bindings: &FxHashMap<String, String>,
) -> CustomPropScanResult {
    let mut scanner = SystemPropScanner {
        component_props,
        member_expr_bindings,
        seen: FxHashSet::default(),
        dynamic_seen: FxHashSet::default(),
        results: Vec::new(),
        dynamic_results: Vec::new(),
        _phantom: PhantomData,
    };
    scanner.visit_program(program);

    CustomPropScanResult {
        static_usages: scanner.results,
        dynamic_usages: scanner.dynamic_results,
    }
}

// ---------------------------------------------------------------------------
// SystemPropScanner — Visit-based JSX scanner for system prop usages
// ---------------------------------------------------------------------------

struct SystemPropScanner<'a, 'b> {
    component_props: &'b FxHashMap<String, FxHashSet<String>>,
    member_expr_bindings: &'b FxHashMap<String, String>,
    seen: FxHashSet<String>,
    dynamic_seen: FxHashSet<String>,
    results: Vec<SystemPropUsage>,
    dynamic_results: Vec<DynamicPropUsage>,
    _phantom: PhantomData<&'a ()>,
}

impl<'a, 'b> Visit<'a> for SystemPropScanner<'a, 'b> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        let (tag, resolved_binding) = match &elem.name {
            JSXElementName::Identifier(id) => (id.name.as_str(), None),
            JSXElementName::IdentifierReference(id) => (id.name.as_str(), None),
            JSXElementName::MemberExpression(member) => {
                match resolve_jsx_member_expr(member, self.member_expr_bindings) {
                    Some(binding) => (binding.as_str(), Some(binding.clone())),
                    None => return,
                }
            }
            _ => return,
        };

        let Some(active_props) = self.component_props.get(tag) else {
            return;
        };

        let binding = resolved_binding.unwrap_or_else(|| tag.to_string());

        for attr_item in &elem.attributes {
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

                    match eval_jsx_attribute_value(&attr.value) {
                        PropValueResult::Static(value) => {
                            let dedup_key = format!(
                                "{}:{}",
                                prop_name,
                                serde_json::to_string(&value)
                                    .unwrap_or_else(|_| "null".to_string())
                            );
                            if self.seen.insert(dedup_key) {
                                self.results.push(SystemPropUsage {
                                    prop_name: prop_name.to_string(),
                                    value,
                                    binding: binding.clone(),
                                });
                            }
                        }
                        PropValueResult::Dynamic => {
                            let dedup_key = format!("{}::{}", binding, prop_name);
                            if self.dynamic_seen.insert(dedup_key) {
                                self.dynamic_results.push(DynamicPropUsage {
                                    prop_name: prop_name.to_string(),
                                    binding: binding.clone(),
                                });
                            }
                        }
                        PropValueResult::Skip => {}
                    }
                }
                JSXAttributeItem::SpreadAttribute(_) => {}
            }
        }
        // Do NOT call walk_jsx_opening_element — we processed attributes ourselves
        // and don't need to recursively visit them as AST nodes.
    }
}

// ---------------------------------------------------------------------------
// JSX attribute value evaluation
// ---------------------------------------------------------------------------

/// Evaluate a JSX attribute value to a static JSON `Value`.
/// Returns `None` for non-static or unsupported forms — this is a silent skip, not an error.
fn eval_jsx_attribute_value(value: &Option<JSXAttributeValue>) -> PropValueResult {
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
                    if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation {
                        if let Expression::NumericLiteral(lit) = &unary.argument {
                            return PropValueResult::Static(make_json_number(-lit.value));
                        }
                    }
                    PropValueResult::Dynamic
                }
                JSXExpression::ObjectExpression(obj) => match eval_static_object(obj) {
                    Some(v) => PropValueResult::Static(v),
                    None => PropValueResult::Dynamic,
                },
                JSXExpression::ParenthesizedExpression(paren) => {
                    match eval_static_expression(&paren.expression) {
                        Some(v) => PropValueResult::Static(v),
                        None => PropValueResult::Dynamic,
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
                _ => PropValueResult::Dynamic,
            }
        }

        // Element or fragment as attribute value — not a system prop value.
        Some(JSXAttributeValue::Element(_)) | Some(JSXAttributeValue::Fragment(_)) => {
            PropValueResult::Skip
        }
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
    pub variants: FxHashMap<String, (FxHashSet<String>, Option<String>)>,
    /// Set of state prop names
    pub states: FxHashSet<String>,
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
    pub dynamic_prop_usages: Vec<DynamicPropUsage>,
    pub variant_usages: Vec<VariantUsage>,
    pub state_usages: Vec<StateUsage>,
    pub rendered_components: FxHashSet<String>,
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
    component_props: &FxHashMap<String, FxHashSet<String>>,
    component_configs: &FxHashMap<String, ComponentUsageConfig>,
    member_expr_bindings: &FxHashMap<String, String>,
) -> UsageScanResult {
    let mut scanner = UsageScanner {
        component_props,
        component_configs,
        member_expr_bindings,
        seen: FxHashSet::default(),
        result: UsageScanResult::default(),
        _phantom: PhantomData,
    };
    scanner.visit_program(program);
    scanner.result
}

// ---------------------------------------------------------------------------
// UsageScanner — Visit-based JSX scanner for variant/state/system prop usage
// ---------------------------------------------------------------------------

struct UsageScanner<'a, 'b> {
    component_props: &'b FxHashMap<String, FxHashSet<String>>,
    component_configs: &'b FxHashMap<String, ComponentUsageConfig>,
    member_expr_bindings: &'b FxHashMap<String, String>,
    seen: FxHashSet<String>,
    result: UsageScanResult,
    _phantom: PhantomData<&'a ()>,
}

impl<'a, 'b> Visit<'a> for UsageScanner<'a, 'b> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        let (tag, resolved_binding) = match &elem.name {
            JSXElementName::Identifier(id) => (id.name.as_str(), None),
            JSXElementName::IdentifierReference(id) => (id.name.as_str(), None),
            JSXElementName::MemberExpression(member) => {
                match resolve_jsx_member_expr(member, self.member_expr_bindings) {
                    Some(binding) => (binding.as_str(), Some(binding.clone())),
                    None => return,
                }
            }
            _ => return,
        };

        let has_props = self.component_props.contains_key(tag);
        let has_config = self.component_configs.contains_key(tag);

        if !has_props && !has_config {
            return;
        }

        let binding = resolved_binding.unwrap_or_else(|| tag.to_string());

        // Track that this component was rendered
        self.result.rendered_components.insert(binding.clone());

        // Gather active system props for this component (if any)
        let active_props = self.component_props.get(tag);

        // Track which variant props have been seen (for absence detection)
        let mut seen_variant_props: FxHashSet<String> = FxHashSet::default();

        for attr_item in &elem.attributes {
            match attr_item {
                JSXAttributeItem::Attribute(attr) => {
                    let attr_name: Option<&str> = match &attr.name {
                        JSXAttributeName::Identifier(id) => Some(id.name.as_str()),
                        JSXAttributeName::NamespacedName(_) => None,
                    };

                    let Some(prop_name) = attr_name else {
                        continue;
                    };

                    // --- System prop collection ---
                    if let Some(props) = active_props {
                        if props.contains(prop_name) {
                            match eval_jsx_attribute_value(&attr.value) {
                                PropValueResult::Static(value) => {
                                    let dedup_key = format!(
                                        "{}:{}",
                                        prop_name,
                                        serde_json::to_string(&value)
                                            .unwrap_or_else(|_| "null".to_string())
                                    );
                                    if self.seen.insert(dedup_key) {
                                        self.result.system_prop_usages.push(SystemPropUsage {
                                            prop_name: prop_name.to_string(),
                                            value,
                                            binding: binding.clone(),
                                        });
                                    }
                                }
                                PropValueResult::Dynamic => {
                                    let dedup_key =
                                        format!("__dynamic__:{}", prop_name);
                                    if self.seen.insert(dedup_key) {
                                        self.result.dynamic_prop_usages.push(
                                            DynamicPropUsage {
                                                prop_name: prop_name.to_string(),
                                                binding: binding.clone(),
                                            },
                                        );
                                    }
                                }
                                PropValueResult::Skip => {}
                            }
                        }
                    }

                    // --- Variant and state collection ---
                    if let Some(config) = self.component_configs.get(tag) {
                        if config.variants.contains_key(prop_name) {
                            seen_variant_props.insert(prop_name.to_string());

                            let variant_value = classify_jsx_attribute_as_variant_value(&attr.value);
                            self.result.variant_usages.push(VariantUsage {
                                component_binding: binding.clone(),
                                variant_prop: prop_name.to_string(),
                                value: variant_value,
                            });
                        }

                        if config.states.contains(prop_name) {
                            self.result.state_usages.push(StateUsage {
                                component_binding: binding.clone(),
                                state_name: prop_name.to_string(),
                            });
                        }
                    }
                }
                JSXAttributeItem::SpreadAttribute(_) => {}
            }
        }

        // Detect absent variant props — emit __default__ for each unseen variant prop
        if let Some(config) = self.component_configs.get(tag) {
            for variant_prop in config.variants.keys() {
                if !seen_variant_props.contains(variant_prop) {
                    self.result.variant_usages.push(VariantUsage {
                        component_binding: binding.clone(),
                        variant_prop: variant_prop.clone(),
                        value: "__default__".to_string(),
                    });
                }
            }
        }
        // Do NOT call walk_jsx_opening_element — we processed attributes ourselves.
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        // Recognize `createElement(Component, ...)` and `React.createElement(Component, ...)`
        // as component render usage, parity with JSX-element and JSX-member-expression paths.
        let is_create_element = match &call.callee {
            Expression::Identifier(id) => id.name.as_str() == "createElement",
            Expression::StaticMemberExpression(member) => match &member.object {
                Expression::Identifier(obj) => {
                    obj.name.as_str() == "React"
                        && member.property.name.as_str() == "createElement"
                }
                _ => false,
            },
            _ => false,
        };

        if is_create_element {
            if let Some(first_arg) = call.arguments.first() {
                let resolved: Option<String> = match first_arg {
                    // Bare identifier: createElement(Component, ...) — resolve against the
                    // active binding maps the same way JSX tags do.
                    Argument::Identifier(id) => {
                        let name = id.name.as_str();
                        if self.component_props.contains_key(name)
                            || self.component_configs.contains_key(name)
                        {
                            Some(name.to_string())
                        } else {
                            None
                        }
                    }
                    // Member expression: createElement(Family.Slot, ...) — dotted-key lookup
                    // matches the JSX `<Family.Slot>` resolution path.
                    Argument::StaticMemberExpression(member) => match &member.object {
                        Expression::Identifier(obj) => {
                            let dotted_key = format!(
                                "{}.{}",
                                obj.name.as_str(),
                                member.property.name.as_str()
                            );
                            self.member_expr_bindings.get(&dotted_key).cloned()
                        }
                        _ => None,
                    },
                    // String literal → native DOM element, no render tracking.
                    // Any other form (call, conditional, template, etc.) → dynamic, cannot attribute.
                    _ => None,
                };

                if let Some(binding) = resolved {
                    self.result.rendered_components.insert(binding);
                }
            }
        }

        // Continue walking into arguments so nested createElement / JSX children are visited.
        oxc_ast_visit::walk::walk_call_expression(self, call);
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
// Member expression resolution — map Family.Slot → original binding
// ---------------------------------------------------------------------------

/// Resolve a JSX member expression (e.g., `NavBar.Root`) to the original
/// component binding name (e.g., `NavBarRoot`) via the member expression map.
///
/// Only handles single-level member expressions (Family.Slot), not nested
/// chains (a.b.c). Returns `None` for unresolvable expressions.
fn resolve_jsx_member_expr<'a>(
    member: &JSXMemberExpression,
    member_expr_bindings: &'a FxHashMap<String, String>,
) -> Option<&'a String> {
    // get_identifier() walks nested member expressions to find the root IdentifierReference.
    // For single-level `NavBar.Root`, returns `NavBar`.
    // For `this.Root` or deeply nested chains, returns None or the root identifier.
    let root_ident = member.get_identifier()?;
    let object_name = root_ident.name.as_str();
    let slot_name = member.property.name.as_str();
    let dotted_key = format!("{}.{}", object_name, slot_name);
    member_expr_bindings.get(&dotted_key)
}

// ---------------------------------------------------------------------------
// compose() detection — extract family structure for CSS-only propagation
// ---------------------------------------------------------------------------

/// Structured information about a compose() call.
/// Used by the reconciler (mark shared variant options as used) and
/// css_generator (emit composed variant CSS rules).
#[derive(Debug, Clone)]
pub struct ComposeFamilyInfo {
    /// The variable name the compose() result is assigned to (e.g., "NavBar").
    /// Used to build member expression resolution map for JSX scanning.
    /// `None` for default exports or expressions not assigned to a variable.
    pub family_binding: Option<String>,
    /// The binding name of the Root slot component
    pub root_binding: String,
    /// (slot_name, binding_name) pairs for all slots including Root
    pub slots: Vec<(String, String)>,
    /// Variant keys shared across the family (from `{ shared: { size: true } }`)
    pub shared_keys: Vec<String>,
    /// Whether this family uses React context for portal-crossing propagation
    pub context: bool,
    /// Byte range of the compose() call expression (for transform replacement).
    pub span: (u32, u32),
    /// The family name from options.name (e.g., "Card"), or "Composed" if absent.
    pub name: String,
}

/// Scan a parsed program for `compose(...)` calls and extract full
/// family structure: slot names, binding names, and shared variant keys.
///
/// compose() wraps slot components via createElement at runtime, which
/// the JSX scanner can't see. The returned info feeds:
/// 1. Reconciler — mark slot bindings as rendered, preserve shared variant options
/// 2. CSS generator — emit composed variant rules (inheritance + override)
pub fn scan_compose_calls(program: &Program) -> Vec<ComposeFamilyInfo> {
    let mut families: Vec<ComposeFamilyInfo> = Vec::new();
    for stmt in &program.body {
        collect_compose_from_statement(stmt, &mut families);
    }
    families
}

fn collect_compose_from_statement(stmt: &Statement, families: &mut Vec<ComposeFamilyInfo>) {
    match stmt {
        Statement::VariableDeclaration(decl) => {
            for declarator in &decl.declarations {
                if let Some(init) = &declarator.init {
                    let binding_name = extract_binding_name(&declarator.id);
                    collect_compose_from_expression(init, binding_name, families);
                }
            }
        }
        Statement::ExportNamedDeclaration(export) => {
            if let Some(Declaration::VariableDeclaration(var_decl)) = &export.declaration {
                for declarator in &var_decl.declarations {
                    if let Some(init) = &declarator.init {
                        let binding_name = extract_binding_name(&declarator.id);
                        collect_compose_from_expression(init, binding_name, families);
                    }
                }
            }
        }
        Statement::ExportDefaultDeclaration(export) => {
            use oxc_ast::ast::ExportDefaultDeclarationKind;
            if let ExportDefaultDeclarationKind::CallExpression(call) = &export.declaration {
                extract_compose_family(call, None, families);
            }
        }
        _ => {}
    }
}

/// Extract the binding name from a variable declarator pattern.
fn extract_binding_name(pattern: &BindingPattern) -> Option<String> {
    match pattern {
        BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
        _ => None,
    }
}

fn collect_compose_from_expression(
    expr: &Expression,
    family_binding: Option<String>,
    families: &mut Vec<ComposeFamilyInfo>,
) {
    if let Expression::CallExpression(call) = expr {
        extract_compose_family(call, family_binding, families);
    }
}

fn extract_compose_family(
    call: &oxc_ast::ast::CallExpression,
    family_binding: Option<String>,
    families: &mut Vec<ComposeFamilyInfo>,
) {
    // Check if callee is `compose` or `composeWithContext`
    let callee_name = match &call.callee {
        Expression::Identifier(id) => match id.name.as_str() {
            "compose" | "composeWithContext" => Some(id.name.as_str()),
            _ => None,
        },
        _ => None,
    };

    let Some(callee_name) = callee_name else {
        return;
    };

    let force_context = callee_name == "composeWithContext";

    // First argument: slots object { Root: X, Control: Y, ... }
    let Some(first_arg) = call.arguments.first() else {
        return;
    };

    let Argument::ObjectExpression(obj) = first_arg else {
        return;
    };

    let mut slots: Vec<(String, String)> = Vec::new();
    let mut root_binding = String::new();

    for prop in &obj.properties {
        if let ObjectPropertyKind::ObjectProperty(prop) = prop {
            let slot_name = match eval_property_key(&prop.key) {
                Some(name) => name,
                None => continue,
            };
            let binding_name = match &prop.value {
                Expression::Identifier(id) => id.name.to_string(),
                _ => continue,
            };
            if slot_name == "Root" {
                root_binding = binding_name.clone();
            }
            slots.push((slot_name, binding_name));
        }
    }

    // Must have a Root slot and at least one slot
    if root_binding.is_empty() || slots.is_empty() {
        return;
    }

    // Second argument: options object { shared: { size: true, ... }, name?: "..." }
    // For composeWithContext, context is always true regardless of options.
    let (shared_keys, context_from_opts, name_opt) = call
        .arguments
        .get(1)
        .and_then(|arg| match arg {
            Argument::ObjectExpression(opts) => {
                Some((
                    extract_shared_keys(opts).unwrap_or_default(),
                    extract_context_flag(opts),
                    extract_name_option(opts),
                ))
            }
            _ => None,
        })
        .unwrap_or_default();

    let context = force_context || context_from_opts;

    // Fall back to family_binding or "Composed" for the display name
    let name = name_opt
        .or_else(|| family_binding.clone())
        .unwrap_or_else(|| "Composed".to_string());

    families.push(ComposeFamilyInfo {
        family_binding,
        root_binding,
        slots,
        shared_keys,
        context,
        span: (call.span.start, call.span.end),
        name,
    });
}

/// Extract shared key names from the options object's `shared` property.
/// `{ shared: { size: true, tone: true } }` → `["size", "tone"]`
fn extract_shared_keys(opts: &oxc_ast::ast::ObjectExpression) -> Option<Vec<String>> {
    for prop in &opts.properties {
        if let ObjectPropertyKind::ObjectProperty(prop) = prop {
            let key = eval_property_key(&prop.key)?;
            if key == "shared" {
                if let Expression::ObjectExpression(shared_obj) = &prop.value {
                    let mut keys = Vec::new();
                    for shared_prop in &shared_obj.properties {
                        if let ObjectPropertyKind::ObjectProperty(sp) = shared_prop {
                            if let Some(k) = eval_property_key(&sp.key) {
                                keys.push(k);
                            }
                        }
                    }
                    return Some(keys);
                }
            }
        }
    }
    None
}

/// Extract the `context` boolean from the compose options object.
/// `{ shared: {...}, context: true }` → `true`
/// Absent or non-`true` values → `false`
fn extract_context_flag(opts: &oxc_ast::ast::ObjectExpression) -> bool {
    for prop in &opts.properties {
        if let ObjectPropertyKind::ObjectProperty(prop) = prop {
            if let Some(key) = eval_property_key(&prop.key) {
                if key == "context" {
                    if let Expression::BooleanLiteral(b) = &prop.value {
                        return b.value;
                    }
                    return false;
                }
            }
        }
    }
    false
}

/// Extract the `name` string from the compose options object.
/// `{ shared: {...}, name: "Card" }` → `Some("Card")`
/// Absent → `None`
fn extract_name_option(opts: &oxc_ast::ast::ObjectExpression) -> Option<String> {
    for prop in &opts.properties {
        if let ObjectPropertyKind::ObjectProperty(prop) = prop {
            if let Some(key) = eval_property_key(&prop.key) {
                if key == "name" {
                    if let Expression::StringLiteral(s) = &prop.value {
                        return Some(s.value.to_string());
                    }
                    return None;
                }
            }
        }
    }
    None
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

    macro_rules! map {
        ($( $key:expr => $val:expr ),* $(,)?) => {{
            let mut m = FxHashMap::default();
            $( m.insert($key.to_string(), $val); )*
            m
        }};
    }

    macro_rules! set {
        ($( $val:expr ),* $(,)?) => {{
            let mut s = FxHashSet::default();
            $( s.insert($val.to_string()); )*
            s
        }};
    }

    fn parse_and_scan(
        source: &str,
        component_props: FxHashMap<String, FxHashSet<String>>,
    ) -> Vec<SystemPropUsage> {
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::tsx()).parse();
        let empty = FxHashMap::default();
        scan_jsx(&result.program, &component_props, &empty).static_usages
    }

    fn parse_and_scan_full(
        source: &str,
        component_props: FxHashMap<String, FxHashSet<String>>,
    ) -> CustomPropScanResult {
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::tsx()).parse();
        let empty = FxHashMap::default();
        scan_jsx(&result.program, &component_props, &empty)
    }

    fn box_with_props(props: &[&str]) -> FxHashMap<String, FxHashSet<String>> {
        map! { "Box" => props.iter().map(|s| s.to_string()).collect() }
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
        let values: FxHashSet<i64> = usages
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
        let names: FxHashSet<&str> = usages.iter().map(|u| u.prop_name.as_str()).collect();
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
        let component_props = map! {
            "Box" => set!["p"],
            "Text" => set!["p"],
        };

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
        component_props: FxHashMap<String, FxHashSet<String>>,
        component_configs: FxHashMap<String, ComponentUsageConfig>,
    ) -> UsageScanResult {
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::tsx()).parse();
        let empty = FxHashMap::default();
        scan_jsx_usage(&result.program, &component_props, &component_configs, &empty)
    }

    /// Build a ComponentUsageConfig for Button with a single "variant" prop
    /// that has options "fill" and "stroke", default "fill".
    fn button_config_variant() -> FxHashMap<String, ComponentUsageConfig> {
        map! {
            "Button" => ComponentUsageConfig {
                variants: map! { "variant" => (set!["fill", "stroke"], Some("fill".to_string())) },
                states: FxHashSet::default(),
            }
        }
    }

    /// Build a ComponentUsageConfig for Layout with a "sidebar" state.
    fn layout_config_state() -> FxHashMap<String, ComponentUsageConfig> {
        map! {
            "Layout" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: set!["sidebar"],
            }
        }
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
            FxHashMap::default(),
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
            FxHashMap::default(),
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
            FxHashMap::default(),
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
            FxHashMap::default(),
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
        let configs = map! {
            "Box" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            }
        };
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Box />;
            }
            "#,
            FxHashMap::default(),
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
        let component_props = map! { "Button" => set!["p"] };

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

    // ==================================================================
    // createElement render-tracking tests
    // ==================================================================

    fn parse_and_scan_usage_with_members(
        source: &str,
        component_props: FxHashMap<String, FxHashSet<String>>,
        component_configs: FxHashMap<String, ComponentUsageConfig>,
        member_expr_bindings: FxHashMap<String, String>,
    ) -> UsageScanResult {
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::tsx()).parse();
        scan_jsx_usage(
            &result.program,
            &component_props,
            &component_configs,
            &member_expr_bindings,
        )
    }

    fn box_config_empty() -> FxHashMap<String, ComponentUsageConfig> {
        map! {
            "Box" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            }
        }
    }

    #[test]
    fn create_element_bare_ident_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() { return createElement(Box, {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            result.rendered_components.contains("Box"),
            "createElement(Box, ...) must register Box as rendered"
        );
    }

    #[test]
    fn react_create_element_member_callee_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import React from 'react';
            function App() { return React.createElement(Box, {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            result.rendered_components.contains("Box"),
            "React.createElement(Box, ...) must register Box as rendered"
        );
    }

    #[test]
    fn create_element_family_slot_tracked() {
        let configs = map! {
            "NavBarRoot" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            }
        };
        let member_bindings = map! { "NavBar.Root" => "NavBarRoot".to_string() };
        let result = parse_and_scan_usage_with_members(
            r#"
            import { createElement } from 'react';
            function App() { return createElement(NavBar.Root, {}); }
            "#,
            FxHashMap::default(),
            configs,
            member_bindings,
        );
        assert!(
            result.rendered_components.contains("NavBarRoot"),
            "createElement(NavBar.Root, ...) must register NavBarRoot via member_expr_bindings"
        );
    }

    #[test]
    fn create_element_string_literal_not_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() { return createElement('div', {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            !result.rendered_components.contains("Box"),
            "createElement('div', ...) is a native element — no binding tracking"
        );
        assert!(
            result.rendered_components.is_empty(),
            "native element should not populate rendered_components"
        );
    }

    #[test]
    fn create_element_dynamic_first_arg_not_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() { return createElement(getComponent(), {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            result.rendered_components.is_empty(),
            "dynamic first arg (call expression) cannot be attributed to a binding"
        );
    }

    #[test]
    fn create_element_untracked_binding_not_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() { return createElement(UntrackedThing, {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            result.rendered_components.is_empty(),
            "identifier not in component_props/configs must not populate rendered_components"
        );
    }

    #[test]
    fn create_element_nested_both_tracked() {
        let configs = map! {
            "Outer" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            },
            "Inner" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            },
        };
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() {
                return createElement(Outer, {}, createElement(Inner, {}));
            }
            "#,
            FxHashMap::default(),
            configs,
        );
        assert!(
            result.rendered_components.contains("Outer"),
            "outer createElement must be tracked"
        );
        assert!(
            result.rendered_components.contains("Inner"),
            "nested createElement must be tracked — walk_call_expression continues descent"
        );
    }

    #[test]
    fn create_element_mixed_with_jsx_both_tracked() {
        let configs = map! {
            "JsxOnly" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            },
            "CallOnly" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            },
        };
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() {
                return (
                    <JsxOnly>
                        {createElement(CallOnly, {})}
                    </JsxOnly>
                );
            }
            "#,
            FxHashMap::default(),
            configs,
        );
        assert!(result.rendered_components.contains("JsxOnly"));
        assert!(result.rendered_components.contains("CallOnly"));
    }

    // ==================================================================
    // Dynamic prop detection tests
    // ==================================================================

    fn parse_dynamic_usages(source: &str) -> UsageScanResult {
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::tsx()).parse();
        let empty = FxHashMap::default();
        scan_jsx_usage(
            &result.program,
            &box_with_props(&["p", "display", "mt", "borderRadius"]),
            &FxHashMap::default(),
            &empty,
        )
    }

    #[test]
    fn detects_identifier_as_dynamic() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box p={spacing} />; }"#,
        );
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn detects_call_expression_as_dynamic() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box p={getSpacing()} />; }"#,
        );
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn detects_conditional_as_dynamic() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box display={isOpen ? 'block' : 'none'} />; }"#,
        );
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "display");
    }

    #[test]
    fn detects_member_expression_as_dynamic() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box p={theme.spacing.large} />; }"#,
        );
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn detects_template_literal_with_expression_as_dynamic() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box p={`${size}px`} />; }"#,
        );
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn static_literals_still_produce_static() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box p={8} display="flex" mt={{ _: 4, sm: 8 }} />; }"#,
        );
        assert_eq!(result.system_prop_usages.len(), 3);
        assert!(result.dynamic_prop_usages.is_empty());
    }

    #[test]
    fn same_prop_static_and_dynamic_produces_both() {
        let result = parse_dynamic_usages(
            r#"function App() { return <div><Box p={8} /><Box p={variable} /></div>; }"#,
        );
        assert_eq!(result.system_prop_usages.len(), 1);
        assert_eq!(result.system_prop_usages[0].value, 8);
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn dynamic_deduplicates_by_prop_name() {
        let result = parse_dynamic_usages(
            r#"function App() { return <div><Box p={a} /><Box p={b} /></div>; }"#,
        );
        assert_eq!(result.dynamic_prop_usages.len(), 1, "same prop name deduped");
    }

    #[test]
    fn binary_expression_is_dynamic() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box p={base + 4} />; }"#,
        );
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
    }

    #[test]
    fn responsive_object_with_dynamic_value_is_dynamic() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box mt={{ _: spacing, sm: 16 }} />; }"#,
        );
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "mt");
    }

    // ==================================================================
    // Custom prop dynamic detection tests (scan_jsx path)
    // ==================================================================

    fn card_with_custom_props(props: &[&str]) -> FxHashMap<String, FxHashSet<String>> {
        map! { "Card" => props.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn custom_prop_identifier_detected_as_dynamic() {
        let result = parse_and_scan_full(
            r#"function App() { return <Card sizing={mySize} />; }"#,
            card_with_custom_props(&["sizing"]),
        );
        assert!(result.static_usages.is_empty());
        assert_eq!(result.dynamic_usages.len(), 1);
        assert_eq!(result.dynamic_usages[0].prop_name, "sizing");
        assert_eq!(result.dynamic_usages[0].binding, "Card");
    }

    #[test]
    fn custom_prop_conditional_detected_as_dynamic() {
        let result = parse_and_scan_full(
            r#"function App() { return <Card sizing={isLarge ? 100 : 50} />; }"#,
            card_with_custom_props(&["sizing"]),
        );
        assert!(result.static_usages.is_empty());
        assert_eq!(result.dynamic_usages.len(), 1);
        assert_eq!(result.dynamic_usages[0].prop_name, "sizing");
    }

    #[test]
    fn custom_prop_static_not_marked_dynamic() {
        let result = parse_and_scan_full(
            r#"function App() { return <Card sizing={100} density="compact" />; }"#,
            card_with_custom_props(&["sizing", "density"]),
        );
        assert_eq!(result.static_usages.len(), 2);
        assert!(result.dynamic_usages.is_empty());
    }

    // ------------------------------------------------------------------
    // compose() family extraction
    // ------------------------------------------------------------------

    fn parse_compose_families(source: &str) -> Vec<ComposeFamilyInfo> {
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::tsx()).parse();
        scan_compose_calls(&result.program)
    }

    #[test]
    fn compose_extracts_slots_and_shared_keys() {
        let families = parse_compose_families(
            r#"const Family = compose({ Root, Control, Label }, { shared: { size: true, tone: true } });"#,
        );
        assert_eq!(families.len(), 1);
        let f = &families[0];
        assert_eq!(f.root_binding, "Root");
        assert_eq!(f.slots.len(), 3);
        assert_eq!(f.slots[0], ("Root".to_string(), "Root".to_string()));
        assert_eq!(f.slots[1], ("Control".to_string(), "Control".to_string()));
        assert_eq!(f.slots[2], ("Label".to_string(), "Label".to_string()));
        assert_eq!(f.shared_keys, vec!["size", "tone"]);
    }

    #[test]
    fn compose_empty_shared() {
        let families = parse_compose_families(
            r#"const F = compose({ Root, Child }, { shared: {} });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(families[0].shared_keys.is_empty());
    }

    #[test]
    fn compose_no_shared_arg() {
        // compose() with only the slots arg (no options) — still extracts slots
        let families = parse_compose_families(
            r#"const F = compose({ Root, Child });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(families[0].shared_keys.is_empty());
        assert_eq!(families[0].slots.len(), 2);
    }

    #[test]
    fn compose_multiple_calls_per_file() {
        let families = parse_compose_families(
            r#"
            const A = compose({ Root: RootA, Item: ItemA }, { shared: { size: true } });
            const B = compose({ Root: RootB, Label: LabelB }, { shared: { tone: true } });
            "#,
        );
        assert_eq!(families.len(), 2);
        assert_eq!(families[0].root_binding, "RootA");
        assert_eq!(families[0].shared_keys, vec!["size"]);
        assert_eq!(families[1].root_binding, "RootB");
        assert_eq!(families[1].shared_keys, vec!["tone"]);
    }

    #[test]
    fn compose_exported_named() {
        let families = parse_compose_families(
            r#"export const Family = compose({ Root, Child }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert_eq!(families[0].root_binding, "Root");
    }

    #[test]
    fn compose_skips_no_root() {
        let families = parse_compose_families(
            r#"const F = compose({ Item, Label }, { shared: { size: true } });"#,
        );
        assert!(families.is_empty(), "No Root slot → family skipped");
    }

    #[test]
    fn compose_aliased_slot_bindings() {
        let families = parse_compose_families(
            r#"const F = compose({ Root: MyRoot, Control: MyControl }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert_eq!(families[0].root_binding, "MyRoot");
        assert_eq!(families[0].slots[0], ("Root".to_string(), "MyRoot".to_string()));
        assert_eq!(families[0].slots[1], ("Control".to_string(), "MyControl".to_string()));
    }

    #[test]
    fn compose_context_true_extracted() {
        let families = parse_compose_families(
            r#"const F = compose({ Root, Child }, { shared: { size: true }, context: true });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(families[0].context);
        assert_eq!(families[0].shared_keys, vec!["size"]);
    }

    #[test]
    fn compose_context_defaults_to_false() {
        let families = parse_compose_families(
            r#"const F = compose({ Root, Child }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(!families[0].context);
    }

    #[test]
    fn compose_context_false_extracted() {
        let families = parse_compose_families(
            r#"const F = compose({ Root, Child }, { shared: { size: true }, context: false });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(!families[0].context);
    }

    #[test]
    fn compose_with_context_forces_context_true() {
        let families = parse_compose_families(
            r#"const F = composeWithContext({ Root, Child }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(families[0].context, "composeWithContext must force context: true");
        assert_eq!(families[0].shared_keys, vec!["size"]);
        assert_eq!(families[0].root_binding, "Root");
    }

    #[test]
    fn compose_with_context_name_from_binding() {
        let families = parse_compose_families(
            r#"const Dialog = composeWithContext({ Root: DialogRoot, Body: DialogBody }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(families[0].context);
        assert_eq!(families[0].name, "Dialog");
    }
}
