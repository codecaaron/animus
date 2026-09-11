//! Terminal-argument resolution and argument spans. `get_arg_span!` sits
//! above its callers: `macro_rules!` is textually scoped from its definition.

use oxc::ast::ast::{Argument, CallExpression, Expression};
use oxc::span::Span;

use super::expr::{static_member_path, unwrap_type_assertions};
use super::TerminalKind;

/// The terminal argument: a static name, or a bail. A placeholder is not an
/// option — `createComponent(unknown, …)` is a runtime ReferenceError.
pub(super) enum TerminalArg {
    Resolved(String),
    Unresolvable(String),
}

pub(super) fn extract_terminal_arg(call: &CallExpression<'_>, terminal: &TerminalKind) -> TerminalArg {
    match terminal {
        TerminalKind::AsClass => TerminalArg::Resolved(String::new()),
        TerminalKind::AsElement => {
            match call
                .arguments
                .first()
                .and_then(|arg| arg.as_expression())
                .map(unwrap_type_assertions)
            {
                Some(Expression::StringLiteral(lit)) => {
                    TerminalArg::Resolved(lit.value.to_string())
                }
                _ => TerminalArg::Resolved(String::new()),
            }
        }
        TerminalKind::AsComponent => {
            match call
                .arguments
                .first()
                .and_then(|arg| arg.as_expression())
                .map(unwrap_type_assertions)
                .and_then(static_member_path)
            {
                Some(path) => TerminalArg::Resolved(path),
                None => TerminalArg::Unresolvable(
                    "target has no static identifier or member path".to_string(),
                ),
            }
        }
    }
}

/// Argument span. Erased TS wrappers peel to their operand's span, so
/// `.styles(x as const)` resolves like `.styles(x)` instead of bailing.
macro_rules! get_arg_span {
    ($arg:expr, $fallback:expr) => {
        match $arg {
            Argument::SpreadElement(x) => x.span,
            Argument::BooleanLiteral(x) => x.span,
            Argument::NullLiteral(x) => x.span,
            Argument::NumericLiteral(x) => x.span,
            Argument::BigIntLiteral(x) => x.span,
            Argument::RegExpLiteral(x) => x.span,
            Argument::StringLiteral(x) => x.span,
            Argument::TemplateLiteral(x) => x.span,
            Argument::Identifier(x) => x.span,
            Argument::ObjectExpression(x) => x.span,
            Argument::ArrayExpression(x) => x.span,
            Argument::CallExpression(x) => x.span,
            Argument::TSAsExpression(x) => unwrapped_span(&x.expression, $fallback),
            Argument::TSSatisfiesExpression(x) => unwrapped_span(&x.expression, $fallback),
            Argument::TSNonNullExpression(x) => unwrapped_span(&x.expression, $fallback),
            Argument::ParenthesizedExpression(x) => unwrapped_span(&x.expression, $fallback),
            _ => $fallback,
        }
    };
}

fn unwrapped_span(expr: &Expression<'_>, fallback: Span) -> Span {
    match unwrap_type_assertions(expr) {
        Expression::BooleanLiteral(x) => x.span,
        Expression::NullLiteral(x) => x.span,
        Expression::NumericLiteral(x) => x.span,
        Expression::BigIntLiteral(x) => x.span,
        Expression::RegExpLiteral(x) => x.span,
        Expression::StringLiteral(x) => x.span,
        Expression::TemplateLiteral(x) => x.span,
        Expression::Identifier(x) => x.span,
        Expression::ObjectExpression(x) => x.span,
        Expression::ArrayExpression(x) => x.span,
        Expression::CallExpression(x) => x.span,
        _ => fallback,
    }
}

pub(super) fn second_arg_span_fn(call: &CallExpression<'_>) -> Option<Span> {
    call.arguments
        .get(1)
        .map(|arg| get_arg_span!(arg, call.span))
}

pub(super) fn first_arg_span(call: &CallExpression<'_>) -> Option<Span> {
    call.arguments
        .first()
        .map(|arg| get_arg_span!(arg, call.span))
}
