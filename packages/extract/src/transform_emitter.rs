use std::collections::HashMap;

use oxc_span::Span;
use serde_json::json;

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
    pub state_names: Vec<String>,
    /// System prop class map: prop_name → value_key → class_name.
    /// Only populated when .groups() is present on the chain.
    pub system_props: Option<HashMap<String, HashMap<String, String>>>,
    /// All active system prop names for this component (for DOM filtering).
    pub system_prop_names: Vec<String>,
    pub span: Span,
    /// When true, `tag` is a component identifier reference (asComponent).
    /// When false (default), `tag` is a string literal (asElement).
    pub is_component_element: bool,
}

#[derive(Debug, Clone)]
pub struct VariantPropConfig {
    pub prop: String,
    pub options: Vec<String>,
    pub default: Option<String>,
}

/// Generate the createComponent() replacement expression.
///
/// When `is_component_element` is true the first argument is an identifier
/// reference (preserving the original import).  When false it is a string
/// literal (asElement HTML tag name).
pub fn generate_replacement(comp: &ComponentReplacement) -> String {
    let config = build_runtime_config(comp);
    if comp.is_component_element {
        // asComponent: first arg is an identifier, not a string literal
        format!(
            "createComponent({}, '{}', {})",
            comp.tag, comp.class_name, config
        )
    } else {
        format!(
            "createComponent('{}', '{}', {})",
            comp.tag, comp.class_name, config
        )
    }
}

/// Build the runtime config object as a JSON string.
fn build_runtime_config(comp: &ComponentReplacement) -> String {
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

    // States
    if !comp.state_names.is_empty() {
        config.insert("states".to_string(), json!(comp.state_names));
    }

    // System props (from .groups())
    if let Some(sp) = &comp.system_props {
        if !sp.is_empty() {
            config.insert("systemProps".to_string(), json!(sp));
        }
    }

    // System prop names (for DOM filtering)
    if !comp.system_prop_names.is_empty() {
        config.insert("systemPropNames".to_string(), json!(comp.system_prop_names));
    }

    serde_json::to_string(&serde_json::Value::Object(config)).unwrap_or_else(|_| "{}".to_string())
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
    let import_lines = format!(
        "import {{ createComponent }} from '@animus-ui/runtime';\nimport '{}';\n",
        css_module_id
    );

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
            state_names: vec![],
            system_props: None,
            system_prop_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
        };
        let result = generate_replacement(&comp);
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
            state_names: vec![],
            system_props: None,
            system_prop_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
        };
        let result = generate_replacement(&comp);
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
            state_names: vec!["loading".to_string(), "disabled".to_string()],
            system_props: None,
            system_prop_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
        };
        let result = generate_replacement(&comp);
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
        assert!(result.contains("import { createComponent } from '@animus-ui/runtime';"));
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
            state_names: vec![],
            system_props: None,
            system_prop_names: vec![],
            span: Span::new(0, 0),
            is_component_element: false,
        };
        let result = generate_replacement(&comp);
        assert!(result.contains("{}"));
    }

    #[test]
    fn generate_with_system_props() {
        let mut p_map = HashMap::new();
        p_map.insert("8".to_string(), "animus-u-aabbccdd".to_string());
        p_map.insert("16".to_string(), "animus-u-11223344".to_string());
        let mut sp = HashMap::new();
        sp.insert("p".to_string(), p_map);

        let comp = ComponentReplacement {
            binding: "Box".to_string(),
            tag: "div".to_string(),
            class_name: "animus-Box-deadbeef".to_string(),
            variant_config: vec![],
            state_names: vec![],
            system_props: Some(sp),
            system_prop_names: vec![],
            span: Span::new(0, 10),
            is_component_element: false,
        };
        let result = generate_replacement(&comp);
        assert!(result.contains("\"systemProps\""));
        assert!(result.contains("\"p\""));
        assert!(result.contains("\"animus-u-aabbccdd\""));
        assert!(result.contains("\"animus-u-11223344\""));
    }

    #[test]
    fn generate_with_system_prop_names() {
        let comp = ComponentReplacement {
            binding: "Box".to_string(),
            tag: "div".to_string(),
            class_name: "animus-Box-deadbeef".to_string(),
            variant_config: vec![],
            state_names: vec![],
            system_props: None,
            system_prop_names: vec!["p".to_string(), "mt".to_string(), "display".to_string()],
            span: Span::new(0, 10),
            is_component_element: false,
        };
        let result = generate_replacement(&comp);
        assert!(result.contains("\"systemPropNames\""));
        assert!(result.contains("\"p\""));
        assert!(result.contains("\"mt\""));
        assert!(result.contains("\"display\""));
    }

    #[test]
    fn generate_as_component_uses_identifier() {
        let comp = ComponentReplacement {
            binding: "NavLink".to_string(),
            tag: "NextLink".to_string(),
            class_name: "animus-NavLink-abcd1234".to_string(),
            variant_config: vec![],
            state_names: vec![],
            system_props: None,
            system_prop_names: vec![],
            span: Span::new(0, 10),
            is_component_element: true,
        };
        let result = generate_replacement(&comp);
        // Tag must be an identifier reference, not a string literal
        assert!(result.contains("createComponent(NextLink, 'animus-NavLink-abcd1234'"));
        // Must NOT wrap tag in quotes
        assert!(!result.contains("createComponent('NextLink'"));
    }

    // ── Dead import stripping tests ───────────────────────────────────────────

    #[test]
    fn strips_dead_import_when_all_bindings_extracted() {
        // The @animus-ui/core import should be removed when all its bindings are extracted.
        let source = "import { animus } from '@animus-ui/core';\nconst Box = createComponent('div', 'animus-Box-abc', {});";
        let mut replacements: Vec<SourceReplacement> = vec![SourceReplacement {
            // Replace a dummy span (no actual chain text in this constructed source)
            span: Span::new(41, 41),
            replacement: String::new(),
        }];
        // Insert a dummy replacement so apply_replacements doesn't early-return
        // We use a zero-length span at a position that won't affect the output
        let result = apply_replacements(
            source,
            &mut replacements,
            "virtual:animus/test.css",
            &["@animus-ui/core"],
            &["animus"],
        );
        assert!(!result.contains("import { animus } from '@animus-ui/core'"));
        assert!(result.contains("import { createComponent } from '@animus-ui/runtime'"));
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
}
