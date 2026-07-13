//! createTransform() extraction — v1 `transform_extractor.rs` ported
//! VERBATIM (row 07 Task 07.6.iii): finds `createTransform('name', fn)`
//! declarations, validates self-containment (free-variable check against
//! an allowlist), and strips TS annotations via oxc transformer+codegen.
//! v1's test module carried verbatim as the contract.
//!
//! Deltas from v1 (mechanical only):
//!  - oxc facade paths + 0.139 `ParserReturn.diagnostics` field name;
//!  - the tiny `const __x = <fn>;` wrapper parse is NOT counted in the
//!    engine's parseCount (v2 counts FILE parses only; v1 counted the
//!    wrapper via count_parse — parseCount is not a parity surface).

use rustc_hash::FxHashSet;
use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::{
    Argument, ArrayExpressionElement, BindingPattern, CallExpression, Declaration, Expression,
    Program, Statement, VariableDeclarator,
};
use oxc::codegen::Codegen;
use oxc::parser::{Parser, ParserReturn};
use oxc::semantic::SemanticBuilder;
use oxc::span::SourceType;
use oxc::transformer::{TransformOptions, Transformer};
/// An extracted `createTransform('name', fn)` call.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
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
    known_create_transform_bindings: &FxHashSet<String>,
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
    known_bindings: &FxHashSet<String>,
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

    // Strip TypeScript annotations via oxc transformer + codegen pipeline
    let js_source = if valid {
        match strip_typescript(callback_source) {
            Ok(js) => js,
            Err(err) => {
                diagnostics.push(format!(
                    "[warn] Transform '{}': TS stripping failed ({}), using raw source",
                    name, err
                ));
                callback_source.to_string()
            }
        }
    } else {
        callback_source.to_string()
    };

    Some(ExtractedTransform {
        name,
        source: js_source,
        file: file_path.to_string(),
        diagnostics,
        valid,
    })
}

/// Check if a CallExpression's callee is `createTransform` or a known alias.
fn is_create_transform_call(
    call: &CallExpression<'_>,
    known_bindings: &FxHashSet<String>,
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
    let allowed: FxHashSet<&str> = ALLOWED_GLOBALS.iter().copied().collect();

    // Collect parameter names
    let mut local_names: FxHashSet<String> = FxHashSet::default();

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
fn collect_binding_names(pattern: &BindingPattern<'_>, names: &mut FxHashSet<String>) {
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
    names: &mut FxHashSet<String>,
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
                if let Some(oxc::ast::ast::ForStatementInit::VariableDeclaration(decl)) = &for_stmt.init {
                    for declarator in &decl.declarations {
                        collect_binding_names(&declarator.id, names);
                    }
                }
            }
            Statement::ForInStatement(for_in) => {
                if let oxc::ast::ast::ForStatementLeft::VariableDeclaration(decl) = &for_in.left {
                    for declarator in &decl.declarations {
                        collect_binding_names(&declarator.id, names);
                    }
                }
            }
            Statement::ForOfStatement(for_of) => {
                if let oxc::ast::ast::ForStatementLeft::VariableDeclaration(decl) = &for_of.left {
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
) -> FxHashSet<String> {
    let mut refs = FxHashSet::default();
    for stmt in stmts {
        collect_references_from_statement(stmt, &mut refs);
    }
    refs
}

fn collect_references_from_statement(
    stmt: &Statement<'_>,
    refs: &mut FxHashSet<String>,
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
                    oxc::ast::ast::ForStatementInit::VariableDeclaration(decl) => {
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
    refs: &mut FxHashSet<String>,
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
                    oxc::ast::ast::ObjectPropertyKind::ObjectProperty(p) => {
                        collect_references_from_expr(&p.value, refs);
                    }
                    oxc::ast::ast::ObjectPropertyKind::SpreadProperty(spread) => {
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

/// Strip TypeScript annotations from a callback source string.
/// Wraps the source as `const __x = <source>;`, parses, transforms (strip TS), and
/// extracts the cleaned expression via codegen.
fn strip_typescript(callback_source: &str) -> Result<String, String> {
    let wrapper = format!("const __x = {};", callback_source);
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(Path::new("callback.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let ParserReturn {
        mut program,
        diagnostics: parse_errors,
        ..
    } = Parser::new(&allocator, &wrapper, source_type).parse();

    if !parse_errors.is_empty() {
        return Err(format!("parse error: {}", parse_errors[0]));
    }

    // Build semantic info (required by transformer for scoping)
    let semantic_ret = SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    // Run transformer to strip TypeScript
    let options = TransformOptions::default();
    let transformer = Transformer::new(&allocator, Path::new("callback.ts"), &options);
    let _transform_ret = transformer.build_with_scoping(scoping, &mut program);

    // Extract the init expression from `const __x = <expr>;`
    let expr = program
        .body
        .first()
        .and_then(|stmt| match stmt {
            Statement::VariableDeclaration(decl) => decl.declarations.first(),
            _ => None,
        })
        .and_then(|declarator| declarator.init.as_ref())
        .ok_or_else(|| "could not find expression after transform".to_string())?;

    let mut codegen = Codegen::new();
    codegen.print_expression(expr);
    Ok(codegen.into_source_text())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ts_simple_arrow() {
        let input = "(v: number) => `${v}px`";
        let result = strip_typescript(input).unwrap();
        assert_eq!(result, "(v) => `${v}px`");
    }

    #[test]
    fn strip_ts_as_cast() {
        let input = "(value) => { const s = value as string; return s; }";
        let result = strip_typescript(input).unwrap();
        assert!(
            !result.contains("as string"),
            "should not contain 'as string', got: {}",
            result
        );
    }

    #[test]
    fn strip_ts_size_transform() {
        let input = r#"(value) => {
  const toSize = (n: number) => {
    if (n === 0) return n;
    if (n <= 1 && n >= -1) return `${n * 100}%`;
    return `${n}px`;
  };
  if (typeof value === 'number') { return toSize(value); }
  const strValue = value as string;
  if (strValue.includes('calc')) { return strValue; }
  const [match, number, unit] = /(-?\d*\.?\d+)(%|\w*)/.exec(strValue) || [];
  if (match === undefined) { return strValue; }
  const numericValue = parseFloat(number);
  return !unit ? toSize(numericValue) : `${numericValue}${unit}`;
}"#;
        let result = strip_typescript(input);
        match &result {
            Ok(js) => {
                assert!(!js.contains(": number"), "should not contain type annotations: {}", js);
                assert!(!js.contains("as string"), "should not contain 'as string': {}", js);
                // Verify it can be registered and evaluated in boa
                let eval = crate::evaluator::TransformEvaluator::new();
                eval.register("size", js).unwrap();
                assert_eq!(eval.evaluate("size", &serde_json::Value::Number(28.into())).unwrap(), "28px");
            }
            Err(e) => panic!("strip_typescript failed: {}", e),
        }
    }
}

/// Check collected references against locals + allowed globals.
fn check_references(
    refs: &FxHashSet<String>,
    locals: &FxHashSet<String>,
    allowed_globals: &FxHashSet<&str>,
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
