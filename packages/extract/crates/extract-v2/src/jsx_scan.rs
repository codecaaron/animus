//! JSX usage scan — v1 `jsx_scanner.rs` ported for the v2 spine
//! (increment 11, Task 11.3). BUG-COMPATIBILITY CONTRACT (design.md D3):
//! name-based component matching, createElement callee-name tracking,
//! member-expression (`<Family.Slot>`) maps, and the static/dynamic prop
//! classification replicate v1 OUTCOMES; v1's test module is carried
//! verbatim below as the executable contract. Runs as a second READ of the
//! stored AST inside the per-file pass (G1: zero parses added).
//!
//! Module layout — the public surface is unchanged; every `jsx_scan::X` path
//! resolves exactly as before:
//!
//!   `system_props` — Visit scanner for system prop usages (`scan_jsx`)
//!   `usage`        — variant/state usage tracking (`scan_jsx_usage`)
//!   `compose`      — compose() family detection (`scan_compose_calls`)
//!   `value_eval`   — static attribute-value evaluation (leaf)
//!
//! The result types stay here at the root: they are shared by more than one
//! scanner, so pushing them down would only create a cross-import.

use serde_json::Value;

mod compose;
mod system_props;
mod usage;
mod value_eval;

pub use compose::{scan_compose_calls, ComposeFamilyInfo};
pub use system_props::scan_jsx;
pub use usage::{
    scan_jsx_usage, ComponentUsageConfig, StateUsage, UsageScanResult, VariantUsage,
};

pub(crate) use usage::{classify_jsx_attribute_as_variant_value, is_component_like_identifier};
pub(crate) use value_eval::eval_jsx_attribute_value;

/// A system prop usage found in JSX.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemPropUsage {
    pub prop_name: String,
    pub value: Value,
    /// Which component binding this was found on. Retained for future per-component usage tracking.
    #[allow(dead_code)]
    pub binding: String,
}

/// A dynamic prop usage found in JSX — the prop received a non-static value
/// (identifier, call expression, conditional, etc.).
#[derive(Debug, Clone, serde::Serialize)]
pub struct DynamicPropUsage {
    pub prop_name: String,
    pub binding: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DynamicExpressionKind {
    Identifier,
    Member,
    Call,
    Conditional,
    Logical,
    Template,
    Binary,
    ResponsiveObjectDynamic,
    Array,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct UsageSpan {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct UsageResidueSite {
    pub binding: String,
    pub prop_name: String,
    pub kind: DynamicExpressionKind,
    pub span: UsageSpan,
}

/// Result of evaluating a JSX attribute value.
pub(crate) enum PropValueResult {
    /// Static literal value — extractable to utility class.
    Static(Value),
    /// Dynamic expression — triggers CSS variable slot generation.
    Dynamic {
        kind: DynamicExpressionKind,
        span: UsageSpan,
    },
    /// Skip entirely — spreads, empty expressions, non-prop attributes.
    Skip,
}

/// Result of scanning JSX for custom prop usages (static + dynamic).
pub struct CustomPropScanResult {
    pub static_usages: Vec<SystemPropUsage>,
    pub dynamic_usages: Vec<DynamicPropUsage>,
}

// ─── v1 jsx_scanner test module, ported VERBATIM as the bug-compatibility
// contract (design.md D3). Do not "fix" expectations — behavioral
// differences are register material. Source of truth:
// packages/extract/src/jsx_scanner.rs tests at the port date.
#[cfg(test)]
mod tests {
    use super::*;
    use rustc_hash::{FxHashMap, FxHashSet};
    use crate::owned_ast::{OwnedAst, ParseCounter};

    fn parse_tsx(source: &str) -> OwnedAst {
        let counter = ParseCounter::new(0);
        OwnedAst::parse("test.tsx".into(), source.to_string(), &counter)
    }

    macro_rules! map {
        ($( $key:expr => $val:expr ),* $(,)?) => {{
            let mut m = FxHashMap::default();
            $( m.insert($key.to_string(), $val); )*
            m
        }};
    }

    macro_rules! set {
        ($( $val:expr ),* $(,)?) => {{
            let mut s = FxHashSet::default();
            $( s.insert($val.to_string()); )*
            s
        }};
    }

    fn parse_and_scan(
        source: &str,
        component_props: FxHashMap<String, FxHashSet<String>>,
    ) -> Vec<SystemPropUsage> {
        let ast = parse_tsx(source);
        let result_program = ast.program();
        let empty = FxHashMap::default();
        scan_jsx(result_program, &component_props, &empty).static_usages
    }

    fn parse_and_scan_full(
        source: &str,
        component_props: FxHashMap<String, FxHashSet<String>>,
    ) -> CustomPropScanResult {
        let ast = parse_tsx(source);
        let result_program = ast.program();
        let empty = FxHashMap::default();
        scan_jsx(result_program, &component_props, &empty)
    }

    fn box_with_props(props: &[&str]) -> FxHashMap<String, FxHashSet<String>> {
        map! { "Box" => props.iter().map(|s| s.to_string()).collect() }
    }

    // ------------------------------------------------------------------
    // 1. Numeric prop
    // ------------------------------------------------------------------
    #[test]
    fn collects_numeric_prop() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box p={8} />;
            }
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "p");
        assert_eq!(usages[0].value, 8);
        assert_eq!(usages[0].binding, "Box");
    }

    // ------------------------------------------------------------------
    // 2. String prop (bare string attribute)
    // ------------------------------------------------------------------
    #[test]
    fn collects_string_prop() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box display="flex" />;
            }
            "#,
            box_with_props(&["display"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "display");
        assert_eq!(usages[0].value, "flex");
    }

    // ------------------------------------------------------------------
    // 3. Responsive object prop
    // ------------------------------------------------------------------
    #[test]
    fn collects_responsive_object() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box mt={{ _: 8, sm: 16 }} />;
            }
            "#,
            box_with_props(&["mt"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "mt");
        assert_eq!(usages[0].value["_"], 8);
        assert_eq!(usages[0].value["sm"], 16);
    }

    // ------------------------------------------------------------------
    // 4. Skips prop not in the active group set
    // ------------------------------------------------------------------
    #[test]
    fn skips_non_group_prop() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box variant="fill" p={8} />;
            }
            "#,
            box_with_props(&["p"]), // "variant" is NOT in the active set
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "p");
        assert_eq!(usages[0].value, 8);
    }

    // ------------------------------------------------------------------
    // 5. Skips unknown component
    // ------------------------------------------------------------------
    #[test]
    fn skips_unknown_component() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Unknown p={8} />;
            }
            "#,
            box_with_props(&["p"]), // "Unknown" is not in map
        );
        assert!(usages.is_empty());
    }

    // ------------------------------------------------------------------
    // 6. Skips dynamic (non-static) value — identifier reference
    // ------------------------------------------------------------------
    #[test]
    fn skips_dynamic_value() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box p={spacing} />;
            }
            "#,
            box_with_props(&["p"]),
        );
        assert!(usages.is_empty());
    }

    // ------------------------------------------------------------------
    // 7. Deduplicates identical (prop, value) pairs
    // ------------------------------------------------------------------
    #[test]
    fn deduplicates_same_value() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return (
                    <div>
                        <Box p={8} />
                        <Box p={8} />
                    </div>
                );
            }
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "p");
        assert_eq!(usages[0].value, 8);
    }

    // ------------------------------------------------------------------
    // 8. Different values for the same prop are kept as separate entries
    // ------------------------------------------------------------------
    #[test]
    fn different_values_kept() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return (
                    <div>
                        <Box p={8} />
                        <Box p={16} />
                    </div>
                );
            }
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 2);
        let values: FxHashSet<i64> = usages.iter().map(|u| u.value.as_i64().unwrap()).collect();
        assert!(values.contains(&8));
        assert!(values.contains(&16));
    }

    // ------------------------------------------------------------------
    // 9. Nested JSX inside a function body is found
    // ------------------------------------------------------------------
    #[test]
    fn nested_jsx_found() {
        let usages = parse_and_scan(
            r#"
            function Card() {
                return (
                    <Box display="flex">
                        <Box p={12} />
                    </Box>
                );
            }
            "#,
            box_with_props(&["display", "p"]),
        );
        assert_eq!(usages.len(), 2);
        let names: FxHashSet<&str> = usages.iter().map(|u| u.prop_name.as_str()).collect();
        assert!(names.contains("display"));
        assert!(names.contains("p"));
    }

    // ------------------------------------------------------------------
    // Bonus: negative numeric value
    // ------------------------------------------------------------------
    #[test]
    fn collects_negative_number() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box mt={-4} />;
            }
            "#,
            box_with_props(&["mt"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].value, -4);
    }

    // ------------------------------------------------------------------
    // Bonus: multiple components sharing the same prop name — deduplication
    // still applies by (prop_name, value), not by binding.
    // ------------------------------------------------------------------
    #[test]
    fn multiple_components_same_prop_name() {
        let component_props = map! {
            "Box" => set!["p"],
            "Text" => set!["p"],
        };

        // Both use p={8} — still deduplicated to one entry.
        let usages = parse_and_scan(
            r#"
            function App() {
                return (
                    <div>
                        <Box p={8} />
                        <Text p={8} />
                    </div>
                );
            }
            "#,
            component_props,
        );
        assert_eq!(
            usages.len(),
            1,
            "same (prop, value) deduped across components"
        );
    }

    // ------------------------------------------------------------------
    // Bonus: call expression value is skipped
    // ------------------------------------------------------------------
    #[test]
    fn skips_call_expression_value() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box p={getSpacing()} />;
            }
            "#,
            box_with_props(&["p"]),
        );
        assert!(usages.is_empty());
    }

    // ------------------------------------------------------------------
    // Bonus: conditional expression value is skipped
    // ------------------------------------------------------------------
    #[test]
    fn skips_conditional_expression_value() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box display={isOpen ? 'block' : 'none'} />;
            }
            "#,
            box_with_props(&["display"]),
        );
        assert!(usages.is_empty());
    }

    // ------------------------------------------------------------------
    // Bonus: spread attributes are silently skipped, other props collected
    // ------------------------------------------------------------------
    #[test]
    fn skips_spread_attributes() {
        let usages = parse_and_scan(
            r#"
            function App() {
                return <Box {...props} p={4} />;
            }
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].prop_name, "p");
    }

    // ------------------------------------------------------------------
    // Bonus: JSX inside a variable initializer is found
    // ------------------------------------------------------------------
    #[test]
    fn jsx_in_variable_initializer() {
        let usages = parse_and_scan(
            r#"
            const el = <Box p={24} />;
            "#,
            box_with_props(&["p"]),
        );
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].value, 24);
    }

    // ==================================================================
    // scan_jsx_usage tests
    // ==================================================================

    /// Build a parse + scan_jsx_usage helper
    fn parse_and_scan_usage(
        source: &str,
        component_props: FxHashMap<String, FxHashSet<String>>,
        component_configs: FxHashMap<String, ComponentUsageConfig>,
    ) -> UsageScanResult {
        let ast = parse_tsx(source);
        let result_program = ast.program();
        let empty = FxHashMap::default();
        scan_jsx_usage(result_program, &component_props, &component_configs, &empty)
    }

    /// Build a ComponentUsageConfig for Button with a single "variant" prop
    /// that has options "fill" and "stroke", default "fill".
    fn button_config_variant() -> FxHashMap<String, ComponentUsageConfig> {
        map! {
            "Button" => ComponentUsageConfig {
                variants: map! { "variant" => (set!["fill", "stroke"], Some("fill".to_string())) },
                states: FxHashSet::default(),
            }
        }
    }

    /// Build a ComponentUsageConfig for Layout with a "sidebar" state.
    fn layout_config_state() -> FxHashMap<String, ComponentUsageConfig> {
        map! {
            "Layout" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: set!["sidebar"],
            }
        }
    }

    // ------------------------------------------------------------------
    // scan_usage_collects_variant_value
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_collects_variant_value() {
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Button variant="stroke" />;
            }
            "#,
            FxHashMap::default(),
            button_config_variant(),
        );
        assert_eq!(result.variant_usages.len(), 1);
        assert_eq!(result.variant_usages[0].component_binding, "Button");
        assert_eq!(result.variant_usages[0].variant_prop, "variant");
        assert_eq!(result.variant_usages[0].value, "stroke");
    }

    // ------------------------------------------------------------------
    // scan_usage_collects_dynamic_variant
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_collects_dynamic_variant() {
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Button variant={x} />;
            }
            "#,
            FxHashMap::default(),
            button_config_variant(),
        );
        assert_eq!(result.variant_usages.len(), 1);
        assert_eq!(result.variant_usages[0].value, "__dynamic__");
    }

    // ------------------------------------------------------------------
    // scan_usage_detects_absent_variant
    // When a tracked component is rendered WITHOUT the variant prop, we emit __default__.
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_detects_absent_variant() {
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Button />;
            }
            "#,
            FxHashMap::default(),
            button_config_variant(),
        );
        assert_eq!(result.variant_usages.len(), 1);
        assert_eq!(result.variant_usages[0].component_binding, "Button");
        assert_eq!(result.variant_usages[0].variant_prop, "variant");
        assert_eq!(result.variant_usages[0].value, "__default__");
    }

    // ------------------------------------------------------------------
    // scan_usage_collects_state
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_collects_state() {
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Layout sidebar />;
            }
            "#,
            FxHashMap::default(),
            layout_config_state(),
        );
        assert_eq!(result.state_usages.len(), 1);
        assert_eq!(result.state_usages[0].component_binding, "Layout");
        assert_eq!(result.state_usages[0].state_name, "sidebar");
    }

    // ------------------------------------------------------------------
    // scan_usage_tracks_rendered_component
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_tracks_rendered_component() {
        let configs = map! {
            "Box" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            }
        };
        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Box />;
            }
            "#,
            FxHashMap::default(),
            configs,
        );
        assert!(result.rendered_components.contains("Box"));
    }

    // ------------------------------------------------------------------
    // scan_usage_still_collects_system_props
    // Verify SystemPropUsage still works alongside new tracking.
    // ------------------------------------------------------------------
    #[test]
    fn scan_usage_still_collects_system_props() {
        let component_props = map! { "Button" => set!["p"] };

        let result = parse_and_scan_usage(
            r#"
            function App() {
                return <Button p={8} variant="stroke" />;
            }
            "#,
            component_props,
            button_config_variant(),
        );

        // System prop collected
        assert_eq!(result.system_prop_usages.len(), 1);
        assert_eq!(result.system_prop_usages[0].prop_name, "p");
        assert_eq!(result.system_prop_usages[0].value, 8);

        // Variant also collected
        assert_eq!(result.variant_usages.len(), 1);
        assert_eq!(result.variant_usages[0].value, "stroke");

        // Component tracked
        assert!(result.rendered_components.contains("Button"));
    }

    // ==================================================================
    // createElement render-tracking tests
    // ==================================================================

    fn parse_and_scan_usage_with_members(
        source: &str,
        component_props: FxHashMap<String, FxHashSet<String>>,
        component_configs: FxHashMap<String, ComponentUsageConfig>,
        member_expr_bindings: FxHashMap<String, String>,
    ) -> UsageScanResult {
        let ast = parse_tsx(source);
        let result_program = ast.program();
        scan_jsx_usage(
            result_program,
            &component_props,
            &component_configs,
            &member_expr_bindings,
        )
    }

    fn box_config_empty() -> FxHashMap<String, ComponentUsageConfig> {
        map! {
            "Box" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            }
        }
    }

    #[test]
    fn create_element_bare_ident_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() { return createElement(Box, {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            result.rendered_components.contains("Box"),
            "createElement(Box, ...) must register Box as rendered"
        );
    }

    #[test]
    fn react_create_element_member_callee_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import React from 'react';
            function App() { return React.createElement(Box, {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            result.rendered_components.contains("Box"),
            "React.createElement(Box, ...) must register Box as rendered"
        );
    }

    #[test]
    fn create_element_family_slot_tracked() {
        let configs = map! {
            "NavBarRoot" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            }
        };
        let member_bindings = map! { "NavBar.Root" => "NavBarRoot".to_string() };
        let result = parse_and_scan_usage_with_members(
            r#"
            import { createElement } from 'react';
            function App() { return createElement(NavBar.Root, {}); }
            "#,
            FxHashMap::default(),
            configs,
            member_bindings,
        );
        assert!(
            result.rendered_components.contains("NavBarRoot"),
            "createElement(NavBar.Root, ...) must register NavBarRoot via member_expr_bindings"
        );
    }

    #[test]
    fn create_element_string_literal_not_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() { return createElement('div', {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            !result.rendered_components.contains("Box"),
            "createElement('div', ...) is a native element — no binding tracking"
        );
        assert!(
            result.rendered_components.is_empty(),
            "native element should not populate rendered_components"
        );
        assert!(
            !result.identity_uncertain,
            "a string-literal native element has known non-component identity"
        );
    }

    #[test]
    fn create_element_dynamic_first_arg_not_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() { return createElement(getComponent(), {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            result.rendered_components.is_empty(),
            "dynamic first arg (call expression) cannot be attributed to a binding"
        );
        assert!(
            result.identity_uncertain,
            "an unattributable dynamic first arg must widen component reachability"
        );
    }

    #[test]
    fn create_element_lowercase_unknown_identifier_marks_identity_uncertain() {
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() { return createElement(component, {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(result.rendered_components.is_empty());
        assert!(
            result.identity_uncertain,
            "createElement identifiers are runtime component values regardless of casing"
        );
    }

    #[test]
    fn create_element_untracked_binding_not_tracked() {
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() { return createElement(UntrackedThing, {}); }
            "#,
            FxHashMap::default(),
            box_config_empty(),
        );
        assert!(
            result.rendered_components.is_empty(),
            "identifier not in component_props/configs must not populate rendered_components"
        );
    }

    #[test]
    fn create_element_nested_both_tracked() {
        let configs = map! {
            "Outer" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            },
            "Inner" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            },
        };
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() {
                return createElement(Outer, {}, createElement(Inner, {}));
            }
            "#,
            FxHashMap::default(),
            configs,
        );
        assert!(
            result.rendered_components.contains("Outer"),
            "outer createElement must be tracked"
        );
        assert!(
            result.rendered_components.contains("Inner"),
            "nested createElement must be tracked — walk_call_expression continues descent"
        );
    }

    #[test]
    fn create_element_mixed_with_jsx_both_tracked() {
        let configs = map! {
            "JsxOnly" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            },
            "CallOnly" => ComponentUsageConfig {
                variants: FxHashMap::default(),
                states: FxHashSet::default(),
            },
        };
        let result = parse_and_scan_usage(
            r#"
            import { createElement } from 'react';
            function App() {
                return (
                    <JsxOnly>
                        {createElement(CallOnly, {})}
                    </JsxOnly>
                );
            }
            "#,
            FxHashMap::default(),
            configs,
        );
        assert!(result.rendered_components.contains("JsxOnly"));
        assert!(result.rendered_components.contains("CallOnly"));
    }

    // ==================================================================
    // Dynamic prop detection tests
    // ==================================================================

    fn parse_dynamic_usages(source: &str) -> UsageScanResult {
        let ast = parse_tsx(source);
        let result_program = ast.program();
        let empty = FxHashMap::default();
        scan_jsx_usage(
            result_program,
            &box_with_props(&["p", "display", "mt", "borderRadius"]),
            &FxHashMap::default(),
            &empty,
        )
    }

    #[test]
    fn detects_identifier_as_dynamic() {
        let result = parse_dynamic_usages(r#"function App() { return <Box p={spacing} />; }"#);
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn detects_call_expression_as_dynamic() {
        let result = parse_dynamic_usages(r#"function App() { return <Box p={getSpacing()} />; }"#);
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn detects_conditional_as_dynamic() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box display={isOpen ? 'block' : 'none'} />; }"#,
        );
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "display");
    }

    #[test]
    fn detects_member_expression_as_dynamic() {
        let result =
            parse_dynamic_usages(r#"function App() { return <Box p={theme.spacing.large} />; }"#);
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn detects_template_literal_with_expression_as_dynamic() {
        let result = parse_dynamic_usages(r#"function App() { return <Box p={`${size}px`} />; }"#);
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn static_literals_still_produce_static() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box p={8} display="flex" mt={{ _: 4, sm: 8 }} />; }"#,
        );
        assert_eq!(result.system_prop_usages.len(), 3);
        assert!(result.dynamic_prop_usages.is_empty());
    }

    #[test]
    fn same_prop_static_and_dynamic_produces_both() {
        let result = parse_dynamic_usages(
            r#"function App() { return <div><Box p={8} /><Box p={variable} /></div>; }"#,
        );
        assert_eq!(result.system_prop_usages.len(), 1);
        assert_eq!(result.system_prop_usages[0].value, 8);
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "p");
    }

    #[test]
    fn dynamic_deduplicates_by_prop_name() {
        let result = parse_dynamic_usages(
            r#"function App() { return <div><Box p={a} /><Box p={b} /></div>; }"#,
        );
        assert_eq!(
            result.dynamic_prop_usages.len(),
            1,
            "same prop name deduped"
        );
    }

    #[test]
    fn binary_expression_is_dynamic() {
        let result = parse_dynamic_usages(r#"function App() { return <Box p={base + 4} />; }"#);
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
    }

    #[test]
    fn responsive_object_with_dynamic_value_is_dynamic() {
        let result = parse_dynamic_usages(
            r#"function App() { return <Box mt={{ _: spacing, sm: 16 }} />; }"#,
        );
        assert!(result.system_prop_usages.is_empty());
        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.dynamic_prop_usages[0].prop_name, "mt");
    }

    #[test]
    fn dynamic_residue_records_closed_kind_and_exact_expression_span() {
        let cases = [
            ("spacing", DynamicExpressionKind::Identifier),
            ("tokens.lg", DynamicExpressionKind::Member),
            ("getSpacing()", DynamicExpressionKind::Call),
            ("ok ? 4 : 8", DynamicExpressionKind::Conditional),
            ("value ?? 8", DynamicExpressionKind::Logical),
            ("`${value}px`", DynamicExpressionKind::Template),
            ("value + 4", DynamicExpressionKind::Binary),
            (
                "{ _: value, sm: 8 }",
                DynamicExpressionKind::ResponsiveObjectDynamic,
            ),
            ("[value]", DynamicExpressionKind::Array),
            ("value as number", DynamicExpressionKind::Other),
        ];

        for (expression, expected_kind) in cases {
            let source = format!("function App() {{ return <Box p={{{expression}}} />; }}");
            let result = parse_dynamic_usages(&source);

            assert_eq!(result.residue_sites.len(), 1, "source: {source}");
            let site = &result.residue_sites[0];
            assert_eq!(site.binding, "Box");
            assert_eq!(site.prop_name, "p");
            assert_eq!(site.kind, expected_kind, "source: {source}");
            assert_eq!(
                &source[site.span.start as usize..site.span.end as usize],
                expression,
                "source: {source}"
            );
        }
    }

    #[test]
    fn dynamic_residue_classifies_whole_unary_and_recursively_unwraps_parentheses() {
        let cases = [
            ("!spacing", DynamicExpressionKind::Other, "!spacing"),
            (
                "(((spacing)))",
                DynamicExpressionKind::Identifier,
                "spacing",
            ),
        ];

        for (expression, expected_kind, expected_slice) in cases {
            let source = format!("function App() {{ return <Box p={{{expression}}} />; }}");
            let result = parse_dynamic_usages(&source);
            let site = &result.residue_sites[0];

            assert_eq!(site.kind, expected_kind, "source: {source}");
            assert_eq!(
                &source[site.span.start as usize..site.span.end as usize],
                expected_slice,
                "source: {source}"
            );
        }
    }

    #[test]
    fn residue_preserves_sites_while_dynamic_config_input_stays_deduped() {
        let result = parse_dynamic_usages(
            r#"function App() { return <><Box p={first} /><Box p={second()} /></>; }"#,
        );

        assert_eq!(result.dynamic_prop_usages.len(), 1);
        assert_eq!(result.residue_sites.len(), 2);
        assert_eq!(
            result.residue_sites[0].kind,
            DynamicExpressionKind::Identifier
        );
        assert_eq!(result.residue_sites[1].kind, DynamicExpressionKind::Call);
    }

    // ==================================================================
    // Custom prop dynamic detection tests (scan_jsx path)
    // ==================================================================

    fn card_with_custom_props(props: &[&str]) -> FxHashMap<String, FxHashSet<String>> {
        map! { "Card" => props.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn custom_prop_identifier_detected_as_dynamic() {
        let result = parse_and_scan_full(
            r#"function App() { return <Card sizing={mySize} />; }"#,
            card_with_custom_props(&["sizing"]),
        );
        assert!(result.static_usages.is_empty());
        assert_eq!(result.dynamic_usages.len(), 1);
        assert_eq!(result.dynamic_usages[0].prop_name, "sizing");
        assert_eq!(result.dynamic_usages[0].binding, "Card");
    }

    #[test]
    fn custom_prop_conditional_detected_as_dynamic() {
        let result = parse_and_scan_full(
            r#"function App() { return <Card sizing={isLarge ? 100 : 50} />; }"#,
            card_with_custom_props(&["sizing"]),
        );
        assert!(result.static_usages.is_empty());
        assert_eq!(result.dynamic_usages.len(), 1);
        assert_eq!(result.dynamic_usages[0].prop_name, "sizing");
    }

    #[test]
    fn custom_prop_static_not_marked_dynamic() {
        let result = parse_and_scan_full(
            r#"function App() { return <Card sizing={100} density="compact" />; }"#,
            card_with_custom_props(&["sizing", "density"]),
        );
        assert_eq!(result.static_usages.len(), 2);
        assert!(result.dynamic_usages.is_empty());
    }

    // ------------------------------------------------------------------
    // compose() family extraction
    // ------------------------------------------------------------------

    fn parse_compose_families(source: &str) -> Vec<ComposeFamilyInfo> {
        let ast = parse_tsx(source);
        let result_program = ast.program();
        scan_compose_calls(result_program)
    }

    #[test]
    fn compose_extracts_slots_and_shared_keys() {
        let families = parse_compose_families(
            r#"const Family = compose({ Root, Control, Label }, { shared: { size: true, tone: true } });"#,
        );
        assert_eq!(families.len(), 1);
        let f = &families[0];
        assert_eq!(f.root_binding, "Root");
        assert_eq!(f.slots.len(), 3);
        assert_eq!(f.slots[0], ("Root".to_string(), "Root".to_string()));
        assert_eq!(f.slots[1], ("Control".to_string(), "Control".to_string()));
        assert_eq!(f.slots[2], ("Label".to_string(), "Label".to_string()));
        assert_eq!(f.shared_keys, vec!["size", "tone"]);
    }

    #[test]
    fn compose_empty_shared() {
        let families =
            parse_compose_families(r#"const F = compose({ Root, Child }, { shared: {} });"#);
        assert_eq!(families.len(), 1);
        assert!(families[0].shared_keys.is_empty());
    }

    #[test]
    fn compose_no_shared_arg() {
        // compose() with only the slots arg (no options) — still extracts slots
        let families = parse_compose_families(r#"const F = compose({ Root, Child });"#);
        assert_eq!(families.len(), 1);
        assert!(families[0].shared_keys.is_empty());
        assert_eq!(families[0].slots.len(), 2);
    }

    #[test]
    fn compose_multiple_calls_per_file() {
        let families = parse_compose_families(
            r#"
            const A = compose({ Root: RootA, Item: ItemA }, { shared: { size: true } });
            const B = compose({ Root: RootB, Label: LabelB }, { shared: { tone: true } });
            "#,
        );
        assert_eq!(families.len(), 2);
        assert_eq!(families[0].root_binding, "RootA");
        assert_eq!(families[0].shared_keys, vec!["size"]);
        assert_eq!(families[1].root_binding, "RootB");
        assert_eq!(families[1].shared_keys, vec!["tone"]);
    }

    #[test]
    fn compose_exported_named() {
        let families = parse_compose_families(
            r#"export const Family = compose({ Root, Child }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert_eq!(families[0].root_binding, "Root");
    }

    #[test]
    fn compose_skips_no_root() {
        let families = parse_compose_families(
            r#"const F = compose({ Item, Label }, { shared: { size: true } });"#,
        );
        assert!(families.is_empty(), "No Root slot → family skipped");
    }

    #[test]
    fn compose_aliased_slot_bindings() {
        let families = parse_compose_families(
            r#"const F = compose({ Root: MyRoot, Control: MyControl }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert_eq!(families[0].root_binding, "MyRoot");
        assert_eq!(
            families[0].slots[0],
            ("Root".to_string(), "MyRoot".to_string())
        );
        assert_eq!(
            families[0].slots[1],
            ("Control".to_string(), "MyControl".to_string())
        );
    }

    #[test]
    fn compose_context_true_extracted() {
        let families = parse_compose_families(
            r#"const F = compose({ Root, Child }, { shared: { size: true }, context: true });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(families[0].context);
        assert_eq!(families[0].shared_keys, vec!["size"]);
    }

    #[test]
    fn compose_context_defaults_to_false() {
        let families = parse_compose_families(
            r#"const F = compose({ Root, Child }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(!families[0].context);
    }

    #[test]
    fn compose_context_false_extracted() {
        let families = parse_compose_families(
            r#"const F = compose({ Root, Child }, { shared: { size: true }, context: false });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(!families[0].context);
    }

    #[test]
    fn compose_with_context_forces_context_true() {
        let families = parse_compose_families(
            r#"const F = composeWithContext({ Root, Child }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(
            families[0].context,
            "composeWithContext must force context: true"
        );
        assert_eq!(families[0].shared_keys, vec!["size"]);
        assert_eq!(families[0].root_binding, "Root");
    }

    #[test]
    fn compose_with_context_name_from_binding() {
        let families = parse_compose_families(
            r#"const Dialog = composeWithContext({ Root: DialogRoot, Body: DialogBody }, { shared: { size: true } });"#,
        );
        assert_eq!(families.len(), 1);
        assert!(families[0].context);
        assert_eq!(families[0].name, "Dialog");
    }
}
