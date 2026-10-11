//! The order in which a relative or aliased specifier's candidate files are
//! tried: one policy, through which both the system loader and the
//! extractor resolve, so a specifier names the same file for a system's
//! evaluation and for an analysis. `extension_policy.json` is generated from
//! `EXTENSION_POLICY` in `packages/extract/pipeline/extension-policy.ts`,
//! which source ingestion reads (`node packages/extract/scripts/extension-policy.ts --write`).

use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

/// The candidate files a specifier's base path names, in the order they are
/// tried: the base itself, the base with each appended extension, its
/// `index` with each, then the NodeNext sources an emitted extension stands
/// for, every spelling matched exactly.
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

/// What a lookup finds at one candidate path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Seen {
    /// A file, spelled as the candidate is.
    File,
    /// A file the filesystem opens under the candidate's spelling though no
    /// directory lists that spelling (a case- or normalization-insensitive
    /// filesystem): its real path, as the filesystem reports it.
    CaseOnly(String),
    Missing,
}

/// How a probe ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    Found(String),
    /// The first candidate a host could load differs from a file only in
    /// case. A case-insensitive host loads that file and a case-sensitive one
    /// does not, so the specifier is neither resolved nor absent.
    CaseMismatch { candidate: String, actual: String },
    Absent,
}

impl Probe {
    /// The file found, if one was.
    pub fn found(self) -> Option<String> {
        match self {
            Self::Found(path) => Some(path),
            Self::CaseMismatch { .. } | Self::Absent => None,
        }
    }
}

impl ExtensionPolicy {
    /// The candidate files for `base`, in policy order: the base, the base
    /// with each appended extension, its `index` with each, then the sources
    /// its emitted NodeNext extension stands for, spelled exactly. The
    /// literal spelling comes first, so a real `.js` neighbour wins over the
    /// `.ts` it could stand for.
    pub fn candidates(&self, base: &str) -> Vec<String> {
        let mut candidates: Vec<String> = std::iter::once(base.to_string())
            .chain(self.appended.iter().map(|extension| format!("{base}{extension}")))
            .chain(self.appended.iter().map(|extension| format!("{base}/index{extension}")))
            .collect();
        for (emitted, sources) in &self.node_next {
            if let Some(stem) = base.strip_suffix(emitted.as_str()) {
                candidates.extend(sources.iter().map(|source| format!("{stem}{source}")));
            }
        }
        candidates
    }

    /// The first candidate for `base` that `see` finds, in policy order. A
    /// candidate found only under another case ends the probe as a mismatch.
    pub fn probe(&self, base: &str, see: impl Fn(&str) -> Seen) -> Probe {
        for candidate in self.candidates(base) {
            match see(&candidate) {
                Seen::File => return Probe::Found(candidate),
                Seen::CaseOnly(actual) => return Probe::CaseMismatch { candidate, actual },
                Seen::Missing => {}
            }
        }
        Probe::Absent
    }
}

/// Why `subject` names no file: `candidate`, the file it would load, is
/// spelled otherwise on disk (`actual`). `remedy` says what to respell.
pub fn case_mismatch_reason(subject: &str, candidate: &str, actual: &str, remedy: &str) -> String {
    format!(
        "{subject} names {candidate:?}, but the file on disk is {actual:?}, spelled differently: a case- \
         or normalization-insensitive filesystem loads it and a sensitive one does not — {remedy}"
    )
}

/// What the filesystem holds at `candidate`: a file it opens under exactly
/// that spelling, or one it opens although a directory below the one the
/// candidate shares with `base` lists no entry spelled as the candidate
/// spells it (a case- or normalization-insensitive filesystem opening
/// another spelling). Nothing is folded: the filesystem decides what opens,
/// and its listings decide the spelling, so a file a case-sensitive
/// filesystem cannot open is simply missing. The shared directory is
/// spelled as given, as a specifier spells only the path from its
/// importer's directory and a manifest only the paths in its package.
pub fn see_within(base: &Path, candidate: &str) -> Seen {
    // `..` is taken back lexically, as Node and the bundlers resolve a
    // specifier before opening it, so the file checked is the file opened.
    let path = lexical(Path::new(candidate));
    if !path.is_file() {
        return Seen::Missing;
    }
    let shared: PathBuf = path
        .components()
        .zip(lexical(base).components())
        .take_while(|(name, base_name)| name == base_name && *name != Component::ParentDir)
        .map(|(name, _)| name)
        .collect();
    let mut directory = shared.clone();
    for component in path.strip_prefix(&shared).unwrap_or(&path).components() {
        match component {
            Component::Normal(name) => {
                if !lists(&directory, name) {
                    let actual = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                    return Seen::CaseOnly(actual.to_string_lossy().to_string());
                }
                directory.push(name);
            }
            Component::ParentDir => {
                directory.pop();
            }
            Component::CurDir => {}
            other => directory.push(other.as_os_str()),
        }
    }
    Seen::File
}

/// Whether `directory` lists an entry spelled exactly `name`.
fn lists(directory: &Path, name: &std::ffi::OsStr) -> bool {
    let directory = if directory.as_os_str().is_empty() { Path::new(".") } else { directory };
    std::fs::read_dir(directory)
        .map(|entries| entries.flatten().any(|entry| entry.file_name() == name))
        .unwrap_or(false)
}

/// `path` with `.` dropped and `..` taken back, without touching the disk,
/// as Node's `path.resolve` reads a specifier.
pub fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}




