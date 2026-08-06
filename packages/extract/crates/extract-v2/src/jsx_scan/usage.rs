//! Variant/state/system-prop usage tracking across JSX.
//!
//! Split out of `jsx_scan.rs` unchanged. Where `system_props` answers "which
//! system props were set", this answers "which declared variants and states
//! were actually exercised" — the input the reconciler prunes against.

use std::marker::PhantomData;

use rustc_hash::{FxHashMap, FxHashSet};

use oxc::ast::ast::{
    Argument, CallExpression, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
    JSXElementName, JSXExpression, JSXMemberExpression, JSXOpeningElement, Program,
};
use oxc::ast_visit::Visit;

use super::value_eval::eval_jsx_attribute_value;
use super::{DynamicPropUsage, PropValueResult, SystemPropUsage, UsageResidueSite};

/// Information about a component's variant/state configuration for usage tracking
#[derive(Debug, Clone, Default)]
pub struct ComponentUsageConfig {
    /// Map of variant prop name → (set of option names, optional default)
    pub variants: FxHashMap<String, (FxHashSet<String>, Option<String>)>,
    /// Set of state prop names
    pub states: FxHashSet<String>,
}

/// Variant usage found at a JSX callsite
#[derive(Debug, Clone, serde::Serialize)]
pub struct VariantUsage {
    pub component_binding: String,
    pub variant_prop: String,
    /// The value: a literal string, "__dynamic__" for non-static, "__default__" for prop absence
    pub value: String,
}

/// State usage found at a JSX callsite
#[derive(Debug, Clone, serde::Serialize)]
pub struct StateUsage {
    pub component_binding: String,
    pub state_name: String,
}

/// Complete usage scan results from one file
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct UsageScanResult {
    pub system_prop_usages: Vec<SystemPropUsage>,
    pub dynamic_prop_usages: Vec<DynamicPropUsage>,
    pub residue_sites: Vec<UsageResidueSite>,
    pub variant_usages: Vec<VariantUsage>,
    pub state_usages: Vec<StateUsage>,
    pub rendered_components: FxHashSet<String>,
    /// A component-like tag was rendered, but its canonical extracted
    /// component binding could not be resolved. Internal reachability signal;
    /// it is not part of the serialized usage contract.
    #[serde(skip)]
    pub identity_uncertain: bool,
}

pub(crate) fn is_component_like_identifier(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}

// ---------------------------------------------------------------------------
// Usage scanning — public entry point
// ---------------------------------------------------------------------------

/// Scan JSX elements for system prop values AND variant/state/component usage.
/// This is an extended version of scan_jsx that also tracks behavioral usage.
///
/// `component_configs` maps binding name → ComponentUsageConfig (variant/state info)
/// `component_props` maps binding name → active system prop names (same as scan_jsx)
pub fn scan_jsx_usage<'a>(
    program: &Program<'a>,
    component_props: &FxHashMap<String, FxHashSet<String>>,
    component_configs: &FxHashMap<String, ComponentUsageConfig>,
    member_expr_bindings: &FxHashMap<String, String>,
) -> UsageScanResult {
    let mut scanner = UsageScanner {
        component_props,
        component_configs,
        member_expr_bindings,
        seen: FxHashSet::default(),
        result: UsageScanResult::default(),
        _phantom: PhantomData,
    };
    scanner.visit_program(program);
    scanner.result
}

// ---------------------------------------------------------------------------
// UsageScanner — Visit-based JSX scanner for variant/state/system prop usage
// ---------------------------------------------------------------------------

struct UsageScanner<'a, 'b> {
    component_props: &'b FxHashMap<String, FxHashSet<String>>,
    component_configs: &'b FxHashMap<String, ComponentUsageConfig>,
    member_expr_bindings: &'b FxHashMap<String, String>,
    seen: FxHashSet<String>,
    result: UsageScanResult,
    _phantom: PhantomData<&'a ()>,
}

impl<'a, 'b> Visit<'a> for UsageScanner<'a, 'b> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        let (tag, resolved_binding) = match &elem.name {
            JSXElementName::Identifier(id) => (id.name.as_str(), None),
            JSXElementName::IdentifierReference(id) => (id.name.as_str(), None),
            JSXElementName::MemberExpression(member) => {
                match resolve_jsx_member_expr(member, self.member_expr_bindings) {
                    Some(binding) => (binding.as_str(), Some(binding.clone())),
                    None => {
                        self.result.identity_uncertain = true;
                        return;
                    }
                }
            }
            _ => return,
        };

        let has_props = self.component_props.contains_key(tag);
        let has_config = self.component_configs.contains_key(tag);

        if !has_props && !has_config {
            if is_component_like_identifier(tag) {
                self.result.identity_uncertain = true;
            }
            return;
        }

        let binding = resolved_binding.unwrap_or_else(|| tag.to_string());

        // Track that this component was rendered
        self.result.rendered_components.insert(binding.clone());

        // Gather active system props for this component (if any)
        let active_props = self.component_props.get(tag);

        // Track which variant props have been seen (for absence detection)
        let mut seen_variant_props: FxHashSet<String> = FxHashSet::default();

        for attr_item in &elem.attributes {
            match attr_item {
                JSXAttributeItem::Attribute(attr) => {
                    let attr_name: Option<&str> = match &attr.name {
                        JSXAttributeName::Identifier(id) => Some(id.name.as_str()),
                        JSXAttributeName::NamespacedName(_) => None,
                    };

                    let Some(prop_name) = attr_name else {
                        continue;
                    };

                    // --- System prop collection ---
                    if let Some(props) = active_props {
                        if props.contains(prop_name) {
                            match eval_jsx_attribute_value(&attr.value) {
                                PropValueResult::Static(value) => {
                                    let dedup_key = format!(
                                        "{}:{}",
                                        prop_name,
                                        serde_json::to_string(&value)
                                            .unwrap_or_else(|_| "null".to_string())
                                    );
                                    if self.seen.insert(dedup_key) {
                                        self.result.system_prop_usages.push(SystemPropUsage {
                                            prop_name: prop_name.to_string(),
                                            value,
                                            binding: binding.clone(),
                                        });
                                    }
                                }
                                PropValueResult::Dynamic { kind, span } => {
                                    self.result.residue_sites.push(UsageResidueSite {
                                        binding: binding.clone(),
                                        prop_name: prop_name.to_string(),
                                        kind,
                                        span,
                                    });
                                    let dedup_key = format!("__dynamic__:{}", prop_name);
                                    if self.seen.insert(dedup_key) {
                                        self.result.dynamic_prop_usages.push(DynamicPropUsage {
                                            prop_name: prop_name.to_string(),
                                            binding: binding.clone(),
                                        });
                                    }
                                }
                                PropValueResult::Skip => {}
                            }
                        }
                    }

                    // --- Variant and state collection ---
                    if let Some(config) = self.component_configs.get(tag) {
                        if config.variants.contains_key(prop_name) {
                            seen_variant_props.insert(prop_name.to_string());

                            let variant_value =
                                classify_jsx_attribute_as_variant_value(&attr.value);
                            self.result.variant_usages.push(VariantUsage {
                                component_binding: binding.clone(),
                                variant_prop: prop_name.to_string(),
                                value: variant_value,
                            });
                        }

                        if config.states.contains(prop_name) {
                            self.result.state_usages.push(StateUsage {
                                component_binding: binding.clone(),
                                state_name: prop_name.to_string(),
                            });
                        }
                    }
                }
                JSXAttributeItem::SpreadAttribute(_) => {}
            }
        }

        // Detect absent variant props — emit __default__ for each unseen variant prop
        if let Some(config) = self.component_configs.get(tag) {
            for variant_prop in config.variants.keys() {
                if !seen_variant_props.contains(variant_prop) {
                    self.result.variant_usages.push(VariantUsage {
                        component_binding: binding.clone(),
                        variant_prop: variant_prop.clone(),
                        value: "__default__".to_string(),
                    });
                }
            }
        }
        // Do NOT call walk_jsx_opening_element — we processed attributes ourselves.
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        // Recognize `createElement(Component, ...)` and `React.createElement(Component, ...)`
        // as component render usage, parity with JSX-element and JSX-member-expression paths.
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
                let resolved: Option<String> = match first_arg {
                    // Bare identifier: createElement(Component, ...) — resolve against the
                    // active binding maps the same way JSX tags do.
                    Argument::Identifier(id) => {
                        let name = id.name.as_str();
                        if self.component_props.contains_key(name)
                            || self.component_configs.contains_key(name)
                        {
                            Some(name.to_string())
                        } else {
                            self.result.identity_uncertain = true;
                            None
                        }
                    }
                    // Member expression: createElement(Family.Slot, ...) — dotted-key lookup
                    // matches the JSX `<Family.Slot>` resolution path.
                    Argument::StaticMemberExpression(member) => {
                        let resolved = match &member.object {
                            Expression::Identifier(obj) => {
                                let dotted_key = format!(
                                    "{}.{}",
                                    obj.name.as_str(),
                                    member.property.name.as_str()
                                );
                                self.member_expr_bindings.get(&dotted_key).cloned()
                            }
                            _ => None,
                        };
                        if resolved.is_none() {
                            self.result.identity_uncertain = true;
                        }
                        resolved
                    }
                    // String literal → native DOM element, no render tracking.
                    Argument::StringLiteral(_) => None,
                    // Any other form (call, conditional, template, etc.) is
                    // component-like but cannot be attributed safely.
                    _ => {
                        self.result.identity_uncertain = true;
                        None
                    }
                };

                if let Some(binding) = resolved {
                    self.result.rendered_components.insert(binding);
                }
            }
        }

        // Continue walking into arguments so nested createElement / JSX children are visited.
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }
}

// ---------------------------------------------------------------------------
// Variant value classifier
// ---------------------------------------------------------------------------

/// Classify a JSX attribute value for variant tracking.
///
/// - String literal (bare or `{...}`) → return the string
/// - Any non-static expression (identifier, call, conditional, etc.) → "__dynamic__"
/// - Absent value (bare boolean prop like `<Foo variant />`) → "__dynamic__" (treat as non-static)
///
/// Note: absent variant props are handled separately via absence detection after the attribute loop.
/// This function only classifies a present attribute's value.
pub(crate) fn classify_jsx_attribute_as_variant_value(value: &Option<JSXAttributeValue>) -> String {
    match value {
        // Bare attribute with no value: `<Button variant />` — not a meaningful variant value;
        // treat as dynamic since there's no string option to match.
        None => "__dynamic__".to_string(),

        Some(JSXAttributeValue::StringLiteral(lit)) => lit.value.to_string(),

        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match &container.expression {
                JSXExpression::StringLiteral(lit) => lit.value.to_string(),
                // Any non-static form → dynamic
                _ => "__dynamic__".to_string(),
            }
        }

        // Element/fragment values — not a string option
        Some(JSXAttributeValue::Element(_)) | Some(JSXAttributeValue::Fragment(_)) => {
            "__dynamic__".to_string()
        }
    }
}

// ---------------------------------------------------------------------------
// Member expression resolution — map Family.Slot → original binding
// ---------------------------------------------------------------------------

/// Resolve a JSX member expression (e.g., `NavBar.Root`) to the original
/// component binding name (e.g., `NavBarRoot`) via the member expression map.
///
/// Only handles single-level member expressions (Family.Slot), not nested
/// chains (a.b.c). Returns `None` for unresolvable expressions.
pub(super) fn resolve_jsx_member_expr<'a>(
    member: &JSXMemberExpression,
    member_expr_bindings: &'a FxHashMap<String, String>,
) -> Option<&'a String> {
    // get_identifier() walks nested member expressions to find the root IdentifierReference.
    // For single-level `NavBar.Root`, returns `NavBar`.
    // For `this.Root` or deeply nested chains, returns None or the root identifier.
    let root_ident = member.get_identifier()?;
    let object_name = root_ident.name.as_str();
    let slot_name = member.property.name.as_str();
    let dotted_key = format!("{}.{}", object_name, slot_name);
    member_expr_bindings.get(&dotted_key)
}
