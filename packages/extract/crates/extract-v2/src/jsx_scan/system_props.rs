//! Visit-based JSX scanner for system prop usages: opening elements match
//! component bindings by name, and each active prop is recorded.

use std::marker::PhantomData;

use rustc_hash::{FxHashMap, FxHashSet};

use oxc::ast::ast::{
    JSXAttributeItem, JSXAttributeName, JSXElementName, JSXOpeningElement, Program,
};
use oxc::ast_visit::Visit;

use super::usage::resolve_jsx_member_expr;
use super::value_eval::eval_jsx_attribute_value;
use super::{CustomPropScanResult, DynamicPropUsage, PropValueResult, SystemPropUsage};

/// Scan JSX for system prop usages. Static usages dedupe on prop and value,
/// dynamic usages on binding and prop.
pub fn scan_jsx<'a>(
    program: &Program<'a>,
    component_props: &FxHashMap<String, FxHashSet<String>>,
    member_expr_bindings: &FxHashMap<String, String>,
) -> CustomPropScanResult {
    let mut scanner = SystemPropScanner {
        component_props,
        member_expr_bindings,
        seen: FxHashSet::default(),
        dynamic_seen: FxHashSet::default(),
        results: Vec::new(),
        dynamic_results: Vec::new(),
        _phantom: PhantomData,
    };
    scanner.visit_program(program);

    CustomPropScanResult {
        static_usages: scanner.results,
        dynamic_usages: scanner.dynamic_results,
    }
}

struct SystemPropScanner<'a, 'b> {
    component_props: &'b FxHashMap<String, FxHashSet<String>>,
    member_expr_bindings: &'b FxHashMap<String, String>,
    seen: FxHashSet<String>,
    dynamic_seen: FxHashSet<String>,
    results: Vec<SystemPropUsage>,
    dynamic_results: Vec<DynamicPropUsage>,
    _phantom: PhantomData<&'a ()>,
}

impl<'a, 'b> Visit<'a> for SystemPropScanner<'a, 'b> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        let (tag, resolved_binding) = match &elem.name {
            JSXElementName::Identifier(id) => (id.name.as_str(), None),
            JSXElementName::IdentifierReference(id) => (id.name.as_str(), None),
            JSXElementName::MemberExpression(member) => {
                match resolve_jsx_member_expr(member, self.member_expr_bindings) {
                    Some(binding) => (binding.as_str(), Some(binding.clone())),
                    None => return,
                }
            }
            _ => return,
        };

        let Some(active_props) = self.component_props.get(tag) else {
            return;
        };

        let binding = resolved_binding.unwrap_or_else(|| tag.to_string());

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

                    if !active_props.contains(prop_name) {
                        continue;
                    }

                    match eval_jsx_attribute_value(&attr.value) {
                        PropValueResult::Static(value) => {
                            let dedup_key = format!(
                                "{}:{}",
                                prop_name,
                                serde_json::to_string(&value)
                                    .unwrap_or_else(|_| "null".to_string())
                            );
                            if self.seen.insert(dedup_key) {
                                self.results.push(SystemPropUsage {
                                    prop_name: prop_name.to_string(),
                                    value,
                                    binding: binding.clone(),
                                });
                            }
                        }
                        PropValueResult::Dynamic { .. } => {
                            let dedup_key = format!("{}::{}", binding, prop_name);
                            if self.dynamic_seen.insert(dedup_key) {
                                self.dynamic_results.push(DynamicPropUsage {
                                    prop_name: prop_name.to_string(),
                                    binding: binding.clone(),
                                });
                            }
                        }
                        PropValueResult::Skip => {}
                    }
                }
                JSXAttributeItem::SpreadAttribute(_) => {}
            }
        }
        // Attributes are handled here; walk_jsx_opening_element is not called.
    }
}
