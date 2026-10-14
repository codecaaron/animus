//! Raw JSX usage facts plus the cross-file filters over them. Collection is
//! component-agnostic; filtering applies the component maps afterwards.

use oxc::ast::ast::{
    Argument, CallExpression, Expression, IdentifierReference, ImportDeclarationSpecifier,
    JSXAttributeItem, JSXAttributeName, JSXElementName, JSXOpeningElement, Program, Statement,
};
use oxc::ast::AstKind;
use oxc::ast_visit::Visit;
use oxc::semantic::{Scoping, SemanticBuilder, SymbolFlags, SymbolId};
use oxc::span::Span;
use oxc::span::GetSpan;
use oxc::syntax::module_record::{ExportExportName, ExportLocalName, ImportEntry, ImportImportName, ModuleRecord};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

use crate::chain_walk::{ChainDescriptor, TerminalKind};
use crate::static_value::StaticValue;
use crate::jsx_scan::{
    classify_jsx_attribute_as_variant_value, create_element_literals, create_element_props, eval_jsx_attribute_value, eval_property_key,
    eval_static_expression, make_json_number,
    is_component_like_identifier, jsx_member_path, ComponentUsageConfig, CustomPropScanResult,
    DynamicExpressionKind, DynamicPropUsage, PropValueResult, StateUsage, SystemPropUsage, record_written,
    UsageResidueSite, UsageScanResult, UsageSpan, VariantUsage, WrittenProp,
};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageResidueRecord {
    pub binding: String,
    pub prop: String,
    pub file: String,
    pub span: UsageSpan,
    pub kind: DynamicExpressionKind,
}

/// Classification of one JSX attribute value, computed at collect time.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttrFact {
    pub name: String,
    pub static_value: Option<Value>,
    /// Statically known alternatives at a still-dynamic conditional or
    /// logical site; each one still enters the utility-input stream.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub enumerable_values: Vec<Value>,
    pub dynamic: bool,
    pub dynamic_kind: Option<DynamicExpressionKind>,
    /// Byte span of the dynamic expression in its source file.
    pub dynamic_span: Option<UsageSpan>,
    /// True when the attribute is skipped entirely (empty expressions).
    pub skip: bool,
    /// Variant classification: a literal string or `"__dynamic__"`.
    pub variant_class: String,
    /// Every value the attribute can write is known without statics that
    /// may name a changed object: `static_value`, or, without one, each of
    /// `enumerable_values`. See `proven_values`.
    #[serde(skip)]
    pub literal: bool,
    /// For a value that is not a literal, the conditions it can write: see
    /// `write_conditions`.
    #[serde(skip)]
    pub conditions: Option<BTreeSet<String>>,
    /// Written by only some branches of a spread of listed object literals
    /// (`{...(c ? { type: 'a' } : {})}`), so the element may leave it out.
    #[serde(skip)]
    pub optional: bool,
    /// Byte offset of the attribute, or of the spread that writes it.
    #[serde(skip)]
    pub at: u32,
}

impl AttrFact {
    /// Whether the element always sets the prop to this value itself: no
    /// spread after it can replace it, and no branch leaves it out.
    pub(crate) fn settles(&self, index: usize, spread: Option<usize>) -> bool {
        !self.optional && spread.is_none_or(|before| index >= before)
    }

    /// Every value the attribute can write, when they are known: its
    /// static value, or the finite values a runtime value is proven to take.
    pub(crate) fn proven_values(&self) -> Option<impl Iterator<Item = &Value>> {
        (self.literal && !self.dynamic).then(|| self.class_values())
    }

    /// Every static value the attribute can write, each of which takes a
    /// system prop's utility class: its static value, or the statically known
    /// alternatives of a runtime one.
    pub(crate) fn class_values(&self) -> impl Iterator<Item = &Value> {
        self.static_value.iter().chain(&self.enumerable_values)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TagFact {
    /// `<Name ...>` — raw identifier.
    Ident(String),
    /// `<Root.Slot ...>` or `<ns.Root.Slot ...>` — the dotted path as
    /// written, resolved against member-expr bindings at FILTER time.
    Member(String),
}

/// Where the name a tag starts with is bound, as the file's own scopes tell
/// it: for `<ui.Item>`, where `ui` is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TagOrigin {
    Import,
    /// Any other top-level binding of the file.
    TopLevel,
    /// A parameter, or a binding inside a function or block.
    Nested,
    /// A binding MDX's usage source (`mdxUsageSource`, which mirrors compiled
    /// MDX) destructures from the components a provider supplies
    /// (`const { Card } = _components`): matched by name, as a
    /// provider-scope component is.
    Provided,
    /// No binding in the file: a global, or nothing.
    Undeclared,
}

/// A tag that left the usage scan unable to tell which component it renders.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UncertainTag {
    /// The name or dotted path as written; `None` for a `createElement`
    /// argument that names nothing (`createElement(pick())`).
    pub tag: Option<String>,
    pub create_element: bool,
    /// Written as a `createElement` call, whatever the analysis reads it as.
    pub written_as_call: bool,
    /// The tag's `defaultProps`, not a render of it.
    pub default_props: bool,
    pub origin: Option<TagOrigin>,
    /// Byte offset of the element or call.
    pub at: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UsageFact {
    Element {
        tag: TagFact,
        attrs: Vec<AttrFact>,
        /// `Some(n)` when a `{...props}` attribute can deliver any prop at
        /// runtime: the first `n` attrs precede the last spread, which can
        /// replace them; the rest are settled.
        #[serde(skip)]
        spread: Option<usize>,
        /// Byte span of the opening element.
        #[serde(skip)]
        span: (u32, u32),
        /// Collected with the file's scopes only.
        #[serde(skip)]
        origin: Option<TagOrigin>,
        /// Written as a `createElement` call, which the parse reads as this
        /// element: a diagnostic names it as written.
        #[serde(skip)]
        written_as_call: bool,
    },
    /// createElement(X, ...) / React.createElement(X, ...): the first
    /// argument as a raw name or dotted key (None = unattributable form).
    CreateElement {
        ident: Option<String>,
        member: Option<String>,
        #[serde(skip)]
        identity_uncertain: bool,
        /// The props the second argument settles with their variant
        /// classification; `None` when it can deliver unknown props.
        #[serde(skip)]
        props: Option<Vec<(String, String)>>,
        /// The literal values among those props, as a JSX attribute's
        /// static value reads them.
        #[serde(skip)]
        literals: Vec<(String, Value)>,
        /// What the props object writes when usage reads all of it; `None`
        /// when it can deliver props usage cannot list.
        #[serde(skip)]
        writes: Option<CreateWrites>,
        /// A `cloneElement` of an element of this component: `props` are
        /// its overrides, and the element's own props are recorded where
        /// it is written.
        #[serde(skip)]
        clone: bool,
        /// Byte offset of the call.
        #[serde(skip)]
        at: u32,
        /// Collected with the file's scopes only.
        #[serde(skip)]
        origin: Option<TagOrigin>,
    },
    /// A reference to a component's `defaultProps`, which React reads as
    /// the props a render leaves out: usage cannot list them.
    DefaultProps {
        tag: TagFact,
        /// Collected with the file's scopes only.
        #[serde(skip)]
        origin: Option<TagOrigin>,
        /// Byte offset of the member.
        #[serde(skip)]
        at: u32,
        /// Assigned to, or `Object.assign`'s target; otherwise read.
        #[serde(skip)]
        written: bool,
    },
    /// `cloneElement(child, …)` of an element usage cannot name: the
    /// overrides can reach any component.
    CloneUnknown {
        /// The overrides with their variant classification; `None` when
        /// they can deliver props usage cannot list.
        #[serde(skip)]
        props: Option<Vec<(String, String)>>,
        /// The call's line and its spelling, for the warning when the
        /// overrides cannot be listed.
        #[serde(skip)]
        line: usize,
        #[serde(skip)]
        call: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFact {
    pub local: String,
    pub imported: String,
    pub source: String,
    /// Byte span of the whole import declaration.
    #[serde(skip)]
    pub(crate) declaration: (u32, u32),
}

/// The `@animus-ui/system` package or one of its subpaths.
pub(crate) fn is_animus_system_specifier(spec: &str) -> bool {
    spec == "@animus-ui/system" || spec.starts_with("@animus-ui/system/")
}

/// Namespace imports (`import * as ns from 'x'`): local name → specifier.
/// Kept apart from `ImportFact`, whose consumers resolve `local` as a named
/// binding.
pub fn collect_namespace_imports(module: &ModuleRecord<'_>) -> std::collections::BTreeMap<String, String> {
    module
        .import_entries
        .iter()
        .filter(|entry| entry.import_name.is_namespace_object())
        .map(|entry| (entry.local_name.name.to_string(), entry.module_request.name.to_string()))
        .collect()
}

/// A top-level function component that forwards its props by spread, by
/// one route or more: `(props) => <Recipe {...props} />`,
/// `({ a, ...rest }) => <Recipe {...rest} />`, or `const { a, ...rest } =
/// props` in its body and then `{...rest}`.
#[derive(Debug, Clone, Default)]
pub struct PropsForwarding {
    pub routes: Vec<ForwardRoute>,
}

/// One spread of a component's props.
#[derive(Debug, Clone, Default)]
pub struct ForwardRoute {
    /// Props a pattern on the way destructures by name, which the spread
    /// never carries.
    pub named: Vec<String>,
    /// The tags that receive the spread, as written (`Recipe`, `Ns.Item`).
    pub targets: Vec<String>,
}

/// Top-level function components, plain or inside `forwardRef`/`memo`,
/// keyed by binding (`default` for a default export), that spread their
/// props parameter or its rest element into a JSX tag. One a top-level
/// `const X = { key: … }` holds is keyed `X.key`, a name no binding has.
pub fn collect_props_forwarding(
    program: &Program<'_>,
    scoping: &Scoping,
) -> std::collections::BTreeMap<String, PropsForwarding> {
    use oxc::ast::ast::ExportDefaultDeclarationKind;
    let mut components: Vec<(&str, Option<ComponentFunction<'_, '_>>)> = Vec::new();
    let mut held: Vec<(String, ComponentFunction<'_, '_>)> = Vec::new();
    for stmt in &program.body {
        match stmt {
            Statement::ExportDeclaration(export) => {
                components.extend(declared_components(&export.declaration));
                held.extend(held_components(&export.declaration));
            }
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    components.push(("default", ComponentFunction::of_function(function)));
                }
                kind => {
                    if let Some(expr) = kind.as_expression() {
                        components.push(("default", ComponentFunction::of_expression(expr)));
                    }
                }
            },
            stmt => {
                if let Some(declaration) = stmt.as_declaration() {
                    components.extend(declared_components(declaration));
                    held.extend(held_components(declaration));
                }
            }
        }
    }
    components
        .into_iter()
        .filter_map(|(name, function)| Some((name.to_string(), function?)))
        .chain(held)
        .filter_map(|(name, function)| Some((name, props_forwarding(function, scoping)?)))
        .collect()
}

/// The component functions the object literal of a top-level `const`
/// holds, keyed `X.key`.
fn held_components<'b, 'a>(
    declaration: &'b oxc::ast::ast::Declaration<'a>,
) -> Vec<(String, ComponentFunction<'b, 'a>)> {
    use oxc::ast::ast::{Declaration, ObjectPropertyKind, PropertyKind, VariableDeclarationKind};
    let Declaration::VariableDeclaration(variables) = declaration else { return Vec::new() };
    if variables.kind != VariableDeclarationKind::Const {
        return Vec::new();
    }
    let mut held = Vec::new();
    for declarator in &variables.declarations {
        let (Some(name), Some(init)) = (declarator.id.get_identifier_name(), &declarator.init) else { continue };
        let Expression::ObjectExpression(object) = crate::chain_walk::unwrap_type_assertions(init) else { continue };
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(p) = property else { continue };
            if p.computed || p.method || p.kind != PropertyKind::Init {
                continue;
            }
            let (Some(key), Some(function)) = (p.key.static_name(), ComponentFunction::of_expression(&p.value)) else {
                continue;
            };
            held.push((format!("{name}.{key}"), function));
        }
    }
    held
}

/// The bindings a top-level declaration gives, each with its component
/// function when it is one.
fn declared_components<'b, 'a>(
    declaration: &'b oxc::ast::ast::Declaration<'a>,
) -> Vec<(&'b str, Option<ComponentFunction<'b, 'a>>)> {
    use oxc::ast::ast::Declaration;
    match declaration {
        Declaration::FunctionDeclaration(function) => function
            .id
            .as_ref()
            .map(|id| (id.name.as_str(), ComponentFunction::of_function(function)))
            .into_iter()
            .collect(),
        Declaration::VariableDeclaration(variables) => variables
            .declarations
            .iter()
            .filter_map(|declarator| {
                let name = declarator.id.get_identifier_name()?;
                Some((name.as_str(), ComponentFunction::of_expression(declarator.init.as_ref()?)))
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// A component function's first parameter and body.
struct ComponentFunction<'b, 'a> {
    props: Option<&'b oxc::ast::ast::FormalParameter<'a>>,
    body: ComponentBody<'b, 'a>,
}

/// A function's body, or an arrow's block or concise body.
enum ComponentBody<'b, 'a> {
    Function(&'b oxc::ast::ast::FunctionBody<'a>),
    Arrow(&'b oxc::ast::ast::ArrowFunctionBody<'a>),
}

impl<'a> ComponentBody<'_, 'a> {
    fn visit(&self, visitor: &mut impl Visit<'a>) {
        match self {
            Self::Function(body) => visitor.visit_function_body(body),
            Self::Arrow(body) => visitor.visit_arrow_function_body(body),
        }
    }
}

impl<'b, 'a> ComponentFunction<'b, 'a> {
    fn of_function(function: &'b oxc::ast::ast::Function<'a>) -> Option<Self> {
        Some(Self {
            props: function.params.items.first(),
            body: ComponentBody::Function(function.body.as_deref()?),
        })
    }

    /// An arrow or function expression, or one passed to `forwardRef` or
    /// `memo` (as `React.forwardRef` too), through type-only wrappers.
    fn of_expression(expr: &'b Expression<'a>) -> Option<Self> {
        match crate::chain_walk::unwrap_type_assertions(expr) {
            Expression::ArrowFunctionExpression(arrow) => Some(Self {
                props: arrow.params.items.first(),
                body: ComponentBody::Arrow(&arrow.body),
            }),
            Expression::FunctionExpression(function) => Self::of_function(function),
            Expression::CallExpression(call) => {
                let wrapper = match &call.callee {
                    Expression::Identifier(id) => id.name.as_str(),
                    Expression::StaticMemberExpression(member) => member.property.name.as_str(),
                    _ => return None,
                };
                if !matches!(wrapper, "forwardRef" | "memo") {
                    return None;
                }
                Self::of_expression(call.arguments.first()?.as_expression()?)
            }
            _ => None,
        }
    }
}

fn props_forwarding(function: ComponentFunction<'_, '_>, scoping: &Scoping) -> Option<PropsForwarding> {
    use oxc::ast::ast::BindingPattern;
    let mut pattern = &function.props?.pattern;
    while let BindingPattern::AssignmentPattern(assignment) = pattern {
        pattern = &assignment.left;
    }
    let (named, binding) = match pattern {
        BindingPattern::BindingIdentifier(id) => (Vec::new(), id.as_ref()),
        BindingPattern::ObjectPattern(object) => object_rest(object)?,
        _ => return None,
    };
    // The props, by binding: a name a nested scope declares again is not it.
    let props = Props { scoping, symbol: binding.symbol_id.get()? };
    let mut routes = Vec::new();
    let mut route = |named: Vec<String>, spread: SymbolId| {
        let mut scan = SpreadTargets {
            props: &props,
            spread,
            targets: Vec::new(),
        };
        function.body.visit(&mut scan);
        if !scan.targets.is_empty() {
            routes.push(ForwardRoute { named, targets: scan.targets });
        }
    };
    route(named.clone(), props.symbol);
    // `const { a, ...rest } = props` in the body, then `{...rest}`: neither
    // the props the parameter names nor the ones the body names reach the
    // tags `rest` is spread into.
    // `const [styling, behavior] = splitProps(props, KEYS)` or `const
    // styling = pick(props)`: what a call the props are passed to returns
    // may carry any of them, and so may a conditional with it as one
    // alternative. `const rest = visible ? props : {}` spreads the props or
    // nothing. Each declaration counts, in a block or a nested function too.
    let mut declarations = PropsDeclarations { props: &props, rests: Vec::new(), values: Vec::new() };
    function.body.visit(&mut declarations);
    for (body_named, rest) in declarations.rests {
        route(named.iter().cloned().chain(body_named).collect(), rest);
    }
    for bound in declarations.values {
        route(named.clone(), bound);
    }
    (!routes.is_empty()).then_some(PropsForwarding { routes })
}

/// A component's props parameter, or its rest element, by binding.
struct Props<'s> {
    scoping: &'s Scoping,
    symbol: SymbolId,
}

impl Props<'_> {
    /// Whether `expr` reads the binding `symbol`.
    fn reads(&self, expr: &Expression<'_>, symbol: SymbolId) -> bool {
        matches!(crate::chain_walk::unwrap_type_assertions(expr), Expression::Identifier(id)
            if id.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id()) == Some(symbol))
    }

    fn is(&self, expr: &Expression<'_>) -> bool {
        self.reads(expr, self.symbol)
    }

    /// What `expr` may evaluate to, alternative by alternative, through
    /// conditionals and logical operators, each operand only where its
    /// outcome can occur: `visible && props` is nothing or the props, and
    /// `false && props` only nothing.
    fn alternatives(&self, expr: &Expression<'_>, kinds: &mut Alternatives) {
        use oxc::ast::ast::{ArrayExpressionElement, LogicalOperator, ObjectPropertyKind};
        let holds_props = |expr: &Expression<'_>| self.is(expr);
        // A literal or a call holding the props may carry any of them.
        match crate::chain_walk::unwrap_type_assertions(expr) {
            Expression::ConditionalExpression(conditional) => {
                let test = self.outcomes(&conditional.test);
                if test.truthy {
                    self.alternatives(&conditional.consequent, kinds);
                }
                if test.falsy {
                    self.alternatives(&conditional.alternate, kinds);
                }
            }
            Expression::LogicalExpression(logical) => {
                let left = self.outcomes(&logical.left);
                let (left_flows, right_runs) = match logical.operator {
                    LogicalOperator::And => {
                        // A falsy left spreads nothing.
                        kinds.omits |= left.falsy;
                        (false, left.truthy)
                    }
                    LogicalOperator::Or => (left.truthy, left.falsy),
                    LogicalOperator::Coalesce => (left.present, left.nullish),
                };
                if left_flows {
                    self.alternatives(&logical.left, kinds);
                }
                if right_runs {
                    self.alternatives(&logical.right, kinds);
                }
            }
            expr if self.is(expr) => kinds.props = true,
            Expression::CallExpression(call)
                if call.arguments.iter().any(|argument| argument.as_expression().is_some_and(holds_props)) =>
            {
                kinds.derived = true;
            }
            Expression::ObjectExpression(object) if object.properties.is_empty() => kinds.omits = true,
            Expression::ObjectExpression(object)
                if object.properties.iter().any(|property| match property {
                    ObjectPropertyKind::ObjectProperty(property) => holds_props(&property.value),
                    ObjectPropertyKind::SpreadProperty(spread) => holds_props(&spread.argument),
                }) =>
            {
                kinds.derived = true;
            }
            Expression::ArrayExpression(array)
                if array.elements.iter().any(|element| match element {
                    ArrayExpressionElement::SpreadElement(spread) => holds_props(&spread.argument),
                    element => element.as_expression().is_some_and(holds_props),
                }) =>
            {
                kinds.derived = true;
            }
            Expression::NullLiteral(_) => kinds.omits = true,
            Expression::BooleanLiteral(literal) if !literal.value => kinds.omits = true,
            expr if self.is_undefined(expr) => kinds.omits = true,
            _ => kinds.other = true,
        }
    }

    fn is_undefined(&self, expr: &Expression<'_>) -> bool {
        matches!(expr, Expression::Identifier(id)
            if id.name == "undefined"
                && id.reference_id.get().is_some_and(|id| self.scoping.get_reference(id).symbol_id().is_none()))
    }

    /// Which outcomes `expr` can have as an operand: any, unless it is a
    /// literal.
    fn outcomes(&self, expr: &Expression<'_>) -> Outcomes {
        let fixed = |truthy: bool, nullish: bool| Outcomes { truthy, falsy: !truthy, nullish, present: !nullish };
        match crate::chain_walk::unwrap_type_assertions(expr) {
            Expression::NullLiteral(_) => fixed(false, true),
            expr if self.is_undefined(expr) => fixed(false, true),
            Expression::BooleanLiteral(literal) => fixed(literal.value, false),
            Expression::NumericLiteral(literal) => fixed(literal.value != 0.0 && !literal.value.is_nan(), false),
            Expression::StringLiteral(literal) => fixed(!literal.value.is_empty(), false),
            Expression::ObjectExpression(_)
            | Expression::ArrayExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_) => fixed(true, false),
            _ => Outcomes { truthy: true, falsy: true, nullish: true, present: true },
        }
    }
}

/// The outcomes an operand can have.
struct Outcomes {
    truthy: bool,
    falsy: bool,
    nullish: bool,
    present: bool,
}

/// The kinds of a value's alternatives: the props themselves, what may
/// carry any of them, nothing, or anything else.
#[derive(Default)]
struct Alternatives {
    props: bool,
    derived: bool,
    omits: bool,
    other: bool,
}

/// The body's declarations of what the props, alternative by alternative,
/// may be.
struct PropsDeclarations<'p, 's> {
    props: &'p Props<'s>,
    /// Each `const { a, b, ...rest } = props`: the keys it names and its
    /// rest binding.
    rests: Vec<(Vec<String>, SymbolId)>,
    /// Each binding of a value whose every alternative is the props, may
    /// carry any of them (a call's result, a destructured part), or spreads
    /// nothing.
    values: Vec<SymbolId>,
}

impl<'a> Visit<'a> for PropsDeclarations<'_, '_> {
    fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
        use oxc::ast::ast::BindingPattern;
        if let Some(init) = &declarator.init {
            match &declarator.id {
                BindingPattern::ObjectPattern(object) if self.props.is(init) => {
                    if let Some((named, rest)) = object_rest(object) {
                        self.rests.extend(rest.symbol_id.get().map(|rest| (named, rest)));
                    }
                }
                pattern => {
                    let mut kinds = Alternatives::default();
                    self.props.alternatives(init, &mut kinds);
                    if !kinds.other && (kinds.props || kinds.derived) {
                        match pattern {
                            BindingPattern::BindingIdentifier(id) => {
                                self.values.extend(id.symbol_id.get());
                            }
                            _ if !kinds.derived && !kinds.omits => {}
                            pattern => {
                                let mut bound = Vec::new();
                                bound_symbols(pattern, &mut bound);
                                self.values.extend(bound);
                            }
                        }
                    }
                }
            }
        }
        oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
    }
}

/// Every binding a binding pattern binds, through defaults, nesting and rests.
fn bound_symbols(pattern: &oxc::ast::ast::BindingPattern<'_>, bound: &mut Vec<SymbolId>) {
    use oxc::ast::ast::BindingPattern;
    match pattern {
        BindingPattern::BindingIdentifier(id) => bound.extend(id.symbol_id.get()),
        BindingPattern::AssignmentPattern(assignment) => bound_symbols(&assignment.left, bound),
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                bound_symbols(element, bound);
            }
            if let Some(rest) = &array.rest {
                bound_symbols(&rest.argument, bound);
            }
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                bound_symbols(&property.value, bound);
            }
            if let Some(rest) = &object.rest {
                bound_symbols(&rest.argument, bound);
            }
        }
    }
}

/// `{ a, b, ...rest }`: the keys it names and its rest binding.
fn object_rest<'b, 'a>(
    object: &'b oxc::ast::ast::ObjectPattern<'a>,
) -> Option<(Vec<String>, &'b oxc::ast::ast::BindingIdentifier<'a>)> {
    let oxc::ast::ast::BindingPattern::BindingIdentifier(rest) = &object.rest.as_ref()?.argument else {
        return None;
    };
    let named = object
        .properties
        .iter()
        .filter_map(|property| property.key.static_name().map(|key| key.to_string()))
        .collect();
    Some((named, rest.as_ref()))
}

/// The tags a binding is spread whole into, by binding. The props parameter
/// is also spread as a value whose every alternative is the props or nothing
/// (`{...(visible && props)}`).
struct SpreadTargets<'p, 's> {
    props: &'p Props<'s>,
    spread: SymbolId,
    targets: Vec<String>,
}

impl<'a> Visit<'a> for SpreadTargets<'_, '_> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        let carries = |argument: &Expression<'_>| {
            if self.props.reads(argument, self.spread) {
                return true;
            }
            let mut kinds = Alternatives::default();
            self.props.alternatives(argument, &mut kinds);
            self.spread == self.props.symbol && kinds.props && !kinds.derived && !kinds.other
        };
        let spreads = elem.attributes.iter().any(|attr| {
            matches!(attr, JSXAttributeItem::SpreadAttribute(spread) if carries(&spread.argument))
        });
        let tag = match &elem.name {
            JSXElementName::IdentifierReference(id) => Some(id.name.to_string()),
            JSXElementName::MemberExpression(member) => jsx_member_path(member),
            _ => None,
        };
        if let (true, Some(tag)) = (spreads, tag) {
            if !self.targets.contains(&tag) {
                self.targets.push(tag);
            }
        }
        oxc::ast_visit::walk::walk_jsx_opening_element(self, elem);
    }
}

/// A module's named and default imports, from the parser's record of its
/// top-level import declarations, type-only ones included.
pub fn collect_import_facts(module: &ModuleRecord<'_>) -> Vec<ImportFact> {
    module
        .import_entries
        .iter()
        .filter_map(|entry| {
            let imported = match &entry.import_name {
                ImportImportName::Name(name) => name.name.to_string(),
                // `imported` is "default" for a default import, so the parent
                // dangles and the child stands alone.
                ImportImportName::Default(_) => "default".to_string(),
                ImportImportName::NamespaceObject => return None,
            };
            Some(import_fact(entry, imported))
        })
        .collect()
}

fn import_fact(entry: &ImportEntry<'_>, imported: String) -> ImportFact {
    ImportFact {
        local: entry.local_name.name.to_string(),
        imported,
        source: entry.module_request.name.to_string(),
        declaration: (entry.statement_span.start, entry.statement_span.end),
    }
}

/// A module's namespace imports, `imported` being `*`.
pub(crate) fn collect_namespace_import_facts(module: &ModuleRecord<'_>) -> Vec<ImportFact> {
    module
        .import_entries
        .iter()
        .filter(|entry| entry.import_name.is_namespace_object())
        .map(|entry| import_fact(entry, "*".to_string()))
        .collect()
}

/// Per-file named-export fact; feeds static enrichment and re-export
/// following.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFact {
    pub exported: String,
    /// Local binding name; None for a pure re-export, so static-export
    /// collection cannot match a same-named local.
    pub local: Option<String>,
    /// Re-export source specifier (`export { X } from './x'`).
    pub source: Option<String>,
    /// The ORIGINAL name at the source for re-exports (`X` in
    /// `export { X as Y } from './x'`); None for local exports.
    pub original: Option<String>,
}

/// The local names of a file's named and default imports.
fn named_import_locals(module: &ModuleRecord<'_>) -> BTreeSet<String> {
    module
        .import_entries
        .iter()
        .filter(|entry| !entry.import_name.is_namespace_object())
        .map(|entry| entry.local_name.name.to_string())
        .collect()
}

/// Each module namespace a file exports at runtime: name → source. That is
/// `export * as name from '…'`, which the parser records among the indirect
/// exports, and an exported namespace import (`import * as ns from '…'` with
/// `export { ns as name }` or `export default ns`), which it records among
/// the local exports. A type-only import or export exports nothing.
pub fn collect_namespace_exports(module: &ModuleRecord<'_>) -> BTreeMap<String, String> {
    let namespace_imports: BTreeMap<&str, &str> = module
        .import_entries
        .iter()
        .filter(|entry| entry.import_name.is_namespace_object() && !entry.is_type)
        .map(|entry| (entry.local_name.name.as_str(), entry.module_request.name.as_str()))
        .collect();
    let star_as = module
        .indirect_export_entries
        .iter()
        .filter(|entry| entry.import_name.is_all() && !entry.is_type)
        .filter_map(|entry| match (&entry.export_name, &entry.module_request) {
            (ExportExportName::Name(name), Some(source)) => Some((name.name.to_string(), source.name.to_string())),
            _ => None,
        });
    let exported_imports = module.local_export_entries.iter().filter(|entry| !entry.is_type).filter_map(|entry| {
        let (exported, local) = match (&entry.export_name, &entry.local_name) {
            (ExportExportName::Name(name), ExportLocalName::Name(local)) => (name.name.as_str(), local),
            (ExportExportName::Default(_), ExportLocalName::Default(local) | ExportLocalName::Name(local)) => {
                ("default", local)
            }
            _ => return None,
        };
        let source = namespace_imports.get(local.name.as_str())?;
        Some((exported.to_string(), source.to_string()))
    });
    star_as.chain(exported_imports).collect()
}

/// The sources of `export * from '…'`, which re-export every named export.
pub fn collect_star_exports(module: &ModuleRecord<'_>) -> Vec<String> {
    module
        .star_export_entries
        .iter()
        .filter_map(|entry| entry.module_request.as_ref().map(|source| source.name.to_string()))
        .collect()
}

/// Collect export facts from top-level statements. Walked rather than read
/// from the parser's module record, which files `export { a }` of an
/// imported `a` as a re-export from `a`'s module, and lists function, class
/// and destructured exports that these facts leave out.
pub fn collect_export_facts(program: &Program<'_>) -> Vec<ExportFact> {
    use oxc::ast::ast::Declaration;
    let mut out = Vec::new();
    for stmt in &program.body {
        match stmt {
            Statement::ExportDeclaration(export) => {
                if let Declaration::VariableDeclaration(decl) = &export.declaration {
                    for declarator in &decl.declarations {
                        if let oxc::ast::ast::BindingPattern::BindingIdentifier(ident) = &declarator.id {
                            out.push(ExportFact {
                                exported: ident.name.to_string(),
                                local: Some(ident.name.to_string()),
                                source: None,
                                original: None,
                            });
                        }
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                for spec in &export.specifiers {
                    out.push(ExportFact {
                        exported: spec.exported.name().to_string(),
                        local: Some(spec.local.name().to_string()),
                        source: None,
                        original: None,
                    });
                }
            }
            Statement::ExportFromDeclaration(export) => {
                for spec in &export.specifiers {
                    out.push(ExportFact {
                        exported: spec.exported.name().to_string(),
                        local: None,
                        source: Some(export.source.value.to_string()),
                        original: Some(spec.local.name().to_string()),
                    });
                }
            }
            _ => {}
        }
    }
    out
}

/// Usage facts enriched with same-file and imported statics, and the bindings
/// of extracted component chains no other module can name and this module
/// renders only in place (see `ConfinementScan`), from one semantic analysis:
/// a second analysis would renumber the references the first one reads.
/// What `collect_enriched_usage` reads from one semantic build of a module.
pub(crate) struct EnrichedUsage {
    pub usage: Vec<UsageFact>,
    /// See `FileFacts::confined_components`.
    pub confined: BTreeSet<String>,
    /// See `FileFacts::value_escapes`.
    pub escapes: BTreeSet<String>,
    /// See `FileFacts::spread_wrappers`.
    pub spread_wrappers: BTreeMap<String, SpreadWrapper>,
    /// See `FileFacts::ordinary_components`.
    pub ordinary_components: BTreeSet<String>,
    /// See `FileFacts::prop_tags`.
    pub prop_tags: Vec<PropTag>,
    /// See `FileFacts::name_uses`.
    pub name_uses: BTreeMap<String, NameUses>,
    /// See `FileFacts::namespace_member_uses`.
    pub namespace_member_uses: BTreeMap<String, NameUses>,
    /// See `FileFacts::direct_eval`.
    pub direct_eval: bool,
    /// See `FileFacts::opaque_calls`.
    pub opaque_calls: Vec<OpaqueCall>,
    /// See `FileFacts::element_consts`.
    pub element_consts: BTreeMap<String, ElementConst>,
    /// See `FileFacts::opaque_tags`.
    pub opaque_tags: Vec<OpaqueTag>,
    /// See `FileFacts::builder_import_references`.
    pub builder_import_references: Vec<BuilderImportReferences>,
}

/// A component element that hands its children and props to its receiver,
/// which may clone them: the tag as written, where its first name is bound,
/// whether the element can render something other than its tag (`as`,
/// `asChild` or a spread), and what its attributes and children carry, read
/// as a call's arguments are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OpaqueTag {
    pub tag: String,
    /// A parameter or local never names the module's binding of that name.
    pub origin: TagOrigin,
    pub polymorphic: bool,
    pub tags: BTreeSet<String>,
    pub imported_args: Vec<String>,
    pub forwards_from: Vec<String>,
}

/// A call that may hand an element to code outside React: what its callee
/// starts from, the component tags its arguments can carry, and the
/// top-level bindings whose parameters an argument reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OpaqueCall {
    /// An import or a top-level binding of the module, with the member a
    /// namespace import's call names (`lib.enhance`); `None` for a global
    /// outside the built-ins, which is never analysed.
    pub callee: Option<String>,
    /// The imports a top-level value the call names was built from
    /// (`const enhance = lib.enhance`): each must stay inside the analysis.
    pub callee_imports: Vec<String>,
    /// Component tags in the arguments, and in the `const` initializers
    /// they name.
    pub tags: BTreeSet<String>,
    /// Imports the arguments read, whose declaring modules' `const`s may
    /// hold elements (see `ElementConst`).
    pub imported_args: Vec<String>,
    /// The enclosing top-level binding (and `default` for a default
    /// export) when an argument reads one of its parameters, directly or
    /// through a `const` that does.
    pub forwards_from: Vec<String>,
}

/// A top-level `const` that holds elements: their component tags, and the
/// imports outside React it reads, which may hold more.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ElementConst {
    pub tags: BTreeSet<String>,
    pub imports: Vec<String>,
}

/// A use of a binding that holds an object which may change the object's
/// members later, or hand the object to code the analysis does not follow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectUse {
    /// 1-based line of the use; `None` for a direct `eval`, which can reach
    /// any binding.
    pub line: Option<usize>,
    /// What the use does, said of the object: `is passed to decorate()`.
    pub what: String,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn collect_enriched_usage(
    built: Scoping,
    program: &Program<'_>,
    module: &ModuleRecord<'_>,
    static_values: &FxHashMap<String, StaticValue>,
    module_path: &str,
    chains: &[&ChainDescriptor],
    exports: &[ExportFact],
) -> EnrichedUsage {
    let static_values = crate::eval::Statics::of(static_values, module_path);
    let exported: FxHashSet<&str> = exports.iter().filter_map(|e| e.local.as_deref()).collect();
    let candidates: Vec<&str> = chains
        .iter()
        .filter(|chain| {
            chain.extractable
                && chain.terminal != TerminalKind::AsClass
                && !exported.contains(chain.binding.as_str())
        })
        .map(|chain| chain.binding.as_str())
        .collect();
    let may_escape = !chains.is_empty()
        || program.body.iter().any(|stmt| matches!(stmt, Statement::ImportDeclaration(_)));
    let wrapper_candidates = spread_wrapper_candidates(program);
    let needs_scoping = !static_values.is_empty()
        || !candidates.is_empty()
        || may_escape
        || !wrapper_candidates.is_empty();
    // `built` is the module's one semantic build, Lower's. Tag origins and
    // ordinary components read those scopes even when nothing above needs
    // them.
    let (scoping, tag_scoping) = if needs_scoping { (Some(built), None) } else { (None, Some(built)) };
    let react = match &scoping {
        Some(scoping) => ReactNames::from_imports(program, scoping),
        None => ReactNames::by_name(),
    };
    let origins = scoping.as_ref().or(tag_scoping.as_ref());
    // Only TypeScript annotates parameters.
    let finite_params = origins
        .filter(|_| program.source_type.is_typescript())
        .map(|scoping| literal_union_parameters(program, scoping))
        .unwrap_or_default();
    let mut collector = FactCollector {
        facts: Vec::new(),
        source: program.source_text,
        writing: false,
        static_values,
        scoping: scoping.as_ref().filter(|_| !static_values.is_empty()),
        enrich: true,
        finite_params,
        react: react.clone(),
        clones: Some(CloneScan {
            scoping: scoping.as_ref(),
            source: program.source_text,
            elements: FxHashMap::default(),
            pending: Vec::new(),
        }),
        origins,
        provided: provided_components(program),
        rests: origins.map(|scoping| rest_parameters(program, scoping)).unwrap_or_default(),
        declaring: oxc::ast::ast::VariableDeclarationKind::Var,
    };
    collector.visit_program(program);
    let usage = collector.finish();
    let ordinary_components = origins
        .map(|scoping| ordinary_components(program, scoping))
        .unwrap_or_default();
    // Without scopes a direct `eval` cannot be ruled out.
    let direct_eval = origins.is_none_or(|scoping| scoping.root_unresolved_references().contains_key("eval"));
    let confined = match &scoping {
        // Direct eval can read any binding by name.
        Some(scoping) if !direct_eval => {
            let mut scan = ConfinementScan {
                scoping,
                chains,
                candidates: candidates
                    .into_iter()
                    .filter_map(|binding| Some((scoping.get_root_binding(binding.into())?, binding)))
                    .collect(),
                escaped: FxHashSet::default(),
                ancestors: Vec::new(),
            };
            scan.visit_program(program);
            scan.candidates
                .into_iter()
                .filter(|(symbol, _)| !scan.escaped.contains(symbol))
                .map(|(_, binding)| binding.to_string())
                .collect()
        }
        _ => BTreeSet::new(),
    };
    let escapes = match &scoping {
        Some(scoping) if may_escape => {
            let mut scan = EscapeScan {
                scoping,
                chains,
                react: &react,
                namespaces: collect_namespace_imports(module).into_keys().collect(),
                imports: named_import_locals(module),
                escapes: BTreeSet::new(),
                ancestors: Vec::new(),
            };
            if scoping.root_unresolved_references().contains_key("eval") {
                // Direct eval can hand any binding anywhere.
                let every: Vec<String> = scoping
                    .iter_bindings_in(scoping.root_scope_id())
                    .map(|symbol| scoping.symbol_name(symbol).to_string())
                    .filter(|name| scan.is_candidate(name))
                    .collect();
                scan.escapes.extend(every);
            } else {
                scan.visit_program(program);
            }
            scan.escapes
        }
        _ => BTreeSet::new(),
    };
    let spread_wrappers = match &scoping {
        Some(scoping)
            if !wrapper_candidates.is_empty()
                && !scoping.root_unresolved_references().contains_key("eval") =>
        {
            spread_wrappers(program, scoping, wrapper_candidates)
        }
        _ => BTreeMap::new(),
    };
    let (opaque_calls, opaque_tags, element_consts) =
        origins.map(|scoping| opaque_calls(program, scoping)).unwrap_or_default();
    let (prop_tags, name_uses, namespace_member_uses) =
        origins.map(|scoping| prop_tags_and_uses(program, scoping, &react)).unwrap_or_default();
    let builder_import_references =
        origins.map(|scoping| builder_import_references(program, module, scoping)).unwrap_or_default();
    EnrichedUsage {
        usage,
        confined,
        escapes,
        spread_wrappers,
        ordinary_components,
        prop_tags,
        name_uses,
        namespace_member_uses,
        direct_eval,
        opaque_calls,
        element_consts,
        opaque_tags,
        builder_import_references,
    }
}

/// One builder import's value references, by imported name and source.
#[derive(Debug, Clone)]
pub struct BuilderImportReferences {
    pub imported: String,
    pub source: String,
    pub spans: Vec<(u32, u32)>,
}

/// The value references of every `animus`, `compose` or `composeWithContext`
/// import, through any local name (`compose as c`). References resolve
/// through the file's scopes, so a parameter that shadows the import, or a
/// `typeof` type query, is no use of it.
fn builder_import_references(
    program: &Program<'_>,
    module: &ModuleRecord<'_>,
    scoping: &Scoping,
) -> Vec<BuilderImportReferences> {
    struct Scan<'s> {
        scoping: &'s Scoping,
        imports: FxHashMap<SymbolId, usize>,
        found: Vec<BuilderImportReferences>,
    }
    impl<'a> Visit<'a> for Scan<'_> {
        fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
            let Some(reference) = ident.reference_id.get().map(|id| self.scoping.get_reference(id)) else {
                return;
            };
            if !reference.is_value() {
                return;
            }
            if let Some(&index) = reference.symbol_id().and_then(|symbol| self.imports.get(&symbol)) {
                self.found[index].spans.push((ident.span.start, ident.span.end));
            }
        }
    }
    let mut scan = Scan { scoping, imports: FxHashMap::default(), found: Vec::new() };
    for import in collect_import_facts(module) {
        if !matches!(import.imported.as_str(), "animus" | "compose" | "composeWithContext") {
            continue;
        }
        if let Some(symbol) = scoping.get_root_binding(import.local.as_str().into()) {
            scan.imports.insert(symbol, scan.found.len());
            scan.found.push(BuilderImportReferences {
                imported: import.imported,
                source: import.source,
                spans: Vec::new(),
            });
        }
    }
    if !scan.found.is_empty() {
        scan.visit_program(program);
    }
    scan.found
}

/// React's own modules: their functions render or clone elements only as
/// usage facts record.
const REACT_MODULES: [&str; 6] =
    ["react", "react-dom", "react-dom/client", "react-dom/server", "react/jsx-runtime", "react/jsx-dev-runtime"];

/// Globals whose calls, and whose values, never change an element's props.
const BUILTIN_GLOBALS: [&str; 33] = [
    "Array", "Boolean", "Date", "Error", "Infinity", "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise",
    "Reflect", "RegExp", "Set", "String", "Symbol", "WeakMap", "WeakSet", "cancelAnimationFrame", "clearInterval",
    "clearTimeout", "console", "decodeURIComponent", "encodeURIComponent", "isFinite", "isNaN", "parseFloat",
    "parseInt", "queueMicrotask", "requestAnimationFrame", "setTimeout", "undefined",
];

/// The calls and `new` expressions in `program` that can hand an element or
/// a parameter to code the analysis may not follow (every one except
/// React's, a built-in global's, and one on a value a function body
/// declares), and the top-level `const`s that hold elements.
fn opaque_calls(
    program: &Program<'_>,
    scoping: &Scoping,
) -> (Vec<OpaqueCall>, Vec<OpaqueTag>, BTreeMap<String, ElementConst>) {
    let mut sources: FxHashMap<SymbolId, &str> = FxHashMap::default();
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else { continue };
        for specifier in import.specifiers.iter().flatten() {
            if let Some(symbol) = specifier.local().symbol_id.get() {
                sources.insert(symbol, import.source.value.as_str());
            }
        }
    }
    let mut scan = OpaqueCallScan {
        scoping,
        sources,
        top: Vec::new(),
        in_parameter: 0,
        parameters: FxHashSet::default(),
        consts: FxHashMap::default(),
        functions: FxHashMap::default(),
        default_export: None,
        calls: Vec::new(),
        tag_calls: Vec::new(),
    };
    for statement in &program.body {
        scan.top = top_level_names(statement);
        if let Statement::ExportDefaultDeclaration(export) = statement {
            use oxc::ast::ast::ExportDefaultDeclarationKind;
            let mut reads = ArgumentReads::default();
            let mut collector = ReadCollector { scoping, reads: &mut reads };
            match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    if let Some(body) = &function.body {
                        collector.visit_function_body(body);
                    }
                }
                ExportDefaultDeclarationKind::ClassDeclaration(class) => collector.visit_class(class),
                declaration => {
                    if let Some(expression) = declaration.as_expression() {
                        collector.visit_expression(expression);
                    }
                }
            }
            scan.default_export = Some(reads);
        }
        scan.visit_statement(statement);
    }
    let calls = scan
        .calls
        .iter()
        .filter_map(|(root, reads, top)| {
            let (tags, imported_args, forwards_from) = scan.delivery(reads, top)?;
            let (callee, callee_imports) = scan.callee(root);
            Some(OpaqueCall { callee, callee_imports, tags, imported_args, forwards_from })
        })
        .collect();
    let tags = scan
        .tag_calls
        .iter()
        .filter_map(|(tag, origin, polymorphic, reads, top)| {
            let (tags, imported_args, forwards_from) = scan.delivery(reads, top)?;
            Some(OpaqueTag {
                tag: tag.clone(),
                origin: *origin,
                polymorphic: *polymorphic,
                tags,
                imported_args,
                forwards_from,
            })
        })
        .collect();
    // Top-level values, functions included, that hold or return elements:
    // code outside the analysis can call a function it receives.
    let mut element_consts = BTreeMap::new();
    let top_level = scan
        .consts
        .iter()
        .map(|(symbol, init)| (*symbol, &init.reads))
        .chain(scan.functions.iter().map(|(symbol, (reads, _))| (*symbol, reads)))
        .filter(|(symbol, _)| scoping.symbol_scope_id(*symbol) == scoping.root_scope_id())
        .map(|(symbol, reads)| (scoping.symbol_name(symbol).to_string(), reads))
        .chain(scan.default_export.as_ref().map(|reads| ("default".to_string(), reads)));
    for (name, reads) in top_level {
        let closed = scan.closure(reads);
        if !closed.tags.is_empty() || !closed.imports.is_empty() {
            element_consts.insert(name, ElementConst { tags: closed.tags, imports: closed.imports });
        }
    }
    (calls, tags, element_consts)
}

/// The names a top-level statement binds, for parameter forwarding: a
/// function, class or simple `const`, and `default` for a default export.
fn top_level_names(statement: &Statement<'_>) -> Vec<String> {
    use oxc::ast::ast::{BindingPattern, Declaration, ExportDefaultDeclarationKind};
    let declaration = match statement {
        Statement::ExportDeclaration(export) => Some(&export.declaration),
        Statement::ExportDefaultDeclaration(export) => {
            let id = match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => function.id.as_ref(),
                ExportDefaultDeclarationKind::ClassDeclaration(class) => class.id.as_ref(),
                _ => None,
            };
            return id.map(|id| id.name.to_string()).into_iter().chain(["default".to_string()]).collect();
        }
        statement => statement.as_declaration(),
    };
    match declaration {
        Some(Declaration::FunctionDeclaration(function)) => function.id.iter().map(|id| id.name.to_string()).collect(),
        Some(Declaration::ClassDeclaration(class)) => class.id.iter().map(|id| id.name.to_string()).collect(),
        Some(Declaration::VariableDeclaration(variables)) => variables
            .declarations
            .iter()
            .filter_map(|declarator| match &declarator.id {
                BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// What an expression reads: the component tags of its elements, the
/// bindings it names, and whether it names a global outside the built-ins.
#[derive(Default, Clone)]
struct ArgumentReads {
    tags: BTreeSet<String>,
    symbols: FxHashSet<SymbolId>,
    unknown_global: bool,
}

/// What an expression reads once every `const` it names is followed:
/// element tags, the imports outside React it reaches, and whether it
/// reaches a parameter or a global outside the built-ins.
#[derive(Default)]
struct ClosedReads {
    tags: BTreeSet<String>,
    imports: Vec<String>,
    reads_parameter: bool,
    unknown_global: bool,
}

/// Adds what `expression` reads to `reads`.
fn collect_reads(scoping: &Scoping, expression: &Expression<'_>, reads: &mut ArgumentReads) {
    ReadCollector { scoping, reads }.visit_expression(expression);
}

struct ReadCollector<'s, 'r> {
    scoping: &'s Scoping,
    reads: &'r mut ArgumentReads,
}

impl<'a> Visit<'a> for ReadCollector<'_, '_> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        match &elem.name {
            JSXElementName::IdentifierReference(id) => {
                self.reads.tags.insert(id.name.to_string());
            }
            JSXElementName::MemberExpression(member) => self.reads.tags.extend(jsx_member_path(member)),
            _ => {}
        }
        oxc::ast_visit::walk::walk_jsx_opening_element(self, elem);
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        match ident.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id()) {
            Some(symbol) => {
                self.reads.symbols.insert(symbol);
            }
            None => self.reads.unknown_global |= !BUILTIN_GLOBALS.contains(&ident.name.as_str()),
        }
    }
}

/// The bindings a pattern declares.
#[derive(Default)]
struct BindingNames(Vec<SymbolId>);

impl<'a> Visit<'a> for BindingNames {
    fn visit_binding_identifier(&mut self, id: &oxc::ast::ast::BindingIdentifier<'a>) {
        self.0.extend(id.symbol_id.get());
    }

    // A default value is read, not declared.
    fn visit_expression(&mut self, _expression: &Expression<'a>) {}
}

/// A `const` initializer: what it reads, and whether it is a function.
struct ConstInit {
    reads: ArgumentReads,
    /// The scope of the function the initializer is, whose own parameters
    /// a call does not forward by calling it.
    function: Option<oxc::semantic::ScopeId>,
}

/// What a callee starts from.
enum CalleeRoot {
    /// An import outside React, with the member a namespace import's call
    /// names (`lib.enhance`).
    Import(String),
    /// A binding of the module's top level.
    Module(SymbolId),
    /// A global outside the built-ins.
    Unknown,
}

struct OpaqueCallScan<'s> {
    scoping: &'s Scoping,
    /// Import binding → module specifier.
    sources: FxHashMap<SymbolId, &'s str>,
    /// The names the enclosing top-level statement binds.
    top: Vec<String>,
    in_parameter: usize,
    parameters: FxHashSet<SymbolId>,
    consts: FxHashMap<SymbolId, ConstInit>,
    /// What each function declaration's body reads, and its scope.
    functions: FxHashMap<SymbolId, (ArgumentReads, oxc::semantic::ScopeId)>,
    /// What a default-exported expression reads.
    default_export: Option<ArgumentReads>,
    calls: Vec<(CalleeRoot, ArgumentReads, Vec<String>)>,
    /// Component elements: the tag, whether it is polymorphic, and what its
    /// attributes and children read.
    tag_calls: Vec<(String, TagOrigin, bool, ArgumentReads, Vec<String>)>,
}

impl OpaqueCallScan<'_> {
    /// What a call's callee starts from, or `None` when the call cannot
    /// reach code outside React: a React import, a built-in global, or a
    /// value a function body declares, which analysed code supplies.
    fn root(&self, callee: &Expression<'_>) -> Option<CalleeRoot> {
        // A callee rooted in no identifier (`[1].map`) is a value the
        // analysed code builds.
        let (root, member) = callee_root(callee)?;
        if self.is_react(root) {
            return None;
        }
        let Some(symbol) = root.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id()) else {
            return (!BUILTIN_GLOBALS.contains(&root.name.as_str())).then_some(CalleeRoot::Unknown);
        };
        match self.sources.get(&symbol) {
            Some(_) => Some(CalleeRoot::Import(match member {
                Some(member) => format!("{}.{member}", root.name),
                None => root.name.to_string(),
            })),
            None => (self.scoping.symbol_scope_id(symbol) == self.scoping.root_scope_id())
                .then_some(CalleeRoot::Module(symbol)),
        }
    }

    /// The binding a call resolves, `None` when it reaches outside the
    /// analysis for certain, and the imports a module value it calls was
    /// built from. A function or class declared at the top level is
    /// analysed; a value is analysed only through what it reads, and one
    /// something writes is not followed.
    fn callee(&self, root: &CalleeRoot) -> (Option<String>, Vec<String>) {
        match root {
            CalleeRoot::Unknown => (None, Vec::new()),
            CalleeRoot::Import(name) => (Some(name.clone()), Vec::new()),
            CalleeRoot::Module(symbol) => {
                let name = Some(self.scoping.symbol_name(*symbol).to_string());
                if self.scoping.symbol_flags(*symbol).intersects(SymbolFlags::Function | SymbolFlags::Class) {
                    return (name, Vec::new());
                }
                match self.consts.get(symbol) {
                    Some(init) if init.function.is_some() => (name, Vec::new()),
                    Some(init) => {
                        let closed = self.closure(&init.reads);
                        if closed.unknown_global { (None, Vec::new()) } else { (name, closed.imports) }
                    }
                    None => (None, Vec::new()),
                }
            }
        }
    }

    /// What arguments reading `reads` deliver, followed through `const`s:
    /// element tags, imports that may hold more, and the enclosing
    /// top-level bindings (`top`) when a parameter of theirs reaches them;
    /// `None` when they deliver nothing.
    fn delivery(&self, reads: &ArgumentReads, top: &[String]) -> Option<(BTreeSet<String>, Vec<String>, Vec<String>)> {
        let closed = self.closure(reads);
        let forwards_from = if closed.reads_parameter { top.to_vec() } else { Vec::new() };
        (!closed.tags.is_empty() || !closed.imports.is_empty() || !forwards_from.is_empty())
            .then_some((closed.tags, closed.imports, forwards_from))
    }

    /// Whether `root` names React: an import from one of its modules, or
    /// an unbound `React`, as `ReactNames` reads it.
    fn is_react(&self, root: &IdentifierReference<'_>) -> bool {
        match root.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id()) {
            Some(symbol) => self.sources.get(&symbol).is_some_and(|source| REACT_MODULES.contains(source)),
            None => root.name == "React",
        }
    }

    /// `reads`, with every `const`, parameter default and function
    /// declaration it names followed to what that reads: a function a call
    /// receives can be called, and return its elements. A followed
    /// function's own parameters are not forwarded by the call; a parameter
    /// it captures from an enclosing function is.
    fn closure(&self, reads: &ArgumentReads) -> ClosedReads {
        let mut closed = ClosedReads {
            tags: reads.tags.clone(),
            unknown_global: reads.unknown_global,
            ..ClosedReads::default()
        };
        let mut seen: FxHashSet<SymbolId> = FxHashSet::default();
        let mut entered: FxHashSet<oxc::semantic::ScopeId> = FxHashSet::default();
        let mut parameters: Vec<SymbolId> = Vec::new();
        // A binding the walk does not follow (`let held; held = children`)
        // may hold anything a parameter does.
        let mut unresolved = false;
        let mut pending: Vec<SymbolId> = reads.symbols.iter().copied().collect();
        while let Some(symbol) = pending.pop() {
            if !seen.insert(symbol) {
                continue;
            }
            if self.parameters.contains(&symbol) {
                parameters.push(symbol);
            }
            match self.sources.get(&symbol) {
                Some(source) if REACT_MODULES.contains(source) => {}
                Some(_) => closed.imports.push(self.scoping.symbol_name(symbol).to_string()),
                None => {}
            }
            let (next, function) = match (self.consts.get(&symbol), self.functions.get(&symbol)) {
                (Some(init), _) => (&init.reads, init.function),
                (None, Some((reads, scope))) => (reads, Some(*scope)),
                (None, None) => {
                    unresolved |= !self.parameters.contains(&symbol) && !self.sources.contains_key(&symbol);
                    continue;
                }
            };
            entered.extend(function);
            closed.tags.extend(next.tags.iter().cloned());
            closed.unknown_global |= next.unknown_global;
            pending.extend(next.symbols.iter().copied());
        }
        closed.reads_parameter = unresolved
            || parameters.iter().any(|parameter| !entered.contains(&self.scoping.symbol_scope_id(*parameter)));
        closed.imports.sort();
        closed
    }

    fn record(&mut self, callee: &Expression<'_>, arguments: &[Argument<'_>]) {
        if arguments.is_empty() {
            return;
        }
        let Some(root) = self.root(callee) else { return };
        let mut reads = ArgumentReads::default();
        for argument in arguments {
            match argument {
                Argument::SpreadElement(spread) => collect_reads(self.scoping, &spread.argument, &mut reads),
                argument => {
                    if let Some(expression) = argument.as_expression() {
                        collect_reads(self.scoping, expression, &mut reads);
                    }
                }
            }
        }
        self.calls.push((root, reads, self.top.clone()));
    }
}

/// The identifier a callee starts from, through members and calls, and the
/// member named directly on it.
fn callee_root<'b, 'a>(callee: &'b Expression<'a>) -> Option<(&'b IdentifierReference<'a>, Option<&'b str>)> {
    match crate::chain_walk::unwrap_type_assertions(callee) {
        Expression::Identifier(id) => Some((id, None)),
        Expression::StaticMemberExpression(member) => match &member.object {
            Expression::Identifier(id) => Some((id, Some(member.property.name.as_str()))),
            object => callee_root(object),
        },
        Expression::ComputedMemberExpression(member) => callee_root(&member.object).map(|(root, _)| (root, None)),
        Expression::CallExpression(call) => callee_root(&call.callee).map(|(root, _)| (root, None)),
        Expression::ChainExpression(chain) => chain.expression.as_member_expression().and_then(|member| {
            callee_root(member.object()).map(|(root, _)| (root, None))
        }),
        _ => None,
    }
}

impl<'a> Visit<'a> for OpaqueCallScan<'_> {
    fn visit_formal_parameter(&mut self, parameter: &oxc::ast::ast::FormalParameter<'a>) {
        // A parameter's default, or a default inside its pattern, is a
        // value its bindings may hold.
        let mut reads = ArgumentReads::default();
        let mut collector = ReadCollector { scoping: self.scoping, reads: &mut reads };
        collector.visit_binding_pattern(&parameter.pattern);
        if let Some(initializer) = &parameter.initializer {
            collector.visit_expression(initializer);
        }
        if !reads.tags.is_empty() || !reads.symbols.is_empty() || reads.unknown_global {
            let mut names = BindingNames::default();
            names.visit_binding_pattern(&parameter.pattern);
            for symbol in names.0 {
                self.consts.insert(symbol, ConstInit { reads: reads.clone(), function: None });
            }
        }
        self.in_parameter += 1;
        oxc::ast_visit::walk::walk_formal_parameter(self, parameter);
        self.in_parameter -= 1;
    }

    fn visit_binding_identifier(&mut self, id: &oxc::ast::ast::BindingIdentifier<'a>) {
        if self.in_parameter > 0 {
            self.parameters.extend(id.symbol_id.get());
        }
    }

    fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
        if let Some(init) = &declarator.init {
            // A destructured binding may hold any part of what the
            // initializer reads, or a default the pattern names.
            let mut names = BindingNames::default();
            names.visit_binding_pattern(&declarator.id);
            let function = match (&declarator.id, crate::chain_walk::unwrap_type_assertions(init)) {
                (oxc::ast::ast::BindingPattern::BindingIdentifier(_), Expression::ArrowFunctionExpression(arrow)) => {
                    arrow.scope_id.get()
                }
                (oxc::ast::ast::BindingPattern::BindingIdentifier(_), Expression::FunctionExpression(function)) => {
                    function.scope_id.get()
                }
                _ => None,
            };
            for symbol in names.0.into_iter().filter(|symbol| !self.scoping.symbol_is_mutated(*symbol)) {
                let mut reads = ArgumentReads::default();
                let mut collector = ReadCollector { scoping: self.scoping, reads: &mut reads };
                collector.visit_expression(init);
                collector.visit_binding_pattern(&declarator.id);
                self.consts.insert(symbol, ConstInit { reads, function });
            }
        }
        oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
    }

    fn visit_function(&mut self, function: &oxc::ast::ast::Function<'a>, flags: oxc::syntax::scope::ScopeFlags) {
        if let (Some(id), Some(body), Some(scope)) = (&function.id, &function.body, function.scope_id.get()) {
            if let Some(symbol) = id.symbol_id.get() {
                let mut reads = ArgumentReads::default();
                ReadCollector { scoping: self.scoping, reads: &mut reads }.visit_function_body(body);
                self.functions.insert(symbol, (reads, scope));
            }
        }
        oxc::ast_visit::walk::walk_function(self, function, flags);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        self.record(&call.callee, &call.arguments);
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }

    fn visit_new_expression(&mut self, new: &oxc::ast::ast::NewExpression<'a>) {
        self.record(&new.callee, &new.arguments);
        oxc::ast_visit::walk::walk_new_expression(self, new);
    }

    fn visit_jsx_element(&mut self, element: &oxc::ast::ast::JSXElement<'a>) {
        let opening = &element.opening_element;
        // A host element renders its children in place, and React's own
        // components are known.
        let named = match &opening.name {
            JSXElementName::IdentifierReference(id) => Some((id.name.to_string(), Some(&**id))),
            JSXElementName::MemberExpression(member) => {
                jsx_member_path(member).map(|path| (path, jsx_member_root(member)))
            }
            _ => None,
        };
        if let Some((tag, root)) = named.filter(|(_, root)| !root.is_some_and(|root| self.is_react(root))) {
            // `this.X` is bound nowhere the module declares.
            let origin = root.map_or(TagOrigin::Nested, |root| tag_origin(self.scoping, root));
            let polymorphic = opening.attributes.iter().any(|attribute| match attribute {
                JSXAttributeItem::SpreadAttribute(_) => true,
                JSXAttributeItem::Attribute(attribute) => {
                    matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "as" || name.name == "asChild")
                }
            });
            let mut reads = ArgumentReads::default();
            let mut collector = ReadCollector { scoping: self.scoping, reads: &mut reads };
            for attribute in &opening.attributes {
                collector.visit_jsx_attribute_item(attribute);
            }
            for child in &element.children {
                collector.visit_jsx_child(child);
            }
            self.tag_calls.push((tag, origin, polymorphic, reads, self.top.clone()));
        }
        oxc::ast_visit::walk::walk_jsx_element(self, element);
    }
}


/// Module-scope bindings that may hold an object: imports, flagged when a
/// namespace import (only its members can be such an object), and the
/// module's own families, facades and aliases, flagged when a facade
/// whose top-level writes its member facts already record.
fn object_bindings(
    program: &Program<'_>,
    scoping: &Scoping,
    object_consts: &BTreeMap<&str, bool>,
    assigned_targets: &BTreeSet<&str>,
) -> FxHashMap<SymbolId, ObjectBinding> {
    use oxc::ast::ast::ImportOrExportKind;
    let mut bindings = FxHashMap::default();
    let mut add = |binding: &oxc::ast::ast::BindingIdentifier<'_>, namespace: bool| {
        if let Some(symbol) = binding.symbol_id.get() {
            let name = binding.name.to_string();
            bindings.insert(symbol, ObjectBinding { name, namespace, facade: false, targets: Vec::new() });
        }
    };
    for stmt in &program.body {
        let Statement::ImportDeclaration(import) = stmt else { continue };
        if import.import_kind == ImportOrExportKind::Type {
            continue;
        }
        for specifier in import.specifiers.iter().flatten() {
            match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                    if named.import_kind != ImportOrExportKind::Type {
                        add(&named.local, false);
                    }
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => add(&default.local, false),
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => add(&namespace.local, true),
            }
        }
    }
    for (name, &facade) in object_consts {
        if let Some(symbol) = scoping.get_root_binding((*name).into()) {
            let name = name.to_string();
            bindings.insert(symbol, ObjectBinding { name, namespace: false, facade, targets: Vec::new() });
        }
    }
    for target in assigned_targets {
        let (root, path) = target.split_once('.').map_or((*target, ""), |(root, path)| (root, path));
        if let Some(symbol) = scoping.get_root_binding(root.into()) {
            let binding = bindings.entry(symbol).or_insert_with(|| ObjectBinding {
                name: root.to_string(),
                namespace: false,
                facade: false,
                targets: Vec::new(),
            });
            binding.targets.push(path.to_string());
        }
    }
    bindings
}

/// A binding `ObjectUseScan` watches.
#[derive(Clone)]
struct ObjectBinding {
    name: String,
    namespace: bool,
    /// A facade of this module, whose top-level member writes its member
    /// facts record in order.
    facade: bool,
    /// The paths below it that an assigned facade targets (`Root` in
    /// `Object.assign(Fam.Root, …)`, empty for the binding itself): each is
    /// watched as an object of its own, apart from the facade's own
    /// initializer.
    targets: Vec<String>,
}

/// See `FileFacts::written_namespaces`.
pub type WrittenNamespaces = BTreeMap<String, (String, ObjectUse)>;

/// See `FileFacts::unsafe_object_uses`.
/// What a module's own source says may change the objects the member
/// tables follow, and the contexts it builds among them: read from its parse
/// and semantic build alone, before any static value is evaluated.
pub(crate) struct ObjectUses {
    /// See `FileFacts::context_consts`.
    pub context_consts: BTreeSet<String>,
    /// See `FileFacts::unsafe_object_uses`.
    pub unsafe_object_uses: BTreeMap<String, ObjectUse>,
    /// See `FileFacts::object_handoffs`.
    pub object_handoffs: Vec<Handoff>,
    /// See `FileFacts::written_namespaces`.
    pub written_namespaces: WrittenNamespaces,
}

/// The uses of `object_consts` and of the module's contexts that may change
/// them, through the module's one semantic build.
pub(crate) fn object_uses(
    program: &Program<'_>,
    scoping: &Scoping,
    object_consts: &BTreeMap<&str, bool>,
    assigned_targets: &BTreeSet<&str>,
) -> ObjectUses {
    let context_consts = context_consts(program, scoping, &ReactImports::of(program, scoping));
    // A context is watched as an object too: its `Provider` must stay React's.
    let mut watched = object_consts.clone();
    for context in &context_consts {
        watched.entry(context.as_str()).or_insert(false);
    }
    let (unsafe_object_uses, object_handoffs, written_namespaces) =
        unsafe_object_uses(program, scoping, &watched, assigned_targets);
    ObjectUses { context_consts, unsafe_object_uses, object_handoffs, written_namespaces }
}

fn unsafe_object_uses(
    program: &Program<'_>,
    scoping: &Scoping,
    object_consts: &BTreeMap<&str, bool>,
    assigned_targets: &BTreeSet<&str>,
) -> (BTreeMap<String, ObjectUse>, Vec<Handoff>, WrittenNamespaces) {
    scan_object_uses(program, scoping, object_bindings(program, scoping, object_consts, assigned_targets))
}

/// See `FileFacts::written_namespaces`: the module's namespace imports
/// alone, for static style values.
pub(crate) fn written_namespaces(program: &Program<'_>, scoping: &Scoping) -> WrittenNamespaces {
    let namespaces = object_bindings(program, scoping, &BTreeMap::new(), &BTreeSet::new())
        .into_iter()
        .filter(|(_, binding)| binding.namespace)
        .collect();
    scan_object_uses(program, scoping, namespaces).2
}

fn scan_object_uses(
    program: &Program<'_>,
    scoping: &Scoping,
    candidates: FxHashMap<SymbolId, ObjectBinding>,
) -> (BTreeMap<String, ObjectUse>, Vec<Handoff>, WrittenNamespaces) {
    if candidates.is_empty() {
        return (BTreeMap::new(), Vec::new(), BTreeMap::new());
    }
    if scoping.root_unresolved_references().contains_key("eval") {
        // Direct eval can reach any binding by name.
        let what = ObjectUse { line: None, what: "can be changed by a direct eval".to_string() };
        let written = candidates
            .values()
            .filter(|binding| binding.namespace)
            .map(|binding| (binding.name.clone(), (binding.name.clone(), what.clone())))
            .collect();
        return (
            candidates.into_values().map(|binding| (binding.name, what.clone())).collect(),
            Vec::new(),
            written,
        );
    }
    let mut member_consts = MemberConsts {
        scoping,
        namespaces: candidates
            .iter()
            .filter(|(_, binding)| binding.namespace)
            .map(|(symbol, binding)| (*symbol, binding.name.clone()))
            .collect(),
        exported: FxHashSet::default(),
        consts: FxHashMap::default(),
        declaring: oxc::ast::ast::VariableDeclarationKind::Var,
    };
    if !member_consts.namespaces.is_empty() {
        member_consts.visit_program(program);
    }
    let mut scan = ObjectUseScan {
        scoping,
        source: program.source_text,
        candidates,
        // A module-scope `Object` is not the global one.
        global_object: scoping.get_root_binding("Object".into()).is_none(),
        react: ReactImports::of(program, scoping),
        uses: BTreeMap::new(),
        ancestors: Vec::new(),
        style: false,
        containers: Vec::new(),
        statics: None,
        derives: Vec::new(),
        handoffs: Vec::new(),
        flat_reads: Vec::new(),
        style_uses: Vec::new(),
        member_consts: member_consts.consts,
        written_namespaces: BTreeMap::new(),
        called_functions: None,
        returns: Vec::new(),
        local_aliases: FxHashMap::default(),
        element_arrays: FxHashMap::default(),
    };
    scan.visit_program(program);
    (scan.uses, scan.handoffs, scan.written_namespaces)
}

/// Each `const` a member of a namespace import initializes (`const Icon =
/// icons[name]`, `const C = ui.Fam`), with the namespace, unless the module
/// exports it.
struct MemberConsts<'s> {
    scoping: &'s Scoping,
    namespaces: FxHashMap<SymbolId, String>,
    exported: FxHashSet<SymbolId>,
    consts: FxHashMap<SymbolId, String>,
    /// The kind of the declaration whose declarators are being visited.
    declaring: oxc::ast::ast::VariableDeclarationKind,
}

impl<'a> Visit<'a> for MemberConsts<'_> {
    fn visit_export_declaration(&mut self, export: &oxc::ast::ast::ExportDeclaration<'a>) {
        if let oxc::ast::ast::Declaration::VariableDeclaration(declaration) = &export.declaration {
            for declarator in &declaration.declarations {
                if let oxc::ast::ast::BindingPattern::BindingIdentifier(id) = &declarator.id {
                    self.exported.extend(id.symbol_id.get());
                }
            }
        }
        oxc::ast_visit::walk::walk_export_declaration(self, export);
    }

    fn visit_variable_declaration(&mut self, declaration: &oxc::ast::ast::VariableDeclaration<'a>) {
        let outer = std::mem::replace(&mut self.declaring, declaration.kind);
        oxc::ast_visit::walk::walk_variable_declaration(self, declaration);
        self.declaring = outer;
    }

    fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
        use oxc::ast::ast::{BindingPattern, VariableDeclarationKind};
        if let (VariableDeclarationKind::Const, BindingPattern::BindingIdentifier(id), Some(init)) =
            (self.declaring, &declarator.id, &declarator.init)
        {
            let object = match crate::chain_walk::unwrap_type_assertions(init) {
                Expression::ComputedMemberExpression(member) => Some(&member.object),
                Expression::StaticMemberExpression(member) => Some(&member.object),
                _ => None,
            };
            if let Some(object) = object {
                if let Expression::Identifier(object) = crate::chain_walk::unwrap_type_assertions(object) {
                    let namespace = object
                        .reference_id
                        .get()
                        .and_then(|reference| self.scoping.get_reference(reference).symbol_id())
                        .and_then(|symbol| self.namespaces.get(&symbol));
                    if let (Some(namespace), Some(symbol)) = (namespace, id.symbol_id.get()) {
                        if !self.exported.contains(&symbol) {
                            self.consts.insert(symbol, namespace.clone());
                        }
                    }
                }
            }
        }
        oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
    }
}

/// For static style values: each module-scope `const` object in
/// `object_consts`, and each import binding, with its first use that may
/// change the object or hand it to code the extractor does not follow. Unlike
/// a facade's, a use inside an Animus stage call's argument reads the object,
/// an alias is such a use, and so is a member handed on or written at any
/// depth. An object stored in another such `const` object is as stable as
/// that object.
pub(crate) fn style_object_uses(
    program: &Program<'_>,
    scoping: &Scoping,
    statics: &FxHashMap<String, StaticValue>,
) -> StyleObjectFacts {
    let mut consts: BTreeMap<&str, bool> = statics
        .iter()
        .filter(|(_, value)| matches!(value, StaticValue::Object(_)))
        .map(|(name, _)| (name.as_str(), false))
        .collect();
    // A `const` may hold an object stored in it though it has no static.
    for name in holder_consts(program) {
        consts.entry(name).or_insert(false);
    }
    let candidates = object_bindings(program, scoping, &consts, &BTreeSet::new());
    if candidates.is_empty() {
        return StyleObjectFacts::default();
    }
    if scoping.root_unresolved_references().contains_key("eval") {
        let what = ObjectUse { line: None, what: "can be changed by a direct eval".to_string() };
        let names: BTreeSet<String> = candidates.into_values().map(|binding| binding.name).collect();
        let uses = names.into_iter().map(|name| (name, what.clone(), UseAt::WHOLE)).collect();
        return StyleObjectFacts { uses, ..StyleObjectFacts::default() };
    }
    let mut scan = ObjectUseScan {
        scoping,
        source: program.source_text,
        candidates,
        global_object: !binds_anywhere(scoping, "Object"),
        react: ReactImports::of(program, scoping),
        uses: BTreeMap::new(),
        ancestors: Vec::new(),
        style: true,
        containers: Vec::new(),
        statics: Some(statics),
        derives: Vec::new(),
        handoffs: Vec::new(),
        flat_reads: Vec::new(),
        style_uses: Vec::new(),
        member_consts: FxHashMap::default(),
        written_namespaces: BTreeMap::new(),
        called_functions: Some(CalledFunctions::of(program)),
        returns: Vec::new(),
        local_aliases: FxHashMap::default(),
        element_arrays: FxHashMap::default(),
    };
    scan.visit_program(program);
    // An alias with a use the scan did not judge (one written before the
    // `const`, in a closure) hands on the member.
    for (symbol, alias) in std::mem::take(&mut scan.local_aliases) {
        let uses = scoping.get_resolved_references(symbol).filter(|reference| reference.is_value()).count();
        if alias.seen != uses {
            scan.style_uses.push((alias.binding, alias.used, UseAt::Member(alias.base)));
        }
    }
    // So does an array of members with a use the scan did not follow.
    for (symbol, array) in std::mem::take(&mut scan.element_arrays) {
        let uses = scoping.get_resolved_references(symbol).filter(|reference| reference.is_value()).count();
        if array.seen != uses {
            let members = array.base[..array.base.len() - 1].to_vec();
            scan.style_uses.push((array.binding, array.used, UseAt::AnyMember(members)));
        }
    }
    // What a function only ever called returns is held by each `const` its
    // calls initialize; any other reference hands it on.
    let holders = scan.called_functions.take().map(|called| called.holders).unwrap_or_default();
    for (binding, function, at, used) in std::mem::take(&mut scan.returns) {
        match holders.get(&function) {
            None => {}
            Some(Some(holders)) => {
                scan.containers.extend(holders.iter().map(|holder| (binding.clone(), holder.clone(), at.clone())));
            }
            Some(None) => scan.style_uses.push((binding, used, UseAt::WHOLE)),
        }
    }
    // By binding, each in source order, so a binding's first use leads; a
    // later use reaching the same place adds nothing.
    let mut uses = scan.style_uses;
    uses.sort_by(|(a, ..), (b, ..)| a.cmp(b));
    let mut seen = FxHashSet::default();
    uses.retain(|(binding, _, at)| seen.insert((binding.clone(), at.clone())));
    StyleObjectFacts {
        uses,
        stored: scan.containers,
        derives: scan.derives,
        handoffs: scan.handoffs,
        flat_reads: scan.flat_reads,
    }
}

/// The module-scope `const`s that may hold an object stored in them with
/// no static value to say so: one a call to a named binding initializes,
/// an object literal, or another binding it aliases, through erased
/// wrappers.
pub(crate) fn holder_consts<'b>(program: &'b Program<'_>) -> impl Iterator<Item = &'b str> {
    use oxc::ast::ast::{BindingPattern, Declaration, VariableDeclarationKind};
    program
        .body
        .iter()
        .filter_map(|stmt| match stmt {
            Statement::ExportDeclaration(export) => Some(&export.declaration),
            other => other.as_declaration(),
        })
        .filter_map(|declaration| match declaration {
            Declaration::VariableDeclaration(var) if var.kind == VariableDeclarationKind::Const => Some(var),
            _ => None,
        })
        .flat_map(|var| var.declarations.iter())
        .filter_map(|declarator| {
            let BindingPattern::BindingIdentifier(id) = &declarator.id else { return None };
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::CallExpression(call) if called_binding(call).is_some() => Some(id.name.as_str()),
                Expression::ObjectExpression(_) | Expression::Identifier(_) => Some(id.name.as_str()),
                _ => None,
            }
        })
}

/// Whether any scope of the module binds `name`: a local `Object` anywhere
/// makes `Object.keys` unprovable by spelling.
fn binds_anywhere(scoping: &Scoping, name: &str) -> bool {
    scoping.symbol_names().any(|symbol| symbol == name)
}

/// Whether a call's callee, by its reference, is a module-scope binding
/// nothing writes: the function the engine resolves by its name.
fn fixed_callee(scoping: &Scoping, reference: Option<oxc::semantic::ReferenceId>) -> bool {
    let Some(symbol) = reference.and_then(|id| scoping.get_reference(id).symbol_id()) else {
        return false;
    };
    scoping.symbol_scope_id(symbol) == scoping.root_scope_id()
        && !scoping.get_resolved_references(symbol).any(oxc::semantic::Reference::is_write)
}

/// What `style_object_uses` finds in one module. Instability crosses the
/// edges in the engine, once it knows each import's own.
#[derive(Debug, Default)]
pub(crate) struct StyleObjectFacts {
    /// Each unsafe use of a binding and where it reaches the object, by
    /// binding, each binding's in source order.
    pub uses: Vec<(String, ObjectUse, UseAt)>,
    /// (object, the module-scope `const` it is stored in, or its members
    /// copied into by a spread, where in the container it sits): the object
    /// changes as far below as its container does there.
    pub stored: Vec<(String, String, Vec<String>)>,
    /// (module-scope `const`, a binding its initializer reads, where in the
    /// `const` the read sits, whether the binding's object itself sits
    /// there): the `const` holds a value read from that binding there,
    /// unstable when it is.
    pub derives: Vec<(String, String, Vec<String>, bool)>,
    /// A binding passed whole to a named function: a read when that
    /// function's parameter only reads it and the binding holds no nested
    /// object, and otherwise this use.
    pub handoffs: Vec<Handoff>,
    /// (binding, use): a use that can hand out the binding's nested
    /// objects, unsafe unless its values are all primitives.
    pub flat_reads: Vec<(String, ObjectUse)>,
}

/// See `StyleObjectFacts::handoffs`.
#[derive(Debug, Clone)]
pub(crate) struct Handoff {
    pub binding: String,
    /// The member of the binding's object handed on: `[]` for the object,
    /// `ANY_MEMBER` for a computed key.
    pub at: Vec<String>,
    pub callee: String,
    /// See `Pass::calls`.
    pub calls: usize,
    pub index: usize,
    /// Passed as a member of fresh literals rather than whole.
    pub nested: bool,
    /// Where in the argument it sits (see `literal_position`).
    pub within: Vec<String>,
    /// The module-scope `const` the call initializes.
    pub holder: Option<String>,
    pub used: ObjectUse,
}

/// Where the expression at `span` sits in the object literals around it, as
/// the static keys from the outermost: the keys above a computed key or
/// another expression only. `ancestors` runs from the outermost to the
/// expression's parent.
fn literal_position(span: Span, ancestors: &[AstKind<'_>]) -> Vec<String> {
    held_position(span, ancestors).0
}

/// `literal_position`, and whether the value sits there itself, its members
/// copied by a spread or it by a property, rather than something computed
/// from it.
fn held_position(span: Span, ancestors: &[AstKind<'_>]) -> (Vec<String>, bool) {
    let mut current = span;
    let mut keys = Vec::new();
    let mut held = true;
    for kind in ancestors.iter().rev() {
        match kind {
            kind if is_erased_wrapper(kind) => {}
            AstKind::ObjectProperty(prop) if prop.value.span() == current => {
                match prop.key.static_name().filter(|_| !prop.computed) {
                    Some(key) => keys.push(key.to_string()),
                    None => {
                        keys.clear();
                        held = false;
                    }
                }
            }
            AstKind::ObjectExpression(_) | AstKind::SpreadElement(_) => {}
            _ => {
                keys.clear();
                held = false;
            }
        }
        current = kind.span();
    }
    keys.reverse();
    (keys, held)
}

/// The module-scope `const` whose initializer holds the expression at
/// `span`, and where in it the expression sits (see `held_position`).
fn initializing_const(span: Span, ancestors: &[AstKind<'_>]) -> Option<(String, (Vec<String>, bool))> {
    use oxc::ast::ast::{BindingPattern, VariableDeclarationKind};
    let at = ancestors.iter().rposition(|kind| matches!(kind, AstKind::VariableDeclarator(_)))?;
    let AstKind::VariableDeclarator(declarator) = &ancestors[at] else { return None };
    let BindingPattern::BindingIdentifier(id) = &declarator.id else { return None };
    let Some(AstKind::VariableDeclaration(declaration)) = ancestors.get(at.checked_sub(1)?) else { return None };
    let top_level = match ancestors.get(at.checked_sub(2)?) {
        Some(AstKind::Program(_)) => true,
        Some(AstKind::ExportDeclaration(_)) => matches!(ancestors.get(at.checked_sub(3)?), Some(AstKind::Program(_))),
        _ => false,
    };
    (top_level && declaration.kind == VariableDeclarationKind::Const)
        .then(|| (id.name.to_string(), held_position(span, &ancestors[at + 1..])))
}

/// Where a style-mode use reaches the object it names, as a member path
/// from it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum UseAt {
    /// The value at the path escapes; at `[]`, the object itself.
    Member(Vec<String>),
    /// The value of some member under the path, its key computed, escapes.
    AnyMember(Vec<String>),
    /// The member at the path is assigned or deleted.
    Written(Vec<String>),
    /// A member under the path, its key computed, is assigned or deleted.
    UnknownKeyWritten(Vec<String>),
}

impl UseAt {
    pub(crate) const WHOLE: UseAt = UseAt::Member(Vec::new());
}

/// How a style-mode use treats an object binding.
enum StyleUse {
    Read,
    Unsafe(String),
    /// Stored as a member of the named module-scope `const` object, or its
    /// members copied in by a spread, at the path `at` in it: either way the
    /// container holds what the object holds there.
    StoredIn { container: String, at: Vec<String> },
    /// Writes a member, or calls one with the object at the path as `this`.
    MemberEffect(UseAt, String),
    /// Hands on the value at the path: unsafe unless it is no object.
    MemberHandoff(UseAt, String),
    /// Passed as argument `index` of a call (`call`) to the function named
    /// `callee` by the reference `reference`, called `calls` times
    /// (`define()(parts)` calls it twice): whole, or as a member of fresh
    /// object and array literals (`nested`). A read when the callee is a
    /// module-scope binding nothing writes and that parameter only reads
    /// it; held by the module-scope `const` the call initializes
    /// (`holder`) when it returns it.
    Handoff {
        callee: String,
        reference: Option<oxc::semantic::ReferenceId>,
        calls: usize,
        index: usize,
        call: Span,
        nested: bool,
        /// Where in the argument the use sits (see `literal_position`).
        within: Vec<String>,
        holder: Option<String>,
        what: String,
    },
    /// A read that can hand out a nested object (a spread copy, a
    /// destructure, `Object.values` or `entries`, an `Object.assign`
    /// source): safe only while the object's values are all primitives.
    FlatRead(String),
}

/// The stage method of a stage call (`.styles(…)` and the other chain
/// methods) whose argument reads the expression at `span` through object
/// literals, spreads and member reads only, and whether that call is on a
/// chain the extractor walks: chain methods out to a terminal that
/// initializes a module-scope `const`. Anything else on the way, a call or
/// an assignment above all, is no stage read.
fn stage_argument(span: Span, ancestors: &[AstKind<'_>]) -> Option<(String, bool)> {
    let mut rest = ancestors.iter().rev();
    let mut current = span;
    loop {
        match rest.next()? {
            kind if is_erased_wrapper(kind) => current = kind.span(),
            AstKind::StaticMemberExpression(member) if member.object.span() == current => current = member.span,
            AstKind::ComputedMemberExpression(member) if member.object.span() == current => current = member.span,
            AstKind::ObjectProperty(prop)
                if prop.value.span() == current || (prop.computed && prop.key.span() == current) =>
            {
                current = prop.span;
            }
            AstKind::SpreadElement(spread) if spread.argument.span() == current => current = spread.span,
            AstKind::ObjectExpression(object) => current = object.span,
            AstKind::CallExpression(call) => {
                let Expression::StaticMemberExpression(member) = crate::chain_walk::unwrap_type_assertions(&call.callee)
                else {
                    return None;
                };
                let method = member.property.name.as_str();
                if !crate::chain_walk::CHAIN_METHODS.contains(&method)
                    || !call.arguments.iter().any(|arg| arg.span() == current)
                {
                    return None;
                }
                return Some((method.to_string(), walked_chain_call(call.span, &mut rest)));
            }
            _ => return None,
        }
    }
}

/// Whether the chain call at `span` continues through chain methods to a
/// terminal whose call initializes a module-scope `const`. `ancestors`
/// runs from the call's parent out.
fn walked_chain_call<'b, 'a: 'b>(span: Span, ancestors: &mut impl Iterator<Item = &'b AstKind<'a>>) -> bool {
    let mut current = span;
    loop {
        let (call_span, parent) = peel_wrappers(current, ancestors);
        let Some(AstKind::StaticMemberExpression(member)) = parent else { return false };
        if member.object.span() != call_span {
            return false;
        }
        let method = member.property.name.as_str();
        let Some(AstKind::CallExpression(call)) = ancestors.next() else { return false };
        if call.callee.span() != member.span {
            return false;
        }
        if crate::chain_walk::terminal_kind(method).is_some() {
            return initializes_top_level_const(call.span, ancestors);
        }
        let chain = crate::chain_walk::CHAIN_METHODS.contains(&method) || (method == "extend" && call.arguments.is_empty());
        if !chain {
            return false;
        }
        current = call.span;
    }
}

/// The module-scope `const` whose object-literal initializer holds the
/// property value or spread at `span`, through nested object literals, and
/// where in it the value sits (see `literal_position`).
fn container_const(span: Span, ancestors: &[AstKind<'_>]) -> Option<(String, Vec<String>)> {
    use oxc::ast::ast::{BindingPattern, VariableDeclarationKind};
    let mut current = span;
    for (at, kind) in ancestors.iter().enumerate().rev() {
        match kind {
            kind if is_erased_wrapper(kind) => current = kind.span(),
            AstKind::ObjectProperty(prop) if prop.value.span() == current => current = prop.span,
            AstKind::SpreadElement(spread) if spread.argument.span() == current => current = spread.span,
            AstKind::ObjectExpression(object) => current = object.span,
            AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().map(GetSpan::span) == Some(current) =>
            {
                let BindingPattern::BindingIdentifier(id) = &declarator.id else { return None };
                let mut rest = ancestors[..at].iter().rev();
                let Some(AstKind::VariableDeclaration(declaration)) = rest.next() else { return None };
                let top_level = match rest.next() {
                    Some(AstKind::Program(_)) => true,
                    Some(AstKind::ExportDeclaration(_)) => matches!(rest.next(), Some(AstKind::Program(_))),
                    _ => false,
                };
                return (top_level && declaration.kind == VariableDeclarationKind::Const)
                    .then(|| (id.name.to_string(), literal_position(span, &ancestors[at + 1..])));
            }
            _ => return None,
        }
    }
    None
}

/// A use at `span` stored as a member of fresh object and array literals
/// that are an argument of a call to a named binding: the hand-off of a
/// nested argument, said as `what` where the engine refuses it.
fn literal_argument(span: Span, ancestors: &[AstKind<'_>], what: &str) -> Option<StyleUse> {
    let mut current = span;
    for (at, kind) in ancestors.iter().enumerate().rev() {
        match kind {
            kind if is_erased_wrapper(kind) => current = kind.span(),
            AstKind::ObjectProperty(prop) if prop.value.span() == current && !prop.computed => current = prop.span,
            AstKind::ObjectExpression(object) => current = object.span,
            AstKind::ArrayExpression(array)
                if array.elements.iter().any(|element| element.span() == current && !element.is_spread()) =>
            {
                current = array.span;
            }
            AstKind::CallExpression(call) if call.callee.span() != current => {
                let index = call.arguments.iter().position(|argument| argument.span() == current)?;
                let (callee, calls) = called_binding(call)?;
                return Some(StyleUse::Handoff {
                    callee: callee.name.to_string(),
                    reference: callee.reference_id.get(),
                    calls,
                    index,
                    call: call.span,
                    nested: true,
                    within: literal_position(span, &ancestors[at + 1..]),
                    holder: holder_const(call.span, ancestors[..at].iter().rev()),
                    what: what.to_string(),
                });
            }
            _ => return None,
        }
    }
    None
}

/// The binding a call calls, and how many calls deep: `define(x)` calls
/// `define` once, `define()(x)` twice, through erased wrappers.
fn called_binding<'b, 'a>(call: &'b oxc::ast::ast::CallExpression<'a>) -> Option<(&'b IdentifierReference<'a>, usize)> {
    let mut callee = call.callee.get_inner_expression();
    let mut calls = 1;
    loop {
        match callee {
            Expression::Identifier(id) => return Some((id, calls)),
            Expression::CallExpression(inner) if calls < 5 => {
                callee = inner.callee.get_inner_expression();
                calls += 1;
            }
            _ => return None,
        }
    }
}

/// The module-scope `const` whose initializer is the expression at
/// `span`, through erased wrappers. `ancestors` runs from its parent out.
fn holder_const<'b, 'a: 'b>(span: Span, mut ancestors: impl Iterator<Item = &'b AstKind<'a>>) -> Option<String> {
    use oxc::ast::ast::{BindingPattern, VariableDeclarationKind};
    let (current, parent) = peel_wrappers(span, &mut ancestors);
    let Some(AstKind::VariableDeclarator(declarator)) = parent else { return None };
    if declarator.init.as_ref().map(GetSpan::span) != Some(current) {
        return None;
    }
    let BindingPattern::BindingIdentifier(id) = &declarator.id else { return None };
    let Some(AstKind::VariableDeclaration(declaration)) = ancestors.next() else { return None };
    let top_level = match ancestors.next() {
        Some(AstKind::Program(_)) => true,
        Some(AstKind::ExportDeclaration(_)) => matches!(ancestors.next(), Some(AstKind::Program(_))),
        _ => false,
    };
    (top_level && declaration.kind == VariableDeclarationKind::Const).then(|| id.name.to_string())
}

/// What a call of one of the global `Object`'s readers does with its first
/// argument.
enum ObjectReader {
    /// `Object.keys`, `Object.hasOwn` and `Object.freeze`: reads only its
    /// keys, or freezes it.
    Keys,
    /// `Object.values` and `Object.entries`: hands out its values.
    Values(&'static str),
}

fn object_reader(call: &oxc::ast::ast::CallExpression<'_>, global_object: bool) -> Option<ObjectReader> {
    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else { return None };
    if !global_object || !member.object.is_specific_id("Object") {
        return None;
    }
    match member.property.name.as_str() {
        "keys" | "hasOwn" | "freeze" => Some(ObjectReader::Keys),
        "values" => Some(ObjectReader::Values("values")),
        "entries" => Some(ObjectReader::Values("entries")),
        _ => None,
    }
}

/// See `style_object_uses`: what a use of an object binding at `span` does.
fn style_object_use(
    span: Span,
    ancestors: &[AstKind<'_>],
    containers: &FxHashSet<String>,
    global_object: bool,
) -> StyleUse {
    if let Some((method, walked)) = stage_argument(span, ancestors) {
        return if walked {
            StyleUse::Read
        } else {
            StyleUse::Unsafe(format!("is passed to .{method}() on a chain the extractor does not walk"))
        };
    }
    let mut rest = ancestors.iter().rev();
    let (current, parent) = peel_wrappers(span, &mut rest);
    match parent {
        Some(AstKind::VariableDeclarator(declarator))
            if declarator.init.as_ref().map(GetSpan::span) == Some(current) =>
        {
            if matches!(declarator.id, oxc::ast::ast::BindingPattern::ObjectPattern(_)) {
                StyleUse::FlatRead("is destructured".to_string())
            } else {
                // A module-scope `const` alias holds the object whole: its
                // own uses are judged, and any change through it reaches
                // the object.
                match holder_const(span, ancestors.iter().rev()) {
                    Some(alias) if containers.contains(&alias) => StyleUse::StoredIn { container: alias, at: Vec::new() },
                    _ => StyleUse::Unsafe("is aliased by another binding".to_string()),
                }
            }
        }
        // A destructuring assignment reads members, then yields the object.
        Some(AstKind::AssignmentExpression(assignment))
            if assignment.right.span() == current
                && matches!(assignment.left, oxc::ast::ast::AssignmentTarget::ObjectAssignmentTarget(_)) =>
        {
            match object_use(assignment.span, rest, false, global_object, false) {
                Some(what) => StyleUse::Unsafe(what),
                None => StyleUse::FlatRead("is destructured".to_string()),
            }
        }
        // A copy kept in a module-scope `const` object is as stable as it.
        Some(AstKind::SpreadElement(spread)) if spread.argument.span() == current => match rest.next() {
            Some(AstKind::ObjectExpression(_)) => match container_const(span, ancestors) {
                Some((container, at)) if containers.contains(&container) => {
                    StyleUse::StoredIn { container, at }
                }
                _ => StyleUse::FlatRead("is spread into a copy".to_string()),
            },
            _ => StyleUse::Unsafe("is spread into a call or an array".to_string()),
        },
        Some(AstKind::JSXSpreadAttribute(_)) => StyleUse::FlatRead("is spread into props".to_string()),
        Some(AstKind::ObjectProperty(prop)) if prop.value.span() == current => {
            match container_const(span, ancestors) {
                Some((container, at)) if containers.contains(&container) => {
                    StyleUse::StoredIn { container, at }
                }
                _ => literal_argument(span, ancestors, "is stored in an object")
                    .unwrap_or_else(|| StyleUse::Unsafe("is stored in an object".to_string())),
            }
        }
        Some(AstKind::ArrayExpression(_)) => literal_argument(span, ancestors, "is stored in an array")
            .unwrap_or_else(|| StyleUse::Unsafe("is stored in an array".to_string())),
        Some(AstKind::StaticMemberExpression(_) | AstKind::ComputedMemberExpression(_)) => {
            // Out through the member chain: a write or hand-off at any depth.
            // `path` holds the static keys up to the first computed one.
            let mut outer = current;
            let mut name = String::new();
            let mut path: Vec<String> = Vec::new();
            let mut computed: Option<usize> = None;
            let mut depth = 0;
            let mut parent = parent;
            loop {
                match parent {
                    Some(AstKind::StaticMemberExpression(member)) if member.object.span() == outer => {
                        name = member.property.name.to_string();
                        if computed.is_none() {
                            path.push(name.clone());
                        }
                    }
                    Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == outer => {
                        name = "a computed member".to_string();
                        computed.get_or_insert(depth);
                    }
                    _ => break,
                }
                depth += 1;
                let member_span = parent.map(GetSpan::span).unwrap_or(outer);
                if let Some(effect) = member_effect(member_span, rest.clone()) {
                    let what = member_use(&format!("its member {name}"), member_span, rest.clone())
                        .expect("an effect is said");
                    // The member written, or the holder a method gets as
                    // `this`; past a computed key, some member's value.
                    let last = computed == Some(depth - 1);
                    let at = match (effect, computed) {
                        (MemberEffect::Assigned | MemberEffect::Deleted, None) => UseAt::Written(path),
                        (MemberEffect::Assigned | MemberEffect::Deleted, Some(_)) if last => {
                            UseAt::UnknownKeyWritten(path)
                        }
                        (MemberEffect::Method, None) => UseAt::Member(path[..path.len() - 1].to_vec()),
                        (MemberEffect::Method, Some(_)) if last => UseAt::Member(path),
                        (_, Some(_)) => UseAt::AnyMember(path),
                    };
                    return StyleUse::MemberEffect(at, what);
                }
                let (next_outer, next_parent) = peel_wrappers(member_span, &mut rest);
                outer = next_outer;
                parent = next_parent;
            }
            let handed = match computed {
                None => UseAt::Member(path),
                Some(_) => UseAt::AnyMember(path),
            };
            match parent {
                // The global `Object`'s readers: keys only read the member;
                // values and entries hand out the member's own values.
                Some(AstKind::CallExpression(call))
                    if call.callee.span() != outer
                        && call.arguments.first().map(GetSpan::span) == Some(outer)
                        && object_reader(call, global_object).is_some() =>
                {
                    match object_reader(call, global_object) {
                        Some(ObjectReader::Values(method)) => {
                            let below = match handed {
                                UseAt::Member(path) | UseAt::AnyMember(path) => UseAt::AnyMember(path),
                                other => other,
                            };
                            StyleUse::MemberHandoff(below, format!("has its member {name} read by Object.{method}()"))
                        }
                        _ => StyleUse::Read,
                    }
                }
                Some(AstKind::CallExpression(call)) if call.callee.span() != outer => {
                    StyleUse::MemberHandoff(handed, format!("has its member {name} passed to a call"))
                }
                Some(AstKind::VariableDeclarator(declarator))
                    if declarator.init.as_ref().map(GetSpan::span) == Some(outer) =>
                {
                    StyleUse::MemberHandoff(handed, format!("has its member {name} assigned to a variable"))
                }
                Some(AstKind::AssignmentExpression(assignment)) if assignment.right.span() == outer => {
                    StyleUse::MemberHandoff(handed, format!("has its member {name} assigned to a variable"))
                }
                Some(AstKind::ObjectProperty(_) | AstKind::ArrayExpression(_)) => {
                    StyleUse::MemberHandoff(handed, format!("has its member {name} stored in an object"))
                }
                // A concise arrow body is the arrow's return value, which
                // the call hands on (`() => pad.inner`).
                Some(AstKind::ArrowFunctionExpression(_)) => {
                    StyleUse::MemberHandoff(handed, format!("has its member {name} returned from a function"))
                }
                // A value only compared, combined, tested or discarded.
                Some(
                    AstKind::BinaryExpression(_)
                    | AstKind::UnaryExpression(_)
                    | AstKind::TemplateLiteral(_)
                    | AstKind::ExpressionStatement(_),
                ) => StyleUse::Read,
                Some(AstKind::ConditionalExpression(conditional)) if conditional.test.span() == outer => StyleUse::Read,
                Some(AstKind::IfStatement(statement)) if statement.test.span() == outer => StyleUse::Read,
                // Either operand can be a logical expression's value: a read
                // where that value is itself only tested.
                Some(AstKind::LogicalExpression(logical)) if only_tested(logical.span, &mut rest.clone()) => {
                    StyleUse::Read
                }
                _ => StyleUse::MemberHandoff(
                    handed,
                    format!("has its member {name} used where the extractor does not follow it"),
                ),
            }
        }
        Some(AstKind::CallExpression(call)) if call.callee.span() != current => {
            let index = call.arguments.iter().position(|arg| arg.span() == current);
            if let (Some((callee, calls)), Some(index)) = (called_binding(call), index) {
                let what = format!("is passed to {}{}", callee.name, "()".repeat(calls));
                return StyleUse::Handoff {
                    callee: callee.name.to_string(),
                    reference: callee.reference_id.get(),
                    calls,
                    index,
                    call: call.span,
                    nested: false,
                    within: Vec::new(),
                    holder: holder_const(call.span, rest),
                    what,
                };
            }
            match (crate::chain_walk::unwrap_type_assertions(&call.callee), index) {
                // The global `Object`'s readers: keys only read; values,
                // entries and an assign source hand out the object's values.
                (Expression::StaticMemberExpression(member), Some(index))
                    if global_object && member.object.is_specific_id("Object") =>
                {
                    match member.property.name.as_str() {
                        "keys" | "freeze" => StyleUse::Read,
                        // Membership reads only the object's own keys.
                        "hasOwn" if index == 0 => StyleUse::Read,
                        "values" | "entries" => {
                            StyleUse::FlatRead(format!("is read by Object.{}()", member.property.name))
                        }
                        "assign" if index > 0 => StyleUse::FlatRead("is an Object.assign() source".to_string()),
                        _ => match object_use(span, ancestors.iter().rev(), true, global_object, false) {
                            Some(what) => StyleUse::Unsafe(what),
                            None => StyleUse::Read,
                        },
                    }
                }
                _ => match object_use(span, ancestors.iter().rev(), true, global_object, false) {
                    Some(what) => StyleUse::Unsafe(what),
                    None => StyleUse::Read,
                },
            }
        }
        _ => match object_use(span, ancestors.iter().rev(), true, global_object, false) {
            Some(what) => StyleUse::Unsafe(what),
            None => StyleUse::Read,
        },
    }
}

/// How a module runs code from a string, which can load any module: it
/// reads the unbound `eval` or `Function` as a value, so any call, alias or
/// `Reflect.construct` of it counts, or reads either as a member of the
/// unbound global object (`globalThis.eval`, `window.Function`). A type
/// query, and the bare name as a `typeof` operand or the right side of
/// `instanceof`, run nothing. Not followed: a computed member
/// (`globalThis['ev' + 'al']`) and an alias of the global object.
pub(crate) fn dynamic_code(program: &oxc::ast::ast::Program<'_>, scoping: &oxc::semantic::Scoping) -> Option<&'static str> {
    use oxc::ast::ast::{BinaryExpression, Expression, IdentifierReference, StaticMemberExpression, UnaryExpression};
    use oxc::ast_visit::Visit;
    use oxc::syntax::operator::{BinaryOperator, UnaryOperator};
    const RUNNERS: [&str; 2] = ["eval", "Function"];
    const GLOBAL_OBJECTS: [&str; 4] = ["globalThis", "window", "self", "global"];
    struct Reads<'s> {
        scoping: &'s oxc::semantic::Scoping,
        found: Option<&'static str>,
    }
    impl Reads<'_> {
        fn unbound(&self, id: &IdentifierReference<'_>) -> bool {
            id.reference_id.get().is_some_and(|id| self.scoping.get_reference(id).symbol_id().is_none())
        }
        /// The bare unbound `eval` or `Function`, which `typeof` and
        /// `instanceof` only inspect.
        fn bare_runner(&self, expr: &Expression<'_>) -> bool {
            matches!(expr.get_inner_expression(), Expression::Identifier(id)
                if RUNNERS.contains(&id.name.as_str()) && self.unbound(id))
        }
        fn record(&mut self, name: &str) {
            self.found.get_or_insert(if name == "eval" { "reads eval" } else { "reads Function" });
        }
    }
    impl<'a> Visit<'a> for Reads<'_> {
        fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
            let value = id.reference_id.get().is_some_and(|id| self.scoping.get_reference(id).is_value());
            if value && RUNNERS.contains(&id.name.as_str()) && self.unbound(id) {
                self.record(&id.name);
            }
        }
        fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
            let global = matches!(member.object.get_inner_expression(), Expression::Identifier(object)
                if GLOBAL_OBJECTS.contains(&object.name.as_str()) && self.unbound(object));
            if global && RUNNERS.contains(&member.property.name.as_str()) {
                self.record(&member.property.name);
            }
            oxc::ast_visit::walk::walk_static_member_expression(self, member);
        }
        fn visit_unary_expression(&mut self, unary: &UnaryExpression<'a>) {
            if unary.operator == UnaryOperator::Typeof && self.bare_runner(&unary.argument) {
                return;
            }
            oxc::ast_visit::walk::walk_unary_expression(self, unary);
        }
        fn visit_binary_expression(&mut self, binary: &BinaryExpression<'a>) {
            if binary.operator == BinaryOperator::Instanceof && self.bare_runner(&binary.right) {
                self.visit_expression(&binary.left);
                return;
            }
            oxc::ast_visit::walk::walk_binary_expression(self, binary);
        }
    }
    let mut reads = Reads { scoping, found: None };
    reads.visit_program(program);
    reads.found
}

/// How a module lets a loader escape, which can load any module. The
/// loaders are the unbound `require` and `module`, the `module` builtin
/// (`node:module`) as imported or required, and anything named
/// `createRequire`; an ambient declaration (`declare const require: any`)
/// binds nothing. A loader escapes when read anywhere but as a `typeof`
/// operand, `require` as a direct callee (`require(…)`, `require.context(…)`,
/// `require.resolve(…)`), or `module` or the builtin through a constant
/// member that loads nothing (`module.exports`, `builtinModules`), so an
/// alias, `(0, require)(…)`, `require.call(…)`, `module.require(…)` and a
/// computed member all count, as does `require` read from the unbound global
/// object. Not followed: other routes to a loader through the global object
/// (`globalThis.module`) or `process` (`process.mainModule`).
pub(crate) fn loader_escape(program: &oxc::ast::ast::Program<'_>, scoping: &oxc::semantic::Scoping) -> Option<&'static str> {
    use oxc::ast::ast::{
        Argument, BindingPattern, BindingProperty, CallExpression, ComputedMemberExpression, ExportAllDeclaration,
        ExportFromDeclaration, Expression, IdentifierReference, ImportDeclaration, ImportDeclarationSpecifier,
        ImportExpression, ModuleExportName, StaticMemberExpression, TSImportEqualsDeclaration, TSModuleReference,
        UnaryExpression, VariableDeclarator,
    };
    use oxc::syntax::operator::UnaryOperator;
    const GLOBAL_OBJECTS: [&str; 4] = ["globalThis", "window", "self", "global"];
    const BUILTINS: [&str; 2] = ["module", "node:module"];
    /// Members of the unbound `module` that load nothing.
    const MODULE_MEMBERS: [&str; 6] = ["exports", "id", "filename", "loaded", "path", "paths"];
    /// Exports of the `module` builtin that load nothing.
    const BUILTIN_MEMBERS: [&str; 5] = ["builtinModules", "isBuiltin", "findSourceMap", "SourceMap", "findPackageJSON"];
    const REQUIRE: &str = "hands on require other than as a direct call";
    const MODULE: &str = "reads module other than through a member that loads nothing";
    const BUILTIN: &str = "reads node:module other than through a member that loads nothing";
    const CREATE: &str = "reads createRequire";
    fn is_require(expr: &Expression<'_>) -> bool {
        matches!(expr.get_inner_expression(), Expression::Identifier(id) if id.name == "require")
    }
    /// `require('module')` or `require('node:module')`.
    fn requires_builtin(call: &CallExpression<'_>) -> bool {
        is_require(&call.callee) && call.arguments.first().and_then(Argument::as_expression).is_some_and(builtin_specifier)
    }
    /// A constant specifier of the builtin, read as a load reads it.
    fn builtin_specifier(specifier: &Expression<'_>) -> bool {
        matches!(crate::loads::load_of(specifier), crate::loads::LoadTarget::Specifier(name) if BUILTINS.contains(&name.as_str()))
    }
    /// A declarator that binds the required builtin to one name, whose reads
    /// are then judged as the builtin's.
    fn binds_builtin(declarator: &VariableDeclarator<'_>) -> bool {
        let init = declarator.init.as_ref().map(Expression::get_inner_expression);
        matches!(declarator.id, BindingPattern::BindingIdentifier(_))
            && matches!(init, Some(Expression::CallExpression(call)) if requires_builtin(call))
    }
    /// The names bound to the builtin as a whole.
    #[derive(Default)]
    struct Builtins(FxHashSet<SymbolId>);
    impl<'a> Visit<'a> for Builtins {
        fn visit_import_declaration(&mut self, import: &ImportDeclaration<'a>) {
            if BUILTINS.contains(&import.source.value.as_str()) {
                for specifier in import.specifiers.iter().flatten() {
                    match specifier {
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                            self.0.extend(default.local.symbol_id.get())
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                            self.0.extend(namespace.local.symbol_id.get())
                        }
                        ImportDeclarationSpecifier::ImportSpecifier(_) => {}
                    }
                }
            }
        }
        fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
            if let (true, BindingPattern::BindingIdentifier(id)) = (binds_builtin(declarator), &declarator.id) {
                self.0.extend(id.symbol_id.get());
            }
            oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
        }
        fn visit_ts_import_equals_declaration(&mut self, import: &TSImportEqualsDeclaration<'a>) {
            if let TSModuleReference::ExternalModuleReference(external) = &import.module_reference {
                if BUILTINS.contains(&external.expression.value.as_str()) {
                    self.0.extend(import.id.symbol_id.get());
                }
            }
        }
    }
    #[derive(Clone, Copy, PartialEq)]
    enum Loader {
        Module,
        Builtin,
    }
    struct Uses<'s> {
        scoping: &'s oxc::semantic::Scoping,
        builtins: FxHashSet<SymbolId>,
        found: Option<&'static str>,
    }
    impl Uses<'_> {
        /// Bound by nothing, or only by an ambient declaration.
        fn unbound(&self, id: &IdentifierReference<'_>) -> bool {
            let symbol = |id| self.scoping.get_reference(id).symbol_id();
            id.reference_id.get().is_some_and(|id| symbol(id).is_none_or(|symbol| self.scoping.symbol_flags(symbol).is_ambient()))
        }
        fn names_builtin(&self, id: &IdentifierReference<'_>) -> bool {
            id.reference_id
                .get()
                .and_then(|id| self.scoping.get_reference(id).symbol_id())
                .is_some_and(|symbol| self.builtins.contains(&symbol))
        }
        /// The loader `expr` is, if one whose members are judged.
        fn loader(&self, expr: &Expression<'_>) -> Option<Loader> {
            match expr.get_inner_expression() {
                Expression::Identifier(id) if id.name == "module" && self.unbound(id) => Some(Loader::Module),
                Expression::Identifier(id) if self.names_builtin(id) => Some(Loader::Builtin),
                Expression::CallExpression(call) if requires_builtin(call) => Some(Loader::Builtin),
                _ => None,
            }
        }
        fn loads_nothing(loader: Loader, name: &str) -> bool {
            match loader {
                Loader::Module => MODULE_MEMBERS.contains(&name),
                Loader::Builtin => BUILTIN_MEMBERS.contains(&name),
            }
        }
        /// `require`, `require.context` or `require.resolve`, which a call
        /// uses only to load or name a module.
        fn direct_loader(callee: &Expression<'_>) -> bool {
            is_require(callee)
                || callee.get_inner_expression().as_member_expression().is_some_and(|member| {
                    matches!(member.static_property_name(), Some("context" | "resolve")) && is_require(member.object())
                })
        }
        /// Judges the constant member `name` of `object`, true when the read
        /// of `object` loads nothing and needs no visit.
        fn member(&mut self, object: &Expression<'_>, name: &str) -> bool {
            if name == "createRequire" {
                self.found.get_or_insert(CREATE);
            }
            if name == "require" {
                if let Expression::Identifier(id) = object.get_inner_expression() {
                    if GLOBAL_OBJECTS.contains(&id.name.as_str()) && self.unbound(id) {
                        self.found.get_or_insert("reads require from the global object");
                    }
                }
            }
            self.loader(object).is_some_and(|loader| Self::loads_nothing(loader, name))
        }
    }
    impl<'a> Visit<'a> for Uses<'_> {
        fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
            let value = id.reference_id.get().is_some_and(|id| self.scoping.get_reference(id).is_value());
            if !value {
                return;
            }
            if id.name == "require" && self.unbound(id) {
                self.found.get_or_insert(REQUIRE);
            } else if id.name == "module" && self.unbound(id) {
                self.found.get_or_insert(MODULE);
            } else if self.names_builtin(id) {
                self.found.get_or_insert(BUILTIN);
            }
        }
        fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
            if !Self::direct_loader(&call.callee) {
                oxc::ast_visit::walk::walk_call_expression(self, call);
                return;
            }
            // The builtin required where no constant member or binding of
            // it is judged.
            if requires_builtin(call) {
                self.found.get_or_insert(BUILTIN);
            }
            for argument in &call.arguments {
                self.visit_argument(argument);
            }
        }
        fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
            if builtin_specifier(&import.source) {
                self.found.get_or_insert(BUILTIN);
            }
            oxc::ast_visit::walk::walk_import_expression(self, import);
        }
        fn visit_unary_expression(&mut self, unary: &UnaryExpression<'a>) {
            let bare = matches!(unary.argument.get_inner_expression(), Expression::Identifier(_));
            if unary.operator == UnaryOperator::Typeof && bare {
                return;
            }
            oxc::ast_visit::walk::walk_unary_expression(self, unary);
        }
        fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
            if !self.member(&member.object, &member.property.name) {
                self.visit_expression(&member.object);
            }
        }
        fn visit_computed_member_expression(&mut self, member: &ComputedMemberExpression<'a>) {
            if member.static_property_name().is_none_or(|name| !self.member(&member.object, &name)) {
                oxc::ast_visit::walk::walk_computed_member_expression(self, member);
            }
        }
        fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
            if binds_builtin(declarator) {
                return;
            }
            oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
        }
        fn visit_import_declaration(&mut self, import: &ImportDeclaration<'a>) {
            let builtin = BUILTINS.contains(&import.source.value.as_str()) && !import.import_kind.is_type();
            let loads = |specifier: &ImportDeclarationSpecifier<'_>| match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                    !named.import_kind.is_type() && !BUILTIN_MEMBERS.contains(&named.imported.name().as_str())
                }
                _ => false,
            };
            oxc::ast_visit::walk::walk_import_declaration(self, import);
            if builtin && import.specifiers.iter().flatten().any(loads) {
                self.found.get_or_insert(BUILTIN);
            }
        }
        fn visit_export_all_declaration(&mut self, export: &ExportAllDeclaration<'a>) {
            if BUILTINS.contains(&export.source.value.as_str()) && !export.export_kind.is_type() {
                self.found.get_or_insert(BUILTIN);
            }
            oxc::ast_visit::walk::walk_export_all_declaration(self, export);
        }
        fn visit_export_from_declaration(&mut self, export: &ExportFromDeclaration<'a>) {
            let builtin = BUILTINS.contains(&export.source.value.as_str());
            let loads = |specifier: &oxc::ast::ast::ExportSpecifier<'_>| !BUILTIN_MEMBERS.contains(&specifier.local.name().as_str());
            if builtin && export.specifiers.iter().any(loads) {
                self.found.get_or_insert(BUILTIN);
            }
            oxc::ast_visit::walk::walk_export_from_declaration(self, export);
        }
        fn visit_binding_property(&mut self, property: &BindingProperty<'a>) {
            if property.key.static_name().is_some_and(|name| name == "createRequire") {
                self.found.get_or_insert(CREATE);
            }
            oxc::ast_visit::walk::walk_binding_property(self, property);
        }
        fn visit_module_export_name(&mut self, name: &ModuleExportName<'a>) {
            if name.name() == "createRequire" {
                self.found.get_or_insert(CREATE);
            }
            oxc::ast_visit::walk::walk_module_export_name(self, name);
        }
    }
    let mut builtins = Builtins::default();
    builtins.visit_program(program);
    let mut uses = Uses { scoping, builtins: builtins.0, found: None };
    uses.visit_program(program);
    uses.found
}

/// One module's functions, each with how its parameters treat an object.
pub(crate) type ParamReadings = std::sync::Arc<BTreeMap<String, Vec<ParamReading>>>;
/// A module's function readings.
pub(crate) type ReadingsOf<'r> = dyn FnMut(&str) -> ParamReadings + 'r;
/// The declaring module and local name a module's binding names.
pub(crate) type Declared<'d> = dyn Fn(&str, &str) -> Option<(String, String)> + 'd;

/// Whether the function `function` of `file` only reads the object passed
/// as its parameter `index`. A reading is conditional on the callees it
/// passes the object to: each must itself only read it, at most four calls
/// deep, past which nothing is proven.
pub(crate) fn reads_only(
    file: &str,
    function: &str,
    index: usize,
    depth: usize,
    declared: &Declared<'_>,
    readings_of: &mut ReadingsOf<'_>,
) -> bool {
    handed_on(file, function, index, depth, declared, readings_of).is_some()
}

/// The member paths of the object passed as parameter `index` that the
/// function `function` of `file` hands on, itself or through the callees it
/// passes the object to, when it otherwise only reads it (see
/// `reads_only`); `ANY_MEMBER` stands for every member.
pub(crate) fn handed_on(
    file: &str,
    function: &str,
    index: usize,
    depth: usize,
    declared: &Declared<'_>,
    readings_of: &mut ReadingsOf<'_>,
) -> Option<Vec<Vec<String>>> {
    if depth > 4 {
        return None;
    }
    let readings = readings_of(file);
    let Some(ParamReading::ReadOnly(passes, handed)) = readings.get(function).and_then(|params| params.get(index)) else {
        return None;
    };
    let mut all = handed.clone();
    for pass in passes {
        let (callee_file, callee_name) = declared(file, &pass.callee)?;
        all.extend(handed_on(&callee_file, &pass.function(&callee_name), pass.index, depth + 1, declared, readings_of)?);
    }
    Some(all)
}

/// Where a call of the function `function` of `file` holds the object
/// passed as its parameter `index`, when it returns it, or a fresh object
/// holding it, and does nothing else to it but read it: each path in the
/// call's result that holds the object. Each callee whose result the
/// function returns with the object passed on must return it in turn, at
/// most four calls deep.
pub(crate) fn alias_positions(
    file: &str,
    function: &str,
    index: usize,
    depth: usize,
    declared: &Declared<'_>,
    readings_of: &mut ReadingsOf<'_>,
) -> Option<Vec<Vec<String>>> {
    if depth > 4 {
        return None;
    }
    let readings = readings_of(file);
    let Some(ParamReading::Alias { returned, through }) = readings.get(function).and_then(|params| params.get(index)) else {
        return None;
    };
    let mut positions = returned.clone();
    for (pass, at) in through {
        let (callee_file, callee_name) = declared(file, &pass.callee)?;
        let inner = alias_positions(&callee_file, &pass.function(&callee_name), pass.index, depth + 1, declared, readings_of)?;
        positions.extend(inner.into_iter().map(|inner| {
            at.iter().chain(&inner).cloned().collect()
        }));
    }
    Some(positions)
}

/// How a function treats the object passed as one of its parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ParamReading {
    /// Only read in the body, and passed on only to these callees, which
    /// must read it only too; the member paths it hands on (`ANY_MEMBER`
    /// for every member).
    ReadOnly(Vec<Pass>, Vec<Vec<String>>),
    /// Returned, or stored in a fresh object or array the function returns,
    /// and otherwise only read: the call's result holds it, at each path in
    /// `returned`. Passed on only to the callees in `through`, whose results
    /// the function returns at each path given, which must return it in
    /// turn.
    Alias { returned: Vec<Vec<String>>, through: Vec<(Pass, Vec<String>)> },
    /// A use that may change the object or hand it to code not followed.
    Unsafe,
}

/// A parameter passed on as argument `index` to the module-scope binding
/// `callee`, called `calls` times: once for the function it names, more for
/// the function each call returns (`define()(parts)`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Pass {
    pub callee: String,
    pub calls: usize,
    pub index: usize,
}

impl Pass {
    /// The readings key of the function the pass calls, `name` being the
    /// callee's declared name.
    pub(crate) fn function(&self, name: &str) -> String {
        returned_function(name, self.calls - 1)
    }
}

/// The readings key of the function a call of `name` returns `depth`
/// times over: `name` itself at no depth, `name()` for the function its
/// call returns.
pub(crate) fn returned_function(name: &str, depth: usize) -> String {
    format!("{name}{}", "()".repeat(depth))
}

/// For each module-scope function (a declaration, or a `const` arrow or
/// function expression), how each parameter treats its object: see
/// `ParamReading`. So too for the function a call of one returns as its only
/// result (`() => (parts) => parts`), keyed `name()`, at most four calls
/// deep. A destructuring, rest, default or other pattern counts as unsafe,
/// and so does every parameter of a function something reassigns.
pub(crate) fn function_param_readings(
    program: &Program<'_>,
    scoping: &Scoping,
) -> BTreeMap<String, Vec<ParamReading>> {
    use oxc::ast::ast::{BindingPattern, Declaration, ExportDefaultDeclarationKind};
    // A function with no body (an ambient `declare function` or an overload
    // signature) may do anything with its arguments.
    fn add<'b, 'a>(functions: &mut Vec<(String, String, FunctionParts<'b, 'a>)>, name: &str, function: FunctionParts<'b, 'a>) {
        let mut next = Some(function);
        let mut depth = 0;
        while let Some(function) = next.take() {
            next = function.returned().filter(|_| depth < 4);
            functions.push((name.to_string(), returned_function(name, depth), function));
            depth += 1;
        }
    }
    let mut functions = Vec::new();
    for stmt in &program.body {
        let declaration = match stmt {
            Statement::ExportDeclaration(export) => Some(&export.declaration),
            Statement::ExportDefaultDeclaration(export) => {
                if let ExportDefaultDeclarationKind::FunctionDeclaration(func) = &export.declaration {
                    if let Some(id) = &func.id {
                        add(&mut functions, &id.name, FunctionParts::of_function(func));
                    }
                }
                None
            }
            other => other.as_declaration(),
        };
        match declaration {
            Some(Declaration::FunctionDeclaration(func)) => {
                if let Some(id) = &func.id {
                    add(&mut functions, &id.name, FunctionParts::of_function(func));
                }
            }
            Some(Declaration::VariableDeclaration(var)) if var.kind == oxc::ast::ast::VariableDeclarationKind::Const => {
                for declarator in &var.declarations {
                    let BindingPattern::BindingIdentifier(id) = &declarator.id else { continue };
                    if let Some(function) = declarator.init.as_ref().and_then(FunctionParts::of_expression) {
                        add(&mut functions, &id.name, function);
                    }
                }
            }
            _ => {}
        }
    }
    let mut readings: BTreeMap<String, Vec<ParamReading>> = BTreeMap::new();
    let mut params: FxHashMap<SymbolId, (String, usize)> = FxHashMap::default();
    let mut spans: FxHashMap<String, Span> = FxHashMap::default();
    for (name, key, function) in &functions {
        let formal = function.params;
        if function.body.is_none() && function.concise.is_none() {
            // An overload signature never overrides its implementation.
            readings
                .entry(key.clone())
                .or_insert_with(|| vec![ParamReading::Unsafe; formal.items.len() + 1]);
            continue;
        }
        let mut reading = Vec::new();
        for (index, param) in formal.items.iter().enumerate() {
            match &param.pattern {
                BindingPattern::BindingIdentifier(id) => {
                    if let Some(symbol) = id.symbol_id.get() {
                        params.insert(symbol, (key.clone(), index));
                    }
                    reading.push(ParamReading::ReadOnly(Vec::new(), Vec::new()));
                }
                _ => reading.push(ParamReading::Unsafe),
            }
        }
        if formal.rest.is_some() {
            reading.push(ParamReading::Unsafe);
        }
        // A function that reads its own `arguments` object reaches every
        // argument past its parameters.
        let reassigned = scoping
            .get_root_binding(name.as_str().into())
            .is_some_and(|symbol| scoping.get_resolved_references(symbol).any(oxc::semantic::Reference::is_write));
        if reassigned || function.body.is_some_and(|body| !function.arrow && reads_own_arguments(body, scoping)) {
            reading.iter_mut().for_each(|param| *param = ParamReading::Unsafe);
        }
        spans.insert(key.clone(), function.span);
        readings.insert(key.clone(), reading);
    }
    if params.is_empty() {
        return readings;
    }
    if scoping.root_unresolved_references().contains_key("eval") {
        for reading in readings.values_mut() {
            reading.iter_mut().for_each(|param| *param = ParamReading::Unsafe);
        }
        return readings;
    }
    let mut scan = ParamScan {
        scoping,
        params,
        spans,
        readings,
        uses: FxHashMap::default(),
        ancestors: Vec::new(),
        global_object: !binds_anywhere(scoping, "Object"),
    };
    scan.visit_program(program);
    scan.finish()
}

/// A function's parameters, body and span, written as a declaration or an
/// expression.
struct FunctionParts<'b, 'a> {
    params: &'b oxc::ast::ast::FormalParameters<'a>,
    /// A block body; a function has none when it is only a signature.
    body: Option<&'b oxc::ast::ast::FunctionBody<'a>>,
    /// An arrow, whose result is `concise` when it has no block body.
    arrow: bool,
    concise: Option<&'b Expression<'a>>,
    span: Span,
}

impl<'b, 'a> FunctionParts<'b, 'a> {
    fn of_function(func: &'b oxc::ast::ast::Function<'a>) -> Self {
        Self { params: &func.params, body: func.body.as_deref(), arrow: false, concise: None, span: func.span }
    }

    fn of_expression(expr: &'b Expression<'a>) -> Option<Self> {
        match expr.get_inner_expression() {
            Expression::ArrowFunctionExpression(arrow) => Some(Self {
                params: &arrow.params,
                body: arrow.get_function_body(),
                arrow: true,
                concise: arrow.get_expression(),
                span: arrow.span,
            }),
            Expression::FunctionExpression(func) => Some(Self::of_function(func)),
            _ => None,
        }
    }

    /// The function this one returns as its only result: a concise body,
    /// or a body that is one `return`.
    fn returned(&self) -> Option<Self> {
        if let Some(result) = self.concise {
            return Self::of_expression(result);
        }
        let [Statement::ReturnStatement(statement)] = self.body?.statements.as_slice() else { return None };
        Self::of_expression(statement.argument.as_ref()?)
    }
}

/// Whether a function body reads its own `arguments` object as a value,
/// also from an arrow inside it; a type query of it reads nothing. A nested
/// function has its own; a module is strict, so nothing else is named
/// `arguments`.
fn reads_own_arguments(body: &oxc::ast::ast::FunctionBody<'_>, scoping: &Scoping) -> bool {
    struct Scan<'s> {
        scoping: &'s Scoping,
        found: bool,
        nested: usize,
    }
    impl<'a> Visit<'a> for Scan<'_> {
        fn visit_function(&mut self, func: &oxc::ast::ast::Function<'a>, flags: oxc::semantic::ScopeFlags) {
            self.nested += 1;
            oxc::ast_visit::walk::walk_function(self, func, flags);
            self.nested -= 1;
        }

        fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
            let value = ident.reference_id.get().is_none_or(|id| self.scoping.get_reference(id).is_value());
            if self.nested == 0 && value && ident.name == "arguments" {
                self.found = true;
            }
        }
    }
    let mut scan = Scan { scoping, found: false, nested: 0 };
    scan.visit_function_body(body);
    scan.found
}

/// Visits each value reference to a watched parameter and records how it
/// treats the object (see `function_param_readings`).
struct ParamScan<'a, 's> {
    scoping: &'s Scoping,
    params: FxHashMap<SymbolId, (String, usize)>,
    /// Each function's span, by readings key.
    spans: FxHashMap<String, Span>,
    readings: BTreeMap<String, Vec<ParamReading>>,
    /// What a parameter's uses do besides reading it, by readings key and
    /// index.
    uses: FxHashMap<(String, usize), ParamUses>,
    ancestors: Vec<AstKind<'a>>,
    global_object: bool,
}

/// The uses of a parameter that decide between `ReadOnly` and `Alias`.
#[derive(Default)]
struct ParamUses {
    /// Where its function's result holds it: returned itself, or in a fresh
    /// object or array.
    returned: Vec<Vec<String>>,
    /// Its members handed on, or its values copied out.
    hands_members: bool,
    /// Passed to callees whose results its function returns, with where its
    /// result holds each callee's.
    returned_through: Vec<(Pass, Vec<String>)>,
}

impl ParamScan<'_, '_> {
    /// Each parameter's reading: one its function returns is an alias,
    /// unless a use hands its members on or passes it to a callee that may.
    fn finish(mut self) -> BTreeMap<String, Vec<ParamReading>> {
        for ((function, index), uses) in self.uses {
            let Some(slot) = self.readings.get_mut(&function).and_then(|reading| reading.get_mut(index)) else {
                continue;
            };
            let ParamReading::ReadOnly(passes, _) = slot else { continue };
            if uses.returned.is_empty() && uses.returned_through.is_empty() {
                continue;
            }
            *slot = if uses.hands_members || !passes.is_empty() {
                ParamReading::Unsafe
            } else {
                ParamReading::Alias { returned: uses.returned, through: uses.returned_through }
            };
        }
        self.readings
    }
}

impl<'a> Visit<'a> for ParamScan<'a, '_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        let Some(reference) = ident.reference_id.get().map(|id| self.scoping.get_reference(id)) else {
            return;
        };
        if !reference.is_value() {
            return;
        }
        let Some((function, index)) = reference.symbol_id().and_then(|symbol| self.params.get(&symbol)).cloned()
        else {
            return;
        };
        let own = self.spans.get(&function).copied();
        let Some(slot) = self.readings.get_mut(&function).and_then(|reading| reading.get_mut(index)) else {
            return;
        };
        let ParamReading::ReadOnly(passes, handed) = slot else { return };
        let uses = self.uses.entry((function, index)).or_default();
        // Returned by its own function; a closure returning it hands it on.
        if let Some((returned_by, at)) = returned_position(ident.span, &self.ancestors) {
            if Some(returned_by) == own {
                uses.returned.push(at);
            } else {
                *slot = ParamReading::Unsafe;
            }
            return;
        }
        // The engine hands on only an object whose values are primitives,
        // so a copy or a member of the parameter holds no object of it.
        match style_object_use(ident.span, &self.ancestors, &FxHashSet::default(), self.global_object) {
            StyleUse::Read => {}
            StyleUse::FlatRead(_) => {
                uses.hands_members = true;
                handed.push(vec![crate::flow::ANY_MEMBER.to_string()]);
            }
            StyleUse::MemberHandoff(at, _) => {
                uses.hands_members = true;
                handed.push(handed_path(&at));
            }
            StyleUse::Handoff { callee, reference, calls, index, call, nested: false, .. }
                if fixed_callee(self.scoping, reference) =>
            {
                let pass = Pass { callee, calls, index };
                let at = self.ancestors.iter().rposition(|kind| kind.span() == call).unwrap_or(0);
                match returned_position(call, &self.ancestors[..at]) {
                    Some((returned_by, at)) if Some(returned_by) == own => uses.returned_through.push((pass, at)),
                    _ => passes.push(pass),
                }
            }
            _ => *slot = ParamReading::Unsafe,
        }
    }
}

/// The member path a use hands on: the member's, or for a computed key, every
/// member below the path.
fn handed_path(at: &UseAt) -> Vec<String> {
    match at {
        UseAt::AnyMember(path) | UseAt::UnknownKeyWritten(path) => {
            path.iter().cloned().chain(std::iter::once(crate::flow::ANY_MEMBER.to_string())).collect()
        }
        UseAt::Member(path) | UseAt::Written(path) => path.clone(),
    }
}

/// Whether the expression at `span` is only tested for truth: an `if`,
/// loop or conditional's test.
fn tested(span: Span, ancestors: &[AstKind<'_>]) -> bool {
    let (current, parent) = peel_wrappers(span, &mut ancestors.iter().rev());
    match parent {
        Some(AstKind::IfStatement(statement)) => statement.test.span() == current,
        Some(AstKind::WhileStatement(statement)) => statement.test.span() == current,
        Some(AstKind::DoWhileStatement(statement)) => statement.test.span() == current,
        Some(AstKind::ConditionalExpression(conditional)) => conditional.test.span() == current,
        _ => false,
    }
}

/// Where the binding at `span`, or a static member path of it, is the first
/// argument of the global `Object.entries` or `Object.values`: the call, the
/// path, and whether its elements are `[key, member]` pairs.
fn entries_of(span: Span, ancestors: &[AstKind<'_>], global_object: bool) -> Option<(Span, Vec<String>, bool)> {
    if !global_object {
        return None;
    }
    let mut rest = ancestors.iter().rev();
    let mut path = Vec::new();
    let mut current = span;
    loop {
        let (outer, parent) = peel_wrappers(current, &mut rest);
        match parent {
            Some(AstKind::StaticMemberExpression(member)) if member.object.span() == outer => {
                path.push(member.property.name.to_string());
                current = member.span;
            }
            Some(AstKind::CallExpression(call)) if call.arguments.first().map(GetSpan::span) == Some(outer) => {
                let Expression::StaticMemberExpression(callee) = call.callee.get_inner_expression() else { return None };
                if !callee.object.is_specific_id("Object") {
                    return None;
                }
                return match callee.property.name.as_str() {
                    "entries" => Some((call.span, path, true)),
                    "values" => Some((call.span, path, false)),
                    _ => None,
                };
            }
            _ => return None,
        }
    }
}

/// Whether a non-arrow function between the ancestors' last node and the
/// function `outer` reads its `arguments`.
fn closures_read_arguments(ancestors: &[AstKind<'_>], outer: Option<Span>, source: &str) -> bool {
    ancestors
        .iter()
        .rev()
        .take_while(|kind| Some(kind.span()) != outer)
        .filter_map(|kind| match kind {
            AstKind::Function(function) => Some(function.span),
            _ => None,
        })
        .any(|span| reads_arguments(span, source))
}

/// Whether the source at `span` names `arguments` as a word.
fn reads_arguments(span: Span, source: &str) -> bool {
    source.get(span.start as usize..span.end as usize).is_some_and(|text| {
        text.match_indices("arguments").any(|(at, _)| {
            let before = text[..at].chars().next_back();
            let after = text[at + "arguments".len()..].chars().next();
            !before.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '$')
                && !after.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '$')
        })
    })
}

/// Whether the value at `span` is only tested, negated, compared or
/// discarded, through the logical expressions it is an operand of.
fn only_tested<'b, 'a: 'b>(span: Span, ancestors: &mut impl Iterator<Item = &'b AstKind<'a>>) -> bool {
    use oxc::syntax::operator::UnaryOperator;
    let (current, parent) = peel_wrappers(span, ancestors);
    match parent {
        Some(AstKind::IfStatement(statement)) => statement.test.span() == current,
        Some(AstKind::WhileStatement(statement)) => statement.test.span() == current,
        Some(AstKind::DoWhileStatement(statement)) => statement.test.span() == current,
        Some(AstKind::ForStatement(statement)) => statement.test.as_ref().is_some_and(|test| test.span() == current),
        Some(AstKind::ConditionalExpression(conditional)) => conditional.test.span() == current,
        Some(AstKind::ExpressionStatement(_)) => true,
        Some(AstKind::LogicalExpression(logical)) => only_tested(logical.span, ancestors),
        Some(AstKind::UnaryExpression(unary)) => {
            matches!(unary.operator, UnaryOperator::Typeof | UnaryOperator::LogicalNot | UnaryOperator::Void)
        }
        Some(AstKind::BinaryExpression(binary)) => binary.operator.is_equality() || binary.operator.is_compare(),
        _ => false,
    }
}

/// The span of the innermost function around the ancestors' last node.
fn enclosing_function(ancestors: &[AstKind<'_>]) -> Option<Span> {
    ancestors.iter().rev().find_map(|kind| match kind {
        AstKind::Function(function) => Some(function.span),
        AstKind::ArrowFunctionExpression(arrow) => Some(arrow.span),
        _ => None,
    })
}

/// The function-scope `const` a member read at `span` (`parts[name]`,
/// `parts.a.b`) initializes, through erased wrappers, with the function it
/// belongs to.
fn local_alias_target(span: Span, ancestors: &[AstKind<'_>]) -> Option<(SymbolId, Option<Span>)> {
    use oxc::ast::ast::{BindingPattern, VariableDeclarationKind};
    let mut current = span;
    for (at, kind) in ancestors.iter().enumerate().rev() {
        match kind {
            kind if is_erased_wrapper(kind) || matches!(kind, AstKind::ChainExpression(_)) => current = kind.span(),
            AstKind::StaticMemberExpression(member) if member.object.span() == current => current = member.span,
            AstKind::ComputedMemberExpression(member) if member.object.span() == current => current = member.span,
            AstKind::VariableDeclarator(declarator) if declarator.init.as_ref().map(GetSpan::span) == Some(current) => {
                let BindingPattern::BindingIdentifier(id) = &declarator.id else { return None };
                let Some(AstKind::VariableDeclaration(declaration)) = at.checked_sub(1).map(|up| &ancestors[up]) else {
                    return None;
                };
                let function = enclosing_function(&ancestors[..at]);
                return (declaration.kind == VariableDeclarationKind::Const && function.is_some())
                    .then(|| id.symbol_id.get())
                    .flatten()
                    .map(|symbol| (symbol, function));
            }
            _ => return None,
        }
    }
    None
}

/// The span of the function whose result the expression at `span` is,
/// through erased wrappers and, as a member, fresh object and array
/// literals: a `return` argument or a concise arrow body. `ancestors` runs
/// from the root to the expression's parent.
fn returned_value(span: Span, ancestors: &[AstKind<'_>]) -> Option<Span> {
    returned_position(span, ancestors).map(|(function, _)| function)
}

/// `returned_value`, and where in the result the expression sits: the keys
/// of the fresh literals around it from the outermost, `ANY_MEMBER` for an
/// array element.
fn returned_position(span: Span, ancestors: &[AstKind<'_>]) -> Option<(Span, Vec<String>)> {
    let mut rest = ancestors.iter().rev();
    let mut current = span;
    let mut keys = Vec::new();
    let function = loop {
        match rest.next()? {
            kind if is_erased_wrapper(kind) => current = kind.span(),
            AstKind::ObjectProperty(prop) if prop.value.span() == current && !prop.computed => {
                keys.push(prop.key.static_name().map_or_else(|| crate::flow::ANY_MEMBER.to_string(), |key| key.to_string()));
                match rest.next()? {
                    AstKind::ObjectExpression(object) => current = object.span,
                    _ => return None,
                }
            }
            AstKind::ArrayExpression(array)
                if array.elements.iter().any(|element| element.span() == current && !element.is_spread()) =>
            {
                keys.push(crate::flow::ANY_MEMBER.to_string());
                current = array.span;
            }
            AstKind::ReturnStatement(_) => {
                break rest.find_map(|kind| match kind {
                    AstKind::Function(function) => Some(function.span),
                    AstKind::ArrowFunctionExpression(arrow) => Some(arrow.span),
                    _ => None,
                })?;
            }
            // A concise arrow body is the arrow's result.
            AstKind::ArrowFunctionExpression(arrow) => break arrow.span,
            _ => return None,
        }
    };
    keys.reverse();
    Some((function, keys))
}

/// Visits every value reference to an object binding and records the first
/// one that may change the object's members or hand the object on: a
/// member write, update or delete, a method call (it receives the object as
/// `this`), a call argument, or any use besides a member read, a JSX tag,
/// a spread into an object literal or props, an export, a top-level `const`
/// alias, a destructuring read and an `Object.assign` source. A namespace
/// import is followed through one member, which is the object.
struct ObjectUseScan<'a, 's> {
    scoping: &'s Scoping,
    source: &'s str,
    candidates: FxHashMap<SymbolId, ObjectBinding>,
    global_object: bool,
    /// React's own functions, whose context readers change nothing.
    react: ReactImports,
    uses: BTreeMap<String, ObjectUse>,
    ancestors: Vec<AstKind<'a>>,
    /// Style-value rules (see `style_object_uses`) instead of a facade's.
    style: bool,
    /// See `StyleObjectFacts::stored`.
    containers: Vec<(String, String, Vec<String>)>,
    /// The module's static values, which say whether a member handed on is
    /// an object; `None` outside style mode.
    statics: Option<&'s FxHashMap<String, StaticValue>>,
    /// See `StyleObjectFacts::derives`.
    derives: Vec<(String, String, Vec<String>, bool)>,
    /// See `StyleObjectFacts::handoffs`.
    handoffs: Vec<Handoff>,
    /// See `StyleObjectFacts::flat_reads`.
    flat_reads: Vec<(String, ObjectUse)>,
    /// See `StyleObjectFacts::uses`; empty outside style mode.
    style_uses: Vec<(String, ObjectUse, UseAt)>,
    /// See `MemberConsts`; empty in style mode.
    member_consts: FxHashMap<SymbolId, String>,
    /// See `FileFacts::written_namespaces`.
    written_namespaces: WrittenNamespaces,
    /// In style mode, the module-scope functions nothing exports, and the
    /// `const` each call of one initializes.
    called_functions: Option<CalledFunctions>,
    /// (binding, the function that returns it, where its result holds it,
    /// the use): see `CalledFunctions`.
    returns: Vec<(String, SymbolId, Vec<String>, ObjectUse)>,
    /// In style mode, each function's own `const` that holds a member of an
    /// object binding.
    local_aliases: FxHashMap<SymbolId, LocalAlias>,
    /// In style mode, each function's own `const` that holds an array of an
    /// object binding's members (`Object.entries(o).filter(…)`).
    element_arrays: FxHashMap<SymbolId, ElementArray>,
}

/// A function's own `const` holding an array whose elements are an object
/// binding's members, or `[key, member]` pairs of them: its uses are
/// followed as the chain that built it is.
struct ElementArray {
    binding: String,
    /// The members' path in the binding's object, `ANY_MEMBER` last.
    base: Vec<String>,
    /// Elements are `[key, member]` pairs (`Object.entries`).
    pairs: bool,
    used: ObjectUse,
    seen: usize,
}

/// A function's own `const` initialized with a member of a module-scope
/// object (`const part = parts[name]`), or a callback's parameter bound to
/// one (`.filter(([name, part]) => …)`): an alias of the member. Its uses
/// are the member's: a read, or a pass to a function that only reads it,
/// leaves it; any other use changes or hands on the member. A use inside a
/// closure is judged as one in the alias's own function, path by path, the
/// most that whoever invokes the closure can make of it (spec §6.6 F11a, as
/// amended).
struct LocalAlias {
    binding: String,
    /// The member's path in the binding's object, `ANY_MEMBER` for a
    /// computed key.
    base: Vec<String>,
    /// The function the `const` belongs to.
    function: Option<Span>,
    /// The use that initializes it.
    used: ObjectUse,
    /// How many of its value references the scan has judged.
    seen: usize,
}

/// The module's unexported module-scope functions, by the span of the
/// function each binding names, and the module-scope `const` each reference
/// to one initializes by calling it: `None` once a reference does anything
/// else. A function only ever called, each call initializing a `const`,
/// hands what it returns to those `const`s alone.
#[derive(Default)]
struct CalledFunctions {
    spans: FxHashMap<Span, SymbolId>,
    functions: FxHashSet<SymbolId>,
    holders: FxHashMap<SymbolId, Option<Vec<String>>>,
}

impl CalledFunctions {
    fn of(program: &Program<'_>) -> Self {
        use oxc::ast::ast::{BindingPattern, Declaration, VariableDeclarationKind};
        let mut spans = FxHashMap::default();
        for stmt in &program.body {
            match stmt.as_declaration() {
                Some(Declaration::FunctionDeclaration(func)) => {
                    if let Some(symbol) = func.id.as_ref().and_then(|id| id.symbol_id.get()) {
                        spans.insert(func.span, symbol);
                    }
                }
                Some(Declaration::VariableDeclaration(var)) if var.kind == VariableDeclarationKind::Const => {
                    for declarator in &var.declarations {
                        let BindingPattern::BindingIdentifier(id) = &declarator.id else { continue };
                        let span = match declarator.init.as_ref().map(Expression::get_inner_expression) {
                            Some(Expression::ArrowFunctionExpression(arrow)) => arrow.span,
                            Some(Expression::FunctionExpression(func)) => func.span,
                            _ => continue,
                        };
                        if let Some(symbol) = id.symbol_id.get() {
                            spans.insert(span, symbol);
                        }
                    }
                }
                _ => {}
            }
        }
        let functions = spans.values().copied().collect();
        Self { spans, functions, holders: FxHashMap::default() }
    }
}

impl<'a> ObjectUseScan<'a, '_> {
    /// Judges one use of a local alias as a use of the member it holds.
    /// Follows an array of `binding`'s members (at `base`, `ANY_MEMBER`
    /// last) from the expression at `span` outward: each array method's
    /// callback parameter bound to a member becomes an alias of it, `filter`
    /// keeps the elements, `map`, `flatMap` and the tests make fresh values,
    /// `length` reads, and a function's own `const` is followed through its
    /// uses. False where the array goes anywhere else.
    fn follow_elements(&mut self, span: Span, binding: &str, base: &[String], pairs: bool, used: &ObjectUse) -> bool {
        use oxc::ast::ast::BindingPattern;
        let ancestors = self.ancestors.clone();
        // Outward from the node at `span`: past it where it is an ancestor
        // of the reference being visited.
        let skip = ancestors.iter().rev().position(|kind| kind.span() == span).map_or(0, |at| at + 1);
        let mut rest = ancestors.iter().rev().skip(skip);
        let mut current = span;
        loop {
            let (outer, parent) = peel_wrappers(current, &mut rest);
            match parent {
                Some(AstKind::StaticMemberExpression(member)) if member.object.span() == outer => {
                    let method = member.property.name.as_str();
                    if method == "length" {
                        return true;
                    }
                    let Some(AstKind::CallExpression(call)) = rest.next() else { return false };
                    if call.callee.span() != member.span
                        || !matches!(method, "filter" | "map" | "flatMap" | "forEach" | "some" | "every")
                        || call.arguments.len() != 1
                    {
                        return false;
                    }
                    let (params, function) = match call.arguments[0].as_expression().map(Expression::get_inner_expression) {
                        Some(Expression::ArrowFunctionExpression(arrow)) => (&arrow.params, arrow.span),
                        // A function's `arguments` holds every element, and the
                        // array, whatever its parameters name.
                        Some(Expression::FunctionExpression(function)) if !reads_arguments(function.span, self.source) => {
                            (&function.params, function.span)
                        }
                        _ => return false,
                    };
                    // The element, and at most its index: the array itself
                    // as a third parameter hands every element on.
                    if params.rest.is_some() || params.items.len() > 2 {
                        return false;
                    }
                    if let Some(first) = params.items.first() {
                        let member = match (&first.pattern, pairs) {
                            (BindingPattern::BindingIdentifier(id), false) => Some(id),
                            (BindingPattern::ArrayPattern(pattern), true) if pattern.rest.is_none() && pattern.elements.len() <= 2 => {
                                if !pattern.elements.first().is_none_or(|key| matches!(key, None | Some(BindingPattern::BindingIdentifier(_)))) {
                                    return false;
                                }
                                match pattern.elements.get(1) {
                                    None | Some(None) => None,
                                    Some(Some(BindingPattern::BindingIdentifier(id))) => Some(id),
                                    Some(Some(_)) => return false,
                                }
                            }
                            _ => return false,
                        };
                        if let Some(id) = member.and_then(|id| id.symbol_id.get()) {
                            self.local_aliases.insert(
                                id,
                                LocalAlias {
                                    binding: binding.to_string(),
                                    base: base.to_vec(),
                                    function: Some(function),
                                    used: used.clone(),
                                    seen: 0,
                                },
                            );
                        }
                    }
                    if method != "filter" {
                        return true;
                    }
                    current = call.span;
                }
                Some(AstKind::VariableDeclarator(declarator))
                    if declarator.init.as_ref().map(GetSpan::span) == Some(outer)
                        && enclosing_function(&ancestors).is_some() =>
                {
                    let BindingPattern::BindingIdentifier(id) = &declarator.id else { return false };
                    let Some(symbol) = id.symbol_id.get() else { return false };
                    self.element_arrays.insert(
                        symbol,
                        ElementArray { binding: binding.to_string(), base: base.to_vec(), pairs, used: used.clone(), seen: 0 },
                    );
                    return true;
                }
                _ => return false,
            }
        }
    }

    fn alias_use(&mut self, symbol: SymbolId, ident: &IdentifierReference<'a>) {
        let line = Some(self.line(ident.span));
        let alias = self.local_aliases.get_mut(&symbol).expect("a watched alias");
        alias.seen += 1;
        let (binding, base) = (alias.binding.clone(), alias.base.clone());
        let name = &ident.name;
        let at_base = |path: &[String]| base.iter().chain(path).take(crate::flow::PATH_DEPTH).cloned().collect::<Vec<_>>();
        // A use in a closure is judged as a use in the alias's own function:
        // whoever invokes the closure can do no more with the binding than
        // the closure's own body does, one path at a time. A closure that
        // reads its `arguments` is not read so.
        let captured_unread = enclosing_function(&self.ancestors) != alias.function
            && closures_read_arguments(&self.ancestors, alias.function, self.source);
        let use_at = if captured_unread {
            Some((UseAt::Member(base.clone()), format!("{name} is captured by a closure that reads its arguments")))
        } else if returned_value(ident.span, &self.ancestors).is_some() {
            Some((UseAt::Member(base.clone()), format!("{name} is returned")))
        } else if tested(ident.span, &self.ancestors) {
            None
        } else {
            match style_object_use(ident.span, &self.ancestors, &FxHashSet::default(), self.global_object) {
                StyleUse::Read => None,
                StyleUse::MemberEffect(at, what) | StyleUse::MemberHandoff(at, what) => {
                    let at = match at {
                        UseAt::Member(path) => UseAt::Member(at_base(&path)),
                        UseAt::AnyMember(path) => UseAt::AnyMember(at_base(&path)),
                        UseAt::Written(path) => UseAt::Written(at_base(&path)),
                        UseAt::UnknownKeyWritten(path) => UseAt::UnknownKeyWritten(at_base(&path)),
                    };
                    Some((at, format!("{name} {what}")))
                }
                StyleUse::FlatRead(what) => Some((UseAt::AnyMember(base.clone()), format!("{name} {what}"))),
                StyleUse::Handoff { callee, reference, calls, index, nested: false, within, holder, what, .. }
                    if fixed_callee(self.scoping, reference) =>
                {
                    self.handoffs.push(Handoff {
                        binding,
                        at: base,
                        callee,
                        calls,
                        index,
                        nested: false,
                        within,
                        holder,
                        used: ObjectUse { line, what: format!("{name} {what}") },
                    });
                    None
                }
                StyleUse::Unsafe(what) | StyleUse::Handoff { what, .. } => {
                    Some((UseAt::Member(base.clone()), format!("{name} {what}")))
                }
                StyleUse::StoredIn { .. } => Some((UseAt::Member(base.clone()), format!("{name} is stored in an object"))),
            }
        };
        if let Some((at, what)) = use_at {
            let alias = &self.local_aliases[&symbol];
            let what = format!("{}, and {what}", alias.used.what);
            self.style_uses.push((alias.binding.clone(), ObjectUse { line, what }, at));
        }
    }

    /// The 1-based line `span` starts on.
    fn line(&self, span: Span) -> usize {
        let start = (span.start as usize).min(self.source.len());
        self.source[..start].matches('\n').count() + 1
    }

    /// How a use may write the member value at `span`, read through a
    /// member of a namespace import or a `const` it initializes: writing
    /// through it, handing it on or exporting it. Initializing a `const` in
    /// `member_consts` leaves the answer to that `const`'s uses; storing it,
    /// passing it as a prop and calling it only read it.
    fn member_value_write<'b>(
        &self,
        span: Span,
        ancestors: impl Iterator<Item = &'b AstKind<'a>> + Clone,
    ) -> Option<String>
    where
        'a: 'b,
    {
        let (current, parent) = peel_wrappers(span, &mut ancestors.clone());
        match parent {
            Some(AstKind::ExportSpecifier(_) | AstKind::ExportDefaultDeclaration(_)) => {
                return Some("is exported".to_string());
            }
            Some(AstKind::VariableDeclarator(declarator))
                if declarator.init.as_ref().map(GetSpan::span) == Some(current)
                    && matches!(&declarator.id, oxc::ast::ast::BindingPattern::BindingIdentifier(id)
                        if id.symbol_id.get().is_some_and(|symbol| self.member_consts.contains_key(&symbol))) =>
            {
                return None;
            }
            _ => {}
        }
        object_use(span, ancestors, false, self.global_object, false).filter(|what| {
            !matches!(what.as_str(), "is called" | "is stored in an object" | "is stored in an array" | "is passed as a prop")
                && !what.ends_with(" called as a method")
        })
    }
}

/// Records `namespace`'s first use that may write through it.
fn written_through(
    written: &mut WrittenNamespaces,
    namespace: &str,
    subject: String,
    used: ObjectUse,
) {
    written.entry(namespace.to_string()).or_insert((subject, used));
}

impl<'a> Visit<'a> for ObjectUseScan<'a, '_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        let Some(reference) = ident.reference_id.get().map(|id| self.scoping.get_reference(id)) else {
            return;
        };
        let Some(symbol) = reference.symbol_id() else { return };
        if self.local_aliases.contains_key(&symbol) {
            if reference.is_value() {
                self.alias_use(symbol, ident);
            }
            return;
        }
        if let Some(array) = self.element_arrays.get_mut(&symbol) {
            if reference.is_value() {
                array.seen += 1;
                let (binding, base, pairs, used) = (array.binding.clone(), array.base.clone(), array.pairs, array.used.clone());
                if !self.follow_elements(ident.span, &binding, &base, pairs, &used) {
                    self.style_uses.push((binding, used, UseAt::AnyMember(base[..base.len() - 1].to_vec())));
                }
            }
            return;
        }
        if let Some(called) = self.called_functions.as_mut().filter(|called| called.functions.contains(&symbol)) {
            let mut rest = self.ancestors.iter().rev();
            let holder = match peel_wrappers(ident.span, &mut rest) {
                (current, Some(AstKind::CallExpression(call))) if call.callee.span() == current => holder_const(call.span, rest),
                _ => None,
            };
            let holders = called.holders.entry(symbol).or_insert_with(|| Some(Vec::new()));
            match (holders.as_mut(), holder) {
                (Some(holders), Some(holder)) => holders.push(holder),
                _ => *holders = None,
            }
        }
        if let Some(namespace) = self.member_consts.get(&symbol).cloned() {
            let write = reference.is_value().then(|| self.member_value_write(ident.span, self.ancestors.iter().rev()));
            if let Some(what) = write.flatten() {
                let used = ObjectUse { line: Some(self.line(ident.span)), what };
                written_through(&mut self.written_namespaces, &namespace, ident.name.to_string(), used);
            }
        }
        let Some(binding) = self.candidates.get(&symbol).cloned() else { return };
        let binding = &binding;
        if !reference.is_value() {
            return;
        }
        if self.style {
            let (key, what, at) = if binding.namespace {
                // A member of a namespace import, as the object it names.
                let mut rest = self.ancestors.iter().rev();
                let (span, parent) = peel_wrappers(ident.span, &mut rest);
                match parent {
                    Some(AstKind::StaticMemberExpression(member)) if member.object.span() == span => {
                        let at = self.ancestors.len() - self.ancestors.iter().rev().position(|kind| kind.span() == member.span).map_or(0, |i| i + 1);
                        let names: FxHashSet<String> = FxHashSet::default();
                        let key = format!("{}.{}", binding.name, member.property.name);
                        match style_object_use(member.span, &self.ancestors[..at], &names, self.global_object) {
                            StyleUse::Read => return,
                            StyleUse::FlatRead(what) => {
                                self.flat_reads.push((key, ObjectUse { line: Some(self.line(ident.span)), what }));
                                return;
                            }
                            StyleUse::StoredIn { .. } => (key, "is stored in an object".to_string(), UseAt::WHOLE),
                            StyleUse::MemberEffect(at, what) | StyleUse::MemberHandoff(at, what) => (key, what, at),
                            StyleUse::Unsafe(what) | StyleUse::Handoff { what, .. } => (key, what, UseAt::WHOLE),
                        }
                    }
                    _ => (binding.name.clone(), "is used as a whole namespace".to_string(), UseAt::WHOLE),
                }
            } else {
                // An array of its members, followed through the callbacks
                // and the function-local `const` it reaches.
                if let Some((call, path, pairs)) = entries_of(ident.span, &self.ancestors, self.global_object) {
                    let used = ObjectUse {
                        line: Some(self.line(ident.span)),
                        what: format!("is read by Object.{}()", if pairs { "entries" } else { "values" }),
                    };
                    let base: Vec<String> =
                        path.into_iter().chain(std::iter::once(crate::flow::ANY_MEMBER.to_string())).take(crate::flow::PATH_DEPTH).collect();
                    let name = binding.name.clone();
                    if self.follow_elements(call, &name, &base, pairs, &used) {
                        return;
                    }
                }
                let containers: FxHashSet<String> =
                    self.candidates.values().filter(|b| !b.namespace).map(|b| b.name.clone()).collect();
                if let Some((derived, (at, held))) =
                    initializing_const(ident.span, &self.ancestors).filter(|(name, _)| name != &binding.name)
                {
                    self.derives.push((derived, binding.name.clone(), at, held));
                }
                // Returned by a module-scope function: decided once every
                // reference to the function is seen.
                let returned_by = returned_position(ident.span, &self.ancestors).and_then(|(span, at)| {
                    Some((*self.called_functions.as_ref()?.spans.get(&span)?, at))
                });
                if let Some((function, at)) = returned_by {
                    let what = match style_object_use(ident.span, &self.ancestors, &containers, self.global_object) {
                        StyleUse::Unsafe(what) => what,
                        _ => "is returned from a function".to_string(),
                    };
                    let used = ObjectUse { line: Some(self.line(ident.span)), what };
                    self.returns.push((binding.name.clone(), function, at, used));
                    return;
                }
                match style_object_use(ident.span, &self.ancestors, &containers, self.global_object) {
                    StyleUse::Read => return,
                    StyleUse::StoredIn { container, at } => {
                        self.containers.push((binding.name.clone(), container, at));
                        return;
                    }
                    StyleUse::FlatRead(what) => {
                        self.flat_reads.push((binding.name.clone(), ObjectUse { line: Some(self.line(ident.span)), what }));
                        return;
                    }
                    StyleUse::Unsafe(what) => (binding.name.clone(), what, UseAt::WHOLE),
                    StyleUse::MemberEffect(at, what) => (binding.name.clone(), what, at),
                    StyleUse::Handoff { what, reference, .. } if !fixed_callee(self.scoping, reference) => {
                        (binding.name.clone(), what, UseAt::WHOLE)
                    }
                    StyleUse::Handoff { callee, calls, index, nested, within, holder, what, .. } => {
                        self.handoffs.push(Handoff {
                            binding: binding.name.clone(),
                            at: Vec::new(),
                            callee,
                            calls,
                            index,
                            nested,
                            within,
                            holder,
                            used: ObjectUse { line: Some(self.line(ident.span)), what },
                        });
                        return;
                    }
                    StyleUse::MemberHandoff(at, what) => {
                        // A member kept in a function's own `const` is
                        // judged by that `const`'s uses.
                        if let Some((local, function)) = local_alias_target(ident.span, &self.ancestors) {
                            let used = ObjectUse { line: Some(self.line(ident.span)), what };
                            let base = handed_path(&at);
                            self.local_aliases.insert(local, LocalAlias { binding: binding.name.clone(), base, function, used, seen: 0 });
                            return;
                        }
                        // A primitive member handed on cannot change the object.
                        let path = match &at {
                            UseAt::Member(path) => Some(path),
                            _ => None,
                        };
                        let primitive = path.zip(self.statics).and_then(|(path, statics)| {
                            let mut value = statics.get(&binding.name)?;
                            for segment in path {
                                value = value.get(segment)?;
                            }
                            Some(matches!(
                                value,
                                StaticValue::Null
                                    | StaticValue::Bool(_)
                                    | StaticValue::Number(_)
                                    | StaticValue::String(_)
                            ))
                        });
                        if primitive == Some(true) {
                            return;
                        }
                        (binding.name.clone(), what, at)
                    }
                }
            };
            let line = self.line(ident.span);
            self.style_uses.push((key, ObjectUse { line: Some(line), what }, at));
            return;
        }
        // React's `useContext` and `use` read the context they receive.
        let mut ancestors = self.ancestors.iter().rev();
        if let (current, Some(AstKind::CallExpression(call))) = peel_wrappers(ident.span, &mut ancestors) {
            let read = call.arguments.first().map(GetSpan::span) == Some(current)
                && self.react.calls(self.scoping, &call.callee, &["useContext", "use"]);
            if read {
                return;
            }
        }
        // An assigned facade's target below the binding, watched as an object
        // of its own under its path.
        for target in binding.targets.iter().filter(|target| !target.is_empty()) {
            let key = format!("{}.{target}", binding.name);
            if self.uses.contains_key(&key) {
                continue;
            }
            let mut ancestors = self.ancestors.iter().rev();
            let mut span = ident.span;
            let reached = target.split('.').all(|segment| match peel_wrappers(span, &mut ancestors) {
                (current, Some(AstKind::StaticMemberExpression(member)))
                    if member.object.span() == current && member.property.name == segment =>
                {
                    span = member.span;
                    true
                }
                _ => false,
            });
            if !reached {
                continue;
            }
            if let Some(what) = object_use(span, ancestors, false, self.global_object, true) {
                let start = (ident.span.start as usize).min(self.source.len());
                let line = self.source[..start].matches('\n').count() + 1;
                self.uses.insert(key, ObjectUse { line: Some(line), what });
            }
        }
        let assigned_target = binding.targets.iter().any(String::is_empty);
        let mut ancestors = self.ancestors.iter().rev();
        let (key, what) = if binding.namespace {
            let namespace = binding.name.clone();
            let (span, parent) = peel_wrappers(ident.span, &mut ancestors);
            match parent {
                Some(AstKind::JSXMemberExpression(_)) => return,
                Some(AstKind::StaticMemberExpression(member)) if member.object.span() == span => {
                    let key = format!("{namespace}.{}", member.property.name);
                    if let Some(what) = self.member_value_write(member.span, ancestors.clone()) {
                        let used = ObjectUse { line: Some(self.line(ident.span)), what };
                        written_through(&mut self.written_namespaces, &namespace, key.clone(), used);
                    }
                    if self.uses.contains_key(&key) {
                        return;
                    }
                    let what = object_use(member.span, ancestors, false, self.global_object, false);
                    (key, what)
                }
                // Some member a key names at runtime.
                Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == span => {
                    if let Some(what) = self.member_value_write(member.span, ancestors) {
                        let used = ObjectUse { line: Some(self.line(ident.span)), what };
                        written_through(&mut self.written_namespaces, &namespace, format!("a member of {namespace}"), used);
                    }
                    (namespace, Some("is used as a whole namespace".to_string()))
                }
                _ => {
                    let what = "is used as a whole namespace".to_string();
                    let used = ObjectUse { line: Some(self.line(ident.span)), what: what.clone() };
                    written_through(&mut self.written_namespaces, &namespace, namespace.clone(), used);
                    (namespace, Some(what))
                }
            }
        } else {
            if self.uses.contains_key(&binding.name)
                || (binding.facade && top_level_write(ident.span, &self.ancestors))
            {
                return;
            }
            // Passed to a module-scope function nothing writes: the engine
            // judges whether that parameter only reads it.
            if let Some((callee, index)) = fixed_call_argument(ident.span, &self.ancestors, self.scoping) {
                self.handoffs.push(Handoff {
                    binding: binding.name.clone(),
                    used: ObjectUse { line: Some(self.line(ident.span)), what: format!("is passed to {callee}()") },
                    callee,
                    calls: 1,
                    index,
                    at: Vec::new(),
                    nested: false,
                    within: Vec::new(),
                    holder: None,
                });
                return;
            }
            (binding.name.clone(), object_use(ident.span, ancestors, true, self.global_object, assigned_target))
        };
        let Some(what) = what else { return };
        let start = (ident.span.start as usize).min(self.source.len());
        let line = self.source[..start].matches('\n').count() + 1;
        self.uses.entry(key).or_insert(ObjectUse { line: Some(line), what });
    }
}

/// The function and argument position a reference at `span` is passed to,
/// when the callee is a module-scope binding nothing writes.
fn fixed_call_argument(span: Span, ancestors: &[AstKind<'_>], scoping: &Scoping) -> Option<(String, usize)> {
    let (current, parent) = peel_wrappers(span, &mut ancestors.iter().rev());
    let Some(AstKind::CallExpression(call)) = parent else { return None };
    let index = call.arguments.iter().position(|argument| argument.span() == current)?;
    match crate::chain_walk::unwrap_type_assertions(&call.callee) {
        Expression::Identifier(callee) if fixed_callee(scoping, callee.reference_id.get()) => {
            Some((callee.name.to_string(), index))
        }
        _ => None,
    }
}

/// Whether the reference at `span` is the object of a top-level statement
/// write: `X.key = …`, `X[k] = …` or `Object.assign(X, …)`.
fn top_level_write(span: oxc::span::Span, ancestors: &[AstKind<'_>]) -> bool {
    let mut rest = ancestors.iter().rev();
    let (current, parent) = peel_wrappers(span, &mut rest);
    let written = match parent {
        Some(AstKind::StaticMemberExpression(member)) if member.object.span() == current => {
            let (member_span, parent) = peel_wrappers(member.span, &mut rest);
            matches!(parent, Some(AstKind::AssignmentExpression(assignment)) if assignment.left.span() == member_span)
        }
        Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == current => {
            let (member_span, parent) = peel_wrappers(member.span, &mut rest);
            matches!(parent, Some(AstKind::AssignmentExpression(assignment)) if assignment.left.span() == member_span)
        }
        Some(AstKind::CallExpression(call)) => {
            matches!(&call.callee, Expression::StaticMemberExpression(member)
                if member.object.is_specific_id("Object") && member.property.name == "assign")
                && call.arguments.first().map(GetSpan::span) == Some(current)
        }
        _ => false,
    };
    if !written {
        return false;
    }
    let mut statement = rest.skip_while(|kind| is_erased_wrapper(kind));
    matches!(statement.next(), Some(AstKind::ExpressionStatement(_)))
        && matches!(statement.next(), Some(AstKind::Program(_)))
}

/// Whether the member read at `span` runs with its object as `this`: the
/// callee of a call or `new`, or a tagged template's tag, through erased
/// wrappers and optional chains: `(props.render)()` runs it as a method.
fn runs_as_method<'b, 'a: 'b>(span: oxc::span::Span, ancestors: &mut impl Iterator<Item = &'b AstKind<'a>>) -> bool {
    match peel_wrappers(span, ancestors) {
        (current, Some(AstKind::CallExpression(call))) => call.callee.span() == current,
        (current, Some(AstKind::NewExpression(call))) => call.callee.span() == current,
        (current, Some(AstKind::TaggedTemplateExpression(tagged))) => tagged.tag.span() == current,
        _ => false,
    }
}

/// Whether the value read at `span` stays where it is read: tested,
/// compared, typed or interpolated into a template, or read for a field it
/// neither writes nor runs. Anywhere else (a call's argument or receiver,
/// an assignment, a return, an object or array, a spread, a JSX attribute or
/// child) it can be handed on, and changed.
fn stays_put<'b, 'a: 'b>(span: oxc::span::Span, ancestors: &mut impl Iterator<Item = &'b AstKind<'a>>) -> bool {
    use oxc::syntax::operator::UnaryOperator;
    let (current, parent) = peel_wrappers(span, ancestors);
    match parent {
        Some(AstKind::StaticMemberExpression(member)) if member.object.span() == current => {
            field_read(member.span, ancestors)
        }
        Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == current => {
            field_read(member.span, ancestors)
        }
        Some(AstKind::IfStatement(statement)) => statement.test.span() == current,
        Some(AstKind::WhileStatement(statement)) => statement.test.span() == current,
        Some(AstKind::DoWhileStatement(statement)) => statement.test.span() == current,
        Some(AstKind::ForStatement(statement)) => statement.test.as_ref().is_some_and(|test| test.span() == current),
        Some(AstKind::ConditionalExpression(conditional)) => conditional.test.span() == current,
        Some(AstKind::SwitchStatement(statement)) => statement.discriminant.span() == current,
        Some(AstKind::SwitchCase(_) | AstKind::ExpressionStatement(_)) => true,
        // Either operand can be the expression's value.
        Some(AstKind::LogicalExpression(logical)) => stays_put(logical.span, ancestors),
        Some(AstKind::UnaryExpression(unary)) => {
            matches!(unary.operator, UnaryOperator::Typeof | UnaryOperator::LogicalNot | UnaryOperator::Void)
        }
        Some(AstKind::BinaryExpression(binary)) => binary.operator.is_equality() || binary.operator.is_compare(),
        Some(AstKind::TemplateLiteral(_)) => !matches!(ancestors.next(), Some(AstKind::TaggedTemplateExpression(_))),
        _ => false,
    }
}

/// A field of the value read at `span`, at any depth: it stays put unless it
/// is written, deleted or run with the value as `this`.
fn field_read<'b, 'a: 'b>(span: oxc::span::Span, ancestors: &mut impl Iterator<Item = &'b AstKind<'a>>) -> bool {
    use oxc::syntax::operator::UnaryOperator;
    let (current, parent) = peel_wrappers(span, ancestors);
    match parent {
        Some(AstKind::StaticMemberExpression(member)) if member.object.span() == current => {
            field_read(member.span, ancestors)
        }
        Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == current => {
            field_read(member.span, ancestors)
        }
        Some(AstKind::CallExpression(call)) => call.callee.span() != current,
        Some(AstKind::NewExpression(call)) => call.callee.span() != current,
        Some(AstKind::TaggedTemplateExpression(tagged)) => tagged.tag.span() != current,
        Some(AstKind::AssignmentExpression(assignment)) => assignment.left.span() != current,
        Some(AstKind::UpdateExpression(_)) => false,
        Some(AstKind::UnaryExpression(unary)) => unary.operator != UnaryOperator::Delete,
        _ => true,
    }
}

/// Parentheses and type syntax erased at runtime: the expression inside is
/// what an enclosing node uses.
fn is_erased_wrapper(kind: &AstKind<'_>) -> bool {
    matches!(
        kind,
        AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSInstantiationExpression(_)
    )
}

/// Skips the erased wrappers and optional chains around the expression at
/// `span`: the expression they amount to, and the first other ancestor.
fn peel_wrappers<'b, 'a: 'b>(
    span: oxc::span::Span,
    ancestors: &mut impl Iterator<Item = &'b AstKind<'a>>,
) -> (oxc::span::Span, Option<&'b AstKind<'a>>) {
    let mut current = span;
    loop {
        match ancestors.next() {
            Some(kind) if is_erased_wrapper(kind) || matches!(kind, AstKind::ChainExpression(_)) => {
                current = kind.span();
            }
            other => return (current, other),
        }
    }
}

/// What a use of an object binding at `span` may do to the object, or
/// `None` when it only reads it. `ancestors` runs from the parent out. Only
/// a bare binding (`alias`) can be a top-level `const` alias the module
/// facts follow; `global_object` is false when a module-scope `Object`
/// shadows the global one.
fn object_use<'b, 'a: 'b>(
    span: oxc::span::Span,
    mut ancestors: impl Iterator<Item = &'b AstKind<'a>>,
    alias: bool,
    global_object: bool,
    assigned_target: bool,
) -> Option<String> {
    use oxc::ast::ast::{AssignmentTarget, BindingPattern};
    let (current, parent) = peel_wrappers(span, &mut ancestors);
    let unfollowed = |what: &str| Some(what.to_string());
    match parent? {
        AstKind::JSXMemberExpression(_)
        | AstKind::JSXOpeningElement(_)
        | AstKind::JSXClosingElement(_)
        | AstKind::JSXSpreadAttribute(_)
        | AstKind::ExportSpecifier(_)
        | AstKind::ExportDefaultDeclaration(_)
        | AstKind::UnaryExpression(_)
        | AstKind::BinaryExpression(_) => None,
        AstKind::StaticMemberExpression(member) if member.object.span() == current => {
            member_use(&format!("its member {}", member.property.name), member.span, ancestors)
        }
        AstKind::ComputedMemberExpression(member) if member.object.span() == current => {
            member_use("a computed member", member.span, ancestors)
        }
        AstKind::SpreadElement(_) => match ancestors.next() {
            Some(AstKind::ObjectExpression(_)) => None,
            _ => unfollowed("is spread into a call or an array"),
        },
        AstKind::CallExpression(call) if call.callee.span() == current => unfollowed("is called"),
        AstKind::CallExpression(call) => {
            let callee = crate::chain_walk::unwrap_type_assertions(&call.callee);
            let object_function = match callee {
                Expression::StaticMemberExpression(member)
                    if global_object && member.object.is_specific_id("Object") =>
                {
                    Some(member.property.name.as_str())
                }
                _ => None,
            };
            let first = call.arguments.first().map(GetSpan::span) == Some(current);
            match object_function {
                // An assigned facade's own initializer builds it.
                Some("assign") if first && assigned_target && initializes_top_level_const(call.span, &mut ancestors) => None,
                Some("assign") if first => unfollowed("is the target of Object.assign()"),
                Some("assign" | "freeze" | "keys" | "hasOwn" | "values" | "entries") => None,
                _ => Some(match callee {
                    Expression::Identifier(id) => format!("is passed to {}()", id.name),
                    Expression::StaticMemberExpression(member) => {
                        format!("is passed to {}()", member.property.name)
                    }
                    _ => "is passed to a call".to_string(),
                }),
            }
        }
        parent @ AstKind::VariableDeclarator(declarator)
            if declarator.init.as_ref().map(GetSpan::span) == Some(current) =>
        {
            match &declarator.id {
                BindingPattern::ObjectPattern(_) => None,
                BindingPattern::BindingIdentifier(_)
                    if alias
                        && initializes_top_level_const(current, std::iter::once(parent).chain(ancestors)) =>
                {
                    None
                }
                _ => unfollowed("is assigned to a variable"),
            }
        }
        // A destructuring assignment reads members, then yields the object.
        AstKind::AssignmentExpression(assignment) if assignment.right.span() == current => {
            match &assignment.left {
                AssignmentTarget::ObjectAssignmentTarget(_) => {
                    object_use(assignment.span, ancestors, false, global_object, false)
                }
                _ => unfollowed("is assigned to a variable"),
            }
        }
        // A concise arrow body is the arrow's return value, which the call
        // hands on (`() => pad`, `.then(() => pad)`); a statement discards it.
        AstKind::ArrowFunctionExpression(_) => unfollowed("is returned from a function"),
        AstKind::ExpressionStatement(_) => None,
        AstKind::ForInStatement(statement) if statement.right.span() == current => None,
        // An assigned facade's own sources may name it.
        AstKind::ObjectProperty(_) if assigned_target && in_own_assign_source(&mut ancestors, global_object) => None,
        AstKind::ObjectProperty(_) => unfollowed("is stored in an object"),
        AstKind::ArrayExpression(_) => unfollowed("is stored in an array"),
        AstKind::JSXExpressionContainer(_) => unfollowed("is passed as a prop"),
        _ => unfollowed("is used where the extractor does not follow it"),
    }
}

/// Whether the object property just left sits in an object literal that is
/// a source of an `Object.assign` call initializing a top-level `const`:
/// the assigned facade's own initializer. `ancestors` runs from the
/// property's parent out.
fn in_own_assign_source<'b, 'a: 'b>(ancestors: &mut impl Iterator<Item = &'b AstKind<'a>>, global_object: bool) -> bool {
    let Some(AstKind::ObjectExpression(object)) = ancestors.next() else {
        return false;
    };
    let (current, parent) = peel_wrappers(object.span, ancestors);
    let Some(AstKind::CallExpression(call)) = parent else {
        return false;
    };
    let object_assign = matches!(crate::chain_walk::unwrap_type_assertions(&call.callee),
        Expression::StaticMemberExpression(member)
            if global_object && member.object.is_specific_id("Object") && member.property.name == "assign");
    object_assign
        && call.arguments.iter().skip(1).any(|argument| argument.span() == current)
        && initializes_top_level_const(call.span, ancestors)
}

/// What a use of one member of an object (`X.key`, at `span`) may do to
/// the object: replace or delete the member, or call it as a method.
fn member_use<'b, 'a: 'b>(
    noun: &str,
    span: oxc::span::Span,
    ancestors: impl Iterator<Item = &'b AstKind<'a>>,
) -> Option<String> {
    member_effect(span, ancestors).map(|effect| match effect {
        MemberEffect::Assigned => format!("has {noun} assigned"),
        MemberEffect::Deleted => format!("has {noun} deleted"),
        MemberEffect::Method => format!("has {noun} called as a method"),
    })
}

/// What a member expression at `span` does to the object holding it.
#[derive(Clone, Copy)]
enum MemberEffect {
    Assigned,
    Deleted,
    /// Called, so the call gets the holder as `this`.
    Method,
}

fn member_effect<'b, 'a: 'b>(
    span: oxc::span::Span,
    mut ancestors: impl Iterator<Item = &'b AstKind<'a>>,
) -> Option<MemberEffect> {
    let (current, parent) = peel_wrappers(span, &mut ancestors);
    match parent? {
        AstKind::AssignmentExpression(assignment) if assignment.left.span() == current => Some(MemberEffect::Assigned),
        AstKind::UpdateExpression(_)
        | AstKind::ArrayAssignmentTarget(_)
        | AstKind::AssignmentTargetRest(_)
        | AstKind::AssignmentTargetWithDefault(_)
        | AstKind::AssignmentTargetPropertyProperty(_) => Some(MemberEffect::Assigned),
        AstKind::ForInStatement(statement) if statement.left.span() == current => Some(MemberEffect::Assigned),
        AstKind::ForOfStatement(statement) if statement.left.span() == current => Some(MemberEffect::Assigned),
        AstKind::UnaryExpression(unary)
            if unary.operator == oxc::syntax::operator::UnaryOperator::Delete =>
        {
            Some(MemberEffect::Deleted)
        }
        AstKind::CallExpression(call) if call.callee.span() == current => Some(MemberEffect::Method),
        AstKind::TaggedTemplateExpression(tagged) if tagged.tag.span() == current => Some(MemberEffect::Method),
        _ => None,
    }
}

/// A module-scope function component, not exported, whose props reach the
/// components it renders only through `{...props}` (or `{...rest}`) spreads
/// usage tracking can follow: its renders stand in for those components'.
#[derive(Debug, Clone, Default)]
pub struct SpreadWrapper {
    /// Props the parameter names in its pattern; they never reach a spread.
    pub named: Vec<String>,
    /// Each element receiving the spread. An element with a second spread
    /// is not listed.
    pub forwarding: Vec<Forwarding>,
    /// Attributes of those elements that pass a named prop on.
    pub passed: Vec<PassThrough>,
    /// Forwarding elements whose spread may carry nothing (`const rest =
    /// visible ? props : {}`): each also renders its target with only its
    /// own attributes.
    pub may_omit: Vec<(u32, u32)>,
    /// How many `.asComponent(W)` calls hand it to a component, which then
    /// renders it with the props its own renders forward.
    pub targeted: usize,
    /// How many members of top-level `const` object literals hold it
    /// (`const Code = { Header: CodeHeader }`): a `<Code.Header>` render is
    /// one of its renders.
    pub held: usize,
    /// Keys of its props the body reads where the value can be handed on or
    /// changed (`f(props.p)`): a value the spread forwards there may change
    /// after a render wrote it.
    pub handed_on: BTreeSet<String>,
}

/// A forwarding-element attribute whose whole value is a named prop
/// (`size={size}`): it takes what each render writes for the prop, or the
/// prop's default when a render leaves it out.
#[derive(Debug, Clone)]
pub struct PassThrough {
    /// The forwarding element's opening-element span.
    pub element: (u32, u32),
    /// The attribute as the element writes it.
    pub attr: String,
    /// The prop as renders write it: the key in the parameter pattern.
    pub key: String,
    /// The string default in the pattern; `None` without one, so the
    /// element passes `undefined` and the target uses its own default.
    pub default: Option<String>,
}

/// An element a spread wrapper forwards its props to: its opening-element
/// span and its tag as written.
pub type Forwarding = ((u32, u32), String);

/// A wrapper candidate by shape alone: name, binding, the spread parameter
/// (the props identifier or the rest element), and the named props.
struct WrapperCandidate<'b, 'a> {
    name: String,
    binding: &'b oxc::ast::ast::BindingIdentifier<'a>,
    spread: &'b oxc::ast::ast::BindingIdentifier<'a>,
    named: Vec<NamedProp<'b, 'a>>,
}

/// A prop the parameter pattern names: its key, its local binding, and its
/// default: `Some(None)` without one, `None` when it is not a string literal.
struct NamedProp<'b, 'a> {
    key: String,
    binding: &'b oxc::ast::ast::BindingIdentifier<'a>,
    default: Option<Option<String>>,
}

/// Top-level, non-exported `const`/`let`/`var` declarators and function
/// declarations that are a function component, or one wrapped in
/// `forwardRef`/`memo` imported from `react`, whose first parameter is an
/// identifier or an object pattern with an identifier rest, static keys and
/// no non-empty default.
fn spread_wrapper_candidates<'b, 'a>(program: &'b Program<'a>) -> Vec<WrapperCandidate<'b, 'a>> {
    use oxc::ast::ast::{BindingPattern, Function};
    let mut react_hocs: FxHashSet<String> = FxHashSet::default();
    let mut react_namespaces: FxHashSet<String> = FxHashSet::default();
    for stmt in &program.body {
        let Statement::ImportDeclaration(import) = stmt else { continue };
        if import.source.value != "react" {
            continue;
        }
        for specifier in import.specifiers.iter().flatten() {
            match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named)
                    if matches!(named.imported.name().as_str(), "forwardRef" | "memo") =>
                {
                    react_hocs.insert(named.local.name.to_string());
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                    react_namespaces.insert(default.local.name.to_string());
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                    react_namespaces.insert(namespace.local.name.to_string());
                }
                _ => {}
            }
        }
    }
    // The component function, through `forwardRef`/`memo` from `react` only.
    fn component<'b, 'a>(
        expr: &'b Expression<'a>,
        hocs: &FxHashSet<String>,
        namespaces: &FxHashSet<String>,
    ) -> Option<&'b oxc::ast::ast::FormalParameters<'a>> {
        match crate::chain_walk::unwrap_type_assertions(expr) {
            Expression::ArrowFunctionExpression(arrow) => Some(&arrow.params),
            Expression::FunctionExpression(function) => Some(&function.params),
            Expression::CallExpression(call) if call.arguments.len() == 1 => {
                let react = match crate::chain_walk::unwrap_type_assertions(&call.callee) {
                    Expression::Identifier(id) => hocs.contains(id.name.as_str()),
                    Expression::StaticMemberExpression(member) => {
                        matches!(member.property.name.as_str(), "forwardRef" | "memo")
                            && matches!(&member.object, Expression::Identifier(object)
                                if namespaces.contains(object.name.as_str()))
                    }
                    _ => false,
                };
                if !react {
                    return None;
                }
                component(call.arguments[0].as_expression()?, hocs, namespaces)
            }
            _ => None,
        }
    }
    let candidate = |name: &'b oxc::ast::ast::BindingIdentifier<'a>,
                     params: &'b oxc::ast::ast::FormalParameters<'a>|
     -> Option<WrapperCandidate<'b, 'a>> {
        let param = params.items.first()?;
        // React always passes props, so only a direct call, which escapes,
        // could use a default; an empty one changes nothing either way.
        let empty = |default: &Expression<'a>| {
            matches!(default, Expression::ObjectExpression(object) if object.properties.is_empty())
        };
        if param.initializer.as_deref().is_some_and(|default| !empty(default)) {
            return None;
        }
        let (spread, named) = match &param.pattern {
            BindingPattern::BindingIdentifier(id) => (id.as_ref(), Vec::new()),
            BindingPattern::ObjectPattern(object) => {
                let BindingPattern::BindingIdentifier(rest) = &object.rest.as_ref()?.argument
                else {
                    return None;
                };
                let mut named = Vec::new();
                for property in &object.properties {
                    let (value, default) = match &property.value {
                        BindingPattern::AssignmentPattern(assignment) => (
                            &assignment.left,
                            match &assignment.right {
                                Expression::StringLiteral(literal) => {
                                    Some(Some(literal.value.to_string()))
                                }
                                _ => None,
                            },
                        ),
                        value => (value, Some(None)),
                    };
                    let BindingPattern::BindingIdentifier(binding) = value else {
                        return None;
                    };
                    named.push(NamedProp {
                        // An unknown (computed) key gives up: `static_name` has none.
                        key: property.key.static_name()?.to_string(),
                        binding,
                        default,
                    });
                }
                (rest.as_ref(), named)
            }
            _ => return None,
        };
        Some(WrapperCandidate {
            name: name.name.to_string(),
            binding: name,
            spread,
            named,
        })
    };
    let function = |function: &'b Function<'a>| {
        function
            .id
            .as_ref()
            .and_then(|id| candidate(id, &function.params))
    };
    let mut candidates = Vec::new();
    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(declaration) => {
                for declarator in &declaration.declarations {
                    let (oxc::ast::ast::BindingPattern::BindingIdentifier(id), Some(init)) =
                        (&declarator.id, &declarator.init)
                    else {
                        continue;
                    };
                    if let Some(params) = component(init, &react_hocs, &react_namespaces) {
                        candidates.extend(candidate(id, params));
                    }
                }
            }
            Statement::FunctionDeclaration(declaration) => candidates.extend(function(declaration)),
            _ => {}
        }
    }
    candidates
}

/// The candidates that survive every reference check, with their forwarding
/// elements. A wrapper binding may be used only as a JSX tag name, as the
/// one argument of an `.asComponent()` call, or as a member of a top-level
/// `const` object literal, and is never reassigned; its
/// spread parameter may be used only as a whole JSX spread argument or a
/// read of one of its members that is no call.
fn spread_wrappers(
    program: &Program<'_>,
    scoping: &Scoping,
    candidates: Vec<WrapperCandidate<'_, '_>>,
) -> BTreeMap<String, SpreadWrapper> {
    let mut scan = WrapperScan {
        scoping,
        bindings: FxHashMap::default(),
        spreads: FxHashMap::default(),
        named: FxHashMap::default(),
        invalid: FxHashSet::default(),
        forwarding: FxHashMap::default(),
        passed: FxHashMap::default(),
        targeted: FxHashMap::default(),
        held: FxHashMap::default(),
        handed_on: FxHashMap::default(),
        aliases: FxHashMap::default(),
        may_omit: FxHashMap::default(),
        referenced: FxHashSet::default(),
        ancestors: Vec::new(),
    };
    for (index, candidate) in candidates.iter().enumerate() {
        let (Some(binding), Some(spread)) = (
            candidate.binding.symbol_id.get(),
            candidate.spread.symbol_id.get(),
        ) else {
            scan.invalid.insert(index);
            continue;
        };
        if scoping.symbol_is_mutated(binding) || scoping.symbol_is_mutated(spread) {
            scan.invalid.insert(index);
        }
        scan.bindings.insert(binding, index);
        scan.spreads.insert(spread, index);
        // A named prop the body reassigns no longer holds what renders pass.
        for prop in &candidate.named {
            if let (Some(symbol), Some(default)) = (prop.binding.symbol_id.get(), &prop.default) {
                if !scoping.symbol_is_mutated(symbol) {
                    scan.named
                        .insert(symbol, (index, prop.key.clone(), default.clone()));
                }
            }
        }
    }
    scan.visit_program(program);
    candidates
        .into_iter()
        .enumerate()
        .filter(|(index, _)| !scan.invalid.contains(index))
        .filter_map(|(index, candidate)| {
            let forwarding = scan.forwarding.remove(&index)?;
            let passed = scan
                .passed
                .remove(&index)
                .unwrap_or_default()
                .into_iter()
                .filter(|pass| forwarding.iter().any(|(span, _)| *span == pass.element))
                .collect();
            Some((
                candidate.name,
                SpreadWrapper {
                    named: candidate.named.into_iter().map(|prop| prop.key).collect(),
                    forwarding,
                    passed,
                    targeted: scan.targeted.get(&index).copied().unwrap_or_default(),
                    held: scan.held.get(&index).copied().unwrap_or_default(),
                    handed_on: scan.handed_on.remove(&index).unwrap_or_default(),
                    may_omit: scan.may_omit.remove(&index).unwrap_or_default(),
                },
            ))
        })
        .collect()
}

/// Whether the object property just left is a member of an object literal
/// that initializes a top-level `const`. `ancestors` runs from the
/// property's parent out.
fn initializes_top_level_object<'b, 'a: 'b>(ancestors: &mut impl Iterator<Item = &'b AstKind<'a>>) -> bool {
    let Some(AstKind::ObjectExpression(object)) = ancestors.next() else {
        return false;
    };
    let initializes = matches!(ancestors.next(), Some(AstKind::VariableDeclarator(declarator))
        if declarator.init.as_ref().is_some_and(|init| init.span() == object.span));
    initializes
        && matches!(ancestors.next(), Some(AstKind::VariableDeclaration(declaration))
            if declaration.kind == oxc::ast::ast::VariableDeclarationKind::Const)
        && matches!(ancestors.next(), Some(AstKind::Program(_) | AstKind::ExportDeclaration(_)))
}

struct WrapperScan<'a, 's> {
    scoping: &'s Scoping,
    /// Wrapper binding symbol → candidate index.
    bindings: FxHashMap<SymbolId, usize>,
    /// Spread parameter symbol → candidate index.
    spreads: FxHashMap<SymbolId, usize>,
    /// Named-prop symbol that can pass on → candidate index, key, default.
    named: FxHashMap<SymbolId, (usize, String, Option<String>)>,
    invalid: FxHashSet<usize>,
    forwarding: FxHashMap<usize, Vec<Forwarding>>,
    /// Attributes whose whole value is a named prop, on any element.
    passed: FxHashMap<usize, Vec<PassThrough>>,
    /// Candidate index → `.asComponent()` calls that take it.
    targeted: FxHashMap<usize, usize>,
    /// Candidate index → top-level object literal members that hold it.
    held: FxHashMap<usize, usize>,
    /// Candidate index → keys of its props read where the value can be
    /// handed on or changed.
    handed_on: FxHashMap<usize, BTreeSet<String>>,
    /// A `const` the body initializes with the spread parameter or nothing,
    /// alternative by alternative → candidate index, and whether it may
    /// hold nothing.
    aliases: FxHashMap<SymbolId, (usize, bool)>,
    /// Candidate index → forwarding elements whose spread may carry nothing.
    may_omit: FxHashMap<usize, Vec<(u32, u32)>>,
    /// Every symbol a reference read so far reached, so an alias read before
    /// its declaration is known.
    referenced: FxHashSet<SymbolId>,
    ancestors: Vec<AstKind<'a>>,
}

impl WrapperScan<'_, '_> {
    /// Whether a reference at `span` is spread whole into an element, and
    /// that element when it is one of candidate `index`'s forwarding
    /// elements, which is recorded. An element with a second spread, or an
    /// unnamed tag, forwards to nothing usage tracking follows.
    fn spread_into(&mut self, span: oxc::span::Span, index: usize) -> Option<Option<(u32, u32)>> {
        let mut ancestors = self.ancestors.iter().rev();
        let Some(AstKind::JSXSpreadAttribute(spread)) = ancestors.next() else { return None };
        if spread.argument.span() != span {
            return None;
        }
        let Some(AstKind::JSXOpeningElement(element)) = ancestors.next() else { return None };
        let at = (element.span.start, element.span.end);
        let spreads = element
            .attributes
            .iter()
            .filter(|attr| matches!(attr, JSXAttributeItem::SpreadAttribute(_)))
            .count();
        let tag = match &element.name {
            JSXElementName::IdentifierReference(id) => Some(id.name.to_string()),
            JSXElementName::MemberExpression(member) => jsx_member_path(member),
            _ => None,
        };
        let (1, Some(tag)) = (spreads, tag) else { return Some(None) };
        self.forwarding.entry(index).or_default().push((at, tag));
        Some(Some(at))
    }

    /// The `const` the spread parameter `props`, read at `span`, initializes
    /// as one alternative of its value (`const rest = visible ? props :
    /// {}`), when every alternative is the props or a value that spreads
    /// nothing, and whether one spreads nothing.
    fn alias_initialized_by(&self, span: oxc::span::Span, props: SymbolId) -> Option<(SymbolId, bool)> {
        use oxc::ast::ast::LogicalOperator;
        let mut current = span;
        let mut ancestors = self.ancestors.iter().rev();
        let declarator = loop {
            match ancestors.next()? {
                AstKind::ParenthesizedExpression(expr) => current = expr.span,
                AstKind::TSAsExpression(expr) => current = expr.span,
                AstKind::TSSatisfiesExpression(expr) => current = expr.span,
                AstKind::TSNonNullExpression(expr) => current = expr.span,
                AstKind::TSTypeAssertion(expr) => current = expr.span,
                AstKind::ConditionalExpression(conditional) if conditional.test.span() != current => {
                    current = conditional.span;
                }
                AstKind::LogicalExpression(logical)
                    if logical.operator != LogicalOperator::And || logical.left.span() != current =>
                {
                    current = logical.span;
                }
                AstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|init| init.span() == current) =>
                {
                    break declarator;
                }
                _ => return None,
            }
        };
        if current == span {
            return None;
        }
        let Some(AstKind::VariableDeclaration(declaration)) = ancestors.next() else { return None };
        if declaration.kind != oxc::ast::ast::VariableDeclarationKind::Const {
            return None;
        }
        let oxc::ast::ast::BindingPattern::BindingIdentifier(alias) = &declarator.id else { return None };
        let mut kinds = Alternatives::default();
        Props { scoping: self.scoping, symbol: props }.alternatives(declarator.init.as_ref()?, &mut kinds);
        (kinds.props && !kinds.derived && !kinds.other).then_some((alias.symbol_id.get()?, kinds.omits))
    }
}

impl<'a> Visit<'a> for WrapperScan<'a, '_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        // `arguments` reaches the props object past every binding the scan
        // follows (`arguments[0].size = 'lg'`), so any wrapper around it
        // gives up.
        if ident.name == "arguments" {
            for kind in &self.ancestors {
                let binding = match kind {
                    AstKind::Function(function) => function.id.as_ref(),
                    AstKind::VariableDeclarator(declarator) => {
                        declarator.id.get_binding_identifier()
                    }
                    _ => None,
                };
                let index = binding
                    .and_then(|binding| binding.symbol_id.get())
                    .and_then(|symbol| self.bindings.get(&symbol));
                if let Some(&index) = index {
                    self.invalid.insert(index);
                }
            }
            return;
        }
        let Some(reference) = ident.reference_id.get().map(|id| self.scoping.get_reference(id)) else {
            return;
        };
        let Some(symbol) = reference.symbol_id() else { return };
        let mut ancestors = self.ancestors.iter().rev();
        if let Some(&index) = self.bindings.get(&symbol) {
            if !reference.is_value() {
                return;
            }
            match ancestors.next() {
                Some(AstKind::JSXOpeningElement(_) | AstKind::JSXClosingElement(_)) => {}
                Some(AstKind::CallExpression(call))
                    if call.arguments.len() == 1
                        && call.arguments[0].span() == ident.span
                        && matches!(&call.callee, Expression::StaticMemberExpression(member)
                            if member.property.name == "asComponent") =>
                {
                    *self.targeted.entry(index).or_default() += 1;
                }
                Some(AstKind::ObjectProperty(property))
                    if property.value.span() == ident.span
                        && property.kind == oxc::ast::ast::PropertyKind::Init
                        && !property.computed
                        && initializes_top_level_object(&mut ancestors) =>
                {
                    *self.held.entry(index).or_default() += 1;
                }
                _ => {
                    self.invalid.insert(index);
                }
            }
            return;
        }
        if let Some((index, key, default)) = self.named.get(&symbol) {
            if let (
                Some(AstKind::JSXExpressionContainer(_)),
                Some(AstKind::JSXAttribute(attr)),
                Some(AstKind::JSXOpeningElement(element)),
            ) = (ancestors.next(), ancestors.next(), ancestors.next())
            {
                // The element records per attribute name, so an attribute it
                // writes twice keeps its own values.
                let written_once = |name: &str| {
                    let named = |item: &&JSXAttributeItem| match item {
                        JSXAttributeItem::Attribute(other) => matches!(
                            &other.name,
                            JSXAttributeName::Identifier(id) if id.name == name
                        ),
                        JSXAttributeItem::SpreadAttribute(_) => false,
                    };
                    element.attributes.iter().filter(named).count() == 1
                };
                if let JSXAttributeName::Identifier(name) = &attr.name {
                    if !written_once(&name.name) {
                        return;
                    }
                    self.passed.entry(*index).or_default().push(PassThrough {
                        element: (element.span.start, element.span.end),
                        attr: name.name.to_string(),
                        key: key.clone(),
                        default: default.clone(),
                    });
                }
            }
            return;
        }
        // A type query (`typeof rest`) reads no value at run time.
        if !reference.is_value() {
            return;
        }
        // An alias of the props is only ever spread whole into an element.
        if let Some(&(index, omits)) = self.aliases.get(&symbol) {
            match self.spread_into(ident.span, index) {
                Some(Some(element)) if omits => self.may_omit.entry(index).or_default().push(element),
                Some(_) => {}
                None => {
                    self.invalid.insert(index);
                }
            }
            return;
        }
        let Some(&index) = self.spreads.get(&symbol) else {
            self.referenced.insert(symbol);
            return;
        };
        if let Some((alias, omits)) = self.alias_initialized_by(ident.span, symbol) {
            // Read or written before here, the alias is not what the spread
            // carries.
            if self.referenced.contains(&alias) || self.scoping.symbol_is_mutated(alias) {
                self.invalid.insert(index);
            }
            self.aliases.insert(alias, (index, omits));
            return;
        }
        match ancestors.next() {
            Some(AstKind::JSXSpreadAttribute(spread)) if spread.argument.span() == ident.span => {
                if self.spread_into(ident.span, index).is_none() {
                    self.invalid.insert(index);
                }
            }
            // A read of one member (`props.title`), never written, and never
            // run with the props as `this`; one that can hand its value on is
            // recorded.
            Some(AstKind::StaticMemberExpression(member))
                if member.object.span() == ident.span
                    && !reference.flags().is_member_write_target()
                    && !reference.is_write()
                    && !runs_as_method(member.span, &mut ancestors) =>
            {
                // A read inside a function the body declares (a closure, a
                // method) runs wherever that function goes, so it hands the
                // value on too.
                let declared = self.scoping.symbol_span(symbol);
                let nested = self
                    .ancestors
                    .iter()
                    .rev()
                    .find_map(|kind| match kind {
                        AstKind::Function(function) => Some(function.params.span),
                        AstKind::ArrowFunctionExpression(arrow) => Some(arrow.params.span),
                        _ => None,
                    })
                    .is_some_and(|params| !(params.start <= declared.start && declared.end <= params.end));
                if nested || !stays_put(member.span, &mut self.ancestors.iter().rev().skip(1)) {
                    self.handed_on.entry(index).or_default().insert(member.property.name.to_string());
                }
            }
            _ => {
                self.invalid.insert(index);
            }
        }
    }
}

/// Visits every value reference to a module-scope binding that may name a
/// component, and records the ones usage tracking does not follow: a
/// reference that is not a JSX tag, an extracted `.extend()` base, a
/// `createElement` first argument, a named export, the target of a top-level
/// `const X = R` or `const X = Object.assign(R, …)`, or a member of a
/// `compose()` call. Such a component can render anywhere with any props: an
/// object member (`<Kit.Item>`) and an alias declared inside a function are
/// escapes, since usage follows neither. A member read records its dotted
/// path (`Card.Body`).
struct EscapeScan<'a, 's> {
    scoping: &'s Scoping,
    chains: &'s [&'s ChainDescriptor],
    react: &'s ReactNames,
    /// Namespace imports: `ui.Button` can name a component whatever the
    /// namespace is called.
    namespaces: BTreeSet<String>,
    /// Named and default imports: one may be a namespace another module
    /// re-exports, or a component whatever its name's case.
    imports: BTreeSet<String>,
    escapes: BTreeSet<String>,
    ancestors: Vec<AstKind<'a>>,
}

impl EscapeScan<'_, '_> {
    fn is_candidate(&self, name: &str) -> bool {
        name.starts_with(|c: char| c.is_ascii_uppercase())
            || self.namespaces.contains(name)
            || self.imports.contains(name)
            || self.chains.iter().any(|chain| chain.binding == name)
    }
}

impl<'a> Visit<'a> for EscapeScan<'a, '_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        let Some(reference) = ident.reference_id.get().map(|id| self.scoping.get_reference(id)) else {
            return;
        };
        let Some(symbol) = reference.symbol_id() else { return };
        if !reference.is_value()
            || self.scoping.symbol_scope_id(symbol) != self.scoping.root_scope_id()
        {
            return;
        }
        let name = self.scoping.symbol_name(symbol);
        if !self.is_candidate(name) {
            return;
        }
        let path = escape_path(name, ident.span, &self.ancestors, self.chains, self.react);
        if let Some(path) = path {
            self.escapes.insert(path);
        }
    }
}

/// The dotted path under which a reference escapes, or `None` when usage
/// tracking follows it. `ancestors` runs from the root to the parent.
fn escape_path(
    name: &str,
    span: oxc::span::Span,
    ancestors: &[AstKind<'_>],
    chains: &[&ChainDescriptor],
    react: &ReactNames,
) -> Option<String> {
    use oxc::span::GetSpan;
    let mut path = name.to_string();
    let mut current = span;
    let mut rest = ancestors.iter().rev();
    while let Some(parent) = rest.next() {
        match parent {
            kind if is_erased_wrapper(kind) => current = kind.span(),
            AstKind::JSXOpeningElement(_)
            | AstKind::JSXClosingElement(_)
            | AstKind::JSXMemberExpression(_)
            | AstKind::ExportSpecifier(_) => return None,
            AstKind::StaticMemberExpression(member) if member.object.span() == current => {
                let extracted_base = member.property.name == "extend"
                    && chains.iter().any(|chain| {
                        chain.extractable
                            && chain.extends_from.as_deref() == Some(name)
                            && chain.span.0 <= member.span.start
                            && member.span.end <= chain.span.1
                    });
                if extracted_base {
                    return None;
                }
                path.push('.');
                path.push_str(&member.property.name);
                current = member.span;
            }
            AstKind::CallExpression(call)
                if call.arguments.first().map(GetSpan::span) == Some(current) =>
            {
                // Followed only where usage records the render.
                if react.calls(&call.callee, "createElement") {
                    return None;
                }
                let callee = crate::chain_walk::unwrap_type_assertions(&call.callee);
                let object_assign = matches!(callee, Expression::StaticMemberExpression(member)
                    if member.object.is_specific_id("Object") && member.property.name == "assign");
                return (!(object_assign && initializes_top_level_const(call.span, rest))).then_some(path);
            }
            // `const B = R` at the top level is followed: `<B>` renders as `R`.
            // A destructuring declarator reads members, which nothing follows.
            AstKind::VariableDeclarator(declarator)
                if path == name
                    && matches!(declarator.id, oxc::ast::ast::BindingPattern::BindingIdentifier(_)) =>
            {
                return (!initializes_top_level_const(current, std::iter::once(parent).chain(rest)))
                    .then_some(path);
            }
            // A compose() family's slots render through its member tags; any
            // other object member is not followed.
            AstKind::ObjectProperty(property) if property.value.span() == current => {
                let Some(AstKind::ObjectExpression(object)) = rest.next() else {
                    return Some(path);
                };
                let slot = matches!(rest.next(), Some(AstKind::CallExpression(call))
                    if call.arguments.first().map(GetSpan::span) == Some(object.span)
                        && matches!(crate::chain_walk::unwrap_type_assertions(&call.callee), Expression::Identifier(id)
                            if matches!(id.name.as_str(), "compose" | "composeWithContext")));
                return (!slot).then_some(path);
            }
            _ => return Some(path),
        }
    }
    Some(path)
}

/// Whether the expression at `span` initializes a top-level `const`, given
/// the ancestors above it from the innermost out.
fn initializes_top_level_const<'b, 'a: 'b>(
    span: oxc::span::Span,
    mut ancestors: impl Iterator<Item = &'b AstKind<'a>>,
) -> bool {
    use oxc::ast::ast::VariableDeclarationKind;
    use oxc::span::GetSpan;
    let mut current = span;
    let declarator = loop {
        match ancestors.next() {
            Some(kind) if is_erased_wrapper(kind) => current = kind.span(),
            Some(AstKind::VariableDeclarator(declarator)) => break declarator,
            _ => return false,
        }
    };
    if declarator.init.as_ref().map(GetSpan::span) != Some(current) {
        return false;
    }
    let Some(AstKind::VariableDeclaration(declaration)) = ancestors.next() else {
        return false;
    };
    declaration.kind == VariableDeclarationKind::Const
        && match ancestors.next() {
            Some(AstKind::Program(_)) => true,
            Some(AstKind::ExportDeclaration(_)) => {
                matches!(ancestors.next(), Some(AstKind::Program(_)))
            }
            _ => false,
        }
}


/// Visits every value reference to a candidate component binding. The
/// binding stays confined only while each is the name of a JSX element
/// rendered in place, a closing name, or the base of an extracted `.extend()`
/// chain of this module; type positions are erased.
struct ConfinementScan<'a, 's> {
    scoping: &'s Scoping,
    chains: &'s [&'s ChainDescriptor],
    candidates: FxHashMap<SymbolId, &'s str>,
    escaped: FxHashSet<SymbolId>,
    ancestors: Vec<AstKind<'a>>,
}

impl<'a> Visit<'a> for ConfinementScan<'a, '_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        let Some(reference) = ident.reference_id.get().map(|id| self.scoping.get_reference(id)) else {
            return;
        };
        let Some(symbol) = reference.symbol_id() else { return };
        let Some(binding) = self.candidates.get(&symbol) else { return };
        if !reference.is_value() {
            return;
        }
        // Not walked further, so the innermost ancestor is the parent.
        let mut ancestors = self.ancestors.iter().rev();
        let confined = match ancestors.next() {
            Some(AstKind::JSXOpeningElement(_)) => rendered_in_place(ancestors.skip(1)),
            Some(AstKind::JSXClosingElement(_)) => true,
            Some(AstKind::StaticMemberExpression(member)) => {
                member.property.name == "extend"
                    && self.chains.iter().any(|chain| {
                        chain.extractable
                            && chain.extends_from.as_deref() == Some(*binding)
                            && chain.span.0 <= member.span.start
                            && member.span.end <= chain.span.1
                    })
            }
            _ => false,
        };
        if !confined {
            self.escaped.insert(symbol);
        }
    }
}

/// Whether an element, given its ancestors from the innermost out, reaches
/// React through a host element or a fragment: no component receives it as
/// children, a prop or a callback result, where it could clone props into it.
/// Anything inside another element's attributes goes to that element's
/// receiver, whatever encloses it there.
fn rendered_in_place<'b, 'a: 'b>(
    mut ancestors: impl Iterator<Item = &'b AstKind<'a>> + Clone,
) -> bool {
    if ancestors.clone().any(|kind| matches!(kind, AstKind::JSXOpeningElement(_))) {
        return false;
    }
    let enclosing = ancestors.find(|kind| {
        !matches!(
            kind,
            AstKind::JSXExpressionContainer(_)
                | AstKind::ParenthesizedExpression(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
        )
    });
    match enclosing {
        Some(AstKind::JSXFragment(_)) => true,
        Some(AstKind::JSXElement(host)) => matches!(
            host.opening_element.name,
            JSXElementName::Identifier(_) | JSXElementName::NamespacedName(_)
        ),
        _ => false,
    }
}

struct FactCollector<'a, 's> {
    facts: Vec<UsageFact>,
    /// The file's text: whether an element is written as JSX or as a call.
    source: &'a str,
    /// Inside what an assignment or `Object.assign` writes.
    writing: bool,
    static_values: crate::eval::Statics<'s>,
    scoping: Option<&'s Scoping>,
    enrich: bool,
    /// What calls React's `createElement` and `cloneElement`.
    react: ReactNames,
    /// Enriched collection only: the file's bindings and source, for
    /// `cloneElement` calls.
    clones: Option<CloneScan<'a, 's>>,
    /// Enriched collection only: the scopes a tag's origin is read from.
    origins: Option<&'s Scoping>,
    /// Enriched collection only: the values a parameter's literal-union type
    /// annotation admits.
    finite_params: FxHashMap<SymbolId, FiniteSet>,
    /// Enriched collection only: each rest parameter a `createElement`
    /// props object may spread, with the keys it can never carry.
    rests: FxHashMap<SymbolId, BTreeSet<String>>,
    /// Enriched collection only: see `TagOrigin::Provided`.
    provided: FxHashSet<SymbolId>,
    /// The kind of the declaration whose declarators are being visited.
    declaring: oxc::ast::ast::VariableDeclarationKind,
}

/// `cloneElement` calls, resolved once the walk has seen every `const`
/// bound to a JSX element.
struct CloneScan<'a, 's> {
    scoping: Option<&'s Scoping>,
    source: &'a str,
    /// `const` binding → the element tag it holds (`R`, `Kit.Item`).
    elements: FxHashMap<SymbolId, TagFact>,
    /// Calls whose first argument is an identifier.
    pending: Vec<PendingClone>,
}

/// A `cloneElement` call whose first argument names a binding: its symbol,
/// and the overrides, line and spelling either fact needs.
struct PendingClone {
    symbol: Option<SymbolId>,
    props: Option<Vec<(String, String)>>,
    line: usize,
    call: String,
    at: u32,
}

impl<'a> FactCollector<'a, '_> {
    /// Records one element's usage fact.
    fn record_element(&mut self, elem: &JSXOpeningElement<'a>, children: &[oxc::ast::ast::JSXChild<'a>]) {
        let (tag, root) = match &elem.name {
            JSXElementName::Identifier(id) => (TagFact::Ident(id.name.to_string()), None),
            JSXElementName::IdentifierReference(id) => (TagFact::Ident(id.name.to_string()), Some(&**id)),
            JSXElementName::MemberExpression(member) => {
                let Some(path) = jsx_member_path(member) else {
                    return;
                };
                (TagFact::Member(path), jsx_member_root(member))
            }
            _ => return,
        };
        let origin = root.and_then(|root| self.origin_of(root));
        let mut attrs = Vec::new();
        let mut spread = None;
        for attr_item in &elem.attributes {
            if let JSXAttributeItem::SpreadAttribute(spread_attribute) = attr_item {
                // A spread of object literals with listed literal entries
                // writes those entries, on the branches that hold them.
                match self.enrich.then(|| listed_spread(&spread_attribute.argument, self.origins)).flatten() {
                    Some(entries) => attrs.extend(entries.into_iter().map(|(name, value)| AttrFact {
                        variant_class: match &value {
                            Value::String(class) => class.clone(),
                            _ => "__dynamic__".to_string(),
                        },
                        conditions: (!value.is_object()).then(|| BTreeSet::from([BASE_CONDITION.to_string()])),
                        name,
                        static_value: Some(value),
                        enumerable_values: Vec::new(),
                        dynamic: false,
                        dynamic_kind: None,
                        dynamic_span: None,
                        skip: false,
                        literal: true,
                        optional: true,
                        at: spread_attribute.span.start,
                    })),
                    None => spread = Some(attrs.len()),
                }
            }
            if let JSXAttributeItem::Attribute(attr) = attr_item {
                let JSXAttributeName::Identifier(id) = &attr.name else {
                    continue;
                };
                let written = attribute_expression(&attr.value).map(crate::chain_walk::unwrap_type_assertions);
                // An explicit `undefined` is an omitted prop, as at runtime.
                if written.is_some_and(|expression| is_absent(expression, self.origins)) {
                    continue;
                }
                let (mut static_value, mut dynamic, mut dynamic_kind, mut dynamic_span, skip) =
                    match eval_jsx_attribute_value(&attr.value) {
                        PropValueResult::Static(v) => (Some(v), false, None, None, false),
                        PropValueResult::Dynamic { kind, span } => {
                            (None, true, Some(kind), Some(span), false)
                        }
                        PropValueResult::Skip => (None, false, None, None, true),
                    };
                let mut literal = static_value.is_some();
                let mut enumerable_values = Vec::new();
                if dynamic && self.enrich {
                    if let Some(expression) = attribute_expression(&attr.value) {
                        let expression = crate::chain_walk::unwrap_type_assertions(expression);
                        match expression {
                            Expression::Identifier(_)
                            | Expression::StaticMemberExpression(_)
                            | Expression::ComputedMemberExpression(_)
                            | Expression::ObjectExpression(_) => {
                                if let Some(value) = evaluate_with_statics(
                                    expression,
                                    self.static_values,
                                    self.scoping,
                                ) {
                                    static_value = Some(value);
                                    dynamic = false;
                                    dynamic_kind = None;
                                    dynamic_span = None;
                                }
                            }
                            Expression::ConditionalExpression(conditional) => {
                                let consequent = evaluate_with_statics(
                                    crate::chain_walk::unwrap_type_assertions(&conditional.consequent),
                                    self.static_values,
                                    self.scoping,
                                );
                                let alternate = evaluate_with_statics(
                                    crate::chain_walk::unwrap_type_assertions(&conditional.alternate),
                                    self.static_values,
                                    self.scoping,
                                );
                                if let (Some(consequent), Some(alternate)) = (consequent, alternate)
                                {
                                    push_unique(&mut enumerable_values, consequent);
                                    push_unique(&mut enumerable_values, alternate);
                                }
                            }
                            Expression::LogicalExpression(logical)
                                if logical.operator.is_or() || logical.operator.is_coalesce() =>
                            {
                                if let Some(value) = evaluate_with_statics(
                                    crate::chain_walk::unwrap_type_assertions(&logical.left),
                                    self.static_values,
                                    self.scoping,
                                ) {
                                    push_unique(&mut enumerable_values, value);
                                }
                                if let Some(value) = evaluate_with_statics(
                                    crate::chain_walk::unwrap_type_assertions(&logical.right),
                                    self.static_values,
                                    self.scoping,
                                ) {
                                    push_unique(&mut enumerable_values, value);
                                }
                            }
                            _ => {}
                        }
                        if let (true, Expression::ObjectExpression(object)) = (dynamic, expression) {
                            if let Some(value) =
                                without_absent_entries(object, self.static_values, self.scoping, self.origins)
                            {
                                literal = without_absent_entries(object, crate::eval::Statics::empty(), None, self.origins)
                                    .is_some();
                                static_value = Some(value);
                                dynamic = false;
                                dynamic_kind = None;
                                dynamic_span = None;
                            }
                        }
                        if dynamic {
                            // A runtime slot cannot carry `!important`, so a
                            // literal that carries it takes a static class from
                            // any branch extraction reads; only runtime values
                            // lose it.
                            important_literals(expression, self.static_values, self.scoping, &mut enumerable_values);
                        }
                        // A value proven to be one of a few literals takes
                        // their classes, as written literals do; one statics
                        // resolved is proven only when no leaf reads an
                        // object, which may have changed since.
                        match self.finite_class_values(expression) {
                            Some(values) if dynamic => {
                                if values.is_empty() {
                                    continue;
                                }
                                enumerable_values = values;
                                static_value = None;
                                dynamic = false;
                                dynamic_kind = None;
                                dynamic_span = None;
                                literal = true;
                            }
                            Some(_) => literal = true,
                            None => {}
                        }
                    }
                }
                // A nullish breakpoint is absent, as at runtime, and a value
                // with no breakpoint left is an omitted prop.
                if let Some(Value::Object(entries)) = &mut static_value {
                    entries.retain(|_, entry| !entry.is_null());
                    if entries.is_empty() {
                        continue;
                    }
                }
                // A value only statics resolve may be an object changed since.
                let conditions = match &static_value {
                    Some(value) if !dynamic => (!value.is_object()).then(|| BTreeSet::from([BASE_CONDITION.to_string()])),
                    _ => written.and_then(|expression| write_conditions(expression, self.origins)),
                };
                attrs.push(AttrFact {
                    name: id.name.to_string(),
                    static_value,
                    enumerable_values,
                    dynamic,
                    dynamic_kind,
                    dynamic_span,
                    skip,
                    variant_class: classify_jsx_attribute_as_variant_value(&attr.value),
                    literal,
                    conditions,
                    optional: false,
                    at: attr.span.start,
                });
            }
        }
        // The element's children are its `children` prop, written after every
        // attribute: they replace a `children` attribute or one a spread
        // delivers.
        attrs.extend(children_attribute(children));
        self.facts.push(UsageFact::Element {
            tag,
            attrs,
            spread,
            span: (elem.span.start, elem.span.end),
            origin,
            written_as_call: crate::lower_create_element::written_as_call(self.source, elem.span.start),
        });
    }
}

/// The `children` prop an element's children write, if it has any: a single
/// text on one line or a single string literal as itself, and anything else
/// as a value usage cannot list. Text of whitespace and line breaks, and an
/// empty `{}`, are no children, as in JSX.
fn children_attribute(children: &[oxc::ast::ast::JSXChild<'_>]) -> Option<AttrFact> {
    use oxc::ast::ast::{JSXChild, JSXExpression};
    let written: Vec<&JSXChild<'_>> = children
        .iter()
        .filter(|child| match child {
            JSXChild::Text(text) => !(text.value.trim().is_empty() && text.value.contains('\n')),
            JSXChild::ExpressionContainer(container) => {
                !matches!(container.expression, JSXExpression::EmptyExpression(_))
            }
            _ => true,
        })
        .collect();
    let first = written.first()?;
    let at = first.span().start;
    let end = written.last().map_or(at, |child| child.span().end);
    let literal = match written.as_slice() {
        // An entity (`&#109;`) reads as another character at runtime.
        [JSXChild::Text(text)] if !text.value.contains('\n') && !text.value.contains('&') => {
            Some(text.value.to_string())
        }
        [JSXChild::ExpressionContainer(container)] => match container.expression.as_expression().map(crate::chain_walk::unwrap_type_assertions) {
            Some(Expression::StringLiteral(literal)) => Some(literal.value.to_string()),
            _ => None,
        },
        _ => None,
    };
    Some(match literal {
        Some(value) => AttrFact {
            name: "children".to_string(),
            variant_class: value.clone(),
            static_value: Some(Value::String(value)),
            enumerable_values: Vec::new(),
            dynamic: false,
            dynamic_kind: None,
            dynamic_span: None,
            skip: false,
            literal: true,
            conditions: Some(BTreeSet::from([BASE_CONDITION.to_string()])),
            optional: false,
            at,
        },
        None => AttrFact {
            name: "children".to_string(),
            variant_class: "__dynamic__".to_string(),
            static_value: None,
            enumerable_values: Vec::new(),
            dynamic: true,
            dynamic_kind: Some(DynamicExpressionKind::Other),
            dynamic_span: Some(crate::jsx_scan::UsageSpan { start: at, end }),
            skip: false,
            literal: false,
            conditions: None,
            optional: false,
            at,
        },
    })
}

/// The entries a spread argument writes when every branch it can take is an
/// object literal of literal values under static keys, or nothing (`null`,
/// a boolean, an absent value): `{...(c ? { type: 'a' } : {})}`. A nullish
/// entry is left out, as at runtime. `None` for any other argument.
fn listed_spread(expression: &Expression<'_>, origins: Option<&Scoping>) -> Option<Vec<(String, Value)>> {
    use oxc::ast::ast::{ObjectPropertyKind, PropertyKind};
    use oxc::syntax::operator::LogicalOperator;
    let expression = crate::chain_walk::unwrap_type_assertions(expression);
    if is_absent(expression, origins) {
        return Some(Vec::new());
    }
    match expression {
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => Some(Vec::new()),
        Expression::ObjectExpression(object) => {
            let mut entries = Vec::new();
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else { return None };
                if property.kind != PropertyKind::Init || property.computed || property.method {
                    return None;
                }
                let key = eval_property_key(&property.key)?;
                if key == "__proto__" {
                    return None;
                }
                let value = eval_static_expression(&property.value)?;
                let value = match value {
                    Value::Null => continue,
                    Value::Object(mut breakpoints) => {
                        breakpoints.retain(|_, entry| !entry.is_null());
                        if breakpoints.is_empty() {
                            continue;
                        }
                        Value::Object(breakpoints)
                    }
                    value => value,
                };
                entries.push((key, value));
            }
            Some(entries)
        }
        Expression::ConditionalExpression(conditional) => {
            let mut entries = listed_spread(&conditional.consequent, origins)?;
            entries.extend(listed_spread(&conditional.alternate, origins)?);
            Some(entries)
        }
        // A falsy left side spreads nothing.
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            listed_spread(&logical.right, origins)
        }
        Expression::LogicalExpression(logical) => {
            let mut entries = listed_spread(&logical.left, origins)?;
            entries.extend(listed_spread(&logical.right, origins)?);
            Some(entries)
        }
        _ => None,
    }
}

/// The values a runtime value can take, when it is proven to be one of a
/// few: string and number literals, and whether it may also be absent.
#[derive(Debug, Clone, Default)]
struct FiniteSet {
    values: Vec<Value>,
    absent: bool,
}

impl FiniteSet {
    fn union(mut self, other: FiniteSet) -> FiniteSet {
        for value in other.values {
            push_unique(&mut self.values, value);
        }
        self.absent |= other.absent;
        self
    }

    fn falsy(&self) -> bool {
        self.absent || self.values.iter().any(|value| !truthy(value))
    }
}

/// A string or number, which a class can be keyed by.
fn is_class_value(value: &Value) -> bool {
    matches!(value, Value::String(_) | Value::Number(_))
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::String(text) => !text.is_empty(),
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        _ => true,
    }
}

impl FactCollector<'_, '_> {
    /// What a `createElement` props argument writes, when usage reads all of
    /// it: no argument, `null` or `undefined`, or an object literal of
    /// static keys whose only spreads are bounded rest parameters.
    fn create_writes(&self, argument: Option<&Argument<'_>>) -> Option<CreateWrites> {
        use oxc::ast::ast::{ObjectPropertyKind, PropertyKind};
        let scoping = self.origins?;
        let Some(argument) = argument else { return Some(CreateWrites::default()) };
        let expression = crate::chain_walk::unwrap_type_assertions(argument.as_expression()?);
        if matches!(expression, Expression::NullLiteral(_)) || is_absent(expression, self.origins) {
            return Some(CreateWrites::default());
        }
        let Expression::ObjectExpression(object) = expression else { return None };
        let mut writes = CreateWrites::default();
        for property in &object.properties {
            match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    if property.kind != PropertyKind::Init || property.computed || property.method {
                        return None;
                    }
                    let key = eval_property_key(&property.key)?;
                    if key == "__proto__" {
                        return None;
                    }
                    let value = crate::chain_walk::unwrap_type_assertions(&property.value);
                    // An explicit `undefined` is an omitted prop, as at runtime.
                    if is_absent(value, self.origins) {
                        continue;
                    }
                    let write = match eval_static_expression(value) {
                        Some(literal) => (key, Some(literal), None),
                        None => (key, None, write_conditions(value, self.origins)),
                    };
                    writes.props.push(write);
                }
                ObjectPropertyKind::SpreadProperty(spread) => {
                    let Expression::Identifier(id) = crate::chain_walk::unwrap_type_assertions(&spread.argument) else {
                        return None;
                    };
                    let symbol = id.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id())?;
                    let excluded = self.rests.get(&symbol)?;
                    // Two rests together can carry what either can.
                    writes.rest_excludes = Some(match writes.rest_excludes.take() {
                        Some(so_far) => so_far.intersection(excluded).cloned().collect(),
                        None => excluded.clone(),
                    });
                }
            }
        }
        Some(writes)
    }

    /// Where `root` is bound, as the file's scopes tell it.
    fn origin_of(&self, root: &IdentifierReference<'_>) -> Option<TagOrigin> {
        let scoping = self.origins?;
        let symbol = root.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id());
        Some(match tag_origin(scoping, root) {
            TagOrigin::Nested if symbol.is_some_and(|symbol| self.provided.contains(&symbol)) => TagOrigin::Provided,
            origin => origin,
        })
    }

    /// The values `expression` can take, when they are proven few: an
    /// explicitly absent value, a string or number literal, a `const` one
    /// named directly (imported ones included), a parameter whose type
    /// annotation is a union of literals, and a conditional, `||` or `??` of
    /// such values.
    fn finite_set(&self, expression: &Expression<'_>) -> Option<FiniteSet> {
        let expression = crate::chain_walk::unwrap_type_assertions(expression);
        if is_absent(expression, self.origins) || matches!(expression, Expression::NullLiteral(_)) {
            return Some(FiniteSet { values: Vec::new(), absent: true });
        }
        match expression {
            Expression::ConditionalExpression(conditional) => {
                Some(self.finite_set(&conditional.consequent)?.union(self.finite_set(&conditional.alternate)?))
            }
            Expression::LogicalExpression(logical) if logical.operator.is_or() || logical.operator.is_coalesce() => {
                let left = self.finite_set(&logical.left)?;
                let right = self.finite_set(&logical.right)?;
                let (reaches_right, values) = match logical.operator.is_or() {
                    true => (left.falsy(), left.values.into_iter().filter(truthy).collect()),
                    false => (left.absent, left.values),
                };
                let kept = FiniteSet { values, absent: false };
                Some(if reaches_right { kept.union(right) } else { kept })
            }
            Expression::Identifier(ident) => {
                let symbol = self
                    .origins
                    .and_then(|scoping| scoping.get_reference(ident.reference_id.get()?).symbol_id());
                if let Some(set) = symbol.and_then(|symbol| self.finite_params.get(&symbol)) {
                    return Some(set.clone());
                }
                let value = evaluate_with_statics(expression, self.static_values, self.scoping)?;
                is_class_value(&value).then(|| FiniteSet { values: vec![value], absent: false })
            }
            _ => Some(FiniteSet { values: vec![literal_value(expression)?], absent: false }),
        }
    }

    /// The literals whose classes stand for `expression`'s every value: a
    /// finite set's values, or for an object literal with static keys and
    /// finite leaves, each leaf value at its breakpoint (`{ sm: 8 }`) or,
    /// under `_`, bare; the runtime composes those classes. `None` when the
    /// values are not proven few.
    fn finite_class_values(&self, expression: &Expression<'_>) -> Option<Vec<Value>> {
        use oxc::ast::ast::{ObjectPropertyKind, PropertyKind};
        let expression = crate::chain_walk::unwrap_type_assertions(expression);
        let Expression::ObjectExpression(object) = expression else {
            return Some(self.finite_set(expression)?.values);
        };
        let mut values = Vec::new();
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            if property.kind != PropertyKind::Init || property.computed {
                return None;
            }
            let key = eval_property_key(&property.key)?;
            for value in self.finite_set(&property.value)?.values {
                push_unique(
                    &mut values,
                    match key.as_str() {
                        BASE_CONDITION => value,
                        _ => serde_json::json!({ key.as_str(): value }),
                    },
                );
            }
        }
        Some(values)
    }
}

/// Each parameter binding whose type annotation reads, without a type
/// checker, as a union of string and number literal types: a parameter's
/// own annotation, or a destructured property's, written inline or through
/// a type alias or interface the module declares. Its default joins the
/// values; an optional one may be absent. A binding something writes is
/// left out.
fn literal_union_parameters(program: &Program<'_>, scoping: &Scoping) -> FxHashMap<SymbolId, FiniteSet> {
    use oxc::ast::ast::{Declaration, TSType};
    let mut scan = ParameterScan {
        scoping,
        objects: FxHashMap::default(),
        unions: FxHashMap::default(),
        sets: FxHashMap::default(),
    };
    for statement in &program.body {
        let declaration = match statement {
            Statement::ExportDeclaration(export) => Some(&export.declaration),
            other => other.as_declaration(),
        };
        match declaration {
            Some(Declaration::TSInterfaceDeclaration(interface)) if interface.extends.is_empty() => {
                if let Some(symbol) = interface.id.symbol_id.get() {
                    let properties = scan.property_unions(&interface.body.body);
                    scan.objects.insert(symbol, properties);
                }
            }
            Some(Declaration::TSTypeAliasDeclaration(alias)) if alias.type_parameters.is_none() => {
                let Some(symbol) = alias.id.symbol_id.get() else { continue };
                match &alias.type_annotation {
                    TSType::TSTypeLiteral(literal) => {
                        let properties = scan.property_unions(&literal.members);
                        scan.objects.insert(symbol, properties);
                    }
                    annotation => {
                        if let Some(set) = scan.literal_union(annotation) {
                            scan.unions.insert(symbol, set);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    scan.visit_program(program);
    scan.sets
}

struct ParameterScan<'s> {
    scoping: &'s Scoping,
    /// The module's interfaces and object type aliases: each property's
    /// literal union, `None` for another type.
    objects: FxHashMap<SymbolId, FxHashMap<String, Option<FiniteSet>>>,
    /// The module's type aliases of a literal union.
    unions: FxHashMap<SymbolId, FiniteSet>,
    sets: FxHashMap<SymbolId, FiniteSet>,
}

impl ParameterScan<'_> {
    /// The module-level type a reference without type arguments names.
    fn named(&self, annotation: &oxc::ast::ast::TSType<'_>) -> Option<SymbolId> {
        use oxc::ast::ast::{TSType, TSTypeName};
        let TSType::TSTypeReference(reference) = annotation else { return None };
        let TSTypeName::IdentifierReference(name) = &reference.type_name else { return None };
        if reference.type_arguments.is_some() {
            return None;
        }
        self.scoping.get_reference(name.reference_id.get()?).symbol_id()
    }

    /// The values a union of string and number literal types admits, a
    /// literal-union alias among them; `null` and `undefined` members make
    /// the value possibly absent.
    fn literal_union(&self, annotation: &oxc::ast::ast::TSType<'_>) -> Option<FiniteSet> {
        use oxc::ast::ast::{TSLiteral, TSType};
        let members: Vec<&TSType<'_>> = match annotation {
            TSType::TSUnionType(union) => union.types.iter().collect(),
            other => vec![other],
        };
        let mut set = FiniteSet::default();
        for member in members {
            match member {
                TSType::TSUndefinedKeyword(_) | TSType::TSNullKeyword(_) => set.absent = true,
                TSType::TSLiteralType(literal) => {
                    let value = match &literal.literal {
                        TSLiteral::StringLiteral(text) => Value::String(text.value.to_string()),
                        TSLiteral::NumericLiteral(number) => make_json_number(number.value),
                        TSLiteral::UnaryExpression(unary)
                            if unary.operator == oxc::syntax::operator::UnaryOperator::UnaryNegation =>
                        {
                            let Expression::NumericLiteral(number) = &unary.argument else { return None };
                            make_json_number(-number.value)
                        }
                        _ => return None,
                    };
                    push_unique(&mut set.values, value);
                }
                other => set = set.union(self.unions.get(&self.named(other)?)?.clone()),
            }
        }
        (!set.values.is_empty() || set.absent).then_some(set)
    }

    /// Each property signature's literal union, `None` when it has another type.
    fn property_unions(&self, members: &[oxc::ast::ast::TSSignature<'_>]) -> FxHashMap<String, Option<FiniteSet>> {
        use oxc::ast::ast::TSSignature;
        members
            .iter()
            .filter_map(|member| match member {
                TSSignature::TSPropertySignature(signature) if !signature.computed => {
                    let set = signature.type_annotation.as_ref().and_then(|annotation| {
                        let mut set = self.literal_union(&annotation.type_annotation)?;
                        set.absent |= signature.optional;
                        Some(set)
                    });
                    Some((eval_property_key(&signature.key)?, set))
                }
                _ => None,
            })
            .collect()
    }

    fn record(
        &mut self,
        id: &oxc::ast::ast::BindingIdentifier<'_>,
        set: Option<FiniteSet>,
        default: Option<&Expression<'_>>,
    ) {
        let (Some(mut set), Some(symbol)) = (set, id.symbol_id.get()) else {
            return;
        };
        if self.scoping.symbol_is_mutated(symbol) {
            return;
        }
        if let Some(default) = default {
            let Some(value) = literal_value(default) else {
                return;
            };
            push_unique(&mut set.values, value);
        }
        self.sets.insert(symbol, set);
    }
}

impl<'a> Visit<'a> for ParameterScan<'_> {
    fn visit_formal_parameter(&mut self, parameter: &oxc::ast::ast::FormalParameter<'a>) {
        use oxc::ast::ast::{BindingPattern, TSType};
        if let Some(annotation) = parameter.type_annotation.as_ref() {
            match &parameter.pattern {
                BindingPattern::BindingIdentifier(id) => {
                    let set = self.literal_union(&annotation.type_annotation).map(|mut set| {
                        set.absent |= parameter.optional;
                        set
                    });
                    self.record(id, set, parameter.initializer.as_deref());
                }
                BindingPattern::ObjectPattern(object) => {
                    let properties = match &annotation.type_annotation {
                        TSType::TSTypeLiteral(literal) => Some(self.property_unions(&literal.members)),
                        other => self.named(other).and_then(|symbol| self.objects.get(&symbol).cloned()),
                    };
                    for property in object.properties.iter().filter(|property| !property.computed) {
                        let Some(key) = eval_property_key(&property.key) else { continue };
                        let set = properties.as_ref().and_then(|properties| properties.get(&key).cloned().flatten());
                        match &property.value {
                            BindingPattern::BindingIdentifier(id) => self.record(id, set, None),
                            BindingPattern::AssignmentPattern(assignment) => {
                                if let BindingPattern::BindingIdentifier(id) = &assignment.left {
                                    self.record(id, set, Some(&assignment.right));
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        oxc::ast_visit::walk::walk_formal_parameter(self, parameter);
    }
}

/// A string or number literal default.
fn literal_value(expression: &Expression<'_>) -> Option<Value> {
    eval_static_expression(expression).filter(is_class_value)
}

impl<'a, 's> Visit<'a> for FactCollector<'a, 's> {
    fn visit_static_member_expression(&mut self, member: &oxc::ast::ast::StaticMemberExpression<'a>) {
        if member.property.name == "defaultProps" {
            self.record_default_props(&member.object, member.span.start);
        }
        oxc::ast_visit::walk::walk_static_member_expression(self, member);
    }

    fn visit_computed_member_expression(&mut self, member: &oxc::ast::ast::ComputedMemberExpression<'a>) {
        let key = match &member.expression {
            Expression::StringLiteral(key) => Some(key.value.as_str()),
            Expression::TemplateLiteral(key) if key.expressions.is_empty() => {
                key.quasis.first().and_then(|quasi| quasi.value.cooked.as_ref()).map(|cooked| cooked.as_str())
            }
            _ => None,
        };
        if key == Some("defaultProps") {
            self.record_default_props(&member.object, member.span.start);
        }
        oxc::ast_visit::walk::walk_computed_member_expression(self, member);
    }

    fn visit_assignment_expression(&mut self, assignment: &oxc::ast::ast::AssignmentExpression<'a>) {
        let outer = std::mem::replace(&mut self.writing, true);
        self.visit_assignment_target(&assignment.left);
        self.writing = outer;
        self.visit_expression(&assignment.right);
    }

    fn visit_jsx_element(&mut self, element: &oxc::ast::ast::JSXElement<'a>) {
        self.record_element(&element.opening_element, &element.children);
        // An attribute value can hold JSX too, which is a use like a child.
        oxc::ast_visit::walk::walk_jsx_element(self, element);
    }

    fn visit_variable_declaration(&mut self, declaration: &oxc::ast::ast::VariableDeclaration<'a>) {
        let outer = std::mem::replace(&mut self.declaring, declaration.kind);
        oxc::ast_visit::walk::walk_variable_declaration(self, declaration);
        self.declaring = outer;
    }

    fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
        if let Some(clones) = &mut self.clones {
            if let (
                oxc::ast::ast::VariableDeclarationKind::Const,
                oxc::ast::ast::BindingPattern::BindingIdentifier(id),
                Some(init),
            ) = (self.declaring, &declarator.id, &declarator.init)
            {
                if let (Some(symbol), Expression::JSXElement(element)) =
                    (id.symbol_id.get(), init.get_inner_expression())
                {
                    if let Some(Some(tag)) = element_tag(&element.opening_element.name) {
                        clones.elements.insert(symbol, tag);
                    }
                }
            }
        }
        oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        // `Object.assign(X.defaultProps, …)` writes X's defaults.
        if let (Expression::StaticMemberExpression(callee), Some(Argument::StaticMemberExpression(target))) =
            (&call.callee, call.arguments.first())
        {
            let object_assign = callee.property.name == "assign"
                && matches!(&callee.object, Expression::Identifier(object) if object.name == "Object");
            if object_assign && target.property.name == "defaultProps" {
                let outer = std::mem::replace(&mut self.writing, true);
                self.record_default_props(&target.object, target.span.start);
                self.writing = outer;
            }
        }
        if self.react.calls(&call.callee, "createElement") {
            if let Some(first_arg) = call.arguments.first() {
                let (ident, member, identity_uncertain) = match first_arg {
                    Argument::Identifier(id) => (Some(id.name.to_string()), None, false),
                    Argument::StaticMemberExpression(m) => match static_member_path(m) {
                        Some(path) => (None, Some(path), false),
                        None => (None, None, true),
                    },
                    Argument::StringLiteral(_) => (None, None, false),
                    _ => (None, None, true),
                };
                let root = match first_arg {
                    Argument::Identifier(id) => Some(&**id),
                    Argument::StaticMemberExpression(m) => static_member_root(m),
                    _ => None,
                };
                self.facts.push(UsageFact::CreateElement {
                    ident,
                    member,
                    identity_uncertain,
                    props: create_element_props(call.arguments.get(1)),
                    literals: create_element_literals(call.arguments.get(1), self.origins),
                    writes: self.create_writes(call.arguments.get(1)),
                    clone: false,
                    at: call.span.start,
                    origin: root.and_then(|root| self.origin_of(root)),
                });
            }
        } else if self.react.calls(&call.callee, "cloneElement") {
            self.record_clone(call);
        }
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }
}

impl<'a> FactCollector<'a, '_> {
    /// `X.defaultProps` read or written: React gives X's renders those props
    /// wherever they leave one out.
    fn record_default_props(&mut self, object: &Expression<'a>, at: u32) {
        let (tag, root) = match object.get_inner_expression() {
            Expression::Identifier(id) => (TagFact::Ident(id.name.to_string()), &**id),
            Expression::StaticMemberExpression(member) => {
                match (static_member_path(member), static_member_root(member)) {
                    (Some(path), Some(root)) => (TagFact::Member(path), root),
                    _ => return,
                }
            }
            _ => return,
        };
        let origin = self.origin_of(root);
        let written = self.writing;
        self.facts.push(UsageFact::DefaultProps { tag, origin, at, written });
    }

    /// A `cloneElement` call: its overrides count for the cloned element's
    /// component when the first argument is a JSX element or a `const`
    /// bound to one, and for any component otherwise.
    fn record_clone(&mut self, call: &CallExpression<'a>) {
        let Some(clones) = &mut self.clones else {
            return;
        };
        let first = call.arguments.first().and_then(Argument::as_expression);
        let props = match first {
            Some(_) => create_element_props(call.arguments.get(1)),
            // `cloneElement(...args)`: neither the element nor the overrides.
            None => None,
        };
        let line = clones.source[..call.span.start as usize].matches('\n').count() + 1;
        let spelling =
            |span: oxc::span::Span| &clones.source[span.start as usize..span.end as usize];
        let callee = spelling(call.callee.span());
        let call_text = match call.arguments.first() {
            Some(argument) => format!("{callee}({}, …)", spelling(argument.span())),
            None => format!("{callee}()"),
        };
        let fact = match first.map(Expression::get_inner_expression) {
            Some(Expression::JSXElement(element)) => {
                match element_tag(&element.opening_element.name) {
                    Some(Some(tag)) => clone_of(tag, props, call.span.start),
                    // A host element takes no variant props.
                    None => return,
                    Some(None) => unknown_clone(props, line, call_text),
                }
            }
            Some(Expression::JSXFragment(_)) => return,
            Some(Expression::Identifier(id)) if clones.scoping.is_some() => {
                let symbol = clones
                    .scoping
                    .and_then(|scoping| scoping.get_reference(id.reference_id()).symbol_id());
                clones.pending.push(PendingClone {
                    symbol,
                    props,
                    line,
                    call: call_text,
                    at: call.span.start,
                });
                return;
            }
            _ => unknown_clone(props, line, call_text),
        };
        self.facts.extend(fact);
    }

    /// The facts, with the `cloneElement` calls whose first argument names a
    /// binding resolved now that every `const` element is known.
    fn finish(mut self) -> Vec<UsageFact> {
        if let Some(clones) = self.clones.take() {
            for pending in clones.pending {
                let fact = match pending.symbol.and_then(|symbol| clones.elements.get(&symbol)) {
                    Some(tag) => clone_of(tag.clone(), pending.props, pending.at),
                    None => unknown_clone(pending.props, pending.line, pending.call),
                };
                self.facts.extend(fact);
            }
        }
        self.facts
    }
}

/// The component an element tag names: `Some(None)` when it names one usage
/// cannot (`this.Item`), `None` for a host element.
fn element_tag(name: &JSXElementName<'_>) -> Option<Option<TagFact>> {
    match name {
        JSXElementName::IdentifierReference(id) => Some(Some(TagFact::Ident(id.name.to_string()))),
        JSXElementName::MemberExpression(member) => {
            Some(jsx_member_path(member).map(TagFact::Member))
        }
        JSXElementName::ThisExpression(_) => Some(None),
        JSXElementName::Identifier(_) | JSXElementName::NamespacedName(_) => None,
    }
}

/// The element's own fact carries its origin.
fn clone_of(tag: TagFact, props: Option<Vec<(String, String)>>, at: u32) -> Option<UsageFact> {
    let (ident, member) = match tag {
        TagFact::Ident(name) => (Some(name), None),
        TagFact::Member(path) => (None, Some(path)),
    };
    Some(UsageFact::CreateElement {
        ident,
        member,
        identity_uncertain: false,
        props,
        literals: Vec::new(),
        writes: None,
        clone: true,
        at,
        origin: None,
    })
}

/// A clone without overrides adds nothing.
fn unknown_clone(
    props: Option<Vec<(String, String)>>,
    line: usize,
    call: String,
) -> Option<UsageFact> {
    (props.as_ref().is_none_or(|props| !props.is_empty()))
        .then_some(UsageFact::CloneUnknown { props, line, call })
}

/// The dotted path a static member chain rooted in an identifier is
/// written as (`Card.Body`, `ui.sub.R`).
fn static_member_path(member: &oxc::ast::ast::StaticMemberExpression<'_>) -> Option<String> {
    let object = match &member.object {
        Expression::Identifier(object) => object.name.to_string(),
        Expression::StaticMemberExpression(inner) => static_member_path(inner)?,
        _ => return None,
    };
    Some(format!("{object}.{}", member.property.name))
}

/// The identifier a static member chain starts with: `ui` in `ui.Kit.Item`.
pub(crate) fn static_member_root<'b, 'a>(
    member: &'b oxc::ast::ast::StaticMemberExpression<'a>,
) -> Option<&'b IdentifierReference<'a>> {
    match &member.object {
        Expression::Identifier(object) => Some(object),
        Expression::StaticMemberExpression(inner) => static_member_root(inner),
        _ => None,
    }
}

fn jsx_member_root<'b, 'a>(
    member: &'b oxc::ast::ast::JSXMemberExpression<'a>,
) -> Option<&'b IdentifierReference<'a>> {
    match &member.object {
        oxc::ast::ast::JSXMemberExpressionObject::IdentifierReference(id) => Some(id),
        oxc::ast::ast::JSXMemberExpressionObject::MemberExpression(inner) => jsx_member_root(inner),
        oxc::ast::ast::JSXMemberExpressionObject::ThisExpression(_) => None,
    }
}

/// Read from the reference's own symbol, so a parameter that shadows an
/// import is a parameter.
fn tag_origin(scoping: &Scoping, name: &IdentifierReference<'_>) -> TagOrigin {
    let symbol = name.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id());
    match symbol {
        None => TagOrigin::Undeclared,
        Some(symbol) if scoping.symbol_scope_id(symbol) != scoping.root_scope_id() => TagOrigin::Nested,
        Some(symbol) if scoping.symbol_flags(symbol).is_import() => TagOrigin::Import,
        Some(_) => TagOrigin::TopLevel,
    }
}

/// What a `createElement` props object usage reads in full writes: each
/// key with its literal, or `None` and the conditions a runtime value
/// writes; and, when it spreads a rest parameter, the keys that rest can
/// never carry, any other prop arriving through it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CreateWrites {
    pub props: Vec<(String, Option<Value>, Option<BTreeSet<String>>)>,
    pub rest_excludes: Option<BTreeSet<String>>,
}

/// Each rest parameter (`function F({ as, ...props })`) whose keys usage
/// can bound: every other key of its pattern is static, and it is only
/// spread or read through a static member, so nothing adds a key to it.
/// Mapped to the keys its pattern takes out of it.
fn rest_parameters(program: &Program<'_>, scoping: &Scoping) -> FxHashMap<SymbolId, BTreeSet<String>> {
    use oxc::ast::ast::BindingPattern;
    struct Rests<'a, 's> {
        scoping: &'s Scoping,
        rests: FxHashMap<SymbolId, BTreeSet<String>>,
        invalid: FxHashSet<SymbolId>,
        ancestors: Vec<AstKind<'a>>,
    }
    impl<'a> Rests<'a, '_> {
        fn params(&mut self, params: &oxc::ast::ast::FormalParameters<'a>) {
            let Some(BindingPattern::ObjectPattern(pattern)) = params.items.first().map(|param| &param.pattern) else {
                return;
            };
            let Some(rest) = &pattern.rest else { return };
            let BindingPattern::BindingIdentifier(binding) = &rest.argument else { return };
            let Some(symbol) = binding.symbol_id.get() else { return };
            let keys: Option<BTreeSet<String>> = pattern
                .properties
                .iter()
                .map(|property| property.key.static_name().filter(|_| !property.computed).map(|key| key.to_string()))
                .collect();
            match keys {
                Some(keys) if !self.scoping.symbol_is_mutated(symbol) => {
                    self.rests.insert(symbol, keys);
                }
                _ => {}
            }
        }
    }
    impl<'a> Visit<'a> for Rests<'a, '_> {
        fn enter_node(&mut self, kind: AstKind<'a>) {
            self.ancestors.push(kind);
        }
        fn leave_node(&mut self, _kind: AstKind<'a>) {
            self.ancestors.pop();
        }
        fn visit_function(&mut self, function: &oxc::ast::ast::Function<'a>, flags: oxc::semantic::ScopeFlags) {
            self.params(&function.params);
            oxc::ast_visit::walk::walk_function(self, function, flags);
        }
        fn visit_arrow_function_expression(&mut self, arrow: &oxc::ast::ast::ArrowFunctionExpression<'a>) {
            self.params(&arrow.params);
            oxc::ast_visit::walk::walk_arrow_function_expression(self, arrow);
        }
        fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
            let Some(reference) = ident.reference_id.get().map(|id| self.scoping.get_reference(id)) else { return };
            let Some(symbol) = reference.symbol_id() else { return };
            if !self.rests.contains_key(&symbol) {
                return;
            }
            let mut ancestors = self.ancestors.iter().rev();
            let (current, parent) = peel_wrappers(ident.span, &mut ancestors);
            // A copy of its own keys into an object literal or props, or a
            // static member read that nothing calls: any call through a
            // member, or an iterating spread, runs code with the rest as
            // its receiver.
            let read = match parent {
                Some(AstKind::SpreadElement(_)) => matches!(ancestors.next(), Some(AstKind::ObjectExpression(_))),
                Some(AstKind::JSXSpreadAttribute(_)) => true,
                Some(AstKind::StaticMemberExpression(member)) if member.object.span() == current => {
                    let (member_current, member_parent) = peel_wrappers(member.span, &mut ancestors);
                    !reference.flags().is_member_write_target()
                        && !matches!(member_parent,
                            Some(AstKind::CallExpression(call)) if call.callee.span() == member_current)
                        && !matches!(member_parent,
                            Some(AstKind::NewExpression(call)) if call.callee.span() == member_current)
                        && !matches!(member_parent,
                            Some(AstKind::TaggedTemplateExpression(tagged)) if tagged.tag.span() == member_current)
                }
                _ => false,
            };
            if !read {
                self.invalid.insert(symbol);
            }
        }
    }
    let mut rests = Rests { scoping, rests: FxHashMap::default(), invalid: FxHashSet::default(), ancestors: Vec::new() };
    rests.visit_program(program);
    let invalid = rests.invalid;
    rests.rests.retain(|symbol, _| !invalid.contains(symbol));
    rests.rests
}

/// A tag whose type a function's own prop chooses at runtime: `<As>` or
/// `createElement(as, …)` for `function F({ as })`, also `as ?? 'label'`.
/// `at` is the tag's or call's start, as the usage scan records the site.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PropTag {
    pub at: u32,
    /// The top-level function whose prop it is.
    pub function: String,
    pub prop: String,
}

/// How a module refers to one of its top-level or imported names: as the
/// one argument of `.asComponent()`, as a JSX tag, as a member of a
/// top-level `const` object literal, or any other way. An export of the
/// name counts as none of them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct NameUses {
    pub as_component: usize,
    pub jsx: usize,
    pub held: usize,
    pub other: usize,
}

/// The tags in `program` whose type a top-level function's destructured
/// prop chooses (`PropTag`), and how the module uses each module-scope
/// name, and each member of a namespace import (`ns.X`).
fn prop_tags_and_uses(
    program: &Program<'_>,
    scoping: &Scoping,
    react: &ReactNames,
) -> (Vec<PropTag>, BTreeMap<String, NameUses>, BTreeMap<String, NameUses>) {
    use oxc::ast::ast::{BindingPattern, Declaration};
    // Each prop binding a top-level function destructures from its first
    // parameter, with the function and the prop it names.
    let mut props: FxHashMap<SymbolId, (String, String)> = FxHashMap::default();
    let mut add = |name: &str, params: &oxc::ast::ast::FormalParameters<'_>| {
        let Some(BindingPattern::ObjectPattern(pattern)) = params.items.first().map(|param| &param.pattern) else {
            return;
        };
        for property in &pattern.properties {
            let Some(key) = property.key.static_name().filter(|_| !property.computed) else { continue };
            let binding = match &property.value {
                BindingPattern::BindingIdentifier(binding) => binding,
                // An omitted prop takes its default, which must name a host
                // element as well.
                BindingPattern::AssignmentPattern(assignment) => match &assignment.left {
                    BindingPattern::BindingIdentifier(binding)
                        if matches!(
                            crate::chain_walk::unwrap_type_assertions(&assignment.right),
                            Expression::StringLiteral(_)
                        ) =>
                    {
                        binding
                    }
                    _ => continue,
                },
                _ => continue,
            };
            if let Some(symbol) = binding.symbol_id.get().filter(|symbol| !scoping.symbol_is_mutated(*symbol)) {
                props.insert(symbol, (name.to_string(), key.to_string()));
            }
        }
    };
    for statement in &program.body {
        let declaration = match statement {
            Statement::ExportDeclaration(export) => Some(&export.declaration),
            other => other.as_declaration(),
        };
        match declaration {
            Some(Declaration::FunctionDeclaration(function)) => {
                if let Some(id) = &function.id {
                    add(&id.name, &function.params);
                }
            }
            Some(Declaration::VariableDeclaration(declaration)) => {
                for declarator in &declaration.declarations {
                    let (Some(name), Some(init)) = (declarator.id.get_identifier_name(), &declarator.init) else {
                        continue;
                    };
                    match crate::chain_walk::unwrap_type_assertions(init) {
                        Expression::ArrowFunctionExpression(arrow) => add(&name, &arrow.params),
                        Expression::FunctionExpression(function) => add(&name, &function.params),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    struct Scan<'a, 's> {
        scoping: &'s Scoping,
        react: &'s ReactNames,
        props: &'s FxHashMap<SymbolId, (String, String)>,
        namespaces: FxHashSet<SymbolId>,
        tags: Vec<PropTag>,
        uses: BTreeMap<String, NameUses>,
        members: BTreeMap<String, NameUses>,
        ancestors: Vec<AstKind<'a>>,
    }
    impl Scan<'_, '_> {
        fn prop(&self, expression: &Expression<'_>) -> Option<(String, String)> {
            let Expression::Identifier(id) = crate::chain_walk::unwrap_type_assertions(expression) else {
                return None;
            };
            let symbol = id.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id())?;
            self.props.get(&symbol).cloned()
        }
    }
    /// How the expression at `span` is used; `ancestors` runs from its
    /// parent out.
    fn count<'b, 'a: 'b>(span: oxc::span::Span, mut ancestors: impl Iterator<Item = &'b AstKind<'a>>, uses: &mut NameUses) {
        let (current, parent) = peel_wrappers(span, &mut ancestors);
        match parent {
            Some(AstKind::JSXOpeningElement(_) | AstKind::JSXClosingElement(_) | AstKind::JSXMemberExpression(_)) => {
                uses.jsx += 1;
            }
            Some(AstKind::ExportSpecifier(_)) => {}
            Some(AstKind::CallExpression(call))
                if call.arguments.len() == 1
                    && call.arguments[0].span() == current
                    && matches!(&call.callee, Expression::StaticMemberExpression(member)
                        if member.property.name == "asComponent") =>
            {
                uses.as_component += 1;
            }
            Some(AstKind::ObjectProperty(property))
                if property.value.span() == current
                    && property.kind == oxc::ast::ast::PropertyKind::Init
                    && !property.computed
                    && initializes_top_level_object(&mut ancestors) =>
            {
                uses.held += 1;
            }
            _ => uses.other += 1,
        }
    }
    impl<'a> Visit<'a> for Scan<'a, '_> {
        fn enter_node(&mut self, kind: AstKind<'a>) {
            self.ancestors.push(kind);
        }
        fn leave_node(&mut self, _kind: AstKind<'a>) {
            self.ancestors.pop();
        }
        fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
            if self.react.calls(&call.callee, "createElement") {
                let target = call.arguments.first().and_then(Argument::as_expression);
                let chosen = target.and_then(|target| match crate::chain_walk::unwrap_type_assertions(target) {
                    Expression::LogicalExpression(logical)
                        if !logical.operator.is_and()
                            && matches!(crate::chain_walk::unwrap_type_assertions(&logical.right), Expression::StringLiteral(_)) =>
                    {
                        self.prop(&logical.left)
                    }
                    target => self.prop(target),
                });
                if let Some((function, prop)) = chosen {
                    self.tags.push(PropTag { at: call.span.start, function, prop });
                }
            }
            oxc::ast_visit::walk::walk_call_expression(self, call);
        }
        fn visit_jsx_opening_element(&mut self, element: &oxc::ast::ast::JSXOpeningElement<'a>) {
            if let JSXElementName::IdentifierReference(id) = &element.name {
                let symbol = id.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id());
                if let Some((function, prop)) = symbol.and_then(|symbol| self.props.get(&symbol)).cloned() {
                    self.tags.push(PropTag { at: element.span.start, function, prop });
                }
            }
            oxc::ast_visit::walk::walk_jsx_opening_element(self, element);
        }
        fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
            let Some(reference) = ident.reference_id.get().map(|id| self.scoping.get_reference(id)) else { return };
            let Some(symbol) = reference.symbol_id() else { return };
            if !reference.is_value() || self.scoping.symbol_scope_id(symbol) != self.scoping.root_scope_id() {
                return;
            }
            let name = self.scoping.symbol_name(symbol).to_string();
            let mut ancestors = self.ancestors.iter().rev();
            if !self.namespaces.contains(&symbol) {
                count(ident.span, ancestors, self.uses.entry(name).or_default());
                return;
            }
            // `ns.X`: the member is the name used.
            let (current, parent) = peel_wrappers(ident.span, &mut ancestors);
            match parent {
                Some(AstKind::StaticMemberExpression(member)) if member.object.span() == current => {
                    let key = format!("{name}.{}", member.property.name);
                    count(member.span, ancestors, self.members.entry(key).or_default());
                }
                _ => self.uses.entry(name).or_default().other += 1,
            }
        }
    }
    let namespaces = program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::ImportDeclaration(import) => Some(import),
            _ => None,
        })
        .flat_map(|import| import.specifiers.iter().flatten())
        .filter(|specifier| matches!(specifier, ImportDeclarationSpecifier::ImportNamespaceSpecifier(_)))
        .filter_map(|specifier| specifier.local().symbol_id.get())
        .collect();
    let mut scan = Scan {
        scoping,
        react,
        props: &props,
        namespaces,
        tags: Vec::new(),
        uses: BTreeMap::new(),
        members: BTreeMap::new(),
        ancestors: Vec::new(),
    };
    scan.visit_program(program);
    (scan.tags, scan.uses, scan.members)
}

/// React's functions and namespaces a module imports, by the symbol each
/// import binds; a binding of any other origin, an unbound `React`
/// included, is never React's.
struct ReactImports {
    functions: FxHashMap<SymbolId, String>,
    namespaces: FxHashSet<SymbolId>,
}

impl ReactImports {
    fn of(program: &Program<'_>, scoping: &Scoping) -> Self {
        let mut imports = Self { functions: FxHashMap::default(), namespaces: FxHashSet::default() };
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else { continue };
            if !REACT_RUNTIMES.contains(&import.source.value.as_str()) {
                continue;
            }
            for specifier in import.specifiers.iter().flatten() {
                let Some(symbol) = specifier.local().symbol_id.get() else { continue };
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(named) => {
                        imports.functions.insert(symbol, named.imported.name().to_string());
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(_)
                    | ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {
                        imports.namespaces.insert(symbol);
                    }
                }
            }
        }
        // A namespace the module writes a member of (`React.createContext =
        // …`) no longer holds React's functions.
        struct Written<'s> {
            scoping: &'s Scoping,
            namespaces: &'s FxHashSet<SymbolId>,
            written: FxHashSet<SymbolId>,
        }
        impl<'a> Visit<'a> for Written<'_> {
            fn visit_simple_assignment_target(&mut self, target: &oxc::ast::ast::SimpleAssignmentTarget<'a>) {
                if let Some(member) = target.as_member_expression() {
                    if let Expression::Identifier(object) = member.object() {
                        let symbol = object.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id());
                        if let Some(symbol) = symbol.filter(|symbol| self.namespaces.contains(symbol)) {
                            self.written.insert(symbol);
                        }
                    }
                }
                oxc::ast_visit::walk::walk_simple_assignment_target(self, target);
            }
            fn visit_unary_expression(&mut self, unary: &oxc::ast::ast::UnaryExpression<'a>) {
                if unary.operator == oxc::syntax::operator::UnaryOperator::Delete {
                    if let Some(member) = unary.argument.as_member_expression() {
                        if let Expression::Identifier(object) = member.object() {
                            let symbol = object.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id());
                            if let Some(symbol) = symbol.filter(|symbol| self.namespaces.contains(symbol)) {
                                self.written.insert(symbol);
                            }
                        }
                    }
                }
                oxc::ast_visit::walk::walk_unary_expression(self, unary);
            }
        }
        let mut written = Written { scoping, namespaces: &imports.namespaces, written: FxHashSet::default() };
        written.visit_program(program);
        let written = written.written;
        imports.namespaces.retain(|symbol| !written.contains(symbol));
        imports
    }

    /// Whether `callee` calls one of React's `functions`, named or through a
    /// React namespace, as the module's scopes resolve it.
    fn calls(&self, scoping: &Scoping, callee: &Expression<'_>, functions: &[&str]) -> bool {
        let symbol = |id: &IdentifierReference<'_>| id.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id());
        match crate::chain_walk::unwrap_type_assertions(callee) {
            Expression::Identifier(id) => symbol(id)
                .and_then(|symbol| self.functions.get(&symbol))
                .is_some_and(|function| functions.contains(&function.as_str())),
            Expression::StaticMemberExpression(member) => {
                functions.contains(&member.property.name.as_str())
                    && matches!(&member.object, Expression::Identifier(object)
                        if symbol(object).is_some_and(|symbol| self.namespaces.contains(&symbol)))
            }
            _ => false,
        }
    }
}

/// Top-level `const` bindings the runtime's `createContext` builds: their
/// `Provider` renders its children in place.
fn context_consts(program: &Program<'_>, scoping: &Scoping, react: &ReactImports) -> BTreeSet<String> {
    use oxc::ast::ast::{Declaration, VariableDeclarationKind};
    let mut names = BTreeSet::new();
    for statement in &program.body {
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => declaration,
                _ => continue,
            },
            _ => continue,
        };
        if declaration.kind != VariableDeclarationKind::Const {
            continue;
        }
        for declarator in &declaration.declarations {
            let built = declarator.init.as_ref().is_some_and(|init| {
                matches!(crate::chain_walk::unwrap_type_assertions(init),
                    Expression::CallExpression(call) if react.calls(scoping, &call.callee, &["createContext"]))
            });
            if let (true, Some(name)) = (built, declarator.id.get_identifier_name()) {
                names.insert(name.to_string());
            }
        }
    }
    names
}

/// Top-level functions and classes, and `const` bindings of a function or
/// class expression, that nothing in the file writes: what a tag naming an
/// ordinary component is proved by. An ordinary default export is also
/// `default`.
fn ordinary_components(program: &Program<'_>, scoping: &Scoping) -> BTreeSet<String> {
    use oxc::ast::ast::{BindingIdentifier, Declaration, ExportDefaultDeclarationKind};
    // Direct eval can write any binding by name.
    if scoping.root_unresolved_references().contains_key("eval") {
        return BTreeSet::new();
    }
    let unwritten = |id: &BindingIdentifier<'_>| {
        id.symbol_id.get().is_some_and(|symbol| !scoping.symbol_is_mutated(symbol))
    };
    let mut names = BTreeSet::new();
    for statement in &program.body {
        let declaration = match statement {
            Statement::ExportDeclaration(export) => Some(&export.declaration),
            Statement::ExportDefaultDeclaration(export) => {
                let id = match &export.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) if function.body.is_some() => {
                        function.id.as_ref()
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => class.id.as_ref(),
                    ExportDefaultDeclarationKind::ArrowFunctionExpression(_)
                    | ExportDefaultDeclarationKind::FunctionExpression(_)
                    | ExportDefaultDeclarationKind::ClassExpression(_) => None,
                    _ => continue,
                };
                match id {
                    Some(id) if !unwritten(id) => continue,
                    Some(id) => {
                        names.insert(id.name.to_string());
                    }
                    None => {}
                }
                names.insert("default".to_string());
                continue;
            }
            statement => statement.as_declaration(),
        };
        let ids: Vec<&BindingIdentifier<'_>> = match declaration {
            Some(Declaration::FunctionDeclaration(function)) if function.body.is_some() => {
                function.id.iter().collect()
            }
            Some(Declaration::ClassDeclaration(class)) if !class.declare => class.id.iter().collect(),
            Some(Declaration::VariableDeclaration(variables))
                if variables.kind == oxc::ast::ast::VariableDeclarationKind::Const =>
            {
                variables
                    .declarations
                    .iter()
                    .filter_map(|declarator| match (&declarator.id, &declarator.init) {
                        (oxc::ast::ast::BindingPattern::BindingIdentifier(id), Some(init))
                            if matches!(
                                init.get_inner_expression(),
                                Expression::ArrowFunctionExpression(_)
                                    | Expression::FunctionExpression(_)
                                    | Expression::ClassExpression(_)
                            ) =>
                        {
                            Some(&**id)
                        }
                        _ => None,
                    })
                    .collect()
            }
            _ => Vec::new(),
        };
        names.extend(ids.into_iter().filter(|id| unwritten(id)).map(|id| id.name.to_string()));
    }
    names
}

/// React's `createElement` and `cloneElement` as a file can call them:
/// through an import from a recognised runtime, or as the unbound globals
/// `createElement`, `cloneElement` and `React`. Any other binding of such a
/// name is the file's own function, an ordinary call, so the escape scan
/// sees a component passed to it as a value.
#[derive(Clone)]
pub(crate) struct ReactNames {
    /// Local name → the runtime function it binds.
    functions: FxHashMap<String, &'static str>,
    /// Default and namespace imports of a runtime, and an unbound `React`.
    namespaces: FxHashSet<String>,
}

const REACT_RUNTIMES: [&str; 3] = ["react", "preact", "preact/compat"];
const ELEMENT_FUNCTIONS: [&str; 2] = ["createElement", "cloneElement"];

impl ReactNames {
    /// By spelling alone, for facts read without bindings.
    fn by_name() -> Self {
        Self {
            functions: ELEMENT_FUNCTIONS.iter().map(|name| (name.to_string(), *name)).collect(),
            namespaces: std::iter::once("React".to_string()).collect(),
        }
    }

    pub(crate) fn from_imports(program: &Program<'_>, scoping: &Scoping) -> Self {
        let mut names = Self {
            functions: FxHashMap::default(),
            namespaces: FxHashSet::default(),
        };
        for stmt in &program.body {
            let Statement::ImportDeclaration(import) = stmt else {
                continue;
            };
            if !REACT_RUNTIMES.contains(&import.source.value.as_str()) {
                continue;
            }
            for specifier in import.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(named) => {
                        let imported = named.imported.name();
                        let function = ELEMENT_FUNCTIONS
                            .iter()
                            .find(|function| **function == imported.as_str());
                        if let Some(function) = function {
                            names.functions.insert(named.local.name.to_string(), function);
                        }
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                        names.namespaces.insert(default.local.name.to_string());
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                        names.namespaces.insert(namespace.local.name.to_string());
                    }
                }
            }
        }
        // A name bound twice may be the file's own where it is called.
        let mut bound: FxHashMap<&str, usize> = FxHashMap::default();
        for name in scoping.symbol_names() {
            *bound.entry(name).or_default() += 1;
        }
        names.functions.retain(|local, _| bound.get(local.as_str()) == Some(&1));
        names.namespaces.retain(|local| bound.get(local.as_str()) == Some(&1));
        for function in ELEMENT_FUNCTIONS {
            if !bound.contains_key(function) {
                names.functions.insert(function.to_string(), function);
            }
        }
        if !bound.contains_key("React") {
            names.namespaces.insert("React".to_string());
        }
        names
    }

    /// Whether `callee` calls the runtime's `function`.
    pub(crate) fn calls(&self, callee: &Expression<'_>, function: &str) -> bool {
        match callee {
            Expression::Identifier(id) => self.functions.get(id.name.as_str()) == Some(&function),
            Expression::StaticMemberExpression(member) => {
                member.property.name == function
                    && matches!(&member.object, Expression::Identifier(object)
                        if self.namespaces.contains(object.name.as_str()))
            }
            _ => false,
        }
    }
}

/// Collect every candidate tag and createElement call, component-agnostic.
pub fn collect_usage_facts(program: &Program<'_>) -> Vec<UsageFact> {
    let static_values = crate::eval::Statics::empty();
    let mut collector = FactCollector {
        facts: Vec::new(),
        source: program.source_text,
        writing: false,
        static_values,
        scoping: None,
        enrich: false,
        react: ReactNames::by_name(),
        clones: None,
        origins: None,
        finite_params: FxHashMap::default(),
        provided: FxHashSet::default(),
        rests: FxHashMap::default(),
        declaring: oxc::ast::ast::VariableDeclarationKind::Var,
    };
    collector.visit_program(program);
    collector.finish()
}

pub fn collect_usage_facts_with_statics(
    program: &Program<'_>,
    module: &ModuleRecord<'_>,
    static_values: &FxHashMap<String, StaticValue>,
    module_path: &str,
) -> Vec<UsageFact> {
    let built = SemanticBuilder::new().build(program).semantic.into_scoping();
    collect_enriched_usage(built, program, module, static_values, module_path, &[], &[])
        .usage
}

fn attribute_expression<'a, 'b>(
    value: &'b Option<oxc::ast::ast::JSXAttributeValue<'a>>,
) -> Option<&'b Expression<'a>> {
    let Some(oxc::ast::ast::JSXAttributeValue::ExpressionContainer(container)) = value else {
        return None;
    };
    // `{}` holds no expression.
    container.expression.as_expression()
}

fn evaluate_with_statics(
    expression: &Expression<'_>,
    static_values: crate::eval::Statics<'_>,
    scoping: Option<&Scoping>,
) -> Option<Value> {
    if let Some(scoping) = scoping {
        let mut guard = StaticReferenceGuard {
            static_values,
            scoping,
            resolves_to_root_bindings: true,
        };
        guard.visit_expression(expression);
        if !guard.resolves_to_root_bindings {
            return None;
        }
    }
    if let Expression::ObjectExpression(object) = expression {
        let (value, skipped, captured) =
            crate::eval::eval_object_expr_with_statics(object, Some(static_values)).ok()?;
        return (skipped.is_empty() && captured.is_empty()).then(|| crate::eval::plain(&value));
    }
    let mut skipped = Vec::new();
    let value =
        crate::eval::eval_expression_with_statics(expression, &mut skipped, Some(static_values))
            .ok()?;
    skipped.is_empty().then(|| crate::eval::plain(&value))
}

/// Whether `expression` is an explicit `undefined`: `void 0`, or the global
/// `undefined`, which no binding shadows. Without scoping a reference cannot
/// be told from a shadowing binding, so it is not one.
pub(crate) fn is_absent(expression: &Expression<'_>, scoping: Option<&Scoping>) -> bool {
    let shadowed = match crate::chain_walk::unwrap_type_assertions(expression) {
        Expression::Identifier(ident) => !scoping.is_some_and(|scoping| {
            ident.reference_id.get().is_some_and(|reference| scoping.get_reference(reference).symbol_id().is_none())
        }),
        _ => false,
    };
    crate::eval::is_absent_value(expression, shadowed)
}

/// The condition a scalar value, or a responsive object's `_`, writes.
pub(crate) const BASE_CONDITION: &str = "_";

/// The conditions a runtime value can write, when its shape is known: a
/// value that cannot be an object (a template, a binary or unary
/// expression, a primitive literal) writes the base, `_`; an object literal
/// with static keys writes those keys, its explicitly absent entries
/// excepted; a conditional or logical expression writes what its operands
/// write. `None` for any other value, which may be any object.
fn write_conditions(expression: &Expression<'_>, origins: Option<&Scoping>) -> Option<BTreeSet<String>> {
    use oxc::ast::ast::{ObjectPropertyKind, PropertyKind};
    use oxc::syntax::operator::UnaryOperator;
    let expression = crate::chain_walk::unwrap_type_assertions(expression);
    if is_absent(expression, origins) || matches!(expression, Expression::NullLiteral(_)) {
        return Some(BTreeSet::new());
    }
    match expression {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::BinaryExpression(_) => Some(BTreeSet::from([BASE_CONDITION.to_string()])),
        Expression::UnaryExpression(unary) if unary.operator != UnaryOperator::Void => {
            Some(BTreeSet::from([BASE_CONDITION.to_string()]))
        }
        Expression::ConditionalExpression(conditional) => {
            let mut conditions = write_conditions(&conditional.consequent, origins)?;
            conditions.extend(write_conditions(&conditional.alternate, origins)?);
            Some(conditions)
        }
        Expression::LogicalExpression(logical) => {
            let mut conditions = write_conditions(&logical.left, origins)?;
            conditions.extend(write_conditions(&logical.right, origins)?);
            Some(conditions)
        }
        Expression::ObjectExpression(object) => {
            let mut conditions = BTreeSet::new();
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return None;
                };
                if property.kind != PropertyKind::Init || property.computed {
                    return None;
                }
                let value = crate::chain_walk::unwrap_type_assertions(&property.value);
                if is_absent(value, origins) || matches!(value, Expression::NullLiteral(_)) {
                    continue;
                }
                conditions.insert(eval_property_key(&property.key)?);
            }
            Some(conditions)
        }
        _ => None,
    }
}

/// A responsive object holding an explicit `undefined` entry, evaluated
/// without it; `None` when another entry does not evaluate statically.
/// `origins` tells the global `undefined` from a shadowing binding.
fn without_absent_entries(
    object: &oxc::ast::ast::ObjectExpression<'_>,
    static_values: crate::eval::Statics<'_>,
    scoping: Option<&Scoping>,
    origins: Option<&Scoping>,
) -> Option<Value> {
    use oxc::ast::ast::{ObjectPropertyKind, PropertyKind};
    let properties = object.properties.iter().map(|property| match property {
        ObjectPropertyKind::ObjectProperty(property) if property.kind == PropertyKind::Init && !property.computed => {
            Some(property)
        }
        _ => None,
    });
    let properties: Option<Vec<_>> = properties.collect();
    let properties = properties?;
    if !properties.iter().any(|property| is_absent(&property.value, origins)) {
        return None;
    }
    let mut entries = serde_json::Map::new();
    for property in properties.into_iter().filter(|property| !is_absent(&property.value, origins)) {
        let key = eval_property_key(&property.key)?;
        let value = evaluate_with_statics(crate::chain_walk::unwrap_type_assertions(&property.value), static_values, scoping)?;
        entries.insert(key, value);
    }
    Some(Value::Object(entries))
}

/// Static values are keyed by top-level names, so a reference may use one
/// only when it resolves to that root binding, never to a shadowing local.
struct StaticReferenceGuard<'s> {
    static_values: crate::eval::Statics<'s>,
    scoping: &'s Scoping,
    resolves_to_root_bindings: bool,
}

impl<'a> Visit<'a> for StaticReferenceGuard<'_> {
    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        if !self.static_values.contains(ident.name.as_str()) {
            return;
        }
        let root_symbol = self.scoping.get_root_binding(ident.name);
        let reference_symbol = ident
            .reference_id
            .get()
            .and_then(|id| self.scoping.get_reference(id).symbol_id());
        if root_symbol.is_none() || reference_symbol != root_symbol {
            self.resolves_to_root_bindings = false;
        }
    }
}

/// The literals `expression` may evaluate to that carry `!important`, in
/// either spelling: each branch of a conditional or logical expression, and
/// each entry of a responsive object, that evaluates statically. An entry
/// keeps its breakpoint, as a runtime entry's lookup spells it.
fn important_literals(
    expression: &Expression<'_>,
    static_values: crate::eval::Statics<'_>,
    scoping: Option<&Scoping>,
    literals: &mut Vec<Value>,
) {
    match crate::chain_walk::unwrap_type_assertions(expression) {
        Expression::ConditionalExpression(conditional) => {
            important_literals(&conditional.consequent, static_values, scoping, literals);
            important_literals(&conditional.alternate, static_values, scoping, literals);
        }
        Expression::LogicalExpression(logical) => {
            important_literals(&logical.left, static_values, scoping, literals);
            important_literals(&logical.right, static_values, scoping, literals);
        }
        Expression::ObjectExpression(object) => {
            for property in &object.properties {
                let oxc::ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                    continue;
                };
                let Some(breakpoint) = property.key.static_name().filter(|_| !property.computed) else {
                    continue;
                };
                let mut entries = Vec::new();
                important_literals(&property.value, static_values, scoping, &mut entries);
                for entry in entries.into_iter().filter(Value::is_string) {
                    let entry = if breakpoint == "_" { entry } else { serde_json::json!({ breakpoint.as_ref(): entry }) };
                    push_unique(literals, entry);
                }
            }
        }
        // Only a literal, or a reference extraction may resolve to one,
        // can carry `!important` statically.
        expression @ (Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::Identifier(_)
        | Expression::StaticMemberExpression(_)
        | Expression::ComputedMemberExpression(_)) => {
            let value = evaluate_with_statics(expression, static_values, scoping);
            if let Some(value) = value.filter(carries_important) {
                push_unique(literals, value);
            }
        }
        _ => {}
    }
}

/// Whether `value`, or an entry of a responsive one, ends with `!important`.
fn carries_important(value: &Value) -> bool {
    match value {
        Value::String(text) => crate::css_tokens::important_priority(text).is_some(),
        Value::Object(entries) => entries.values().any(carries_important),
        _ => false,
    }
}

fn push_unique(values: &mut Vec<Value>, value: Value) {
    if !values.contains(&value) {
        values.push(value);
    }
}

fn resolve_tag<'m>(
    tag: &'m TagFact,
    origin: Option<TagOrigin>,
    member_expr_bindings: &'m FxHashMap<String, String>,
) -> Option<(&'m str, Option<String>)> {
    if bound_elsewhere(matches!(tag, TagFact::Member(_)), origin) {
        return None;
    }
    match tag {
        TagFact::Ident(name) => Some((name.as_str(), None)),
        TagFact::Member(key) => member_expr_bindings
            .get(key)
            .map(|b| (b.as_str(), Some(b.clone()))),
    }
}

/// The bindings MDX's usage source (`mdxUsageSource`) destructures from its
/// provider's components: `const { Card } = _components`.
fn provided_components(program: &Program<'_>) -> FxHashSet<SymbolId> {
    struct Provided(FxHashSet<SymbolId>);
    impl<'a> Visit<'a> for Provided {
        fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
            let from_components = matches!(&declarator.init, Some(Expression::Identifier(id)) if id.name == "_components");
            if let (true, oxc::ast::ast::BindingPattern::ObjectPattern(_)) = (from_components, &declarator.id) {
                self.0.extend(declarator.id.get_binding_identifiers().iter().filter_map(|id| id.symbol_id.get()));
            }
            oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
        }
    }
    let mut provided = Provided(FxHashSet::default());
    provided.visit_program(program);
    provided.0
}

/// Whether a tag's first name is bound where the module's own bindings do
/// not reach: a parameter or local of the name, or, for a member path, no
/// binding at all. Such a tag never names the module's component of that
/// name.
fn bound_elsewhere(member: bool, origin: Option<TagOrigin>) -> bool {
    matches!(origin, Some(TagOrigin::Nested)) || (member && matches!(origin, Some(TagOrigin::Undeclared)))
}

/// How a file's spread wrappers stand in for their targets in the filters:
/// each wrapper tag is published as its targets, and these say what its
/// renders and forwarding elements contribute.
#[derive(Debug, Default, Clone)]
pub struct WrapperProxies {
    /// Wrapper tag → one lookup key per path to its targets, with the props
    /// that path drops. A render records once per path, so a prop one path
    /// drops still reaches the targets another path spreads it into.
    pub paths: FxHashMap<String, Vec<(String, FxHashSet<String>)>>,
    /// Opening-element spans of forwarding elements: their spread carries
    /// exactly the wrapper's renders, so it opens nothing itself.
    pub forwarding: FxHashSet<(u32, u32)>,
    /// Forwarding elements whose spread may carry nothing: each also renders
    /// its target with only its own attributes.
    pub may_omit: FxHashSet<(u32, u32)>,
    /// Opening-element spans of the forwarding elements of a wrapper that
    /// `.asComponent()` takes: their spread carries what the component's
    /// renders forward, which the project proof derives (`Forward`), so it
    /// opens nothing itself. Only the proof reads that relation; everything
    /// else counts the spread as open.
    pub derived: FxHashSet<(u32, u32)>,
    /// Wrapper tag → props every element it forwards to sets itself, where
    /// no render can replace them: those elements record them, so a render
    /// that leaves them out keeps no default for them.
    pub settled: FxHashMap<String, FxHashSet<String>>,
    /// Forwarding element span → attribute → the variant values a named
    /// prop passes on across the wrapper's renders (`passed_values`).
    pub passed: FxHashMap<(u32, u32), FxHashMap<String, Vec<String>>>,
}

/// A lookup key a render records under, with the props that never reach
/// the components published there.
type Lookup<'p> = (&'p str, Option<&'p FxHashSet<String>>);

impl WrapperProxies {
    /// Where a render of `tag`, found under `tag_name`, records: once per
    /// path for a wrapper, else under `tag_name` with every prop.
    fn lookups<'p>(&'p self, tag: &TagFact, tag_name: &'p str) -> Vec<Lookup<'p>> {
        match tag {
            TagFact::Ident(name) | TagFact::Member(name) if self.paths.contains_key(name) => self.paths[name]
                .iter()
                .map(|(key, dropped)| (key.as_str(), Some(dropped)))
                .collect(),
            _ => vec![(tag_name, None)],
        }
    }
}

/// The variant values the prop `key` takes across `wrapper`'s renders in
/// `facts`: what each render writes, `__dynamic__` where a spread at the
/// render can deliver it, and `default` (or the target's own, `__default__`)
/// where a render leaves it out.
pub(crate) fn passed_values(
    facts: &[UsageFact],
    wrapper: &str,
    key: &str,
    default: Option<&str>,
) -> Vec<String> {
    let mut values = BTreeSet::new();
    for fact in facts {
        let UsageFact::Element { tag: TagFact::Ident(tag), attrs, spread, .. } = fact else {
            continue;
        };
        if tag != wrapper {
            continue;
        }
        let mut settled = false;
        for (index, attr) in attrs.iter().enumerate().filter(|(_, attr)| attr.name == key) {
            values.insert(attr.variant_class.as_str());
            settled |= attr.settles(index, *spread);
        }
        if !settled {
            values.insert(match spread {
                Some(_) => "__dynamic__",
                None => default.unwrap_or("__default__"),
            });
        }
    }
    values.into_iter().map(str::to_string).collect()
}

/// Custom-prop scan over collected facts.
pub fn filter_custom_prop_scan(
    facts: &[UsageFact],
    component_props: &FxHashMap<String, FxHashSet<String>>,
    member_expr_bindings: &FxHashMap<String, String>,
    proxies: &WrapperProxies,
) -> CustomPropScanResult {
    let mut recorded = FxHashMap::default();
    let mut dynamic_seen = FxHashSet::default();
    let mut results = Vec::new();
    let mut dynamic_results = Vec::new();

    for fact in facts {
        let UsageFact::Element { tag, attrs, origin, .. } = fact else {
            continue;
        };
        let Some((tag_name, resolved_binding)) = resolve_tag(tag, *origin, member_expr_bindings) else {
            continue;
        };
        for (tag_name, dropped) in proxies.lookups(tag, tag_name) {
            let Some(active_props) = component_props.get(tag_name) else {
                continue;
            };
            let binding = resolved_binding.clone().unwrap_or_else(|| tag_name.to_string());

            for attr in attrs {
                if !active_props.contains(&attr.name)
                    || dropped.is_some_and(|dropped| dropped.contains(&attr.name))
                {
                    continue;
                }
                for value in attr
                    .static_value
                    .iter()
                    .chain(attr.enumerable_values.iter())
                {
                    // Per binding: equally named custom props of two components
                    // resolve through different configs.
                    let dedup_key = format!(
                        "{}:{}:{}",
                        binding,
                        attr.name,
                        serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
                    );
                    record_written(&mut results, &mut recorded, dedup_key, attr.at, SystemPropUsage {
                        prop_name: attr.name.clone(),
                        value: value.clone(),
                        binding: binding.clone(),
                        uses: Vec::new(),
                    });
                }
                if attr.dynamic {
                    let dedup_key = format!("{}::{}", binding, attr.name);
                    if dynamic_seen.insert(dedup_key) {
                        dynamic_results.push(DynamicPropUsage {
                            prop_name: attr.name.clone(),
                            binding: binding.clone(),
                        });
                    }
                }
            }
        }
    }

    CustomPropScanResult {
        static_usages: results,
        dynamic_usages: dynamic_results,
    }
}

/// Renders that can deliver any custom prop at runtime — a `{...props}`
/// spread or a `createElement` call — as one dynamic usage per custom prop.
pub fn uncertain_custom_renders(
    facts: &[UsageFact],
    component_props: &FxHashMap<String, FxHashSet<String>>,
    member_expr_bindings: &FxHashMap<String, String>,
    proxies: &WrapperProxies,
) -> Vec<DynamicPropUsage> {
    let mut seen = FxHashSet::default();
    let mut usages = Vec::new();
    for fact in facts {
        if let UsageFact::CloneUnknown { props: Some(props), .. } = fact {
            // Each listed override reaches every component with that prop.
            let mut bindings: Vec<(&String, &FxHashSet<String>)> = component_props.iter().collect();
            bindings.sort_unstable_by_key(|(binding, _)| *binding);
            for (binding, custom) in bindings {
                for (prop, _) in props.iter().filter(|(prop, _)| custom.contains(prop)) {
                    if seen.insert((binding.as_str(), prop)) {
                        usages.push(DynamicPropUsage {
                            prop_name: prop.clone(),
                            binding: binding.clone(),
                        });
                    }
                }
            }
            continue;
        }
        let binding = match fact {
            UsageFact::Element { span, .. } if proxies.forwarding.contains(span) => continue,
            UsageFact::Element { tag, spread: Some(_), origin, .. } => match resolve_tag(tag, *origin, member_expr_bindings) {
                Some((binding, _)) => binding,
                None => continue,
            },
            UsageFact::CreateElement { member, origin, .. } if bound_elsewhere(member.is_some(), *origin) => continue,
            UsageFact::CreateElement { ident: Some(name), .. } => name.as_str(),
            UsageFact::CreateElement { member: Some(key), .. } => match member_expr_bindings.get(key) {
                Some(binding) => binding.as_str(),
                None => continue,
            },
            _ => continue,
        };
        for prop in component_props.get(binding).into_iter().flatten() {
            if seen.insert((binding, prop)) {
                usages.push(DynamicPropUsage {
                    prop_name: prop.clone(),
                    binding: binding.to_string(),
                });
            }
        }
    }
    usages
}

/// Records the variant and state options a render leaves unsettled. A render
/// that can deliver any prop at runtime — a `{...props}` spread or a
/// `createElement` call — keeps every unsettled option; otherwise an
/// unwritten variant uses its default and an unwritten state stays off.
/// Custom props take the order-blind path in `uncertain_custom_renders`.
fn record_unwritten_options(
    result: &mut UsageScanResult,
    fully_open: &mut FxHashSet<String>,
    binding: &str,
    config: &ComponentUsageConfig,
    written: &FxHashSet<&str>,
    open_props: bool,
) {
    // After one render with every option open, another adds nothing.
    if open_props && written.is_empty() && !fully_open.insert(binding.to_string()) {
        return;
    }
    let absent = if open_props { "__dynamic__" } else { "__default__" };
    for variant_prop in config.variants.keys() {
        if !written.contains(variant_prop.as_str()) {
            result.variant_usages.push(VariantUsage {
                component_binding: binding.to_string(),
                variant_prop: variant_prop.clone(),
                value: absent.to_string(),
            });
        }
    }
    if open_props {
        for state_name in &config.states {
            if !written.contains(state_name.as_str()) {
                result.state_usages.push(StateUsage {
                    component_binding: binding.to_string(),
                    state_name: state_name.clone(),
                });
            }
        }
    }
}

/// Variant/state/system-prop usage scan over collected facts.
pub fn filter_usage_scan(
    facts: &[UsageFact],
    component_props: &FxHashMap<String, FxHashSet<String>>,
    custom_props: &FxHashMap<String, FxHashSet<String>>,
    component_configs: &FxHashMap<String, ComponentUsageConfig>,
    member_expr_bindings: &FxHashMap<String, String>,
    proxies: &WrapperProxies,
) -> UsageScanResult {
    let mut seen = FxHashSet::default();
    let mut recorded = FxHashMap::default();
    let mut fully_open = FxHashSet::default();
    let mut result = UsageScanResult::default();

    for fact in facts {
        match fact {
            // React gives every render the default props it leaves out: no
            // option of the component is proven unused. A name that is no
            // extracted component is someone else's.
            UsageFact::DefaultProps { tag, origin, at, written } => {
                // A component usage cannot name may be extracted: defaults
                // written to it reach renders unseen. Reading one changes
                // nothing (React's own code reads them).
                let Some((tag_name, resolved_binding)) = resolve_tag(tag, *origin, member_expr_bindings) else {
                    if !*written {
                        continue;
                    }
                    let name = match tag {
                        TagFact::Member(path) => path,
                        TagFact::Ident(name) => name,
                    };
                    result.identity_uncertain = true;
                    result.uncertain_tags.push(UncertainTag {
                        tag: Some(name.clone()),
                        create_element: false,
                        written_as_call: false,
                        default_props: true,
                        origin: *origin,
                        at: *at,
                    });
                    continue;
                };
                let Some(config) = component_configs.get(tag_name) else {
                    continue;
                };
                let binding = resolved_binding.clone().unwrap_or_else(|| tag_name.to_string());
                result.open_components.insert(binding.clone());
                record_unwritten_options(&mut result, &mut fully_open, &binding, config, &FxHashSet::default(), true);
            }
            UsageFact::Element { tag, attrs, spread, span, origin, written_as_call } => {
                let uncertain = |result: &mut UsageScanResult, name: &str| {
                    result.identity_uncertain = true;
                    result.uncertain_tags.push(UncertainTag {
                        tag: Some(name.to_string()),
                        create_element: false,
                        written_as_call: *written_as_call,
                        default_props: false,
                        origin: *origin,
                        at: span.0,
                    });
                };
                let Some((tag_name, resolved_binding)) = resolve_tag(tag, *origin, member_expr_bindings)
                else {
                    match tag {
                        TagFact::Member(path) => uncertain(&mut result, path),
                        TagFact::Ident(name) if is_component_like_identifier(name) => uncertain(&mut result, name),
                        TagFact::Ident(_) => {}
                    }
                    continue;
                };
                // A wrapper render records once per path to its targets.
                for (tag_name, dropped) in proxies.lookups(tag, tag_name) {
                    let has_props = component_props.contains_key(tag_name);
                    let has_config = component_configs.contains_key(tag_name);
                    if !has_props && !has_config {
                        if let TagFact::Ident(name) = tag {
                            if is_component_like_identifier(name) {
                                uncertain(&mut result, name);
                            }
                        }
                        continue;
                    }
                    let binding = resolved_binding.clone().unwrap_or_else(|| tag_name.to_string());
                    result.rendered_components.insert(binding.clone());
                    if spread.is_some() && !proxies.forwarding.contains(span) && !proxies.derived.contains(span) {
                        result.open_components.insert(binding.clone());
                    }

                    let active_props = component_props.get(tag_name);
                    let custom = custom_props.get(tag_name);
                    let mut written: FxHashSet<&str> = FxHashSet::default();
                    if let Some(settled) = match tag {
                        TagFact::Ident(name) => proxies.settled.get(name),
                        TagFact::Member(_) => None,
                    } {
                        written.extend(settled.iter().map(String::as_str));
                    }
                    let passed = proxies.passed.get(span);

                    for (index, attr) in attrs.iter().enumerate() {
                        if dropped.is_some_and(|dropped| dropped.contains(&attr.name)) {
                            continue;
                        }
                        let write = |literal| WrittenProp {
                            binding: binding.clone(),
                            prop: attr.name.clone(),
                            literal,
                            conditions: attr.conditions.clone(),
                        };
                        match attr.proven_values() {
                            Some(values) => result.written_props.extend(values.map(|value| write(Some(value.clone())))),
                            None => result.written_props.push(write(None)),
                        }
                        let settled = attr.settles(index, *spread);
                        if let Some(props) = active_props {
                            if props.contains(&attr.name) {
                                // A custom prop's static values belong to the custom
                                // scan; decided before de-duplication so its usage
                                // never takes a system usage's slot.
                                let custom_owned = custom.is_some_and(|c| c.contains(&attr.name));
                                for value in attr.class_values().filter(|_| !custom_owned) {
                                    let dedup_key = format!(
                                        "{}:{}",
                                        attr.name,
                                        serde_json::to_string(value)
                                            .unwrap_or_else(|_| "null".to_string())
                                    );
                                    record_written(
                                        &mut result.system_prop_usages,
                                        &mut recorded,
                                        dedup_key,
                                        attr.at,
                                        SystemPropUsage {
                                            prop_name: attr.name.clone(),
                                            value: value.clone(),
                                            binding: binding.clone(),
                                            uses: Vec::new(),
                                        },
                                    );
                                }
                                if attr.dynamic {
                                    let kind = attr
                                        .dynamic_kind
                                        .expect("dynamic AttrFact must carry an expression kind");
                                    let span = attr
                                        .dynamic_span
                                        .expect("dynamic AttrFact must carry an expression span");
                                    result.residue_sites.push(UsageResidueSite {
                                        binding: binding.clone(),
                                        prop_name: attr.name.clone(),
                                        kind,
                                        span,
                                    });
                                    let dedup_key = format!("__dynamic__:{}", attr.name);
                                    if seen.insert(dedup_key) {
                                        result.dynamic_prop_usages.push(DynamicPropUsage {
                                            prop_name: attr.name.clone(),
                                            binding: binding.clone(),
                                        });
                                    }
                                }
                            }
                        }

                        if let Some(config) = component_configs.get(tag_name) {
                            if config.variants.contains_key(&attr.name) {
                                if settled {
                                    written.insert(attr.name.as_str());
                                }
                                let passed = passed.and_then(|passed| passed.get(&attr.name));
                                let values = match passed {
                                    Some(values) => values.as_slice(),
                                    None => std::slice::from_ref(&attr.variant_class),
                                };
                                for value in values {
                                    result.variant_usages.push(VariantUsage {
                                        component_binding: binding.clone(),
                                        variant_prop: attr.name.clone(),
                                        value: value.clone(),
                                    });
                                }
                            }
                            if config.states.contains(&attr.name) {
                                if settled {
                                    written.insert(attr.name.as_str());
                                }
                                result.state_usages.push(StateUsage {
                                    component_binding: binding.clone(),
                                    state_name: attr.name.clone(),
                                });
                            }
                        }
                    }

                    // A forwarding element's spread carries exactly the wrapper's
                    // renders, which are recorded at the render; one whose
                    // spread may carry nothing also renders with only its own
                    // attributes.
                    let omitted = proxies.may_omit.contains(span);
                    if let Some(config) = component_configs
                        .get(tag_name)
                        .filter(|_| omitted || !proxies.forwarding.contains(span))
                    {
                        record_unwritten_options(
                            &mut result,
                            &mut fully_open,
                            &binding,
                            config,
                            &written,
                            spread.is_some() && !omitted,
                        );
                    }
                }
            }
            UsageFact::CreateElement {
                ident,
                member,
                identity_uncertain,
                props,
                literals,
                writes,
                clone,
                at,
                origin,
            } => {
                let uncertain = |result: &mut UsageScanResult, tag: Option<&String>| {
                    result.identity_uncertain = true;
                    result.uncertain_tags.push(UncertainTag {
                        tag: tag.cloned(),
                        create_element: true,
                        written_as_call: true,
                        default_props: false,
                        origin: *origin,
                        at: *at,
                    });
                };
                let resolved: Option<String> = if bound_elsewhere(member.is_some(), *origin) {
                    uncertain(&mut result, ident.as_ref().or(member.as_ref()));
                    None
                } else if let Some(name) = ident {
                    if component_props.contains_key(name.as_str())
                        || component_configs.contains_key(name.as_str())
                    {
                        Some(name.clone())
                    } else {
                        uncertain(&mut result, Some(name));
                        None
                    }
                } else if let Some(key) = member {
                    let resolved = member_expr_bindings.get(key).cloned();
                    if resolved.is_none() {
                        uncertain(&mut result, Some(key));
                    }
                    resolved
                } else {
                    None
                };
                if let Some(binding) = resolved {
                    // A props object usage reads in full writes what it lists,
                    // and through a rest only what that rest can carry.
                    match writes.as_ref().filter(|_| !*clone) {
                        Some(writes) => {
                            let active = component_props.get(binding.as_str());
                            for (prop, literal, conditions) in &writes.props {
                                result.written_props.push(WrittenProp {
                                    binding: binding.clone(),
                                    prop: prop.clone(),
                                    literal: literal.clone(),
                                    conditions: conditions.clone(),
                                });
                                let system = active.is_some_and(|active| active.contains(prop));
                                if literal.is_none() && system && seen.insert(format!("__dynamic__:{prop}")) {
                                    result.dynamic_prop_usages.push(DynamicPropUsage {
                                        prop_name: prop.clone(),
                                        binding: binding.clone(),
                                    });
                                }
                            }
                            if let Some(excluded) = &writes.rest_excludes {
                                result.open_except.push((binding.clone(), excluded.clone()));
                            }
                        }
                        None => {
                            result.open_components.insert(binding.clone());
                        }
                    }
                    // Literal system props take their static classes as a
                    // JSX attribute's do.
                    if let Some(active) = component_props.get(binding.as_str()) {
                        let custom = custom_props.get(binding.as_str());
                        for (prop_name, value) in literals {
                            if !active.contains(prop_name) || custom.is_some_and(|c| c.contains(prop_name)) {
                                continue;
                            }
                            let dedup_key = format!(
                                "{prop_name}:{}",
                                serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
                            );
                            let usage = SystemPropUsage {
                                prop_name: prop_name.clone(),
                                value: value.clone(),
                                binding: binding.clone(),
                                uses: Vec::new(),
                            };
                            record_written(&mut result.system_prop_usages, &mut recorded, dedup_key, *at, usage);
                        }
                    }
                    if let Some(config) = component_configs.get(&binding) {
                        let mut written: FxHashSet<&str> = FxHashSet::default();
                        for (key, class) in props.iter().flatten() {
                            if config.variants.contains_key(key) {
                                written.insert(key);
                                result.variant_usages.push(VariantUsage {
                                    component_binding: binding.clone(),
                                    variant_prop: key.clone(),
                                    value: class.clone(),
                                });
                            }
                            if config.states.contains(key) {
                                written.insert(key);
                                result.state_usages.push(StateUsage {
                                    component_binding: binding.clone(),
                                    state_name: key.clone(),
                                });
                            }
                        }
                        // A clone keeps the element's own props, recorded
                        // where the element is written.
                        if !*clone || props.is_none() {
                            record_unwritten_options(
                                &mut result,
                                &mut fully_open,
                                &binding,
                                config,
                                &written,
                                props.is_none(),
                            );
                        }
                    }
                    result.rendered_components.insert(binding);
                } else if *identity_uncertain {
                    uncertain(&mut result, None);
                }
            }
            // Overrides usage can list reach every component that declares
            // them; the warning covers the ones it cannot.
            UsageFact::CloneUnknown { props: Some(props), .. } => {
                result.cloned_props.extend(props.iter().map(|(key, _)| key.clone()));
                let mut bindings: Vec<&String> = component_configs.keys().collect();
                bindings.sort_unstable();
                for binding in bindings {
                    let config = &component_configs[binding];
                    for (key, class) in props {
                        if config.variants.contains_key(key) {
                            result.variant_usages.push(VariantUsage {
                                component_binding: binding.clone(),
                                variant_prop: key.clone(),
                                value: class.clone(),
                            });
                        }
                        if config.states.contains(key) {
                            result.state_usages.push(StateUsage {
                                component_binding: binding.clone(),
                                state_name: key.clone(),
                            });
                        }
                    }
                }
            }
            UsageFact::CloneUnknown { props: None, .. } => result.unlisted_clone = true,
        }
    }

    result
}

/// The Animus builder's methods and terminals.
const BUILDER_METHODS: [&str; 10] =
    ["styles", "variant", "compound", "states", "system", "props", "extend", "asElement", "asComponent", "asClass"];

/// The package whose builder declares styles.
const SYSTEM_PACKAGE: &str = "@animus-ui/system";

/// A reference to the Animus builder in a file analyzed for usage only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BuilderReference {
    /// 1-based position of the member or import.
    pub line: usize,
    pub column: usize,
    /// The builder method, or the import.
    pub name: String,
}

/// Every reference to the Animus builder `program` makes: a member whose
/// property is a builder method, read, called or destructured, static or
/// through a literal key, and any import from `@animus-ui/system`.
/// Strings, templates and comments hold none. A key built at runtime
/// (`ds['sty' + 'les']`) is not seen.
pub(crate) fn builder_references(program: &Program<'_>) -> Vec<(Span, String)> {
    struct References(Vec<(Span, String)>);
    impl<'a> Visit<'a> for References {
        fn visit_static_member_expression(&mut self, member: &oxc::ast::ast::StaticMemberExpression<'a>) {
            if BUILDER_METHODS.contains(&member.property.name.as_str()) {
                self.0.push((member.property.span, member.property.name.to_string()));
            }
            oxc::ast_visit::walk::walk_static_member_expression(self, member);
        }
        fn visit_computed_member_expression(&mut self, member: &oxc::ast::ast::ComputedMemberExpression<'a>) {
            let key = match &member.expression {
                Expression::StringLiteral(key) => Some(key.value.as_str()),
                Expression::TemplateLiteral(key) if key.expressions.is_empty() => {
                    key.quasis.first().and_then(|quasi| quasi.value.cooked.as_ref()).map(|cooked| cooked.as_str())
                }
                _ => None,
            };
            if let Some(key) = key.filter(|key| BUILDER_METHODS.contains(key)) {
                self.0.push((member.expression.span(), key.to_string()));
            }
            oxc::ast_visit::walk::walk_computed_member_expression(self, member);
        }
        // MDX has no use for the system package: any import of it, named,
        // default or namespace, reaches the builder's style declarations.
        fn visit_import_declaration(&mut self, import: &oxc::ast::ast::ImportDeclaration<'a>) {
            let source = import.source.value.as_str();
            if source == SYSTEM_PACKAGE || source.strip_prefix(SYSTEM_PACKAGE).is_some_and(|rest| rest.starts_with('/')) {
                self.0.push((import.span, format!("import from {source}")));
            }
        }
        // A builder method destructured, as `const { styles: s } = ds`.
        fn visit_binding_property(&mut self, property: &oxc::ast::ast::BindingProperty<'a>) {
            self.method_key(&property.key);
            oxc::ast_visit::walk::walk_binding_property(self, property);
        }
        fn visit_assignment_target_property_property(
            &mut self,
            property: &oxc::ast::ast::AssignmentTargetPropertyProperty<'a>,
        ) {
            self.method_key(&property.name);
            oxc::ast_visit::walk::walk_assignment_target_property_property(self, property);
        }
        fn visit_assignment_target_property_identifier(
            &mut self,
            property: &oxc::ast::ast::AssignmentTargetPropertyIdentifier<'a>,
        ) {
            if BUILDER_METHODS.contains(&property.binding.name.as_str()) {
                self.0.push((property.binding.span, property.binding.name.to_string()));
            }
            oxc::ast_visit::walk::walk_assignment_target_property_identifier(self, property);
        }
    }
    impl References {
        fn method_key(&mut self, key: &oxc::ast::ast::PropertyKey<'_>) {
            if let Some(name) = key.static_name().filter(|name| BUILDER_METHODS.contains(&name.as_ref())) {
                self.0.push((key.span(), name.to_string()));
            }
        }
    }
    let mut references = References(Vec::new());
    references.visit_program(program);
    // The walk meets an outer member before the chain inside it.
    references.0.sort_by_key(|(span, _)| span.start);
    references.0
}

/// Each `createSystem(…)` call whose callee no import, declaration or
/// parameter binds in any enclosing scope. The system loader evaluates a
/// system file without auto-imports, so the name is undefined there.
pub(crate) fn unbound_create_system_calls(program: &Program<'_>) -> Vec<Span> {
    // A `\u` escape can spell the name, as `create\u0053ystem`.
    let text = program.source_text;
    if !text.contains("createSystem") && !text.contains("\\u") {
        return Vec::new();
    }
    let scoping = SemanticBuilder::new().build(program).semantic.into_scoping();
    if !scoping.root_unresolved_references().contains_key("createSystem") {
        return Vec::new();
    }
    struct UnboundCalls<'s> {
        scoping: &'s Scoping,
        spans: Vec<Span>,
    }
    impl<'a> Visit<'a> for UnboundCalls<'_> {
        fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
            if let Expression::Identifier(ident) = &call.callee {
                let unbound = ident
                    .reference_id
                    .get()
                    .is_some_and(|id| self.scoping.get_reference(id).symbol_id().is_none());
                if ident.name == "createSystem" && unbound {
                    self.spans.push(ident.span);
                }
            }
            oxc::ast_visit::walk::walk_call_expression(self, call);
        }
    }
    let mut calls = UnboundCalls { scoping: &scoping, spans: Vec::new() };
    calls.visit_program(program);
    calls.spans
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jsx_scan::{scan_jsx, scan_jsx_usage};
    use crate::owned_ast::{OwnedAst, ParseCounter};

    type ConfigFixture<'a> = (&'a str, &'a [(&'a str, &'a [&'a str])], &'a [&'a str]);

    fn parse(source: &str) -> OwnedAst {
        let counter = ParseCounter::new(0);
        OwnedAst::parse("test.tsx".into(), source.to_string(), &counter)
    }

    fn props(entries: &[(&str, &[&str])]) -> FxHashMap<String, FxHashSet<String>> {
        entries
            .iter()
            .map(|(k, vs)| {
                (
                    k.to_string(),
                    vs.iter().map(|v| v.to_string()).collect::<FxHashSet<_>>(),
                )
            })
            .collect()
    }

    fn configs(entries: &[ConfigFixture<'_>]) -> FxHashMap<String, ComponentUsageConfig> {
        entries
            .iter()
            .map(|(k, variants, states)| {
                (
                    k.to_string(),
                    ComponentUsageConfig {
                        variants: variants
                            .iter()
                            .map(|(vp, opts)| {
                                (
                                    vp.to_string(),
                                    (opts.iter().map(|o| o.to_string()).collect(), None),
                                )
                            })
                            .collect(),
                        states: states.iter().map(|s| s.to_string()).collect(),
                    },
                )
            })
            .collect()
    }

    /// The fact path must reproduce the direct scanners' output on the same
    /// input, field by field.
    fn assert_paths_agree(
        source: &str,
        component_props: &FxHashMap<String, FxHashSet<String>>,
        component_configs: &FxHashMap<String, ComponentUsageConfig>,
        member_expr_bindings: &FxHashMap<String, String>,
    ) {
        let ast = parse(source);
        let program = ast.program();
        let facts = collect_usage_facts(program);

        let direct = scan_jsx(program, component_props, member_expr_bindings);
        let filtered = filter_custom_prop_scan(
            &facts,
            component_props,
            member_expr_bindings,
            &WrapperProxies::default(),
        );
        assert_eq!(
            format!("{:?}", direct.static_usages),
            format!("{:?}", filtered.static_usages),
            "scan_jsx static usages diverge on: {source}"
        );
        assert_eq!(
            format!("{:?}", direct.dynamic_usages),
            format!("{:?}", filtered.dynamic_usages),
            "scan_jsx dynamic usages diverge on: {source}"
        );

        let direct = scan_jsx_usage(
            program,
            component_props,
            component_configs,
            member_expr_bindings,
        );
        let filtered = filter_usage_scan(
            &facts,
            component_props,
            &FxHashMap::default(),
            component_configs,
            member_expr_bindings,
            &WrapperProxies::default(),
        );
        assert_eq!(
            format!("{:?}", direct.system_prop_usages),
            format!("{:?}", filtered.system_prop_usages),
            "usage system props diverge on: {source}"
        );
        assert_eq!(
            format!("{:?}", direct.dynamic_prop_usages),
            format!("{:?}", filtered.dynamic_prop_usages),
            "usage dynamic props diverge on: {source}"
        );
        assert_eq!(
            format!("{:?}", direct.residue_sites),
            format!("{:?}", filtered.residue_sites),
            "usage residue sites diverge on: {source}"
        );
        assert_eq!(
            format!("{:?}", direct.variant_usages),
            format!("{:?}", filtered.variant_usages),
            "variant usages diverge on: {source}"
        );
        assert_eq!(
            format!("{:?}", direct.state_usages),
            format!("{:?}", filtered.state_usages),
            "state usages diverge on: {source}"
        );
        let mut a: Vec<_> = direct.rendered_components.iter().collect();
        let mut b: Vec<_> = filtered.rendered_components.iter().collect();
        a.sort();
        b.sort();
        assert_eq!(a, b, "rendered components diverge on: {source}");
        assert_eq!(
            direct.identity_uncertain, filtered.identity_uncertain,
            "identity uncertainty diverges on: {source}"
        );
    }

    fn enriched_result(source: &str) -> UsageScanResult {
        let ast = parse(source);
        let program = ast.program();
        let statics = crate::eval::collect_complete_static_values(program, "test.tsx");
        let facts = collect_usage_facts_with_statics(program, ast.module_record(), &statics, "test.tsx");
        filter_usage_scan(
            &facts,
            &props(&[("Box", &["p", "display", "mt"])]),
            &FxHashMap::default(),
            &configs(&[]),
            &FxHashMap::default(),
            &WrapperProxies::default(),
        )
    }

    fn sorted_usage_values(result: &UsageScanResult) -> Vec<(String, String)> {
        let mut values = result
            .system_prop_usages
            .iter()
            .map(|usage| {
                (
                    usage.prop_name.clone(),
                    serde_json::to_string(&usage.value).unwrap(),
                )
            })
            .collect::<Vec<_>>();
        values.sort();
        values
    }

    #[test]
    fn enrichment_resolves_local_identifier_member_and_responsive_object() {
        let result = enriched_result(
            r#"
            const GAP = 24;
            const Tokens = { lg: 32 };
            export const App = () => (
              <>
                <Box p={GAP} />
                <Box p={Tokens.lg} />
                <Box mt={{ _: GAP, sm: 16 }} />
              </>
            );
            "#,
        );

        assert_eq!(
            sorted_usage_values(&result),
            vec![
                ("mt".to_string(), r#"{"_":24,"sm":16}"#.to_string()),
                ("p".to_string(), "24".to_string()),
                ("p".to_string(), "32".to_string()),
            ]
        );
        assert!(result.dynamic_prop_usages.is_empty());
        assert!(result.residue_sites.is_empty());
    }

    #[test]
    fn enrichment_enumerates_static_conditional_arms_without_residue() {
        let result = enriched_result(
            r#"
            export const App = () => (
              <>
                <Box display={open ? 'block' : 'none'} />
                <Box display={other ? 'block' : 'block'} />
              </>
            );
            "#,
        );

        assert_eq!(
            sorted_usage_values(&result),
            vec![
                ("display".to_string(), r#""block""#.to_string()),
                ("display".to_string(), r#""none""#.to_string()),
            ]
        );
        assert!(result.dynamic_prop_usages.is_empty());
        assert!(result.residue_sites.is_empty());
    }

    #[test]
    fn enrichment_enumerates_static_logical_defaults_and_keeps_residue() {
        let result = enriched_result(
            r#"
            export const App = () => (
              <>
                <Box p={pad ?? 8} />
                <Box p={gap || 4} />
              </>
            );
            "#,
        );

        assert_eq!(
            sorted_usage_values(&result),
            vec![
                ("p".to_string(), "4".to_string()),
                ("p".to_string(), "8".to_string()),
            ]
        );
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.residue_sites.len(), 2);
        assert!(result
            .residue_sites
            .iter()
            .all(|site| site.kind == DynamicExpressionKind::Logical));
    }

    #[test]
    fn enrichment_rejects_partial_conditional_and_unsupported_joins() {
        let result = enriched_result(
            r#"
            const PARTIAL = { _: unknown, sm: 16 };
            export const App = () => (
              <>
                <Box p={cond ? unknown : 8} />
                <Box p={a && 8} />
                <Box p={getGap()} />
                <Box p={base + 4} />
                <Box mt={{ _: unknown, sm: 16 }} />
                <Box mt={PARTIAL} />
              </>
            );
            "#,
        );

        assert!(
            result.system_prop_usages.is_empty(),
            "unexpected static usages: {:?}",
            result.system_prop_usages
        );
        assert_eq!(result.dynamic_prop_usages.len(), 2);
        assert_eq!(result.residue_sites.len(), 6);
    }

    #[test]
    fn enrichment_retains_dynamic_for_shadowed_static_names() {
        let result = enriched_result(
            r#"
            const GAP = 24;
            export const App = (GAP) => <Box p={GAP} />;
            "#,
        );

        assert!(
            result.system_prop_usages.is_empty(),
            "shadowed GAP must not resolve to the top-level static: {:?}",
            result.system_prop_usages
        );
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.residue_sites.len(), 1);
        assert_eq!(
            result.residue_sites[0].kind,
            DynamicExpressionKind::Identifier
        );
    }

    #[test]
    fn enrichment_rejects_inline_objects_with_captured_transforms() {
        let result = enriched_result(
            r#"
            export const App = () => (
              <Box mt={{ _: 8, transform: () => 24 }} />
            );
            "#,
        );

        assert!(
            result.system_prop_usages.is_empty(),
            "captured transform must keep the whole JSX object dynamic: {:?}",
            result.system_prop_usages
        );
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.residue_sites.len(), 1);
        assert_eq!(
            result.residue_sites[0].kind,
            DynamicExpressionKind::ResponsiveObjectDynamic
        );
    }

    #[test]
    fn paths_agree_static_dynamic_and_skip() {
        assert_paths_agree(
            r#"
            export const App = () => (
              <>
                <Box p={4} m="8" color={dynamicColor} hidden={} aria-x="y" />
                <Box p={4} />
                <div p={4} />
              </>
            );
            "#,
            &props(&[("Box", &["p", "m", "color"])]),
            &configs(&[]),
            &FxHashMap::default(),
        );
    }

    #[test]
    fn paths_agree_variants_states_and_defaults() {
        assert_paths_agree(
            r#"
            export const App = () => (
              <>
                <Btn size="sm" loading />
                <Btn tone={maybe ? 'a' : 'b'} />
              </>
            );
            "#,
            &props(&[]),
            &configs(&[(
                "Btn",
                &[("size", &["sm", "lg"]), ("tone", &["a", "b"])],
                &["loading"],
            )]),
            &FxHashMap::default(),
        );
    }

    #[test]
    fn paths_agree_member_expressions_and_create_element() {
        let mut bindings = FxHashMap::default();
        bindings.insert("Family.Slot".to_string(), "FamilySlot".to_string());
        assert_paths_agree(
            r#"
            const a = createElement(Box, { p: 4 });
            const b = React.createElement(Family.Slot, null);
            const c = createElement('div', null);
            export const App = () => <Family.Slot px={2} />;
            "#,
            &props(&[("Box", &["p"]), ("FamilySlot", &["px"])]),
            &configs(&[("Box", &[], &[])]),
            &bindings,
        );
    }

    #[test]
    fn create_element_unattributable_facts_distinguish_dynamic_from_native_string() {
        let cases = [
            (
                "const App = () => createElement(getComponent(), null);",
                true,
            ),
            ("const App = () => createElement('div', null);", false),
        ];

        for (source, expected_uncertain) in cases {
            let ast = parse(source);
            let facts = collect_usage_facts(ast.program());
            let filtered = filter_usage_scan(
                &facts,
                &FxHashMap::default(),
                &FxHashMap::default(),
                &FxHashMap::default(),
                &FxHashMap::default(),
                &WrapperProxies::default(),
            );
            let direct = scan_jsx_usage(
                ast.program(),
                &FxHashMap::default(),
                &FxHashMap::default(),
                &FxHashMap::default(),
            );

            assert_eq!(
                filtered.identity_uncertain, expected_uncertain,
                "fact path misclassified: {source}"
            );
            assert_eq!(
                direct.identity_uncertain, expected_uncertain,
                "direct scanner misclassified: {source}"
            );
        }
    }

    #[test]
    fn create_element_lowercase_identifier_is_uncertain_in_raw_and_enriched_facts() {
        let source = "const App = () => createElement(component, null);";
        let ast = parse(source);
        let statics = crate::eval::collect_complete_static_values(ast.program(), "test.tsx");
        let raw = collect_usage_facts(ast.program());
        let enriched = collect_usage_facts_with_statics(ast.program(), ast.module_record(), &statics, "test.tsx");

        for (label, facts) in [("raw", raw), ("enriched", enriched)] {
            let filtered = filter_usage_scan(
                &facts,
                &FxHashMap::default(),
                &FxHashMap::default(),
                &FxHashMap::default(),
                &FxHashMap::default(),
                &WrapperProxies::default(),
            );
            assert!(
                filtered.identity_uncertain,
                "{label} facts must retain lowercase createElement identifier uncertainty"
            );
        }
    }

    #[test]
    fn paths_agree_spread_and_namespaced_attrs() {
        assert_paths_agree(
            r#"
            export const App = () => <Box {...rest} xml:lang="en" p={8} />;
            "#,
            &props(&[("Box", &["p"])]),
            &configs(&[]),
            &FxHashMap::default(),
        );
    }

    fn option_usages(source: &str) -> (Vec<(String, String)>, Vec<String>) {
        let skel = configs(&[("Skel", &[("shape", &["line", "block"])], &["loading"])]);
        assert_paths_agree(source, &props(&[]), &skel, &FxHashMap::default());
        let ast = parse(source);
        let facts = collect_usage_facts(ast.program());
        let result = filter_usage_scan(
            &facts,
            &props(&[]),
            &FxHashMap::default(),
            &skel,
            &FxHashMap::default(),
            &WrapperProxies::default(),
        );
        let mut variants: Vec<_> = result
            .variant_usages
            .iter()
            .map(|u| (u.variant_prop.clone(), u.value.clone()))
            .collect();
        variants.sort();
        let mut states: Vec<_> = result.state_usages.iter().map(|u| u.state_name.clone()).collect();
        states.sort();
        (variants, states)
    }

    #[test]
    fn spread_keeps_the_options_it_can_reach() {
        let pair = |prop: &str, value: &str| (prop.to_string(), value.to_string());
        let wrapper = "const W = (p) => <Skel {...p} />;";
        assert_eq!(
            option_usages(wrapper),
            (vec![pair("shape", "__dynamic__")], vec!["loading".to_string()])
        );

        let settled_after = "const W = (p) => <Skel {...p} shape=\"line\" loading={false} />;";
        assert_eq!(
            option_usages(settled_after),
            (vec![pair("shape", "line")], vec!["loading".to_string()])
        );

        let overridable_before = "const W = (p) => <Skel shape=\"line\" {...p} />;";
        assert_eq!(
            option_usages(overridable_before),
            (
                vec![pair("shape", "__dynamic__"), pair("shape", "line")],
                vec!["loading".to_string()]
            )
        );

        let no_spread = "const A = () => <Skel shape=\"line\" />;";
        assert_eq!(option_usages(no_spread), (vec![pair("shape", "line")], vec![]));

        let open = (vec![pair("shape", "__dynamic__")], vec!["loading".to_string()]);
        let defaults = (vec![pair("shape", "__default__")], vec![]);
        assert_eq!(option_usages("const e = createElement(Skel, props);"), open);
        // A spread after a listed key can override it, as in JSX.
        assert_eq!(
            option_usages("const e = createElement(Skel, { shape: 'line', ...rest });"),
            option_usages("const e = <Skel shape=\"line\" {...rest} />;")
        );
        assert_eq!(option_usages("const e = createElement(Skel);"), defaults);
        assert_eq!(option_usages("const e = createElement(Skel, null);"), defaults);
        assert_eq!(
            option_usages("const e = createElement(Skel, { shape: 'line', loading: true });"),
            (vec![pair("shape", "line")], vec!["loading".to_string()])
        );

        // Repeated open renders of one component record its options once.
        let repeated = "const W = (a, b) => <><Skel {...a} /><Skel {...b} /></>;\n\
                        const e = createElement(Skel, props);";
        assert_eq!(option_usages(repeated), open);
    }

    #[test]
    fn paths_agree_on_per_site_dynamic_residue() {
        assert_paths_agree(
            r#"
            export const App = () => (
              <>
                <Box p={first} />
                <Box p={second()} />
              </>
            );
            "#,
            &props(&[("Box", &["p"])]),
            &configs(&[]),
            &FxHashMap::default(),
        );
    }
}

