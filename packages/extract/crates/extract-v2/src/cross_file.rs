//! Cross-file fact algebra (row 06 Task 06.2) — the phase that consumes
//! per-file FACTS and produces project-level facts, with NO AST access
//! anywhere (the D4 outcome made this a pure data phase).
//!
//! Bug-compatibility contract (design.md D3), mirrored from v1
//! project_analyzer Phase 5b semantics as adjudicated at inc 11:
//!  - global component names = extractable chain bindings (all files);
//!  - member-expression bindings = compose families' `family.slot` keys;
//!  - per-file ALIAS AUGMENTATION: a named import whose IMPORTED name
//!    matches a known component NAME adds its LOCAL name for that file —
//!    no re-export following (v1 witnessed);
//!  - rendered components: asClass chains and ALL compose slot bindings
//!    unconditionally (v1 comment, project_analyzer ~1514-1530), plus
//!    JSX tags / createElement matches per file (ledger records the name
//!    AS WRITTEN — the local alias);
//!  - variant/state configs per binding derive from variant/states stage
//!    facts (config-independent); system-prop maps need prop config and
//!    ride with row 07's config inputs.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::chain_walk::TerminalKind;
use crate::facts::{ChainFacts, FileFacts, StageFacts};
use crate::usage_facts::{TagFact, UsageFact};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossFileFacts {
    /// All extractable component binding names, project-wide.
    pub component_names: BTreeSet<String>,
    /// Bindings whose chains terminate in `.asClass()`.
    pub class_resolvers: BTreeSet<String>,
    /// `Family.Slot` dotted key → slot binding name.
    pub member_bindings: BTreeMap<String, String>,
    /// v1-ledger-compatible rendered set (names as written at use sites).
    pub rendered_components: BTreeSet<String>,
    /// binding → variant prop → option names (from variant stage facts).
    pub variant_options: BTreeMap<String, BTreeMap<String, BTreeSet<String>>>,
    /// binding → state names (from states stage facts).
    pub state_names: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Default)]
struct ComponentMetadata {
    component_names: BTreeSet<String>,
    class_resolvers: BTreeSet<String>,
    member_bindings: BTreeMap<String, String>,
    variant_options: BTreeMap<String, BTreeMap<String, BTreeSet<String>>>,
    state_names: BTreeMap<String, BTreeSet<String>>,
}

fn collect_component_metadata(files: &BTreeMap<String, FileFacts>) -> ComponentMetadata {
    let mut metadata = ComponentMetadata::default();
    for file in files.values() {
        collect_file_metadata(&mut metadata, file);
    }
    metadata
}

fn collect_file_metadata(metadata: &mut ComponentMetadata, file: &FileFacts) {
    for chain in &file.chains {
        collect_chain_metadata(metadata, chain);
    }
    for family in &file.compose {
        let Some(family_binding) = &family.family_binding else {
            continue;
        };
        for (slot, binding) in &family.slots {
            metadata
                .member_bindings
                .insert(format!("{family_binding}.{slot}"), binding.clone());
            metadata.component_names.insert(binding.clone());
        }
    }
}

fn collect_chain_metadata(metadata: &mut ComponentMetadata, chain: &ChainFacts) {
    let descriptor = &chain.descriptor;
    if !descriptor.extractable {
        return;
    }

    metadata
        .component_names
        .insert(descriptor.binding.clone());
    if descriptor.terminal == TerminalKind::AsClass {
        metadata
            .class_resolvers
            .insert(descriptor.binding.clone());
    }
    for stage in &chain.stages {
        collect_stage_metadata(metadata, &descriptor.binding, stage);
    }
}

fn collect_stage_metadata(
    metadata: &mut ComponentMetadata,
    binding: &str,
    stage: &StageFacts,
) {
    let Some(value) = &stage.value else {
        return;
    };

    match stage.method.as_str() {
        "variant" => {
            let prop = value["prop"].as_str().unwrap_or("variant").to_string();
            let options = value["variants"]
                .as_object()
                .into_iter()
                .flat_map(|variants| variants.keys())
                .cloned();
            metadata
                .variant_options
                .entry(binding.to_string())
                .or_default()
                .entry(prop)
                .or_default()
                .extend(options);
        }
        "states" => {
            let Some(states) = value.as_object() else {
                return;
            };
            metadata
                .state_names
                .entry(binding.to_string())
                .or_default()
                .extend(states.keys().cloned());
        }
        _ => {}
    }
}

fn collect_rendered_components(
    files: &BTreeMap<String, FileFacts>,
    metadata: &ComponentMetadata,
) -> BTreeSet<String> {
    let mut rendered_components = metadata.class_resolvers.clone();
    // v1: asClass chains and ALL compose slot bindings are unconditionally
    // rendered.
    rendered_components.extend(metadata.member_bindings.values().cloned());

    for file in files.values() {
        let augmented = augmented_component_names(file, metadata);
        rendered_components.extend(
            file.usage
                .iter()
                .filter_map(|usage| {
                    rendered_component_for_usage(
                        usage,
                        &augmented,
                        &metadata.member_bindings,
                    )
                })
                .map(str::to_owned),
        );
    }

    rendered_components
}

fn augmented_component_names(
    file: &FileFacts,
    metadata: &ComponentMetadata,
) -> BTreeSet<String> {
    let mut augmented = metadata.component_names.clone();
    augmented.extend(
        file.imports
            .iter()
            .filter(|import| metadata.component_names.contains(&import.imported))
            .map(|import| import.local.clone()),
    );
    augmented
}

fn rendered_component_for_usage<'a>(
    usage: &'a UsageFact,
    augmented: &'a BTreeSet<String>,
    member_bindings: &'a BTreeMap<String, String>,
) -> Option<&'a str> {
    match usage {
        UsageFact::Element {
            tag: TagFact::Ident(name),
            ..
        } if augmented.contains(name) => Some(name),
        UsageFact::Element {
            tag: TagFact::Member(key),
            ..
        } => member_bindings.get(key).map(String::as_str),
        UsageFact::CreateElement {
            ident: Some(name), ..
        } if augmented.contains(name) => Some(name),
        UsageFact::CreateElement {
            ident: None,
            member: Some(key),
            ..
        } => member_bindings.get(key).map(String::as_str),
        _ => None,
    }
}

pub fn resolve_cross_file(files: &BTreeMap<String, FileFacts>) -> CrossFileFacts {
    let metadata = collect_component_metadata(files);
    let rendered_components = collect_rendered_components(files, &metadata);
    let ComponentMetadata {
        component_names,
        class_resolvers,
        member_bindings,
        variant_options,
        state_names,
    } = metadata;

    CrossFileFacts {
        component_names,
        class_resolvers,
        member_bindings,
        rendered_components,
        variant_options,
        state_names,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::extract_file_facts;
    use crate::owned_ast::{OwnedAst, ParseCounter};

    fn project(entries: &[(&str, &str)]) -> BTreeMap<String, FileFacts> {
        let counter = ParseCounter::new(0);
        entries
            .iter()
            .map(|(path, source)| {
                let ast = OwnedAst::parse(path.to_string(), source.to_string(), &counter);
                (path.to_string(), extract_file_facts(&ast))
            })
            .collect()
    }

    #[test]
    fn metadata_collection_does_not_depend_on_usage() {
        let files = project(&[(
            "facts.tsx",
            "export const Card = ds.variant({ prop: 'tone', variants: { quiet: {}, loud: {} } }).states({ selected: {} }).asClass();\nconst Root = ds.styles({}).asElement('div');\nexport const Family = compose({ Root }, { shared: {} });",
        )]);

        let metadata = collect_component_metadata(&files);

        assert!(metadata.component_names.contains("Card"));
        assert!(metadata.component_names.contains("Root"));
        assert!(metadata.class_resolvers.contains("Card"));
        assert_eq!(metadata.member_bindings["Family.Root"], "Root");
        assert!(metadata.variant_options["Card"]["tone"].contains("quiet"));
        assert!(metadata.state_names["Card"].contains("selected"));
    }

    #[test]
    fn non_object_states_do_not_create_empty_metadata() {
        let files = project(&[(
            "facts.tsx",
            "const STATES = 'not-an-object';\nexport const Card = ds.states(STATES).asClass();",
        )]);

        let metadata = collect_component_metadata(&files);

        assert!(!metadata.state_names.contains_key("Card"));
    }

    #[test]
    fn rendered_usage_resolves_from_collected_metadata() {
        let files = project(&[
            (
                "button.tsx",
                "export const Button = ds.styles({ p: 4 }).asElement('button');",
            ),
            (
                "app.tsx",
                "import { Button as TestButton } from './button';\nexport const App = () => <TestButton p={2} />;",
            ),
        ]);
        let metadata = collect_component_metadata(&files);

        let rendered = collect_rendered_components(&files, &metadata);

        assert!(rendered.contains("TestButton"));
        assert!(!rendered.contains("Button"));
    }

    #[test]
    fn alias_import_renders_under_local_name() {
        let files = project(&[
            (
                "button.tsx",
                "export const Button = ds.styles({ p: 4 }).asElement('button');",
            ),
            (
                "app.tsx",
                "import { Button as TestButton } from './button';\nexport const App = () => <TestButton p={2} />;",
            ),
        ]);
        let cf = resolve_cross_file(&files);
        assert!(cf.rendered_components.contains("TestButton"));
        assert!(!cf.rendered_components.contains("Button"));
    }

    #[test]
    fn as_class_and_compose_slots_render_unconditionally() {
        let files = project(&[(
            "mix.tsx",
            "export const card = ds.styles({ p: 8 }).asClass();\nconst Root = ds.styles({}).asElement('div');\nexport const Fam = compose({ Root }, { shared: {} });",
        )]);
        let cf = resolve_cross_file(&files);
        assert!(cf.rendered_components.contains("card"));
        assert!(cf.rendered_components.contains("Root"));
        assert!(cf.member_bindings.contains_key("Fam.Root"));
    }

    #[test]
    fn variant_and_state_configs_derive_from_facts() {
        let files = project(&[(
            "btn.tsx",
            "export const Btn = ds\n  .variant({ prop: 'size', variants: { sm: {}, lg: {} } })\n  .states({ loading: {}, disabled: {} })\n  .asElement('button');",
        )]);
        let cf = resolve_cross_file(&files);
        let opts = &cf.variant_options["Btn"]["size"];
        assert!(opts.contains("sm") && opts.contains("lg"));
        assert!(cf.state_names["Btn"].contains("loading"));
    }

    #[test]
    fn member_tags_resolve_and_bailed_chains_do_not_register() {
        let files = project(&[(
            "fam.tsx",
            "const Root = ds.styles({}).asElement('div');\nexport const Fam = compose({ Root }, { shared: {} });\nexport const Bad = ds.mystery({ x: 1 }).asElement('div');\nexport const App = () => <Fam.Root />;",
        )]);
        let cf = resolve_cross_file(&files);
        assert!(cf.rendered_components.contains("Root"));
        assert!(!cf.component_names.contains("Bad"));
    }
}
