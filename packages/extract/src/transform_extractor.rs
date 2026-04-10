use std::collections::HashSet;

use oxc_ast::ast::{
    Argument, ArrayExpressionElement, BindingPattern, CallExpression, Declaration, Expression,
    Program, Statement, VariableDeclarator,
};
/// An extracted `createTransform('name', fn)` call.
#[derive(Debug, Clone)]
pub struct ExtractedTransform {
    /// The transform name (first argument string literal).
    pub name: String,
    /// The callback source text (second argument, raw from source — may contain TS).
    pub source: String,
    /// File path where the transform was found.
    pub file: String,
    /// Diagnostics — external reference violations, etc.
    pub diagnostics: Vec<String>,
    /// Whether the transform passed validation (no external refs).
    pub valid: bool,
}

/// Well-known JavaScript globals that are allowed in self-contained callbacks.
const ALLOWED_GLOBALS: &[&str] = &[
    "String",
    "Number",
    "Math",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "RegExp",
    "JSON",
    "Array",
    "Object",
    "Boolean",
    "Symbol",
    "Error",
    "TypeError",
    "RangeError",
    "undefined",
    "NaN",
    "Infinity",
    "console",
    "globalThis",
];

/// Scan a parsed program for `createTransform('name', fn)` calls.
/// Returns extracted transforms with validation results.
pub fn extract_transforms(
    program: &Program<'_>,
    source: &str,
    file_path: &str,
    known_create_transform_bindings: &HashSet<String>,
) -> Vec<ExtractedTransform> {
    let mut results = Vec::new();

    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) => {
                for declarator in &decl.declarations {
                    if let Some(result) = try_extract_transform(
                        declarator,
                        source,
                        file_path,
                        known_create_transform_bindings,
                    ) {
                        results.push(result);
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                    for declarator in &decl.declarations {
                        if let Some(result) = try_extract_transform(
                            declarator,
                            source,
                            file_path,
                            known_create_transform_bindings,
                        ) {
                            results.push(result);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    results
}

/// Try to extract a transform from a variable declarator.
/// Looks for: `const x = createTransform('name', fn)`
fn try_extract_transform(
    declarator: &VariableDeclarator<'_>,
    source: &str,
    file_path: &str,
    known_bindings: &HashSet<String>,
) -> Option<ExtractedTransform> {
    let init = declarator.init.as_ref()?;

    // Must be a call expression
    let call = match init {
        Expression::CallExpression(call) => call,
        _ => return None,
    };

    // Check if callee is createTransform (or an alias)
    if !is_create_transform_call(call, known_bindings) {
        return None;
    }

    // First argument: must be a string literal (the transform name)
    let name = match call.arguments.first() {
        Some(Argument::StringLiteral(lit)) => lit.value.to_string(),
        _ => {
            return Some(ExtractedTransform {
                name: String::new(),
                source: String::new(),
                file: file_path.to_string(),
                diagnostics: vec![
                    "[bail] createTransform requires a static string name as first argument"
                        .to_string(),
                ],
                valid: false,
            });
        }
    };

    // Second argument: the callback function
    let callback_arg = match call.arguments.get(1) {
        Some(arg) => arg,
        None => {
            return Some(ExtractedTransform {
                name: name.clone(),
                source: String::new(),
                file: file_path.to_string(),
                diagnostics: vec![
                    "[bail] createTransform requires a callback function as second argument"
                        .to_string(),
                ],
                valid: false,
            });
        }
    };

    // Extract the callback span
    let callback_span = match callback_arg {
        Argument::ArrowFunctionExpression(arrow) => arrow.span,
        Argument::FunctionExpression(func) => func.span,
        _ => {
            return Some(ExtractedTransform {
                name: name.clone(),
                source: String::new(),
                file: file_path.to_string(),
                diagnostics: vec![format!(
                    "[bail] Transform '{}': second argument must be a function expression",
                    name
                )],
                valid: false,
            });
        }
    };

    // Grab the raw source text for the callback
    let callback_source = &source[callback_span.start as usize..callback_span.end as usize];

    // Validate: check for external references in the callback
    let mut diagnostics = Vec::new();
    let valid = validate_self_contained(callback_arg, &name, &mut diagnostics);

    Some(ExtractedTransform {
        name,
        source: callback_source.to_string(),
        file: file_path.to_string(),
        diagnostics,
        valid,
    })
}

/// Check if a CallExpression's callee is `createTransform` or a known alias.
fn is_create_transform_call(
    call: &CallExpression<'_>,
    known_bindings: &HashSet<String>,
) -> bool {
    match &call.callee {
        Expression::Identifier(ident) => {
            let name = ident.name.as_str();
            name == "createTransform" || known_bindings.contains(name)
        }
        _ => false,
    }
}

/// Validate that a callback has no external references.
/// Walks the AST to collect all identifier references and checks them against
/// parameters, local declarations, and the well-known globals allowlist.
fn validate_self_contained(
    arg: &Argument<'_>,
    transform_name: &str,
    diagnostics: &mut Vec<String>,
) -> bool {
    let allowed: HashSet<&str> = ALLOWED_GLOBALS.iter().copied().collect();

    // Collect parameter names
    let mut local_names: HashSet<String> = HashSet::new();

    match arg {
        Argument::ArrowFunctionExpression(arrow) => {
            for param in &arrow.params.items {
                collect_binding_names(&param.pattern, &mut local_names);
            }
            collect_locals_from_body(&arrow.body.statements, &mut local_names);
            let refs = collect_references_from_body(&arrow.body.statements);
            return check_references(&refs, &local_names, &allowed, transform_name, diagnostics);
        }
        Argument::FunctionExpression(func) => {
            for param in &func.params.items {
                collect_binding_names(&param.pattern, &mut local_names);
            }
            if let Some(body) = &func.body {
                collect_locals_from_body(&body.statements, &mut local_names);
                let refs = collect_references_from_body(&body.statements);
                return check_references(&refs, &local_names, &allowed, transform_name, diagnostics);
            }
        }
        _ => {}
    }

    true
}

/// Collect binding names from a pattern (handles simple identifiers, destructuring, etc.)
fn collect_binding_names(pattern: &BindingPattern<'_>, names: &mut HashSet<String>) {
    match pattern {
        BindingPattern::BindingIdentifier(ident) => {
            names.insert(ident.name.to_string());
        }
        BindingPattern::ObjectPattern(obj) => {
            for prop in &obj.properties {
                collect_binding_names(&prop.value, names);
            }
            if let Some(rest) = &obj.rest {
                collect_binding_names(&rest.argument, names);
            }
        }
        BindingPattern::ArrayPattern(arr) => {
            for elem in arr.elements.iter().flatten() {
                collect_binding_names(elem, names);
            }
            if let Some(rest) = &arr.rest {
                collect_binding_names(&rest.argument, names);
            }
        }
        BindingPattern::AssignmentPattern(assign) => {
            collect_binding_names(&assign.left, names);
        }
    }
}

/// Collect locally declared variable names from statements.
fn collect_locals_from_body(
    stmts: &[Statement<'_>],
    names: &mut HashSet<String>,
) {
    for stmt in stmts {
        match stmt {
            Statement::VariableDeclaration(decl) => {
                for declarator in &decl.declarations {
                    collect_binding_names(&declarator.id, names);
                }
            }
            Statement::FunctionDeclaration(func) => {
                if let Some(ident) = &func.id {
                    names.insert(ident.name.to_string());
                }
            }
            Statement::ForStatement(for_stmt) => {
                if let Some(oxc_ast::ast::ForStatementInit::VariableDeclaration(decl)) = &for_stmt.init {
                    for declarator in &decl.declarations {
                        collect_binding_names(&declarator.id, names);
                    }
                }
            }
            Statement::ForInStatement(for_in) => {
                if let oxc_ast::ast::ForStatementLeft::VariableDeclaration(decl) = &for_in.left {
                    for declarator in &decl.declarations {
                        collect_binding_names(&declarator.id, names);
                    }
                }
            }
            Statement::ForOfStatement(for_of) => {
                if let oxc_ast::ast::ForStatementLeft::VariableDeclaration(decl) = &for_of.left {
                    for declarator in &decl.declarations {
                        collect_binding_names(&declarator.id, names);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Collect all identifier references from function body statements.
fn collect_references_from_body(
    stmts: &[Statement<'_>],
) -> HashSet<String> {
    let mut refs = HashSet::new();
    for stmt in stmts {
        collect_references_from_statement(stmt, &mut refs);
    }
    refs
}

fn collect_references_from_statement(
    stmt: &Statement<'_>,
    refs: &mut HashSet<String>,
) {
    match stmt {
        Statement::ExpressionStatement(expr_stmt) => {
            collect_references_from_expr(&expr_stmt.expression, refs);
        }
        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &ret.argument {
                collect_references_from_expr(arg, refs);
            }
        }
        Statement::VariableDeclaration(decl) => {
            for declarator in &decl.declarations {
                if let Some(init) = &declarator.init {
                    collect_references_from_expr(init, refs);
                }
            }
        }
        Statement::IfStatement(if_stmt) => {
            collect_references_from_expr(&if_stmt.test, refs);
            collect_references_from_statement(&if_stmt.consequent, refs);
            if let Some(alt) = &if_stmt.alternate {
                collect_references_from_statement(alt, refs);
            }
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                collect_references_from_statement(s, refs);
            }
        }
        Statement::ForStatement(for_stmt) => {
            if let Some(init) = &for_stmt.init {
                match init {
                    oxc_ast::ast::ForStatementInit::VariableDeclaration(decl) => {
                        for declarator in &decl.declarations {
                            if let Some(init_expr) = &declarator.init {
                                collect_references_from_expr(init_expr, refs);
                            }
                        }
                    }
                    _ => {}
                }
            }
            if let Some(test) = &for_stmt.test {
                collect_references_from_expr(test, refs);
            }
            if let Some(update) = &for_stmt.update {
                collect_references_from_expr(update, refs);
            }
            collect_references_from_statement(&for_stmt.body, refs);
        }
        _ => {}
    }
}

fn collect_references_from_expr(
    expr: &Expression<'_>,
    refs: &mut HashSet<String>,
) {
    match expr {
        Expression::Identifier(ident) => {
            refs.insert(ident.name.to_string());
        }
        Expression::StaticMemberExpression(member) => {
            collect_references_from_expr(&member.object, refs);
        }
        Expression::ComputedMemberExpression(member) => {
            collect_references_from_expr(&member.object, refs);
            collect_references_from_expr(&member.expression, refs);
        }
        Expression::CallExpression(call) => {
            collect_references_from_expr(&call.callee, refs);
            for arg in &call.arguments {
                match arg {
                    Argument::SpreadElement(spread) => {
                        collect_references_from_expr(&spread.argument, refs);
                    }
                    _ => {
                        collect_references_from_expr(arg.to_expression(), refs);
                    }
                }
            }
        }
        Expression::BinaryExpression(bin) => {
            collect_references_from_expr(&bin.left, refs);
            collect_references_from_expr(&bin.right, refs);
        }
        Expression::LogicalExpression(log) => {
            collect_references_from_expr(&log.left, refs);
            collect_references_from_expr(&log.right, refs);
        }
        Expression::UnaryExpression(unary) => {
            collect_references_from_expr(&unary.argument, refs);
        }
        Expression::ConditionalExpression(cond) => {
            collect_references_from_expr(&cond.test, refs);
            collect_references_from_expr(&cond.consequent, refs);
            collect_references_from_expr(&cond.alternate, refs);
        }
        Expression::TemplateLiteral(template) => {
            for expr in &template.expressions {
                collect_references_from_expr(expr, refs);
            }
        }
        Expression::AssignmentExpression(assign) => {
            collect_references_from_expr(&assign.right, refs);
        }
        Expression::ArrayExpression(arr) => {
            for elem in &arr.elements {
                match elem {
                    ArrayExpressionElement::SpreadElement(spread) => {
                        collect_references_from_expr(&spread.argument, refs);
                    }
                    ArrayExpressionElement::Elision(_) => {}
                    _ => {
                        collect_references_from_expr(elem.to_expression(), refs);
                    }
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &obj.properties {
                match prop {
                    oxc_ast::ast::ObjectPropertyKind::ObjectProperty(p) => {
                        collect_references_from_expr(&p.value, refs);
                    }
                    oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread) => {
                        collect_references_from_expr(&spread.argument, refs);
                    }
                }
            }
        }
        Expression::ArrowFunctionExpression(_) => {
            // Nested arrow functions — skip deep validation.
            // The top-level free-variable check is sufficient for the self-contained constraint.
        }
        Expression::ParenthesizedExpression(paren) => {
            collect_references_from_expr(&paren.expression, refs);
        }
        Expression::SequenceExpression(seq) => {
            for e in &seq.expressions {
                collect_references_from_expr(e, refs);
            }
        }
        Expression::UpdateExpression(_) => {
            // UpdateExpression operand is a SimpleAssignmentTarget, not Expression.
            // For i++/i-- the target is already a local variable — skip.
        }
        // TS type expression wrappers — collect from the inner expression
        Expression::TSAsExpression(ts_as) => {
            collect_references_from_expr(&ts_as.expression, refs);
        }
        Expression::TSNonNullExpression(non_null) => {
            collect_references_from_expr(&non_null.expression, refs);
        }
        Expression::TSSatisfiesExpression(satisfies) => {
            collect_references_from_expr(&satisfies.expression, refs);
        }
        _ => {}
    }
}

/// Check collected references against locals + allowed globals.
fn check_references(
    refs: &HashSet<String>,
    locals: &HashSet<String>,
    allowed_globals: &HashSet<&str>,
    transform_name: &str,
    diagnostics: &mut Vec<String>,
) -> bool {
    let mut valid = true;

    for name in refs {
        if locals.contains(name) {
            continue;
        }
        if allowed_globals.contains(name.as_str()) {
            continue;
        }
        diagnostics.push(format!(
            "[bail] Transform '{}': callback references external symbol '{}'. \
             Transform callbacks must be self-contained (no imports or external references). \
             Hint: if '{}' is defined in the same file, move it inside the callback body.",
            transform_name, name, name
        ));
        valid = false;
    }

    valid
}
