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
pub use config::{prop_name_list_export, PropNameLists};
pub(crate) use config::{prop_name_list, superseded_props, system_superseded_props};

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
    /// The class name the analysis gave the component; absent, the binding's
    /// location names it.
    pub class_name: Option<String>,
    /// Sorted, deduped union of active system props and custom prop names.
    pub system_prop_names: Vec<String>,
    /// Sorted active group names.
    pub system_group_names: Vec<String>,
    /// True when any system prop name is used dynamically.
    pub has_dynamic_props: bool,
    /// prop → value key → utility class.
    pub custom_prop_class_map: Option<HashMap<String, HashMap<String, String>>>,
    pub custom_dynamic_config: Option<HashMap<String, DynamicPropMeta>>,
    /// Sorted callback props whose `custom_prop_class_map` keys are typed
    /// value keys.
    pub typed_custom_props: Vec<String>,
    /// The component has an active system prop bound to a configured
    /// transform, so its config reads the shared `typedSystemProps` list.
    pub reads_typed_system_props: bool,
    /// Post-merge chain config for extension children, folding in the
    /// parent's variant/state/compound config. None for non-extensions.
    pub merged_config: Option<MergedChainConfig>,
    /// The extension inherits callbacks from its parent but delivers none,
    /// so its replacement no longer names the parent.
    pub drops_parent_reference: bool,
    /// System prop → the later-defined props that take effect over it when
    /// one element sets both (`superseded_props`).
    pub superseded_by: BTreeMap<String, Vec<String>>,
    /// The name scope of the component's custom slots
    /// (`css::slot_names`), present when it has any.
    pub slot_scope: Option<String>,
    /// The key of the shared `systemPropNames` list the config references
    /// (`PropNameLists`); absent, the list is inline.
    pub prop_names_key: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct MergedChainConfig {
    /// (prop, options, default) per variant.
    pub variant_config: Vec<(String, Vec<String>, Option<String>)>,
    /// Compound (sorted conditions, class_name) — parent-first.
    pub compound_configs: Vec<(BTreeMap<String, Value>, String)>,
    /// State names, the inherited ones before the extension's own.
    pub state_names: Vec<String>,
}

/// The component's class name: the analysis's, or its binding's location's.
pub(crate) fn component_class_name(
    filename: &str,
    binding: &str,
    prefix: &str,
    payload: Option<&ReplacementPayload>,
) -> String {
    payload
        .and_then(|p| p.class_name.clone())
        .unwrap_or_else(|| class_name_for(filename, binding, prefix))
}

/// The local names a transformed module gives every import the transform
/// generates, from the system-props module and from the runtime: each
/// export's own name, or the first free `name$n` where the module already
/// uses that name, so a generated import never collides with the module's
/// own bindings.
#[derive(Debug, Clone)]
pub struct GeneratedNames {
    pub create_component: GeneratedName,
    pub create_class_resolver: GeneratedName,
    pub create_composed_family: GeneratedName,
    pub create_composed_family_with_context: GeneratedName,
    pub system_prop_map: GeneratedName,
    pub system_prop_groups: GeneratedName,
    pub typed_system_props: GeneratedName,
    pub dynamic_prop_config: GeneratedName,
    pub transforms: GeneratedName,
    pub animus_tables: GeneratedName,
    pub superseded_by: GeneratedName,
    /// Each shared `systemPropNames` list the module references, by key.
    prop_name_lists: FxHashMap<String, GeneratedName>,
}

/// One generated import: the export it reads and the local name the module
/// binds it to, which is what generated code writes.
#[derive(Debug, Clone)]
pub struct GeneratedName {
    export: String,
    local: String,
}

impl GeneratedName {
    /// The import specifier, `export` or `export as local`.
    pub fn specifier(&self) -> String {
        if self.export == self.local { self.local.clone() } else { format!("{} as {}", self.export, self.local) }
    }
}

impl std::fmt::Display for GeneratedName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.local)
    }
}

impl GeneratedNames {
    /// Each export under its own name, for replacement text no module
    /// surrounds.
    pub fn exports() -> Self {
        Self::chosen(|name| name.to_string(), [])
    }

    /// Names that no identifier in `source` spells once its Unicode escapes
    /// are decoded: `createComponent\u00241` binds `createComponent$1`, and
    /// leaves `createComponent` free; for the fixed exports and the shared
    /// lists keyed `list_keys`.
    pub fn free_in<'a>(source: &str, list_keys: impl IntoIterator<Item = &'a String>) -> Self {
        let source = decode_unicode_escapes(source);
        Self::chosen(
            |name| {
                std::iter::once(name.to_string())
                    .chain((1..).map(|n| format!("{name}${n}")))
                    .find(|candidate| !spells_identifier(&source, candidate))
                    .expect("an unbounded sequence has a free name")
            },
            list_keys,
        )
    }

    fn chosen<'a>(local: impl Fn(&str) -> String, list_keys: impl IntoIterator<Item = &'a String>) -> Self {
        let name = |export: String| GeneratedName { local: local(&export), export };
        Self {
            create_component: name("createComponent".into()),
            create_class_resolver: name("createClassResolver".into()),
            create_composed_family: name("createComposedFamily".into()),
            create_composed_family_with_context: name("createComposedFamilyWithContext".into()),
            system_prop_map: name("systemPropMap".into()),
            system_prop_groups: name("systemPropGroups".into()),
            typed_system_props: name("typedSystemProps".into()),
            dynamic_prop_config: name("dynamicPropConfig".into()),
            transforms: name("transforms".into()),
            animus_tables: name("animusTables".into()),
            superseded_by: name("supersededBy".into()),
            prop_name_lists: list_keys
                .into_iter()
                .map(|key| (key.clone(), name(config::prop_name_list_export(key))))
                .collect(),
        }
    }

    /// The import of the shared list keyed `key`: the one `free_in` chose,
    /// or the export's own name.
    pub fn prop_name_list(&self, key: &str) -> GeneratedName {
        self.prop_name_lists.get(key).cloned().unwrap_or_else(|| {
            let export = config::prop_name_list_export(key);
            GeneratedName { local: export.clone(), export }
        })
    }
}

/// `source` with each `\uXXXX` and `\u{X…}` escape replaced by the
/// character it encodes, as an identifier written with escapes names it.
/// Escapes in strings and comments decode too; neither binds a name.
fn decode_unicode_escapes(source: &str) -> std::borrow::Cow<'_, str> {
    if !source.contains("\\u") {
        return std::borrow::Cow::Borrowed(source);
    }
    let mut decoded = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(at) = rest.find("\\u") {
        decoded.push_str(&rest[..at]);
        let after = &rest[at + 2..];
        let (digits, consumed) = match after.strip_prefix('{') {
            Some(braced) => braced.find('}').map_or(("", 0), |end| (&braced[..end], end + 2)),
            None => (after.get(..4).unwrap_or(""), 4),
        };
        let encoded = Some(digits)
            .filter(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_hexdigit()))
            .and_then(|digits| u32::from_str_radix(digits, 16).ok())
            .and_then(char::from_u32);
        match encoded {
            Some(character) => {
                decoded.push(character);
                rest = &after[consumed..];
            }
            None => {
                decoded.push_str("\\u");
                rest = after;
            }
        }
    }
    decoded.push_str(rest);
    std::borrow::Cow::Owned(decoded)
}

/// Whether `name` occurs in `source` as a whole identifier: in code, a
/// string or a comment alike, which can only make a name look taken.
fn spells_identifier(source: &str, name: &str) -> bool {
    let continues = oxc::syntax::identifier::is_identifier_part;
    source.match_indices(name).any(|(at, _)| {
        !source[..at].chars().next_back().is_some_and(continues)
            && !source[at + name.len()..].chars().next().is_some_and(continues)
    })
}

/// What a compiled config reads beyond its chain: the system's prop groups,
/// and whether each variant lists its options.
#[derive(Clone, Copy)]
pub struct ConfigInputs<'a> {
    pub group_registry: &'a FxHashMap<String, Vec<String>>,
    /// The official runtimes read a variant's prop and default only; a
    /// custom `runtimeImport`, and the manifest's descriptor that tooling
    /// reads, keep the list.
    pub variant_options: bool,
    /// The runtime import is one Animus ships, whose factories are pure at
    /// construction. A custom `runtimeImport` promises suitable exports, not
    /// effect-free ones (its resolver may register the class it makes), so
    /// its calls stay unmarked.
    pub trusted_factories: bool,
}

/// Build the replacement call text for one chain.
/// The annotation that lets a bundler drop an emitted factory call whose
/// value is unused.
pub const PURE_ANNOTATION: &str = "/* @__PURE__ */ ";

pub fn generate_replacement(
    filename: &str,
    chain: &ChainFacts,
    prefix: &str,
    payload: Option<&ReplacementPayload>,
    inputs: ConfigInputs<'_>,
    names: &GeneratedNames,
) -> Result<String, AssembleError> {
    let d = &chain.descriptor;
    let class_name = component_class_name(filename, &d.binding, prefix, payload);
    let config = build_config(filename, &d.binding, chain, prefix, payload, inputs, names)?;
    let has_system_props = payload.is_some_and(|p| !p.system_prop_names.is_empty());
    let has_dynamic_props = payload.is_some_and(|p| p.has_dynamic_props);
    let maps = match (has_system_props, has_dynamic_props) {
        (true, true) => format!(", {}, {}", names.system_prop_map, names.dynamic_prop_config),
        (true, false) => format!(", {}", names.system_prop_map),
        (false, _) => String::new(),
    };

    // The runtime factories are pure at construction: they allocate the
    // component and its closures, read their arguments and register nothing,
    // so a bundler may drop a call whose value is unused. Every argument is
    // Animus's: literals, generated names, a captured callback (a function or
    // arrow expression, or an identifier), a parent's delivered callbacks.
    // The one user expression is an asComponent target; a member path
    // (`motion.div`) can run a getter, so only an identifier target is marked.
    let pure = inputs.trusted_factories && (d.terminal != TerminalKind::AsComponent || !d.tag.contains('.'));
    let mark = if pure { PURE_ANNOTATION } else { "" };
    Ok(if d.terminal == TerminalKind::AsClass {
        format!("{mark}{}('{}', {}{})", names.create_class_resolver, class_name, config, maps)
    } else {
        let tag = if d.terminal == TerminalKind::AsComponent {
            d.tag.clone()
        } else {
            format!("'{}'", d.tag)
        };
        format!("{mark}{}({}, '{}', {}{})", names.create_component, tag, class_name, config, maps)
    })
}

/// Assemble replacement plan entries for one file's extractable,
/// non-fatal chains.
pub fn assemble_replacements(
    filename: &str,
    facts: &FileFacts,
    prefix: &str,
    payloads: Option<&HashMap<String, ReplacementPayload>>,
    inputs: ConfigInputs<'_>,
    names: &GeneratedNames,
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
        let text = generate_replacement(filename, chain, prefix, payload, inputs, names)?;
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
        let text = generate_replacement("a.tsx", &facts.chains[0], "animus", None, ConfigInputs { group_registry: &FxHashMap::default(), variant_options: false, trusted_factories: true }, &GeneratedNames::exports()).unwrap();
        let class = class_name_for("a.tsx", "Box", "animus");
        assert_eq!(text, format!("/* @__PURE__ */ createComponent('div', '{class}', {{}})"));
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
        let text = generate_replacement("b.tsx", &facts.chains[0], "animus", None, ConfigInputs { group_registry: &FxHashMap::default(), variant_options: false, trusted_factories: true }, &GeneratedNames::exports()).unwrap();
        // Compound conditions are sorted (size before variant) for
        // determinism.
        assert!(text.contains(r#""conditions":{"size":"sm","variant":"ghost"}"#), "got {text}");
        // Contract: an emitted variant config carries no options list for
        // the official runtime, which reads only the prop and its default;
        // a custom runtime's carries the list.
        assert!(text.contains(r#""variants":{"size":{"default":"sm"}}"#), "got {text}");
        let custom = generate_replacement("b.tsx", &facts.chains[0], "animus", None, ConfigInputs { group_registry: &FxHashMap::default(), variant_options: true, trusted_factories: true }, &GeneratedNames::exports()).unwrap();
        assert!(custom.contains(r#""variants":{"size":{"options":["sm","lg"],"default":"sm"}}"#), "got {custom}");
        assert!(text.contains(r#""states":["loading"]"#));
        // A positional compound name is the runtime's to derive.
        assert!(!text.contains("--compound-0"), "got {text}");
    }

    #[test]
    fn system_stage_fails_loud_pending_config() {
        let facts = facts_for(
            "c.tsx",
            "export const Box = ds.system({ space: true }).asElement('div');",
        );
        let err = generate_replacement("c.tsx", &facts.chains[0], "animus", None, ConfigInputs { group_registry: &FxHashMap::default(), variant_options: false, trusted_factories: true }, &GeneratedNames::exports()).unwrap_err();
        match err {
            AssembleError::NeedsConfig(msg) => assert!(msg.contains("row 07")),
        }
    }

    #[test]
    fn class_resolver_shape() {
        let facts = facts_for("d.tsx", "export const card = ds.styles({ p: 8 }).asClass();");
        let text = generate_replacement("d.tsx", &facts.chains[0], "animus", None, ConfigInputs { group_registry: &FxHashMap::default(), variant_options: false, trusted_factories: true }, &GeneratedNames::exports()).unwrap();
        assert!(text.starts_with("/* @__PURE__ */ createClassResolver('animus-card-"), "got {text}");
    }

    /// Contract: an emitted component factory call carries a pure
    /// annotation, and a user expression is never covered by one. The
    /// factories are pure at construction; the arguments Animus emits are
    /// literals, generated names and captured callbacks (a function or arrow
    /// expression, or an identifier). An asComponent target read through a
    /// member path can run a getter, so that call stays unmarked, and so does
    /// every call into a custom runtimeImport.
    #[test]
    fn emitted_factory_calls_are_pure_and_never_cover_a_user_expression() {
        let replacement = |file: &str, source: &str| {
            let facts = facts_for(file, source);
            generate_replacement(file, &facts.chains[0], "animus", None, ConfigInputs { group_registry: &FxHashMap::default(), variant_options: false, trusted_factories: true }, &GeneratedNames::exports()).unwrap()
        };
        for (file, source) in [
            ("a.tsx", "export const Box = ds.styles({ p: 4 }).asElement('div');"),
            ("b.tsx", "import { Link } from 'router';\nexport const Anchor = ds.styles({ p: 4 }).asComponent(Link);"),
            ("c.tsx", "export const card = ds.styles({ p: 8 }).asClass();"),
        ] {
            let text = replacement(file, source);
            assert!(text.starts_with(PURE_ANNOTATION), "unmarked: {text}");
            assert_eq!(text.matches("@__PURE__").count(), 1, "{text}");
        }
        let member = replacement("d.tsx", "import { motion } from 'motion';\nexport const Fade = ds.styles({ p: 4 }).asComponent(motion.div);");
        assert!(!member.contains("@__PURE__"), "a member target is marked: {member}");
        assert!(member.starts_with("createComponent(motion.div,"), "{member}");
        // A custom runtimeImport's factories may register what they make.
        let facts = facts_for("e.tsx", "export const card = ds.styles({ p: 8 }).asClass();");
        let custom = generate_replacement("e.tsx", &facts.chains[0], "animus", None, ConfigInputs { group_registry: &FxHashMap::default(), variant_options: true, trusted_factories: false }, &GeneratedNames::exports()).unwrap();
        assert!(custom.starts_with("createClassResolver("), "a custom runtime's call is marked: {custom}");
    }
}
