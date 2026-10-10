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
use oxc::syntax::module_record::{ExportExportName, ImportImportName, ModuleRecord};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

use crate::chain_walk::{ChainDescriptor, TerminalKind};
use crate::jsx_scan::{
    classify_jsx_attribute_as_variant_value, create_element_literals, create_element_props, eval_jsx_attribute_value, eval_property_key,
    eval_static_expression, make_json_number,
    is_component_like_identifier, jsx_member_path, ComponentUsageConfig, CustomPropScanResult,
    DynamicExpressionKind, DynamicPropUsage, PropValueResult, StateUsage, SystemPropUsage,
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
}

impl AttrFact {
    /// Every value the attribute can write, when they are known: its
    /// static value, or the finite values a runtime value is proven to take.
    pub(crate) fn proven_values(&self) -> Option<impl Iterator<Item = &Value>> {
        (self.literal && !self.dynamic).then(|| self.static_value.iter().chain(&self.enumerable_values))
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
        BindingPattern::ObjectPattern(object) => object_rest(object)?,
        _ => return None,
    };
    let mut routes = Vec::new();
    let mut route = |named: Vec<String>, spread: &str| {
        let mut scan = SpreadTargets {
            spread,
            targets: Vec::new(),
        };
        scan.visit_function_body(function.body);
        if !scan.targets.is_empty() {
            routes.push(ForwardRoute { named, targets: scan.targets });
        }
    };
    route(named.clone(), &spread);
    // `const { a, ...rest } = props` in the body, then `{...rest}`: neither
    // the props the parameter names nor the ones the body names reach the
    // tags `rest` is spread into.
    for statement in &function.body.statements {
        for (body_named, rest) in destructured_rests(statement, &spread) {
            route(named.iter().cloned().chain(body_named).collect(), &rest);
        }
    }
    (!routes.is_empty()).then_some(PropsForwarding { routes })
}

/// `{ a, b, ...rest }`: the keys it names and its rest binding.
fn object_rest(object: &oxc::ast::ast::ObjectPattern<'_>) -> Option<(Vec<String>, String)> {
    let oxc::ast::ast::BindingPattern::BindingIdentifier(rest) = &object.rest.as_ref()?.argument else {
        return None;
    };
    let named = object
        .properties
        .iter()
        .filter_map(|property| property.key.static_name().map(|key| key.to_string()))
        .collect();
    Some((named, rest.name.to_string()))
}

/// Each `const { a, b, ...rest } = props` of a statement: the keys it names
/// and its rest binding, when it destructures `props` itself.
fn destructured_rests(statement: &Statement<'_>, props: &str) -> Vec<(Vec<String>, String)> {
    use oxc::ast::ast::BindingPattern;
    let Statement::VariableDeclaration(declaration) = statement else { return Vec::new() };
    declaration
        .declarations
        .iter()
        .filter_map(|declarator| {
            let init = crate::chain_walk::unwrap_type_assertions(declarator.init.as_ref()?);
            if !matches!(init, Expression::Identifier(id) if id.name == props) {
                return None;
            }
            let BindingPattern::ObjectPattern(object) = &declarator.id else { return None };
            object_rest(object)
        })
        .collect()
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
            Some(ImportFact {
                local: entry.local_name.name.to_string(),
                imported,
                source: entry.module_request.name.to_string(),
                declaration: (entry.statement_span.start, entry.statement_span.end),
            })
        })
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

/// The identifier `export default X;` names, if any, through type
/// assertions, which the parser's module record does not see through.
pub fn collect_default_export_binding(program: &Program<'_>) -> Option<String> {
    program.body.iter().find_map(|stmt| match stmt {
        Statement::ExportDefaultDeclaration(export) => match export
            .declaration
            .as_expression()
            .map(crate::chain_walk::unwrap_type_assertions)
        {
            Some(Expression::Identifier(id)) => Some(id.name.to_string()),
            _ => None,
        },
        _ => None,
    })
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

/// `export * as name from '…'`: name → source. The parser records these
/// among the indirect exports.
pub fn collect_namespace_exports(module: &ModuleRecord<'_>) -> BTreeMap<String, String> {
    module
        .indirect_export_entries
        .iter()
        .filter(|entry| entry.import_name.is_all())
        .filter_map(|entry| match (&entry.export_name, &entry.module_request) {
            (ExportExportName::Name(name), Some(source)) => Some((name.name.to_string(), source.name.to_string())),
            _ => None,
        })
        .collect()
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
/// What `collect_enriched_usage` reads from one semantic build of a module.
pub(crate) struct EnrichedUsage {
    pub usage: Vec<UsageFact>,
    /// See `FileFacts::confined_components`.
    pub confined: BTreeSet<String>,
    /// See `FileFacts::value_escapes`.
    pub escapes: BTreeSet<String>,
    /// See `FileFacts::spread_wrappers`.
    pub spread_wrappers: BTreeMap<String, SpreadWrapper>,
    /// See `FileFacts::module_loads`.
    pub module_loads: Vec<ModuleLoad>,
    /// See `FileFacts::unsafe_object_uses`.
    pub unsafe_object_uses: BTreeMap<String, ObjectUse>,
    /// See `FileFacts::ordinary_components`.
    pub ordinary_components: BTreeSet<String>,
    /// See `FileFacts::direct_eval`.
    pub direct_eval: bool,
    /// See `FileFacts::opaque_calls`.
    pub opaque_calls: Vec<OpaqueCall>,
    /// See `FileFacts::element_consts`.
    pub element_consts: BTreeMap<String, ElementConst>,
    /// See `FileFacts::opaque_tags`.
    pub opaque_tags: Vec<OpaqueTag>,
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

/// A module a file loads at runtime, outside its `import` declarations:
/// `import()`, `require()`, `require.context()`, `import.meta.glob()`.
/// Whatever the loaded module exports renders where usage cannot follow. A
/// glob array gives one load per pattern, all from one call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModuleLoad {
    pub target: LoadTarget,
    /// An `import()`: some hosts leave an unreadable one unbundled.
    pub dynamic_import: bool,
    /// The call's line and spelling, for the warning when it opens many
    /// components.
    pub line: usize,
    pub call: String,
}

/// What a module load names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadTarget {
    /// One specifier: `import('./r')`, `require('./r')`.
    Specifier(String),
    /// Every module whose specifier starts with this: a template literal
    /// (`import(`./pages/${name}`)`) or a concatenation.
    Prefix(String),
    /// `require.context(dir, recursive, filter)` and
    /// `import.meta.webpackContext(dir, { recursive, regExp })`: modules
    /// under `dir`, at any depth when `recursive`, whose `./`-relative path
    /// `filter` (a regular expression) matches; `None` matches any.
    Context {
        dir: String,
        recursive: bool,
        filter: Option<String>,
    },
    /// One `import.meta.glob` pattern.
    Glob(String),
    /// A specifier usage cannot read.
    Unknown,
}

/// The modules a specifier expression can name.
fn load_of(specifier: &Expression<'_>) -> LoadTarget {
    match specifier.get_inner_expression() {
        Expression::StringLiteral(literal) => LoadTarget::Specifier(literal.value.to_string()),
        Expression::TemplateLiteral(template) => {
            let head = template.quasis.first().and_then(|quasi| quasi.value.cooked.as_ref());
            match (template.expressions.is_empty(), head) {
                (true, Some(head)) => LoadTarget::Specifier(head.to_string()),
                (false, Some(head)) => LoadTarget::Prefix(head.to_string()),
                _ => LoadTarget::Unknown,
            }
        }
        Expression::BinaryExpression(binary)
            if binary.operator == oxc::syntax::operator::BinaryOperator::Addition =>
        {
            match load_of(&binary.left) {
                LoadTarget::Specifier(head) | LoadTarget::Prefix(head) => LoadTarget::Prefix(head),
                _ => LoadTarget::Unknown,
            }
        }
        _ => LoadTarget::Unknown,
    }
}

/// A regular expression literal as a pattern for the `regex` crate, its
/// flags folded in; `None` for anything else.
fn regex_of(expression: Option<&Expression<'_>>) -> Option<String> {
    let Expression::RegExpLiteral(literal) = expression?.get_inner_expression() else {
        return None;
    };
    let flags = literal.regex.flags.to_string();
    let inline: String = flags.chars().filter(|flag| matches!(flag, 'i' | 'm' | 's')).collect();
    let pattern = literal.regex.pattern.text.to_string();
    Some(if inline.is_empty() { pattern } else { format!("(?{inline}){pattern}") })
}

/// A context's modules: `dir`, how deep, and which paths. An argument
/// usage cannot read keeps the widest reading: any depth, any path.
fn context_of(
    dir: Option<&Expression<'_>>,
    recursive: Option<&Expression<'_>>,
    filter: Option<&Expression<'_>>,
) -> LoadTarget {
    let dir = match dir.map(load_of) {
        Some(LoadTarget::Specifier(dir)) => dir,
        Some(LoadTarget::Prefix(prefix)) => {
            return LoadTarget::Prefix(prefix);
        }
        _ => return LoadTarget::Unknown,
    };
    let recursive = !matches!(
        recursive.map(Expression::get_inner_expression),
        Some(Expression::BooleanLiteral(literal)) if !literal.value
    );
    LoadTarget::Context {
        dir,
        recursive,
        filter: regex_of(filter),
    }
}

/// `import.meta.webpackContext(dir, { recursive, regExp })`.
fn webpack_context_of(call: &CallExpression<'_>) -> LoadTarget {
    let options = call.arguments.get(1).and_then(Argument::as_expression);
    let option = |name: &str| match options.map(Expression::get_inner_expression) {
        Some(Expression::ObjectExpression(object)) => object.properties.iter().find_map(|property| {
            match property {
                oxc::ast::ast::ObjectPropertyKind::ObjectProperty(property)
                    if property.key.static_name().as_deref() == Some(name) =>
                {
                    Some(&property.value)
                }
                _ => None,
            }
        }),
        _ => None,
    };
    let first = call.arguments.first().and_then(Argument::as_expression);
    context_of(first, option("recursive"), option("regExp"))
}

/// The patterns one glob argument names: a pattern, or an array of them; a
/// negated pattern only narrows, so it is skipped.
fn glob_loads(argument: Option<&Argument<'_>>) -> Vec<LoadTarget> {
    let pattern = |expression: &Expression<'_>| match expression.get_inner_expression() {
        Expression::StringLiteral(literal) if literal.value.starts_with('!') => None,
        Expression::StringLiteral(literal) => Some(LoadTarget::Glob(literal.value.to_string())),
        _ => Some(LoadTarget::Unknown),
    };
    match argument.and_then(Argument::as_expression).map(Expression::get_inner_expression) {
        Some(Expression::ArrayExpression(array)) => array
            .elements
            .iter()
            .filter_map(|element| match element.as_expression() {
                Some(expression) => pattern(expression),
                None => Some(LoadTarget::Unknown),
            })
            .collect(),
        Some(expression) => pattern(expression).into_iter().collect(),
        None => vec![LoadTarget::Unknown],
    }
}

/// What a call loads: `require(…)`, `require.context(…)`,
/// `import.meta.webpackContext(…)` and `import.meta.glob(…)` (also the
/// older `globEager`). `require.resolve` loads nothing.
fn call_loads(call: &CallExpression<'_>) -> Vec<LoadTarget> {
    let argument = |index: usize| call.arguments.get(index).and_then(Argument::as_expression);
    match &call.callee {
        Expression::Identifier(id) if id.name == "require" => {
            vec![argument(0).map_or(LoadTarget::Unknown, load_of)]
        }
        Expression::StaticMemberExpression(member) => {
            match (&member.object, member.property.name.as_str()) {
                (Expression::Identifier(object), "context") if object.name == "require" => {
                    vec![context_of(argument(0), argument(1), argument(2))]
                }
                (Expression::MetaProperty(meta), property)
                    if meta.meta.name == "import" && meta.property.name == "meta" =>
                {
                    match property {
                        "webpackContext" => vec![webpack_context_of(call)],
                        "glob" | "globEager" => glob_loads(call.arguments.first()),
                        _ => Vec::new(),
                    }
                }
                _ => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

pub(crate) fn collect_enriched_usage(
    program: &Program<'_>,
    module: &ModuleRecord<'_>,
    static_values: &FxHashMap<String, Value>,
    chains: &[&ChainDescriptor],
    exports: &[ExportFact],
    object_consts: &BTreeMap<&str, bool>,
    assigned_targets: &BTreeSet<&str>,
) -> EnrichedUsage {
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
    let scoping = (!static_values.is_empty()
        || !candidates.is_empty()
        || may_escape
        || !wrapper_candidates.is_empty())
    .then(|| SemanticBuilder::new().build(program).semantic.into_scoping());
    let react = match &scoping {
        Some(scoping) => ReactNames::from_imports(program, scoping),
        None => ReactNames::by_name(),
    };
    // Tag origins and ordinary components read the same scopes, built here
    // when nothing above needed them.
    let tag_scoping = match &scoping {
        Some(_) => None,
        None => Some(SemanticBuilder::new().build(program).semantic.into_scoping()),
    };
    let origins = scoping.as_ref().or(tag_scoping.as_ref());
    // Only TypeScript annotates parameters.
    let finite_params = origins
        .filter(|_| program.source_type.is_typescript())
        .map(|scoping| literal_union_parameters(program, scoping))
        .unwrap_or_default();
    let mut collector = FactCollector {
        facts: Vec::new(),
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
        module_loads: Some(Vec::new()),
        origins,
    };
    collector.visit_program(program);
    let module_loads = collector.module_loads.take().unwrap_or_default();
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
    let unsafe_object_uses = match &scoping {
        Some(scoping) => unsafe_object_uses(program, scoping, object_consts, assigned_targets),
        None => BTreeMap::new(),
    };
    let (opaque_calls, opaque_tags, element_consts) =
        origins.map(|scoping| opaque_calls(program, scoping)).unwrap_or_default();
    EnrichedUsage {
        usage,
        confined,
        escapes,
        spread_wrappers,
        module_loads,
        unsafe_object_uses,
        ordinary_components,
        direct_eval,
        opaque_calls,
        element_consts,
        opaque_tags,
    }
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
        Statement::ExportNamedDeclaration(export) => export.declaration.as_ref(),
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
                (None, None) => continue,
            };
            entered.extend(function);
            closed.tags.extend(next.tags.iter().cloned());
            closed.unknown_global |= next.unknown_global;
            pending.extend(next.symbols.iter().copied());
        }
        closed.reads_parameter =
            parameters.iter().any(|parameter| !entered.contains(&self.scoping.symbol_scope_id(*parameter)));
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

/// See `FileFacts::unsafe_object_uses`.
fn unsafe_object_uses(
    program: &Program<'_>,
    scoping: &Scoping,
    object_consts: &BTreeMap<&str, bool>,
    assigned_targets: &BTreeSet<&str>,
) -> BTreeMap<String, ObjectUse> {
    let candidates = object_bindings(program, scoping, object_consts, assigned_targets);
    if candidates.is_empty() {
        return BTreeMap::new();
    }
    if scoping.root_unresolved_references().contains_key("eval") {
        // Direct eval can reach any binding by name.
        let what = ObjectUse { line: None, what: "can be changed by a direct eval".to_string() };
        return candidates.into_values().map(|binding| (binding.name, what.clone())).collect();
    }
    let mut scan = ObjectUseScan {
        scoping,
        source: program.source_text,
        candidates,
        // A module-scope `Object` is not the global one.
        global_object: scoping.get_root_binding("Object".into()).is_none(),
        uses: BTreeMap::new(),
        ancestors: Vec::new(),
        style: false,
        containers: Vec::new(),
        statics: None,
        derives: Vec::new(),
        handoffs: Vec::new(),
        flat_reads: Vec::new(),
    };
    scan.visit_program(program);
    scan.uses
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
    statics: &FxHashMap<String, Value>,
) -> StyleObjectFacts {
    let consts: BTreeMap<&str, bool> = statics
        .iter()
        .filter(|(_, value)| value.is_object())
        .map(|(name, _)| (name.as_str(), false))
        .collect();
    let scoping = SemanticBuilder::new().build(program).semantic.into_scoping();
    let candidates = object_bindings(program, &scoping, &consts, &BTreeSet::new());
    if candidates.is_empty() {
        return StyleObjectFacts::default();
    }
    if scoping.root_unresolved_references().contains_key("eval") {
        let what = ObjectUse { line: None, what: "can be changed by a direct eval".to_string() };
        let uses = candidates.into_values().map(|binding| (binding.name, what.clone())).collect();
        return StyleObjectFacts { uses, ..StyleObjectFacts::default() };
    }
    let mut scan = ObjectUseScan {
        scoping: &scoping,
        source: program.source_text,
        candidates,
        global_object: !binds_anywhere(&scoping, "Object"),
        uses: BTreeMap::new(),
        ancestors: Vec::new(),
        style: true,
        containers: Vec::new(),
        statics: Some(statics),
        derives: Vec::new(),
        handoffs: Vec::new(),
        flat_reads: Vec::new(),
    };
    scan.visit_program(program);
    StyleObjectFacts {
        uses: scan.uses,
        stored: scan.containers,
        derives: scan.derives,
        handoffs: scan.handoffs,
        flat_reads: scan.flat_reads,
    }
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
    /// Each binding's first unsafe use.
    pub uses: BTreeMap<String, ObjectUse>,
    /// (object, the module-scope `const` object it is stored in): the
    /// object is unstable when its container is.
    pub stored: Vec<(String, String)>,
    /// (module-scope `const`, a binding its initializer reads): the `const`
    /// holds a value read from that binding, unstable when it is.
    pub derives: Vec<(String, String)>,
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
    pub callee: String,
    pub index: usize,
    pub used: ObjectUse,
}

/// The module-scope `const` whose initializer holds the expression the
/// ancestors lead out of.
fn initializing_const(ancestors: &[AstKind<'_>]) -> Option<String> {
    use oxc::ast::ast::{BindingPattern, VariableDeclarationKind};
    let at = ancestors.iter().rposition(|kind| matches!(kind, AstKind::VariableDeclarator(_)))?;
    let AstKind::VariableDeclarator(declarator) = &ancestors[at] else { return None };
    let BindingPattern::BindingIdentifier(id) = &declarator.id else { return None };
    let Some(AstKind::VariableDeclaration(declaration)) = ancestors.get(at.checked_sub(1)?) else { return None };
    let top_level = match ancestors.get(at.checked_sub(2)?) {
        Some(AstKind::Program(_)) => true,
        Some(AstKind::ExportNamedDeclaration(_)) => matches!(ancestors.get(at.checked_sub(3)?), Some(AstKind::Program(_))),
        _ => false,
    };
    (top_level && declaration.kind == VariableDeclarationKind::Const).then(|| id.name.to_string())
}

/// How a style-mode use treats an object binding.
enum StyleUse {
    Read,
    Unsafe(String),
    /// Stored as a member of the named module-scope `const` object.
    StoredIn(String),
    /// Hands on the member at the path (`None` past a computed member):
    /// unsafe unless that member is no object.
    MemberHandoff(Option<Vec<String>>, String),
    /// Passed whole as argument `index` of a call to the function named
    /// `callee`, by the reference `reference`: a read when the callee is a
    /// module-scope binding nothing writes and that parameter only reads it.
    Handoff { callee: String, reference: Option<oxc::semantic::ReferenceId>, index: usize, what: String },
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
/// property value or spread at `span`, through nested object literals.
fn container_const(span: Span, ancestors: &[AstKind<'_>]) -> Option<String> {
    use oxc::ast::ast::{BindingPattern, VariableDeclarationKind};
    let mut rest = ancestors.iter().rev();
    let mut current = span;
    loop {
        match rest.next()? {
            kind if is_erased_wrapper(kind) => current = kind.span(),
            AstKind::ObjectProperty(prop) if prop.value.span() == current => current = prop.span,
            AstKind::SpreadElement(spread) if spread.argument.span() == current => current = spread.span,
            AstKind::ObjectExpression(object) => current = object.span,
            AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().map(GetSpan::span) == Some(current) =>
            {
                let BindingPattern::BindingIdentifier(id) = &declarator.id else { return None };
                let Some(AstKind::VariableDeclaration(declaration)) = rest.next() else { return None };
                let top_level = match rest.next() {
                    Some(AstKind::Program(_)) => true,
                    Some(AstKind::ExportNamedDeclaration(_)) => matches!(rest.next(), Some(AstKind::Program(_))),
                    _ => false,
                };
                return (top_level && declaration.kind == VariableDeclarationKind::Const)
                    .then(|| id.name.to_string());
            }
            _ => return None,
        }
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
                StyleUse::Unsafe("is aliased by another binding".to_string())
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
                Some(container) if containers.contains(&container) => StyleUse::StoredIn(container),
                _ => StyleUse::FlatRead("is spread into a copy".to_string()),
            },
            _ => StyleUse::Unsafe("is spread into a call or an array".to_string()),
        },
        Some(AstKind::JSXSpreadAttribute(_)) => StyleUse::FlatRead("is spread into props".to_string()),
        Some(AstKind::ObjectProperty(prop)) if prop.value.span() == current => {
            match container_const(span, ancestors) {
                Some(container) if containers.contains(&container) => StyleUse::StoredIn(container),
                _ => StyleUse::Unsafe("is stored in an object".to_string()),
            }
        }
        Some(AstKind::StaticMemberExpression(_) | AstKind::ComputedMemberExpression(_)) => {
            // Out through the member chain: a write or hand-off at any depth.
            let mut outer = current;
            let mut name = String::new();
            let mut path: Option<Vec<String>> = Some(Vec::new());
            let mut parent = parent;
            loop {
                match parent {
                    Some(AstKind::StaticMemberExpression(member)) if member.object.span() == outer => {
                        name = member.property.name.to_string();
                        if let Some(path) = path.as_mut() {
                            path.push(name.clone());
                        }
                    }
                    Some(AstKind::ComputedMemberExpression(member)) if member.object.span() == outer => {
                        name = "a computed member".to_string();
                        path = None;
                    }
                    _ => break,
                }
                let member_span = parent.map(GetSpan::span).unwrap_or(outer);
                if let Some(what) = member_use(&format!("its member {name}"), member_span, rest.clone()) {
                    return StyleUse::Unsafe(what);
                }
                let (next_outer, next_parent) = peel_wrappers(member_span, &mut rest);
                outer = next_outer;
                parent = next_parent;
            }
            match parent {
                Some(AstKind::CallExpression(call)) if call.callee.span() != outer => {
                    StyleUse::MemberHandoff(path, format!("has its member {name} passed to a call"))
                }
                Some(AstKind::VariableDeclarator(declarator))
                    if declarator.init.as_ref().map(GetSpan::span) == Some(outer) =>
                {
                    StyleUse::MemberHandoff(path, format!("has its member {name} assigned to a variable"))
                }
                Some(AstKind::AssignmentExpression(assignment)) if assignment.right.span() == outer => {
                    StyleUse::MemberHandoff(path, format!("has its member {name} assigned to a variable"))
                }
                Some(AstKind::ObjectProperty(_) | AstKind::ArrayExpression(_)) => {
                    StyleUse::MemberHandoff(path, format!("has its member {name} stored in an object"))
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
                _ => StyleUse::MemberHandoff(
                    path,
                    format!("has its member {name} used where the extractor does not follow it"),
                ),
            }
        }
        Some(AstKind::CallExpression(call)) if call.callee.span() != current => {
            let index = call.arguments.iter().position(|arg| arg.span() == current);
            match (crate::chain_walk::unwrap_type_assertions(&call.callee), index) {
                (Expression::Identifier(callee), Some(index)) => StyleUse::Handoff {
                    callee: callee.name.to_string(),
                    reference: callee.reference_id.get(),
                    index,
                    what: format!("is passed to {}()", callee.name),
                },
                // The global `Object`'s readers: keys only read; values,
                // entries and an assign source hand out the object's values.
                (Expression::StaticMemberExpression(member), Some(index))
                    if global_object && member.object.is_specific_id("Object") =>
                {
                    match member.property.name.as_str() {
                        "keys" | "freeze" => StyleUse::Read,
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

/// How a function treats the object passed as one of its parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ParamReading {
    /// Only read in the body, and passed on only to these callees, by
    /// local name and argument index, which must read it only too.
    ReadOnly(Vec<(String, usize)>),
    /// A use that may change the object or hand it to code not followed.
    Unsafe,
}

/// For each module-scope function (a declaration, or a `const` arrow or
/// function expression), how each parameter treats its object: see
/// `ParamReading`. A destructuring, rest, default or other pattern counts
/// as unsafe, and so does every parameter of a function something
/// reassigns.
pub(crate) fn function_param_readings(program: &Program<'_>) -> BTreeMap<String, Vec<ParamReading>> {
    use oxc::ast::ast::{BindingPattern, Declaration, ExportDefaultDeclarationKind, FormalParameters};
    let scoping = SemanticBuilder::new().build(program).semantic.into_scoping();
    // A function with no body (an ambient `declare function` or an overload
    // signature) may do anything with its arguments.
    let mut functions: Vec<(String, &FormalParameters<'_>, bool)> = Vec::new();
    for stmt in &program.body {
        let declaration = match stmt {
            Statement::ExportNamedDeclaration(export) => export.declaration.as_ref(),
            Statement::ExportDefaultDeclaration(export) => {
                if let ExportDefaultDeclarationKind::FunctionDeclaration(func) = &export.declaration {
                    if let Some(id) = &func.id {
                        functions.push((id.name.to_string(), &func.params, func.body.is_some()));
                    }
                }
                None
            }
            other => other.as_declaration(),
        };
        match declaration {
            Some(Declaration::FunctionDeclaration(func)) => {
                if let Some(id) = &func.id {
                    functions.push((id.name.to_string(), &func.params, func.body.is_some()));
                }
            }
            Some(Declaration::VariableDeclaration(var)) if var.kind == oxc::ast::ast::VariableDeclarationKind::Const => {
                for declarator in &var.declarations {
                    let BindingPattern::BindingIdentifier(id) = &declarator.id else { continue };
                    match declarator.init.as_ref().map(crate::chain_walk::unwrap_type_assertions) {
                        Some(Expression::ArrowFunctionExpression(arrow)) => {
                            functions.push((id.name.to_string(), &arrow.params, true));
                        }
                        Some(Expression::FunctionExpression(func)) => {
                            functions.push((id.name.to_string(), &func.params, func.body.is_some()));
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    let mut readings: BTreeMap<String, Vec<ParamReading>> = BTreeMap::new();
    let mut params: FxHashMap<SymbolId, (String, usize)> = FxHashMap::default();
    for (name, formal, has_body) in &functions {
        if !has_body {
            // An overload signature never overrides its implementation.
            readings
                .entry(name.clone())
                .or_insert_with(|| vec![ParamReading::Unsafe; formal.items.len() + 1]);
            continue;
        }
        let mut reading = Vec::new();
        for (index, param) in formal.items.iter().enumerate() {
            match &param.pattern {
                BindingPattern::BindingIdentifier(id) => {
                    if let Some(symbol) = id.symbol_id.get() {
                        params.insert(symbol, (name.clone(), index));
                    }
                    reading.push(ParamReading::ReadOnly(Vec::new()));
                }
                _ => reading.push(ParamReading::Unsafe),
            }
        }
        if formal.rest.is_some() {
            reading.push(ParamReading::Unsafe);
        }
        let reassigned = scoping
            .get_root_binding(name.as_str().into())
            .is_some_and(|symbol| scoping.get_resolved_references(symbol).any(oxc::semantic::Reference::is_write));
        if reassigned {
            reading.iter_mut().for_each(|param| *param = ParamReading::Unsafe);
        }
        readings.insert(name.clone(), reading);
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
        scoping: &scoping,
        params,
        readings,
        ancestors: Vec::new(),
        global_object: !binds_anywhere(&scoping, "Object"),
    };
    scan.visit_program(program);
    scan.readings
}

/// Visits each value reference to a watched parameter and records how it
/// treats the object (see `function_param_readings`).
struct ParamScan<'a, 's> {
    scoping: &'s Scoping,
    params: FxHashMap<SymbolId, (String, usize)>,
    readings: BTreeMap<String, Vec<ParamReading>>,
    ancestors: Vec<AstKind<'a>>,
    global_object: bool,
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
        let Some(slot) = self.readings.get_mut(&function).and_then(|reading| reading.get_mut(index)) else {
            return;
        };
        let ParamReading::ReadOnly(passes) = slot else { return };
        // The engine hands on only an object whose values are primitives,
        // so a copy or a member of the parameter holds no object of it.
        match style_object_use(ident.span, &self.ancestors, &FxHashSet::default(), self.global_object) {
            StyleUse::Read | StyleUse::FlatRead(_) | StyleUse::MemberHandoff(..) => {}
            StyleUse::Handoff { callee, reference, index, .. } if fixed_callee(self.scoping, reference) => {
                passes.push((callee, index));
            }
            _ => *slot = ParamReading::Unsafe,
        }
    }
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
    uses: BTreeMap<String, ObjectUse>,
    ancestors: Vec<AstKind<'a>>,
    /// Style-value rules (see `style_object_uses`) instead of a facade's.
    style: bool,
    /// (stored object, the `const` object it is stored in).
    containers: Vec<(String, String)>,
    /// The module's static values, which say whether a member handed on is
    /// an object; `None` outside style mode.
    statics: Option<&'s FxHashMap<String, Value>>,
    /// See `StyleObjectFacts::derives`.
    derives: Vec<(String, String)>,
    /// See `StyleObjectFacts::handoffs`.
    handoffs: Vec<Handoff>,
    /// See `StyleObjectFacts::flat_reads`.
    flat_reads: Vec<(String, ObjectUse)>,
}

impl ObjectUseScan<'_, '_> {
    /// The 1-based line `span` starts on.
    fn line(&self, span: Span) -> usize {
        let start = (span.start as usize).min(self.source.len());
        self.source[..start].matches('\n').count() + 1
    }
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
        let Some(binding) = self.candidates.get(&symbol) else { return };
        if !reference.is_value() {
            return;
        }
        if self.style {
            let (key, what) = if binding.namespace {
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
                            StyleUse::StoredIn(_) => (key, "is stored in an object".to_string()),
                            StyleUse::Unsafe(what)
                            | StyleUse::MemberHandoff(_, what)
                            | StyleUse::Handoff { what, .. } => (key, what),
                        }
                    }
                    _ => (binding.name.clone(), "is used as a whole namespace".to_string()),
                }
            } else {
                let containers: FxHashSet<String> =
                    self.candidates.values().filter(|b| !b.namespace).map(|b| b.name.clone()).collect();
                let derived = initializing_const(&self.ancestors).filter(|name| name != &binding.name);
                if let Some(derived) = &derived {
                    self.derives.push((derived.clone(), binding.name.clone()));
                }
                match style_object_use(ident.span, &self.ancestors, &containers, self.global_object) {
                    StyleUse::Read => return,
                    StyleUse::StoredIn(container) => {
                        self.containers.push((binding.name.clone(), container));
                        return;
                    }
                    StyleUse::FlatRead(what) => {
                        self.flat_reads.push((binding.name.clone(), ObjectUse { line: Some(self.line(ident.span)), what }));
                        return;
                    }
                    StyleUse::Unsafe(what) => (binding.name.clone(), what),
                    StyleUse::Handoff { what, reference, .. } if !fixed_callee(self.scoping, reference) => {
                        (binding.name.clone(), what)
                    }
                    StyleUse::Handoff { callee, index, what, .. } => {
                        self.handoffs.push(Handoff {
                            binding: binding.name.clone(),
                            callee,
                            index,
                            used: ObjectUse { line: Some(self.line(ident.span)), what },
                        });
                        return;
                    }
                    StyleUse::MemberHandoff(path, what) => {
                        // A primitive member handed on cannot change the object.
                        let primitive = path.zip(self.statics).and_then(|(path, statics)| {
                            let mut value = statics.get(&binding.name)?;
                            for segment in &path {
                                value = value.get(segment)?;
                            }
                            Some(!value.is_object() && !value.is_array())
                        });
                        if primitive == Some(true) {
                            return;
                        }
                        (binding.name.clone(), what)
                    }
                }
            };
            if self.uses.contains_key(&key) {
                return;
            }
            let line = self.line(ident.span);
            self.uses.insert(key, ObjectUse { line: Some(line), what });
            return;
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
            let (span, parent) = peel_wrappers(ident.span, &mut ancestors);
            match parent {
                Some(AstKind::JSXMemberExpression(_)) => return,
                Some(AstKind::StaticMemberExpression(member)) if member.object.span() == span => {
                    let key = format!("{}.{}", binding.name, member.property.name);
                    if self.uses.contains_key(&key) {
                        return;
                    }
                    let what = object_use(member.span, ancestors, false, self.global_object, false);
                    (key, what)
                }
                _ => (binding.name.clone(), Some("is used as a whole namespace".to_string())),
            }
        } else {
            if self.uses.contains_key(&binding.name)
                || (binding.facade && top_level_write(ident.span, &self.ancestors))
            {
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
                Some("assign" | "freeze" | "keys" | "values" | "entries") => None,
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
    mut ancestors: impl Iterator<Item = &'b AstKind<'a>>,
) -> Option<String> {
    let (current, parent) = peel_wrappers(span, &mut ancestors);
    let assigned = || Some(format!("has {noun} assigned"));
    match parent? {
        AstKind::AssignmentExpression(assignment) if assignment.left.span() == current => assigned(),
        AstKind::UpdateExpression(_)
        | AstKind::ArrayAssignmentTarget(_)
        | AstKind::AssignmentTargetRest(_)
        | AstKind::AssignmentTargetWithDefault(_)
        | AstKind::AssignmentTargetPropertyProperty(_) => assigned(),
        AstKind::ForInStatement(statement) if statement.left.span() == current => assigned(),
        AstKind::ForOfStatement(statement) if statement.left.span() == current => assigned(),
        AstKind::UnaryExpression(unary)
            if unary.operator == oxc::syntax::operator::UnaryOperator::Delete =>
        {
            Some(format!("has {noun} deleted"))
        }
        AstKind::CallExpression(call) if call.callee.span() == current => {
            Some(format!("has {noun} called as a method"))
        }
        AstKind::TaggedTemplateExpression(tagged) if tagged.tag.span() == current => {
            Some(format!("has {noun} called as a method"))
        }
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
/// elements. A wrapper binding may be used only as a JSX tag name, and is
/// never reassigned; its spread parameter may be used only as a whole JSX
/// spread argument or a read of one of its members that is no call.
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
                },
            ))
        })
        .collect()
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
    ancestors: Vec<AstKind<'a>>,
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
            let tag = matches!(
                ancestors.next(),
                Some(AstKind::JSXOpeningElement(_) | AstKind::JSXClosingElement(_))
            );
            if !tag {
                self.invalid.insert(index);
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
        let Some(&index) = self.spreads.get(&symbol) else { return };
        if !reference.is_value() {
            return;
        }
        match ancestors.next() {
            Some(AstKind::JSXSpreadAttribute(spread)) if spread.argument.span() == ident.span => {
                let Some(AstKind::JSXOpeningElement(element)) = ancestors.next() else {
                    self.invalid.insert(index);
                    return;
                };
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
                if let (1, Some(tag)) = (spreads, tag) {
                    self.forwarding
                        .entry(index)
                        .or_default()
                        .push(((element.span.start, element.span.end), tag));
                }
            }
            // A read of one member (`props.title`), never written or called.
            Some(AstKind::StaticMemberExpression(member))
                if member.object.span() == ident.span
                    && !reference.flags().is_member_write_target()
                    && !reference.is_write()
                    && !matches!(ancestors.next(), Some(AstKind::CallExpression(call))
                        if call.callee.span() == member.span) => {}
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
            Some(AstKind::ExportNamedDeclaration(_)) => {
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
    static_values: &'s FxHashMap<String, Value>,
    scoping: Option<&'s Scoping>,
    enrich: bool,
    /// What calls React's `createElement` and `cloneElement`.
    react: ReactNames,
    /// Enriched collection only: the file's bindings and source, for
    /// `cloneElement` calls.
    clones: Option<CloneScan<'a, 's>>,
    /// Enriched collection only: the modules the file loads at runtime.
    module_loads: Option<Vec<ModuleLoad>>,
    /// Enriched collection only: the scopes a tag's origin is read from.
    origins: Option<&'s Scoping>,
    /// Enriched collection only: the values a parameter's literal-union type
    /// annotation admits.
    finite_params: FxHashMap<SymbolId, FiniteSet>,
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
    fn record_element(&mut self, elem: &JSXOpeningElement<'a>) {
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
        let origin = self.origins.zip(root).map(|(scoping, root)| tag_origin(scoping, root));
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
                                literal = without_absent_entries(object, &FxHashMap::default(), None, self.origins)
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
                });
            }
        }
        self.facts.push(UsageFact::Element {
            tag,
            attrs,
            spread,
            span: (elem.span.start, elem.span.end),
            origin,
        });
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
            Statement::ExportNamedDeclaration(export) => export.declaration.as_ref(),
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
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        self.record_element(elem);
        // An attribute value can hold JSX too, which is a use like a child.
        oxc::ast_visit::walk::walk_jsx_opening_element(self, elem);
    }

    fn visit_variable_declarator(&mut self, declarator: &oxc::ast::ast::VariableDeclarator<'a>) {
        if let Some(clones) = &mut self.clones {
            if let (
                oxc::ast::ast::VariableDeclarationKind::Const,
                oxc::ast::ast::BindingPattern::BindingIdentifier(id),
                Some(init),
            ) = (declarator.kind, &declarator.id, &declarator.init)
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

    fn visit_import_expression(&mut self, import: &oxc::ast::ast::ImportExpression<'a>) {
        self.record_loads(import.span, vec![load_of(&import.source)], true);
        oxc::ast_visit::walk::walk_import_expression(self, import);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        self.record_loads(call.span, call_loads(call), false);
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
                    clone: false,
                    at: call.span.start,
                    origin: self.origins.zip(root).map(|(scoping, root)| tag_origin(scoping, root)),
                });
            }
        } else if self.react.calls(&call.callee, "cloneElement") {
            self.record_clone(call);
        }
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }
}

impl<'a> FactCollector<'a, '_> {
    /// Records one call's module loads with its line and spelling.
    fn record_loads(&mut self, span: oxc::span::Span, targets: Vec<LoadTarget>, dynamic_import: bool) {
        let (Some(loads), Some(clones)) = (&mut self.module_loads, &self.clones) else {
            return;
        };
        if targets.is_empty() {
            return;
        }
        let line = clones.source[..span.start as usize].matches('\n').count() + 1;
        let call = clones.source[span.start as usize..span.end as usize]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        loads.extend(targets.into_iter().map(|target| ModuleLoad {
            target,
            dynamic_import,
            line,
            call: call.clone(),
        }));
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
fn static_member_root<'b, 'a>(
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
            Statement::ExportNamedDeclaration(export) => export.declaration.as_ref(),
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

    fn from_imports(program: &Program<'_>, scoping: &Scoping) -> Self {
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
    fn calls(&self, callee: &Expression<'_>, function: &str) -> bool {
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
    let static_values = FxHashMap::default();
    let mut collector = FactCollector {
        facts: Vec::new(),
        static_values: &static_values,
        scoping: None,
        enrich: false,
        react: ReactNames::by_name(),
        clones: None,
        module_loads: None,
        origins: None,
        finite_params: FxHashMap::default(),
    };
    collector.visit_program(program);
    collector.finish()
}

pub fn collect_usage_facts_with_statics(
    program: &Program<'_>,
    module: &ModuleRecord<'_>,
    static_values: &FxHashMap<String, Value>,
) -> Vec<UsageFact> {
    collect_enriched_usage(program, module, static_values, &[], &[], &BTreeMap::new(), &BTreeSet::new()).usage
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
    static_values: &FxHashMap<String, Value>,
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

/// The literals `expression` may evaluate to that carry `!important`, in
/// either spelling: each branch of a conditional or logical expression, and
/// each entry of a responsive object, that evaluates statically. An entry
/// keeps its breakpoint, as a runtime entry's lookup spells it.
fn important_literals(
    expression: &Expression<'_>,
    static_values: &FxHashMap<String, Value>,
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
    member_expr_bindings: &'m FxHashMap<String, String>,
) -> Option<(&'m str, Option<String>)> {
    match tag {
        TagFact::Ident(name) => Some((name.as_str(), None)),
        TagFact::Member(key) => member_expr_bindings
            .get(key)
            .map(|b| (b.as_str(), Some(b.clone()))),
    }
}

/// How a file's spread wrappers stand in for their targets in the filters:
/// each wrapper tag is published as its targets, and these say what its
/// renders and forwarding elements contribute.
#[derive(Debug, Default)]
pub struct WrapperProxies {
    /// Wrapper tag → one lookup key per path to its targets, with the props
    /// that path drops. A render records once per path, so a prop one path
    /// drops still reaches the targets another path spreads it into.
    pub paths: FxHashMap<String, Vec<(String, FxHashSet<String>)>>,
    /// Opening-element spans of forwarding elements: their spread carries
    /// exactly the wrapper's renders, so it opens nothing itself.
    pub forwarding: FxHashSet<(u32, u32)>,
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
            TagFact::Ident(name) if self.paths.contains_key(name) => self.paths[name]
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
            settled |= spread.is_none_or(|before| index >= before);
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
    proxies: &WrapperProxies,
) -> UsageScanResult {
    let mut seen = FxHashSet::default();
    let mut fully_open = FxHashSet::default();
    let mut result = UsageScanResult::default();

    for fact in facts {
        match fact {
            UsageFact::Element { tag, attrs, spread, span, origin } => {
                let uncertain = |result: &mut UsageScanResult, name: &str| {
                    result.identity_uncertain = true;
                    result.uncertain_tags.push(UncertainTag {
                        tag: Some(name.to_string()),
                        create_element: false,
                        origin: *origin,
                        at: span.0,
                    });
                };
                let Some((tag_name, resolved_binding)) = resolve_tag(tag, member_expr_bindings)
                else {
                    if let TagFact::Member(path) = tag {
                        uncertain(&mut result, path);
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
                    if spread.is_some() {
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
                    // renders, which are recorded at the render.
                    if let Some(config) = component_configs
                        .get(tag_name)
                        .filter(|_| !proxies.forwarding.contains(span))
                    {
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
            }
            UsageFact::CreateElement {
                ident,
                member,
                identity_uncertain,
                props,
                literals,
                clone,
                at,
                origin,
            } => {
                let uncertain = |result: &mut UsageScanResult, tag: Option<&String>| {
                    result.identity_uncertain = true;
                    result.uncertain_tags.push(UncertainTag {
                        tag: tag.cloned(),
                        create_element: true,
                        origin: *origin,
                        at: *at,
                    });
                };
                let resolved: Option<String> = if let Some(name) = ident {
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
                    result.open_components.insert(binding.clone());
                    // Literal system props take their static classes as a
                    // JSX attribute's do; the open component keeps its slots.
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
                            if seen.insert(dedup_key) {
                                result.system_prop_usages.push(SystemPropUsage {
                                    prop_name: prop_name.clone(),
                                    value: value.clone(),
                                    binding: binding.clone(),
                                });
                            }
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
        let statics = crate::eval::collect_complete_static_values(program);
        let facts = collect_usage_facts_with_statics(program, ast.module_record(), &statics);
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
        let statics = crate::eval::collect_complete_static_values(ast.program());
        let raw = collect_usage_facts(ast.program());
        let enriched = collect_usage_facts_with_statics(ast.program(), ast.module_record(), &statics);

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

