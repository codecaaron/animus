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
}

pub struct VariantPropConfig {
    pub prop: String,
    pub options: Vec<String>,
    pub default: Option<String>,
}

/// Generate the createComponent() replacement expression.
pub fn generate_replacement(comp: &ComponentReplacement) -> String {
    let config = build_runtime_config(comp);
    format!(
        "createComponent('{}', '{}', {})",
        comp.tag, comp.class_name, config
    )
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
pub fn apply_replacements(
    source: &str,
    replacements: &mut [SourceReplacement],
    css_module_id: &str,
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

    // Add imports at the top
    let import_lines = format!(
        "import {{ createComponent }} from '@animus-ui/runtime';\nimport '{}';\n",
        css_module_id
    );

    // Insert after existing imports (find last import/require line)
    // For simplicity, prepend to the file
    format!("{}{}", import_lines, result)
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
        let result = apply_replacements(source, &mut replacements, "virtual:animus/test.css");
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
        let result = apply_replacements(source, &mut replacements, "test.css");
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
        };
        let result = generate_replacement(&comp);
        assert!(result.contains("\"systemPropNames\""));
        assert!(result.contains("\"p\""));
        assert!(result.contains("\"mt\""));
        assert!(result.contains("\"display\""));
    }
}
