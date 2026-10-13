//! `createElement(Component, props, ...children)` read as the JSX it is:
//! `<Component {...} />`. Usage analysis then follows a wrapper that renders
//! an extracted component through `createElement` exactly as it follows the
//! same wrapper written in JSX. Only the parsed program changes: source
//! text, and every span, stay as written.

use oxc::allocator::{Allocator, TakeIn};
use oxc::ast::ast::{
    Argument, Expression, JSXAttributeItem, JSXAttributeName,
    JSXAttributeValue, JSXChild, JSXElementName, JSXExpression, JSXIdentifier,
    JSXMemberExpression, JSXMemberExpressionObject, JSXOpeningElement, ObjectExpression,
    ObjectPropertyKind, Program, PropertyKey, PropertyKind, StaticMemberExpression,
};
use oxc::ast::builder::AstBuilder;
use oxc::ast_visit::VisitMut;
use oxc::span::GetSpan;
use crate::usage_facts::{is_absent, static_member_root, ReactNames};

/// Lowers every call of the runtime's `createElement` (as usage analysis
/// recognizes it) whose component is a capitalized name or a member path.
/// A lowercase name stays a call: JSX would read it as a host element.
pub(crate) fn lower_create_element<'a>(allocator: &'a Allocator, program: &mut Program<'a>) {
    if !program.source_text.contains("createElement") {
        return;
    }
    // Which calls are React's depends on the file's bindings: one build of
    // its scopes, before the parse is final.
    let scoping = oxc::semantic::SemanticBuilder::new().build(program).semantic.into_scoping();
    let names = ReactNames::from_imports(program, &scoping);
    let mut lowering = Lowering { builder: AstBuilder::new(allocator), names, scoping: &scoping };
    lowering.visit_program(program);
}

/// Whether the element at `start` is written as a `createElement` call the
/// parse lowered, not as JSX: a diagnostic names it as written.
pub(crate) fn written_as_call(source: &str, start: u32) -> bool {
    source.as_bytes().get(start as usize) != Some(&b'<')
}

struct Lowering<'a, 's> {
    builder: AstBuilder<'a>,
    names: ReactNames,
    scoping: &'s oxc::semantic::Scoping,
}

impl<'a> VisitMut<'a> for Lowering<'a, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        if let Expression::CallExpression(call) = expression {
            if self.lowerable(call) {
                let Expression::CallExpression(call) = expression.take_in(&self.builder) else {
                    unreachable!("matched a call above");
                };
                *expression = self.element(call.unbox());
            }
        }
        oxc::ast_visit::walk_mut::walk_expression(self, expression);
    }
}

impl<'a> Lowering<'a, '_> {
    /// A call JSX can write: a runtime's `createElement` over a capitalized
    /// name or a member path, with no spread among its arguments before
    /// the children.
    fn lowerable(&self, call: &oxc::ast::ast::CallExpression<'a>) -> bool {
        if call.optional || !self.names.calls(&call.callee, "createElement") {
            return false;
        }
        let component = match call.arguments.first() {
            Some(Argument::Identifier(id)) => id.name.chars().next().is_some_and(char::is_uppercase),
            Some(Argument::StaticMemberExpression(member)) => static_member_root(member).is_some(),
            _ => false,
        };
        component && !matches!(call.arguments.get(1), Some(Argument::SpreadElement(_)))
    }

    fn element(&self, call: oxc::ast::ast::CallExpression<'a>) -> Expression<'a> {
        let span = call.span;
        let mut arguments = call.arguments.into_iter();
        let name = match arguments.next() {
            Some(Argument::Identifier(id)) => JSXElementName::IdentifierReference(id),
            Some(Argument::StaticMemberExpression(member)) => {
                JSXElementName::MemberExpression(self.jsx_member(member.unbox()))
            }
            _ => unreachable!("lowerable checked the component"),
        };
        let attributes = match arguments.next() {
            None => oxc::allocator::Vec::new_in(&self.builder),
            Some(props) => self.attributes(props.into_expression()),
        };
        let children = oxc::allocator::Vec::from_iter_in(arguments.map(|child| match child {
            Argument::SpreadElement(spread) => {
                let spread = spread.unbox();
                JSXChild::new_spread(spread.span, spread.argument, &self.builder)
            }
            child => {
                let expression = child.into_expression();
                JSXChild::new_expression_container(expression.span(), JSXExpression::from(expression), &self.builder)
            }
        }), &self.builder);
        let opening = JSXOpeningElement::boxed(span, name, None, attributes, &self.builder);
        Expression::new_jsx_element(span, opening, children, None, &self.builder)
    }

    /// The attributes a props argument writes: its plain keys as attributes
    /// and its spreads as spread attributes, in order; any other entry (a
    /// computed key, a method, an accessor) as a spread of an object holding
    /// just it. Anything but an object literal is one spread, and an absent
    /// value none; parentheses and type-only wrappers are looked through.
    fn attributes(&self, props: Expression<'a>) -> oxc::allocator::Vec<'a, JSXAttributeItem<'a>> {
        let mut items = oxc::allocator::Vec::new_in(&self.builder);
        // `null` passes no props, as an absent value does.
        if is_absent(&props, Some(self.scoping)) {
            return items;
        }
        let props = unwrapped(props);
        if matches!(props, Expression::NullLiteral(_)) {
            return items;
        }
        let Expression::ObjectExpression(object) = props else {
            items.push(JSXAttributeItem::new_spread_attribute(props.span(), props, &self.builder));
            return items;
        };
        let object = object.unbox();
        for property in object.properties {
            match property {
                ObjectPropertyKind::SpreadProperty(spread) => {
                    let spread = spread.unbox();
                    items.push(JSXAttributeItem::new_spread_attribute(spread.span, spread.argument, &self.builder));
                }
                ObjectPropertyKind::ObjectProperty(property) => {
                    let name = (property.kind == PropertyKind::Init && !property.method && !property.computed)
                        .then(|| attribute_name(&property.key))
                        .flatten();
                    match name {
                        Some(name) => {
                            let property = property.unbox();
                            let value = JSXAttributeValue::new_expression_container(
                                property.value.span(),
                                JSXExpression::from(property.value),
                                &self.builder,
                            );
                            let name = JSXAttributeName::new_identifier(property.key.span(), name, &self.builder);
                            items.push(JSXAttributeItem::new_attribute(property.span, name, Some(value), &self.builder));
                        }
                        None => {
                            let span = property.span;
                            let alone = ObjectExpression::boxed(
                                span,
                                oxc::allocator::Vec::from_iter_in([ObjectPropertyKind::ObjectProperty(property)], &self.builder),
                                &self.builder,
                            );
                            items.push(JSXAttributeItem::new_spread_attribute(
                                span,
                                Expression::ObjectExpression(alone),
                                &self.builder,
                            ));
                        }
                    }
                }
            }
        }
        items
    }

    fn jsx_member(&self, member: StaticMemberExpression<'a>) -> oxc::allocator::Box<'a, JSXMemberExpression<'a>> {
        let object = match member.object {
            Expression::Identifier(id) => JSXMemberExpressionObject::IdentifierReference(id),
            Expression::StaticMemberExpression(inner) => {
                JSXMemberExpressionObject::MemberExpression(self.jsx_member(inner.unbox()))
            }
            _ => unreachable!("static_member_root checked the path"),
        };
        let property = JSXIdentifier::new(member.property.span, member.property.name, &self.builder);
        JSXMemberExpression::boxed(member.span, object, property, &self.builder)
    }
}

/// `expression` without its parentheses and type-only wrappers, which leave
/// its value as it is.
fn unwrapped(expression: Expression<'_>) -> Expression<'_> {
    match expression {
        Expression::ParenthesizedExpression(inner) => unwrapped(inner.unbox().expression),
        Expression::TSAsExpression(inner) => unwrapped(inner.unbox().expression),
        Expression::TSSatisfiesExpression(inner) => unwrapped(inner.unbox().expression),
        Expression::TSNonNullExpression(inner) => unwrapped(inner.unbox().expression),
        Expression::TSTypeAssertion(inner) => unwrapped(inner.unbox().expression),
        expression => expression,
    }
}

/// A key JSX can write as an attribute name: an identifier, or a string
/// such as `'data-mode'` or `'aria-label'`.
fn attribute_name<'a>(key: &PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
        PropertyKey::StringLiteral(literal) => {
            let mut chars = literal.value.chars();
            let first = chars.next()?;
            ((first.is_ascii_alphabetic() || first == '_' || first == '$')
                && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '$' | '-')))
            .then(|| literal.value.as_str())
        }
        _ => None,
    }
}

