//! `compose()` call detection — family structure for CSS-only propagation.
//!
//! Split out of `jsx_scan.rs` unchanged. Independent of the JSX scanners: it
//! reads top-level statements looking for compose() calls and reports the
//! family shape (binding, members, shared keys, context flag).

use oxc::ast::ast::{
    Argument, BindingPattern, Declaration, Expression, ObjectPropertyKind, Program, Statement,
};

use super::value_eval::eval_property_key;

/// Structured information about a compose() call.
/// Used by the reconciler (mark shared variant options as used) and
/// css_generator (emit composed variant CSS rules).
#[derive(Debug, Clone, serde::Serialize)]
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
            use oxc::ast::ast::ExportDefaultDeclarationKind;
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
    call: &oxc::ast::ast::CallExpression,
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
            Argument::ObjectExpression(opts) => Some((
                extract_shared_keys(opts).unwrap_or_default(),
                extract_context_flag(opts),
                extract_name_option(opts),
            )),
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
fn extract_shared_keys(opts: &oxc::ast::ast::ObjectExpression) -> Option<Vec<String>> {
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
fn extract_context_flag(opts: &oxc::ast::ast::ObjectExpression) -> bool {
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
fn extract_name_option(opts: &oxc::ast::ast::ObjectExpression) -> Option<String> {
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
