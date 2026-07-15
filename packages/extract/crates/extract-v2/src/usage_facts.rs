//! Raw JSX usage FACTS + cross-file filtering as fact algebra — design (b)
//! of the D4 experiment (journal 2026-07-13 00:05).
//!
//! Collection is AST-local (one Visit inside the per-file pass; classifies
//! every attribute of every candidate tag with NO knowledge of which
//! components exist). Filtering reproduces the verbatim-ported scanners'
//! OUTCOMES from facts alone — proven by property tests below that compare
//! both paths on the same inputs. If filtering matches everywhere, no
//! stored `program()` is ever read after cross-file facts resolve, and
//! D4's falsification criterion fires.

use oxc::ast::ast::{
    Argument, CallExpression, Expression, IdentifierReference, ImportDeclarationSpecifier,
    JSXAttributeItem, JSXAttributeName, JSXElementName, JSXOpeningElement, Program, Statement,
};
use oxc::ast_visit::Visit;
use oxc::semantic::{Scoping, SemanticBuilder};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use serde_json::Value;
use std::marker::PhantomData;

use crate::jsx_scan::{
    classify_jsx_attribute_as_variant_value, eval_jsx_attribute_value,
    is_component_like_identifier, ComponentUsageConfig, CustomPropScanResult,
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

/// AST-local classification of one attribute value, computed at collect
/// time (owned mirror of the scanner's PropValueResult + variant string).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttrFact {
    pub name: String,
    /// Static value when the attribute is statically evaluable.
    pub static_value: Option<Value>,
    /// Statically known alternatives at a still-dynamic conditional or
    /// logical site. Each value fattens the ordinary utility-input stream.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub enumerable_values: Vec<Value>,
    /// True when the value is a non-static expression (dynamic slot).
    pub dynamic: bool,
    /// Machine-readable reason for a dynamic classification.
    pub dynamic_kind: Option<DynamicExpressionKind>,
    /// Byte span of the dynamic expression in its source file.
    pub dynamic_span: Option<UsageSpan>,
    /// True when the scanner would skip entirely (empty expressions etc.).
    pub skip: bool,
    /// classify_jsx_attribute_as_variant_value output (string or
    /// "__dynamic__"), used by variant tracking.
    pub variant_class: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TagFact {
    /// `<Name ...>` — raw identifier.
    Ident(String),
    /// `<Root.Slot ...>` — dotted key, resolved against member-expr
    /// bindings at FILTER time.
    Member(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UsageFact {
    Element {
        tag: TagFact,
        attrs: Vec<AttrFact>,
    },
    /// createElement(X, ...) / React.createElement(X, ...): the first
    /// argument as a raw name or dotted key (None = unattributable form).
    CreateElement {
        ident: Option<String>,
        member: Option<String>,
        #[serde(skip)]
        identity_uncertain: bool,
    },
}

/// Per-file import specifier fact: v1's Phase-5b augments usage maps by
/// LOCAL alias, matching the IMPORTED name against the global map by NAME
/// (no re-export following — bug-compatible; the aliased-reexport corpus
/// unit witnesses that v1 does NOT follow export chains for usage maps).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFact {
    pub local: String,
    pub imported: String,
    pub source: String,
}

/// Collect named-import facts (top-level statements; AST-local).
pub fn collect_import_facts(program: &Program<'_>) -> Vec<ImportFact> {
    let mut out = Vec::new();
    for stmt in &program.body {
        if let Statement::ImportDeclaration(import) = stmt {
            if let Some(specifiers) = &import.specifiers {
                for spec in specifiers {
                    match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            out.push(ImportFact {
                                local: named.local.name.to_string(),
                                imported: named.imported.name().to_string(),
                                source: import.source.value.to_string(),
                            });
                        }
                        // v1 import_resolver records default imports as
                        // imported_name "default" (import_resolver 97-104)
                        // — extension provenance needs them so a
                        // default-imported parent resolves to a dangling
                        // `file::default` root and the child is kept
                        // STANDALONE (inc-07 review F3). "default" never
                        // matches a component name, so the Phase-5b alias
                        // augmentation is unaffected.
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                            out.push(ImportFact {
                                local: def.local.name.to_string(),
                                imported: "default".to_string(),
                                source: import.source.value.to_string(),
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

/// Per-file named-export fact (v1 import_resolver ExportInfo). Feeds
/// static-export enrichment (v1 Phase 2b), keyframes local-binding
/// injection, and re-export chain following (source/original).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFact {
    pub exported: String,
    /// Local binding name; None for pure re-exports (v1 ExportInfo shape —
    /// keeps static-export collection from matching a same-named local;
    /// re-export chains are FOLLOWED at row 13 via source/original).
    pub local: Option<String>,
    /// Re-export source specifier (`export { X } from './x'`).
    pub source: Option<String>,
    /// The ORIGINAL name at the source for re-exports (`X` in
    /// `export { X as Y } from './x'`); None for local exports.
    pub original: Option<String>,
}

/// Collect named-export facts (top-level statements; AST-local).
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
                // Mirror resolve_jsx_member_expr's AST half: root identifier
                // + property → dotted key; unresolvable roots are skipped
                // exactly as the scanners skip them.
                let Some(root) = member.get_identifier() else {
                    return;
                };
                TagFact::Member(format!(
                    "{}.{}",
                    root.name.as_str(),
                    member.property.name.as_str()
                ))
            }
            _ => return,
        };
        let mut attrs = Vec::new();
        for attr_item in &elem.attributes {
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
        self.facts.push(UsageFact::Element { tag, attrs });
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
                });
            }
        }
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }
}

/// The per-file collection pass: every candidate tag/call, classified,
/// component-agnostic. One read of the stored AST.
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
    let scoping = (!static_values.is_empty()).then(|| {
        SemanticBuilder::new()
            .build(program)
            .semantic
            .into_scoping()
    });
    let mut c = FactCollector {
        facts: Vec::new(),
        static_values,
        scoping: scoping.as_ref(),
        enrich: true,
        _phantom: PhantomData,
    };
    c.visit_program(program);
    c.facts
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

/// Static values are keyed by project-level names, so an expression may use
/// one only when OXC resolves that reference to the same root binding. This
/// prevents a parameter or local declaration from borrowing the value of a
/// shadowed top-level const/import merely because the spellings match.
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

/// Fact-algebra mirror of the ported `scan_jsx` (custom-prop scan).
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
        let UsageFact::Element { tag, attrs } = fact else {
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
                let dedup_key = format!(
                    "{}:{}",
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

/// Fact-algebra mirror of the ported `scan_jsx_usage` (extended scan).
pub fn filter_usage_scan(
    facts: &[UsageFact],
    component_props: &FxHashMap<String, FxHashSet<String>>,
    component_configs: &FxHashMap<String, ComponentUsageConfig>,
    member_expr_bindings: &FxHashMap<String, String>,
) -> UsageScanResult {
    let mut seen = FxHashSet::default();
    let mut result = UsageScanResult::default();

    for fact in facts {
        match fact {
            UsageFact::Element { tag, attrs } => {
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
                let mut seen_variant_props: FxHashSet<String> = FxHashSet::default();

                for attr in attrs {
                    if let Some(props) = active_props {
                        if props.contains(&attr.name) {
                            for value in attr
                                .static_value
                                .iter()
                                .chain(attr.enumerable_values.iter())
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
                            seen_variant_props.insert(attr.name.clone());
                            result.variant_usages.push(VariantUsage {
                                component_binding: binding.clone(),
                                variant_prop: attr.name.clone(),
                                value: attr.variant_class.clone(),
                            });
                        }
                        if config.states.contains(&attr.name) {
                            result.state_usages.push(StateUsage {
                                component_binding: binding.clone(),
                                state_name: attr.name.clone(),
                            });
                        }
                    }
                }

                if let Some(config) = component_configs.get(tag_name) {
                    for variant_prop in config.variants.keys() {
                        if !seen_variant_props.contains(variant_prop) {
                            result.variant_usages.push(VariantUsage {
                                component_binding: binding.clone(),
                                variant_prop: variant_prop.clone(),
                                value: "__default__".to_string(),
                            });
                        }
                    }
                }
            }
            UsageFact::CreateElement {
                ident,
                member,
                identity_uncertain,
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

    fn configs(
        entries: &[(&str, &[(&str, &[&str])], &[&str])],
    ) -> FxHashMap<String, ComponentUsageConfig> {
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

    /// The adjudicating property: the fact-algebra path must reproduce the
    /// verbatim-ported scanners' outputs on the same inputs, field by field.
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
