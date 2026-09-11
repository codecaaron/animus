//! `compose()` call detection: the family shape (binding, slots, shared
//! keys, context flag) read from top-level statements.

use oxc::ast::ast::{
    Argument, BindingPattern, Declaration, Expression, ObjectPropertyKind, Program, Statement,
};

use super::value_eval::eval_property_key;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ComposeFamilyInfo {
    /// Variable the `compose()` result is assigned to; `None` for default
    /// exports and expressions not bound to a variable.
    pub family_binding: Option<String>,
    pub root_binding: String,
    /// (slot name, binding name) pairs for every slot, Root included.
    pub slots: Vec<(String, String)>,
    pub shared_keys: Vec<String>,
    /// Shared variants propagate through React context across portals.
    pub context: bool,
    /// Byte range of the `compose()` call expression.
    pub span: (u32, u32),
    pub name: String,
}

/// Scan top-level statements for `compose(...)` calls. compose wraps slot
/// components via `createElement` at runtime, which the JSX scanner misses.
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

    if root_binding.is_empty() || slots.is_empty() {
        return;
    }

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
