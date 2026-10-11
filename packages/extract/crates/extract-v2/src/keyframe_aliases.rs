//! Raw animation strings that name a registered keyframes key rather than
//! its generated name (`animation: 'fadeIn 1s'`, with `fadeIn` registered
//! as `animus-kf-honfj9`). The emitted name matches no `@keyframes` rule,
//! so each is reported once per component that writes it, and at each use
//! that writes one. The value is never rewritten, and a name no collection
//! registers stays external CSS.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::facts::ChainFacts;
use crate::theme::{CssDeclaration, ResolveContext};

pub const RAW_ALIAS_STRING: &str = "animus.keyframes.raw-alias-string";

/// Each registered key, with every collection that registers it as
/// (`{collection}.{key}`, generated name).
#[derive(Debug)]
pub struct KeyframeKeys(BTreeMap<String, Vec<(String, String)>>);

/// A registered key a declaration writes raw.
#[derive(Debug)]
pub struct RawAlias {
    pub key: String,
    pub candidates: Vec<(String, String)>,
}

impl KeyframeKeys {
    pub fn from_blocks(blocks: Option<&Value>) -> Self {
        let mut keys: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
        for (collection, key, name) in crate::analyze_css::keyframe_names(blocks) {
            if let Some(name) = name {
                keys.entry(key.to_string()).or_default().push((format!("{collection}.{key}"), name.to_string()));
            }
        }
        Self(keys)
    }

    /// The raw aliases a style object writes at any depth, each once.
    pub fn in_styles(&self, styles: &Value, ctx: &ResolveContext) -> Vec<(CssDeclaration, RawAlias)> {
        self.in_style_objects([styles], ctx)
    }

    /// The raw aliases a chain's own style stages write, each once; an
    /// extension's inherited styles are its parent's to report.
    pub fn in_chain(&self, chain: &ChainFacts, ctx: &ResolveContext) -> Vec<(CssDeclaration, RawAlias)> {
        let styles = chain.stages.iter().flat_map(|stage| -> Vec<&Value> {
            let Some(value) = &stage.value else { return Vec::new() };
            match stage.method.as_str() {
                "styles" => vec![value],
                "variant" => value
                    .get("base")
                    .into_iter()
                    .chain(value.get("variants").and_then(Value::as_object).into_iter().flat_map(|options| options.values()))
                    .collect(),
                "states" => value.as_object().into_iter().flat_map(|states| states.values()).collect(),
                "compound" => stage.second_value.iter().collect(),
                _ => Vec::new(),
            }
        });
        self.in_style_objects(styles, ctx)
    }

    fn in_style_objects<'v>(
        &self,
        styles: impl IntoIterator<Item = &'v Value>,
        ctx: &ResolveContext,
    ) -> Vec<(CssDeclaration, RawAlias)> {
        let mut found = Vec::new();
        if !self.0.is_empty() {
            let mut seen = BTreeSet::new();
            for styles in styles {
                self.walk(styles, ctx, &mut found, &mut seen);
            }
        }
        found
    }

    fn walk(
        &self,
        styles: &Value,
        ctx: &ResolveContext,
        found: &mut Vec<(CssDeclaration, RawAlias)>,
        seen: &mut BTreeSet<String>,
    ) {
        let Some(entries) = styles.as_object() else { return };
        for (key, value) in entries {
            let responsive = crate::theme::is_responsive_value(value, ctx.breakpoint_keys);
            if value.is_object() && !responsive {
                // An unregistered alias block emits nothing, and reports so.
                if !key.starts_with('_') || ctx.selector_aliases.contains_key(key) {
                    self.walk(value, ctx, found, seen);
                }
                continue;
            }
            if !self.writes_animation(key, ctx) {
                continue;
            }
            let written: Vec<&Value> = match value.as_object() {
                Some(by_breakpoint) => by_breakpoint.values().collect(),
                None => vec![value],
            };
            for value in written {
                for declaration in crate::theme::resolve_prop(key, value, ctx) {
                    for alias in self.raw_aliases(&declaration) {
                        if seen.insert(alias.key.clone()) {
                            found.push((declaration.clone(), alias));
                        }
                    }
                }
            }
        }
    }

    /// Whether `key` can write an `animation` or `animation-name` whose
    /// value is the one authored: a transform's result is no raw string.
    fn writes_animation(&self, key: &str, ctx: &ResolveContext) -> bool {
        let transforms = ctx.config.get(key).is_some_and(|config| {
            config.transform.is_some() || config.transform_fn_source.is_some() || config.callback.is_some()
        });
        !transforms && crate::theme::entry_properties(key, ctx.config).iter().any(|property| is_animation(property))
    }

    /// The registered keys an `animation` or `animation-name` declaration
    /// names as identifiers of its comma-separated list, other than a key
    /// that already is a generated name.
    fn raw_aliases(&self, declaration: &CssDeclaration) -> Vec<RawAlias> {
        if !is_animation(&declaration.property) {
            return Vec::new();
        }
        let mut found: Vec<RawAlias> = Vec::new();
        for animation in crate::theme::split_top_level_commas(&declaration.value) {
            for word in animation.split_whitespace() {
                let Some(candidates) = self.0.get(word) else { continue };
                let generated = candidates.iter().any(|(_, name)| name == word);
                if !generated && !found.iter().any(|alias| alias.key == word) {
                    found.push(RawAlias { key: word.to_string(), candidates: candidates.clone() });
                }
            }
        }
        found
    }
}

fn is_animation(property: &str) -> bool {
    matches!(property, "animation" | "animation-name")
}
