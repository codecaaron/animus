//! Self-containment validation for `createTransform` callbacks: every
//! runtime identifier must resolve inside the callback or to a global.

use std::collections::BTreeSet;

use rustc_hash::FxHashSet;

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, Expression, IdentifierReference, Statement,
};
use oxc::ast::AstKind;
use oxc::semantic::{Scoping, Semantic};
use oxc::span::Span;
use oxc::syntax::scope::ScopeId;

use crate::evaluator::{evaluator_shared_host_globals, evaluator_standard_globals};

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
    callback: &Expression<'_>,
    transform_name: &str,
    diagnostics: &mut Vec<String>,
    scoping: &Scoping,
) -> bool {
    let (statements, callback_span) = match callback {
        Expression::ArrowFunctionExpression(arrow) => (&arrow.body.statements, arrow.span),
        Expression::FunctionExpression(func) => match &func.body {
            Some(body) => (&body.statements, func.span),
            None => return true,
        },
        _ => return true,
    };
    let invalid = collect_invalid_references_from_body(statements, callback_span, scoping);
    report_invalid_references(&invalid, transform_name, diagnostics)
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
            None if ALLOWED_GLOBALS.contains(&ident.name.as_str())
                || evaluator_shared_host_globals().contains(&ident.name.as_str()) =>
            {
                return;
            }
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
        diagnostics.push(external_symbol_diagnostic(transform_name, name));
        valid = false;
    }

    valid
}

fn external_symbol_diagnostic(transform_name: &str, symbol: &str) -> String {
    format!(
        "[bail] Transform '{}': callback references external symbol '{}'. \
         Transform callbacks must be self-contained (no imports or external references). \
         Hint: if '{}' is defined in the same file, move it inside the callback body.",
        transform_name, symbol, symbol
    )
}

/// The self-containment rule for a configured source, over the complete
/// semantic model of its standalone wrapper program: unresolved references
/// are globals and must be in the project list, or a standard global or
/// shared host function the evaluator supplies (both the build-time
/// evaluator and the runtime ES module must be able to resolve them);
/// resolved ones must bind to a symbol declared in `callback_scope` or
/// below, which excludes the wrapper's own binding. `this` and `arguments`
/// bind to the nearest non-arrow function: `arguments` may bind to the
/// callback or a function inside it, `this` only to a function strictly
/// inside it, because the evaluator calls the callback with `globalThis` as
/// `this` and the runtime with the slot config.
pub(super) fn configured_reference_rejections(
    semantic: &Semantic<'_>,
    callback_scope: ScopeId,
    transform_name: &str,
) -> BTreeSet<String> {
    let scoping = semantic.scoping();
    let inside = |scope| {
        scope == callback_scope || scoping.scope_is_descendant_of(scope, callback_scope)
    };
    let binder = |scope| {
        scoping.scope_ancestors(scope).find(|&s| {
            let flags = scoping.scope_flags(s);
            flags.is_function() && !flags.is_arrow()
        })
    };

    let mut rejections = BTreeSet::new();
    for (reference_name, reference_ids) in scoping.root_unresolved_references() {
        let reference_name = reference_name.as_str();
        for &reference_id in reference_ids {
            let scope = scoping.get_reference(reference_id).scope_id();
            if reference_name == "arguments" {
                if !binder(scope).is_some_and(inside) {
                    rejections.insert(format!(
                        "[bail] Transform '{transform_name}': configured source captures an \
                         outer 'arguments'"
                    ));
                }
            } else if !ALLOWED_GLOBALS.contains(&reference_name)
                && !evaluator_standard_globals().contains(&reference_name)
                && !evaluator_shared_host_globals().contains(&reference_name)
            {
                rejections.insert(external_symbol_diagnostic(transform_name, reference_name));
            }
        }
    }
    for symbol_id in scoping.symbol_ids() {
        if !inside(scoping.symbol_scope_id(symbol_id))
            && !scoping.get_resolved_reference_ids(symbol_id).is_empty()
        {
            rejections.insert(external_symbol_diagnostic(
                transform_name,
                scoping.symbol_name(symbol_id),
            ));
        }
    }
    for node in semantic.nodes().iter() {
        if matches!(node.kind(), AstKind::ThisExpression(_))
            && !binder(node.scope_id())
                .is_some_and(|s| scoping.scope_is_descendant_of(s, callback_scope))
        {
            rejections.insert(format!(
                "[bail] Transform '{transform_name}': configured source reads 'this' of the \
                 callback or its surroundings, which the evaluator and the runtime bind \
                 differently"
            ));
        }
    }
    rejections
}
