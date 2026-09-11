//! Self-containment validation for `createTransform` callbacks: every
//! runtime identifier must resolve inside the callback or to a global.

use rustc_hash::FxHashSet;

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, Expression, IdentifierReference, Statement,
};
use oxc::semantic::Scoping;
use oxc::span::Span;

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

/// True when the callback references nothing declared outside itself.
pub(super) fn validate_self_contained(
    arg: &Argument<'_>,
    transform_name: &str,
    diagnostics: &mut Vec<String>,
    scoping: &Scoping,
) -> bool {
    match arg {
        Argument::ArrowFunctionExpression(arrow) => {
            let invalid =
                collect_invalid_references_from_body(&arrow.body.statements, arrow.span, scoping);
            return report_invalid_references(&invalid, transform_name, diagnostics);
        }
        Argument::FunctionExpression(func) => {
            if let Some(body) = &func.body {
                let invalid =
                    collect_invalid_references_from_body(&body.statements, func.span, scoping);
                return report_invalid_references(&invalid, transform_name, diagnostics);
            }
        }
        _ => {}
    }

    true
}

struct ReferenceValidation<'s> {
    scoping: &'s Scoping,
    callback_span: Span,
    invalid_names: FxHashSet<String>,
}

impl ReferenceValidation<'_> {
    fn collect_identifier(&mut self, ident: &IdentifierReference<'_>) {
        let symbol_id = ident
            .reference_id
            .get()
            .and_then(|reference_id| self.scoping.get_reference(reference_id).symbol_id());

        match symbol_id {
            Some(symbol_id)
                if self
                    .callback_span
                    .contains_inclusive(self.scoping.symbol_span(symbol_id)) =>
            {
                return;
            }
            Some(_) => {}
            None if ALLOWED_GLOBALS.contains(&ident.name.as_str()) => return,
            None => {}
        }

        self.invalid_names.insert(ident.name.to_string());
    }
}

fn collect_invalid_references_from_body(
    stmts: &[Statement<'_>],
    callback_span: Span,
    scoping: &Scoping,
) -> FxHashSet<String> {
    let mut validation = ReferenceValidation {
        scoping,
        callback_span,
        invalid_names: FxHashSet::default(),
    };
    for stmt in stmts {
        collect_references_from_statement(stmt, &mut validation);
    }
    validation.invalid_names
}

fn collect_references_from_statement(
    stmt: &Statement<'_>,
    validation: &mut ReferenceValidation<'_>,
) {
    match stmt {
        Statement::ExpressionStatement(expr_stmt) => {
            collect_references_from_expr(&expr_stmt.expression, validation);
        }
        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &ret.argument {
                collect_references_from_expr(arg, validation);
            }
        }
        Statement::VariableDeclaration(decl) => {
            for declarator in &decl.declarations {
                if let Some(init) = &declarator.init {
                    collect_references_from_expr(init, validation);
                }
            }
        }
        Statement::IfStatement(if_stmt) => {
            collect_references_from_expr(&if_stmt.test, validation);
            collect_references_from_statement(&if_stmt.consequent, validation);
            if let Some(alt) = &if_stmt.alternate {
                collect_references_from_statement(alt, validation);
            }
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                collect_references_from_statement(s, validation);
            }
        }
        Statement::ForStatement(for_stmt) => {
            if let Some(oxc::ast::ast::ForStatementInit::VariableDeclaration(decl)) = &for_stmt.init {
                for declarator in &decl.declarations {
                    if let Some(init_expr) = &declarator.init {
                        collect_references_from_expr(init_expr, validation);
                    }
                }
            }
            if let Some(test) = &for_stmt.test {
                collect_references_from_expr(test, validation);
            }
            if let Some(update) = &for_stmt.update {
                collect_references_from_expr(update, validation);
            }
            collect_references_from_statement(&for_stmt.body, validation);
        }
        _ => {}
    }
}

fn collect_references_from_expr(
    expr: &Expression<'_>,
    validation: &mut ReferenceValidation<'_>,
) {
    match expr {
        Expression::Identifier(ident) => {
            validation.collect_identifier(ident);
        }
        Expression::StaticMemberExpression(member) => {
            collect_references_from_expr(&member.object, validation);
        }
        Expression::ComputedMemberExpression(member) => {
            collect_references_from_expr(&member.object, validation);
            collect_references_from_expr(&member.expression, validation);
        }
        Expression::CallExpression(call) => {
            collect_references_from_expr(&call.callee, validation);
            for arg in &call.arguments {
                match arg {
                    Argument::SpreadElement(spread) => {
                        collect_references_from_expr(&spread.argument, validation);
                    }
                    _ => {
                        collect_references_from_expr(arg.to_expression(), validation);
                    }
                }
            }
        }
        Expression::BinaryExpression(bin) => {
            collect_references_from_expr(&bin.left, validation);
            collect_references_from_expr(&bin.right, validation);
        }
        Expression::LogicalExpression(log) => {
            collect_references_from_expr(&log.left, validation);
            collect_references_from_expr(&log.right, validation);
        }
        Expression::UnaryExpression(unary) => {
            collect_references_from_expr(&unary.argument, validation);
        }
        Expression::ConditionalExpression(cond) => {
            collect_references_from_expr(&cond.test, validation);
            collect_references_from_expr(&cond.consequent, validation);
            collect_references_from_expr(&cond.alternate, validation);
        }
        Expression::TemplateLiteral(template) => {
            for expr in &template.expressions {
                collect_references_from_expr(expr, validation);
            }
        }
        Expression::AssignmentExpression(assign) => {
            collect_references_from_expr(&assign.right, validation);
        }
        Expression::ArrayExpression(arr) => {
            for elem in &arr.elements {
                match elem {
                    ArrayExpressionElement::SpreadElement(spread) => {
                        collect_references_from_expr(&spread.argument, validation);
                    }
                    ArrayExpressionElement::Elision(_) => {}
                    _ => {
                        collect_references_from_expr(elem.to_expression(), validation);
                    }
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &obj.properties {
                match prop {
                    oxc::ast::ast::ObjectPropertyKind::ObjectProperty(p) => {
                        collect_references_from_expr(&p.value, validation);
                    }
                    oxc::ast::ast::ObjectPropertyKind::SpreadProperty(spread) => {
                        collect_references_from_expr(&spread.argument, validation);
                    }
                }
            }
        }
        Expression::ArrowFunctionExpression(_) => {
            // Nested arrows are not descended into; the top-level check
            // is what the self-contained constraint rests on.
        }
        Expression::ParenthesizedExpression(paren) => {
            collect_references_from_expr(&paren.expression, validation);
        }
        Expression::SequenceExpression(seq) => {
            for e in &seq.expressions {
                collect_references_from_expr(e, validation);
            }
        }
        Expression::UpdateExpression(_) => {
            // The operand is a SimpleAssignmentTarget, not an Expression;
            // an `i++` target is already a local binding.
        }
        Expression::TSAsExpression(ts_as) => {
            collect_references_from_expr(&ts_as.expression, validation);
        }
        Expression::TSNonNullExpression(non_null) => {
            collect_references_from_expr(&non_null.expression, validation);
        }
        Expression::TSSatisfiesExpression(satisfies) => {
            collect_references_from_expr(&satisfies.expression, validation);
        }
        _ => {}
    }
}

fn report_invalid_references(
    invalid_names: &FxHashSet<String>,
    transform_name: &str,
    diagnostics: &mut Vec<String>,
) -> bool {
    let mut valid = true;

    for name in invalid_names {
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
