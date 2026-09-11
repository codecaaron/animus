//! Expression-shape readers over oxc expressions, with no knowledge of
//! chains or terminals.

use oxc::ast::ast::Expression;

pub(super) fn match_static_member<'a, 'b>(expr: &'a Expression<'b>) -> Option<(&'a Expression<'b>, &'a str)> {
    match expr {
        Expression::StaticMemberExpression(member) => {
            Some((&member.object, member.property.name.as_str()))
        }
        _ => None,
    }
}

/// Peel TS type assertions and parentheses: they are erased type-level
/// syntax, so `asComponent(Link as T)` must extract like `asComponent(Link)`.
pub(crate) fn unwrap_type_assertions<'a, 'b>(expr: &'a Expression<'b>) -> &'a Expression<'b> {
    match expr {
        Expression::TSAsExpression(x) => unwrap_type_assertions(&x.expression),
        Expression::TSSatisfiesExpression(x) => unwrap_type_assertions(&x.expression),
        Expression::TSNonNullExpression(x) => unwrap_type_assertions(&x.expression),
        Expression::ParenthesizedExpression(x) => unwrap_type_assertions(&x.expression),
        _ => expr,
    }
}

/// Dotted static-member path (`Ns.Compound.Item`), or None for computed
/// members and calls. The emitter renders the path verbatim into the call.
pub(super) fn static_member_path(expr: &Expression<'_>) -> Option<String> {
    match unwrap_type_assertions(expr) {
        Expression::Identifier(id) => Some(id.name.to_string()),
        Expression::StaticMemberExpression(member) => {
            let base = static_member_path(&member.object)?;
            Some(format!("{}.{}", base, member.property.name.as_str()))
        }
        _ => None,
    }
}
