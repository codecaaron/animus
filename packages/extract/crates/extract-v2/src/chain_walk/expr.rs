//! Expression-shape helpers for the chain walk.
//!
//! Split out of `chain_walk.rs` unchanged. Pure, allocation-light readers
//! over OXC expressions with no knowledge of chains or terminals — the leaf
//! of this module's dependency layering.

use oxc::ast::ast::Expression;

pub(super) fn match_static_member<'a, 'b>(expr: &'a Expression<'b>) -> Option<(&'a Expression<'b>, &'a str)> {
    match expr {
        Expression::StaticMemberExpression(member) => {
            Some((&member.object, member.property.name.as_str()))
        }
        _ => None,
    }
}

/// Peel TS type-assertion wrappers and parentheses from an expression:
/// `asComponent(Link as ComponentType)` names the same runtime value as
/// `asComponent(Link)`, and `asElement('div' as const)` the same tag as
/// `asElement('div')`. Crate-visible: the static evaluator peels the same
/// wrappers so `as const` bindings and arguments evaluate like their
/// operands (assertions are erased type-level syntax).
pub(crate) fn unwrap_type_assertions<'a, 'b>(expr: &'a Expression<'b>) -> &'a Expression<'b> {
    match expr {
        Expression::TSAsExpression(x) => unwrap_type_assertions(&x.expression),
        Expression::TSSatisfiesExpression(x) => unwrap_type_assertions(&x.expression),
        Expression::TSNonNullExpression(x) => unwrap_type_assertions(&x.expression),
        Expression::ParenthesizedExpression(x) => unwrap_type_assertions(&x.expression),
        _ => expr,
    }
}

/// Render a dotted static-member path (`Compound.Item`, `Ns.Compound.Item`)
/// when every link is a plain identifier or static member — type-assertion
/// wrappers are peeled at every hop, since assertions are erased type-level
/// syntax and must never change extraction. Computed members, calls, and any
/// other base return None (the caller bails loudly). The emitter renders an
/// AsComponent tag VERBATIM into `createComponent(<tag>, …)`, so a dotted
/// path is exactly as valid at the definition site as the identifier form.
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
