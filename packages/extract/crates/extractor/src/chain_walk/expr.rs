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

/// The crate's one peeler for TypeScript-only wrappers: `as`, `satisfies`,
/// `!`, parentheses, `<T>expr` and instantiation expressions are erased at
/// runtime, so `asComponent(<T>Link)` extracts like `asComponent(Link)`.
pub(crate) fn unwrap_type_assertions<'a, 'b>(expr: &'a Expression<'b>) -> &'a Expression<'b> {
    expr.get_inner_expression()
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
