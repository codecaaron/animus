//! Replacement assembly: per-component `createComponent` and
//! `createClassResolver` call text built from facts.

use std::collections::{BTreeMap, HashMap};

use rustc_hash::FxHashMap;

use serde_json::Value;

use crate::chain_walk::TerminalKind;
use crate::dynamic_meta::DynamicPropMeta;
use crate::facts::{ChainFacts, FileFacts};

pub use crate::ids::{class_name_for, content_hash, make_class_name};

mod config;
mod source_edit;

use config::build_config;

pub use source_edit::{
    consumed_import_removals, directive_and_imports, directive_prefix_and_body,
    strip_consumed_imports, strip_consumed_imports_with_removals,
};

#[derive(Debug)]
pub enum AssembleError {
    /// Component requires config-dependent payloads that were not supplied.
    NeedsConfig(String),
}

/// Config-dependent replacement payloads injected at transform time. One
/// entry exists per pipeline survivor; a chain without one is not replaced.
#[derive(Debug, Clone, Default)]
pub struct ReplacementPayload {
    /// Sorted, deduped union of active system props and custom prop names.
    pub system_prop_names: Vec<String>,
    /// Sorted active group names.
    pub system_group_names: Vec<String>,
    /// True when any system prop name is used dynamically.
    pub has_dynamic_props: bool,
    /// prop → value key → utility class.
    pub custom_prop_class_map: Option<HashMap<String, HashMap<String, String>>>,
    pub custom_dynamic_config: Option<HashMap<String, DynamicPropMeta>>,
    /// Post-merge chain config for extension children, folding in the
    /// parent's variant/state/compound config. None for non-extensions.
    pub merged_config: Option<MergedChainConfig>,
}

#[derive(Debug, Clone, Default)]
pub struct MergedChainConfig {
    /// (prop, options, default) per variant.
    pub variant_config: Vec<(String, Vec<String>, Option<String>)>,
    /// Compound (sorted conditions, class_name) — parent-first.
    pub compound_configs: Vec<(BTreeMap<String, Value>, String)>,
    /// State names, with the parent's appended after the child's.
    pub state_names: Vec<String>,
}

/// Build the replacement call text for one chain.
pub fn generate_replacement(
    filename: &str,
    chain: &ChainFacts,
    prefix: &str,
    payload: Option<&ReplacementPayload>,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Result<String, AssembleError> {
    let d = &chain.descriptor;
    let class_name = class_name_for(filename, &d.binding, prefix);
    let config = build_config(filename, &d.binding, chain, prefix, payload, group_registry)?;
    let has_system_props = payload.is_some_and(|p| !p.system_prop_names.is_empty());
    let has_dynamic_props = payload.is_some_and(|p| p.has_dynamic_props);

    Ok(if d.terminal == TerminalKind::AsClass {
        if has_system_props && has_dynamic_props {
            format!(
                "createClassResolver('{}', {}, systemPropMap, dynamicPropConfig)",
                class_name, config
            )
        } else if has_system_props {
            format!("createClassResolver('{}', {}, systemPropMap)", class_name, config)
        } else {
            format!("createClassResolver('{}', {})", class_name, config)
        }
    } else {
        let tag = if d.terminal == TerminalKind::AsComponent {
            d.tag.clone()
        } else {
            format!("'{}'", d.tag)
        };
        if has_system_props && has_dynamic_props {
            format!(
                "createComponent({}, '{}', {}, systemPropMap, dynamicPropConfig)",
                tag, class_name, config
            )
        } else if has_system_props {
            format!("createComponent({}, '{}', {}, systemPropMap)", tag, class_name, config)
        } else {
            format!("createComponent({}, '{}', {})", tag, class_name, config)
        }
    })
}

/// Assemble replacement plan entries for one file's extractable,
/// non-fatal chains.
pub fn assemble_replacements(
    filename: &str,
    facts: &FileFacts,
    prefix: &str,
    payloads: Option<&HashMap<String, ReplacementPayload>>,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Result<Vec<(u32, u32, String)>, AssembleError> {
    let mut out = Vec::new();
    for chain in &facts.chains {
        if !chain.descriptor.extractable || chain.fatal_error.is_some() {
            continue;
        }
        // When payloads are supplied, a chain absent from them was dropped
        // by the pipeline and must not be replaced.
        let payload = match payloads {
            Some(map) => match map.get(&chain.descriptor.binding) {
                Some(p) => Some(p),
                None => continue,
            },
            None => None,
        };
        let text = generate_replacement(filename, chain, prefix, payload, group_registry)?;
        out.push((chain.descriptor.span.0, chain.descriptor.span.1, text));
    }
    Ok(out)
}

/// Fact construction shared by this module's and its submodules' tests.
#[cfg(test)]
pub(crate) mod test_support {
    use crate::facts::{extract_file_facts, FileFacts};
    use crate::owned_ast::{OwnedAst, ParseCounter};

    pub(crate) fn facts_for(path: &str, source: &str) -> FileFacts {
        let counter = ParseCounter::new(0);
        let ast = OwnedAst::parse(path.to_string(), source.to_string(), &counter);
        extract_file_facts(&ast)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::facts_for;
    use super::*;

    #[test]
    fn class_name_shape() {
        let name = make_class_name("Box", "a.tsx::Box", "animus");
        assert!(name.starts_with("animus-Box-"));
        assert_eq!(name.len(), "animus-Box-".len() + 8);
        assert_eq!(content_hash("a"), content_hash("a"));
        assert_ne!(content_hash("a"), content_hash("b"));
    }

    #[test]
    fn simple_element_replacement_matches_v1_shape() {
        let facts = facts_for(
            "a.tsx",
            "export const Box = ds.styles({ p: 4 }).asElement('div');",
        );
        let text = generate_replacement("a.tsx", &facts.chains[0], "animus", None, &FxHashMap::default()).unwrap();
        let class = class_name_for("a.tsx", "Box", "animus");
        assert_eq!(text, format!("createComponent('div', '{class}', {{}})"));
    }

    #[test]
    fn variants_compounds_states_config_is_sorted_and_shaped() {
        let facts = facts_for(
            "b.tsx",
            r#"export const Btn = ds
                .variant({ prop: 'size', variants: { sm: {}, lg: {} }, defaultVariant: 'sm' })
                .compound({ variant: 'ghost', size: 'sm' }, { p: 1 })
                .states({ loading: {} })
                .asElement('button');"#,
        );
        let text = generate_replacement("b.tsx", &facts.chains[0], "animus", None, &FxHashMap::default()).unwrap();
        // Compound conditions are sorted (size before variant) for
        // determinism.
        assert!(text.contains(r#""conditions":{"size":"sm","variant":"ghost"}"#), "got {text}");
        assert!(text.contains(r#""variants":{"size":{"options":["sm","lg"],"default":"sm"}}"#) || text.contains(r#""variants":{"size":{"default":"sm","options":["sm","lg"]}}"#), "got {text}");
        assert!(text.contains(r#""states":["loading"]"#));
        assert!(text.contains("--compound-0"));
    }

    #[test]
    fn system_stage_fails_loud_pending_config() {
        let facts = facts_for(
            "c.tsx",
            "export const Box = ds.system({ space: true }).asElement('div');",
        );
        let err = generate_replacement("c.tsx", &facts.chains[0], "animus", None, &FxHashMap::default()).unwrap_err();
        match err {
            AssembleError::NeedsConfig(msg) => assert!(msg.contains("row 07")),
        }
    }

    #[test]
    fn class_resolver_shape() {
        let facts = facts_for("d.tsx", "export const card = ds.styles({ p: 8 }).asClass();");
        let text = generate_replacement("d.tsx", &facts.chains[0], "animus", None, &FxHashMap::default()).unwrap();
        assert!(text.starts_with("createClassResolver('animus-card-"), "got {text}");
    }
}
