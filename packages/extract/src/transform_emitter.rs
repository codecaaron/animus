use std::collections::{HashMap, HashSet};

use oxc_span::Span;
use serde_json::json;

use crate::project_analyzer::DynamicPropMeta;

/// Describes a replacement to apply to the source.
#[derive(Debug)]
pub struct SourceReplacement {
    /// Byte span to replace (start..end of the chain expression).
    pub span: Span,
    /// The replacement text.
    pub replacement: String,
}

/// Information needed to generate a createComponent call.
#[derive(Debug, Clone)]
pub struct ComponentReplacement {
    pub binding: String,
    pub tag: String,
    pub class_name: String,
    pub variant_config: Vec<VariantPropConfig>,
    pub compound_configs: Vec<CompoundConfig>,
    pub state_names: Vec<String>,
    /// All active system prop names for this component (for DOM filtering).
    pub system_prop_names: Vec<String>,
    /// Group names this component uses (e.g. ["space", "color"]).
    /// Used to emit references to shared group arrays instead of inlining prop name lists.
    pub system_group_names: Vec<String>,
    /// Retained for future source map support.
    #[allow(dead_code)]
    pub span: Span,
    /// When true, `tag` is a component identifier reference (asComponent).
    /// When false (default), `tag` is a string literal (asElement).
    pub is_component_element: bool,
    /// When true, emit `createClassResolver` instead of `createComponent`.
    pub is_class_resolver: bool,
    /// Whether any of this component's system props have detected dynamic usage.
    /// When true, `dynamicPropConfig` is emitted as the 5th createComponent argument.
    pub has_dynamic_props: bool,
    /// Per-component custom prop class map: propName → valueKey → className.
    /// Inlined in the config object when present.
    pub custom_prop_class_map: Option<HashMap<String, HashMap<String, String>>>,
    /// Per-component custom dynamic prop config for CSS variable slot resolution.
    /// Inlined in the config object when present.
    pub custom_dynamic_config: Option<HashMap<String, DynamicPropMeta>>,
}

#[derive(Debug, Clone)]
pub struct VariantPropConfig {
    pub prop: String,
    pub options: Vec<String>,
    pub default: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CompoundConfig {
    pub conditions: HashMap<String, serde_json::Value>,
    pub class_name: String,
}

/// Generate the createComponent() replacement expression.
///
/// When `is_component_element` is true the first argument is an identifier
/// reference (preserving the original import).  When false it is a string
/// literal (asElement HTML tag name).
pub fn generate_replacement(comp: &ComponentReplacement, group_registry: &HashMap<String, Vec<String>>) -> String {
    let config = build_runtime_config(comp, group_registry);
    let has_system_props = !comp.system_prop_names.is_empty();

    if comp.is_class_resolver {
        if has_system_props && comp.has_dynamic_props {
            format!(
                "createClassResolver('{}', {}, systemPropMap, dynamicPropConfig)",
                comp.class_name, config
            )
        } else if has_system_props {
            format!(
                "createClassResolver('{}', {}, systemPropMap)",
                comp.class_name, config
            )
        } else {
            format!(
                "createClassResolver('{}', {})",
                comp.class_name, config
            )
        }
    } else {
        let tag = if comp.is_component_element {
            comp.tag.clone()
        } else {
            format!("'{}'", comp.tag)
        };

        if has_system_props && comp.has_dynamic_props {
            format!(
                "createComponent({}, '{}', {}, systemPropMap, dynamicPropConfig)",
                tag, comp.class_name, config
            )
        } else if has_system_props {
            format!(
                "createComponent({}, '{}', {}, systemPropMap)",
                tag, comp.class_name, config
            )
        } else {
            format!(
                "createComponent({}, '{}', {})",
                tag, comp.class_name, config
            )
        }
    }
}

/// Build the runtime config object as a JSON string.
fn build_runtime_config(comp: &ComponentReplacement, group_registry: &HashMap<String, Vec<String>>) -> String {
    let mut config = serde_json::Map::new();

    // Variants
    if !comp.variant_config.is_empty() {
        let mut variants = serde_json::Map::new();
        for vc in &comp.variant_config {
            let mut entry = serde_json::Map::new();
            entry.insert(
                "options".to_string(),
                json!(vc.options),
            );
            if let Some(default) = &vc.default {
                entry.insert("default".to_string(), json!(default));
            }
            variants.insert(vc.prop.clone(), serde_json::Value::Object(entry));
        }
        config.insert("variants".to_string(), serde_json::Value::Object(variants));
    }

    // Compounds
    if !comp.compound_configs.is_empty() {
        let compounds: Vec<serde_json::Value> = comp.compound_configs.iter().map(|cc| {
            json!({
                "conditions": cc.conditions,
                "className": cc.class_name,
            })
        }).collect();
        config.insert("compounds".to_string(), json!(compounds));
    }

    // States
    if !comp.state_names.is_empty() {
        config.insert("states".to_string(), json!(comp.state_names));
    }

    let base_json = serde_json::to_string(&serde_json::Value::Object(config))
        .unwrap_or_else(|_| "{}".to_string());

    // System prop names — use group references when available, literal array as fallback
    let mut result = if !comp.system_group_names.is_empty() {
        let mut concat_parts: Vec<String> = comp.system_group_names.iter()
            .map(|g| format!("systemPropGroups.{}", g))
            .collect();
        // Append individual prop names not covered by any active group
        // + custom prop names (union of class map + dynamic config keys)
        {
            let mut extra_names: HashSet<String> = HashSet::new();

            // Find individually-activated props: in system_prop_names but not in any active group
            if !comp.system_prop_names.is_empty() {
                let group_covered: HashSet<String> = comp.system_group_names.iter()
                    .filter_map(|g| group_registry.get(g))
                    .flat_map(|props| props.iter().cloned())
                    .collect();
                for prop in &comp.system_prop_names {
                    if !group_covered.contains(prop) {
                        extra_names.insert(prop.clone());
                    }
                }
            }

            if let Some(ref cpm) = comp.custom_prop_class_map {
                extra_names.extend(cpm.keys().cloned());
            }
            if let Some(ref cdc) = comp.custom_dynamic_config {
                extra_names.extend(cdc.keys().cloned());
            }
            if !extra_names.is_empty() {
                let mut sorted: Vec<String> = extra_names.into_iter().collect();
                sorted.sort();
                concat_parts.push(serde_json::to_string(&sorted).unwrap_or_else(|_| "[]".to_string()));
            }
        }
        let concat_expr = concat_parts.join(",");
        let spn_field = format!("\"systemPropNames\":[].concat({})", concat_expr);
        if base_json == "{}" {
            format!("{{{}}}", spn_field)
        } else {
            format!("{},{}}}", &base_json[..base_json.len()-1], spn_field)
        }
    } else if !comp.system_prop_names.is_empty() {
        let mut config_map: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&base_json).unwrap_or_default();
        config_map.insert("systemPropNames".to_string(), json!(comp.system_prop_names));
        serde_json::to_string(&serde_json::Value::Object(config_map))
            .unwrap_or_else(|_| base_json)
    } else {
        base_json
    };

    // Append customPropMap if present (pure JSON — can be serialized)
    if let Some(ref cpm) = comp.custom_prop_class_map {
        let cpm_json = serde_json::to_string(cpm).unwrap_or_else(|_| "{}".to_string());
        if result == "{}" {
            result = format!("{{\"customPropMap\":{}}}", cpm_json);
        } else {
            result = format!("{},\"customPropMap\":{}}}", &result[..result.len()-1], cpm_json);
        }
    }

    // Append customDynamicConfig if present
    // This needs special handling because transform references are JS identifiers, not strings
    if let Some(ref cdc) = comp.custom_dynamic_config {
        let mut entries: Vec<String> = Vec::new();
        let mut sorted_keys: Vec<&String> = cdc.keys().collect();
        sorted_keys.sort();
        for prop_name in sorted_keys {
            let meta = &cdc[prop_name];
            let mut fields: Vec<String> = Vec::new();
            fields.push(format!("\"varName\":\"{}\"", meta.var_name));
            fields.push(format!("\"slotClass\":\"{}\"", meta.slot_class));
            fields.push(format!("\"property\":\"{}\"", meta.property));
            if !meta.properties.is_empty() {
                let props_json = serde_json::to_string(&meta.properties).unwrap_or_else(|_| "[]".to_string());
                fields.push(format!("\"properties\":{}", props_json));
            }
            if let Some(ref tn) = meta.transform_name {
                fields.push(format!("\"transformName\":\"{}\"", tn));
                // Direct JS identifier reference: transforms.{name}
                fields.push(format!("\"transform\":transforms.{}", tn));
            }
            if !meta.scale_values.is_empty() {
                let sv_json = serde_json::to_string(&meta.scale_values).unwrap_or_else(|_| "{}".to_string());
                fields.push(format!("\"scaleValues\":{}", sv_json));
            }
            entries.push(format!("\"{}\":{{{}}}", prop_name, fields.join(",")));
        }
        let cdc_str = format!("{{{}}}", entries.join(","));
        if result == "{}" {
            result = format!("{{\"customDynamicConfig\":{}}}", cdc_str);
        } else {
            result = format!("{},\"customDynamicConfig\":{}}}", &result[..result.len()-1], cdc_str);
        }
    }

    result
}

/// Apply all replacements to source code. Replacements must not overlap.
/// Also adds the runtime import and CSS import at the top.
///
/// `consumed_sources` — import sources whose bindings have all been extracted
/// (e.g. `&["@animus-ui/core"]`).  Any `import { x } from 'source'` line where
/// every named binding appears in `extracted_bindings` will be removed.
///
/// `extracted_bindings` — the binding names that were successfully extracted
/// (e.g. `&["animus"]`).
pub fn apply_replacements(
    source: &str,
    replacements: &mut [SourceReplacement],
    css_module_id: &str,
    consumed_sources: &[&str],
    extracted_bindings: &[&str],
) -> String {
    if replacements.is_empty() {
        return source.to_string();
    }

    // Sort replacements by position (end to start) so byte offsets stay valid
    replacements.sort_by(|a, b| b.span.start.cmp(&a.span.start));

    let mut result = source.to_string();

    for replacement in replacements.iter() {
        let start = replacement.span.start as usize;
        let end = replacement.span.end as usize;
        if start <= result.len() && end <= result.len() && start <= end {
            result.replace_range(start..end, &replacement.replacement);
        }
    }

    // Strip dead import lines whose bindings have all been extracted.
    // We only handle the `import { x, y } from 'source'` form — not default,
    // namespace, or side-effect imports.
    if !consumed_sources.is_empty() && !extracted_bindings.is_empty() {
        result = strip_consumed_imports(&result, consumed_sources, extracted_bindings);
    }

    // Add imports at the top
    let needs_system_prop_map = replacements.iter().any(|r| r.replacement.contains("systemPropMap"));
    let needs_system_prop_groups = replacements.iter().any(|r| r.replacement.contains("systemPropGroups."));
    let needs_dynamic_prop_config = replacements.iter().any(|r| r.replacement.contains("dynamicPropConfig"));
    let needs_transforms_for_custom = replacements.iter().any(|r| r.replacement.contains("transforms."));

    // Build virtual module imports list
    let mut virtual_imports: Vec<&str> = Vec::new();
    if needs_system_prop_map {
        virtual_imports.push("systemPropMap");
    }
    if needs_system_prop_groups {
        virtual_imports.push("systemPropGroups");
    }
    if needs_dynamic_prop_config {
        virtual_imports.push("dynamicPropConfig");
        virtual_imports.push("transforms");
    } else if needs_transforms_for_custom {
        // Custom dynamic config references transforms.{name} directly —
        // import transforms even without shared dynamicPropConfig
        virtual_imports.push("transforms");
    }

    let needs_create_component = replacements.iter().any(|r| r.replacement.contains("createComponent("));
    let needs_class_resolver = replacements.iter().any(|r| r.replacement.contains("createClassResolver("));

    let mut system_imports: Vec<&str> = Vec::new();
    if needs_create_component {
        system_imports.push("createComponent");
    }
    if needs_class_resolver {
        system_imports.push("createClassResolver");
    }

    let system_import_str = format!(
        "import {{ {} }} from '@animus-ui/system';\n",
        system_imports.join(", ")
    );

    let import_lines = if !virtual_imports.is_empty() {
        let virtual_import = format!(
            "import {{ {} }} from 'virtual:animus/system-props';\n",
            virtual_imports.join(", ")
        );
        let binding_loop = if needs_dynamic_prop_config {
            "for (const [k, v] of Object.entries(dynamicPropConfig)) { if (v.transformName) v.transform = transforms[v.transformName]; }\n"
        } else {
            ""
        };
        format!(
            "{}{}{binding_loop}import '{}';\n",
            system_import_str,
            virtual_import,
            css_module_id,
        )
    } else {
        format!(
            "{}import '{}';\n",
            system_import_str,
            css_module_id
        )
    };

    // Insert after existing imports (find last import/require line)
    // For simplicity, prepend to the file
    format!("{}{}", import_lines, result)
}

/// Remove `import { ... } from 'source'` lines where the source is in
/// `consumed_sources` and ALL named bindings are in `extracted_bindings`.
///
/// Lines where only some bindings are extracted are left intact.
fn strip_consumed_imports(
    source: &str,
    consumed_sources: &[&str],
    extracted_bindings: &[&str],
) -> String {
    let mut result = String::with_capacity(source.len());

    for line in source.split('\n') {
        let trimmed = line.trim();

        // Only attempt to parse lines that look like named import statements.
        if trimmed.starts_with("import") && trimmed.contains('{') && trimmed.contains("from") {
            if let Some((bindings, source_str)) = parse_named_import(trimmed) {
                if consumed_sources.contains(&source_str.as_str()) {
                    // Check if ALL named bindings have been extracted
                    let all_extracted = bindings
                        .iter()
                        .all(|b| extracted_bindings.contains(&b.as_str()));
                    if all_extracted {
                        // Drop this line (skip appending to result)
                        // Also skip the newline that would follow (handled below)
                        continue;
                    }
                }
            }
        }

        result.push_str(line);
        result.push('\n');
    }

    // The split('\n') approach adds an extra trailing newline if the original
    // source ended with one.  Restore the original ending.
    if !source.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

/// Try to parse a line as `import { a, b as c, ... } from 'source'`.
///
/// Returns `Some((binding_names, source_specifier))` on success.
/// Binding names are the local names (after `as`, if present) — but for our
/// purposes we use the original exported names (before `as`), since we track
/// by the exported identifier.  Actually we use the imported name (left of `as`)
/// because that is what the user's code imports from the source.
fn parse_named_import(line: &str) -> Option<(Vec<String>, String)> {
    // Must start with `import`
    let rest = line.strip_prefix("import")?.trim_start();

    // Must have `{`
    let brace_start = rest.find('{')?;
    let brace_end = rest.find('}')?;
    if brace_end <= brace_start {
        return None;
    }

    let names_str = &rest[brace_start + 1..brace_end];

    // Parse binding names (handle `name as alias` — we want the original `name`)
    let bindings: Vec<String> = names_str
        .split(',')
        .map(|s| {
            let part = s.trim();
            // Take the part before ` as ` if present
            if let Some(idx) = part.find(" as ") {
                part[..idx].trim().to_string()
            } else {
                part.to_string()
            }
        })
        .filter(|s| !s.is_empty())
        .collect();

    if bindings.is_empty() {
        return None;
    }

    // Find `from 'source'` or `from "source"` after the `}`
    let after_brace = rest[brace_end + 1..].trim_start();
    let after_from = after_brace.strip_prefix("from")?.trim_start();

    // Extract quoted string
    let source_specifier = if after_from.starts_with('\'') {
        let end = after_from[1..].find('\'')?;
        after_from[1..end + 1].to_string()
    } else if after_from.starts_with('"') {
        let end = after_from[1..].find('"')?;
        after_from[1..end + 1].to_string()
    } else {
        return None;
    };

    Some((bindings, source_specifier))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_simple_replacement() {
        let comp = ComponentReplacement {
            binding: "Box".to_string(),
            tag: "div".to_string(),
            class_name: "animus-Box-12345678".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec![],
            system_group_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &HashMap::new());
        assert!(result.contains("createComponent('div', 'animus-Box-12345678'"));
    }

    #[test]
    fn generate_with_variants() {
        let comp = ComponentReplacement {
            binding: "Btn".to_string(),
            tag: "button".to_string(),
            class_name: "animus-Btn-abcd1234".to_string(),
            variant_config: vec![VariantPropConfig {
                prop: "variant".to_string(),
                options: vec!["fill".to_string(), "stroke".to_string()],
                default: Some("fill".to_string()),
            }],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec![],
            system_group_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &HashMap::new());
        assert!(result.contains("\"variants\""));
        assert!(result.contains("\"fill\""));
        assert!(result.contains("\"stroke\""));
    }

    #[test]
    fn generate_with_states() {
        let comp = ComponentReplacement {
            binding: "Layout".to_string(),
            tag: "div".to_string(),
            class_name: "animus-Layout-deadbeef".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec!["loading".to_string(), "disabled".to_string()],
            system_prop_names: vec![],
            system_group_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &HashMap::new());
        assert!(result.contains("\"states\""));
        assert!(result.contains("\"loading\""));
        assert!(result.contains("\"disabled\""));
    }

    #[test]
    fn apply_single_replacement() {
        let source = "const Box = animus.styles({}).asElement('div');";
        let mut replacements = vec![SourceReplacement {
            span: Span::new(12, 46),
            replacement: "createComponent('div', 'animus-Box-abc', {})".to_string(),
        }];
        let result = apply_replacements(source, &mut replacements, "virtual:animus/test.css", &[], &[]);
        assert!(result.contains("import { createComponent } from '@animus-ui/system';"));
        assert!(result.contains("import 'virtual:animus/test.css';"));
        assert!(result.contains("createComponent('div', 'animus-Box-abc', {})"));
        assert!(!result.contains("animus.styles"));
    }

    #[test]
    fn apply_multiple_replacements() {
        let source = "const A = AAA; const B = BBB;";
        let mut replacements = vec![
            SourceReplacement {
                span: Span::new(10, 13),
                replacement: "X".to_string(),
            },
            SourceReplacement {
                span: Span::new(25, 28),
                replacement: "Y".to_string(),
            },
        ];
        let result = apply_replacements(source, &mut replacements, "test.css", &[], &[]);
        assert!(result.contains("const A = X; const B = Y;"));
    }

    #[test]
    fn runtime_config_empty() {
        let comp = ComponentReplacement {
            binding: "Box".to_string(),
            tag: "div".to_string(),
            class_name: "x".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec![],
            system_group_names: vec![],
            span: Span::new(0, 0),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &HashMap::new());
        assert!(result.contains("{}"));
    }

    #[test]
    fn generate_with_group_names_uses_concat_refs() {
        let mut group_registry: HashMap<String, Vec<String>> = HashMap::new();
        group_registry.insert("layout".to_string(), vec!["display".to_string()]);
        group_registry.insert("space".to_string(), vec!["mt".to_string(), "p".to_string()]);

        let comp = ComponentReplacement {
            binding: "Box".to_string(),
            tag: "div".to_string(),
            class_name: "animus-Box-deadbeef".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec!["display".to_string(), "mt".to_string(), "p".to_string()],
            system_group_names: vec!["layout".to_string(), "space".to_string()],
            span: Span::new(0, 10),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &group_registry);
        // Config should use group concat instead of literal array
        assert!(result.contains("[].concat(systemPropGroups.layout,systemPropGroups.space)"), "should contain concat refs: got {}", result);
        // 4th argument is systemPropMap reference
        assert!(result.contains(", systemPropMap)"), "should end with systemPropMap: got {}", result);
        // Should NOT contain literal prop names as JSON array
        assert!(!result.contains("[\"display\""), "should not have literal prop names: got {}", result);
    }

    #[test]
    fn generate_without_system_props_omits_shared_map() {
        let comp = ComponentReplacement {
            binding: "Label".to_string(),
            tag: "span".to_string(),
            class_name: "animus-Label-abc".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec![],
            system_group_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &HashMap::new());
        // No system props → no 4th argument
        assert!(!result.contains("systemPropMap"));
        assert!(!result.contains("\"systemPropNames\""));
    }

    #[test]
    fn generate_as_component_uses_identifier() {
        let comp = ComponentReplacement {
            binding: "NavLink".to_string(),
            tag: "NextLink".to_string(),
            class_name: "animus-NavLink-abcd1234".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec![],
            system_group_names: vec![],
            span: Span::new(0, 10),
            is_component_element: true,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &HashMap::new());
        // Tag must be an identifier reference, not a string literal
        assert!(result.contains("createComponent(NextLink, 'animus-NavLink-abcd1234'"));
        // Must NOT wrap tag in quotes
        assert!(!result.contains("createComponent('NextLink'"));
    }

    // ── Dead import stripping tests ───────────────────────────────────────────

    #[test]
    fn strips_dead_import_when_all_bindings_extracted() {
        // The @animus-ui/core import should be removed when all its bindings are extracted.
        let source = "import { animus } from '@animus-ui/core';\nconst Box = animus.styles({}).asElement('div');";
        let mut replacements: Vec<SourceReplacement> = vec![SourceReplacement {
            span: Span::new(52, 89),
            replacement: "createComponent('div', 'animus-Box-abc', {})".to_string(),
        }];
        let result = apply_replacements(
            source,
            &mut replacements,
            "virtual:animus/test.css",
            &["@animus-ui/core"],
            &["animus"],
        );
        assert!(!result.contains("import { animus } from '@animus-ui/core'"), "dead import should be stripped: got {}", result);
        assert!(result.contains("import { createComponent } from '@animus-ui/system'"), "system import should be added: got {}", result);
    }

    #[test]
    fn preserves_import_when_partial_bindings() {
        // Only `animus` is extracted but `createParser` is also imported — keep the line.
        let source = "import { animus, createParser } from '@animus-ui/core';\nconst Box = createComponent('div', 'animus-Box-abc', {});";
        let mut replacements: Vec<SourceReplacement> = vec![SourceReplacement {
            span: Span::new(55, 55),
            replacement: String::new(),
        }];
        let result = apply_replacements(
            source,
            &mut replacements,
            "virtual:animus/test.css",
            &["@animus-ui/core"],
            &["animus"],
        );
        // Import must be preserved because createParser was NOT extracted
        assert!(result.contains("import { animus, createParser } from '@animus-ui/core'"));
    }

    // ------------------------------------------------------------------
    // Dynamic prop fallback: 5th argument emission
    // ------------------------------------------------------------------
    #[test]
    fn generate_with_dynamic_props_includes_5th_arg() {
        let comp = ComponentReplacement {
            binding: "Box".to_string(),
            tag: "div".to_string(),
            class_name: "animus-Box-abc".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec!["p".to_string()],
            system_group_names: vec!["space".to_string()],
            span: Span::new(0, 10),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: true,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &HashMap::new());
        assert!(
            result.contains("systemPropMap, dynamicPropConfig"),
            "dynamic props should add 5th arg: got {}",
            result
        );
    }

    #[test]
    fn generate_without_dynamic_props_omits_5th_arg() {
        let comp = ComponentReplacement {
            binding: "Box".to_string(),
            tag: "div".to_string(),
            class_name: "animus-Box-abc".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec!["p".to_string()],
            system_group_names: vec!["space".to_string()],
            span: Span::new(0, 10),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &HashMap::new());
        assert!(result.contains("systemPropMap)"), "should end with systemPropMap: got {}", result);
        assert!(!result.contains("dynamicPropConfig"), "should not contain dynamicPropConfig: got {}", result);
    }

    #[test]
    fn apply_replacements_includes_dynamic_imports() {
        let source = "const Box = animus.styles({}).system({ space: true }).asElement('div');";
        let mut replacements = vec![SourceReplacement {
            span: Span::new(12, 70),
            replacement: "createComponent('div', 'animus-Box-abc', {}, systemPropMap, dynamicPropConfig)".to_string(),
        }];
        let result = apply_replacements(
            source,
            &mut replacements,
            "virtual:animus/styles.css",
            &[],
            &[],
        );
        assert!(result.contains("dynamicPropConfig"), "should import dynamicPropConfig");
        assert!(result.contains("transforms"), "should import transforms");
        assert!(result.contains("Object.entries(dynamicPropConfig)"), "should have transform binding loop");
    }

    // ------------------------------------------------------------------
    // Custom prop map: inlined in config object
    // ------------------------------------------------------------------
    #[test]
    fn generate_with_custom_prop_map() {
        let mut cpm = HashMap::new();
        let mut size_map = HashMap::new();
        size_map.insert("sm".to_string(), "animus-u-abc".to_string());
        size_map.insert("lg".to_string(), "animus-u-def".to_string());
        cpm.insert("size".to_string(), size_map);

        let comp = ComponentReplacement {
            binding: "Card".to_string(),
            tag: "div".to_string(),
            class_name: "animus-Card-12345678".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec!["size".to_string()],
            system_group_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: Some(cpm),
            custom_dynamic_config: None,
        };
        let result = generate_replacement(&comp, &HashMap::new());
        assert!(result.contains("\"customPropMap\""), "should contain customPropMap: got {}", result);
        assert!(result.contains("\"size\""), "should contain size prop");
        assert!(result.contains("animus-u-abc"), "should contain class name");
    }

    #[test]
    fn generate_with_custom_dynamic_config_and_transform() {
        let mut cdc = HashMap::new();
        cdc.insert(
            "sizing".to_string(),
            DynamicPropMeta {
                var_name: "--animus-sizing".to_string(),
                slot_class: "animus-dyn-12345678-sizing".to_string(),
                property: "flex-basis".to_string(),
                properties: vec![],
                transform_name: Some("size".to_string()),
                scale_values: HashMap::new(),
            },
        );

        let comp = ComponentReplacement {
            binding: "Card".to_string(),
            tag: "div".to_string(),
            class_name: "animus-Card-12345678".to_string(),
            variant_config: vec![],
            compound_configs: vec![],
            state_names: vec![],
            system_prop_names: vec!["sizing".to_string()],
            system_group_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
            is_class_resolver: false,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: Some(cdc),
        };
        let result = generate_replacement(&comp, &HashMap::new());
        assert!(result.contains("\"customDynamicConfig\""), "should contain customDynamicConfig: got {}", result);
        assert!(result.contains("transforms.size"), "should reference transforms.size: got {}", result);
        assert!(result.contains("animus-dyn-12345678-sizing"), "should contain slot class: got {}", result);
    }

    #[test]
    fn apply_replacements_imports_transforms_for_custom_dynamic() {
        let source = "const Card = animus.styles({}).props({ sizing: { property: 'flexBasis', transform: 'size' } }).asElement('div');";
        let mut replacements = vec![SourceReplacement {
            span: Span::new(13, 106),
            replacement: "createComponent('div', 'animus-Card-abc', {\"customDynamicConfig\":{\"sizing\":{\"transform\":transforms.size}}})".to_string(),
        }];
        let result = apply_replacements(
            source,
            &mut replacements,
            "virtual:animus/styles.css",
            &[],
            &[],
        );
        assert!(result.contains("transforms"), "should import transforms for custom dynamic config");
    }
}
