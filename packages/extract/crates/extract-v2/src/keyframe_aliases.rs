//! Raw animation strings that name a registered keyframes key rather than
//! its generated name (`animation: 'fadeIn 1s'`, with `fadeIn` registered
//! as `animus-kf-honfj9`). The emitted name matches no `@keyframes` rule,
//! so each is reported once per component that writes it, and at each use
//! that writes one. The value is never rewritten, and a name no collection
//! registers stays external CSS.

use std::borrow::Cow;
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
                // Only a block that emits is read: an unregistered alias, an
                // unsupported at-rule or a prop given an object reports itself.
                if admits_block(key, ctx) {
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
    /// uses as an animation's name, other than one that is itself some
    /// registered generated name.
    fn raw_aliases(&self, declaration: &CssDeclaration) -> Vec<RawAlias> {
        let shorthand = match declaration.property.as_str() {
            "animation" => true,
            "animation-name" => false,
            _ => return Vec::new(),
        };
        let mut found: Vec<RawAlias> = Vec::new();
        for name in animation_names(&declaration.value, shorthand) {
            if self.0.values().flatten().any(|(_, generated)| *generated == name) {
                continue;
            }
            let Some(candidates) = self.0.get(name.as_ref()) else { continue };
            if !found.iter().any(|alias| alias.key == name) {
                found.push(RawAlias { key: name.into_owned(), candidates: candidates.clone() });
            }
        }
        found
    }
}

fn is_animation(property: &str) -> bool {
    matches!(property, "animation" | "animation-name")
}

/// Whether a block under `key` emits, so its declarations are read: a
/// registered alias, a supported at-rule or a selector.
fn admits_block(key: &str, ctx: &ResolveContext) -> bool {
    if key.starts_with('_') {
        ctx.selector_aliases.contains_key(key) || ctx.condition_aliases.contains_key(key)
    } else if key.starts_with('@') {
        crate::theme::condition_from_raw_key(key).is_some()
    } else {
        crate::selector_subject::has_subject(key) || key.starts_with(':')
    }
}

/// The keywords each other longhand of the `animation` shorthand takes; the
/// first of a group in an animation fills that longhand, not the name.
const SHORTHAND_KEYWORDS: [&[&str]; 5] = [
    &["ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end"],
    &["infinite"],
    &["normal", "reverse", "alternate", "alternate-reverse"],
    &["none", "forwards", "backwards", "both"],
    &["running", "paused"],
];

/// The animation names a value gives, one per comma-separated animation, as
/// CSS reads it: comments are trivia, escapes are decoded, nothing inside a
/// function or after `!` is a name. An `animation-name` animation is a name
/// only as a single identifier. In the shorthand (CSS Animations §4.9), each
/// identifier first fills the longhand whose keyword it is, while that
/// longhand is unset; the first one left over is the name.
fn animation_names(value: &str, shorthand: bool) -> Vec<Cow<'_, str>> {
    use crate::css_tokens::Kind;
    let mut names = Vec::new();
    let mut depth = 0usize;
    let mut idents: Vec<Cow<'_, str>> = Vec::new();
    let mut other = false;
    let mut priority = false;
    for token in crate::css_tokens::tokenize(value) {
        match token.kind {
            Kind::Whitespace => {}
            Kind::Function => {
                depth += 1;
                other = true;
            }
            Kind::Delim(b'(') => depth += 1,
            Kind::Delim(b')') => depth = depth.saturating_sub(1),
            _ if depth > 0 || priority => {}
            Kind::Delim(b',') => {
                names.extend(animation_name(std::mem::take(&mut idents), other, shorthand));
                other = false;
            }
            Kind::Delim(b'!') => priority = true,
            Kind::Ident => idents.push(token.value),
            _ => other = true,
        }
    }
    names.extend(animation_name(idents, other, shorthand));
    names
}

/// One animation's name from its top-level identifiers, `other` telling
/// whether anything else was written.
fn animation_name(mut idents: Vec<Cow<'_, str>>, other: bool, shorthand: bool) -> Option<Cow<'_, str>> {
    if !shorthand {
        return (idents.len() == 1 && !other).then(|| idents.remove(0));
    }
    let mut filled = [false; SHORTHAND_KEYWORDS.len()];
    idents.into_iter().find(|ident| match SHORTHAND_KEYWORDS.iter().position(|keywords| keywords.contains(&ident.as_ref())) {
        Some(group) if !filled[group] => {
            filled[group] = true;
            false
        }
        _ => true,
    })
}
