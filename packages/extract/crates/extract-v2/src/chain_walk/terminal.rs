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

/// v1-parity argument span: the EXACT variant list from v1's macro; kinds
/// outside it (e.g. arrow functions) fall back to the whole call span.
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
            _ => $fallback,
        }
    };
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
