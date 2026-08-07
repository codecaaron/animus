//! Replacement assembly (row 06 Task 06.3, facts-derivable subset):
//! per-component `createComponent`/`createClassResolver` call text from
//! FACTS — v1-exact template shapes and the inc-01-sorted config JSON.
//!
//! Config-dependent payloads (systemPropNames/groups, customPropMap,
//! customDynamicConfig) require prop-config/theme inputs and ride with
//! row 07; components that need them FAIL LOUD at transform time rather
//! than emitting a wrong template (G5 — never a silently wrong shape).
//!
//! v1 references: transform_emitter::generate_replacement (template
//! shapes), css_generator::{content_hash, make_class_name} (FNV-1a class
//! identity over "{filename}::{binding}" — stable across style edits,
//! the HMR-critical property), lib.rs process_chain (stable_id).
//!
//! Module layout — the public surface is re-exported here unchanged, so
//! `crate::assemble::X` resolves exactly as it did before the split:
//!
//!   `config`      — runtime-config JSON construction (v1 build_runtime_config)
//!   `source_edit` — consumed-import stripping + directive-prologue placement

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
    /// Component requires config-dependent payloads (row 07 inputs).
    NeedsConfig(String),
}

/// Config-dependent replacement payloads, computed by analyze_css (v1
/// Phase 5c/6 equivalents) and injected at transform time. A payload
/// entry exists for every pipeline SURVIVOR; chains without one are not
/// replaced (v1 silently skips non-manifest components).
#[derive(Debug, Clone, Default)]
pub struct ReplacementPayload {
    /// Sorted, deduped union of active system props + custom prop names
    /// (v1 Phase 5c 1462-1474).
    pub system_prop_names: Vec<String>,
    /// Sorted active group names (v1 system-stage group expansion).
    pub system_group_names: Vec<String>,
    /// v1 Phase 6 1617-1620: any system prop name is dynamically used.
    pub has_dynamic_props: bool,
    /// prop → value_key → utility class (v1 custom_prop_class_map).
    pub custom_prop_class_map: Option<HashMap<String, HashMap<String, String>>>,
    /// prop → dynamic meta (v1 custom_dynamic_config).
    pub custom_dynamic_config: Option<HashMap<String, DynamicPropMeta>>,
    /// POST-MERGE chain config for extension children (v1 908-929 merges
    /// parent variant/state/compound configs into the child replacement).
    /// None for non-extension chains — facts-derived config is used.
    pub merged_config: Option<MergedChainConfig>,
}

/// v1 ComponentReplacement config trio, post-extension-merge.
#[derive(Debug, Clone, Default)]
pub struct MergedChainConfig {
    /// (prop, options, default) in v1 variant_config order.
    pub variant_config: Vec<(String, Vec<String>, Option<String>)>,
    /// Compound (sorted conditions, class_name) — parent-first.
    pub compound_configs: Vec<(BTreeMap<String, Value>, String)>,
    /// State names, parent-appended-after-child per v1 925-928.
    pub state_names: Vec<String>,
}

/// v1 generate_replacement template shapes (no-system-props forms; the
/// system/dynamic forms require config and are row-07-gated upstream).
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
        // v1 replaces only manifest SURVIVORS: when payloads are supplied
        // (analyze ran), a chain absent from them was dropped by the
        // pipeline (silent eval failure) — mirror by not replacing it.
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

/// Fact construction shared by this module's tests and those of its
/// submodules — `source_edit`'s directive cases need real parsed prologue
/// facts, so the helper lives at the module root rather than being
/// duplicated per file.
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
        // The true FNV vector pin is cross-engine: the corpus oracle
        // compares v2 class names against v1 manifest class names.
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
        // Sorted compound conditions (size before variant) — the inc-01
        // determinism contract.
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
