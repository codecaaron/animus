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
    Argument, AssignmentOperator, AssignmentTarget, BindingPattern, Expression, FormalParameters, FunctionBody,
    IdentifierReference, Statement, UnaryOperator, VariableDeclarationKind,
};
use oxc::ast::AstKind;
use oxc::ast_visit::Visit;
use oxc::semantic::{Scoping, SymbolId};
use oxc::span::{GetSpan, Span};
use rustc_hash::FxHashSet;

/// Whether the function whose body is `body` replaces the `render` of the
/// object its parameter `param` takes only with a wrapper that calls the old
/// render with the same props (see the module).
pub(super) fn renders_through(body: &FunctionBody<'_>, param: SymbolId, scoping: &Scoping) -> bool {
    let symbol_of = |ident: &IdentifierReference<'_>| {
        ident.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id())
    };
    // The parameter and its `const` aliases, and the references of them the
    // shape allows: an alias's initializer, the old render's read and the
    // assignment's target.
    let mut owners = FxHashSet::from_iter([param]);
    let mut allowed: FxHashSet<Span> = FxHashSet::default();
    let owner_of = |expr: &Expression<'_>, owners: &FxHashSet<SymbolId>| match expr.get_inner_expression() {
        Expression::Identifier(ident) if symbol_of(ident).is_some_and(|symbol| owners.contains(&symbol)) => {
            Some(ident.span)
        }
        _ => None,
    };
    let render_of = |expr: &Expression<'_>, owners: &FxHashSet<SymbolId>| match expr.get_inner_expression() {
        Expression::StaticMemberExpression(member) if member.property.name == "render" => {
            owner_of(&member.object, owners)
        }
        _ => None,
    };
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
                    if let Some(span) = owner_of(init, &owners) {
                        owners.insert(symbol);
                        allowed.insert(span);
                    } else if let Some(span) = render_of(init, &owners) {
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
                let Some(span) = owner_of(&member.object, &owners) else { continue };
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

/// The span of the callee of the one call `wrapper` makes of `saved`, where
/// `wrapper` is a function literal whose result is that call, with its
/// first parameter, used nowhere else, as the call's first argument.
fn forwarding_call(wrapper: &Expression<'_>, saved: SymbolId, scoping: &Scoping) -> Option<Span> {
    let (params, result): (&FormalParameters<'_>, &Expression<'_>) = match wrapper.get_inner_expression() {
        Expression::ArrowFunctionExpression(arrow) => {
            (&arrow.params, returned(arrow.get_expression(), arrow.get_function_body())?)
        }
        Expression::FunctionExpression(func) => (&func.params, returned(None, func.body.as_deref())?),
        _ => return None,
    };
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
    let Expression::CallExpression(call) = result.get_inner_expression() else { return None };
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else { return None };
    let resolves = |ident: &IdentifierReference<'_>, symbol: SymbolId| {
        ident.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id()) == Some(symbol)
    };
    let first = match call.arguments.first()? {
        Argument::SpreadElement(_) => return None,
        argument => argument.as_expression()?,
    };
    let passes_props = matches!(first, Expression::Identifier(ident) if resolves(ident, props));
    let spread = call.arguments.iter().any(|argument| matches!(argument, Argument::SpreadElement(_)));
    (resolves(callee, saved) && passes_props && !spread).then_some(callee.span)
}

/// The expression a function body returns as its one statement, or its
/// concise body.
fn returned<'b, 'a>(
    concise: Option<&'b Expression<'a>>,
    body: Option<&'b FunctionBody<'a>>,
) -> Option<&'b Expression<'a>> {
    if let Some(concise) = concise {
        return Some(concise);
    }
    match body?.statements.as_slice() {
        [Statement::ReturnStatement(ret)] => ret.argument.as_ref(),
        _ => None,
    }
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
        let Some(symbol) = ident.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id()) else {
            return;
        };
        if self.owners.contains(&symbol) && !self.allowed.contains(&ident.span) {
            self.refused = true;
        }
        if symbol == self.saved && ident.span != self.call {
            let mut current = ident.span;
            let tested = self.ancestors.iter().rev().find_map(|kind| match kind {
                kind if super::is_erased_wrapper(kind) => {
                    current = kind.span();
                    None
                }
                AstKind::UnaryExpression(unary) => {
                    Some(unary.operator == UnaryOperator::Typeof && unary.argument.span() == current)
                }
                _ => Some(false),
            });
            if tested != Some(true) {
                self.refused = true;
            }
        }
    }
}
