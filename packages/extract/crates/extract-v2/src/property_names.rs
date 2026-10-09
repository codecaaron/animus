//! Declared contextual variables and the one map from a declared name to the
//! custom property it emits. A `prefixContextualVars` build carries each
//! final name in its entry; an unprefixed build's entries are plain names
//! that emit themselves, so its output is unchanged.

use std::borrow::Cow;

use rustc_hash::FxHashMap;
use serde::{Deserialize, Deserializer};

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
    /// variable takes its final name; anything else passes through.
    pub fn emitted_property<'a>(&self, property: &'a str) -> Cow<'a, str> {
        match property.strip_prefix("--").and_then(|name| self.final_of(name)) {
            Some(final_name) => Cow::Owned(format!("--{final_name}")),
            None => Cow::Borrowed(property),
        }
    }

    fn final_of(&self, spelling: &str) -> Option<&str> {
        let final_name = self.finals.get(self.identity(spelling)?)?;
        (final_name != spelling).then_some(final_name.as_str())
    }

    /// Gives every custom-property token in authored CSS that names a declared
    /// contextual variable its final name: `var()` reads at any depth,
    /// fallbacks included, transition lists and style queries. Quoted
    /// strings, `url()` and comments are copied unchanged.
    pub fn rename_authored<'a>(&self, css: &'a str) -> Cow<'a, str> {
        if !self.renames() || !css.contains("--") {
            return Cow::Borrowed(css);
        }
        let bytes = css.as_bytes();
        let mut out = String::with_capacity(css.len());
        let mut i = 0;
        while i < bytes.len() {
            let c = bytes[i];
            let end = if c == b'"' || c == b'\'' {
                closing_quote(bytes, i)
            } else if css[i..].starts_with("/*") {
                css[i + 2..].find("*/").map_or(bytes.len(), |at| i + 2 + at + 2)
            } else if is_url_open(css, i) {
                closing_url(bytes, i + 4)
            } else if css[i..].starts_with("--") && !is_name_byte(i.checked_sub(1).map(|at| bytes[at])) {
                let mut end = i + 2;
                while end < bytes.len() && is_name_byte(Some(bytes[end])) {
                    end += 1;
                }
                let spelling = &css[i + 2..end];
                out.push_str("--");
                out.push_str(self.final_of(spelling).unwrap_or(spelling));
                i = end;
                continue;
            } else {
                let width = css[i..].chars().next().map_or(1, char::len_utf8);
                i + width
            };
            out.push_str(&css[i..end]);
            i = end;
        }
        Cow::Owned(out)
    }
}

fn is_name_byte(byte: Option<u8>) -> bool {
    matches!(byte, Some(b) if b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn is_url_open(css: &str, at: usize) -> bool {
    css.get(at..at + 4).is_some_and(|head| head.eq_ignore_ascii_case("url("))
        && !is_name_byte(at.checked_sub(1).map(|before| css.as_bytes()[before]))
}

fn closing_quote(bytes: &[u8], open: usize) -> usize {
    let quote = bytes[open];
    let mut i = open + 1;
    while i < bytes.len() && bytes[i] != quote {
        i += if bytes[i] == b'\\' { 2 } else { 1 };
    }
    (i + 1).min(bytes.len())
}

/// The index after the `)` that closes a `url(` whose body starts at `from`.
fn closing_url(bytes: &[u8], from: usize) -> usize {
    let mut i = from;
    while i < bytes.len() && bytes[i] != b')' {
        i = if bytes[i] == b'"' || bytes[i] == b'\'' { closing_quote(bytes, i) } else { i + 1 };
    }
    (i + 1).min(bytes.len())
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
