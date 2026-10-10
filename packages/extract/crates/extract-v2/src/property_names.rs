//! Declared contextual variables and the one map from a declared name to the
//! custom property it emits. A `prefixContextualVars` build carries each
//! final name in its entry; an unprefixed build's entries are plain names
//! that emit themselves, so its output is unchanged.

use std::borrow::Cow;

use rustc_hash::FxHashMap;
use serde::{Deserialize, Deserializer};

use crate::css_tokens::{identifier_at, tokenize, Kind};

/// A declared contextual variable: the name authors write and the name it
/// emits, both without `--`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextualVar {
    pub name: String,
    pub var: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum WireEntry {
    Named(String),
    Renamed { name: String, var: String },
}

/// Contextual variables by scale, with the identity index every lookup and
/// rename goes through.
#[derive(Debug, Clone, Default)]
pub struct ContextualVarsMap {
    by_scale: FxHashMap<String, Vec<ContextualVar>>,
    /// Declared name → final name.
    finals: FxHashMap<String, String>,
    /// Exact final spelling → declared name, unless that spelling is itself
    /// declared: a declared name always wins, so nothing is renamed twice.
    aliases: FxHashMap<String, String>,
}

impl<'de> Deserialize<'de> for ContextualVarsMap {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = FxHashMap::<String, Vec<WireEntry>>::deserialize(deserializer)?;
        let mut map = Self::default();
        let mut finals: FxHashMap<String, String> = FxHashMap::default();
        for entries in wire.values() {
            for entry in entries {
                let (name, var) = match entry {
                    WireEntry::Named(name) => (name, name),
                    WireEntry::Renamed { name, var } => (name, var),
                };
                if let Some(other) = finals.insert(name.clone(), var.clone()) {
                    if other != *var {
                        return Err(serde::de::Error::custom(format!(
                            "contextual variable '{name}' has two final names, '{other}' and '{var}'"
                        )));
                    }
                }
            }
        }
        for (scale, entries) in wire {
            let vars = entries
                .into_iter()
                .map(|entry| match entry {
                    WireEntry::Named(name) => ContextualVar { var: name.clone(), name },
                    WireEntry::Renamed { name, var } => ContextualVar { name, var },
                })
                .collect();
            map.insert(scale, vars);
        }
        Ok(map)
    }
}

impl ContextualVarsMap {
    pub fn insert(&mut self, scale: String, vars: Vec<ContextualVar>) {
        for var in &vars {
            self.finals.insert(var.name.clone(), var.var.clone());
        }
        self.by_scale.insert(scale, vars);
        self.rebuild_aliases();
    }

    /// Names the theme generates under a prefix, with their final names: an
    /// authored read or write of one emits its final name, as a contextual
    /// variable's does. A declared contextual variable keeps its own entry,
    /// and no generated name joins a scale.
    pub fn add_generated(&mut self, generated: FxHashMap<String, String>) {
        for (name, final_name) in generated {
            self.finals.entry(name).or_insert(final_name);
        }
        self.rebuild_aliases();
    }

    fn rebuild_aliases(&mut self) {
        self.aliases = self
            .finals
            .iter()
            .filter(|(_, final_name)| !self.finals.contains_key(*final_name))
            .map(|(name, final_name)| (final_name.clone(), name.clone()))
            .collect();
    }

    /// The scale's contextual variables, in declaration order.
    pub fn scale(&self, scale: &str) -> &[ContextualVar] {
        self.by_scale.get(scale).map_or(&[], Vec::as_slice)
    }

    /// The declared name a spelling refers to: a declared name, or the exact
    /// final spelling of one.
    pub fn identity<'a>(&'a self, spelling: &'a str) -> Option<&'a str> {
        if self.finals.contains_key(spelling) {
            Some(spelling)
        } else {
            self.aliases.get(spelling).map(String::as_str)
        }
    }

    /// The scale's contextual variable a spelling refers to.
    pub fn in_scale(&self, scale: &str, spelling: &str) -> Option<&ContextualVar> {
        let identity = self.identity(spelling)?;
        self.scale(scale).iter().find(|var| var.name == identity)
    }

    /// Whether any declared name emits a different name.
    fn renames(&self) -> bool {
        self.finals.iter().any(|(name, final_name)| name != final_name)
    }

    /// The custom property an authored `--name` emits: a declared contextual
    /// variable takes its final name; anything else passes through. The name
    /// is read as one CSS identifier, escapes decoded.
    pub fn emitted_property<'a>(&self, property: &'a str) -> Cow<'a, str> {
        // A custom-property name starts with `-` or with an escape.
        if !property.starts_with(['-', '\\']) {
            return Cow::Borrowed(property);
        }
        match identifier_at(property, 0) {
            Some((name, end)) if end == property.len() => {
                match name.strip_prefix("--").and_then(|name| self.final_of(name)) {
                    Some(final_name) => Cow::Owned(format!("--{final_name}")),
                    None => Cow::Borrowed(property),
                }
            }
            _ => Cow::Borrowed(property),
        }
    }

    fn final_of(&self, spelling: &str) -> Option<&str> {
        let final_name = self.finals.get(self.identity(spelling)?)?;
        (final_name != spelling).then_some(final_name.as_str())
    }

    /// Gives every custom-property token in authored CSS that names a declared
    /// contextual variable its final name: `var()` reads at any depth,
    /// fallbacks included, transition lists and style queries. Names are read
    /// through the CSS tokenizer, whole and with escapes decoded, escaped
    /// leading dashes included, so an undeclared identifier that contains or
    /// starts with a declared name is never renamed in part. Quoted strings,
    /// `url()` and comments are copied unchanged.
    pub fn rename_authored<'a>(&self, css: &'a str) -> Cow<'a, str> {
        // A custom-property name is spelled with `--` or with an escape.
        if !self.renames() || !(css.contains("--") || css.contains('\\')) {
            return Cow::Borrowed(css);
        }
        let mut out = String::new();
        let mut copied = 0;
        for token in tokenize(css) {
            if token.kind != Kind::Ident {
                continue;
            }
            let Some(final_name) = token.value.strip_prefix("--").and_then(|name| self.final_of(name)) else {
                continue;
            };
            out.push_str(&css[copied..token.start]);
            out.push_str("--");
            out.push_str(final_name);
            copied = token.end;
        }
        if copied == 0 {
            return Cow::Borrowed(css);
        }
        out.push_str(&css[copied..]);
        Cow::Owned(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn renamed(entries: &[(&str, &str)]) -> ContextualVarsMap {
        let mut map = ContextualVarsMap::default();
        map.insert(
            "colors".into(),
            entries
                .iter()
                .map(|(name, var)| ContextualVar { name: (*name).into(), var: (*var).into() })
                .collect(),
        );
        map
    }

    #[test]
    fn both_entry_forms_deserialize() {
        let map: ContextualVarsMap = serde_json::from_str(
            r#"{"colors":["plain",{"name":"tone","var":"acme-tone"}]}"#,
        )
        .unwrap();
        assert_eq!(
            map.scale("colors"),
            [
                ContextualVar { name: "plain".into(), var: "plain".into() },
                ContextualVar { name: "tone".into(), var: "acme-tone".into() },
            ]
        );
    }

    #[test]
    fn one_name_with_two_final_names_is_rejected() {
        let error = serde_json::from_str::<ContextualVarsMap>(
            r#"{"colors":[{"name":"tone","var":"acme-tone"}],"space":[{"name":"tone","var":"other-tone"}]}"#,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("contextual variable 'tone' has two final names"), "{error}");
        assert!(serde_json::from_str::<ContextualVarsMap>(
            r#"{"colors":[{"name":"tone","var":"acme-tone"}],"space":[{"name":"tone","var":"acme-tone"}]}"#,
        )
        .is_ok());
    }

    #[test]
    fn plain_entries_rename_nothing() {
        let map: ContextualVarsMap = serde_json::from_str(r#"{"colors":["tone"]}"#).unwrap();
        let css = "a { --tone: var(--tone, red) }";
        assert!(matches!(map.rename_authored(css), Cow::Borrowed(_)));
        assert_eq!(map.emitted_property("--tone"), "--tone");
    }

    #[test]
    fn renames_declared_names_once_and_leaves_the_rest() {
        let map = renamed(&[("tone", "acme-tone"), ("gap", "acme-gap")]);
        assert_eq!(
            map.rename_authored(
                "--tone 1s, --other 2s; var(--gap, var(--tone, 4px)) style(--tone: dark) \
                 \"var(--tone)\" url(var(--tone).png) /* --gap */ .a--tone var(--acme-tone)"
            ),
            "--acme-tone 1s, --other 2s; var(--acme-gap, var(--acme-tone, 4px)) style(--acme-tone: dark) \
             \"var(--tone)\" url(var(--tone).png) /* --gap */ .a--tone var(--acme-tone)"
        );
        assert_eq!(map.emitted_property("--gap"), "--acme-gap");
        assert_eq!(map.emitted_property("--other"), "--other");
        // A name is read whole, escapes decoded: an undeclared name that starts
        // with a declared one is left alone, and an escaped spelling of a
        // declared one is renamed.
        assert_eq!(
            map.rename_authored(
                r"var(--tone\61) var(--toneé) é--tone var(--\74 one) var(--\74one) VaR(--Tone) var(\2d\2d tone) var(-\2d tone) \!--tone"
            ),
            r"var(--tone\61) var(--toneé) é--tone var(--acme-tone) var(--acme-tone) VaR(--Tone) var(--acme-tone) var(--acme-tone) \!--tone"
        );
        assert_eq!(map.emitted_property(r"--\74 one"), "--acme-tone");
        assert_eq!(map.emitted_property(r"\2d\2d tone"), "--acme-tone");
        assert_eq!(map.emitted_property("--toneé"), "--toneé");
    }

    #[test]
    fn a_declared_name_wins_over_another_final_spelling() {
        let map = renamed(&[("tone", "acme-tone"), ("acme-tone", "acme-acme-tone")]);
        assert_eq!(map.identity("acme-tone"), Some("acme-tone"));
        assert_eq!(
            map.rename_authored("var(--tone) var(--acme-tone)"),
            "var(--acme-tone) var(--acme-acme-tone)"
        );
    }

    #[test]
    fn the_exact_final_spelling_resolves_to_its_declared_name() {
        let map = renamed(&[("tone", "acme-tone")]);
        assert_eq!(map.in_scale("colors", "acme-tone").map(|var| var.name.as_str()), Some("tone"));
        assert_eq!(map.in_scale("colors", "tone").map(|var| var.var.as_str()), Some("acme-tone"));
        assert!(map.in_scale("colors", "acme-acme-tone").is_none());
    }

    /// Every managed name is a short word, `acme-` plus one, or `acme-acme-`
    /// plus one, so declared names, final names and aliases overlap.
    #[test]
    fn every_written_name_is_renamed_exactly_once_over_overlapping_sets() {
        let spellings: Vec<String> = ["a", "b", "tone"]
            .iter()
            .flat_map(|word| [word.to_string(), format!("acme-{word}"), format!("acme-acme-{word}")])
            .collect();
        let mut mask = 1u32;
        while mask < 1 << spellings.len() {
            let declared: Vec<&String> =
                spellings.iter().enumerate().filter(|(bit, _)| mask & (1 << bit) != 0).map(|(_, s)| s).collect();
            let entries: Vec<(&str, String)> =
                declared.iter().map(|name| (name.as_str(), format!("acme-{name}"))).collect();
            let entries: Vec<(&str, &str)> = entries.iter().map(|(name, var)| (*name, var.as_str())).collect();
            let map = renamed(&entries);
            let mut written: Vec<String> =
                declared.iter().flat_map(|name| [name.to_string(), format!("acme-{name}")]).collect();
            written.dedup();
            for name in written {
                let identity = if declared.iter().any(|declared| **declared == name) {
                    Some(name.clone())
                } else {
                    declared.iter().find(|declared| format!("acme-{declared}") == name).map(|d| d.to_string())
                };
                let final_name = identity.map_or(name.clone(), |identity| format!("acme-{identity}"));
                let css = format!("--{name}: var(--{name});");
                assert_eq!(
                    map.rename_authored(&css),
                    format!("--{final_name}: var(--{final_name});"),
                    "declared {declared:?}"
                );
            }
            mask += 37;
        }
    }
}
