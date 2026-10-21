//! A React element call read as the JSX it is: `createElement(Component,
//! props, ...children)` as `<Component {...} />`, and the automatic runtime's
//! `jsx(Component, { ...props, children }, key)`, which compiled JSX calls, as
//! the element it was compiled from. Usage analysis then follows a wrapper
//! that renders an extracted component through either call exactly as it
//! follows the same wrapper written in JSX. Only the parsed program changes:
//! source text, and every span, stay as written.

use oxc::allocator::{Allocator, TakeIn};
use oxc::ast::ast::{
    Argument, ArrayExpressionElement, BindingPattern, Expression, JSXAttributeItem, JSXAttributeName,
    JSXAttributeValue, JSXChild, JSXClosingFragment, JSXElementName, JSXExpression, JSXIdentifier,
    JSXMemberExpression, JSXMemberExpressionObject, JSXOpeningElement, JSXOpeningFragment, ObjectExpression,
    ObjectProperty, ObjectPropertyKind, Program, PropertyKey, PropertyKind, Statement, StaticMemberExpression,
};
use oxc::ast::builder::AstBuilder;
use oxc::ast_visit::VisitMut;
use oxc::span::{GetSpan, Span};
use oxc::syntax::module_record::ModuleRecord;
use crate::jsx_scan::is_prototype_setter;
use crate::usage_facts::{is_absent, static_member_root, ElementCall, ReactNames, AUTOMATIC_RUNTIMES};
use oxc::semantic::SymbolId;
use rustc_hash::FxHashSet;

/// Lowers every call of a runtime's element function (as usage analysis
/// recognizes it) whose component is a capitalized name or a member path,
/// or, for the automatic runtime, a host element's tag or its own
/// `Fragment`, where the JSX reads as the call does. A lowercase name stays
/// a call: JSX would read it as a host element. So does any call the JSX
/// cannot write exactly, which usage reads as the call it is.
pub(crate) fn lower_create_element<'a>(allocator: &'a Allocator, program: &mut Program<'a>, module: &ModuleRecord<'_>) {
    // The automatic runtime's functions count only through its import.
    let automatic = module.requested_modules.keys().any(|source| {
        AUTOMATIC_RUNTIMES.iter().any(|(runtime, _)| *runtime == source.as_str())
    });
    if !automatic && !program.source_text.contains("createElement") {
        return;
    }
    // Which calls are React's depends on the file's bindings: one build of
    // its scopes, before the parse is final.
    let scoping = oxc::semantic::SemanticBuilder::new().build(program).semantic.into_scoping();
    let names = ReactNames::from_imports(program, &scoping);
    // Only the automatic runtime's ignored arguments read them.
    let literal_consts = if automatic { literal_consts(program, &scoping) } else { FxHashSet::default() };
    let mut lowering = Lowering { builder: AstBuilder::new(allocator), names, scoping: &scoping, literal_consts };
    lowering.visit_program(program);
}

/// The module's top-level bindings of a literal that nothing writes again,
/// such as the `var _jsxFileName` a development build passes `jsxDEV`.
fn literal_consts(program: &Program<'_>, scoping: &oxc::semantic::Scoping) -> FxHashSet<SymbolId> {
    let mut consts = FxHashSet::default();
    for statement in &program.body {
        let Statement::VariableDeclaration(declaration) = statement else { continue };
        for declarator in &declaration.declarations {
            if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&declarator.id, &declarator.init) {
                if init.get_inner_expression().is_literal() {
                    consts.extend(id.symbol_id.get().filter(|symbol| !crate::identity::reassigned(scoping, *symbol)));
                }
            }
        }
    }
    consts
}

/// Whether the element at `start` is written as a call the parse lowered,
/// not as JSX: a diagnostic names it as written.
pub(crate) fn written_as_call(source: &str, start: u32) -> bool {
    source.as_bytes().get(start as usize) != Some(&b'<')
}

struct Lowering<'a, 's> {
    builder: AstBuilder<'a>,
    names: ReactNames,
    scoping: &'s oxc::semantic::Scoping,
    literal_consts: FxHashSet<SymbolId>,
}

impl<'a> VisitMut<'a> for Lowering<'a, '_> {
    // Inner calls first, so a child an automatic call passes is already the
    // element it creates.
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        oxc::ast_visit::walk_mut::walk_expression(self, expression);
        if let Expression::CallExpression(call) = expression {
            if let Some(kind) = self.lowerable(call) {
                let Expression::CallExpression(call) = expression.take_in(&self.builder) else {
                    unreachable!("matched a call above");
                };
                *expression = match kind {
                    ElementCall::Classic => self.element(call.unbox()),
                    automatic => self.compiled_element(call.unbox(), automatic),
                };
            }
        }
    }
}

impl<'a> Lowering<'a, '_> {
    /// A call JSX can write exactly: a runtime's element function over a
    /// capitalized name or a member path, or, for the automatic runtime, a
    /// host tag or its own `Fragment` (the `_Fragment` compiled JSX
    /// imports); with no spread among the arguments that are no children,
    /// and no props that set their prototype. The automatic runtime's
    /// arguments after the key, which it ignores, must be metadata whose
    /// evaluation hands nothing on.
    fn lowerable(&self, call: &oxc::ast::ast::CallExpression<'a>) -> Option<ElementCall> {
        if call.optional {
            return None;
        }
        let kind = self.names.element_call(&call.callee)?;
        let classic = kind == ElementCall::Classic;
        let first = call.arguments.first()?;
        let component = match first {
            Argument::Identifier(id) => {
                id.name.chars().next().is_some_and(char::is_uppercase)
                    || (!classic && self.names.is_compiled_fragment(first))
            }
            Argument::StaticMemberExpression(member) => static_member_root(member).is_some(),
            Argument::StringLiteral(tag) => !classic && tag.value.as_str().is_some_and(host_tag),
            _ => false,
        };
        // A spread among the ignored arguments is no metadata.
        let written = if classic { 2 } else { 3 };
        let spread = call.arguments.iter().take(written).any(|argument| matches!(argument, Argument::SpreadElement(_)));
        let metadata = classic
            || call.arguments.iter().skip(3).all(|argument| argument.as_expression().is_some_and(|value| self.inert(value, true)));
        (component && !spread && metadata && !sets_prototype(call.arguments.get(1))).then_some(kind)
    }

    /// Whether evaluating `value` hands nothing on: a literal, an absent
    /// value, `this`, a top-level binding of a literal nothing writes again,
    /// or, `nested`, an object of those under plain keys.
    fn inert(&self, value: &Expression<'a>, nested: bool) -> bool {
        let value = value.get_inner_expression();
        match value {
            Expression::ThisExpression(_) => true,
            value if value.is_literal() || is_absent(value, Some(self.scoping)) => true,
            Expression::Identifier(id) => id
                .reference_id
                .get()
                .and_then(|reference| self.scoping.get_reference(reference).symbol_id())
                .is_some_and(|symbol| self.literal_consts.contains(&symbol)),
            Expression::ObjectExpression(object) if nested => object.properties.iter().all(|property| {
                matches!(property, ObjectPropertyKind::ObjectProperty(property)
                    if plain_name(property).is_some() && self.inert(&property.value, false))
            }),
            _ => false,
        }
    }

    fn element(&self, call: oxc::ast::ast::CallExpression<'a>) -> Expression<'a> {
        let span = call.span;
        let mut arguments = call.arguments.into_iter();
        let name = self.element_name(arguments.next());
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

    /// The element an automatic-runtime call creates, as JSX compiles to it:
    /// the props' last entry, when it is `children`, as the children (each
    /// entry of a static array its own), and the key argument as a `key`
    /// attribute after the props. The runtime's own `Fragment` with no other
    /// props and no key is the `<>` it compiles.
    fn compiled_element(&self, call: oxc::ast::ast::CallExpression<'a>, kind: ElementCall) -> Expression<'a> {
        let span = call.span;
        let fragment = call.arguments.first().is_some_and(|component| self.names.is_compiled_fragment(component));
        // `jsxs` passes static children; `jsxDEV` says so after the key.
        let many = kind == ElementCall::Jsxs
            || (kind == ElementCall::JsxDev
                && matches!(call.arguments.get(3), Some(Argument::BooleanLiteral(literal)) if literal.value));
        let mut arguments = call.arguments.into_iter();
        let name = self.element_name(arguments.next());
        let (mut attributes, children) = match arguments.next() {
            None => (oxc::allocator::Vec::new_in(&self.builder), Vec::new()),
            Some(props) => {
                let (props, children) = self.props_children(props.into_expression(), many);
                (self.attributes(props), children)
            }
        };
        if let Some(key) = arguments.next().map(Argument::into_expression) {
            if !is_absent(&key, Some(self.scoping)) {
                attributes.push(self.attribute(key.span(), "key", key.span(), key));
            }
        }
        // A lowered child is the element JSX writes as a child, not an
        // expression holding one.
        let children = oxc::allocator::Vec::from_iter_in(children.into_iter().map(|child| match child {
            Expression::JSXElement(element) => JSXChild::Element(element),
            Expression::JSXFragment(fragment) => JSXChild::Fragment(fragment),
            child => JSXChild::new_expression_container(child.span(), JSXExpression::from(child), &self.builder),
        }), &self.builder);
        if fragment && attributes.is_empty() {
            let opening = JSXOpeningFragment::new(Span::empty(span.start), &self.builder);
            let closing = JSXClosingFragment::new(Span::empty(span.end), &self.builder);
            return Expression::new_jsx_fragment(span, opening, children, closing, &self.builder);
        }
        let opening = JSXOpeningElement::boxed(span, name, None, attributes, &self.builder);
        Expression::new_jsx_element(span, opening, children, None, &self.builder)
    }

    /// `props` without its last entry when that entry is a plain `children`
    /// key, and the children it held: an array's entries when `many` and the
    /// array holds expressions alone, else the value.
    fn props_children(&self, props: Expression<'a>, many: bool) -> (Expression<'a>, Vec<Expression<'a>>) {
        let props = unwrapped(props);
        let Expression::ObjectExpression(mut object) = props else {
            return (props, Vec::new());
        };
        let children = match object.properties.pop() {
            Some(ObjectPropertyKind::ObjectProperty(property)) if plain_name(&property) == Some("children") => {
                unwrapped(property.unbox().value)
            }
            last => {
                object.properties.extend(last);
                return (Expression::ObjectExpression(object), Vec::new());
            }
        };
        let children = match children {
            Expression::ArrayExpression(array)
                if many && array.elements.iter().all(ArrayExpressionElement::is_expression) =>
            {
                array.unbox().elements.into_iter().map(ArrayExpressionElement::into_expression).collect()
            }
            value => vec![value],
        };
        (Expression::ObjectExpression(object), children)
    }

    /// The element's name: its component, or a host element's tag.
    fn element_name(&self, component: Option<Argument<'a>>) -> JSXElementName<'a> {
        match component {
            Some(Argument::Identifier(id)) => JSXElementName::IdentifierReference(id),
            Some(Argument::StaticMemberExpression(member)) => {
                JSXElementName::MemberExpression(self.jsx_member(member.unbox()))
            }
            Some(Argument::StringLiteral(tag)) => {
                JSXElementName::new_identifier(tag.span, tag.value.as_arena_str().expect("lowerable checked the tag"), &self.builder)
            }
            _ => unreachable!("lowerable checked the component"),
        }
    }

    /// The attribute `name={value}`.
    fn attribute(&self, span: Span, name: &'a str, name_span: Span, value: Expression<'a>) -> JSXAttributeItem<'a> {
        let value = JSXAttributeValue::new_expression_container(value.span(), JSXExpression::from(value), &self.builder);
        let name = JSXAttributeName::new_identifier(name_span, name, &self.builder);
        JSXAttributeItem::new_attribute(span, name, Some(value), &self.builder)
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
                    match plain_name(&property) {
                        Some(name) => {
                            let property = property.unbox();
                            items.push(self.attribute(property.span, name, property.key.span(), property.value));
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

/// Whether `props` is an object that sets its prototype, so the element
/// inherits props no attribute writes.
fn sets_prototype(props: Option<&Argument<'_>>) -> bool {
    let Some(Expression::ObjectExpression(object)) = props.and_then(Argument::as_expression).map(Expression::get_inner_expression)
    else {
        return false;
    };
    object.properties.iter().any(|property| matches!(property, ObjectPropertyKind::ObjectProperty(property) if is_prototype_setter(property)))
}

/// The attribute name a props entry writes: a plain value under a key JSX
/// can write as a name.
fn plain_name<'a>(property: &ObjectProperty<'a>) -> Option<&'a str> {
    (property.kind == PropertyKind::Init && !property.method && !property.computed)
        .then(|| attribute_name(&property.key))
        .flatten()
}

/// A tag JSX writes as a host element: lowercase first, then letters,
/// digits and `-`, as `div` and `my-element` are.
fn host_tag(tag: &str) -> bool {
    let mut chars = tag.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// A key JSX can write as an attribute name: an identifier, or a string
/// such as `'data-mode'` or `'aria-label'`.
fn attribute_name<'a>(key: &PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
        PropertyKey::StringLiteral(literal) => {
            let text = literal.value.as_str()?;
            let mut chars = text.chars();
            let first = chars.next()?;
            ((first.is_ascii_alphabetic() || first == '_' || first == '$')
                && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '$' | '-')))
            .then_some(text)
        }
        _ => None,
    }
}

