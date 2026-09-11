//! Variant/state/system-prop usage tracking across JSX: which declared
//! variants and states are exercised, the input the reconciler prunes.

use std::marker::PhantomData;

use rustc_hash::{FxHashMap, FxHashSet};

use oxc::ast::ast::{
    Argument, CallExpression, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
    JSXElementName, JSXExpression, JSXMemberExpression, JSXOpeningElement, Program,
};
use oxc::ast_visit::Visit;

use super::value_eval::eval_jsx_attribute_value;
use super::{DynamicPropUsage, PropValueResult, SystemPropUsage, UsageResidueSite};

#[derive(Debug, Clone, Default)]
pub struct ComponentUsageConfig {
    /// Variant prop name → (declared option names, default option).
    pub variants: FxHashMap<String, (FxHashSet<String>, Option<String>)>,
    pub states: FxHashSet<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VariantUsage {
    pub component_binding: String,
    pub variant_prop: String,
    /// A literal string, `"__dynamic__"` for a non-static value, or
    /// `"__default__"` when the prop is absent.
    pub value: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StateUsage {
    pub component_binding: String,
    pub state_name: String,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct UsageScanResult {
    pub system_prop_usages: Vec<SystemPropUsage>,
    pub dynamic_prop_usages: Vec<DynamicPropUsage>,
    pub residue_sites: Vec<UsageResidueSite>,
    pub variant_usages: Vec<VariantUsage>,
    pub state_usages: Vec<StateUsage>,
    pub rendered_components: FxHashSet<String>,
    /// A component-like tag was rendered whose extracted binding could not
    /// be resolved. Internal reachability signal.
    #[serde(skip)]
    pub identity_uncertain: bool,
}

pub(crate) fn is_component_like_identifier(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}

/// Scan JSX for system prop values and variant/state/component usage.
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

        self.result.rendered_components.insert(binding.clone());

        let active_props = self.component_props.get(tag);

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
        // Attributes are handled here, so the element walk is not called.
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
                let resolved: Option<String> = match first_arg {
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
                    // May be a component, but not attributable.
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

        oxc::ast_visit::walk::walk_call_expression(self, call);
    }
}

/// Classify a present JSX attribute value for variant tracking: a string
/// literal yields its string, every other form yields `"__dynamic__"`.
pub(crate) fn classify_jsx_attribute_as_variant_value(value: &Option<JSXAttributeValue>) -> String {
    match value {
        // `<Button variant />` carries no string option to match.
        None => "__dynamic__".to_string(),

        Some(JSXAttributeValue::StringLiteral(lit)) => lit.value.to_string(),

        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match &container.expression {
                JSXExpression::StringLiteral(lit) => lit.value.to_string(),
                _ => "__dynamic__".to_string(),
            }
        }

        Some(JSXAttributeValue::Element(_)) | Some(JSXAttributeValue::Fragment(_)) => {
            "__dynamic__".to_string()
        }
    }
}

/// Resolve `Family.Slot` to the extracted component binding via the member
/// expression map. Single-level only; `None` when unresolvable.
pub(super) fn resolve_jsx_member_expr<'a>(
    member: &JSXMemberExpression,
    member_expr_bindings: &'a FxHashMap<String, String>,
) -> Option<&'a String> {
    // get_identifier() returns the root identifier, so `NavBar.Root` yields
    // `NavBar`; `this.Root` and deeper chains yield None or the root.
    let root_ident = member.get_identifier()?;
    let object_name = root_ident.name.as_str();
    let slot_name = member.property.name.as_str();
    let dotted_key = format!("{}.{}", object_name, slot_name);
    member_expr_bindings.get(&dotted_key)
}
