//! Raw JSX usage facts plus the cross-file filters over them. Collection is
//! component-agnostic; filtering applies the component maps afterwards.

use oxc::ast::ast::{
    Argument, CallExpression, Expression, IdentifierReference, ImportDeclarationSpecifier,
    JSXAttributeItem, JSXAttributeName, JSXElementName, JSXOpeningElement, Program, Statement,
};
use oxc::ast::AstKind;
use oxc::ast_visit::Visit;
use oxc::semantic::{Scoping, SemanticBuilder, SymbolId};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::marker::PhantomData;

use crate::chain_walk::{ChainDescriptor, TerminalKind};
use crate::jsx_scan::{
    classify_jsx_attribute_as_variant_value, create_element_props, eval_jsx_attribute_value,
    is_component_like_identifier, jsx_member_path, ComponentUsageConfig, CustomPropScanResult,
    DynamicExpressionKind, DynamicPropUsage, PropValueResult, StateUsage, SystemPropUsage,
    UsageResidueSite, UsageScanResult, UsageSpan, VariantUsage,
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

/// Namespace imports (`import * as ns from 'x'`) from top-level
/// statements: local name → specifier. Kept apart from `ImportFact`, whose
/// consumers resolve `local` as a named binding.
pub fn collect_namespace_imports(program: &Program<'_>) -> std::collections::BTreeMap<String, String> {
    let mut namespaces = std::collections::BTreeMap::new();
    for stmt in &program.body {
        let Statement::ImportDeclaration(import) = stmt else {
            continue;
        };
        for spec in import.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) = spec {
                namespaces.insert(ns.local.name.to_string(), import.source.value.to_string());
            }
        }
    }
    namespaces
}

/// A top-level function component that forwards its props by spread:
/// `(props) => <Recipe {...props} />` or `({ a, ...rest }) => <Recipe {...rest} />`.
#[derive(Debug, Clone, Default)]
pub struct PropsForwarding {
    /// Props the parameter destructures by name, which the spread never
    /// carries.
    pub named: Vec<String>,
    /// The tags that receive the spread, as written (`Recipe`, `Ns.Item`).
    pub targets: Vec<String>,
}

/// Top-level function components, plain or inside `forwardRef`/`memo`,
/// keyed by binding (`default` for a default export), that spread their
/// props parameter or its rest element into a JSX tag.
pub fn collect_props_forwarding(
    program: &Program<'_>,
) -> std::collections::BTreeMap<String, PropsForwarding> {
    use oxc::ast::ast::ExportDefaultDeclarationKind;
    let mut components: Vec<(&str, Option<ComponentFunction<'_, '_>>)> = Vec::new();
    for stmt in &program.body {
        match stmt {
            Statement::ExportNamedDeclaration(export) => {
                if let Some(declaration) = &export.declaration {
                    components.extend(declared_components(declaration));
                }
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
                }
            }
        }
    }
    components
        .into_iter()
        .filter_map(|(name, function)| Some((name.to_string(), props_forwarding(function?)?)))
        .collect()
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
    body: &'b oxc::ast::ast::FunctionBody<'a>,
}

impl<'b, 'a> ComponentFunction<'b, 'a> {
    fn of_function(function: &'b oxc::ast::ast::Function<'a>) -> Option<Self> {
        Some(Self {
            props: function.params.items.first(),
            body: function.body.as_deref()?,
        })
    }

    /// An arrow or function expression, or one passed to `forwardRef` or
    /// `memo` (as `React.forwardRef` too), through type-only wrappers.
    fn of_expression(expr: &'b Expression<'a>) -> Option<Self> {
        match crate::chain_walk::unwrap_type_assertions(expr) {
            Expression::ArrowFunctionExpression(arrow) => Some(Self {
                props: arrow.params.items.first(),
                body: &arrow.body,
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

fn props_forwarding(function: ComponentFunction<'_, '_>) -> Option<PropsForwarding> {
    use oxc::ast::ast::BindingPattern;
    let mut pattern = &function.props?.pattern;
    while let BindingPattern::AssignmentPattern(assignment) = pattern {
        pattern = &assignment.left;
    }
    let (named, spread) = match pattern {
        BindingPattern::BindingIdentifier(id) => (Vec::new(), id.name.to_string()),
        BindingPattern::ObjectPattern(object) => {
            let rest = object.rest.as_ref()?;
            let BindingPattern::BindingIdentifier(rest) = &rest.argument else {
                return None;
            };
            let named = object
                .properties
                .iter()
                .filter_map(|property| property.key.static_name().map(|key| key.to_string()))
                .collect();
            (named, rest.name.to_string())
        }
        _ => return None,
    };
    let mut scan = SpreadTargets {
        spread: &spread,
        targets: Vec::new(),
    };
    scan.visit_function_body(function.body);
    (!scan.targets.is_empty()).then_some(PropsForwarding {
        named,
        targets: scan.targets,
    })
}

struct SpreadTargets<'s> {
    spread: &'s str,
    targets: Vec<String>,
}

impl<'a> Visit<'a> for SpreadTargets<'_> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        let spreads = elem.attributes.iter().any(|attr| {
            matches!(attr, JSXAttributeItem::SpreadAttribute(spread)
                if matches!(crate::chain_walk::unwrap_type_assertions(&spread.argument),
                    Expression::Identifier(id) if id.name == self.spread))
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

/// Collect import facts from top-level statements.
pub fn collect_import_facts(program: &Program<'_>) -> Vec<ImportFact> {
    let mut out = Vec::new();
    for stmt in &program.body {
        if let Statement::ImportDeclaration(import) = stmt {
            let source = import.source.value.to_string();
            let declaration = (import.span.start, import.span.end);
            if let Some(specifiers) = &import.specifiers {
                for spec in specifiers {
                    match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            out.push(ImportFact {
                                local: named.local.name.to_string(),
                                imported: named.imported.name().to_string(),
                                source: source.clone(),
                                declaration,
                            });
                        }
                        // `imported` is "default" for a default import, so
                        // the parent dangles and the child stands alone.
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                            out.push(ImportFact {
                                local: def.local.name.to_string(),
                                imported: "default".to_string(),
                                source: source.clone(),
                                declaration,
                            });
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {}
                    }
                }
            }
        }
    }
    out
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

/// The sources of `export * from '…'`, which re-export every named export.
pub fn collect_star_exports(program: &Program<'_>) -> Vec<String> {
    program
        .body
        .iter()
        .filter_map(|stmt| match stmt {
            Statement::ExportAllDeclaration(export) if export.exported.is_none() => {
                Some(export.source.value.to_string())
            }
            _ => None,
        })
        .collect()
}

/// Collect export facts from top-level statements.
pub fn collect_export_facts(program: &Program<'_>) -> Vec<ExportFact> {
    use oxc::ast::ast::Declaration;
    let mut out = Vec::new();
    for stmt in &program.body {
        if let Statement::ExportNamedDeclaration(export) = stmt {
            if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                for declarator in &decl.declarations {
                    if let oxc::ast::ast::BindingPattern::BindingIdentifier(ident) = &declarator.id
                    {
                        out.push(ExportFact {
                            exported: ident.name.to_string(),
                            local: Some(ident.name.to_string()),
                            source: None,
                            original: None,
                        });
                    }
                }
            }
            for spec in &export.specifiers {
                let is_reexport = export.source.is_some();
                out.push(ExportFact {
                    exported: spec.exported.name().to_string(),
                    local: if is_reexport {
                        None
                    } else {
                        Some(spec.local.name().to_string())
                    },
                    source: export.source.as_ref().map(|s| s.value.to_string()),
                    original: if is_reexport {
                        Some(spec.local.name().to_string())
                    } else {
                        None
                    },
                });
            }
        }
    }
    out
}

/// Usage facts enriched with same-file and imported statics, and the bindings
/// of extracted component chains no other module can name and this module
/// renders only in place (see `ConfinementScan`), from one semantic analysis:
/// a second analysis would renumber the references the first one reads.
pub(crate) fn collect_enriched_usage(
    program: &Program<'_>,
    static_values: &FxHashMap<String, Value>,
    chains: &[&ChainDescriptor],
    exports: &[ExportFact],
) -> (Vec<UsageFact>, BTreeSet<String>) {
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
    let scoping = (!static_values.is_empty() || !candidates.is_empty())
        .then(|| SemanticBuilder::new().build(program).semantic.into_scoping());
    let mut collector = FactCollector {
        facts: Vec::new(),
        static_values,
        scoping: scoping.as_ref().filter(|_| !static_values.is_empty()),
        enrich: true,
        _phantom: PhantomData,
    };
    collector.visit_program(program);
    let confined = match &scoping {
        // Direct eval can read any binding by name.
        Some(scoping) if !scoping.root_unresolved_references().contains_key("eval") => {
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
    (collector.facts, confined)
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
    static_values: &'s FxHashMap<String, Value>,
    scoping: Option<&'s Scoping>,
    enrich: bool,
    _phantom: PhantomData<&'a ()>,
}

impl<'a, 's> Visit<'a> for FactCollector<'a, 's> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        let tag = match &elem.name {
            JSXElementName::Identifier(id) => TagFact::Ident(id.name.to_string()),
            JSXElementName::IdentifierReference(id) => TagFact::Ident(id.name.to_string()),
            JSXElementName::MemberExpression(member) => {
                let Some(path) = jsx_member_path(member) else {
                    return;
                };
                TagFact::Member(path)
            }
            _ => return,
        };
        let mut attrs = Vec::new();
        let mut spread = None;
        for attr_item in &elem.attributes {
            if matches!(attr_item, JSXAttributeItem::SpreadAttribute(_)) {
                spread = Some(attrs.len());
            }
            if let JSXAttributeItem::Attribute(attr) = attr_item {
                let JSXAttributeName::Identifier(id) = &attr.name else {
                    continue;
                };
                let (mut static_value, mut dynamic, mut dynamic_kind, mut dynamic_span, skip) =
                    match eval_jsx_attribute_value(&attr.value) {
                        PropValueResult::Static(v) => (Some(v), false, None, None, false),
                        PropValueResult::Dynamic { kind, span } => {
                            (None, true, Some(kind), Some(span), false)
                        }
                        PropValueResult::Skip => (None, false, None, None, true),
                    };
                let mut enumerable_values = Vec::new();
                if dynamic && self.enrich {
                    if let Some(expression) = attribute_expression(&attr.value) {
                        let expression = unwrap_parenthesized(expression);
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
                                    unwrap_parenthesized(&conditional.consequent),
                                    self.static_values,
                                    self.scoping,
                                );
                                let alternate = evaluate_with_statics(
                                    unwrap_parenthesized(&conditional.alternate),
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
                                    unwrap_parenthesized(&logical.left),
                                    self.static_values,
                                    self.scoping,
                                ) {
                                    push_unique(&mut enumerable_values, value);
                                }
                                if let Some(value) = evaluate_with_statics(
                                    unwrap_parenthesized(&logical.right),
                                    self.static_values,
                                    self.scoping,
                                ) {
                                    push_unique(&mut enumerable_values, value);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                attrs.push(AttrFact {
                    name: id.name.to_string(),
                    static_value,
                    enumerable_values,
                    dynamic,
                    dynamic_kind,
                    dynamic_span,
                    skip,
                    variant_class: classify_jsx_attribute_as_variant_value(&attr.value),
                });
            }
        }
        self.facts.push(UsageFact::Element { tag, attrs, spread });
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let is_create_element = match &call.callee {
            Expression::Identifier(id) => id.name.as_str() == "createElement",
            Expression::StaticMemberExpression(member) => match &member.object {
                Expression::Identifier(obj) => {
                    obj.name.as_str() == "React" && member.property.name.as_str() == "createElement"
                }
                _ => false,
            },
            _ => false,
        };
        if is_create_element {
            if let Some(first_arg) = call.arguments.first() {
                let (ident, member, identity_uncertain) = match first_arg {
                    Argument::Identifier(id) => (Some(id.name.to_string()), None, false),
                    Argument::StaticMemberExpression(m) => match &m.object {
                        Expression::Identifier(obj) => (
                            None,
                            Some(format!(
                                "{}.{}",
                                obj.name.as_str(),
                                m.property.name.as_str()
                            )),
                            false,
                        ),
                        _ => (None, None, true),
                    },
                    Argument::StringLiteral(_) => (None, None, false),
                    _ => (None, None, true),
                };
                self.facts.push(UsageFact::CreateElement {
                    ident,
                    member,
                    identity_uncertain,
                    props: create_element_props(call.arguments.get(1)),
                });
            }
        }
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }
}

/// Collect every candidate tag and createElement call, component-agnostic.
pub fn collect_usage_facts(program: &Program<'_>) -> Vec<UsageFact> {
    let static_values = FxHashMap::default();
    let mut collector = FactCollector {
        facts: Vec::new(),
        static_values: &static_values,
        scoping: None,
        enrich: false,
        _phantom: PhantomData,
    };
    collector.visit_program(program);
    collector.facts
}

pub fn collect_usage_facts_with_statics(
    program: &Program<'_>,
    static_values: &FxHashMap<String, Value>,
) -> Vec<UsageFact> {
    collect_enriched_usage(program, static_values, &[], &[]).0
}

fn attribute_expression<'a, 'b>(
    value: &'b Option<oxc::ast::ast::JSXAttributeValue<'a>>,
) -> Option<&'b Expression<'a>> {
    let Some(oxc::ast::ast::JSXAttributeValue::ExpressionContainer(container)) = value else {
        return None;
    };
    Some(container.expression.to_expression())
}

fn unwrap_parenthesized<'a, 'b>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    while let Expression::ParenthesizedExpression(parenthesized) = expression {
        expression = &parenthesized.expression;
    }
    expression
}

fn evaluate_with_statics(
    expression: &Expression<'_>,
    static_values: &FxHashMap<String, Value>,
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
        return (skipped.is_empty() && captured.is_empty()).then_some(value);
    }
    let mut skipped = Vec::new();
    let value =
        crate::eval::eval_expression_with_statics(expression, &mut skipped, Some(static_values))
            .ok()?;
    skipped.is_empty().then_some(value)
}

/// Static values are keyed by top-level names, so a reference may use one
/// only when it resolves to that root binding, never to a shadowing local.
struct StaticReferenceGuard<'s> {
    static_values: &'s FxHashMap<String, Value>,
    scoping: &'s Scoping,
    resolves_to_root_bindings: bool,
}

impl<'a> Visit<'a> for StaticReferenceGuard<'_> {
    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        if !self.static_values.contains_key(ident.name.as_str()) {
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

fn push_unique(values: &mut Vec<Value>, value: Value) {
    if !values.contains(&value) {
        values.push(value);
    }
}

fn resolve_tag<'m>(
    tag: &'m TagFact,
    member_expr_bindings: &'m FxHashMap<String, String>,
) -> Option<(&'m str, Option<String>)> {
    match tag {
        TagFact::Ident(name) => Some((name.as_str(), None)),
        TagFact::Member(key) => member_expr_bindings
            .get(key)
            .map(|b| (b.as_str(), Some(b.clone()))),
    }
}

/// Custom-prop scan over collected facts.
pub fn filter_custom_prop_scan(
    facts: &[UsageFact],
    component_props: &FxHashMap<String, FxHashSet<String>>,
    member_expr_bindings: &FxHashMap<String, String>,
) -> CustomPropScanResult {
    let mut seen = FxHashSet::default();
    let mut dynamic_seen = FxHashSet::default();
    let mut results = Vec::new();
    let mut dynamic_results = Vec::new();

    for fact in facts {
        let UsageFact::Element { tag, attrs, .. } = fact else {
            continue;
        };
        let Some((tag_name, resolved_binding)) = resolve_tag(tag, member_expr_bindings) else {
            continue;
        };
        let Some(active_props) = component_props.get(tag_name) else {
            continue;
        };
        let binding = resolved_binding.unwrap_or_else(|| tag_name.to_string());

        for attr in attrs {
            if !active_props.contains(&attr.name) {
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
                if seen.insert(dedup_key) {
                    results.push(SystemPropUsage {
                        prop_name: attr.name.clone(),
                        value: value.clone(),
                        binding: binding.clone(),
                    });
                }
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
) -> Vec<DynamicPropUsage> {
    let mut seen = FxHashSet::default();
    let mut usages = Vec::new();
    for fact in facts {
        let binding = match fact {
            UsageFact::Element { tag, spread: Some(_), .. } => match resolve_tag(tag, member_expr_bindings) {
                Some((binding, _)) => binding,
                None => continue,
            },
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
) -> UsageScanResult {
    let mut seen = FxHashSet::default();
    let mut fully_open = FxHashSet::default();
    let mut result = UsageScanResult::default();

    for fact in facts {
        match fact {
            UsageFact::Element { tag, attrs, spread } => {
                let Some((tag_name, resolved_binding)) = resolve_tag(tag, member_expr_bindings)
                else {
                    result.identity_uncertain = true;
                    continue;
                };
                let has_props = component_props.contains_key(tag_name);
                let has_config = component_configs.contains_key(tag_name);
                if !has_props && !has_config {
                    if matches!(tag, TagFact::Ident(name) if is_component_like_identifier(name)) {
                        result.identity_uncertain = true;
                    }
                    continue;
                }
                let binding = resolved_binding.unwrap_or_else(|| tag_name.to_string());
                result.rendered_components.insert(binding.clone());

                let active_props = component_props.get(tag_name);
                let custom = custom_props.get(tag_name);
                let mut written: FxHashSet<&str> = FxHashSet::default();

                for (index, attr) in attrs.iter().enumerate() {
                    let settled = spread.is_none_or(|before| index >= before);
                    if let Some(props) = active_props {
                        if props.contains(&attr.name) {
                            // A custom prop's static values belong to the custom
                            // scan; decided before de-duplication so its usage
                            // never takes a system usage's slot.
                            let custom_owned = custom.is_some_and(|c| c.contains(&attr.name));
                            for value in attr
                                .static_value
                                .iter()
                                .chain(attr.enumerable_values.iter())
                                .filter(|_| !custom_owned)
                            {
                                let dedup_key = format!(
                                    "{}:{}",
                                    attr.name,
                                    serde_json::to_string(value)
                                        .unwrap_or_else(|_| "null".to_string())
                                );
                                if seen.insert(dedup_key) {
                                    result.system_prop_usages.push(SystemPropUsage {
                                        prop_name: attr.name.clone(),
                                        value: value.clone(),
                                        binding: binding.clone(),
                                    });
                                }
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
                            result.variant_usages.push(VariantUsage {
                                component_binding: binding.clone(),
                                variant_prop: attr.name.clone(),
                                value: attr.variant_class.clone(),
                            });
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

                if let Some(config) = component_configs.get(tag_name) {
                    record_unwritten_options(
                        &mut result,
                        &mut fully_open,
                        &binding,
                        config,
                        &written,
                        spread.is_some(),
                    );
                }
            }
            UsageFact::CreateElement {
                ident,
                member,
                identity_uncertain,
                props,
            } => {
                let resolved: Option<String> = if let Some(name) = ident {
                    if component_props.contains_key(name.as_str())
                        || component_configs.contains_key(name.as_str())
                    {
                        Some(name.clone())
                    } else {
                        result.identity_uncertain = true;
                        None
                    }
                } else if let Some(key) = member {
                    let resolved = member_expr_bindings.get(key).cloned();
                    if resolved.is_none() {
                        result.identity_uncertain = true;
                    }
                    resolved
                } else {
                    None
                };
                if let Some(binding) = resolved {
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
                        record_unwritten_options(
                            &mut result,
                            &mut fully_open,
                            &binding,
                            config,
                            &written,
                            props.is_none(),
                        );
                    }
                    result.rendered_components.insert(binding);
                } else if *identity_uncertain {
                    result.identity_uncertain = true;
                }
            }
        }
    }

    result
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
        let filtered = filter_custom_prop_scan(&facts, component_props, member_expr_bindings);
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
        let statics = crate::eval::collect_complete_static_values(program);
        let facts = collect_usage_facts_with_statics(program, &statics);
        filter_usage_scan(
            &facts,
            &props(&[("Box", &["p", "display", "mt"])]),
            &FxHashMap::default(),
            &configs(&[]),
            &FxHashMap::default(),
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
    fn enrichment_enumerates_static_conditional_arms_and_keeps_residue() {
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
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.residue_sites.len(), 2);
        assert!(result
            .residue_sites
            .iter()
            .all(|site| site.kind == DynamicExpressionKind::Conditional));
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
        let statics = crate::eval::collect_complete_static_values(ast.program());
        let raw = collect_usage_facts(ast.program());
        let enriched = collect_usage_facts_with_statics(ast.program(), &statics);

        for (label, facts) in [("raw", raw), ("enriched", enriched)] {
            let filtered = filter_usage_scan(
                &facts,
                &FxHashMap::default(),
                &FxHashMap::default(),
                &FxHashMap::default(),
                &FxHashMap::default(),
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
        assert_eq!(
            option_usages("const e = createElement(Skel, { shape: 'line', ...rest });"),
            open
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
