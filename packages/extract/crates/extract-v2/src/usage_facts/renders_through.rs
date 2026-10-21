//! A function that replaces the `render` of the object one parameter takes
//! with a wrapper calling the old `render` with the same props, and does
//! nothing else with that object (`mirrorAuthoredName(owner)`). Rendering
//! the object afterwards calls the old render with the props its caller
//! wrote, so it renders the classes, options and children it did before.
//!
//! The shape is an allowlist; anything it does not list is refused:
//!
//! ```ts
//! function mirror(owner, only) {
//!   const target = owner as Rendered;          // `const` aliases, assertions peeled
//!   const render = target.render;              // one `const` holds the old render
//!   if (typeof render !== 'function') return;  // `typeof` tests of it
//!   target.render = function (props, ref) {    // one assignment, a statement of the body
//!     return render(props, useRef(ref, only)); // props passed once, first, the result returned
//!   };
//! }
//! ```
//!
//! The wrapper's other arguments may be anything that cannot reach the
//! props: the props parameter appears once, and the wrapper holds no
//! `arguments` or `this`. Nothing in the function reads `arguments` or
//! `this` either, or uses the parameter, an alias or the old render in any
//! other way: storing, returning, passing on, spreading, a computed read, a
//! write of another member, or a call of the old render elsewhere.

use oxc::ast::ast::{
    AssignmentOperator, AssignmentTarget, BindingPattern, Expression, FunctionBody, IdentifierReference, Statement,
    UnaryOperator, VariableDeclarationKind,
};
use oxc::ast::AstKind;
use oxc::ast_visit::Visit;
use oxc::semantic::{Scoping, SymbolId};
use oxc::span::Span;
use rustc_hash::FxHashSet;

use super::{peel_wrappers, reads_symbol, symbol_of, FunctionParts};
use crate::chain_walk::unwrap_type_assertions;

/// Whether the function whose body is `body` replaces the `render` of the
/// object its parameter `param` takes only with a wrapper that calls the old
/// render with the same props (see the module).
pub(super) fn renders_through(body: &FunctionBody<'_>, param: SymbolId, scoping: &Scoping) -> bool {
    // The parameter and its `const` aliases, and the references of them the
    // shape allows: an alias's initializer, the old render's read and the
    // assignment's target.
    let mut owners = FxHashSet::from_iter([param]);
    let mut allowed: FxHashSet<Span> = FxHashSet::default();
    let mut saved: Option<SymbolId> = None;
    let mut wrapper: Option<&Expression<'_>> = None;
    for statement in &body.statements {
        match statement {
            Statement::VariableDeclaration(var) if var.kind == VariableDeclarationKind::Const => {
                for declarator in &var.declarations {
                    let (BindingPattern::BindingIdentifier(id), Some(init)) = (&declarator.id, &declarator.init) else {
                        continue;
                    };
                    let Some(symbol) = id.symbol_id.get() else { return false };
                    if let Some(span) = owner_of(init, &owners, scoping) {
                        owners.insert(symbol);
                        allowed.insert(span);
                    } else if let Some(span) = render_of(init, &owners, scoping) {
                        if saved.replace(symbol).is_some() {
                            return false;
                        }
                        allowed.insert(span);
                    }
                }
            }
            Statement::ExpressionStatement(statement) => {
                let Expression::AssignmentExpression(assign) = &statement.expression else { continue };
                let AssignmentTarget::StaticMemberExpression(member) = &assign.left else { continue };
                let Some(span) = owner_of(&member.object, &owners, scoping) else { continue };
                if assign.operator != AssignmentOperator::Assign
                    || member.property.name != "render"
                    || wrapper.replace(&assign.right).is_some()
                {
                    return false;
                }
                allowed.insert(span);
            }
            _ => {}
        }
    }
    let (Some(saved), Some(wrapper)) = (saved, wrapper) else { return false };
    let Some(call) = forwarding_call(wrapper, saved, scoping) else { return false };
    let mut scan = Scan {
        scoping,
        owners: &owners,
        allowed: &allowed,
        saved,
        call,
        ancestors: Vec::new(),
        refused: false,
    };
    scan.visit_function_body(body);
    !scan.refused
}

/// The span of `expr`, where it reads one of `owners`.
fn owner_of(expr: &Expression<'_>, owners: &FxHashSet<SymbolId>, scoping: &Scoping) -> Option<Span> {
    match unwrap_type_assertions(expr) {
        Expression::Identifier(ident) => reads_symbol(scoping, ident, owners).then_some(ident.span),
        _ => None,
    }
}

/// The span of the owner `expr` reads `render` from, where it is
/// `owner.render`.
fn render_of(expr: &Expression<'_>, owners: &FxHashSet<SymbolId>, scoping: &Scoping) -> Option<Span> {
    match unwrap_type_assertions(expr) {
        Expression::StaticMemberExpression(member) if member.property.name == "render" => {
            owner_of(&member.object, owners, scoping)
        }
        _ => None,
    }
}

/// The span of the callee of the one call `wrapper` makes of `saved`, where
/// `wrapper` is a function literal whose result is that call, with its
/// first parameter, used nowhere else, as the call's first argument.
fn forwarding_call(wrapper: &Expression<'_>, saved: SymbolId, scoping: &Scoping) -> Option<Span> {
    let function = FunctionParts::of_expression(wrapper)?;
    let params = function.params;
    if params.rest.is_some() || params.items.len() > 2 {
        return None;
    }
    let mut symbols = params.items.iter().map(|param| match &param.pattern {
        BindingPattern::BindingIdentifier(id) => id.symbol_id.get(),
        _ => None,
    });
    let props = symbols.next()??;
    if symbols.any(|symbol| symbol.is_none()) || scoping.get_resolved_reference_ids(props).len() != 1 {
        return None;
    }
    let Expression::CallExpression(call) = unwrap_type_assertions(function.result()?) else { return None };
    let Expression::Identifier(callee) = unwrap_type_assertions(&call.callee) else { return None };
    let first = call.arguments.first()?.as_expression()?;
    let passes_props = matches!(first, Expression::Identifier(ident) if symbol_of(scoping, ident) == Some(props));
    let spread = call.arguments.iter().any(oxc::ast::ast::Argument::is_spread);
    (symbol_of(scoping, callee) == Some(saved) && passes_props && !spread).then_some(callee.span)
}

/// Refuses any reference of an owner the shape does not allow, any use of
/// the old render but a `typeof` test and the wrapper's call, and any
/// `this` or `arguments`.
struct Scan<'s, 'a> {
    scoping: &'s Scoping,
    owners: &'s FxHashSet<SymbolId>,
    allowed: &'s FxHashSet<Span>,
    saved: SymbolId,
    call: Span,
    ancestors: Vec<AstKind<'a>>,
    refused: bool,
}

impl<'a> Visit<'a> for Scan<'_, 'a> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        if matches!(kind, AstKind::ThisExpression(_)) {
            self.refused = true;
        }
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        if ident.name == "arguments" {
            self.refused = true;
        }
        let Some(symbol) = symbol_of(self.scoping, ident) else { return };
        if self.owners.contains(&symbol) && !self.allowed.contains(&ident.span) {
            self.refused = true;
        }
        if symbol == self.saved && ident.span != self.call {
            let (_, parent) = peel_wrappers(ident.span, &mut self.ancestors.iter().rev());
            if !matches!(parent, Some(AstKind::UnaryExpression(unary)) if unary.operator == UnaryOperator::Typeof) {
                self.refused = true;
            }
        }
    }
}
