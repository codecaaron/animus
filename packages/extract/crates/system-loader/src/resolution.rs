//! The order in which a relative or aliased specifier's candidate files are
//! tried: one policy, through which both the system loader and the
//! extractor resolve, so a specifier names the same file for a system's
//! evaluation and for an analysis. `extension_policy.json` is generated from
//! `EXTENSION_POLICY` in `packages/extract/pipeline/extension-policy.ts`,
//! which source ingestion reads (`node packages/extract/scripts/extension-policy.ts --write`).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
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
    /// (spec §2.2 A2).
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
        // A configured alias of the emitted extension, the first whose
        // suffix the base ends with, replaces the whole search (spec §2.2
        // A2), as enhanced-resolve reads it: each of its spellings is tried
        // as written, and exhausting them ends resolution. `'.js': ['.ts']`
        // never finds an existing `x.js`, `x.js.ts` or `x.js/index.js`.
        if let Some(sequence) = self.alias.iter().find_map(|(emitted, sequence)| {
            let stem = base.strip_suffix(emitted.as_str())?;
            Some(sequence.iter().map(|extension| format!("{stem}{extension}")).collect())
        }) {
            return sequence;
        }
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

thread_local! {
    /// Each directory's entry names, read once, while a
    /// [`with_listing_cache`] scope is open; None outside one.
    static LISTINGS: RefCell<Option<HashMap<PathBuf, Option<HashSet<OsString>>>>> = const { RefCell::new(None) };
}

/// Runs `run` with each directory [`see_within`] checks listed at most once:
/// a directory's listing is read the first time the pass checks it and
/// answers every later check in that pass. A limit: a file another process
/// writes to that directory after it is listed is not seen until the next
/// pass. A nested scope shares the open one.
pub fn with_listing_cache<T>(run: impl FnOnce() -> T) -> T {
    if LISTINGS.with(|listings| listings.borrow().is_some()) {
        return run();
    }
    struct Close;
    impl Drop for Close {
        fn drop(&mut self) {
            LISTINGS.with(|listings| *listings.borrow_mut() = None);
        }
    }
    LISTINGS.with(|listings| *listings.borrow_mut() = Some(HashMap::new()));
    let _close = Close;
    run()
}

#[cfg(test)]
thread_local! {
    /// The directories read for their listing, counted.
    static DIRECTORY_READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// `directory`'s entries, read from the disk.
fn read_directory(directory: &Path) -> std::io::Result<std::fs::ReadDir> {
    #[cfg(test)]
    DIRECTORY_READS.with(|reads| reads.set(reads.get() + 1));
    std::fs::read_dir(directory)
}

/// The entry names `directory` lists; None where it cannot be read.
fn entry_names(directory: &Path) -> Option<HashSet<OsString>> {
    read_directory(directory).ok().map(|entries| entries.flatten().map(|entry| entry.file_name()).collect())
}

/// Whether `directory` lists an entry spelled exactly `name`.
fn lists(directory: &Path, name: &std::ffi::OsStr) -> bool {
    let directory = if directory.as_os_str().is_empty() { Path::new(".") } else { directory };
    LISTINGS.with(|listings| match listings.borrow_mut().as_mut() {
        Some(listings) => listings
            .entry(directory.to_path_buf())
            .or_insert_with(|| entry_names(directory))
            .as_ref()
            .is_some_and(|names| names.contains(name)),
        None => read_directory(directory)
            .map(|entries| entries.flatten().any(|entry| entry.file_name() == name))
            .unwrap_or(false),
    })
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





#[cfg(test)]
mod tests {
    use super::*;

    /// Contract: one resolution pass lists each directory once, however many
    /// candidates it checks in it, and answers each exactly as an unshared
    /// check does. Listing it per candidate made a system load over large
    /// directories quadratic (0.1.26: 33 s against 1.2 s).
    #[test]
    fn a_pass_lists_each_directory_once() {
        let dir = std::env::temp_dir().join(format!("animus-listings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("icons")).expect("create fixture");
        for n in 0..50 {
            std::fs::write(dir.join("icons").join(format!("Icon{n}.mjs")), "").expect("write fixture");
        }
        let candidates: Vec<String> = (0..50)
            .map(|n| format!("Icon{n}.mjs"))
            .chain(["icon0.mjs".to_string(), "Absent.mjs".to_string()])
            .map(|name| dir.join("icons").join(name).to_string_lossy().to_string())
            .collect();
        let check = || candidates.iter().map(|candidate| see_within(&dir, candidate)).collect::<Vec<_>>();
        let counted = |run: &dyn Fn() -> Vec<Seen>| {
            DIRECTORY_READS.with(|reads| reads.set(0));
            let seen = run();
            (seen, DIRECTORY_READS.with(|reads| reads.get()))
        };
        let (unshared, unshared_reads) = counted(&check);
        let (shared, shared_reads) = counted(&|| with_listing_cache(check));
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(shared, unshared);
        assert!(unshared[..50].iter().all(|seen| *seen == Seen::File));
        // `dir` and `dir/icons`, for each candidate found, against once each.
        assert_eq!(unshared_reads, 100 + if unshared[50] == Seen::Missing { 0 } else { 2 });
        assert_eq!(shared_reads, 2);
    }
}
