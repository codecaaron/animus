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
use crate::facts::FileFacts;
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

pub fn resolve_cross_file(files: &BTreeMap<String, FileFacts>) -> CrossFileFacts {
    let mut component_names = BTreeSet::new();
    let mut class_resolvers = BTreeSet::new();
    let mut member_bindings = BTreeMap::new();
    let mut variant_options: BTreeMap<String, BTreeMap<String, BTreeSet<String>>> = BTreeMap::new();
    let mut state_names: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    for ff in files.values() {
        for chain in &ff.chains {
            let d = &chain.descriptor;
            if !d.extractable {
                continue;
            }
            component_names.insert(d.binding.clone());
            if d.terminal == TerminalKind::AsClass {
                class_resolvers.insert(d.binding.clone());
            }
            for stage in &chain.stages {
                match stage.method.as_str() {
                    "variant" => {
                        if let Some(value) = &stage.value {
                            let prop = value["prop"].as_str().unwrap_or("variant").to_string();
                            let options: BTreeSet<String> = value["variants"]
                                .as_object()
                                .map(|m| m.keys().cloned().collect())
                                .unwrap_or_default();
                            variant_options
                                .entry(d.binding.clone())
                                .or_default()
                                .entry(prop)
                                .or_default()
                                .extend(options);
                        }
                    }
                    "states" => {
                        if let Some(value) = &stage.value {
                            if let Some(m) = value.as_object() {
                                state_names
                                    .entry(d.binding.clone())
                                    .or_default()
                                    .extend(m.keys().cloned());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        for fam in &ff.compose {
            if let Some(family_binding) = &fam.family_binding {
                for (slot, binding) in &fam.slots {
                    member_bindings.insert(format!("{family_binding}.{slot}"), binding.clone());
                    component_names.insert(binding.clone());
                }
            }
        }
    }

    let mut rendered_components = BTreeSet::new();
    // v1: asClass chains and ALL compose slot bindings are unconditionally
    // rendered.
    rendered_components.extend(class_resolvers.iter().cloned());
    rendered_components.extend(member_bindings.values().cloned());

    for ff in files.values() {
        // Per-file alias augmentation (local name → known by imported NAME).
        let mut augmented = component_names.clone();
        for imp in &ff.imports {
            if component_names.contains(&imp.imported) {
                augmented.insert(imp.local.clone());
            }
        }
        for u in &ff.usage {
            match u {
                UsageFact::Element { tag, .. } => match tag {
                    TagFact::Ident(name) => {
                        if augmented.contains(name) {
                            rendered_components.insert(name.clone());
                        }
                    }
                    TagFact::Member(key) => {
                        if let Some(binding) = member_bindings.get(key) {
                            rendered_components.insert(binding.clone());
                        }
                    }
                },
                UsageFact::CreateElement { ident, member, .. } => {
                    if let Some(name) = ident {
                        if augmented.contains(name) {
                            rendered_components.insert(name.clone());
                        }
                    } else if let Some(key) = member {
                        if let Some(binding) = member_bindings.get(key) {
                            rendered_components.insert(binding.clone());
                        }
                    }
                }
            }
        }
    }

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
