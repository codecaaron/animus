//! Terminal-argument resolution and v1-parity argument spans.
//!
//! Split out of `chain_walk.rs` unchanged. Owns what a terminal call's
//! arguments resolve to, plus the `get_arg_span!` macro encoding v1's exact
//! variant list. The macro stays here with both of its callers: `macro_rules!`
//! is textually scoped from its definition point, so separating it from
//! `second_arg_span_fn`/`first_arg_span` would need a `#[macro_use]` dance for
//! no benefit.

use oxc::ast::ast::{Argument, CallExpression, Expression};
use oxc::span::Span;

use super::expr::{static_member_path, unwrap_type_assertions};
use super::TerminalKind;

/// What the terminal argument resolved to: a static name the emitter may
/// compile into the replacement, or a bail. Emitting a placeholder for an
/// unresolvable target is never an option — `createComponent(unknown, …)`
/// is a ReferenceError in the browser (ANI-015).
pub(super) enum TerminalArg {
    Resolved(String),
    Unresolvable(String),
}

pub(super) fn extract_terminal_arg(call: &CallExpression<'_>, terminal: &TerminalKind) -> TerminalArg {
    match terminal {
        TerminalKind::AsClass => TerminalArg::Resolved(String::new()),
        TerminalKind::AsElement => {
            // v1 parity: a missing or non-literal tag keeps the empty tag.
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

/// v1-parity argument span, plus the ani-015 D3 departure: erased TS
/// wrappers (`as`/`satisfies`/`!`/parens) peel to their operand's span so
/// `.styles(x as const)` resolves like `.styles(x)` instead of falling back
/// to the whole call span (which reads as "failed to parse object
/// expression" and drops the chain). Other kinds outside the v1 list (e.g.
/// arrow functions) still fall back to the whole call span.
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

/// Span of the fully-unwrapped operand when it is a kind the v1 span list
/// accepts; the fallback otherwise (an arrow function stays fallback even
/// when wrapped).
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
