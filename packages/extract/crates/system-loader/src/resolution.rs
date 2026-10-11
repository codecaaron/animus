//! The order in which a relative or aliased specifier's candidate files are
//! tried: one policy, through which both the system loader and the
//! extractor resolve, so a specifier names the same file for a system's
//! evaluation and for an analysis. `extension_policy.json` is generated from
//! `EXTENSION_POLICY` in `packages/extract/pipeline/extension-policy.ts`,
//! which source ingestion reads (`node packages/extract/scripts/extension-policy.ts --write`).

use std::sync::OnceLock;

/// The candidate files a specifier's base path names, in the order they are
/// tried: the base itself, the base with each appended extension, its
/// `index` with each, then the NodeNext sources an emitted extension stands
/// for, whatever the emitted extension's case.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPolicy {
    /// Appended to the base, then to `{base}/index`.
    pub appended: Vec<String>,
    /// An emitted extension (`./x.js`), and the source extensions it names
    /// (`x.ts`), tried in order.
    pub node_next: Vec<(String, Vec<String>)>,
    /// A host's configured alias of an emitted extension (webpack's
    /// `extensionAlias`): its sequence replaces the literal try, in order
    /// (spec §2.2 A2). Captured only; no probe reads it yet.
    #[serde(default)]
    pub alias: Vec<(String, Vec<String>)>,
}

/// The one extension policy.
pub fn extension_policy() -> &'static ExtensionPolicy {
    static POLICY: OnceLock<ExtensionPolicy> = OnceLock::new();
    POLICY.get_or_init(|| {
        serde_json::from_str(include_str!("extension_policy.json"))
            .expect("extension_policy.json is generated valid JSON")
    })
}

impl ExtensionPolicy {
    /// The first candidate for `base` that `exists`, in policy order. The
    /// literal spelling is tried before a NodeNext source, so a real `.js`
    /// neighbor still wins over the `.ts` it could stand for.
    pub fn probe(&self, base: &str, exists: impl Fn(&str) -> bool) -> Option<String> {
        std::iter::once(base.to_string())
            .chain(self.appended.iter().map(|extension| format!("{base}{extension}")))
            .chain(self.appended.iter().map(|extension| format!("{base}/index{extension}")))
            .find(|candidate| exists(candidate))
            .or_else(|| {
                self.node_next.iter().find_map(|(emitted, sources)| {
                    let split = base.len().checked_sub(emitted.len())?;
                    if !base.get(split..)?.eq_ignore_ascii_case(emitted) {
                        return None;
                    }
                    let stem = &base[..split];
                    sources.iter().map(|source| format!("{stem}{source}")).find(|candidate| exists(candidate))
                })
            })
    }
}
