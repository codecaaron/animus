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
    Argument, CallExpression, Expression, ImportDeclarationSpecifier, JSXAttributeItem,
    JSXAttributeName, JSXElementName, JSXOpeningElement, Program, Statement,
};
use oxc::ast_visit::Visit;
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use serde_json::Value;
use std::marker::PhantomData;

use crate::jsx_scan::{
    classify_jsx_attribute_as_variant_value, eval_jsx_attribute_value, ComponentUsageConfig,
    CustomPropScanResult, DynamicPropUsage, PropValueResult, StateUsage, SystemPropUsage,
    UsageScanResult, VariantUsage,
};

/// AST-local classification of one attribute value, computed at collect
/// time (owned mirror of the scanner's PropValueResult + variant string).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttrFact {
    pub name: String,
    /// Static value when the attribute is statically evaluable.
    pub static_value: Option<Value>,
    /// True when the value is a non-static expression (dynamic slot).
    pub dynamic: bool,
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
    Element { tag: TagFact, attrs: Vec<AttrFact> },
    /// createElement(X, ...) / React.createElement(X, ...): the first
    /// argument as a raw name or dotted key (None = unattributable form).
    CreateElement { ident: Option<String>, member: Option<String> },
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

/// Per-file named-export fact (v1 import_resolver ExportInfo, minus the
/// re-export source — re-export following is a registered gap). Feeds
/// static-export enrichment (v1 Phase 2b) and keyframes local-binding
/// injection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFact {
    pub exported: String,
    /// Local binding name; None for pure re-exports (v1 ExportInfo shape —
    /// keeps static-export collection from matching a same-named local).
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
                    if let oxc::ast::ast::BindingPattern::BindingIdentifier(ident) =
                        &declarator.id
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

struct FactCollector<'a> {
    facts: Vec<UsageFact>,
    _phantom: PhantomData<&'a ()>,
}

impl<'a> Visit<'a> for FactCollector<'a> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        let tag = match &elem.name {
            JSXElementName::Identifier(id) => TagFact::Ident(id.name.to_string()),
            JSXElementName::IdentifierReference(id) => TagFact::Ident(id.name.to_string()),
            JSXElementName::MemberExpression(member) => {
                // Mirror resolve_jsx_member_expr's AST half: root identifier
                // + property → dotted key; unresolvable roots are skipped
                // exactly as the scanners skip them.
                let Some(root) = member.get_identifier() else { return };
                TagFact::Member(format!("{}.{}", root.name.as_str(), member.property.name.as_str()))
            }
            _ => return,
        };
        let mut attrs = Vec::new();
        for attr_item in &elem.attributes {
            if let JSXAttributeItem::Attribute(attr) = attr_item {
                let JSXAttributeName::Identifier(id) = &attr.name else { continue };
                let (static_value, dynamic, skip) = match eval_jsx_attribute_value(&attr.value) {
                    PropValueResult::Static(v) => (Some(v), false, false),
                    PropValueResult::Dynamic => (None, true, false),
                    PropValueResult::Skip => (None, false, true),
                };
                attrs.push(AttrFact {
                    name: id.name.to_string(),
                    static_value,
                    dynamic,
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
                let (ident, member) = match first_arg {
                    Argument::Identifier(id) => (Some(id.name.to_string()), None),
                    Argument::StaticMemberExpression(m) => match &m.object {
                        Expression::Identifier(obj) => (
                            None,
                            Some(format!("{}.{}", obj.name.as_str(), m.property.name.as_str())),
                        ),
                        _ => (None, None),
                    },
                    _ => (None, None),
                };
                self.facts.push(UsageFact::CreateElement { ident, member });
            }
        }
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }
}

/// The per-file collection pass: every candidate tag/call, classified,
/// component-agnostic. One read of the stored AST.
pub fn collect_usage_facts(program: &Program<'_>) -> Vec<UsageFact> {
    let mut c = FactCollector {
        facts: Vec::new(),
        _phantom: PhantomData,
    };
    c.visit_program(program);
    c.facts
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
        let UsageFact::Element { tag, attrs } = fact else { continue };
        let Some((tag_name, resolved_binding)) = resolve_tag(tag, member_expr_bindings) else {
            continue;
        };
        let Some(active_props) = component_props.get(tag_name) else { continue };
        let binding = resolved_binding.unwrap_or_else(|| tag_name.to_string());

        for attr in attrs {
            if !active_props.contains(&attr.name) {
                continue;
            }
            if let Some(value) = &attr.static_value {
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
            } else if attr.dynamic {
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
                    continue;
                };
                let has_props = component_props.contains_key(tag_name);
                let has_config = component_configs.contains_key(tag_name);
                if !has_props && !has_config {
                    continue;
                }
                let binding = resolved_binding.unwrap_or_else(|| tag_name.to_string());
                result.rendered_components.insert(binding.clone());

                let active_props = component_props.get(tag_name);
                let mut seen_variant_props: FxHashSet<String> = FxHashSet::default();

                for attr in attrs {
                    if let Some(props) = active_props {
                        if props.contains(&attr.name) {
                            if let Some(value) = &attr.static_value {
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
                            } else if attr.dynamic {
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
            UsageFact::CreateElement { ident, member } => {
                let resolved: Option<String> = if let Some(name) = ident {
                    if component_props.contains_key(name.as_str())
                        || component_configs.contains_key(name.as_str())
                    {
                        Some(name.clone())
                    } else {
                        None
                    }
                } else if let Some(key) = member {
                    member_expr_bindings.get(key).cloned()
                } else {
                    None
                };
                if let Some(binding) = resolved {
                    result.rendered_components.insert(binding);
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
                                    (
                                        opts.iter().map(|o| o.to_string()).collect(),
                                        None,
                                    ),
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

        let direct = scan_jsx_usage(program, component_props, component_configs, member_expr_bindings);
        let filtered =
            filter_usage_scan(&facts, component_props, component_configs, member_expr_bindings);
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
}
