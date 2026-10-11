//! The order in which a relative or aliased specifier's candidate files are
//! tried: one probe that both the system loader and the extractor resolve
//! through. Each still passes the list it has always used; the two lists
//! differ (see `SYSTEM_EVALUATION` and `ANALYSIS_SOURCE`), and are to become
//! one policy.

/// The candidate files a specifier's base path names, in the order they are
/// tried: the base itself, the base with each appended extension, its
/// `index` with each, then the NodeNext sources an emitted extension stands
/// for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtensionPolicy {
    /// Appended to the base, then to `{base}/index`.
    pub appended: &'static [&'static str],
    /// An emitted extension (`./x.js`), and the source extensions it names
    /// (`x.ts`), tried in order.
    pub node_next: &'static [(&'static str, &'static [&'static str])],
    /// Whether an emitted extension matches whatever its case.
    pub node_next_ignores_case: bool,
}

/// The system loader's list, for the modules a system's evaluation reads.
pub const SYSTEM_EVALUATION: ExtensionPolicy = ExtensionPolicy {
    appended: &[".ts", ".tsx", ".js", ".mjs"],
    node_next: &[(".js", &[".ts", ".tsx"])],
    node_next_ignores_case: false,
};

/// The extractor's list, for the sources an analysis reads. It mirrors
/// `resolveRelativeSource` and `NODE_NEXT_EXTENSION_MAP` in
/// `packages/extract/pipeline/source-ingestion.ts`.
pub const ANALYSIS_SOURCE: ExtensionPolicy = ExtensionPolicy {
    appended: &[".ts", ".tsx", ".js", ".jsx"],
    node_next: &[
        (".js", &[".ts", ".tsx", ".jsx"]),
        (".jsx", &[".tsx"]),
        (".mjs", &[".mts"]),
        (".cjs", &[".cts"]),
    ],
    node_next_ignores_case: true,
};

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
                    let suffix = base.get(split..)?;
                    let matches = match self.node_next_ignores_case {
                        true => suffix.eq_ignore_ascii_case(emitted),
                        false => suffix == *emitted,
                    };
                    if !matches {
                        return None;
                    }
                    let stem = &base[..split];
                    sources.iter().map(|source| format!("{stem}{source}")).find(|candidate| exists(candidate))
                })
            })
    }
}
