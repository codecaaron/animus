//! Terminal-argument resolution and argument spans. `get_arg_span!` sits
//! above its callers: `macro_rules!` is textually scoped from its definition.

use oxc::ast::ast::{Argument, CallExpression, Expression};
use oxc::span::Span;

use super::expr::{static_member_path, unwrap_type_assertions};
use super::{Forward, TerminalKind};

/// The terminal argument: a static name, or a bail. A placeholder is not an
/// option — `createComponent(unknown, …)` is a runtime ReferenceError.
pub(super) enum TerminalArg {
    Resolved(String),
    Unresolvable(String),
}

/// `.asComponent(Target, { forward })`'s `forward`: `true`, or the names an
/// array of string literals lists. No second argument forwards nothing; any
/// other is a bail reason.
pub(super) fn extract_forward(call: &CallExpression<'_>) -> Result<Option<Forward>, String> {
    let Some(options) = call.arguments.get(1) else {
        return Ok(None);
    };
    let unread = || "are not an object literal of `forward: true` or an array of string literals".to_string();
    let Some(Expression::ObjectExpression(object)) = options.as_expression().map(unwrap_type_assertions) else {
        return Err(unread());
    };
    let mut forward = None;
    for property in &object.properties {
        let oxc::ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return Err(unread());
        };
        if property.computed || property.key.static_name().as_deref() != Some("forward") {
            return Err(unread());
        }
        forward = Some(match unwrap_type_assertions(&property.value) {
            Expression::BooleanLiteral(flag) if flag.value => Forward::All,
            Expression::ArrayExpression(names) => Forward::Names(
                names
                    .elements
                    .iter()
                    .map(|element| match element.as_expression().map(unwrap_type_assertions) {
                        // The runtime matches a name exactly, and one with a
                        // lone surrogate has no static text (`eval::literal_string`).
                        Some(Expression::StringLiteral(name)) => crate::eval::literal_string(name)
                            .map(str::to_string)
                            .ok_or_else(|| "name a string with a lone surrogate, which has no static text".to_string()),
                        _ => Err(unread()),
                    })
                    .collect::<Result<_, _>>()?,
            ),
            _ => return Err(unread()),
        });
    }
    Ok(forward)
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
                Some(Expression::StringLiteral(lit)) => match crate::eval::literal_string(lit) {
                    Some(tag) => TerminalArg::Resolved(tag.to_string()),
                    None => TerminalArg::Unresolvable("tag is a string with a lone surrogate, which has no static text".to_string()),
                },
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
            arg => arg
                .as_expression()
                .map_or($fallback, |expr| unwrapped_span(expr, $fallback)),
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
        Expression::StaticMemberExpression(x) => x.span,
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
