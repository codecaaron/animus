//! Where a module's Animus builder chains take a `/* @__PURE__ */`
//! annotation: building a system or a theme has no effect outside the
//! values it returns, so a bundler may drop a chain whose value no runtime
//! code reads, and with it the builder. Without the annotation a bundler
//! keeps a chain it cannot prove pure, such as an app system's
//! `createSystem().extend(kit).build().seal()`, and that keeps every builder
//! member and the kit it extends.
//!
//! A destructuring of a builder value, `const { createKeyframes } = bundle`,
//! reads a property, which no annotation can mark pure, so it is rewritten
//! as one annotated read per name: `const createKeyframes = /* @__PURE__ */
//! (() => bundle.createKeyframes)()`, which reads the same property once.
//!
//! Only what the module's own bindings prove is the builder is annotated: a
//! call of a `createSystem` or `createTheme` imported by name from
//! `@animus-ui/system`, a call on a top-level `const` such a chain
//! initializes, or a call of a factory destructured from one, each at the
//! top level. A binding aliased, reassigned or received from another module
//! is not traced. Every argument must be inert: a literal, a read of a
//! binding the module declares or imports or of a property of one, an
//! object or array of those, a function not called here, or a call of
//! another proven chain or of an Animus value helper.

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, BindingPattern, Declaration, Expression, IdentifierReference, ObjectPropertyKind,
    Program, PropertyKey, Statement, UnaryOperator, VariableDeclaration, VariableDeclarationKind,
};
use oxc::semantic::{Scoping, SymbolId};
use oxc::span::GetSpan;
use oxc::syntax::module_record::ModuleRecord;
use rustc_hash::FxHashSet;

/// The `@animus-ui/system` exports a builder chain starts from.
const BUILDER_ROOTS: [&str; 2] = ["createSystem", "createTheme"];

/// The `@animus-ui/system` exports an argument may call: each returns a
/// value and has no other effect.
const VALUE_HELPERS: [&str; 4] = ["asset", "createTransform", "firstThatWorks", "marker"];

/// The marker a bundler reads as "this call has no effect beyond its
/// value", so an unread result may be dropped.
const PURE: &str = "/* @__PURE__ */ ";

/// The source edits that mark each top-level builder chain, in source
/// order: `(start, end, text)` replacing `start..end`.
pub(crate) fn pure_builder_edits(
    program: &Program<'_>,
    module: &ModuleRecord<'_>,
    scoping: &Scoping,
) -> Vec<(u32, u32, String)> {
    let roots = crate::usage_facts::animus_named_imports(module, scoping, &BUILDER_ROOTS);
    let mut found = Vec::new();
    if roots.is_empty() {
        return found;
    }
    let mut proof = Proof {
        source: program.source_text,
        scoping,
        builders: roots,
        helpers: crate::usage_facts::animus_named_imports(module, scoping, &VALUE_HELPERS),
        values: FxHashSet::default(),
    };
    for statement in &program.body {
        match statement {
            Statement::VariableDeclaration(declaration) => proof.declaration(declaration, &mut found),
            Statement::ExportDeclaration(export) => {
                if let Declaration::VariableDeclaration(declaration) = &export.declaration {
                    proof.declaration(declaration, &mut found);
                }
            }
            Statement::ExpressionStatement(statement) if proof.chain(&statement.expression) => {
                found.extend(proof.annotate(statement.expression.span().start));
            }
            _ => {}
        }
    }
    found
}

struct Proof<'s> {
    source: &'s str,
    scoping: &'s Scoping,
    /// Locals bound to `createSystem` or `createTheme`, and top-level
    /// `const`s destructured by a `create…` key from a builder value: the
    /// callees a chain starts from.
    builders: FxHashSet<SymbolId>,
    /// Locals bound to an Animus value helper.
    helpers: FxHashSet<SymbolId>,
    /// Top-level `const`s a builder chain initializes.
    values: FxHashSet<SymbolId>,
}

impl Proof<'_> {
    /// The annotation before the expression at `at`, as a replacement of its
    /// first character.
    fn annotate(&self, at: u32) -> Option<(u32, u32, String)> {
        let first = self.source.get(at as usize..)?.chars().next()?;
        Some((at, at + first.len_utf8() as u32, format!("{PURE}{first}")))
    }

    fn declaration(&mut self, declaration: &VariableDeclaration<'_>, found: &mut Vec<(u32, u32, String)>) {
        if declaration.kind != VariableDeclarationKind::Const {
            return;
        }
        for declarator in &declaration.declarations {
            let Some(init) = &declarator.init else { continue };
            match &declarator.id {
                BindingPattern::BindingIdentifier(binding) if self.chain(init) => {
                    found.extend(self.annotate(init.span().start));
                    self.values.extend(binding.symbol_id.get());
                }
                BindingPattern::ObjectPattern(pattern)
                    if self.is_value(init) && pattern.rest.is_none() && declarator.type_annotation.is_none() =>
                {
                    // Each name a plain key binds as it is: no default, no
                    // computed key, no nested pattern.
                    let names: Option<Vec<(&str, &str, SymbolId)>> = pattern
                        .properties
                        .iter()
                        .map(|property| match (&property.key, &property.value) {
                            (PropertyKey::StaticIdentifier(key), BindingPattern::BindingIdentifier(binding))
                                if !property.computed =>
                            {
                                Some((key.name.as_str(), binding.name.as_str(), binding.symbol_id.get()?))
                            }
                            _ => None,
                        })
                        .collect();
                    let Some(names) = names.filter(|names| !names.is_empty()) else { continue };
                    let object = &self.source[init.span().start as usize..init.span().end as usize];
                    let reads: Vec<String> = names
                        .iter()
                        .map(|(key, local, _)| format!("{local} = {PURE}(() => {object}.{key})()"))
                        .collect();
                    // Its line breaks stay, so every later line keeps its number.
                    let breaks = "\n".repeat(
                        self.source[declarator.span.start as usize..declarator.span.end as usize].matches('\n').count(),
                    );
                    found.push((declarator.span.start, declarator.span.end, reads.join(", ") + &breaks));
                    self.builders.extend(
                        names.iter().filter(|(key, _, _)| key.starts_with("create")).map(|(_, _, symbol)| *symbol),
                    );
                }
                _ => {}
            }
        }
    }

    fn bound(&self, ident: &IdentifierReference<'_>, symbols: &FxHashSet<SymbolId>) -> bool {
        crate::usage_facts::reads_symbol(self.scoping, ident, symbols)
    }

    fn is_value(&self, expression: &Expression<'_>) -> bool {
        matches!(crate::chain_walk::unwrap_type_assertions(expression), Expression::Identifier(ident) if self.bound(ident, &self.values))
    }

    /// A call the module's bindings prove is the builder's, every argument
    /// inert: a call of a builder root or factory, or a method call on a builder
    /// value or on another such call.
    fn chain(&self, expression: &Expression<'_>) -> bool {
        let Expression::CallExpression(call) = crate::chain_walk::unwrap_type_assertions(expression) else {
            return false;
        };
        let proven = match crate::chain_walk::unwrap_type_assertions(&call.callee) {
            Expression::Identifier(callee) => self.bound(callee, &self.builders),
            Expression::StaticMemberExpression(member) => self.chain(&member.object) || self.is_value(&member.object),
            _ => false,
        };
        proven && call.arguments.iter().all(|argument| self.inert_argument(argument))
    }

    fn inert_argument(&self, argument: &Argument<'_>) -> bool {
        match argument {
            Argument::SpreadElement(spread) => self.inert(&spread.argument),
            _ => argument.as_expression().is_some_and(|expression| self.inert(expression)),
        }
    }

    /// Whether evaluating `expression` has no effect beyond its value.
    fn inert(&self, expression: &Expression<'_>) -> bool {
        let expression = crate::chain_walk::unwrap_type_assertions(expression);
        if expression.is_literal() {
            return true;
        }
        match expression {
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
            // A binding the module declares or imports; reading an unbound
            // global can throw, or run a getter.
            Expression::Identifier(ident) => {
                ident.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id()).is_some()
            }
            Expression::TemplateLiteral(template) => template.expressions.iter().all(|part| self.inert(part)),
            Expression::StaticMemberExpression(member) => self.inert(&member.object),
            Expression::ComputedMemberExpression(member) => {
                self.inert(&member.object) && self.inert(&member.expression)
            }
            Expression::ObjectExpression(object) => object.properties.iter().all(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    (!property.computed || property.key.as_expression().is_some_and(|key| self.inert(key)))
                        && self.inert(&property.value)
                }
                ObjectPropertyKind::SpreadProperty(spread) => self.inert(&spread.argument),
            }),
            Expression::ArrayExpression(array) => array.elements.iter().all(|element| match element {
                ArrayExpressionElement::SpreadElement(spread) => self.inert(&spread.argument),
                ArrayExpressionElement::Elision(_) => true,
                _ => element.as_expression().is_some_and(|expression| self.inert(expression)),
            }),
            Expression::UnaryExpression(unary) => unary.operator != UnaryOperator::Delete && self.inert(&unary.argument),
            Expression::BinaryExpression(binary) => self.inert(&binary.left) && self.inert(&binary.right),
            Expression::LogicalExpression(logical) => self.inert(&logical.left) && self.inert(&logical.right),
            Expression::ConditionalExpression(conditional) => {
                self.inert(&conditional.test) && self.inert(&conditional.consequent) && self.inert(&conditional.alternate)
            }
            Expression::CallExpression(call) => {
                self.chain(expression)
                    || matches!(
                        crate::chain_walk::unwrap_type_assertions(&call.callee),
                        Expression::Identifier(callee) if self.bound(callee, &self.helpers)
                    ) && call.arguments.iter().all(|argument| self.inert_argument(argument))
            }
            _ => false,
        }
    }
}
