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
    /// A file whose name differs from the candidate only in case, as a
    /// case-insensitive filesystem matches it: its own spelling.
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

/// What the filesystem holds at `candidate`, spelled exactly: a file whose
/// every name below the directory it shares with `base` matches its
/// directory's entry, or one that matches only ignoring case (a
/// case-insensitive filesystem opens it; on a case-sensitive one, a final
/// name that differs only in case). The shared directory is spelled as
/// given, as a specifier spells only the path from its importer's directory.
pub fn see_within(base: &Path, candidate: &str) -> Seen {
    let path = lexical(Path::new(candidate));
    if !path.exists() {
        // A case-sensitive filesystem misses the variant; its directory
        // still lists it.
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            return Seen::Missing;
        };
        return match entry_named(parent, name) {
            Some(Entry::CaseOnly(actual)) if parent.join(&actual).is_file() => {
                Seen::CaseOnly(parent.join(actual).to_string_lossy().to_string())
            }
            _ => Seen::Missing,
        };
    }
    let shared: PathBuf = path
        .components()
        .zip(lexical(base).components())
        .take_while(|(name, base_name)| name == base_name && *name != Component::ParentDir)
        .map(|(name, _)| name)
        .collect();
    let mut actual = shared.clone();
    let below = path.strip_prefix(&shared).unwrap_or(&path);
    let mut differs = false;
    for component in below.components() {
        match component {
            Component::Normal(name) => match entry_named(&actual, name) {
                Some(Entry::Exact) => actual.push(name),
                Some(Entry::CaseOnly(spelled)) => {
                    actual.push(spelled);
                    differs = true;
                }
                None => return Seen::Missing,
            },
            other => actual.push(other.as_os_str()),
        }
    }
    match (actual.is_file(), differs) {
        (false, _) => Seen::Missing,
        (true, false) => Seen::File,
        (true, true) => Seen::CaseOnly(actual.to_string_lossy().to_string()),
    }
}

enum Entry {
    Exact,
    CaseOnly(std::ffi::OsString),
}

/// How `directory` lists `name`: exactly, under another case, or not at all.
fn entry_named(directory: &Path, name: &std::ffi::OsStr) -> Option<Entry> {
    let directory = if directory.as_os_str().is_empty() { Path::new(".") } else { directory };
    let mut case_only = None;
    for entry in std::fs::read_dir(directory).ok()?.flatten() {
        let entry_name = entry.file_name();
        if entry_name == name {
            return Some(Entry::Exact);
        }
        if case_only.is_none() && entry_name.to_string_lossy().eq_ignore_ascii_case(&name.to_string_lossy()) {
            case_only = Some(entry_name);
        }
    }
    case_only.map(Entry::CaseOnly)
}

/// `path` with `.` dropped and `..` taken back, without touching the disk.
fn lexical(path: &Path) -> PathBuf {
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
