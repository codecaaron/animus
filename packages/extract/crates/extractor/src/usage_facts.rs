//! Raw JSX usage facts plus the cross-file filters over them. Collection is
//! component-agnostic; filtering applies the component maps afterwards.

use oxc::ast::ast::{
    Argument, CallExpression, Expression, IdentifierReference, ImportDeclarationSpecifier,
    JSXAttributeItem, JSXAttributeName, JSXChild, JSXElementName, JSXOpeningElement, Program, Statement,
};
use oxc::ast::AstKind;
use oxc::ast_visit::Visit;
use oxc::semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc::span::Span;
use oxc::span::GetSpan;
use oxc::syntax::module_record::{ExportExportName, ExportLocalName, ImportEntry, ImportImportName, ModuleRecord};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

mod forwarding;
mod identity_records;
mod renders_through;

pub(crate) use identity_records::identity_records;

use crate::chain_walk::{ChainDescriptor, TerminalKind};
use crate::static_value::StaticValue;
use crate::jsx_scan::{
    classify_jsx_attribute_as_variant_value, create_element_literals, create_element_props, eval_jsx_attribute_value, eval_property_key, value_variant,
    eval_static_expression, make_json_number,
    is_component_like_identifier, jsx_member_path, ComponentUsageConfig, ComposeFamilyInfo, CustomPropScanResult,
    DynamicExpressionKind, DynamicPropUsage, PropValueResult, StateUsage, SystemPropUsage, record_written,
    OpenSite, UsageResidueSite, UsageScanResult, UsageSpan, VariantUsage, VariantValue, WrittenProp,
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
    /// Variant classification: an option by its name, or a value the scan
    /// cannot read.
    pub variant_class: VariantValue,
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
    /// For a runtime value, where it comes from, where the walk can tell.
    /// Enriched collection only.
    #[serde(skip)]
    pub value_origin: ValueOrigin,
    /// A proven runtime value may also be `undefined` or `null`
    /// (`on ? 'sm' : undefined`), which selects what leaving the prop out
    /// does: a variant's default, a state off.
    #[serde(skip)]
    pub absent: bool,
    /// For an inline object literal that is no static value as a whole
    /// (`{ onClick: () => …, size: 'small' }`), the members it writes, each
    /// read on its own. Enriched collection only; evidence for the css
    /// audit, which no pruning reads.
    #[serde(skip)]
    pub members: Option<ObjectMembers>,
}

/// The members an inline object literal writes, each read on its own: the
/// keys whose values are literals, and the keys it writes with a value the
/// walk cannot read (a function, a getter, a shorthand). `open` where a
/// spread or a computed key may write any key, and neither is read past, so
/// only the keys written after the last one are listed; or where a
/// `__proto__: value` member sets the prototype, which may supply any key
/// the object does not write itself.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ObjectMembers {
    pub readable: serde_json::Map<String, Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unreadable: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub open: bool,
}

/// `object`'s members, read without statics: a literal member is listed
/// with its value, `undefined` as left out, any other value as unreadable.
fn object_members(object: &oxc::ast::ast::ObjectExpression<'_>, origins: Option<&Scoping>) -> ObjectMembers {
    use oxc::ast::ast::{ObjectPropertyKind, PropertyKind};
    let mut members = ObjectMembers::default();
    for property in &object.properties {
        let key = match property {
            ObjectPropertyKind::ObjectProperty(property) if !property.computed => eval_property_key(&property.key),
            _ => None,
        };
        let (Some(key), ObjectPropertyKind::ObjectProperty(property)) = (key, property) else {
            members = ObjectMembers { open: true, ..ObjectMembers::default() };
            continue;
        };
        // `__proto__: value` sets the prototype rather than writing a key;
        // a computed, shorthand or method one is an own key.
        if key == "__proto__" && property.kind == PropertyKind::Init && !property.shorthand && !property.method {
            members.open = true;
            continue;
        }
        members.readable.remove(&key);
        members.unreadable.retain(|unread| *unread != key);
        let value = crate::chain_walk::unwrap_type_assertions(&property.value);
        if property.kind == PropertyKind::Init && is_absent(value, origins) {
            continue;
        }
        let read = (property.kind == PropertyKind::Init && !property.shorthand)
            .then(|| evaluate_with_statics(value, crate::eval::Statics::empty(), None))
            .flatten();
        match read {
            Some(value) => {
                members.readable.insert(key, value);
            }
            None => members.unreadable.push(key),
        }
    }
    members
}

/// Where an attribute's runtime value comes from (`AttrFact::value_origin`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ValueOrigin {
    #[default]
    Unknown,
    /// The enclosing component's own prop, passed on unchanged.
    Forwarded(ForwardedProp),
    /// Computed from the enclosing component's own props.
    Derived(DerivedProp),
    /// The state slot of a React state hook the component calls.
    RuntimeState(RuntimeState),
}

/// A component's own prop an attribute passes on: one of the component's
/// own parameters read as written (`size` destructured from its props,
/// `props.size`, or a member of an object prop, `buttonProps.size`), which
/// its callers write (`component_parameters`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ForwardedProp {
    /// The component's binding, as declared.
    pub component: String,
    pub prop: String,
    /// The members read off the prop's value, outermost first, where the
    /// value passed on is a member of an object the prop holds.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub path: Vec<String>,
    /// The literal its destructuring defaults the prop to, which a caller
    /// that leaves the prop out passes on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    /// The literal `prop ?? literal` passes on where a caller leaves the
    /// prop out or passes `null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nullish: Option<Value>,
    /// `prop ?? undefined`: a caller's `null` is passed on as `undefined`,
    /// which an Animus lookup reads as it reads `null`, but which takes an
    /// ordinary component's parameter default where `null` would not.
    #[serde(rename = "nullToUndefined", skip_serializing_if = "std::ops::Not::not")]
    pub null_to_undefined: bool,
    /// Its destructuring defaults the prop to a value the walk cannot read
    /// (`color = FALLBACK`, an import): a caller that leaves the prop out
    /// passes on a value no fact names.
    #[serde(rename = "defaultUnread", skip_serializing_if = "std::ops::Not::not")]
    pub default_unread: bool,
}

impl ForwardedProp {
    /// Whether leaving the prop out passes on its destructuring's default,
    /// read or not.
    fn defaulted(&self) -> bool {
        self.default.is_some() || self.default_unread
    }
}

/// The props of the enclosing component an attribute's value is computed
/// from, not passed on unchanged (`parseThemeColor(color)`, `variant ??
/// type`): its callers decide them, but not which option the site selects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DerivedProp {
    pub component: String,
    pub props: Vec<String>,
    /// What computes the value, as written: a call's callee, or an operator.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub through: Option<String>,
}

/// The state slot of a React state hook (`const [mode] = useState(…)`),
/// which the component's own updates change at run time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RuntimeState {
    /// `useState` or `useReducer`.
    pub hook: String,
    /// Byte offset of the hook's call.
    pub at: u32,
}

/// The last spread of an element, where it passes on the enclosing
/// component's own props: its props object, or a rest of them, which never
/// carries the `omits` keys its pattern names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpreadForward {
    pub component: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub omits: Vec<String>,
}

impl AttrFact {
    /// Whether the element always sets the prop to this value itself: no
    /// spread after it can replace it, and no branch leaves it out or makes
    /// it nullish.
    pub(crate) fn settles(&self, index: usize, spread: Option<usize>) -> bool {
        !self.optional && !self.absent && spread.is_none_or(|before| index >= before)
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
        /// Where the last spread passes on the enclosing component's own
        /// props. Enriched collection only.
        #[serde(skip)]
        spread_forward: Option<SpreadForward>,
        /// The opening-element span of the one element the children are,
        /// which `asChild` renders in this element's place.
        #[serde(skip)]
        element_child: Option<(u32, u32)>,
        /// The props an attribute after a spread writes as nothing
        /// (`size={undefined}`): it replaces what the spread delivers, so
        /// the element renders them left out whatever its callers pass.
        #[serde(skip)]
        unset: Vec<String>,
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
        props: Option<Vec<(String, VariantValue)>>,
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
        props: Option<Vec<(String, VariantValue)>>,
        /// The call's line and its spelling, for the warning when the
        /// overrides cannot be listed.
        #[serde(skip)]
        line: usize,
        #[serde(skip)]
        call: String,
    },
}

/// The manifest's `proven` view of enriched usage
/// (`FileFacts::usage_enriched`): each element's tag, its attributes and
/// the spread that can replace those before it, and each `createElement`
/// call's first argument. An attribute lists every value it can write that
/// is known, and is `proven` only where the analysis's pruning trusts those
/// to be all it writes (`AttrFact::proven_values`): a value evaluated
/// through statics that may name a changed object is listed, not proven.
/// One that may also be `undefined` or `null` is `absent`.
pub(crate) fn serialize_proven<S: serde::Serializer>(
    usage: &Option<Vec<UsageFact>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    enum ProvenFact<'u> {
        Element {
            tag: &'u TagFact,
            attrs: Vec<ProvenAttr<'u>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            spread: Option<usize>,
            #[serde(rename = "spreadForward", skip_serializing_if = "Option::is_none")]
            spread_forward: Option<&'u SpreadForward>,
        },
        CreateElement { ident: &'u Option<String>, member: &'u Option<String> },
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ProvenAttr<'u> {
        name: &'u str,
        values: Vec<&'u Value>,
        proven: bool,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        skip: bool,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        optional: bool,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        absent: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        dynamic_span: Option<&'u UsageSpan>,
        #[serde(skip_serializing_if = "Option::is_none")]
        forwarded: Option<&'u ForwardedProp>,
        #[serde(skip_serializing_if = "Option::is_none")]
        derived: Option<&'u DerivedProp>,
        #[serde(skip_serializing_if = "Option::is_none")]
        runtime_state: Option<&'u RuntimeState>,
        #[serde(skip_serializing_if = "Option::is_none")]
        members: Option<&'u ObjectMembers>,
    }
    let facts = usage.iter().flatten().filter_map(|fact| match fact {
        UsageFact::Element { tag, attrs, spread, spread_forward, .. } => Some(ProvenFact::Element {
            tag,
            attrs: attrs
                .iter()
                .map(|attr| {
                    let (forwarded, derived, runtime_state) = match &attr.value_origin {
                        ValueOrigin::Forwarded(forwarded) => (Some(forwarded), None, None),
                        ValueOrigin::Derived(derived) => (None, Some(derived), None),
                        ValueOrigin::RuntimeState(state) => (None, None, Some(state)),
                        ValueOrigin::Unknown => (None, None, None),
                    };
                    ProvenAttr {
                    name: &attr.name,
                    values: attr.class_values().collect(),
                    proven: attr.proven_values().is_some(),
                    skip: attr.skip,
                    optional: attr.optional,
                    absent: attr.absent,
                    dynamic_span: attr.dynamic_span.as_ref(),
                    forwarded,
                    derived,
                    runtime_state,
                    members: attr.members.as_ref(),
                    }
                })
                .collect(),
            spread: *spread,
            spread_forward: spread_forward.as_ref(),
        }),
        UsageFact::CreateElement { ident, member, .. } => Some(ProvenFact::CreateElement { ident, member }),
        UsageFact::DefaultProps { .. } | UsageFact::CloneUnknown { .. } => None,
    });
    serializer.collect_seq(facts)
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

/// The locals a module binds to `names`, each imported by name from
/// `@animus-ui/system`.
pub(crate) fn animus_named_imports(module: &ModuleRecord<'_>, scoping: &Scoping, names: &[&str]) -> FxHashSet<SymbolId> {
    module
        .import_entries
        .iter()
        .filter(|entry| is_animus_system_specifier(&entry.module_request.name))
        .filter(|entry| matches!(&entry.import_name, ImportImportName::Name(name) if names.contains(&name.name.as_str())))
        .filter_map(|entry| scoping.get_root_binding(entry.local_name.name.as_str().into()))
        .collect()
}

/// The binding `reference` reads, or `None` for a global. A name only an
/// ambient declaration binds (`declare class p`) is erased: it reads the
/// global.
pub(crate) fn binding_of(scoping: &Scoping, reference: oxc::semantic::ReferenceId) -> Option<SymbolId> {
    scoping
        .get_reference(reference)
        .symbol_id()
        .filter(|symbol| !scoping.symbol_flags(*symbol).is_ambient() || crate::identity::runtime_value(scoping, *symbol))
}

/// The binding `ident` refers to, or `None` for a global (`binding_of`).
pub(crate) fn symbol_of(scoping: &Scoping, ident: &IdentifierReference<'_>) -> Option<SymbolId> {
    ident.reference_id.get().and_then(|id| binding_of(scoping, id))
}

/// The text of a string, or of a template with no substitution, as
/// `literal_string` and `cooked_text` read them.
pub(crate) fn static_string<'a>(expression: &Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::StringLiteral(string) => crate::eval::literal_string(string),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => template.quasis.first().and_then(crate::eval::cooked_text),
        _ => None,
    }
}

/// Whether `ident` reads one of `symbols`.
pub(crate) fn reads_symbol(scoping: &Scoping, ident: &IdentifierReference<'_>, symbols: &FxHashSet<SymbolId>) -> bool {
    symbol_of(scoping, ident).is_some_and(|symbol| symbols.contains(&symbol))
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
            let (Some(key), Some(function)) = (crate::eval::property_name(&p.key), ComponentFunction::of_expression(&p.value)) else {
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
#[derive(Clone, Copy)]
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
    /// `memo` (as `React.forwardRef` too), through type-only wrappers. The
    /// wrappers are read by name: a reader that adds what a component
    /// passes on may over-reach, never one that proves less is passed.
    fn of_expression(expr: &'b Expression<'a>) -> Option<Self> {
        Self::through(expr, &|callee| {
            let wrapper = match callee {
                Expression::Identifier(id) => id.name.as_str(),
                Expression::StaticMemberExpression(member) => member.property.name.as_str(),
                _ => return false,
            };
            matches!(wrapper, "forwardRef" | "memo")
        })
    }

    /// As `of_expression`, a call counting as a wrapper only where `wraps`
    /// accepts its callee.
    fn through(expr: &'b Expression<'a>, wraps: &dyn Fn(&Expression<'a>) -> bool) -> Option<Self> {
        match crate::chain_walk::unwrap_type_assertions(expr) {
            Expression::ArrowFunctionExpression(arrow) => Some(Self {
                props: arrow.params.items.first(),
                body: ComponentBody::Arrow(&arrow.body),
            }),
            Expression::FunctionExpression(function) => Self::of_function(function),
            Expression::CallExpression(call) if wraps(&call.callee) => {
                Self::through(call.arguments.first()?.as_expression()?, wraps)
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
        .filter_map(|property| crate::eval::property_name(&property.key).map(|key| key.to_string()))
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
                        source: Some(animus_system_loader::specifier_text(export.source.value).into_owned()),
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
    /// See `FileFacts::declared_hints`.
    pub declared_hints: Vec<DeclaredHint>,
    /// See `FileFacts::confined_components`.
    pub confined: BTreeSet<String>,
    /// See `FileFacts::value_escapes`.
    pub escapes: BTreeSet<String>,
    /// See `FileFacts::terminal_escapes`.
    pub terminal_escapes: BTreeSet<String>,
    /// See `FileFacts::deferred_escapes`.
    pub deferred_escapes: BTreeMap<String, BTreeSet<Deferral>>,
    /// See `FileFacts::spread_wrappers`.
    pub spread_wrappers: BTreeMap<String, SpreadWrapper>,
    /// See `FileFacts::ordinary_components`.
    pub ordinary_components: BTreeSet<String>,
    /// See `FileFacts::react_wrappers`.
    pub react_wrappers: BTreeMap<String, Option<String>>,
    /// See `FileFacts::import_aliases`.
    pub import_aliases: BTreeMap<String, String>,
    /// See `FileFacts::prop_tags`.
    pub prop_tags: Vec<PropTag>,
    /// See `FileFacts::name_uses`.
    pub name_uses: BTreeMap<String, NameUses>,
    /// See `FileFacts::namespace_member_uses`.
    pub namespace_member_uses: BTreeMap<String, NameUses>,
    /// See `FileFacts::direct_eval`.
    pub direct_eval: bool,
    /// See `FileFacts::lazy_targets`.
    pub lazy_targets: BTreeMap<String, LazyTarget>,
    /// See `FileFacts::opaque_calls`.
    pub opaque_calls: Vec<OpaqueCall>,
    /// See `FileFacts::element_consts`.
    pub element_consts: BTreeMap<String, ElementConst>,
    /// See `FileFacts::opaque_tags`.
    pub opaque_tags: Vec<OpaqueTag>,
    /// See `FileFacts::held_arrays`.
    pub held_arrays: BTreeSet<String>,
    /// See `FileFacts::misused_imports`.
    pub misused_imports: BTreeSet<String>,
    /// See `FileFacts::class_components`.
    pub class_components: BTreeSet<String>,
    /// See `FileFacts::patches_intrinsics`.
    pub patches_intrinsics: Option<IntrinsicPatch>,
    /// See `FileFacts::outside_let_goes`.
    pub outside_let_goes: Vec<(u32, String)>,
    /// See `FileFacts::keyed_stores`.
    pub keyed_stores: Vec<(u32, String)>,
    /// See `FileFacts::untraced_stores`.
    pub untraced_stores: Vec<(u32, String)>,
    /// See `FileFacts::rewrites_object`.
    pub rewrites_object: bool,
    /// See `FileFacts::child_cloners`.
    pub child_cloners: BTreeMap<String, bool>,
    /// See `FileFacts::builder_import_references`.
    pub builder_import_references: Vec<BuilderImportReferences>,
    /// See `FileFacts::first_that_works_uses`.
    pub first_that_works_uses: BTreeSet<(u32, u32)>,
    /// See `FileFacts::builder_proof`.
    pub builder_proof: Option<crate::pure_builders::BuilderProof>,
}

/// A component element that hands its children and props to its receiver,
/// which may clone them: the tag as written, where its first name is bound,
/// what else the element can render, and what its attributes and children
/// carry, read as a call's arguments are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OpaqueTag {
    pub tag: String,
    /// A parameter or local never names the module's binding of that name.
    pub origin: TagOrigin,
    /// The other tags a local alias's element may render (`LocalAliases`),
    /// each judged as `tag` is.
    pub also: Vec<(String, TagOrigin)>,
    pub polymorphic: Polymorphic,
    /// What the element's attributes and children let an Animus receiver do
    /// in its tag's place, judged where the receiver is known.
    pub site: SiteShape,
    /// Where the element starts in its file.
    pub at: u32,
    /// Whether the element sets a `ref`, which reads the instance of a
    /// class component, its props included.
    pub exposed: bool,
    pub tags: BTreeSet<String>,
    pub imported_args: Vec<String>,
    pub forwards_from: Vec<String>,
    /// What each prop carries, by the prop it reaches the element through:
    /// a receiver that hands only some of its props outside delivers those.
    /// An element reached through one prop records only its key there, and
    /// its whole record is that prop's (`prop_tags`, `prop_imports`).
    pub props: Vec<PropReach>,
}

impl OpaqueTag {
    /// The component tags the prop at `at` carries.
    pub(crate) fn prop_tags(&self, at: usize) -> &BTreeSet<String> {
        if self.props.len() == 1 { &self.tags } else { &self.props[at].tags }
    }

    /// The imports the prop at `at` hands on.
    pub(crate) fn prop_imports(&self, at: usize) -> &[String] {
        if self.props.len() == 1 { &self.imported_args } else { &self.props[at].imported_args }
    }
}

/// What an element's own attributes and children let an Animus string
/// terminal render in its tag's place: Animus's runtime renders the tag
/// unless `as` names another, or `asChild` clones the one element child
/// with the site's props, and a spread may carry either.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SiteShape {
    /// An `as` that is not a host element's static name, or an `is`.
    pub as_open: bool,
    /// `asChild` is written: the tag of its one direct element child, when it
    /// has exactly one.
    pub as_child: Option<Option<String>>,
    /// Each spread on the element, in order.
    pub spreads: Vec<SpreadArg>,
    /// The element's children are none, or exactly the enclosing top-level
    /// component's own `children` input, so an `asChild` a spread switches on
    /// clones the element its callers pass.
    pub own_children: bool,
}

/// What a spread on an element can carry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SpreadArg {
    /// Object literals of these static keys, a conditional over them
    /// included.
    Keys(Vec<String>),
    /// The props, or the rest of them, of the enclosing top-level component:
    /// its binding.
    Props(String),
    /// What a call of the top-level function or import it names returns:
    /// an object that cannot retarget the element, where its declaring
    /// module lists the function in `FileFacts::bounded_returns`.
    Returned(String),
    /// Anything else.
    Other,
}

/// The first construct in a module that leaves no usage proven
/// (`FileFacts::patches_intrinsics`): where it starts, and what it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct IntrinsicPatch {
    pub at: u32,
    pub rule: &'static str,
}

/// What an element's attributes let it render in place of its tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Polymorphic {
    /// Only its tag: no `as`, `asChild` or spread.
    No,
    /// The host element an `as` of a static string names, which an Animus
    /// element renders in place.
    Host,
    /// Anything: an `as` naming a value, `asChild`, or a spread.
    Open,
}

/// Which of a component's inputs a value may carry: none, the named props
/// (`className`, read off the props object), all but the named ones (the
/// props object itself, or a rest of it, whose members are those props), or
/// every one by a route whose members are no props (`this.props`,
/// `arguments`). The walk copies a value at every position it reaches, so
/// the names are shared until a join grows them, behind an `Arc`: the
/// engine's workers build the facts that hold them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) enum Inputs<N: Ord + Clone> {
    #[default]
    None,
    Named(std::sync::Arc<BTreeSet<N>>),
    AllBut(std::sync::Arc<BTreeSet<N>>),
    Every,
}

impl<N: Ord + Clone> Inputs<N> {
    pub(crate) fn all() -> Self {
        Inputs::AllBut(std::sync::Arc::default())
    }

    pub(crate) fn named(names: BTreeSet<N>) -> Self {
        Inputs::Named(std::sync::Arc::new(names))
    }

    pub(crate) fn all_but(names: BTreeSet<N>) -> Self {
        Inputs::AllBut(std::sync::Arc::new(names))
    }

    pub(crate) fn any(&self) -> bool {
        !matches!(self, Inputs::None)
    }

    pub(crate) fn contains(&self, name: &N) -> bool {
        match self {
            Inputs::None => false,
            Inputs::Named(named) => named.contains(name),
            Inputs::AllBut(except) => !except.contains(name),
            Inputs::Every => true,
        }
    }

    /// Adds `other`, saying whether anything was new.
    pub(crate) fn join(&mut self, other: &Inputs<N>) -> bool {
        let next = match (&mut *self, other) {
            (_, Inputs::None) | (Inputs::Every, _) => return false,
            (Inputs::Named(mine), Inputs::Named(theirs)) | (Inputs::AllBut(mine), Inputs::AllBut(theirs))
                if std::sync::Arc::ptr_eq(mine, theirs) =>
            {
                return false;
            }
            (Inputs::Named(mine), Inputs::Named(theirs)) => {
                if theirs.is_subset(mine) {
                    return false;
                }
                std::sync::Arc::make_mut(mine).extend(theirs.iter().cloned());
                return true;
            }
            (Inputs::AllBut(except), Inputs::Named(named)) => {
                if except.is_disjoint(named) {
                    return false;
                }
                std::sync::Arc::make_mut(except).retain(|name| !named.contains(name));
                return true;
            }
            (Inputs::AllBut(mine), Inputs::AllBut(theirs)) => {
                if mine.is_subset(theirs) {
                    return false;
                }
                std::sync::Arc::make_mut(mine).retain(|name| theirs.contains(name));
                return true;
            }
            (Inputs::None, other) | (_, other @ Inputs::Every) => other.clone(),
            (Inputs::Named(named), Inputs::AllBut(except)) => Inputs::all_but(except.difference(named).cloned().collect()),
        };
        *self = next;
        true
    }

    /// What reading the member `name` off a value carrying these gives: the
    /// props object's member is that one input.
    pub(crate) fn member(&self, name: N) -> Inputs<N> {
        match self {
            Inputs::AllBut(except) if except.contains(&name) => Inputs::None,
            Inputs::AllBut(_) => Inputs::named(BTreeSet::from([name])),
            inputs => inputs.clone(),
        }
    }

    pub(crate) fn map<M: Ord + Clone>(&self, name: impl Fn(&N) -> M) -> Inputs<M> {
        match self {
            Inputs::None => Inputs::None,
            Inputs::Named(named) => Inputs::named(named.iter().map(&name).collect()),
            Inputs::AllBut(except) => Inputs::all_but(except.iter().map(&name).collect()),
            Inputs::Every => Inputs::Every,
        }
    }
}

/// Which prop of a component element a value reaches it through.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum PropKey {
    Children,
    Named(String),
    /// A spread, which may set any prop.
    Spread,
}

/// What one prop of a component element carries (`OpaqueTag::props`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PropReach {
    pub key: PropKey,
    pub tags: BTreeSet<String>,
    pub imported_args: Vec<String>,
    /// The enclosing top-level component's inputs it carries.
    pub inputs: Inputs<String>,
}

/// A use that may hand the module's elements or a component's inputs to
/// code the analysis cannot see (see `forwarding`): the function it calls,
/// when the analysis may read it, the component tags it hands on, and the
/// top-level bindings whose inputs it hands on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OpaqueCall {
    /// A function or class of the module or an import, with the member a
    /// namespace import's call names (`lib.enhance`), which the analysis
    /// reads when it declares a function or class of that name; `None` for
    /// code the analysis cannot see.
    pub callee: Option<String>,
    /// The array, when `callee` is a read method of one (`rows.map`): the
    /// built-in method while the array is held (`FileFacts::held_arrays`).
    pub held_array: Option<String>,
    /// Component tags of the elements it hands on.
    pub tags: BTreeSet<String>,
    /// Imports it hands on, whose declaring modules' `const`s may hold
    /// elements (see `ElementConst`).
    pub imported_args: Vec<String>,
    /// The enclosing top-level binding (and `default` for a default
    /// export) when it hands on that binding's inputs.
    pub forwards_from: Vec<String>,
    /// Which of those inputs it hands on.
    pub inputs: Inputs<String>,
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
    /// Byte offset of the use, which orders uses on one line; `None` where
    /// `line` is.
    pub at: Option<u32>,
    /// What the use does, said of the object: `is passed to decorate()`.
    pub what: String,
}

/// A call of an object's member as a method (`Page.useFrame()`), which runs
/// the member with the object as `this`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MethodCall {
    pub member: String,
    pub used: ObjectUse,
}

impl ObjectUse {
    /// The use said of `subject` in `file`: `x is passed to decorate() in
    /// a.tsx on line 3`.
    pub fn said(&self, subject: &str, file: &str) -> String {
        let line = self.line.map_or(String::new(), |line| format!(" on line {line}"));
        format!("{subject} {} in {file}{line}", self.what)
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn collect_enriched_usage(
    built: Scoping,
    program: &Program<'_>,
    module: &ModuleRecord<'_>,
    identity_records: &FxHashSet<SymbolId>,
    static_values: &FxHashMap<String, StaticValue>,
    module_path: &str,
    chains: &[&ChainDescriptor],
    exports: &[ExportFact],
    compose: &[ComposeFamilyInfo],
    facades: &BTreeMap<String, Vec<crate::facts::FacadeEntry>>,
    assigned_target_calls: &BTreeSet<(u32, u32)>,
    calls_eval: bool,
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
    // Only TypeScript annotates parameters; an annotation proves nothing,
    // so its unions only explain a slot they would close.
    let declared_params = origins
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
        declared_params,
        declared_hints: Vec::new(),
        params: origins.map(|scoping| component_parameters(program, scoping)).unwrap_or_default(),
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
        local_consts: FxHashMap::default(),
        local_origins: FxHashMap::default(),
        locals: !contains_with(program),
    };
    collector.visit_program(program);
    let declared_hints = std::mem::take(&mut collector.declared_hints);
    let usage = collector.finish();
    // Only a tag bound inside a function may name an alias.
    let nested_tag = usage.iter().any(|fact| matches!(fact, UsageFact::Element { origin: Some(TagOrigin::Nested), .. }));
    let aliases = origins.filter(|_| nested_tag).map(|scoping| LocalAliases::of(program, scoping)).unwrap_or_default();
    let usage = aliases.rewrite(usage);
    let react_imports = origins.map(|scoping| ReactImports::of(program, scoping));
    // Without scopes a direct `eval` cannot be ruled out.
    let direct_eval = origins.is_none() || calls_eval;
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
    // What `ordinary_components` would admit were nothing to escape: the
    // React wrappers and `const` aliases a write or hand-on may change,
    // whatever their names' case, and the callbacks a wrapper's position
    // is followed for.
    let OrdinaryComponents { names: admissible, react_wrappers: admissible_wrappers, import_aliases: admissible_aliases } = origins
        .zip(react_imports.as_ref())
        .map(|(scoping, react)| ordinary_components(program, scoping, react, &BTreeSet::new(), direct_eval))
        .unwrap_or_default();
    let (escapes, terminal_escapes, deferred_escapes) = match &scoping {
        Some(scoping) if may_escape => {
            let mut scan = EscapeScan {
                identity_records,
                admissible: &admissible,
                react_bindings: admissible_wrappers.keys().chain(admissible_aliases.keys()).cloned().collect(),
                scoping,
                chains,
                slot_values: compose
                    .iter()
                    .filter(|family| family.addressable())
                    .flat_map(|family| family.slot_values.iter().copied())
                    .collect(),
                reads: facades.iter().map(|(object, entries)| (object.clone(), crate::facts::FollowedReads::of(entries))).collect(),
                holders: BTreeSet::new(),
                assigned_target_calls,
                react: &react,
                react_imports: react_imports.as_ref(),
                namespaces: collect_namespace_imports(module).into_keys().collect(),
                imports: named_import_locals(module),
                escapes: BTreeSet::new(),
                terminal: BTreeSet::new(),
                elsewhere: BTreeSet::new(),
                deferrals: BTreeMap::new(),
                undeferred: BTreeSet::new(),
                ancestors: Vec::new(),
                aliases: &aliases,
                value_aliases: BTreeSet::new(),
            };
            // An alias of a candidate names the same value, and an object
            // holding one holds it, so each can make the other a candidate.
            let declared = declared_aliases(program);
            loop {
                let known = (scan.value_aliases.len(), scan.holders.len());
                let holders: Vec<String> = scan
                    .reads
                    .iter()
                    .filter(|(_, reads)| {
                        reads.members.values().map(|(binding, _)| binding).chain(&reads.copies).any(|value| scan.is_candidate(value))
                    })
                    .map(|(object, _)| object.clone())
                    .collect();
                scan.holders.extend(holders);
                let aliases: Vec<String> = declared
                    .iter()
                    .filter(|(alias, value)| !scan.is_candidate(alias) && scan.is_candidate(value))
                    .map(|(alias, _)| alias.clone())
                    .collect();
                scan.value_aliases.extend(aliases);
                if (scan.value_aliases.len(), scan.holders.len()) == known {
                    break;
                }
            }
            if direct_eval {
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
            let terminal = scan.terminal.difference(&scan.elsewhere).cloned().collect();
            let undeferred = scan.undeferred;
            let deferred = scan.deferrals.into_iter().filter(|(path, _)| !undeferred.contains(path)).collect();
            (scan.escapes, terminal, deferred)
        }
        _ => (BTreeSet::new(), BTreeSet::new(), BTreeMap::new()),
    };
    let OrdinaryComponents { names: ordinary_components, react_wrappers, import_aliases } = origins
        .zip(react_imports.as_ref())
        .map(|(scoping, react)| ordinary_components(program, scoping, react, &escapes, direct_eval))
        .unwrap_or_default();
    let spread_wrappers = match &scoping {
        Some(scoping)
            if !wrapper_candidates.is_empty() && !direct_eval =>
        {
            spread_wrappers(program, scoping, wrapper_candidates)
        }
        _ => BTreeMap::new(),
    };
    let records = origins
        .map(|scoping| forwarding::forwarding(program, scoping, chains, &exported, &aliases, identity_records))
        .unwrap_or_default();
    let (prop_tags, name_uses, namespace_member_uses) =
        origins.map(|scoping| prop_tags_and_uses(program, scoping, &react)).unwrap_or_default();
    let builder_import_references =
        origins.map(|scoping| builder_import_references(program, module, scoping)).unwrap_or_default();
    let first_that_works_uses =
        origins.map(|scoping| first_that_works_uses(program, module, scoping)).unwrap_or_default();
    let builder_proof = origins.and_then(|scoping| crate::pure_builders::prove(program, module, scoping));
    EnrichedUsage {
        usage,
        declared_hints,
        confined,
        escapes,
        terminal_escapes,
        deferred_escapes,
        spread_wrappers,
        ordinary_components,
        react_wrappers,
        import_aliases,
        prop_tags,
        name_uses,
        namespace_member_uses,
        direct_eval,
        opaque_calls: records.calls,
        element_consts: records.element_consts,
        opaque_tags: records.tags,
        held_arrays: records.held_arrays,
        misused_imports: records.misused_imports,
        class_components: records.classes,
        patches_intrinsics: records.patches_intrinsics,
        outside_let_goes: records.outside_let_goes,
        keyed_stores: records.keyed_stores,
        untraced_stores: records.untraced_stores,
        rewrites_object: records.rewrites_object,
        child_cloners: records.child_cloners,
        builder_import_references,
        first_that_works_uses,
        builder_proof,
        lazy_targets: origins.map(|scoping| lazy_targets(program, scoping)).unwrap_or_default(),
    }
}

/// A component React's `lazy` loads: the module the specifier names, the
/// export it renders, and where the `import()` is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LazyTarget {
    pub specifier: String,
    pub export: String,
    pub at: u32,
}

const LAZY_FUNCTIONS: [&str; 1] = ["lazy"];

/// Each top-level `const` nothing writes bound to React's own `lazy` of a
/// literal `import()`: `lazy(() => import('./x'))` renders the module's
/// default export, `lazy(() => import('./x').then((m) => ({ default: m.X })))`
/// its export `X`. Any other form names none.
fn lazy_targets(program: &Program<'_>, scoping: &Scoping) -> BTreeMap<String, LazyTarget> {
    use oxc::ast::ast::{BindingPattern, ObjectPropertyKind};
    let mut targets = BTreeMap::new();
    if !program.source_text.contains("lazy") {
        return targets;
    }
    let react = ReactNames::importing(program, scoping, &LAZY_FUNCTIONS, &[], false);
    for statement in &program.body {
        let declaration = match statement {
            Statement::ExportDeclaration(export) => Some(&export.declaration),
            statement => statement.as_declaration(),
        };
        let Some(oxc::ast::ast::Declaration::VariableDeclaration(variables)) = declaration else { continue };
        if variables.kind != oxc::ast::ast::VariableDeclarationKind::Const {
            continue;
        }
        for declarator in &variables.declarations {
            let (BindingPattern::BindingIdentifier(id), Some(Expression::CallExpression(call))) =
                (&declarator.id, declarator.init.as_ref().map(|init| init.get_inner_expression()))
            else {
                continue;
            };
            if react.export(&call.callee).is_none() || call.arguments.len() != 1 {
                continue;
            }
            if unwritten(scoping, id).is_none() {
                continue;
            }
            let Some(Expression::ArrowFunctionExpression(loader)) = call.arguments[0].as_expression().map(Expression::get_inner_expression)
            else {
                continue;
            };
            if !loader.params.items.is_empty() {
                continue;
            }
            let Some(body) = loader.get_expression().map(Expression::get_inner_expression) else { continue };
            let (import, export) = match body {
                Expression::ImportExpression(import) => (import, "default".to_string()),
                Expression::CallExpression(then) => {
                    let Expression::StaticMemberExpression(member) = &then.callee else { continue };
                    let (Expression::ImportExpression(import), "then", [mapping]) =
                        (member.object.get_inner_expression(), member.property.name.as_str(), then.arguments.as_slice())
                    else {
                        continue;
                    };
                    let Some(Expression::ArrowFunctionExpression(mapping)) = mapping.as_expression().map(Expression::get_inner_expression)
                    else {
                        continue;
                    };
                    let [param] = mapping.params.items.as_slice() else { continue };
                    let BindingPattern::BindingIdentifier(module) = &param.pattern else { continue };
                    let Some(Expression::ObjectExpression(object)) = mapping.get_expression().map(Expression::get_inner_expression) else {
                        continue;
                    };
                    let [ObjectPropertyKind::ObjectProperty(property)] = object.properties.as_slice() else { continue };
                    let Expression::StaticMemberExpression(read) = property.value.get_inner_expression() else { continue };
                    let named_module = matches!(read.object.get_inner_expression(), Expression::Identifier(object) if object.name == module.name);
                    if property.computed || eval_property_key(&property.key).as_deref() != Some("default") || !named_module {
                        continue;
                    }
                    (import, read.property.name.to_string())
                }
                _ => continue,
            };
            let Some(specifier) = static_string(&import.source) else { continue };
            targets.insert(id.name.to_string(), LazyTarget { specifier: specifier.to_string(), export, at: import.span.start });
        }
    }
    targets
}

/// The span of each use of `@animus-ui/system`'s `firstThatWorks` whose
/// value a call site may write: each call to it, through a named or a
/// namespace import, and each read of a `const` such a call initializes.
/// Resolved through the file's scopes, so a shadowing local is no use.
fn first_that_works_uses(program: &Program<'_>, module: &ModuleRecord<'_>, scoping: &Scoping) -> BTreeSet<(u32, u32)> {
    struct Uses<'s> {
        scoping: &'s Scoping,
        functions: FxHashSet<SymbolId>,
        namespaces: FxHashSet<SymbolId>,
        consts: FxHashSet<SymbolId>,
        found: BTreeSet<(u32, u32)>,
    }
    impl Uses<'_> {
        fn bound(&self, ident: &IdentifierReference<'_>, symbols: &FxHashSet<SymbolId>) -> bool {
            reads_symbol(self.scoping, ident, symbols)
        }
        fn calls_helper(&self, call: &CallExpression<'_>) -> bool {
            match &call.callee {
                Expression::Identifier(callee) => self.bound(callee, &self.functions),
                Expression::StaticMemberExpression(member) => {
                    member.property.name == "firstThatWorks"
                        && matches!(&member.object, Expression::Identifier(object) if self.bound(object, &self.namespaces))
                }
                _ => false,
            }
        }
    }
    impl<'a> Visit<'a> for Uses<'_> {
        fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
            if self.calls_helper(call) {
                self.found.insert((call.span.start, call.span.end));
            }
            oxc::ast_visit::walk::walk_call_expression(self, call);
        }
        fn visit_variable_declaration(&mut self, declaration: &oxc::ast::ast::VariableDeclaration<'a>) {
            if declaration.kind == oxc::ast::ast::VariableDeclarationKind::Const {
                for declarator in &declaration.declarations {
                    let oxc::ast::ast::BindingPattern::BindingIdentifier(binding) = &declarator.id else { continue };
                    let Some(init) = &declarator.init else { continue };
                    if let Expression::CallExpression(call) = crate::chain_walk::unwrap_type_assertions(init) {
                        if self.calls_helper(call) {
                            self.consts.extend(binding.symbol_id.get());
                        }
                    }
                }
            }
            oxc::ast_visit::walk::walk_variable_declaration(self, declaration);
        }
        fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
            if self.bound(ident, &self.consts) {
                self.found.insert((ident.span.start, ident.span.end));
            }
        }
    }
    let functions = animus_named_imports(module, scoping, &["firstThatWorks"]);
    let namespaces = module
        .import_entries
        .iter()
        .filter(|entry| is_animus_system_specifier(&entry.module_request.name))
        .filter(|entry| matches!(entry.import_name, ImportImportName::NamespaceObject))
        .filter_map(|entry| scoping.get_root_binding(entry.local_name.name.as_str().into()))
        .collect();
    let mut uses = Uses { scoping, functions, namespaces, consts: FxHashSet::default(), found: BTreeSet::new() };
    if uses.functions.is_empty() && uses.namespaces.is_empty() {
        return uses.found;
    }
    // A `const` may be read before its declaration in source order (from a
    // function body), so its reads are collected on a second walk.
    uses.visit_program(program);
    if !uses.consts.is_empty() {
        uses.visit_program(program);
    }
    uses.found
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

/// See `FileFacts::written_member_uses`.
#[derive(Debug, Clone)]
pub(crate) struct WrittenMember {
    /// The binding written through: an import, a namespace import or a
    /// module-scope `const`.
    pub binding: String,
    /// The member of its object whose value the use may write through, or
    /// `None` for a member a key names at runtime and for the object used
    /// whole.
    pub member: Option<String>,
    /// What the use is said of.
    pub subject: String,
    pub used: ObjectUse,
}

/// See `FileFacts::wrapped_uses`.
#[derive(Debug, Clone)]
pub(crate) struct WrappedUse {
    /// The write the use is unless the call is Animus's: through a member of
    /// the binding, or of the whole binding (`written_bindings`).
    pub written: WrittenMember,
    pub whole: bool,
    /// The binding of the chain whose `.asComponent()` takes the value.
    pub chain: String,
}

impl WrittenMember {
    fn new(binding: &str, member: Option<&str>, subject: String, used: ObjectUse) -> Self {
        WrittenMember { binding: binding.to_string(), member: member.map(str::to_string), subject, used }
    }
}

/// Records the first use that may write through `binding`'s `member`.
fn written_member(written: &mut Vec<WrittenMember>, binding: &str, member: Option<&str>, subject: String, used: ObjectUse) {
    if !written.iter().any(|known| known.binding == binding && known.member.as_deref() == member) {
        written.push(WrittenMember { binding: binding.to_string(), member: member.map(str::to_string), subject, used });
    }
}

/// See `FileFacts::unsafe_object_uses`.
/// What a module's own source says may change the objects the member
/// tables follow, and the contexts it builds among them: read from its parse
/// and semantic build alone, before any static value is evaluated.
#[derive(Default)]
pub(crate) struct ObjectUses {
    /// See `FileFacts::context_consts`.
    pub context_consts: BTreeSet<String>,
    /// See `FileFacts::unsafe_object_uses`.
    pub unsafe_object_uses: BTreeMap<String, ObjectUse>,
    /// See `FileFacts::extend_calls`.
    pub extend_calls: BTreeMap<String, Vec<ObjectUse>>,
    /// See `FileFacts::method_calls`.
    pub method_calls: BTreeMap<String, Vec<MethodCall>>,
    /// See `FileFacts::object_handoffs`.
    pub object_handoffs: Vec<Handoff>,
    /// See `FileFacts::written_namespaces`.
    pub written_namespaces: WrittenNamespaces,
    /// See `FileFacts::written_bindings`.
    pub written_bindings: BTreeMap<String, ObjectUse>,
    /// See `FileFacts::written_member_uses`.
    pub written_member_uses: Vec<WrittenMember>,
    /// See `FileFacts::wrapped_uses`.
    pub wrapped_uses: Vec<WrappedUse>,
}

/// The uses of `object_consts` and of the module's contexts that may change
/// them, through the module's one semantic build.
pub(crate) fn object_uses(
    program: &Program<'_>,
    scoping: &Scoping,
    object_consts: &BTreeMap<&str, bool>,
    assigned_targets: &BTreeSet<&str>,
    wrapped: FxHashMap<(u32, u32), String>,
    identity_records: &FxHashSet<SymbolId>,
    direct_eval: bool,
) -> ObjectUses {
    let context_consts = context_consts(program, scoping, &ReactImports::of(program, scoping));
    // A context is watched as an object too: its `Provider` must stay React's.
    let mut watched = object_consts.clone();
    for context in &context_consts {
        watched.entry(context.as_str()).or_insert(false);
    }
    let uses = scan_object_uses(program, scoping, object_bindings(program, scoping, &watched, assigned_targets), wrapped, identity_records, direct_eval);
    ObjectUses { context_consts, ..uses }
}

/// See `FileFacts::written_namespaces`: the module's namespace imports
/// alone, for static style values.
pub(crate) fn written_namespaces(program: &Program<'_>, scoping: &Scoping, direct_eval: bool) -> WrittenNamespaces {
    let namespaces = object_bindings(program, scoping, &BTreeMap::new(), &BTreeSet::new())
        .into_iter()
        .filter(|(_, binding)| binding.namespace)
        .collect();
    scan_object_uses(program, scoping, namespaces, FxHashMap::default(), &FxHashSet::default(), direct_eval).written_namespaces
}

/// The uses of `candidates` that may change their objects; `context_consts`
/// is left empty.
fn scan_object_uses(
    program: &Program<'_>,
    scoping: &Scoping,
    candidates: FxHashMap<SymbolId, ObjectBinding>,
    wrapped: FxHashMap<(u32, u32), String>,
    identity_records: &FxHashSet<SymbolId>,
    direct_eval: bool,
) -> ObjectUses {
    if candidates.is_empty() {
        return ObjectUses::default();
    }
    if direct_eval {
        // Direct eval can reach any binding by name.
        let what = ObjectUse { line: None, at: None, what: "can be changed by a direct eval".to_string() };
        let written_namespaces = candidates
            .values()
            .filter(|binding| binding.namespace)
            .map(|binding| (binding.name.clone(), (binding.name.clone(), what.clone())))
            .collect();
        let written_bindings =
            candidates.values().filter(|binding| !binding.namespace).map(|binding| (binding.name.clone(), what.clone())).collect();
        let written_member_uses = candidates
            .values()
            .map(|binding| WrittenMember { binding: binding.name.clone(), member: None, subject: binding.name.clone(), used: what.clone() })
            .collect();
        return ObjectUses {
            unsafe_object_uses: candidates.into_values().map(|binding| (binding.name, what.clone())).collect(),
            written_namespaces,
            written_bindings,
            written_member_uses,
            ..ObjectUses::default()
        };
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
        identity_records,
        source: program.source_text,
        lines: std::cell::OnceCell::new(),
        candidates: candidates.into_iter().map(|(symbol, binding)| (symbol, Rc::new(binding))).collect(),
        container_names: FxHashSet::default(),
        // A module-scope `Object` is not the global one.
        global_object: scoping.get_root_binding("Object".into()).is_none(),
        react: ReactImports::of(program, scoping),
        uses: BTreeMap::new(),
        extend_calls: BTreeMap::new(),
        method_calls: BTreeMap::new(),
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
        written_bindings: BTreeMap::new(),
        written_member_uses: Vec::new(),
        called_functions: None,
        returns: Vec::new(),
        local_aliases: FxHashMap::default(),
        element_arrays: FxHashMap::default(),
        wrapped,
        wrapped_uses: Vec::new(),
    };
    scan.visit_program(program);
    ObjectUses {
        unsafe_object_uses: scan.uses,
        extend_calls: scan.extend_calls,
        method_calls: scan.method_calls,
        object_handoffs: scan.handoffs,
        written_namespaces: scan.written_namespaces,
        written_bindings: scan.written_bindings,
        written_member_uses: scan.written_member_uses,
        wrapped_uses: scan.wrapped_uses,
        ..ObjectUses::default()
    }
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
    direct_eval: bool,
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
    if direct_eval {
        let what = ObjectUse { line: None, at: None, what: "can be changed by a direct eval".to_string() };
        let names: BTreeSet<String> = candidates.into_values().map(|binding| binding.name).collect();
        let uses = names.into_iter().map(|name| (name, what.clone(), UseAt::WHOLE)).collect();
        return StyleObjectFacts { uses, ..StyleObjectFacts::default() };
    }
    let container_names = candidates.values().filter(|b| !b.namespace).map(|b| b.name.clone()).collect();
    let mut scan = ObjectUseScan {
        scoping,
        identity_records: &FxHashSet::default(),
        source: program.source_text,
        lines: std::cell::OnceCell::new(),
        candidates: candidates.into_iter().map(|(symbol, binding)| (symbol, Rc::new(binding))).collect(),
        container_names,
        global_object: !binds_anywhere(scoping, "Object"),
        react: ReactImports::of(program, scoping),
        uses: BTreeMap::new(),
        extend_calls: BTreeMap::new(),
        method_calls: BTreeMap::new(),
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
        written_bindings: BTreeMap::new(),
        written_member_uses: Vec::new(),
        called_functions: Some(CalledFunctions::of(program)),
        returns: Vec::new(),
        local_aliases: FxHashMap::default(),
        element_arrays: FxHashMap::default(),
        wrapped: FxHashMap::default(),
        wrapped_uses: Vec::new(),
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
    let Some(symbol) = reference.and_then(|id| binding_of(scoping, id)) else {
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
                match crate::eval::property_name(&prop.key).filter(|_| !prop.computed) {
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
/// global object, by name or by a key the walk reads (`window['eval']`, a
/// `const` declared to the name). A type query, and the bare name as a
/// `typeof` operand or the right side of `instanceof`, run nothing. A call
/// of a member of the global object by a key the walk cannot read may call
/// either (`UNREAD_GLOBAL_CALL`).
///
/// It calls `eval` directly, reading and writing any binding by name, only
/// where a call's callee is the unbound `eval` itself (`eval(…)`,
/// `(eval)(…)`); any other call of it runs in the global scope. A browser
/// timer (`setTimeout`, `setInterval`, unbound or a member of the global
/// object) runs a first argument that is a string as code: a timer read as
/// a value, or called with a first argument not provably a function,
/// counts, as its bare name under `typeof` or `instanceof` does not. A
/// function or arrow written there is one, and so is a
/// binding never reassigned that is declared to one, or that is a
/// parameter of a function with no other name every use of which calls it
/// with a function in its place (an export is a use, and a function no use
/// calls proves none). An unnamed `Promise` executor written in place gets
/// functions (`resolve`, `reject`) from the global `Promise`, which the
/// proof then trusts (`trusts_promise`). A module that reads `arguments`,
/// which may change a parameter or call an executor as `callee`, proves no
/// parameter and trusts no executor.
///
/// The global object is any of its names unbound (`globalThis`, `window`,
/// `self`, `global`, `top`, `parent`, `frames`), a member of it by one of
/// them or by a key the walk cannot read (`window.self`, `top[k]`), a
/// `window`, `globalThis` or `defaultView` member of anything, or a binding
/// the module ever gives one, declared, destructured or assigned.
pub(crate) struct StringCode {
    pub(crate) reads: Option<&'static str>,
    pub(crate) direct_eval: bool,
    /// Whether a timer gets a function only through a `Promise` executor:
    /// should any analysed module replace the global `Promise`
    /// (`replaces_promise`), the timer may run a string
    /// (`analyze_css::distrust_promise`).
    pub(crate) trusts_promise: bool,
    /// Whether the module may replace the global `Promise`: it writes the
    /// unbound name, declares it at its top (a script's global), names
    /// `Promise` as a string, a template or a property key, writes a member
    /// named `Promise`, writes into the global object by a key the walk
    /// cannot read, or lets the global object go but into a call rooted at
    /// an import (`global_let_goes`): handed to a function the module binds,
    /// `Object` or `Reflect`, returned or stored. A read of it the code only
    /// inspects (`typeof window[name]`) lets nothing go. Not followed: a key
    /// built at run time from text that never names `Promise`, written
    /// through a value the global object reached no other way.
    pub(crate) replaces_promise: bool,
    /// The imports each call the global object is let go to is rooted at,
    /// as written: one the analysis reads may replace `Promise` there
    /// (`analyze_css::distrust_promise`).
    pub(crate) global_let_goes: Vec<String>,
}

/// Why a timer may run a string.
pub(crate) const STRING_TIMER: &str = "lets a timer run what may be a string";

/// Why a call of a member of the global object may run a string.
const UNREAD_GLOBAL_CALL: &str = "calls a member of the global object by a key it cannot read";

/// How `program` runs code from strings: see `StringCode`.
pub(crate) fn string_code<'a>(program: &oxc::ast::ast::Program<'a>, scoping: &oxc::semantic::Scoping) -> StringCode {
    use oxc::ast::ast::{
        BinaryExpression, CallExpression, ComputedMemberExpression, Expression, FormalParameters, IdentifierReference, StaticMemberExpression,
        UnaryExpression,
    };
    use oxc::ast_visit::Visit;
    use oxc::semantic::SymbolId;
    use oxc::syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
    const RUNNERS: [&str; 2] = ["eval", "Function"];
    const TIMERS: [&str; 2] = ["setTimeout", "setInterval"];
    // The names the global object is reached by, itself and as a member of
    // one of them.
    use forwarding::GLOBAL_OBJECTS as GLOBAL_NAMES;
    /// Members that hold the global object, of anything.
    const GLOBAL_MEMBERS: [&str; 3] = ["window", "globalThis", "defaultView"];
    /// What may hold the global object: itself, or a binding, which holds it
    /// where the module gives it one.
    #[derive(Clone, Copy)]
    enum GlobalRoot {
        Global,
        Binding(SymbolId),
    }
    /// What a use of the global object does: applied at once to the global
    /// object, and once the walk is done to a binding that holds it.
    enum Effect<'a> {
        /// Reads a runner or a timer (`StringCode::reads`).
        Reads(&'static str),
        /// Calls a timer with this first argument.
        Timer(Argument),
        /// May replace `Promise`.
        Replaces,
        /// Lets it go to a call rooted at this import.
        LetGo(&'a str),
    }
    struct Reads<'s, 'a> {
        scoping: &'s oxc::semantic::Scoping,
        ancestors: Vec<AstKind<'a>>,
        found: Option<&'static str>,
        direct_eval: bool,
        /// Each timer call's first argument.
        timers: Vec<Argument>,
        /// Bindings declared to a function.
        functions: FxHashSet<SymbolId>,
        /// The parameters an unnamed `Promise` executor gets functions in.
        executors: FxHashSet<SymbolId>,
        /// Each parameter of a function a binding names, by that binding and
        /// position.
        parameters: FxHashMap<SymbolId, (SymbolId, usize)>,
        /// The arguments of each call of a binding, by position.
        calls: FxHashMap<SymbolId, Vec<Vec<Argument>>>,
        /// Bindings an export declaration declares, which code outside may
        /// call with anything.
        exported: FxHashSet<SymbolId>,
        /// Whether the module reads `arguments`, which in a script can
        /// change a parameter or call a function as `callee`.
        arguments: bool,
        /// See `StringCode::replaces_promise`.
        replaces_promise: bool,
        /// See `StringCode::global_let_goes`.
        global_let_goes: Vec<&'a str>,
        /// Each import binding's source.
        imports: FxHashMap<SymbolId, &'a str>,
        /// Bindings declared to a string, never reassigned, with it.
        strings: FxHashMap<SymbolId, &'a str>,
        /// The bindings the module gives the global object.
        global_aliases: FxHashSet<SymbolId>,
        /// (from, to): what `from` holds, `to` is given.
        alias_flows: Vec<(SymbolId, SymbolId)>,
        /// What each use of a binding would do were it the global object.
        binding_effects: Vec<(SymbolId, Effect<'a>)>,
    }
    /// An argument as a timer's first would read it.
    enum Argument {
        Function,
        Binding(SymbolId),
        Other,
    }
    impl Argument {
        fn is_function(&self, functions: &FxHashSet<SymbolId>) -> bool {
            match self {
                Argument::Function => true,
                Argument::Binding(symbol) => functions.contains(symbol),
                Argument::Other => false,
            }
        }
    }
    /// The parameters of a function or arrow written as `expression`, and
    /// whether it is unnamed: a named one is reached by its own name too.
    fn function_params<'b>(expression: &'b Expression<'_>) -> Option<(&'b FormalParameters<'b>, bool)> {
        match expression.get_inner_expression() {
            Expression::ArrowFunctionExpression(arrow) => Some((&arrow.params, true)),
            Expression::FunctionExpression(function) => Some((&function.params, function.id.is_none())),
            _ => None,
        }
    }
    /// Each parameter that is a plain binding, with its position.
    fn plain_parameters<'b>(params: &'b FormalParameters<'_>) -> impl Iterator<Item = (usize, SymbolId)> + 'b {
        params.items.iter().enumerate().filter_map(|(at, parameter)| match &parameter.pattern {
            oxc::ast::ast::BindingPattern::BindingIdentifier(id) => id.symbol_id.get().map(|symbol| (at, symbol)),
            _ => None,
        })
    }
    fn reason(name: &str) -> &'static str {
        match name {
            "eval" => "reads eval",
            "Function" => "reads Function",
            _ => STRING_TIMER,
        }
    }
    impl<'a> Reads<'_, 'a> {
        fn unbound(&self, id: &IdentifierReference<'_>) -> bool {
            symbol_of(self.scoping, id).is_none()
        }
        /// The bare unbound name of a runner or a timer, which `typeof` and
        /// `instanceof` only inspect.
        fn bare_runner(&self, expr: &Expression<'_>) -> bool {
            matches!(expr.get_inner_expression(), Expression::Identifier(id)
                if (RUNNERS.contains(&id.name.as_str()) || TIMERS.contains(&id.name.as_str())) && self.unbound(id))
        }
        fn argument(&self, argument: &oxc::ast::ast::Argument<'_>) -> Argument {
            match argument.as_expression().map(Expression::get_inner_expression) {
                Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => Argument::Function,
                Some(Expression::Identifier(id)) => symbol_of(self.scoping, id).map_or(Argument::Other, Argument::Binding),
                _ => Argument::Other,
            }
        }
        /// Records `symbol` as declared to a function, whose `params` are
        /// given where nothing else names it.
        fn function(&mut self, symbol: SymbolId, params: Option<&FormalParameters<'_>>) {
            self.functions.insert(symbol);
            if let Some(params) = params {
                self.parameters.extend(plain_parameters(params).map(|(at, parameter)| (parameter, (symbol, at))));
            }
        }
        /// The key of `member` the walk reads: written, or a `const`'s.
        fn key(&self, member: &ComputedMemberExpression<'a>) -> Option<&'a str> {
            member.static_property_name().and_then(oxc::str::JSStr::as_str).or_else(|| match member.expression.get_inner_expression() {
                Expression::Identifier(id) => symbol_of(self.scoping, id).and_then(|symbol| self.strings.get(&symbol).copied()),
                _ => None,
            })
        }
        /// Whether `expression` may be the global object.
        fn global_root(&self, expression: &Expression<'a>) -> Option<GlobalRoot> {
            match expression.get_inner_expression() {
                Expression::Identifier(id) => match symbol_of(self.scoping, id) {
                    None => GLOBAL_NAMES.contains(&id.name.as_str()).then_some(GlobalRoot::Global),
                    Some(symbol) => Some(GlobalRoot::Binding(symbol)),
                },
                Expression::StaticMemberExpression(member) if GLOBAL_MEMBERS.contains(&member.property.name.as_str()) => Some(GlobalRoot::Global),
                Expression::StaticMemberExpression(member) if GLOBAL_NAMES.contains(&member.property.name.as_str()) => self.global_root(&member.object),
                Expression::ComputedMemberExpression(member) if self.key(member).is_none_or(|key| GLOBAL_NAMES.contains(&key)) => {
                    self.global_root(&member.object)
                }
                _ => None,
            }
        }
        /// Records `bound`, each given `value`.
        fn given(&mut self, bound: &[SymbolId], value: &Expression<'a>) {
            match self.global_root(value) {
                Some(GlobalRoot::Global) => self.global_aliases.extend(bound),
                Some(GlobalRoot::Binding(from)) => self.alias_flows.extend(bound.iter().map(|to| (from, *to))),
                None => {}
            }
        }
        fn apply(&mut self, root: GlobalRoot, effect: Effect<'a>) {
            match (root, effect) {
                (GlobalRoot::Binding(symbol), effect) => self.binding_effects.push((symbol, effect)),
                (GlobalRoot::Global, Effect::Reads(why)) => {
                    self.found.get_or_insert(why);
                }
                (GlobalRoot::Global, Effect::Timer(first)) => self.timers.push(first),
                (GlobalRoot::Global, Effect::Replaces) => self.replaces_promise = true,
                (GlobalRoot::Global, Effect::LetGo(source)) => self.global_let_goes.push(source),
            }
        }
        /// What the use at `span` of what `root` may be the global object
        /// does. Its members by its names, and by a key the walk cannot read,
        /// may be it too: a call of one by such a key may call a runner, and
        /// a write by one may replace `Promise`. A member by any other name
        /// is judged by name. Inspected, it lets nothing go; given to a
        /// binding, `given` follows it; anywhere else it is let go.
        fn global_use(&self, span: Span, mut root: GlobalRoot) -> Option<(GlobalRoot, Effect<'a>)> {
            let mut up = self.ancestors.iter().rev();
            let mut current = span;
            let mut unread = false;
            loop {
                let effect = member_effect(current, up.clone());
                let before = up.clone();
                let (at, parent) = peel_wrappers(current, &mut up);
                current = match parent? {
                    AstKind::StaticMemberExpression(member) if member.object.span() == at => {
                        let name = member.property.name.as_str();
                        if GLOBAL_MEMBERS.contains(&name) {
                            root = GlobalRoot::Global;
                        } else if !GLOBAL_NAMES.contains(&name) {
                            return self.named_use(member.span, name, up).map(|effect| (root, effect));
                        }
                        unread = false;
                        member.span
                    }
                    AstKind::ComputedMemberExpression(member) if member.object.span() == at => match self.key(member) {
                        Some(name) if !GLOBAL_NAMES.contains(&name) => return self.named_use(member.span, name, up).map(|effect| (root, effect)),
                        key => {
                            unread = key.is_none();
                            member.span
                        }
                    },
                    AstKind::NewExpression(new) if new.callee.span() == at => return unread.then_some((root, Effect::Reads(UNREAD_GLOBAL_CALL))),
                    _ if effect.is_some() => {
                        return match effect? {
                            MemberEffect::Method => unread.then_some((root, Effect::Reads(UNREAD_GLOBAL_CALL))),
                            MemberEffect::Assigned | MemberEffect::Deleted => unread.then_some((root, Effect::Replaces)),
                        };
                    }
                    // What a choice or a sequence gives on is let go with it.
                    AstKind::LogicalExpression(logical) if logical.operator == LogicalOperator::And && logical.left.span() == at => return None,
                    AstKind::LogicalExpression(logical) => logical.span,
                    AstKind::ConditionalExpression(conditional) if conditional.test.span() == at => return None,
                    AstKind::ConditionalExpression(conditional) => conditional.span,
                    AstKind::SequenceExpression(sequence) if sequence.expressions.last().is_some_and(|last| last.span() == at) => sequence.span,
                    AstKind::AwaitExpression(waited) => waited.span,
                    // `instanceof` hands it to the right side's
                    // `Symbol.hasInstance`, unless that is a platform
                    // constructor's.
                    AstKind::BinaryExpression(binary)
                        if binary.operator == BinaryOperator::Instanceof
                            && !(binary.left.span() == at
                                && matches!(binary.right.get_inner_expression(), Expression::Identifier(id)
                                    if forwarding::NATIVE_CONSTRUCTORS.contains(&id.name.as_str()) && self.unbound(id))) =>
                    {
                        return Some((root, Effect::Replaces));
                    }
                    AstKind::UnaryExpression(_)
                    | AstKind::BinaryExpression(_)
                    | AstKind::SequenceExpression(_)
                    | AstKind::ExpressionStatement(_)
                    | AstKind::IfStatement(_)
                    | AstKind::WhileStatement(_)
                    | AstKind::DoWhileStatement(_)
                    | AstKind::ForStatement(_)
                    | AstKind::SwitchStatement(_) => return None,
                    AstKind::TemplateLiteral(_) if !matches!(up.next(), Some(AstKind::TaggedTemplateExpression(_))) => return None,
                    AstKind::VariableDeclarator(declarator) if declarator.init.as_ref().is_some_and(|init| init.span() == at) => return None,
                    AstKind::AssignmentExpression(assignment)
                        if assignment.right.span() == at
                            && matches!(assignment.left, oxc::ast::ast::AssignmentTarget::AssignmentTargetIdentifier(_)) =>
                    {
                        return None;
                    }
                    _ => return Some((root, self.let_go(at, before))),
                };
            }
        }
        /// What the member `name` at `span` of the global object does: a
        /// runner read, or a timer called with its first argument or read
        /// any other way.
        fn named_use<'b>(&self, span: Span, name: &str, mut up: impl Iterator<Item = &'b AstKind<'a>>) -> Option<Effect<'a>>
        where
            'a: 'b,
        {
            if RUNNERS.contains(&name) {
                return Some(Effect::Reads(reason(name)));
            }
            if !TIMERS.contains(&name) {
                return None;
            }
            Some(match peel_wrappers(span, &mut up) {
                (at, Some(AstKind::CallExpression(call))) if call.callee.span() == at => {
                    Effect::Timer(call.arguments.first().map_or(Argument::Other, |argument| self.argument(argument)))
                }
                _ => Effect::Reads(STRING_TIMER),
            })
        }
        /// Where the global object let go at `span` goes: into a call rooted
        /// at an import through what is written inline as an argument (a
        /// property's value of an object literal, or the result of a
        /// function or arrow), or anywhere else.
        fn let_go<'b>(&self, span: Span, mut up: impl Iterator<Item = &'b AstKind<'a>>) -> Effect<'a>
        where
            'a: 'b,
        {
            let mut current = span;
            loop {
                current = match peel_wrappers(current, &mut up).1 {
                    Some(AstKind::CallExpression(call)) if call.callee.span() != current => {
                        return self.import_root(&call.callee).map_or(Effect::Replaces, Effect::LetGo);
                    }
                    Some(AstKind::NewExpression(new)) if new.callee.span() != current => {
                        return self.import_root(&new.callee).map_or(Effect::Replaces, Effect::LetGo);
                    }
                    Some(AstKind::ObjectProperty(_)) => match up.next() {
                        Some(object) => object.span(),
                        None => return Effect::Replaces,
                    },
                    Some(AstKind::SpreadElement(spread)) => spread.span,
                    // An arrow's expression body is its result.
                    Some(AstKind::ArrowFunctionExpression(arrow)) => arrow.span,
                    // A return is its function's result.
                    Some(AstKind::ReturnStatement(_)) => loop {
                        match up.next() {
                            Some(AstKind::ArrowFunctionExpression(arrow)) => break arrow.span,
                            Some(AstKind::Function(function)) => break function.span,
                            Some(_) => {}
                            None => return Effect::Replaces,
                        }
                    },
                    _ => return Effect::Replaces,
                };
            }
        }
        /// The import `callee` is rooted at, as written.
        fn import_root(&self, callee: &Expression<'a>) -> Option<&'a str> {
            let mut root = callee;
            loop {
                root = match root.get_inner_expression() {
                    Expression::StaticMemberExpression(member) => &member.object,
                    Expression::ComputedMemberExpression(member) => &member.object,
                    Expression::CallExpression(call) => &call.callee,
                    Expression::Identifier(id) => return symbol_of(self.scoping, id).and_then(|symbol| self.imports.get(&symbol).copied()),
                    _ => return None,
                };
            }
        }
        /// Judges the use at `span` of what `root` may be the global object.
        fn judge(&mut self, span: Span, root: GlobalRoot) {
            if let Some((root, effect)) = self.global_use(span, root) {
                self.apply(root, effect);
            }
        }
        /// Whether every timer gets a function, the `seeds` among them: a
        /// parameter is one once every use of its function calls it with
        /// one in its place, and each added may prove another.
        fn proves(&self, seeds: &FxHashSet<SymbolId>) -> bool {
            let mut functions: FxHashSet<SymbolId> =
                self.functions.iter().chain(seeds.iter().filter(|seed| !crate::identity::reassigned(self.scoping, **seed))).copied().collect();
            // A module that reads `arguments` proves no parameter.
            if !self.arguments {
                loop {
                    let proven: Vec<_> = self
                        .parameters
                        .iter()
                        .filter(|(parameter, (binding, at))| {
                            let calls = self.calls.get(binding).map_or(&[][..], Vec::as_slice);
                            !functions.contains(*parameter)
                                && !crate::identity::reassigned(self.scoping, **parameter)
                                && !self.exported.contains(binding)
                                && !calls.is_empty()
                                && calls.len() == self.scoping.get_resolved_reference_ids(*binding).len()
                                && calls.iter().all(|arguments| arguments.get(*at).is_some_and(|argument| argument.is_function(&functions)))
                        })
                        .map(|(parameter, _)| *parameter)
                        .collect();
                    if proven.is_empty() {
                        break;
                    }
                    functions.extend(proven);
                }
            }
            self.timers.iter().all(|first| first.is_function(&functions))
        }
    }
    impl<'a> Visit<'a> for Reads<'_, 'a> {
        fn enter_node(&mut self, kind: AstKind<'a>) {
            self.ancestors.push(kind);
        }
        fn leave_node(&mut self, _kind: AstKind<'a>) {
            self.ancestors.pop();
        }
        fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
            let value = id.reference_id.get().is_some_and(|id| self.scoping.get_reference(id).is_value());
            let name = id.name.as_str();
            let symbol = symbol_of(self.scoping, id);
            if value && (RUNNERS.contains(&name) || TIMERS.contains(&name)) && symbol.is_none() {
                self.found.get_or_insert(reason(name));
            }
            if name == "Promise" && symbol.is_none() && id.reference_id.get().is_some_and(|id| self.scoping.get_reference(id).is_write()) {
                self.replaces_promise = true;
            }
            self.arguments |= name == "arguments";
            if value {
                match symbol {
                    // Only a variable, a parameter or a reassigned name is
                    // ever given the global object (`given`).
                    Some(symbol) if self.scoping.symbol_flags(symbol).is_variable() || crate::identity::reassigned(self.scoping, symbol) => {
                        self.judge(id.span, GlobalRoot::Binding(symbol));
                    }
                    Some(_) => {}
                    None if GLOBAL_NAMES.contains(&name) => self.judge(id.span, GlobalRoot::Global),
                    None => {}
                }
            }
        }
        fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
            if matches!(call.callee.get_inner_expression(), Expression::Identifier(id) if id.name == "eval" && self.unbound(id)) {
                self.direct_eval = true;
            }
            // A timer called by name runs its first argument; read any other
            // way, it may run a string. A member of the global object is
            // judged by name (`global_use`).
            if matches!(call.callee.get_inner_expression(), Expression::Identifier(id) if TIMERS.contains(&id.name.as_str()) && self.unbound(id)) {
                let first = call.arguments.first().map_or(Argument::Other, |argument| self.argument(argument));
                self.timers.push(first);
                for argument in &call.arguments {
                    self.visit_argument(argument);
                }
                return;
            }
            if let Expression::Identifier(id) = &call.callee {
                if let Some(symbol) = symbol_of(self.scoping, id) {
                    // A spread moves every argument after it.
                    let mut spread = false;
                    let arguments = call
                        .arguments
                        .iter()
                        .map(|argument| {
                            spread |= argument.is_spread();
                            if spread { Argument::Other } else { self.argument(argument) }
                        })
                        .collect();
                    self.calls.entry(symbol).or_default().push(arguments);
                }
            }
            oxc::ast_visit::walk::walk_call_expression(self, call);
        }
        fn visit_new_expression(&mut self, new: &oxc::ast::ast::NewExpression<'a>) {
            let promise = matches!(new.callee.get_inner_expression(), Expression::Identifier(id) if id.name == "Promise" && self.unbound(id));
            if let (true, Some((params, true))) = (promise, new.arguments.first().and_then(|argument| argument.as_expression()).and_then(function_params)) {
                self.executors.extend(plain_parameters(params).filter(|(at, _)| *at < 2).map(|(_, symbol)| symbol));
            }
            oxc::ast_visit::walk::walk_new_expression(self, new);
        }
        fn visit_import_declaration(&mut self, import: &oxc::ast::ast::ImportDeclaration<'a>) {
            // A specifier with a lone surrogate names no module: what a call
            // through its import is handed is replaced.
            if let Some(source) = import.source.value.as_str() {
                for specifier in import.specifiers.iter().flatten() {
                    if let Some(symbol) = specifier.local().symbol_id.get() {
                        self.imports.insert(symbol, source);
                    }
                }
            }
            oxc::ast_visit::walk::walk_import_declaration(self, import);
        }
        fn visit_export_declaration(&mut self, export: &oxc::ast::ast::ExportDeclaration<'a>) {
            match &export.declaration {
                oxc::ast::ast::Declaration::VariableDeclaration(declaration) => {
                    for declarator in &declaration.declarations {
                        if let oxc::ast::ast::BindingPattern::BindingIdentifier(id) = &declarator.id {
                            self.exported.extend(id.symbol_id.get());
                        }
                    }
                }
                oxc::ast::ast::Declaration::FunctionDeclaration(function) => {
                    self.exported.extend(function.id.as_ref().and_then(|id| id.symbol_id.get()));
                }
                _ => {}
            }
            oxc::ast_visit::walk::walk_export_declaration(self, export);
        }
        fn visit_export_default_declaration(&mut self, export: &oxc::ast::ast::ExportDefaultDeclaration<'a>) {
            if let oxc::ast::ast::ExportDefaultDeclarationKind::FunctionDeclaration(function) = &export.declaration {
                self.exported.extend(function.id.as_ref().and_then(|id| id.symbol_id.get()));
            }
            oxc::ast_visit::walk::walk_export_default_declaration(self, export);
        }
        fn visit_function(&mut self, function: &oxc::ast::ast::Function<'a>, flags: oxc::syntax::scope::ScopeFlags) {
            // A function expression's own name is one of two it has.
            if let Some(symbol) = function.id.as_ref().and_then(|id| id.symbol_id.get()) {
                self.function(symbol, function.is_declaration().then_some(&*function.params));
            }
            oxc::ast_visit::walk::walk_function(self, function, flags);
        }
        fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
            if let (oxc::ast::ast::BindingPattern::BindingIdentifier(id), Some(init)) = (&declarator.id, &declarator.init) {
                if let Some(symbol) = id.symbol_id.get() {
                    if let Some((params, unnamed)) = function_params(init) {
                        self.function(symbol, unnamed.then_some(params));
                    }
                    if let Some(string) = static_string(init.get_inner_expression()).filter(|_| !crate::identity::reassigned(self.scoping, symbol)) {
                        self.strings.insert(symbol, string);
                    }
                }
            }
            if let Some(init) = declarator.init.as_ref().filter(|init| self.global_root(init).is_some()) {
                let mut bound = Vec::new();
                bound_symbols(&declarator.id, &mut bound);
                self.given(&bound, init);
            }
            oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
        }
        fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
            // A member that holds the global object, of what is none itself.
            if GLOBAL_MEMBERS.contains(&member.property.name.as_str()) && self.global_root(&member.object).is_none() {
                self.judge(member.span, GlobalRoot::Global);
            }
            oxc::ast_visit::walk::walk_static_member_expression(self, member);
        }
        fn visit_assignment_expression(&mut self, assignment: &oxc::ast::ast::AssignmentExpression<'a>) {
            if let oxc::ast::ast::AssignmentTarget::AssignmentTargetIdentifier(id) = &assignment.left {
                if let Some(symbol) = symbol_of(self.scoping, id) {
                    self.given(&[symbol], &assignment.right);
                }
            }
            oxc::ast_visit::walk::walk_assignment_expression(self, assignment);
        }
        fn visit_simple_assignment_target(&mut self, target: &oxc::ast::ast::SimpleAssignmentTarget<'a>) {
            if let oxc::ast::ast::SimpleAssignmentTarget::StaticMemberExpression(member) = target {
                self.replaces_promise |= member.property.name == "Promise";
            }
            oxc::ast_visit::walk::walk_simple_assignment_target(self, target);
        }
        fn visit_property_key(&mut self, key: &oxc::ast::ast::PropertyKey<'a>) {
            self.replaces_promise |= key.static_name().is_some_and(|name| name == "Promise");
            oxc::ast_visit::walk::walk_property_key(self, key);
        }
        fn visit_string_literal(&mut self, literal: &oxc::ast::ast::StringLiteral<'a>) {
            self.replaces_promise |= literal.value == "Promise";
        }
        fn visit_template_literal(&mut self, template: &oxc::ast::ast::TemplateLiteral<'a>) {
            self.replaces_promise |= template.single_quasi().is_some_and(|text| text == "Promise");
            oxc::ast_visit::walk::walk_template_literal(self, template);
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
    let mut reads = Reads {
        scoping,
        ancestors: Vec::new(),
        found: None,
        direct_eval: false,
        timers: Vec::new(),
        functions: FxHashSet::default(),
        executors: FxHashSet::default(),
        parameters: FxHashMap::default(),
        calls: FxHashMap::default(),
        exported: FxHashSet::default(),
        arguments: false,
        replaces_promise: false,
        global_let_goes: Vec::new(),
        imports: FxHashMap::default(),
        strings: FxHashMap::default(),
        global_aliases: FxHashSet::default(),
        alias_flows: Vec::new(),
        binding_effects: Vec::new(),
    };
    reads.visit_program(program);
    // What a use of a binding that holds the global object does, it does.
    if !reads.global_aliases.is_empty() {
        while let Some(&(_, to)) = reads.alias_flows.iter().find(|(from, to)| reads.global_aliases.contains(from) && !reads.global_aliases.contains(to)) {
            reads.global_aliases.insert(to);
        }
        for (symbol, effect) in std::mem::take(&mut reads.binding_effects) {
            if reads.global_aliases.contains(&symbol) {
                reads.apply(GlobalRoot::Global, effect);
            }
        }
    }
    reads.replaces_promise |= scoping.get_root_binding("Promise".into()).is_some_and(|symbol| {
        let flags = scoping.symbol_flags(symbol);
        flags.intersects(oxc::semantic::SymbolFlags::Value) && !flags.intersects(oxc::semantic::SymbolFlags::Import)
    });
    let mut trusts_promise = false;
    if reads.found.is_none() && reads.timers.iter().any(|first| !matches!(first, Argument::Function)) {
        reads.functions.retain(|symbol| !crate::identity::reassigned(scoping, *symbol));
        // An executor's parameters trust the global `Promise`; a module that
        // reads `arguments` may call an executor as `callee`.
        let mut proven = reads.proves(&FxHashSet::default());
        if !proven && !reads.arguments {
            proven = reads.proves(&reads.executors);
            trusts_promise = proven;
        }
        if !proven {
            reads.found = Some(STRING_TIMER);
        }
    }
    let global_let_goes = reads.global_let_goes.iter().collect::<std::collections::BTreeSet<_>>().into_iter().map(|source| source.to_string()).collect();
    StringCode { reads: reads.found, direct_eval: reads.direct_eval, trusts_promise, replaces_promise: reads.replaces_promise, global_let_goes }
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
    const BUILTINS: [&str; 2] = MODULE_BUILTINS;
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
            if import.source.value.as_str().is_some_and(|specifier| BUILTINS.contains(&specifier)) {
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
                if external.expression.value.as_str().is_some_and(|specifier| BUILTINS.contains(&specifier)) {
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
        /// The `createRequire` imports and the `require` bindings they make
        /// (`own_requires`).
        own: FxHashSet<SymbolId>,
        requires: FxHashSet<SymbolId>,
        found: Option<&'static str>,
    }
    impl Uses<'_> {
        /// Bound by nothing, or only by an ambient declaration.
        fn unbound(&self, id: &IdentifierReference<'_>) -> bool {
            id.reference_id.get().is_some_and(|id| binding_of(self.scoping, id).is_none())
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
                    matches!(member.static_property_name().and_then(oxc::str::JSStr::as_str), Some("context" | "resolve")) && is_require(member.object())
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
            let symbol = id.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id());
            if symbol.is_some_and(|symbol| self.requires.contains(&symbol)) {
                // A require of this file's own read other than as a direct
                // callee, which is never visited.
                self.found.get_or_insert(CREATE);
            } else if id.name == "require" && self.unbound(id) {
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
            if member.static_property_name().and_then(oxc::str::JSStr::as_str).is_none_or(|name| !self.member(&member.object, name)) {
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
            let builtin = import.source.value.as_str().is_some_and(|specifier| BUILTINS.contains(&specifier)) && !import.import_kind.is_type();
            // A `createRequire` that makes only this file's own `require`
            // loads only what that `require` does.
            let own = std::mem::take(&mut self.own);
            let own_import = |specifier: &ImportDeclarationSpecifier<'_>| match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                    named.local.symbol_id.get().is_some_and(|symbol| own.contains(&symbol))
                }
                _ => false,
            };
            let loads = |specifier: &ImportDeclarationSpecifier<'_>| match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                    !named.import_kind.is_type() && !BUILTIN_MEMBERS.contains(&named.imported.name().as_str())
                }
                _ => false,
            };
            let mut loading = false;
            for specifier in import.specifiers.iter().flatten().filter(|specifier| !own_import(specifier)) {
                self.visit_import_declaration_specifier(specifier);
                loading |= loads(specifier);
            }
            self.own = own;
            if builtin && loading {
                self.found.get_or_insert(BUILTIN);
            }
        }
        fn visit_export_all_declaration(&mut self, export: &ExportAllDeclaration<'a>) {
            if export.source.value.as_str().is_some_and(|specifier| BUILTINS.contains(&specifier)) && !export.export_kind.is_type() {
                self.found.get_or_insert(BUILTIN);
            }
            oxc::ast_visit::walk::walk_export_all_declaration(self, export);
        }
        fn visit_export_from_declaration(&mut self, export: &ExportFromDeclaration<'a>) {
            let builtin = export.source.value.as_str().is_some_and(|specifier| BUILTINS.contains(&specifier));
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
    let (own, requires) = own_requires(program, scoping);
    let mut uses = Uses { scoping, builtins: builtins.0, own, requires, found: None };
    uses.visit_program(program);
    uses.found
}

/// The spellings of Node's `module` builtin.
const MODULE_BUILTINS: [&str; 2] = ["module", "node:module"];

/// The `createRequire` imports of the `module` builtin each of whose reads
/// is the call `createRequire(import.meta.url)` (or `import.meta.filename`)
/// that initializes a module-scope `const require`, with those `require`
/// bindings: a require of this file's own, which `loads` reads by its name
/// as it reads the unbound `require`'s, so long as each read of it is a
/// direct call, as `loader_escape` checks.
fn own_requires(
    program: &oxc::ast::ast::Program<'_>,
    scoping: &oxc::semantic::Scoping,
) -> (FxHashSet<SymbolId>, FxHashSet<SymbolId>) {
    use oxc::ast::ast::{BindingPattern, VariableDeclarationKind};
    let mut imported = FxHashSet::default();
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else { continue };
        if !import.source.value.as_str().is_some_and(|specifier| MODULE_BUILTINS.contains(&specifier)) || import.import_kind.is_type() {
            continue;
        }
        for specifier in import.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportSpecifier(named) = specifier {
                if !named.import_kind.is_type() && named.imported.name() == "createRequire" {
                    imported.extend(named.local.symbol_id.get());
                }
            }
        }
    }
    if imported.is_empty() {
        return Default::default();
    }
    let own_url = |call: &CallExpression<'_>| {
        let [argument] = call.arguments.as_slice() else { return false };
        matches!(
            argument.as_expression().map(Expression::get_inner_expression),
            Some(Expression::StaticMemberExpression(member))
                if matches!(member.object, Expression::ImportMeta(_))
                    && matches!(member.property.name.as_str(), "url" | "filename")
        )
    };
    // Each module-scope `const require = createRequire(<this file>)`, by
    // the import its callee reads, with the `require` binding. An exported
    // one is handed on, so it is not one.
    let mut made: Vec<(SymbolId, SymbolId)> = Vec::new();
    for statement in &program.body {
        let Statement::VariableDeclaration(declaration) = statement else { continue };
        if declaration.kind != VariableDeclarationKind::Const || declaration.declare {
            continue;
        }
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(id) = &declarator.id else { continue };
            let Some(Expression::CallExpression(call)) = declarator.init.as_ref().map(Expression::get_inner_expression) else {
                continue;
            };
            let callee = match call.callee.get_inner_expression() {
                Expression::Identifier(callee) => {
                    callee.reference_id.get().and_then(|reference| scoping.get_reference(reference).symbol_id())
                }
                _ => None,
            };
            if let (true, Some(callee), Some(binding)) = (id.name == "require" && own_url(call), callee, id.symbol_id.get()) {
                made.push((callee, binding));
            }
        }
    }
    let own: FxHashSet<SymbolId> = imported
        .into_iter()
        .filter(|create| made.iter().filter(|(callee, _)| callee == create).count() == scoping.get_resolved_reference_ids(*create).len())
        .collect();
    let requires = made.into_iter().filter(|(callee, _)| own.contains(callee)).map(|(_, binding)| binding).collect();
    (own, requires)
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
    /// Its `render` replaced with a wrapper that calls the old one with the
    /// same props, and nothing else (see `renders_through`): rendering the
    /// object renders what it did before.
    RendersThrough,
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

/// Each module-scope function (a declaration, or a `const` arrow or
/// function expression) with its name, and so too the function a call of one
/// returns as its only result, keyed `name()`, at most four calls deep.
fn module_functions<'b, 'a>(program: &'b Program<'a>) -> Vec<(String, String, FunctionParts<'b, 'a>)> {
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
    functions
}

/// The module-scope functions, never reassigned, whose every return builds
/// an object of only static keys holding plain data
/// (`forwarding::literal_keys`), none of them `as` or `asChild`: a spread
/// of what a call of one returns cannot retarget the element it is spread
/// on.
pub(crate) fn bounded_returns(program: &Program<'_>, scoping: &Scoping) -> BTreeSet<String> {
    let unbound = |id: &oxc::ast::ast::IdentifierReference<'_>| symbol_of(scoping, id).is_none();
    let bounded = |value: Option<&Expression<'_>>| {
        let mut keys = Vec::new();
        value.is_none_or(|value| forwarding::literal_keys(value, true, &mut keys, &unbound) && !keys.iter().any(|key| key == "as" || key == "asChild"))
    };
    module_functions(program)
        .into_iter()
        .filter(|(name, key, function)| {
            name == key
                && !scoping.get_root_binding(name.as_str().into()).is_some_and(|symbol| crate::identity::reassigned(scoping, symbol))
                && match (function.concise, function.body) {
                    (Some(result), _) => bounded(Some(result)),
                    (None, Some(body)) => forwarding::every_return(ComponentBody::Function(body), &bounded),
                    (None, None) => false,
                }
        })
        .map(|(name, ..)| name)
        .collect()
}

/// For each module-scope function (a declaration, or a `const` arrow or
/// function expression), how each parameter treats its object: see
/// `ParamReading`. So too for the function a call of one returns as its only
/// result (`() => (parts) => parts`), keyed `name()`, at most four calls
/// deep. Every parameter of a function whose parameter list has a default,
/// a destructuring or a rest counts as unsafe, and so does every parameter
/// of a function something reassigns.
pub(crate) fn function_param_readings(
    program: &Program<'_>,
    scoping: &Scoping,
    direct_eval: bool,
) -> BTreeMap<String, Vec<ParamReading>> {
    use oxc::ast::ast::BindingPattern;
    let functions = module_functions(program);
    let mut readings: BTreeMap<String, Vec<ParamReading>> = BTreeMap::new();
    let mut params: FxHashMap<SymbolId, (String, usize)> = FxHashMap::default();
    // The functions that may do anything with every argument: reassigned,
    // or reading their own `arguments`.
    let mut unsafe_functions: FxHashSet<String> = FxHashSet::default();
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
        // argument past its parameters. A parameter list that is not plain
        // names runs code before the body, which may do so without naming
        // a parameter (`ignored = arguments[0].x = 1`): every parameter of
        // such a function is unsafe.
        let reassigned = scoping
            .get_root_binding(name.as_str().into())
            .is_some_and(|symbol| scoping.get_resolved_references(symbol).any(oxc::semantic::Reference::is_write));
        if reassigned
            || !simple_params(formal)
            || function.body.is_some_and(|body| !function.arrow && reads_own_arguments(body, scoping))
        {
            reading.iter_mut().for_each(|param| *param = ParamReading::Unsafe);
            unsafe_functions.insert(key.clone());
        }
        spans.insert(key.clone(), function.span);
        readings.insert(key.clone(), reading);
    }
    if params.is_empty() {
        return readings;
    }
    if direct_eval {
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
    let mut readings = scan.finish();
    // A first parameter whose object has its `render` replaced by a wrapper
    // that calls the old one with the same props: the escape scan defers
    // only a component handed as a first argument (`Deferral::Handoff`). The
    // proof reads the body alone, so every parameter is a plain name: a
    // default, a destructuring or a rest runs before the body.
    for (_, key, function) in &functions {
        if unsafe_functions.contains(key) || !simple_params(function.params) {
            continue;
        }
        let (Some(body), Some(param)) = (function.body, function.params.items.first()) else { continue };
        let (BindingPattern::BindingIdentifier(id), Some(first)) =
            (&param.pattern, readings.get_mut(key).and_then(|reading| reading.first_mut()))
        else {
            continue;
        };
        if *first == ParamReading::Unsafe
            && id.symbol_id.get().is_some_and(|symbol| renders_through::renders_through(body, symbol, scoping))
        {
            *first = ParamReading::RendersThrough;
        }
    }
    readings
}

/// Whether every parameter is a plain name, with no default, destructuring
/// or rest: nothing runs before the body.
fn simple_params(params: &oxc::ast::ast::FormalParameters<'_>) -> bool {
    params.rest.is_none()
        && params.items.iter().all(|param| {
            matches!(param.pattern, oxc::ast::ast::BindingPattern::BindingIdentifier(_)) && param.initializer.is_none()
        })
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
        self.result().and_then(Self::of_expression)
    }

    /// The function's result: its concise body, or a body that is one
    /// `return`.
    fn result(&self) -> Option<&'b Expression<'a>> {
        if let Some(result) = self.concise {
            return Some(result);
        }
        let [Statement::ReturnStatement(statement)] = self.body?.statements.as_slice() else { return None };
        statement.argument.as_ref()
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
                keys.push(crate::eval::property_name(&prop.key).map_or_else(|| crate::flow::ANY_MEMBER.to_string(), |key| key.to_string()));
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
    /// See `identity_records`: the proof judged every use of these, and a
    /// value of one of these records' literals is stored where nothing
    /// changes or hands it on.
    identity_records: &'s FxHashSet<SymbolId>,
    source: &'s str,
    /// Built on the first line a use asks for.
    lines: std::cell::OnceCell<crate::facts::LineStarts>,
    candidates: FxHashMap<SymbolId, Rc<ObjectBinding>>,
    /// In style mode, the names of the candidates that are not namespaces:
    /// the objects a member may be stored in.
    container_names: FxHashSet<String>,
    global_object: bool,
    /// React's own functions, whose context readers change nothing.
    react: ReactImports,
    uses: BTreeMap<String, ObjectUse>,
    /// See `FileFacts::extend_calls`.
    extend_calls: BTreeMap<String, Vec<ObjectUse>>,
    /// See `FileFacts::method_calls`.
    method_calls: BTreeMap<String, Vec<MethodCall>>,
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
    /// See `FileFacts::written_bindings`; empty in style mode.
    written_bindings: BTreeMap<String, ObjectUse>,
    /// See `FileFacts::written_member_uses`; empty in style mode.
    written_member_uses: Vec<WrittenMember>,
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
    /// See `chain_walk::wrapped_components`; empty in style mode.
    wrapped: FxHashMap<(u32, u32), String>,
    /// See `FileFacts::wrapped_uses`; empty in style mode.
    wrapped_uses: Vec<WrappedUse>,
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
    /// Whether the reference at `span` is in the literal a record of
    /// `identity_records` is declared with: one of its values, since the
    /// proof admits no other property.
    fn in_identity_record(&self, span: Span) -> bool {
        let mut ancestors = self.ancestors.iter().rev();
        let (_, Some(AstKind::ObjectProperty(_))) = peel_wrappers(span, &mut ancestors) else { return false };
        let Some(AstKind::ObjectExpression(object)) = ancestors.next() else { return false };
        match peel_wrappers(object.span, &mut ancestors) {
            (init, Some(AstKind::VariableDeclarator(declarator))) if declarator.init.as_ref().map(GetSpan::span) == Some(init) => {
                matches!(&declarator.id, oxc::ast::ast::BindingPattern::BindingIdentifier(id)
                    if id.symbol_id.get().is_some_and(|symbol| self.identity_records.contains(&symbol)))
            }
            _ => false,
        }
    }

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
                        used: ObjectUse { line, at: Some(ident.span.start), what: format!("{name} {what}") },
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
            self.style_uses.push((alias.binding.clone(), ObjectUse { line, at: Some(ident.span.start), what }, at));
        }
    }

    /// The 1-based line `span` starts on.
    fn line(&self, span: Span) -> usize {
        self.lines.get_or_init(|| crate::facts::LineStarts::of(self.source)).line(span.start as usize)
    }

    /// The chain whose `.asComponent()` takes the value at `span` as its
    /// argument, given the ancestors above it.
    fn wrapped_at<'b>(&self, span: Span, mut ancestors: impl Iterator<Item = &'b AstKind<'a>>) -> Option<String>
    where
        'a: 'b,
    {
        if self.wrapped.is_empty() {
            return None;
        }
        let (current, _) = peel_wrappers(span, &mut ancestors);
        self.wrapped.get(&(current.start, current.end)).cloned()
    }

    /// A destructuring at `span`, which binds members' values to names the
    /// scan does not follow, which may write through them. The other object
    /// facts read it as a read.
    fn destructured(&self, span: Span) -> ObjectUse {
        let what = "is destructured into bindings extraction does not follow".to_string();
        ObjectUse { line: Some(self.line(span)), at: Some(span.start), what }
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
            !writes_nothing(what)
                && !matches!(what.as_str(), "is stored in an object" | "is stored in an array" | "is passed as a prop")
        })
    }
}

/// Whether the use `object_use` describes calls the object, or a member of
/// it as a method: the callee is taken to leave the objects it holds as they
/// are.
fn writes_nothing(what: &str) -> bool {
    what == "is called" || what.ends_with(" called as a method")
}

/// Records `write`, a use that may write through a member of its binding:
/// one that hands it to the `.asComponent()` terminal of `chain` among
/// `wrapped`, a write only where that call survives the transform, and any
/// other as `written_member` does.
fn written_or_wrapped(members: &mut Vec<WrittenMember>, wrapped: &mut Vec<WrappedUse>, chain: Option<String>, write: WrittenMember) {
    match chain {
        Some(chain) => wrapped.push(WrappedUse { written: write, whole: false, chain }),
        None => written_member(members, &write.binding, write.member.as_deref(), write.subject, write.used),
    }
}

/// Records `write`, a use that may write through a member of a namespace,
/// as `written_or_wrapped` does, and the namespace's first such use.
fn written_through(
    namespaces: &mut WrittenNamespaces,
    members: &mut Vec<WrittenMember>,
    wrapped: &mut Vec<WrappedUse>,
    chain: Option<String>,
    write: WrittenMember,
) {
    namespaces.entry(write.binding.clone()).or_insert_with(|| (write.subject.clone(), write.used.clone()));
    written_or_wrapped(members, wrapped, chain, write);
}

/// What a use is said of: `X.key`, or `a member of X` for a member a key
/// names at runtime or any member.
fn member_subject(binding: &str, member: Option<&str>) -> String {
    member.map_or_else(|| format!("a member of {binding}"), |member| format!("{binding}.{member}"))
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
                let used = ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what };
                let subject = ident.name.to_string();
                let chain = self.wrapped_at(ident.span, self.ancestors.iter().rev());
                let write = WrittenMember::new(&namespace, None, subject, used);
                written_through(&mut self.written_namespaces, &mut self.written_member_uses, &mut self.wrapped_uses, chain, write);
            }
        }
        let Some(binding) = self.candidates.get(&symbol).cloned() else { return };
        let binding = &binding;
        if !reference.is_value() || self.identity_records.contains(&symbol) || self.in_identity_record(ident.span) {
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
                                self.flat_reads.push((key, ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what }));
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
                        at: Some(ident.span.start),
                        what: format!("is read by Object.{}()", if pairs { "entries" } else { "values" }),
                    };
                    let base: Vec<String> =
                        path.into_iter().chain(std::iter::once(crate::flow::ANY_MEMBER.to_string())).take(crate::flow::PATH_DEPTH).collect();
                    let name = binding.name.clone();
                    if self.follow_elements(call, &name, &base, pairs, &used) {
                        return;
                    }
                }
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
                    let what = match style_object_use(ident.span, &self.ancestors, &self.container_names, self.global_object) {
                        StyleUse::Unsafe(what) => what,
                        _ => "is returned from a function".to_string(),
                    };
                    let used = ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what };
                    self.returns.push((binding.name.clone(), function, at, used));
                    return;
                }
                match style_object_use(ident.span, &self.ancestors, &self.container_names, self.global_object) {
                    StyleUse::Read => return,
                    StyleUse::StoredIn { container, at } => {
                        self.containers.push((binding.name.clone(), container, at));
                        return;
                    }
                    StyleUse::FlatRead(what) => {
                        self.flat_reads.push((binding.name.clone(), ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what }));
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
                            used: ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what },
                        });
                        return;
                    }
                    StyleUse::MemberHandoff(at, what) => {
                        // A member kept in a function's own `const` is
                        // judged by that `const`'s uses.
                        if let Some((local, function)) = local_alias_target(ident.span, &self.ancestors) {
                            let used = ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what };
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
            self.style_uses.push((key, ObjectUse { line: Some(line), at: Some(ident.span.start), what }, at));
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
                let line = self.line(ident.span);
                self.uses.insert(key, ObjectUse { line: Some(line), at: Some(ident.span.start), what });
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
                    let name = Some(member.property.name.as_str());
                    if let Some(what) = self.member_value_write(member.span, ancestors.clone()) {
                        let used = ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what };
                        let chain = self.wrapped_at(member.span, ancestors.clone());
                        let write = WrittenMember::new(&namespace, name, key.clone(), used);
                        written_through(&mut self.written_namespaces, &mut self.written_member_uses, &mut self.wrapped_uses, chain, write);
                    } else if !destructured_members(member.span, ancestors.clone()).is_empty() {
                        let used = self.destructured(ident.span);
                        written_member(&mut self.written_member_uses, &namespace, name, key.clone(), used);
                    }
                    if self.uses.contains_key(&key) {
                        return;
                    }
                    let what = object_use(member.span, ancestors, false, self.global_object, false);
                    (key, what)
                }
                // Some member a key names at runtime.
                Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == span => {
                    let subject = member_subject(&namespace, None);
                    if let Some(what) = self.member_value_write(member.span, ancestors.clone()) {
                        let used = ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what };
                        let chain = self.wrapped_at(member.span, ancestors.clone());
                        let write = WrittenMember::new(&namespace, None, subject, used);
                        written_through(&mut self.written_namespaces, &mut self.written_member_uses, &mut self.wrapped_uses, chain, write);
                    } else if !destructured_members(member.span, ancestors).is_empty() {
                        let used = self.destructured(ident.span);
                        written_member(&mut self.written_member_uses, &namespace, None, subject, used);
                    }
                    (namespace, Some("is used as a whole namespace".to_string()))
                }
                _ => {
                    let what = "is used as a whole namespace".to_string();
                    let used = ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what: what.clone() };
                    let chain = self.wrapped_at(ident.span, self.ancestors.iter().rev());
                    let write = WrittenMember::new(&namespace, None, namespace.clone(), used);
                    written_through(&mut self.written_namespaces, &mut self.written_member_uses, &mut self.wrapped_uses, chain, write);
                    (namespace, Some(what))
                }
            }
        } else {
            // A member's value written through, as through a namespace's, or
            // bound by a destructuring.
            let mut rest = ancestors.clone();
            let (span, parent) = peel_wrappers(ident.span, &mut rest);
            let member = match parent {
                Some(AstKind::StaticMemberExpression(member)) if member.object.span() == span => {
                    Some((member.span, Some(member.property.name.as_str())))
                }
                Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == span => Some((member.span, None)),
                _ => None,
            };
            if let Some((span, name)) = member {
                let wrapping = self.wrapped_at(span, rest.clone());
                let used = match self.member_value_write(span, rest.clone()) {
                    Some(what) => Some(ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what }),
                    None => (!destructured_members(span, rest).is_empty()).then(|| self.destructured(ident.span)),
                };
                if let Some(used) = used {
                    let write = WrittenMember::new(&binding.name, name, member_subject(&binding.name, name), used);
                    written_or_wrapped(&mut self.written_member_uses, &mut self.wrapped_uses, wrapping, write);
                }
            }
            for name in destructured_members(ident.span, ancestors.clone()) {
                // The binding is what is destructured; the member is only selected.
                let used = self.destructured(ident.span);
                written_member(&mut self.written_member_uses, &binding.name, name.as_deref(), binding.name.clone(), used);
            }
            let used = self.uses.contains_key(&binding.name);
            let written = self.written_bindings.contains_key(&binding.name);
            if (used && written) || (binding.facade && top_level_write(ident.span, &self.ancestors)) {
                return;
            }
            // Passed to a module-scope function nothing writes: the engine
            // judges whether that parameter only reads it.
            if let Some((callee, index)) = fixed_call_argument(ident.span, &self.ancestors, self.scoping) {
                self.handoffs.push(Handoff {
                    binding: binding.name.clone(),
                    used: ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what: format!("is passed to {callee}()") },
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
            let wrapping = self.wrapped.get(&(span.start, span.end)).cloned();
            let Some(what) = object_use(ident.span, ancestors, true, self.global_object, assigned_target) else { return };
            let writes = !written && !writes_nothing(&what);
            if used && !writes {
                return;
            }
            let used_at = ObjectUse { line: Some(self.line(ident.span)), at: Some(ident.span.start), what };
            if writes {
                match wrapping {
                    Some(chain) => {
                        let written = WrittenMember::new(&binding.name, None, binding.name.clone(), used_at.clone());
                        self.wrapped_uses.push(WrappedUse { written, whole: true, chain });
                    }
                    None => {
                        self.written_bindings.insert(binding.name.clone(), used_at.clone());
                    }
                }
            }
            if !used {
                // An `X.extend()` call that heads an extension the engine
                // extracts is replaced with it, so nothing of it runs: that
                // is known once chains evaluate (`FileFacts::changing_uses`).
                // Style mode returned above.
                // Any other method call is judged once the analysis knows the
                // function the member holds (`FileFacts::changing_uses`).
                let extends = matches!(member, Some((_, Some("extend")))) && writes_nothing(&used_at.what);
                let method = match member {
                    Some((_, Some(name))) if used_at.what == format!("has its member {name} called as a method") => Some(name),
                    _ => None,
                };
                if extends {
                    self.extend_calls.entry(binding.name.clone()).or_default().push(used_at);
                } else if let Some(member) = method {
                    self.method_calls.entry(binding.name.clone()).or_default().push(MethodCall { member: member.to_string(), used: used_at });
                } else {
                    self.uses.insert(binding.name.clone(), used_at);
                }
            }
            return;
        };
        let Some(what) = what else { return };
        let line = self.line(ident.span);
        self.uses.entry(key).or_insert(ObjectUse { line: Some(line), at: Some(ident.span.start), what });
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

/// The members a destructuring of the object at `span` binds (`const { A,
/// B: b } = X`, `({ A } = X)`): each static key, and `None` for a computed
/// key or a rest element, which may take any member. Empty when the use is
/// no destructuring.
fn destructured_members<'b, 'a: 'b>(span: Span, mut ancestors: impl Iterator<Item = &'b AstKind<'a>>) -> Vec<Option<String>> {
    use oxc::ast::ast::{AssignmentTarget, AssignmentTargetProperty, BindingPattern};
    let (current, parent) = peel_wrappers(span, &mut ancestors);
    let key = |key: &oxc::ast::ast::PropertyKey<'_>, computed: bool| {
        if computed { None } else { crate::eval::property_name(key).map(|name| name.to_string()) }
    };
    match parent {
        Some(AstKind::VariableDeclarator(declarator)) if declarator.init.as_ref().map(GetSpan::span) == Some(current) => {
            let BindingPattern::ObjectPattern(pattern) = &declarator.id else { return Vec::new() };
            let keys = pattern.properties.iter().map(|property| key(&property.key, property.computed));
            keys.chain(pattern.rest.is_some().then_some(None)).collect()
        }
        Some(AstKind::AssignmentExpression(assignment)) if assignment.right.span() == current => {
            let AssignmentTarget::ObjectAssignmentTarget(target) = &assignment.left else { return Vec::new() };
            let keys = target.properties.iter().map(|property| match property {
                AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(id) => Some(id.binding.name.to_string()),
                AssignmentTargetProperty::AssignmentTargetPropertyProperty(property) => key(&property.name, property.computed),
            });
            keys.chain(target.rest.is_some().then_some(None)).collect()
        }
        _ => Vec::new(),
    }
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
    /// Keys a `delete` takes from the spread parameter: each forwarding
    /// element may render without them.
    pub deleted: Vec<String>,
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
                                    crate::eval::literal_string(literal).map(|text| Some(text.to_string()))
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
                        // An unknown (computed) key gives up: `property_name` has none.
                        key: crate::eval::property_name(&property.key)?.to_string(),
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
        deletes: FxHashMap::default(),
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
        if crate::identity::reassigned(scoping, binding) || crate::identity::reassigned(scoping, spread) {
            scan.invalid.insert(index);
        }
        scan.bindings.insert(binding, index);
        scan.spreads.insert(spread, index);
        // A named prop the body reassigns no longer holds what renders pass.
        for prop in &candidate.named {
            if let (Some(symbol), Some(default)) = (prop.binding.symbol_id.get(), &prop.default) {
                if !crate::identity::reassigned(scoping, symbol) {
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
            let may_omit = scan.may_omit.remove(&index).unwrap_or_default();
            // A key the pattern takes out is never in the rest to delete.
            let deleted: Vec<String> = scan
                .deletes
                .remove(&index)
                .unwrap_or_default()
                .into_iter()
                .filter(|key| !candidate.named.iter().any(|prop| prop.key == *key))
                .collect();
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
                    may_omit,
                    deleted,
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
    /// Candidate index → the static keys a `delete` takes from its spread
    /// parameter.
    deletes: FxHashMap<usize, BTreeSet<String>>,
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
            if self.referenced.contains(&alias) || crate::identity::reassigned(self.scoping, alias) {
                self.invalid.insert(index);
            }
            self.aliases.insert(alias, (index, omits));
            return;
        }
        // A delete of one of its static members (`delete rest.x`, also in
        // parentheses or through `?.`) removes a key from the plain object
        // the parameter is and adds none.
        let deleted = {
            let mut up = self.ancestors.iter().rev();
            let (current, parent) = peel_wrappers(ident.span, &mut up);
            match parent {
                Some(AstKind::StaticMemberExpression(member))
                    if member.object.span() == current
                        && matches!(member_effect(member.span, &mut up), Some(MemberEffect::Deleted)) =>
                {
                    Some(member.property.name.to_string())
                }
                _ => None,
            }
        };
        if let Some(key) = deleted {
            self.deletes.entry(index).or_default().insert(key);
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
/// `const X = R` or `const X = Object.assign(R, …)`, a member of a
/// `compose()` call, or a read a top-level `const` object literal holds once
/// built (`FollowedReads`: `Root: R`, `Actions: Actions.Root`, `...Family`),
/// whose member table follows it. Such a component can render anywhere with
/// any props: any other object member and an alias declared inside a
/// function are escapes, since usage follows neither. A member read records
/// its dotted path (`Card.Body`).
struct EscapeScan<'a, 's> {
    scoping: &'s Scoping,
    /// See `identity_records`: their references hand nothing over.
    identity_records: &'s FxHashSet<SymbolId>,
    chains: &'s [&'s ChainDescriptor],
    /// See `ComposeFamilyInfo::slot_values`, for every family of the
    /// module's facts that usage follows (`ComposeFamilyInfo::addressable`).
    slot_values: FxHashSet<(u32, u32)>,
    /// What each of the module's facades reads once built (`FileFacts::facades`).
    reads: BTreeMap<String, crate::facts::FollowedReads>,
    /// The objects among `reads` that hold a candidate: one hands it over
    /// where it escapes, whatever its name's case.
    holders: BTreeSet<String>,
    /// See `FileFacts::assigned_target_calls`.
    assigned_target_calls: &'s BTreeSet<(u32, u32)>,
    react: &'s ReactNames,
    /// React's own functions, by scope.
    react_imports: Option<&'s ReactImports>,
    /// Namespace imports: `ui.Button` can name a component whatever the
    /// namespace is called.
    namespaces: BTreeSet<String>,
    /// Named and default imports: one may be a namespace another module
    /// re-exports, or a component whatever its name's case.
    imports: BTreeSet<String>,
    escapes: BTreeSet<String>,
    /// The escapes some reference makes as an extracted `.asComponent()`
    /// terminal's target, and those some other reference makes.
    terminal: BTreeSet<String>,
    elsewhere: BTreeSet<String>,
    /// Each escape some reference makes with a proof the engine may find
    /// that it does not (`Deferral`), and the escapes some reference makes
    /// without one.
    deferrals: BTreeMap<String, BTreeSet<Deferral>>,
    undeferred: BTreeSet<String>,
    ancestors: Vec<AstKind<'a>>,
    /// See `LocalAliases`: what an alias's initializer reads, its elements
    /// render.
    aliases: &'s LocalAliases,
    /// The bindings `ordinary_components` admits ignoring escapes.
    admissible: &'s BTreeSet<String>,
    /// React's wrappers and `const` aliases among them, whatever their
    /// names' case: what a write or hand-on of one changes, it renders.
    react_bindings: BTreeSet<String>,
    /// Bindings a declaration gives a candidate's value (`const r = R`),
    /// whatever their names' case: a reference to one hands that value on.
    value_aliases: BTreeSet<String>,
}

/// A proof the engine may find that a reference does not hand its value
/// over (`FileFacts::deferred_escapes`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Deferral {
    /// A read the facade literal it names holds once built (`...Family`,
    /// `Actions.Root`): proven where every read that facade holds names a
    /// family or facade whose closed table holds only extracted components
    /// (`ObjectMembers::facade_proven`).
    FacadeRead(String),
    /// A component passed as the first argument to the module-scope
    /// function it names: proven where that function's reading of the
    /// parameter is `ParamReading::RendersThrough`.
    Handoff(String),
}

/// How one reference escapes: the path it hands over, and the proof the
/// engine may find that it does not, where there is one.
struct Escape {
    path: String,
    deferral: Option<Deferral>,
}

impl Escape {
    fn plain(path: String) -> Self {
        Self { path, deferral: None }
    }
}

/// Each binding a declaration initializes with another binding's value, as
/// written (`const r = R`, `let r = (R as C)`), in any scope: the alias and
/// the name it reads.
fn declared_aliases(program: &Program<'_>) -> Vec<(String, String)> {
    struct Declared(Vec<(String, String)>);
    impl<'a> Visit<'a> for Declared {
        fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
            if let (oxc::ast::ast::BindingPattern::BindingIdentifier(alias), Some(init)) = (&declarator.id, &declarator.init) {
                if let Expression::Identifier(value) = init.get_inner_expression() {
                    self.0.push((alias.name.to_string(), value.name.to_string()));
                }
            }
            oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
        }
    }
    let mut declared = Declared(Vec::new());
    declared.visit_program(program);
    declared.0
}

impl EscapeScan<'_, '_> {
    fn is_candidate(&self, name: &str) -> bool {
        name.starts_with(|c: char| c.is_ascii_uppercase())
            || self.value_aliases.contains(name)
            || self.react_bindings.contains(name)
            || self.namespaces.contains(name)
            || self.imports.contains(name)
            || self.chains.iter().any(|chain| chain.binding == name)
            || self.holders.contains(name)
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
        if !self.is_candidate(name) || self.aliases.followed(ident.span) || self.identity_records.contains(&symbol) {
            return;
        }
        let Some(Escape { path, deferral }) = self.escape_path(name, ident.span) else { return };
        match deferral {
            Some(deferral) => {
                self.deferrals.entry(path.clone()).or_default().insert(deferral);
                self.elsewhere.insert(path.clone());
            }
            None if path == name && self.terminal_target(name, ident.span) => {
                self.terminal.insert(path.clone());
                self.undeferred.insert(path.clone());
            }
            None => {
                self.elsewhere.insert(path.clone());
                self.undeferred.insert(path.clone());
            }
        }
        self.escapes.insert(path);
    }
}

impl EscapeScan<'_, '_> {
    /// Whether `call` is React's `forwardRef` or `memo`, nested or not, of
    /// the initializer of a top-level `const`, given its ancestors from the
    /// innermost out.
    fn wraps_for_const<'b, 'a: 'b>(
        &self,
        call: &oxc::ast::ast::CallExpression<'a>,
        mut ancestors: impl Iterator<Item = &'b AstKind<'a>> + Clone,
    ) -> bool {
        let Some(react) = self.react_imports else { return false };
        let wrapper = |call: &oxc::ast::ast::CallExpression<'_>| {
            call.arguments.len() == 1 && react.calls(self.scoping, &call.callee, &["forwardRef", "memo"])
        };
        if !wrapper(call) {
            return false;
        }
        // Only a callback `ordinary_components` admits is followed: an
        // Animus component, or an import, keeps its escape here.
        let mut callback = call.arguments[0].as_expression().map(crate::chain_walk::unwrap_type_assertions);
        while let Some(Expression::CallExpression(inner)) = callback {
            if !wrapper(inner) {
                break;
            }
            callback = inner.arguments[0].as_expression().map(crate::chain_walk::unwrap_type_assertions);
        }
        let admitted = match callback {
            Some(Expression::Identifier(callback)) => self.admissible.contains(callback.name.as_str()),
            Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) | Expression::ClassExpression(_)) => true,
            _ => false,
        };
        if !admitted {
            return false;
        }
        let mut current = call.span;
        loop {
            let mut rest = ancestors.clone();
            match rest.next() {
                Some(kind) if is_erased_wrapper(kind) => current = kind.span(),
                Some(AstKind::CallExpression(outer))
                    if wrapper(outer) && outer.arguments.first().map(GetSpan::span) == Some(current) =>
                {
                    current = outer.span;
                }
                _ => return initializes_top_level_const(current, ancestors),
            }
            ancestors = rest;
        }
    }

    /// Whether the reference to `name` at `span` is the target of an
    /// extracted `.asComponent()` terminal, which renders it as an element
    /// and changes nothing in it.
    fn terminal_target(&self, name: &str, span: oxc::span::Span) -> bool {
        use oxc::span::GetSpan;
        let mut up = self.ancestors.iter().rev();
        let (current, parent) = peel_wrappers(span, &mut up);
        matches!(parent, Some(AstKind::CallExpression(call))
            if call.arguments.first().map(GetSpan::span) == Some(current)
                && matches!(&call.callee, Expression::StaticMemberExpression(member) if member.property.name == "asComponent")
                && self.chains.iter().any(|chain| {
                    chain.extractable
                        && chain.terminal == TerminalKind::AsComponent
                        && chain.tag == name
                        && chain.span.0 <= call.span.start
                        && call.span.end <= chain.span.1
                }))
    }

    /// The dotted path under which a reference escapes, or `None` when usage
    /// tracking follows it.
    fn escape_path(&self, name: &str, span: oxc::span::Span) -> Option<Escape> {
        let (chains, slot_values, assigned_target_calls, react) =
            (self.chains, &self.slot_values, self.assigned_target_calls, self.react);
        use oxc::span::GetSpan;
        let mut path = name.to_string();
        let mut current = span;
        let mut rest = self.ancestors.iter().rev();
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
                    if react.element_call(&call.callee).is_some() {
                        return None;
                    }
                    // So is the callback React's `forwardRef` or `memo` wraps
                    // for a top-level `const`, which the facts read through
                    // `react_wrappers`.
                    if path == name && self.wraps_for_const(call, rest.clone()) {
                        return None;
                    }
                    // So is the target of an `Object.assign` call the facts read as
                    // a top-level `const`'s initializer.
                    if assigned_target_calls.contains(&(call.span.start, call.span.end)) {
                        return None;
                    }
                    // A component handed to a module-scope function nothing
                    // writes is the engine's to judge by that function's reading.
                    let handoff = match crate::chain_walk::unwrap_type_assertions(&call.callee) {
                        Expression::Identifier(callee)
                            if path == name
                                && !self.namespaces.contains(name)
                                && fixed_callee(self.scoping, callee.reference_id.get()) =>
                        {
                            Some(Deferral::Handoff(callee.name.to_string()))
                        }
                        _ => None,
                    };
                    return Some(Escape { path, deferral: handoff });
                }
                // `const B = R` at the top level is followed: `<B>` renders as `R`.
                // A destructuring declarator reads members, which nothing follows.
                AstKind::VariableDeclarator(declarator)
                    if path == name
                        && matches!(declarator.id, oxc::ast::ast::BindingPattern::BindingIdentifier(_)) =>
                {
                    return (!initializes_top_level_const(current, std::iter::once(parent).chain(rest)))
                        .then(|| Escape::plain(path));
                }
                // A slot of a compose() family usage follows renders through its
                // member tags, and so is a read a top-level `const` object holds
                // once built (`Root: R`, `Actions: Actions.Root`): the object's
                // member table follows it, and what the object's uses do to it.
                // Any other object member is not followed, nor is a slot of a
                // compose() call whose family usage cannot follow.
                AstKind::ObjectProperty(property) if property.value.span() == current => {
                    let value = property.value.span();
                    if slot_values.contains(&(value.start, value.end)) {
                        return None;
                    }
                    let holder = match (crate::eval::property_name(&property.key).filter(|_| !property.computed), rest.next()) {
                        (Some(key), Some(AstKind::ObjectExpression(object))) => holder_const(object.span, &mut rest)
                            .filter(|holder| self.reads.get(holder).is_some_and(|reads| reads.holds(&key, &path))),
                        _ => None,
                    };
                    return match holder {
                        // The object's member table follows a binding it holds.
                        Some(_) if path == name => None,
                        Some(holder) => Some(Escape { path, deferral: Some(Deferral::FacadeRead(holder)) }),
                        None => Some(Escape::plain(path)),
                    };
                }
                // So is an object such an object copies (`...Family`): the
                // engine reads its members into the object's table, and hands
                // it over unread where it names no family or facade.
                AstKind::SpreadElement(spread) if spread.argument.span() == current && path == name => {
                    let holder = match rest.next() {
                        Some(AstKind::ObjectExpression(object)) if !self.admissible.contains(name) => {
                            holder_const(object.span, &mut rest)
                                .filter(|holder| self.reads.get(holder).is_some_and(|reads| reads.copies.contains(name)))
                        }
                        _ => None,
                    };
                    return Some(Escape { path, deferral: holder.map(Deferral::FacadeRead) });
                }
                _ => return Some(Escape::plain(path)),
            }
        }
        Some(Escape::plain(path))
    }
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
    /// annotation declares, which prove nothing.
    declared_params: FxHashMap<SymbolId, DeclaredUnion>,
    /// Each attribute whose value is such a parameter (`DeclaredHint`).
    declared_hints: Vec<DeclaredHint>,
    /// Enriched collection only: each component parameter binding that holds
    /// one of its props, and each that holds its props object
    /// (`component_parameters`).
    params: ComponentParams,
    /// Enriched collection only: each rest parameter a `createElement`
    /// props object may spread, with the keys it can never carry.
    rests: FxHashMap<SymbolId, BTreeSet<String>>,
    /// Enriched collection only: see `TagOrigin::Provided`.
    provided: FxHashSet<SymbolId>,
    /// The kind of the declaration whose declarators are being visited.
    declaring: oxc::ast::ast::VariableDeclarationKind,
    /// Enriched collection only: each `const` whose value is proven one of
    /// a few literals (`finite_set`), as the walk reaches its declarator.
    local_consts: FxHashMap<SymbolId, FiniteSet>,
    /// Enriched collection only: each `const` that holds a prop of its
    /// component unchanged, or a value computed from its props, as the walk
    /// reaches its declarator.
    local_origins: FxHashMap<SymbolId, ValueOrigin>,
    /// The module has no `with` statement, whose object can stand in for
    /// any name read inside it, so a name read is the binding its scope
    /// gives: a `const`, a parameter, the props object.
    locals: bool,
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
    props: Option<Vec<(String, VariantValue)>>,
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
        let mut spread_forward = None;
        let mut unset = Vec::new();
        for attr_item in &elem.attributes {
            if let JSXAttributeItem::SpreadAttribute(spread_attribute) = attr_item {
                // A spread of object literals with listed literal entries
                // writes those entries, on the branches that hold them.
                match self.enrich.then(|| listed_spread(&spread_attribute.argument, self.origins)).flatten() {
                    Some(entries) => attrs.extend(entries.into_iter().map(|(name, value)| AttrFact {
                        variant_class: value_variant(&value),
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
                        value_origin: ValueOrigin::Unknown,
                        absent: false,
                        members: None,
                    })),
                    None => {
                        spread = Some(attrs.len());
                        spread_forward = (self.enrich && self.locals).then(|| self.spread_forward_of(&spread_attribute.argument)).flatten();
                    }
                }
            }
            if let JSXAttributeItem::Attribute(attr) = attr_item {
                let JSXAttributeName::Identifier(id) = &attr.name else {
                    continue;
                };
                replace_earlier(&mut attrs, &mut spread, &mut unset, &id.name);
                // Until it is recorded, the attribute writes nothing.
                if spread.is_some() {
                    unset.push(id.name.to_string());
                }
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
                let mut value_origin = ValueOrigin::Unknown;
                let mut absent = false;
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
                            Some(set) if dynamic => {
                                if set.values.is_empty() {
                                    continue;
                                }
                                absent = set.absent;
                                enumerable_values = set.values;
                                static_value = None;
                                dynamic = false;
                                dynamic_kind = None;
                                dynamic_span = None;
                                literal = true;
                            }
                            Some(_) => literal = true,
                            None => {}
                        }
                        if dynamic {
                            value_origin = self.value_origin(expression);
                            if let Some(declared) = self.declared_union(expression) {
                                self.declared_hints.push(DeclaredHint {
                                    at: attr.span.start,
                                    prop: id.name.to_string(),
                                    set: declared.set.clone(),
                                    line: crate::facts::line_column(self.source, declared.at).0,
                                });
                            }
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
                unset.retain(|name| name != id.name.as_str());
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
                    value_origin,
                    absent,
                    members: match written {
                        Some(Expression::ObjectExpression(object)) if dynamic && self.enrich => {
                            Some(object_members(object, self.origins))
                        }
                        _ => None,
                    },
                });
            }
        }
        // The element's children are its `children` prop, written after every
        // attribute: they replace a `children` attribute or one a spread
        // delivers.
        let children = written_children(children);
        attrs.extend(children_attribute(&children));
        self.facts.push(UsageFact::Element {
            tag,
            attrs,
            spread,
            span: (elem.span.start, elem.span.end),
            origin,
            written_as_call: crate::lower_create_element::written_as_call(self.source, elem.span.start),
            spread_forward,
            element_child: match children.as_slice() {
                [JSXChild::Element(child)] => Some((child.opening_element.span.start, child.opening_element.span.end)),
                _ => None,
            },
            unset,
        });
    }
}

/// An element's children as JSX passes them: text of whitespace and line
/// breaks, and an empty `{}`, are no children.
fn written_children<'c, 'a>(children: &'c [JSXChild<'a>]) -> Vec<&'c JSXChild<'a>> {
    use oxc::ast::ast::JSXExpression;
    children
        .iter()
        .filter(|child| match child {
            JSXChild::Text(text) => !(text.value.trim().is_empty() && text.value.contains('\n')),
            JSXChild::ExpressionContainer(container) => {
                !matches!(container.expression, JSXExpression::EmptyExpression(_))
            }
            _ => true,
        })
        .collect()
}

/// The `children` prop the written children write, if any: a single text on
/// one line or a single string literal as itself, and anything else as a
/// value usage cannot list.
fn children_attribute(written: &[&JSXChild<'_>]) -> Option<AttrFact> {
    let first = written.first()?;
    let at = first.span().start;
    let end = written.last().map_or(at, |child| child.span().end);
    let literal = match written {
        // An entity (`&#109;`) reads as another character at runtime.
        [JSXChild::Text(text)] if !text.value.contains('\n') && !text.value.contains('&') => {
            Some(text.value.to_string())
        }
        [JSXChild::ExpressionContainer(container)] => match container.expression.as_expression().map(crate::chain_walk::unwrap_type_assertions) {
            Some(Expression::StringLiteral(literal)) => crate::eval::literal_string(literal).map(str::to_string),
            _ => None,
        },
        _ => None,
    };
    Some(match literal {
        Some(value) => AttrFact {
            name: "children".to_string(),
            variant_class: VariantValue::Literal(value.clone()),
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
            value_origin: ValueOrigin::Unknown,
            absent: false,
            members: None,
        },
        None => AttrFact {
            name: "children".to_string(),
            variant_class: VariantValue::Dynamic,
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
            value_origin: ValueOrigin::Unknown,
            absent: false,
            members: None,
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
/// A parameter's literal-union type annotation, which proves nothing: the
/// values it declares and where it is written.
#[derive(Debug, Clone)]
struct DeclaredUnion {
    set: DeclaredSet,
    at: u32,
}

/// A declared literal union's values, and which nullish members it
/// writes: an optional parameter or property may be `undefined`.
#[derive(Debug, Clone, Default)]
struct DeclaredSet {
    values: Vec<Value>,
    null: bool,
    undefined: bool,
}

impl DeclaredSet {
    fn union(mut self, other: DeclaredSet) -> DeclaredSet {
        for value in other.values {
            push_unique(&mut self.values, value);
        }
        self.null |= other.null;
        self.undefined |= other.undefined;
        self
    }
}

/// An attribute whose value is a parameter a literal union annotates: what
/// would close its slot were annotations trusted, for slot provenance only.
#[derive(Debug, Clone)]
pub(crate) struct DeclaredHint {
    /// The attribute's offset, as `AttrFact::at`.
    pub at: u32,
    pub prop: String,
    set: DeclaredSet,
    /// The annotation's line.
    pub line: usize,
}

impl DeclaredHint {
    /// The slot opening's detail: the annotation in `file` and what it declares.
    pub(crate) fn detail(&self, file: &str) -> String {
        let mut values: Vec<String> = self.set.values.iter().map(|value| match value {
            Value::String(text) => format!("'{text}'"),
            other => other.to_string(),
        }).collect();
        values.extend(self.set.null.then(|| "null".to_string()));
        values.extend(self.set.undefined.then(|| "undefined".to_string()));
        format!("would close if trusted: {file}:{} declares {}", self.line, values.join(" | "))
    }
}

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

    /// Where a runtime value `expression` comes from: a prop of the
    /// enclosing component passed on unchanged, a React state hook's state
    /// slot, or a value computed from the component's props.
    fn value_origin(&self, expression: &Expression<'_>) -> ValueOrigin {
        if !self.locals {
            return ValueOrigin::Unknown;
        }
        if let Some(forwarded) = self.forwarded_prop(expression) {
            return ValueOrigin::Forwarded(forwarded);
        }
        if let Some(state) = self.runtime_state(expression) {
            return ValueOrigin::RuntimeState(state);
        }
        self.derived_from(expression).map_or(ValueOrigin::Unknown, ValueOrigin::Derived)
    }

    /// The prop of the enclosing component `expression` passes on as written:
    /// a parameter binding destructured from its props, a member of its props
    /// object or of an object prop, or either `?? undefined`, which the
    /// runtime reads as it reads the prop (`null` and `undefined` select an
    /// option alike), or `?? literal`, which replaces both with the literal.
    fn forwarded_prop(&self, expression: &Expression<'_>) -> Option<ForwardedProp> {
        let scoping = self.origins?;
        let symbol = |ident: &IdentifierReference<'_>| scoping.get_reference(ident.reference_id.get()?).symbol_id();
        match crate::chain_walk::unwrap_type_assertions(expression) {
            Expression::Identifier(ident) => {
                let symbol = symbol(ident)?;
                if let Some(ValueOrigin::Forwarded(forwarded)) = self.local_origins.get(&symbol) {
                    return Some(forwarded.clone());
                }
                (!self.params.empty_defaults.contains(&symbol)).then(|| self.params.props.get(&symbol).cloned()).flatten()
            }
            Expression::StaticMemberExpression(member) => {
                let Expression::Identifier(object) = &member.object else { return None };
                let object = symbol(object)?;
                let key = member.property.name.to_string();
                if let Some(component) = self.params.objects.get(&object) {
                    return Some(ForwardedProp {
                        component: component.clone(),
                        prop: key,
                        path: Vec::new(),
                        default: None,
                        nullish: None,
                        null_to_undefined: false,
                        default_unread: false,
                    });
                }
                let held = self.params.props.get(&object).filter(|_| self.params.object_props.contains(&object))?;
                (!held.defaulted() && held.path.is_empty()).then(|| ForwardedProp { path: vec![key], ..held.clone() })
            }
            Expression::LogicalExpression(logical) if logical.operator.is_coalesce() => {
                let left = self.forwarded_prop(&logical.left)?;
                // `?? undefined` passes a caller's `null` on as `undefined`;
                // a left side that is never nullish passes on unchanged.
                if is_absent(&logical.right, self.origins) {
                    return Some(match left.nullish.is_some() || left.null_to_undefined {
                        true => left,
                        false => ForwardedProp { null_to_undefined: true, ..left },
                    });
                }
                let literal = default_value(&logical.right)?;
                (!left.defaulted() && left.nullish.is_none() && !left.null_to_undefined)
                    .then(|| ForwardedProp { nullish: Some(literal), ..left })
            }
            _ => None,
        }
    }

    /// The React state slot `expression` names.
    fn runtime_state(&self, expression: &Expression<'_>) -> Option<RuntimeState> {
        let Expression::Identifier(ident) = crate::chain_walk::unwrap_type_assertions(expression) else { return None };
        self.params.states.get(&symbol_of(self.origins?, ident)?).cloned()
    }

    /// The enclosing component's props `expression` reads, where it reads
    /// any: the props it is computed from, and what computes it.
    fn derived_from(&self, expression: &Expression<'_>) -> Option<DerivedProp> {
        struct Reads<'p, 's> {
            scoping: &'s Scoping,
            params: &'p ComponentParams,
            locals: &'p FxHashMap<SymbolId, ValueOrigin>,
            found: Vec<(String, String)>,
        }
        impl<'a> Visit<'a> for Reads<'_, '_> {
            fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
                let Some(symbol) = symbol_of(self.scoping, ident) else { return };
                if let Some(forwarded) = self.params.props.get(&symbol) {
                    self.found.push((forwarded.component.clone(), forwarded.prop.clone()));
                }
                // A `const` computed from the props reads what it reads.
                match self.locals.get(&symbol) {
                    Some(ValueOrigin::Forwarded(forwarded)) => self.found.push((forwarded.component.clone(), forwarded.prop.clone())),
                    Some(ValueOrigin::Derived(derived)) => {
                        self.found.extend(derived.props.iter().map(|prop| (derived.component.clone(), prop.clone())));
                    }
                    _ => {}
                }
            }
            fn visit_static_member_expression(&mut self, member: &oxc::ast::ast::StaticMemberExpression<'a>) {
                if let Expression::Identifier(object) = &member.object {
                    if let Some(component) = symbol_of(self.scoping, object).and_then(|symbol| self.params.objects.get(&symbol)) {
                        self.found.push((component.clone(), member.property.name.to_string()));
                        return;
                    }
                }
                oxc::ast_visit::walk::walk_static_member_expression(self, member);
            }
        }
        let mut reads = Reads { scoping: self.origins?, params: &self.params, locals: &self.local_origins, found: Vec::new() };
        reads.visit_expression(expression);
        let (component, _) = reads.found.first()?.clone();
        let mut props: Vec<String> = Vec::new();
        for (owner, prop) in reads.found {
            if owner == component && !props.contains(&prop) {
                props.push(prop);
            }
        }
        let through = match crate::chain_walk::unwrap_type_assertions(expression) {
            // A `const` computed from the props, by what computes it.
            Expression::Identifier(ident) => match symbol_of(self.origins?, ident).and_then(|symbol| self.local_origins.get(&symbol)) {
                Some(ValueOrigin::Derived(derived)) => derived.through.clone(),
                _ => None,
            },
            Expression::CallExpression(call) => {
                let callee = call.callee.span().source_text(self.source);
                (callee.len() <= 40).then(|| callee.to_string())
            }
            Expression::LogicalExpression(logical) => Some(logical.operator.as_str().to_string()),
            Expression::BinaryExpression(binary) => Some(binary.operator.as_str().to_string()),
            Expression::ConditionalExpression(_) => Some("a conditional".to_string()),
            _ => None,
        };
        Some(DerivedProp { component, props, through })
    }

    /// Where a spread's argument passes on the enclosing component's own
    /// props: its props object, or a rest of them.
    fn spread_forward_of(&self, argument: &Expression<'_>) -> Option<SpreadForward> {
        let Expression::Identifier(ident) = argument.get_inner_expression() else { return None };
        let symbol = symbol_of(self.origins?, ident)?;
        if let Some(component) = self.params.objects.get(&symbol) {
            return Some(SpreadForward { component: component.clone(), omits: Vec::new() });
        }
        self.params.rests.get(&symbol).cloned()
    }

    /// The literal union a parameter `expression` names is declared with,
    /// which proves nothing of its value.
    fn declared_union(&self, expression: &Expression<'_>) -> Option<&DeclaredUnion> {
        let Expression::Identifier(ident) = crate::chain_walk::unwrap_type_assertions(expression) else { return None };
        let symbol = self.origins?.get_reference(ident.reference_id.get()?).symbol_id()?;
        self.declared_params.get(&symbol)
    }

    /// The values `expression` can take, when they are proven few: an
    /// explicitly absent value, a string or number literal, a `const` one
    /// named directly (imported ones included), and a conditional, `||` or
    /// `??` of such values. A parameter's type annotation proves none: a
    /// strict program can still pass any value at runtime.
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
            Expression::Identifier(ident) => match evaluate_with_statics(expression, self.static_values, self.scoping) {
                Some(value) => is_class_value(&value).then(|| FiniteSet { values: vec![value], absent: false }),
                // A `const` bound to one of a few literals, as its declarator
                // read it: a `const` keeps the value it was declared with.
                None => self.local_consts.get(&symbol_of(self.origins?, ident)?).cloned(),
            },
            _ => Some(FiniteSet { values: vec![literal_value(expression)?], absent: false }),
        }
    }

    /// The literals whose classes stand for `expression`'s every value: a
    /// finite set's values, or for an object literal with static keys and
    /// finite leaves, each leaf value at its breakpoint (`{ sm: 8 }`) or,
    /// under `_`, bare; the runtime composes those classes; and whether any
    /// may be absent. `None` when the values are not proven few.
    fn finite_class_values(&self, expression: &Expression<'_>) -> Option<FiniteSet> {
        use oxc::ast::ast::{ObjectPropertyKind, PropertyKind};
        let expression = crate::chain_walk::unwrap_type_assertions(expression);
        let Expression::ObjectExpression(object) = expression else {
            return self.finite_set(expression);
        };
        let mut values = Vec::new();
        let mut absent = false;
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            if property.kind != PropertyKind::Init || property.computed {
                return None;
            }
            let key = eval_property_key(&property.key)?;
            let leaf = self.finite_set(&property.value)?;
            absent |= leaf.absent;
            for value in leaf.values {
                push_unique(
                    &mut values,
                    match key.as_str() {
                        BASE_CONDITION => value,
                        _ => serde_json::json!({ key.as_str(): value }),
                    },
                );
            }
        }
        Some(FiniteSet { values, absent })
    }
}

/// Each component's own parameter bindings that pass a prop on unchanged:
/// the bindings its props destructure, in its parameter (`({ size })`) or
/// from its props object in its body (`const { size } = props`), and the
/// binding of its props object (`(props)`), with the members of a
/// destructured prop that holds an object (`buttonProps.size`) and each rest
/// of the props (`...rest`). A component is a top-level function named as
/// one (an uppercase first letter), declared or bound to a variable, plain
/// or inside React's own `memo` or `forwardRef`, whose binding nothing
/// writes. A binding something writes is left out, and so is an object (the
/// props, a rest, an object prop) the body uses other than to read a member,
/// spread it, or destructure it (`props.size = …`, `Object.assign(props, …)`,
/// `props.f()`, `const p = props`); a module that names `arguments` or
/// `eval` unbound, which may change any of them, passes on none. Also each
/// state slot of a React state hook (`const [mode] = useState(…)`).
#[derive(Default)]
struct ComponentParams {
    props: FxHashMap<SymbolId, ForwardedProp>,
    objects: FxHashMap<SymbolId, String>,
    /// The destructured props whose object values pass their members on.
    object_props: FxHashSet<SymbolId>,
    /// The destructured props an empty object defaults (`buttonProps = {}`):
    /// a member passes on, missing where the caller leaves the prop out,
    /// but the object itself is no prop a caller writes.
    empty_defaults: FxHashSet<SymbolId>,
    rests: FxHashMap<SymbolId, SpreadForward>,
    states: FxHashMap<SymbolId, RuntimeState>,
}

/// A destructured prop's default the walk reads: a string, number or
/// boolean literal.
fn default_value(expression: &Expression<'_>) -> Option<Value> {
    eval_static_expression(expression).filter(|value| matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_)))
}

const HOOK_FUNCTIONS: [&str; 2] = ["useState", "useReducer"];

fn component_parameters(program: &Program<'_>, scoping: &Scoping) -> ComponentParams {
    use oxc::ast::ast::{BindingIdentifier, BindingPattern, Declaration, ExportDefaultDeclarationKind};
    let mut params = ComponentParams::default();
    let unresolved = scoping.root_unresolved_references();
    if unresolved.contains_key("arguments") || unresolved.contains_key("eval") {
        return params;
    }
    params.states = state_slots(program, scoping);
    let mut component = |id: &BindingIdentifier<'_>, function: Option<ComponentFunction<'_, '_>>| {
        let Some((first, body)) = function.and_then(|function| function.props.map(|first| (first, function.body))) else {
            return;
        };
        if unwritten(scoping, id).is_none() {
            return;
        }
        let name = id.name.to_string();
        let mut uses = PropsUses { scoping, props: None, tracked: FxHashMap::default(), destructured: Vec::new() };
        let mut named = Vec::new();
        match &first.pattern {
            BindingPattern::BindingIdentifier(object) => {
                let Some(symbol) = unwritten(scoping, object) else { return };
                uses.props = Some(symbol);
                uses.track(symbol, None);
            }
            BindingPattern::ObjectPattern(object) => {
                let (props, keys, empty) = pattern_props(scoping, object);
                params.empty_defaults.extend(empty);
                for (symbol, _, _) in &props {
                    uses.track(*symbol, None);
                }
                if let Some(rest) = object.rest.as_ref().and_then(|rest| match &rest.argument {
                    BindingPattern::BindingIdentifier(id) => unwritten(scoping, id),
                    _ => None,
                }) {
                    uses.track(rest, Some((keys, false)));
                }
                named = props;
            }
            _ => return,
        }
        body.visit(&mut uses);
        // The props object's own destructurings, where the object passes on.
        let props_object = uses.props.filter(|symbol| uses.passes_on(*symbol));
        if let Some(symbol) = props_object {
            params.objects.insert(symbol, name.clone());
            named.extend(std::mem::take(&mut uses.destructured).into_iter().filter(|(object, ..)| *object == symbol).map(
                |(_, bound, key, default)| (bound, key, default),
            ));
        }
        for (symbol, key, default) in named {
            if uses.tracked.contains_key(&symbol) && uses.passes_on(symbol) {
                params.object_props.insert(symbol);
            }
            let default_unread = matches!(default, Some(PropDefault::Unread));
            let default = match default {
                Some(PropDefault::Literal(value)) => Some(value),
                _ => None,
            };
            let forwarded = ForwardedProp {
                component: name.clone(),
                prop: key,
                path: Vec::new(),
                default,
                nullish: None,
                null_to_undefined: false,
                default_unread,
            };
            params.props.insert(symbol, forwarded);
        }
        for (symbol, tracked) in &uses.tracked {
            // A rest the body takes copies the props object as it then is.
            if let Some((omits, in_body)) = &tracked.rest {
                if uses.passes_on(*symbol) && (!in_body || props_object.is_some()) {
                    params.rests.insert(*symbol, SpreadForward { component: name.clone(), omits: omits.clone() });
                }
            }
        }
    };
    let named = |id: &BindingIdentifier<'_>| id.name.starts_with(|c: char| c.is_ascii_uppercase());
    // React's wrappers, read once a declarator may call one.
    let mut react: Option<ReactNames> = None;
    for statement in &program.body {
        let declaration = match statement {
            Statement::ExportDeclaration(export) => Some(&export.declaration),
            Statement::ExportDefaultDeclaration(export) => {
                if let ExportDefaultDeclarationKind::FunctionDeclaration(function) = &export.declaration {
                    if let Some(id) = function.id.as_ref().filter(|id| named(id)) {
                        component(id, ComponentFunction::of_function(function));
                    }
                }
                continue;
            }
            statement => statement.as_declaration(),
        };
        match declaration {
            Some(Declaration::FunctionDeclaration(function)) => {
                if let Some(id) = function.id.as_ref().filter(|id| named(id)) {
                    component(id, ComponentFunction::of_function(function));
                }
            }
            Some(Declaration::VariableDeclaration(variables)) => {
                for declarator in &variables.declarations {
                    let (BindingPattern::BindingIdentifier(id), Some(init)) = (&declarator.id, &declarator.init) else { continue };
                    if !named(id) {
                        continue;
                    }
                    let react = react.get_or_insert_with(|| ReactNames::wrappers(program, scoping));
                    component(id, ComponentFunction::through(init, &|callee| react.export(callee).is_some()));
                }
            }
            _ => {}
        }
    }
    /// A tracked object: the props object, a destructured prop, or a rest
    /// of the props.
    struct Use {
        /// For a rest, the keys it never carries, and whether the body
        /// took it.
        rest: Option<(Vec<String>, bool)>,
        /// The references that read a member, spread it or destructure it.
        read: FxHashSet<oxc::semantic::ReferenceId>,
        /// The body may change it some other way.
        opaque: bool,
    }
    /// How a component body uses the objects its props give it.
    struct PropsUses<'s> {
        scoping: &'s Scoping,
        props: Option<SymbolId>,
        tracked: FxHashMap<SymbolId, Use>,
        /// Each binding a `const { … } = object` of a tracked object names:
        /// the object, the binding, its key and its default.
        destructured: Vec<(SymbolId, SymbolId, String, Option<PropDefault>)>,
    }
    /// The object a member chain starts from (`props` of `props.style.color`).
    fn root<'e, 'a>(mut expression: &'e Expression<'a>) -> &'e Expression<'a> {
        while let Some(member) = expression.get_inner_expression().as_member_expression() {
            expression = member.object();
        }
        expression.get_inner_expression()
    }
    impl PropsUses<'_> {
        fn track(&mut self, symbol: SymbolId, rest: Option<(Vec<String>, bool)>) {
            self.tracked.insert(symbol, Use { rest, read: FxHashSet::default(), opaque: false });
        }

        /// The tracked object `expression` names, with the reference.
        fn names(&self, expression: &Expression<'_>) -> Option<(SymbolId, oxc::semantic::ReferenceId)> {
            match expression.get_inner_expression() {
                Expression::Identifier(id) => {
                    let symbol = symbol_of(self.scoping, id).filter(|symbol| self.tracked.contains_key(symbol))?;
                    Some((symbol, id.reference_id.get()?))
                }
                _ => None,
            }
        }

        /// The tracked object whose member `expression` is, however deep
        /// (`props.size`, `props.style.color`, `props?.size`).
        fn member_of(&self, expression: &Expression<'_>) -> Option<SymbolId> {
            let member = match expression.get_inner_expression() {
                Expression::ChainExpression(chain) => chain.expression.as_member_expression(),
                expression => expression.as_member_expression(),
            }?;
            self.names(root(member.object())).map(|(symbol, _)| symbol)
        }

        /// Records `expression` as a read of a tracked object, where it
        /// names one: a member's object, or a spread's argument.
        fn read(&mut self, expression: &Expression<'_>) -> bool {
            let Some((symbol, reference)) = self.names(expression) else { return false };
            if let Some(tracked) = self.tracked.get_mut(&symbol) {
                tracked.read.insert(reference);
            }
            true
        }

        fn opaque(&mut self, symbol: Option<SymbolId>) {
            if let Some(tracked) = symbol.and_then(|symbol| self.tracked.get_mut(&symbol)) {
                tracked.opaque = true;
            }
        }

        /// Whether the tracked object passes its props on unchanged: every
        /// value reference reads it, and nothing changes it.
        fn passes_on(&self, symbol: SymbolId) -> bool {
            let Some(tracked) = self.tracked.get(&symbol) else { return false };
            !tracked.opaque
                && self.scoping.get_resolved_reference_ids(symbol).iter().all(|reference| {
                    tracked.read.contains(reference) || !self.scoping.get_reference(*reference).is_value()
                })
        }
    }
    impl<'a> Visit<'a> for PropsUses<'_> {
        fn visit_static_member_expression(&mut self, member: &oxc::ast::ast::StaticMemberExpression<'a>) {
            if !self.read(&member.object) {
                oxc::ast_visit::walk::walk_static_member_expression(self, member);
            }
        }
        fn visit_spread_element(&mut self, spread: &oxc::ast::ast::SpreadElement<'a>) {
            if !self.read(&spread.argument) {
                oxc::ast_visit::walk::walk_spread_element(self, spread);
            }
        }
        fn visit_jsx_spread_attribute(&mut self, spread: &oxc::ast::ast::JSXSpreadAttribute<'a>) {
            if !self.read(&spread.argument) {
                oxc::ast_visit::walk::walk_jsx_spread_attribute(self, spread);
            }
        }
        // `const { a, b = 'x', ...rest } = props` reads it: the bindings
        // pass its props on, and a rest is tracked as one.
        fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
            use oxc::ast::ast::BindingPattern;
            if let (BindingPattern::ObjectPattern(object), Some(init)) = (&declarator.id, &declarator.init) {
                if let Some((symbol, _)) = self.names(init) {
                    self.read(init);
                    // A binding an empty object defaults may hold `{}`
                    // where the object leaves it out.
                    let (named, keys, empty) = pattern_props(self.scoping, object);
                    for (bound, key, default) in named {
                        if !empty.contains(&bound) {
                            self.destructured.push((symbol, bound, key, default));
                        }
                    }
                    if self.props == Some(symbol) {
                        if let Some(BindingPattern::BindingIdentifier(rest)) = object.rest.as_ref().map(|rest| &rest.argument) {
                            if let Some(rest) = unwritten(self.scoping, rest) {
                                self.track(rest, Some((keys, true)));
                            }
                        }
                    }
                    for property in &object.properties {
                        if let BindingPattern::AssignmentPattern(assignment) = &property.value {
                            self.visit_expression(&assignment.right);
                        }
                    }
                    return;
                }
            }
            oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
        }
        // A write to a member, a member called with the object as `this`,
        // and a deleted member may change it.
        fn visit_simple_assignment_target(&mut self, target: &oxc::ast::ast::SimpleAssignmentTarget<'a>) {
            if let Some(member) = target.as_member_expression() {
                let symbol = self.names(root(member.object())).map(|(symbol, _)| symbol);
                self.opaque(symbol);
            }
            oxc::ast_visit::walk::walk_simple_assignment_target(self, target);
        }
        fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
            let symbol = self.member_of(&call.callee);
            self.opaque(symbol);
            oxc::ast_visit::walk::walk_call_expression(self, call);
        }
        fn visit_tagged_template_expression(&mut self, tagged: &oxc::ast::ast::TaggedTemplateExpression<'a>) {
            let symbol = self.member_of(&tagged.tag);
            self.opaque(symbol);
            oxc::ast_visit::walk::walk_tagged_template_expression(self, tagged);
        }
        fn visit_unary_expression(&mut self, unary: &oxc::ast::ast::UnaryExpression<'a>) {
            if unary.operator == oxc::syntax::operator::UnaryOperator::Delete {
                let symbol = self.member_of(&unary.argument);
                self.opaque(symbol);
            }
            oxc::ast_visit::walk::walk_unary_expression(self, unary);
        }
    }
    params
}

/// Each state slot of a React state hook nothing writes: the first binding
/// of `const [state, set] = useState(…)` (or `useReducer`), where the hook is
/// React's own import.
fn state_slots(program: &Program<'_>, scoping: &Scoping) -> FxHashMap<SymbolId, RuntimeState> {
    use oxc::ast::ast::BindingPattern;
    if !HOOK_FUNCTIONS.iter().any(|hook| program.source_text.contains(hook)) {
        return FxHashMap::default();
    }
    let hooks = ReactNames::hooks(program, scoping);
    if hooks.is_empty() {
        return FxHashMap::default();
    }
    struct Scan<'s> {
        scoping: &'s Scoping,
        hooks: ReactNames,
        states: FxHashMap<SymbolId, RuntimeState>,
    }
    impl<'a> Visit<'a> for Scan<'_> {
        fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
            if let (BindingPattern::ArrayPattern(array), Some(Expression::CallExpression(call))) =
                (&declarator.id, declarator.init.as_ref().map(|init| init.get_inner_expression()))
            {
                if let (Some(hook), Some(Some(BindingPattern::BindingIdentifier(id)))) = (self.hooks.export(&call.callee), array.elements.first()) {
                    if let Some(symbol) = unwritten(self.scoping, id) {
                        self.states.insert(symbol, RuntimeState { hook: hook.to_string(), at: call.span.start });
                    }
                }
            }
            oxc::ast_visit::walk::walk_variable_declarator(self, declarator);
        }
    }
    let mut scan = Scan { scoping, hooks, states: FxHashMap::default() };
    scan.visit_program(program);
    scan.states
}

/// An attribute replaces what every earlier one of its name wrote, the
/// branches of a listed spread included, as the last of duplicate JSX
/// attributes wins at run time (JSX accepts them; TypeScript alone rejects
/// them), whether or not it is then recorded: one that writes nothing is
/// the prop left out.
fn replace_earlier(attrs: &mut Vec<AttrFact>, spread: &mut Option<usize>, unset: &mut Vec<String>, name: &str) {
    if let Some(before) = spread {
        *before -= attrs[..*before].iter().filter(|attr| attr.name == name).count();
    }
    attrs.retain(|attr| attr.name != name);
    unset.retain(|unset| unset != name);
}

/// Whether `program` has a `with` statement anywhere (sloppy scripts only).
fn contains_with(program: &Program<'_>) -> bool {
    struct Find(bool);
    impl<'a> Visit<'a> for Find {
        fn visit_with_statement(&mut self, _statement: &oxc::ast::ast::WithStatement<'a>) {
            self.0 = true;
        }
    }
    if !program.source_text.contains("with") {
        return false;
    }
    let mut find = Find(false);
    find.visit_program(program);
    find.0
}

/// The symbol `id` binds, where nothing writes it after.
fn unwritten(scoping: &Scoping, id: &oxc::ast::ast::BindingIdentifier<'_>) -> Option<SymbolId> {
    id.symbol_id.get().filter(|symbol| !crate::identity::reassigned(scoping, *symbol))
}

/// A binding a props pattern names, its key and its default.
type PropBinding = (SymbolId, String, Option<PropDefault>);

/// A destructured prop's default: a literal the walk reads, or another
/// value (`color = FALLBACK`, an import), which a caller leaving the prop
/// out passes on unread.
#[derive(Debug, Clone)]
enum PropDefault {
    Literal(Value),
    Unread,
}

/// The bindings an object pattern names, with their keys and defaults; the
/// keys it names (what a rest of it never carries); and the bindings an
/// empty object defaults. A property that destructures further may pass
/// any value and is left out of the bindings.
fn pattern_props(scoping: &Scoping, object: &oxc::ast::ast::ObjectPattern<'_>) -> (Vec<PropBinding>, Vec<String>, Vec<SymbolId>) {
    use oxc::ast::ast::BindingPattern;
    let mut named = Vec::new();
    let mut keys = Vec::new();
    let mut empty = Vec::new();
    for property in &object.properties {
        let key = (!property.computed).then(|| eval_property_key(&property.key)).flatten();
        let Some(key) = key else { continue };
        keys.push(key.clone());
        let (id, default) = match &property.value {
            BindingPattern::BindingIdentifier(id) => (id, None),
            BindingPattern::AssignmentPattern(assignment) => match (&assignment.left, default_value(&assignment.right)) {
                (BindingPattern::BindingIdentifier(id), Some(value)) => (id, Some(PropDefault::Literal(value))),
                (BindingPattern::BindingIdentifier(id), None)
                    if matches!(assignment.right.get_inner_expression(), Expression::ObjectExpression(object) if object.properties.is_empty()) =>
                {
                    empty.extend(unwritten(scoping, id));
                    (id, None)
                }
                (BindingPattern::BindingIdentifier(id), None) => (id, Some(PropDefault::Unread)),
                _ => continue,
            },
            _ => continue,
        };
        named.extend(unwritten(scoping, id).map(|symbol| (symbol, key, default)));
    }
    (named, keys, empty)
}

/// Each parameter binding whose type annotation reads, without a type
/// checker, as a union of string and number literal types: a parameter's
/// own annotation, or a destructured property's, written inline or through
/// a type alias or interface the module declares. Its default joins the
/// values; an optional one may be absent. A binding something writes is
/// left out. An annotation proves nothing of a value, so these unions only
/// say what would close a slot were annotations trusted (`DeclaredHint`).
fn literal_union_parameters(program: &Program<'_>, scoping: &Scoping) -> FxHashMap<SymbolId, DeclaredUnion> {
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
    objects: FxHashMap<SymbolId, FxHashMap<String, Option<DeclaredSet>>>,
    /// The module's type aliases of a literal union.
    unions: FxHashMap<SymbolId, DeclaredSet>,
    sets: FxHashMap<SymbolId, DeclaredUnion>,
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
    fn literal_union(&self, annotation: &oxc::ast::ast::TSType<'_>) -> Option<DeclaredSet> {
        use oxc::ast::ast::{TSLiteral, TSType};
        let members: Vec<&TSType<'_>> = match annotation {
            TSType::TSUnionType(union) => union.types.iter().collect(),
            other => vec![other],
        };
        let mut set = DeclaredSet::default();
        for member in members {
            match member {
                TSType::TSUndefinedKeyword(_) => set.undefined = true,
                TSType::TSNullKeyword(_) => set.null = true,
                TSType::TSLiteralType(literal) => {
                    let value = match &literal.literal {
                        TSLiteral::StringLiteral(text) => Value::String(crate::eval::literal_string(text)?.to_string()),
                        TSLiteral::NumericLiteral(number) => make_json_number(number.value)?,
                        TSLiteral::UnaryExpression(unary)
                            if unary.operator == oxc::syntax::operator::UnaryOperator::UnaryNegation =>
                        {
                            let Expression::NumericLiteral(number) = &unary.argument else { return None };
                            make_json_number(-number.value)?
                        }
                        _ => return None,
                    };
                    push_unique(&mut set.values, value);
                }
                other => set = set.union(self.unions.get(&self.named(other)?)?.clone()),
            }
        }
        (!set.values.is_empty() || set.null || set.undefined).then_some(set)
    }

    /// Each property signature's literal union, `None` when it has another type.
    fn property_unions(&self, members: &[oxc::ast::ast::TSSignature<'_>]) -> FxHashMap<String, Option<DeclaredSet>> {
        use oxc::ast::ast::TSSignature;
        members
            .iter()
            .filter_map(|member| match member {
                TSSignature::TSPropertySignature(signature) if !signature.computed => {
                    let set = signature.type_annotation.as_ref().and_then(|annotation| {
                        let mut set = self.literal_union(&annotation.type_annotation)?;
                        set.undefined |= signature.optional;
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
        set: Option<DeclaredSet>,
        default: Option<&Expression<'_>>,
        at: u32,
    ) {
        let (Some(mut set), Some(symbol)) = (set, id.symbol_id.get()) else {
            return;
        };
        if crate::identity::reassigned(self.scoping, symbol) {
            return;
        }
        if let Some(default) = default {
            let Some(value) = literal_value(default) else {
                return;
            };
            push_unique(&mut set.values, value);
        }
        self.sets.insert(symbol, DeclaredUnion { set, at });
    }
}

impl<'a> Visit<'a> for ParameterScan<'_> {
    fn visit_formal_parameter(&mut self, parameter: &oxc::ast::ast::FormalParameter<'a>) {
        use oxc::ast::ast::{BindingPattern, TSType};
        if let Some(annotation) = parameter.type_annotation.as_ref() {
            match &parameter.pattern {
                BindingPattern::BindingIdentifier(id) => {
                    let set = self.literal_union(&annotation.type_annotation).map(|mut set| {
                        set.undefined |= parameter.optional;
                        set
                    });
                    self.record(id, set, parameter.initializer.as_deref(), annotation.span.start);
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
                            BindingPattern::BindingIdentifier(id) => self.record(id, set, None, annotation.span.start),
                            BindingPattern::AssignmentPattern(assignment) => {
                                if let BindingPattern::BindingIdentifier(id) = &assignment.left {
                                    self.record(id, set, Some(&assignment.right), annotation.span.start);
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
        if static_string(&member.expression) == Some("defaultProps") {
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
        if let (true, oxc::ast::ast::VariableDeclarationKind::Const, oxc::ast::ast::BindingPattern::BindingIdentifier(id), Some(init)) =
            (self.enrich && self.locals, self.declaring, &declarator.id, &declarator.init)
        {
            if let Some(symbol) = id.symbol_id.get() {
                if let Some(set) = self.finite_set(init) {
                    self.local_consts.insert(symbol, set);
                }
                match self.value_origin(init) {
                    ValueOrigin::Unknown | ValueOrigin::RuntimeState(_) => {}
                    origin => {
                        self.local_origins.insert(symbol, origin);
                    }
                }
            }
        }
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
        // A call lowering left as written: its props are the second argument
        // for either runtime.
        if self.react.element_call(&call.callee).is_some() {
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
fn clone_of(tag: TagFact, props: Option<Vec<(String, VariantValue)>>, at: u32) -> Option<UsageFact> {
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
    props: Option<Vec<(String, VariantValue)>>,
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
                .map(|property| crate::eval::property_name(&property.key).filter(|_| !property.computed).map(|key| key.to_string()))
                .collect();
            match keys {
                Some(keys) if !crate::identity::reassigned(self.scoping, symbol) => {
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
            let Some(key) = crate::eval::property_name(&property.key).filter(|_| !property.computed) else { continue };
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
            if let Some(symbol) = binding.symbol_id.get().filter(|symbol| !crate::identity::reassigned(scoping, *symbol)) {
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
            if self.react.element_call(&call.callee).is_some() {
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
        Self::from(program, scoping, &REACT_RUNTIMES)
    }

    /// The imports of `modules`, React's own.
    fn from(program: &Program<'_>, scoping: &Scoping, modules: &[&str]) -> Self {
        let mut imports = Self { functions: FxHashMap::default(), namespaces: FxHashSet::default() };
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else { continue };
            if !import.source.value.as_str().is_some_and(|specifier| modules.contains(&specifier)) {
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
        if imports.namespaces.is_empty() {
            return imports;
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
        if imports.namespaces.is_empty() {
            return imports;
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
        self.names(scoping, callee, functions, false)
    }

    /// Whether `expression` names one of React's `names`, imported or as a
    /// member of a React namespace, or with `unbound`, of an unbound `React`.
    fn names(&self, scoping: &Scoping, expression: &Expression<'_>, names: &[&str], unbound: bool) -> bool {
        match crate::chain_walk::unwrap_type_assertions(expression) {
            Expression::Identifier(id) => symbol_of(scoping, id)
                .and_then(|symbol| self.functions.get(&symbol))
                .is_some_and(|function| names.contains(&function.as_str())),
            Expression::StaticMemberExpression(member) => {
                names.contains(&member.property.name.as_str())
                    && matches!(&member.object, Expression::Identifier(object) if match symbol_of(scoping, object) {
                        Some(symbol) => self.namespaces.contains(&symbol),
                        None => unbound && object.name == "React",
                    })
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
/// class expression, of React's `forwardRef` or `memo` of one, or of the
/// name of one (an alias, which the module neither writes through nor
/// hands on), that nothing in the file writes: what a tag naming an
/// ordinary component is proved by. An ordinary default export is also `default`. React renders
/// a wrapper's `render` (`forwardRef`) or `type` (`memo`), which holds its
/// callback only while nothing changes the wrapper. Each React wrapper
/// among them maps to the name of the callback it renders, if it is named.
/// Such an alias of an import is no component of the module: it maps to
/// the import (`FileFacts::import_aliases`).
#[derive(Default)]
struct OrdinaryComponents {
    /// See `FileFacts::ordinary_components`.
    names: BTreeSet<String>,
    /// See `FileFacts::react_wrappers`.
    react_wrappers: BTreeMap<String, Option<String>>,
    /// See `FileFacts::import_aliases`.
    import_aliases: BTreeMap<String, String>,
}

/// See `OrdinaryComponents`.
fn ordinary_components(
    program: &Program<'_>,
    scoping: &Scoping,
    react: &ReactImports,
    escapes: &BTreeSet<String>,
    direct_eval: bool,
) -> OrdinaryComponents {
    use oxc::ast::ast::{BindingIdentifier, Declaration, ExportDefaultDeclarationKind};
    // Direct eval can write any binding by name.
    if direct_eval {
        return Default::default();
    }
    // The callback React's `forwardRef` or `memo` wraps, through nested
    // wrappers.
    fn wrapped<'b, 'a>(scoping: &Scoping, react: &ReactImports, expr: &'b Expression<'a>) -> Option<&'b Expression<'a>> {
        let Expression::CallExpression(call) = crate::chain_walk::unwrap_type_assertions(expr) else { return None };
        if call.arguments.len() != 1 || !react.calls(scoping, &call.callee, &["forwardRef", "memo"]) {
            return None;
        }
        let callback = crate::chain_walk::unwrap_type_assertions(call.arguments[0].as_expression()?);
        wrapped(scoping, react, callback).or(Some(callback))
    }
    // React's wrappers, with the name of a named callback, and the aliases
    // of an import, with the import.
    let mut wrappers: Vec<(&BindingIdentifier<'_>, Option<&str>)> = Vec::new();
    let mut aliases: BTreeMap<String, String> = BTreeMap::new();
    let unwritten = |id: &BindingIdentifier<'_>| {
        id.symbol_id.get().is_some_and(|symbol| !crate::identity::reassigned(scoping, symbol))
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
                    .filter_map(|declarator| {
                        let (oxc::ast::ast::BindingPattern::BindingIdentifier(id), Some(init)) =
                            (&declarator.id, &declarator.init)
                        else {
                            return None;
                        };
                        let inline = |expr: &Expression<'_>| {
                            matches!(
                                expr,
                                Expression::ArrowFunctionExpression(_)
                                    | Expression::FunctionExpression(_)
                                    | Expression::ClassExpression(_)
                            )
                        };
                        match wrapped(scoping, react, init) {
                            // A `const` alias renders what it names, while the
                            // module neither writes through it nor hands it on.
                            None => match init.get_inner_expression() {
                                Expression::Identifier(target) => {
                                    let name = id.name.as_str();
                                    let escapes = escapes.iter().any(|escaped| {
                                        escaped.strip_prefix(name).is_some_and(|rest| rest.is_empty() || rest.starts_with('.'))
                                    });
                                    let imported = || {
                                        target.reference_id.get().and_then(|reference| scoping.get_reference(reference).symbol_id())
                                            .is_some_and(|symbol| scoping.symbol_flags(symbol).contains(oxc::semantic::SymbolFlags::Import))
                                    };
                                    if !escapes && !imported() {
                                        wrappers.push((&**id, Some(target.name.as_str())));
                                    } else if !escapes && unwritten(id) {
                                        aliases.insert(name.to_string(), target.name.to_string());
                                    }
                                    None
                                }
                                init => inline(init).then_some(&**id),
                            },
                            Some(callback) if inline(callback) => {
                                wrappers.push((&**id, None));
                                None
                            }
                            Some(Expression::Identifier(callback)) => {
                                wrappers.push((&**id, Some(callback.name.as_str())));
                                None
                            }
                            Some(_) => None,
                        }
                    })
                    .collect()
            }
            _ => Vec::new(),
        };
        names.extend(ids.into_iter().filter(|id| unwritten(id)).map(|id| id.name.to_string()));
    }
    // A wrapper of a named callback is one once its callback is, which
    // may itself be a wrapper declared later.
    wrappers.retain(|(id, _)| unwritten(id));
    let mut renders = BTreeMap::new();
    while let Some(at) = wrappers.iter().position(|(_, callback)| callback.is_none_or(|callback| names.contains(callback))) {
        let (id, callback) = wrappers.swap_remove(at);
        names.insert(id.name.to_string());
        renders.insert(id.name.to_string(), callback.map(str::to_string));
    }
    OrdinaryComponents { names, react_wrappers: renders, import_aliases: aliases }
}

/// React's `createElement` and `cloneElement` as a file can call them:
/// through an import from a recognised runtime, or as the unbound globals
/// `createElement`, `cloneElement` and `React`. Any other binding of such a
/// name is the file's own function, an ordinary call, so the escape scan
/// sees a component passed to it as a value. The automatic runtime's
/// element functions (`jsx`, `jsxs`, `jsxDEV`) and its `Fragment`, which
/// compiled JSX names, count only through an import of the runtime that
/// exports them.
#[derive(Clone)]
pub(crate) struct ReactNames {
    /// Local name → the runtime export it binds.
    functions: FxHashMap<String, &'static str>,
    /// Default and namespace imports of a runtime, and an unbound `React`,
    /// → the exports read through them.
    namespaces: FxHashMap<String, &'static [&'static str]>,
}

const REACT_RUNTIMES: [&str; 3] = ["react", "preact", "preact/compat"];
const ELEMENT_FUNCTIONS: [&str; 2] = ["createElement", "cloneElement"];
const WRAPPER_FUNCTIONS: [&str; 2] = ["memo", "forwardRef"];
/// Each automatic runtime and the exports compiled JSX names.
pub(crate) const AUTOMATIC_RUNTIMES: [(&str, &[&str]); 2] = [
    ("react/jsx-runtime", &["jsx", "jsxs", "Fragment"]),
    ("react/jsx-dev-runtime", &["jsxDEV", "Fragment"]),
];

/// The namespaces among `namespaces` the module may rewrite, so that a
/// member no longer holds React's function: any whose name is used other
/// than to read a member (`React.createElement = …`, `delete React.x`,
/// `Object.assign(React, …)`, `const R = React`). A type names no value.
/// Each name binds once, or not at all, so the name tells its uses.
fn rewritable_namespaces(
    program: &Program<'_>,
    namespaces: &FxHashMap<String, &'static [&'static str]>,
) -> FxHashSet<String> {
    struct Uses<'n> {
        names: FxHashSet<&'n str>,
        rewritable: FxHashSet<String>,
    }
    impl Uses<'_> {
        fn tracked(&self, expression: &Expression<'_>) -> bool {
            matches!(expression, Expression::Identifier(id) if self.names.contains(id.name.as_str()))
        }
    }
    impl<'a> Visit<'a> for Uses<'_> {
        fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
            if self.names.contains(id.name.as_str()) {
                self.rewritable.insert(id.name.to_string());
            }
        }
        // A member read leaves its object out of the uses.
        fn visit_static_member_expression(&mut self, member: &oxc::ast::ast::StaticMemberExpression<'a>) {
            if !self.tracked(&member.object) {
                oxc::ast_visit::walk::walk_static_member_expression(self, member);
            }
        }
        fn visit_jsx_member_expression(&mut self, member: &oxc::ast::ast::JSXMemberExpression<'a>) {
            if !matches!(&member.object, oxc::ast::ast::JSXMemberExpressionObject::IdentifierReference(id)
                if self.names.contains(id.name.as_str()))
            {
                oxc::ast_visit::walk::walk_jsx_member_expression(self, member);
            }
        }
        fn visit_simple_assignment_target(&mut self, target: &oxc::ast::ast::SimpleAssignmentTarget<'a>) {
            if let Some(Expression::Identifier(id)) = target.as_member_expression().map(|member| member.object()) {
                self.visit_identifier_reference(id);
            }
            oxc::ast_visit::walk::walk_simple_assignment_target(self, target);
        }
        fn visit_unary_expression(&mut self, unary: &oxc::ast::ast::UnaryExpression<'a>) {
            if unary.operator == oxc::syntax::operator::UnaryOperator::Delete {
                if let Some(Expression::Identifier(id)) = unary.argument.as_member_expression().map(|member| member.object()) {
                    self.visit_identifier_reference(id);
                }
            }
            oxc::ast_visit::walk::walk_unary_expression(self, unary);
        }
        fn visit_ts_type(&mut self, _type: &oxc::ast::ast::TSType<'a>) {}
    }
    // A name the source never spells has no use to read.
    let names: FxHashSet<&str> =
        namespaces.keys().map(String::as_str).filter(|name| program.source_text.contains(name)).collect();
    if names.is_empty() {
        return FxHashSet::default();
    }
    let mut uses = Uses { names, rewritable: FxHashSet::default() };
    uses.visit_program(program);
    uses.rewritable
}

/// Which React element function a call makes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ElementCall {
    /// `createElement(type, props, ...children)`.
    Classic,
    /// The automatic runtime's `jsx(type, props, key)`, whose children are
    /// `props.children`; `jsxs` passes them as an array, one per entry; and
    /// `jsxDEV` adds metadata after the key.
    Jsx,
    Jsxs,
    JsxDev,
}

impl ReactNames {
    /// By spelling alone, for facts read without bindings.
    fn by_name() -> Self {
        Self {
            functions: ELEMENT_FUNCTIONS.iter().map(|name| (name.to_string(), *name)).collect(),
            namespaces: std::iter::once(("React".to_string(), &ELEMENT_FUNCTIONS[..])).collect(),
        }
    }

    /// Whether no import names a function this reads.
    fn is_empty(&self) -> bool {
        self.functions.is_empty() && self.namespaces.is_empty()
    }

    pub(crate) fn from_imports(program: &Program<'_>, scoping: &Scoping) -> Self {
        Self::importing(program, scoping, &ELEMENT_FUNCTIONS, &AUTOMATIC_RUNTIMES, true)
    }

    /// React's state hooks, read as `wrappers` reads its wrappers.
    fn hooks(program: &Program<'_>, scoping: &Scoping) -> Self {
        Self::importing(program, scoping, &HOOK_FUNCTIONS, &[], false)
    }

    /// React's `memo` and `forwardRef`, read as `from_imports` reads the
    /// element functions, but only through an import of a runtime: an
    /// unbound `memo`, `forwardRef` or `React` is whatever the page's
    /// globals hold.
    fn wrappers(program: &Program<'_>, scoping: &Scoping) -> Self {
        Self::importing(program, scoping, &WRAPPER_FUNCTIONS, &[], false)
    }

    /// The `classic` exports of a recognised runtime and each `automatic`
    /// runtime's own, as imported, and with `unbound`, the globals that name
    /// the `classic` ones and an unbound `React`.
    fn importing(
        program: &Program<'_>,
        scoping: &Scoping,
        classic: &'static [&'static str],
        automatic: &[(&str, &'static [&'static str])],
        unbound: bool,
    ) -> Self {
        let mut names = Self { functions: FxHashMap::default(), namespaces: FxHashMap::default() };
        for stmt in &program.body {
            let Statement::ImportDeclaration(import) = stmt else {
                continue;
            };
            let Some(source) = import.source.value.as_str() else { continue };
            let automatic = automatic.iter().find(|(runtime, _)| *runtime == source).map(|(_, f)| *f);
            let exported: &'static [&'static str] = match automatic {
                Some(exports) => exports,
                None if REACT_RUNTIMES.contains(&source) => classic,
                None => continue,
            };
            for specifier in import.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(named) => {
                        let imported = named.imported.name();
                        if let Some(export) = exported.iter().find(|export| **export == imported.as_str()) {
                            names.functions.insert(named.local.name.to_string(), export);
                        }
                    }
                    // The automatic runtimes export no default.
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                        if automatic.is_none() {
                            names.namespaces.insert(default.local.name.to_string(), exported);
                        }
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                        names.namespaces.insert(namespace.local.name.to_string(), exported);
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
        names.namespaces.retain(|local, _| bound.get(local.as_str()) == Some(&1));
        for function in classic.iter().filter(|_| unbound) {
            if !bound.contains_key(function) {
                names.functions.insert(function.to_string(), function);
            }
        }
        if unbound && !bound.contains_key("React") {
            names.namespaces.insert("React".to_string(), classic);
        }
        let untrusted = rewritable_namespaces(program, &names.namespaces);
        names.namespaces.retain(|local, _| !untrusted.contains(local));
        names
    }

    /// The runtime export `value` names, looking through the `(0, f)` a
    /// compiler writes to call `f` without a receiver.
    fn export(&self, value: &Expression<'_>) -> Option<&'static str> {
        let value = match value.get_inner_expression() {
            Expression::SequenceExpression(sequence) => match sequence.expressions.split_last() {
                Some((last, leading)) if leading.iter().all(Expression::is_literal) => last.get_inner_expression(),
                _ => return None,
            },
            value => value,
        };
        match value {
            Expression::Identifier(id) => self.functions.get(id.name.as_str()).copied(),
            Expression::StaticMemberExpression(member) => {
                let Expression::Identifier(object) = &member.object else { return None };
                let exported = self.namespaces.get(object.name.as_str())?;
                exported.iter().find(|export| **export == member.property.name.as_str()).copied()
            }
            _ => None,
        }
    }

    /// Whether `callee` calls the runtime's `function`.
    pub(crate) fn calls(&self, callee: &Expression<'_>, function: &str) -> bool {
        self.export(callee) == Some(function)
    }

    /// The element `callee` creates, if it calls a runtime's element function.
    pub(crate) fn element_call(&self, callee: &Expression<'_>) -> Option<ElementCall> {
        match self.export(callee)? {
            "createElement" => Some(ElementCall::Classic),
            "jsx" => Some(ElementCall::Jsx),
            "jsxs" => Some(ElementCall::Jsxs),
            "jsxDEV" => Some(ElementCall::JsxDev),
            _ => None,
        }
    }

    /// Whether `component` is an automatic runtime's `Fragment`, which `<>`
    /// compiles to.
    pub(crate) fn is_compiled_fragment(&self, component: &Argument<'_>) -> bool {
        component.as_expression().is_some_and(|component| self.export(component) == Some("Fragment"))
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
        declared_params: FxHashMap::default(),
        declared_hints: Vec::new(),
        params: ComponentParams::default(),
        provided: FxHashSet::default(),
        rests: FxHashMap::default(),
        declaring: oxc::ast::ast::VariableDeclarationKind::Var,
        local_consts: FxHashMap::default(),
        local_origins: FxHashMap::default(),
        locals: false,
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
    let direct_eval = string_code(program, &built).direct_eval;
    let identity_records = if direct_eval { FxHashSet::default() } else { identity_records(program, &built, module) };
    collect_enriched_usage(built, program, module, &identity_records, static_values, module_path, &[], &[], &[], &BTreeMap::new(), &BTreeSet::new(), direct_eval)
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
                let Some(breakpoint) = crate::eval::property_name(&property.key).filter(|_| !property.computed) else {
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
    /// Forwarding element span → keys its spread may lack, which a `delete`
    /// takes: a variant of that name it does not write keeps its default.
    pub deleted: FxHashMap<(u32, u32), BTreeSet<String>>,
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
    pub passed: FxHashMap<(u32, u32), FxHashMap<String, Vec<VariantValue>>>,
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
/// `facts`: what each render writes, `Dynamic` where a spread at the render
/// can deliver it, and `default` (or the target's own, `Default`) where a
/// render leaves it out.
pub(crate) fn passed_values(
    facts: &[UsageFact],
    wrapper: &str,
    key: &str,
    default: Option<&str>,
) -> Vec<VariantValue> {
    let absent = default.map_or(VariantValue::Default, |default| VariantValue::Literal(default.to_string()));
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
            values.insert(&attr.variant_class);
            settled |= attr.settles(index, *spread);
        }
        if !settled {
            values.insert(match spread {
                Some(_) => &VariantValue::Dynamic,
                None => &absent,
            });
        }
    }
    values.into_iter().cloned().collect()
}

/// Custom-prop scan over collected facts.
pub fn filter_custom_prop_scan(
    facts: &[UsageFact],
    component_props: &impl Keyed<FxHashSet<String>>,
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
                            at: Some(attr.at),
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
/// spread, a `createElement` call or a clone's overrides — as one dynamic
/// usage per custom prop, with the render's kind (`spread`,
/// `create-element`, `clone`).
pub fn uncertain_custom_renders(
    facts: &[UsageFact],
    component_props: &impl Keyed<FxHashSet<String>>,
    member_expr_bindings: &FxHashMap<String, String>,
    proxies: &WrapperProxies,
) -> Vec<(DynamicPropUsage, &'static str)> {
    let mut seen = FxHashSet::default();
    let mut usages = Vec::new();
    for fact in facts {
        if let UsageFact::CloneUnknown { props: Some(props), .. } = fact {
            // Each listed override reaches every component with that prop.
            for (binding, custom) in component_props.sorted_entries() {
                for (prop, _) in props.iter().filter(|(prop, _)| custom.contains(prop)) {
                    if seen.insert((binding.as_str(), prop)) {
                        usages.push((DynamicPropUsage { prop_name: prop.clone(), binding: binding.clone(), at: None }, "clone"));
                    }
                }
            }
            continue;
        }
        let (binding, kind) = match fact {
            UsageFact::Element { span, .. } if proxies.forwarding.contains(span) => continue,
            UsageFact::Element { tag, spread: Some(_), origin, written_as_call, .. } => match resolve_tag(tag, *origin, member_expr_bindings) {
                Some((binding, _)) => (binding, if *written_as_call { "create-element" } else { "spread" }),
                None => continue,
            },
            UsageFact::CreateElement { member, origin, .. } if bound_elsewhere(member.is_some(), *origin) => continue,
            UsageFact::CreateElement { ident: Some(name), .. } => (name.as_str(), "create-element"),
            UsageFact::CreateElement { member: Some(key), .. } => match member_expr_bindings.get(key) {
                Some(binding) => (binding.as_str(), "create-element"),
                None => continue,
            },
            _ => continue,
        };
        for prop in component_props.get(binding).into_iter().flatten() {
            if seen.insert((binding, prop)) {
                usages.push((DynamicPropUsage { prop_name: prop.clone(), binding: binding.to_string(), at: None }, kind));
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
    let absent = if open_props { VariantValue::Dynamic } else { VariantValue::Default };
    for variant_prop in config.variants.keys() {
        if !written.contains(variant_prop.as_str()) {
            result.variant_usages.push(VariantUsage {
                component_binding: binding.to_string(),
                variant_prop: variant_prop.clone(),
                value: absent.clone(),
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

/// A map read by key: a plain map, or a file's view of the project's usage
/// lookup with the file's own entries over it (`Layered`, analyze_css).
pub trait Keyed<V> {
    fn get(&self, key: &str) -> Option<&V>;
    fn contains_key(&self, key: &str) -> bool {
        self.get(key).is_some()
    }
    /// Every entry, sorted by key.
    fn sorted_entries(&self) -> Vec<(&String, &V)>;
}

impl<V> Keyed<V> for FxHashMap<String, V> {
    fn get(&self, key: &str) -> Option<&V> {
        FxHashMap::get(self, key)
    }
    fn sorted_entries(&self) -> Vec<(&String, &V)> {
        let mut entries: Vec<(&String, &V)> = self.iter().collect();
        entries.sort_unstable_by(|a, b| a.0.cmp(b.0));
        entries
    }
}

/// Variant/state/system-prop usage scan over collected facts.
pub fn filter_usage_scan(
    facts: &[UsageFact],
    component_props: &impl Keyed<FxHashSet<String>>,
    custom_props: &impl Keyed<FxHashSet<String>>,
    component_configs: &impl Keyed<ComponentUsageConfig>,
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
                result.open_components.entry(binding.clone()).or_insert(OpenSite { kind: "default-props", file: None, at: *at });
                record_unwritten_options(&mut result, &mut fully_open, &binding, config, &FxHashSet::default(), true);
            }
            UsageFact::Element { tag, attrs, spread, span, origin, written_as_call, unset, .. } => {
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
                        // An element written as a call opens as the call does.
                        let kind = if *written_as_call { "create-element" } else { "spread" };
                        result.open_components.entry(binding.clone()).or_insert(OpenSite { kind, file: None, at: span.0 });
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
                            file: None,
                            at: attr.at,
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
                                            at: Some(attr.at),
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
                                // A runtime value proven one of a few literals
                                // selects each option a literal of them would.
                                let proven: Option<Vec<VariantValue>> = match (&attr.variant_class, attr.proven_values()) {
                                    (VariantValue::Dynamic, Some(values)) => Some(values.map(value_variant).collect()),
                                    _ => None,
                                };
                                let values = match (passed, &proven) {
                                    (Some(values), _) => values.as_slice(),
                                    (None, Some(values)) => values.as_slice(),
                                    (None, None) => std::slice::from_ref(&attr.variant_class),
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
                    // A prop the wrapper deletes from its rest, or one the
                    // element writes after its spread as nothing or a value
                    // that may be nullish, replaces what the callers pass:
                    // the render may leave it out whatever they write.
                    let after_spread = spread.map_or(&attrs[..0], |before| &attrs[before..]);
                    let left_out: BTreeSet<&str> = proxies
                        .deleted
                        .get(span)
                        .into_iter()
                        .flatten()
                        .map(String::as_str)
                        .chain(unset.iter().map(String::as_str))
                        .chain(after_spread.iter().filter(|attr| attr.absent).map(|attr| attr.name.as_str()))
                        .collect();
                    if let Some(config) = component_configs.get(tag_name) {
                        for key in left_out.iter().filter(|key| config.variants.contains_key(**key) && !written.contains(**key)) {
                            result.variant_usages.push(VariantUsage {
                                component_binding: binding.to_string(),
                                variant_prop: key.to_string(),
                                value: VariantValue::Default,
                            });
                        }
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
                                    file: None,
                                    at: *at,
                                });
                                let system = active.is_some_and(|active| active.contains(prop));
                                if literal.is_none() && system && seen.insert(format!("__dynamic__:{prop}")) {
                                    result.dynamic_prop_usages.push(DynamicPropUsage {
                                        prop_name: prop.clone(),
                                        binding: binding.clone(),
                                        at: None,
                                    });
                                }
                            }
                            if let Some(excluded) = &writes.rest_excludes {
                                result.open_except.push((binding.clone(), excluded.clone()));
                            }
                        }
                        None => {
                            result.open_components.entry(binding.clone()).or_insert(OpenSite { kind: "create-element", file: None, at: *at });
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
                for (binding, config) in component_configs.sorted_entries() {
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
            if let Some(key) = static_string(&member.expression).filter(|key| BUILDER_METHODS.contains(key)) {
                self.0.push((member.expression.span(), key.to_string()));
            }
            oxc::ast_visit::walk::walk_computed_member_expression(self, member);
        }
        // MDX has no use for the system package: any import of it, named,
        // default or namespace, reaches the builder's style declarations.
        fn visit_import_declaration(&mut self, import: &oxc::ast::ast::ImportDeclaration<'a>) {
            let Some(source) = import.source.value.as_str() else { return };
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
            if let Some(name) = crate::eval::property_name(key).filter(|name| BUILDER_METHODS.contains(&name.as_ref())) {
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
                let unbound = ident.reference_id.get().is_some_and(|id| binding_of(self.scoping, id).is_none());
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

    fn option_usages(source: &str) -> (Vec<(String, VariantValue)>, Vec<String>) {
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
        let pair = |prop: &str, value: VariantValue| (prop.to_string(), value);
        let line = || VariantValue::Literal("line".to_string());
        let wrapper = "const W = (p) => <Skel {...p} />;";
        assert_eq!(
            option_usages(wrapper),
            (vec![pair("shape", VariantValue::Dynamic)], vec!["loading".to_string()])
        );

        let settled_after = "const W = (p) => <Skel {...p} shape=\"line\" loading={false} />;";
        assert_eq!(
            option_usages(settled_after),
            (vec![pair("shape", line())], vec!["loading".to_string()])
        );

        let overridable_before = "const W = (p) => <Skel shape=\"line\" {...p} />;";
        assert_eq!(
            option_usages(overridable_before),
            (
                vec![pair("shape", line()), pair("shape", VariantValue::Dynamic)],
                vec!["loading".to_string()]
            )
        );

        let no_spread = "const A = () => <Skel shape=\"line\" />;";
        assert_eq!(option_usages(no_spread), (vec![pair("shape", line())], vec![]));

        let open = (vec![pair("shape", VariantValue::Dynamic)], vec!["loading".to_string()]);
        let defaults = (vec![pair("shape", VariantValue::Default)], vec![]);
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
            (vec![pair("shape", line())], vec!["loading".to_string()])
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


/// Function-local `const` aliases of module-scope components rendered only
/// as JSX tags (`const Unit = wide ? Panel.Root : Row; <Unit />`): such an
/// element renders one of the candidates with the tag's props, so it stands
/// for each, and the alias's initializer hands nothing on. An alias used any
/// other way (handed on, spread, put in an object, returned, captured by a
/// nested function that does any of those), or declared with `let`, is
/// none, and escapes as before.
#[derive(Debug, Default)]
pub(crate) struct LocalAliases {
    /// Each alias element's opening, by where it starts: the tags it may
    /// render, each with where its root is bound.
    pub elements: FxHashMap<u32, Vec<(String, TagOrigin)>>,
    /// Where the aliases' leaves start, in order: the references an alias
    /// carries to its elements, which hand nothing on.
    pub leaves: Vec<u32>,
}

/// What an alias's initializer may be.
enum AliasLeaf {
    Tag(String, TagOrigin),
    Alias(SymbolId),
}

impl LocalAliases {
    pub(crate) fn of(program: &Program<'_>, scoping: &Scoping) -> Self {
        let mut scan = AliasScan {
            scoping,
            aliases: FxHashMap::default(),
            leaf_references: FxHashSet::default(),
            openings: FxHashMap::default(),
            closings: FxHashSet::default(),
        };
        scan.visit_program(program);
        let AliasScan { aliases, leaf_references, openings, closings, .. } = scan;
        if aliases.is_empty() {
            return Self::default();
        }
        // An alias with a reference that is neither a JSX tag nor another
        // alias's leaf is none, and so is one of a local that is no alias.
        let mut other: FxHashSet<SymbolId> = FxHashSet::default();
        let mut uses = Vec::new();
        for (symbol, (leaves, _)) in &aliases {
            if leaves.iter().any(|leaf| matches!(leaf, AliasLeaf::Alias(inner) if !aliases.contains_key(inner))) {
                other.insert(*symbol);
            }
            for reference in scoping.get_resolved_reference_ids(*symbol) {
                match openings.get(reference) {
                    Some(at) => uses.push((*symbol, *at)),
                    None if closings.contains(reference) || leaf_references.contains(reference) => {}
                    None => {
                        other.insert(*symbol);
                    }
                }
            }
        }
        // An alias handed on hands on every alias it names.
        let mut pending: Vec<SymbolId> = other.iter().copied().collect();
        while let Some(symbol) = pending.pop() {
            for leaf in aliases.get(&symbol).map(|(leaves, _)| leaves.as_slice()).unwrap_or_default() {
                if let AliasLeaf::Alias(inner) = leaf {
                    if aliases.contains_key(inner) && other.insert(*inner) {
                        pending.push(*inner);
                    }
                }
            }
        }
        fn expand(
            symbol: SymbolId,
            aliases: &FxHashMap<SymbolId, (Vec<AliasLeaf>, Vec<u32>)>,
            seen: &mut FxHashSet<SymbolId>,
            into: &mut Vec<(String, TagOrigin)>,
        ) {
            if !seen.insert(symbol) {
                return;
            }
            for leaf in aliases.get(&symbol).map(|(leaves, _)| leaves.as_slice()).unwrap_or_default() {
                match leaf {
                    AliasLeaf::Tag(tag, origin) => {
                        if !into.iter().any(|(known, _)| known == tag) {
                            into.push((tag.clone(), *origin));
                        }
                    }
                    AliasLeaf::Alias(inner) => expand(*inner, aliases, seen, into),
                }
            }
        }
        let mut found = LocalAliases::default();
        for (symbol, (_, spans)) in &aliases {
            if !other.contains(symbol) {
                found.leaves.extend(spans);
            }
        }
        for (symbol, at) in uses {
            if other.contains(&symbol) {
                continue;
            }
            let mut tags = Vec::new();
            expand(symbol, &aliases, &mut FxHashSet::default(), &mut tags);
            if !tags.is_empty() {
                found.elements.insert(at, tags);
            }
        }
        found.leaves.sort_unstable();
        found
    }

    /// `usage` with each alias element standing for every tag it may render.
    pub(crate) fn rewrite(&self, usage: Vec<UsageFact>) -> Vec<UsageFact> {
        if self.elements.is_empty() {
            return usage;
        }
        let mut out = Vec::with_capacity(usage.len());
        for fact in usage {
            let candidates = match &fact {
                UsageFact::Element { span, .. } => self.elements.get(&span.0),
                _ => None,
            };
            let Some(candidates) = candidates else {
                out.push(fact);
                continue;
            };
            for (tag, origin) in candidates {
                let mut copy = fact.clone();
                if let UsageFact::Element { tag: written, origin: bound, .. } = &mut copy {
                    *written = if tag.contains('.') { TagFact::Member(tag.clone()) } else { TagFact::Ident(tag.clone()) };
                    *bound = Some(*origin);
                }
                out.push(copy);
            }
        }
        out
    }

    /// Whether the reference at `span` is an alias's leaf.
    pub(crate) fn followed(&self, span: oxc::span::Span) -> bool {
        self.leaves.binary_search(&span.start).is_ok()
    }
}

struct AliasScan<'s> {
    scoping: &'s Scoping,
    /// Each candidate alias: its initializer's leaves and where they start.
    aliases: FxHashMap<SymbolId, (Vec<AliasLeaf>, Vec<u32>)>,
    /// The candidates' leaf references, which are theirs.
    leaf_references: FxHashSet<oxc::semantic::ReferenceId>,
    /// Each JSX opening tag's name reference, with the element's start.
    openings: FxHashMap<oxc::semantic::ReferenceId, u32>,
    /// Each JSX closing tag's name reference.
    closings: FxHashSet<oxc::semantic::ReferenceId>,
}

impl<'a> AliasScan<'_> {
    /// The leaves of an alias's initializer: module-scope bindings, their
    /// static members, or other local `const`s, through conditional and
    /// logical choices; false for anything else. An element of a leaf is
    /// judged as that tag written in place.
    fn leaves(
        &self,
        init: &Expression<'a>,
        into: &mut Vec<AliasLeaf>,
        spans: &mut Vec<u32>,
        references: &mut Vec<oxc::semantic::ReferenceId>,
    ) -> bool {
        let root_scope = self.scoping.root_scope_id();
        let bound = |id: &IdentifierReference<'_>| id.reference_id.get().and_then(|id| self.scoping.get_reference(id).symbol_id());
        let origin = |symbol: SymbolId| if self.scoping.symbol_flags(symbol).is_import() { TagOrigin::Import } else { TagOrigin::TopLevel };
        match crate::chain_walk::unwrap_type_assertions(init) {
            Expression::ConditionalExpression(conditional) => {
                self.leaves(&conditional.consequent, into, spans, references)
                    && self.leaves(&conditional.alternate, into, spans, references)
            }
            Expression::LogicalExpression(logical) => match logical.operator {
                oxc::syntax::operator::LogicalOperator::And => self.leaves(&logical.right, into, spans, references),
                _ => self.leaves(&logical.left, into, spans, references) && self.leaves(&logical.right, into, spans, references),
            },
            Expression::Identifier(id) => {
                let (Some(symbol), Some(reference)) = (bound(id), id.reference_id.get()) else { return false };
                spans.push(id.span.start);
                if self.scoping.symbol_scope_id(symbol) == root_scope {
                    into.push(AliasLeaf::Tag(id.name.to_string(), origin(symbol)));
                } else {
                    references.push(reference);
                    into.push(AliasLeaf::Alias(symbol));
                }
                true
            }
            Expression::StaticMemberExpression(member) => {
                let (Some(path), Some(root)) = (static_member_path(member), static_member_root(member)) else { return false };
                let Some(symbol) = bound(root) else { return false };
                if self.scoping.symbol_scope_id(symbol) != root_scope {
                    return false;
                }
                spans.push(root.span.start);
                into.push(AliasLeaf::Tag(path, origin(symbol)));
                true
            }
            _ => false,
        }
    }
}

impl<'a> Visit<'a> for AliasScan<'_> {
    fn visit_variable_declaration(&mut self, declaration: &oxc::ast::ast::VariableDeclaration<'a>) {
        if declaration.kind == oxc::ast::ast::VariableDeclarationKind::Const {
            for declarator in &declaration.declarations {
                let (oxc::ast::ast::BindingPattern::BindingIdentifier(id), Some(init)) = (&declarator.id, &declarator.init) else { continue };
                let Some(symbol) = id.symbol_id.get().filter(|symbol| self.scoping.symbol_scope_id(*symbol) != self.scoping.root_scope_id()) else {
                    continue;
                };
                let (mut leaves, mut spans, mut references) = (Vec::new(), Vec::new(), Vec::new());
                if self.leaves(init, &mut leaves, &mut spans, &mut references) {
                    self.leaf_references.extend(references);
                    self.aliases.insert(symbol, (leaves, spans));
                }
            }
        }
        oxc::ast_visit::walk::walk_variable_declaration(self, declaration);
    }

    fn visit_jsx_opening_element(&mut self, opening: &oxc::ast::ast::JSXOpeningElement<'a>) {
        if let Some(reference) = jsx_name_reference(&opening.name) {
            self.openings.insert(reference, opening.span.start);
        }
        oxc::ast_visit::walk::walk_jsx_opening_element(self, opening);
    }

    fn visit_jsx_closing_element(&mut self, closing: &oxc::ast::ast::JSXClosingElement<'a>) {
        if let Some(reference) = jsx_name_reference(&closing.name) {
            self.closings.insert(reference);
        }
        oxc::ast_visit::walk::walk_jsx_closing_element(self, closing);
    }
}

/// The reference a JSX element's plain name makes (`Unit` in `<Unit>`).
fn jsx_name_reference(name: &JSXElementName<'_>) -> Option<oxc::semantic::ReferenceId> {
    match name {
        JSXElementName::IdentifierReference(name) => name.reference_id.get(),
        _ => None,
    }
}
