//! The order in which a relative or aliased specifier's candidate files are
//! tried: one policy, through which both the system loader and the
//! extractor resolve, so a specifier names the same file for a system's
//! evaluation and for an analysis. `extension_policy.json` is generated from
//! `EXTENSION_POLICY` in `packages/extract/pipeline/extension-policy.ts`,
//! which source ingestion reads (`node packages/extract/scripts/extension-policy.ts --write`).

use std::cell::{OnceCell, RefCell};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use rustc_hash::FxHashMap;

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
        // The base is the first candidate wherever no alias replaces the
        // search, and the one most specifiers name: try it before spelling
        // the rest.
        let aliased = self.alias.iter().any(|(emitted, _)| base.ends_with(emitted.as_str()));
        if !aliased {
            match see(base) {
                Seen::File => return Probe::Found(base.to_string()),
                Seen::CaseOnly(actual) => return Probe::CaseMismatch { candidate: base.to_string(), actual },
                Seen::Missing => {}
            }
        }
        for candidate in self.candidates(base).into_iter().skip(usize::from(!aliased)) {
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
    // A pass sees each candidate from each base once: a closure's modules
    // import the same file from one directory many times.
    let seen = PASS.with(|pass| {
        pass.borrow().as_ref().and_then(|pass| pass.seen.get(base)?.get(candidate).cloned())
    });
    if let Some(seen) = seen {
        return seen;
    }
    let seen = see_on_disk(base, candidate);
    PASS.with(|pass| {
        if let Some(pass) = pass.borrow_mut().as_mut() {
            pass.seen.entry(base.to_path_buf()).or_default().insert(candidate.to_string(), seen.clone());
        }
    });
    seen
}

/// [`see_within`], read from the filesystem (through the pass's listings).
fn see_on_disk(base: &Path, candidate: &str) -> Seen {
    see_plain(base, candidate).unwrap_or_else(|| see_lexical(base, candidate))
}

/// [`see_on_disk`] for any spelling, through its lexical form.
fn see_lexical(base: &Path, candidate: &str) -> Seen {
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

/// What one resolution pass has read: each directory it checked, and what
/// each candidate was seen to be from each base. With `join_real_paths`
/// off, [`real_path`] reads every real path from the disk.
#[derive(Default)]
struct Pass {
    directories: FxHashMap<PathBuf, Directory>,
    seen: FxHashMap<PathBuf, FxHashMap<String, Seen>>,
    join_real_paths: bool,
    /// A file whose real path the pass joined was found a link when read.
    relinked: bool,
}

/// What a pass has read of one directory: its entries, listed when the pass
/// first checks it (None where it cannot be read), and its real path, read
/// when a file in it is first resolved (None where it cannot be).
struct Directory {
    listing: Option<Listing>,
    real: OnceCell<Option<PathBuf>>,
}

/// A directory's entry names, each with whether it is a symbolic link.
type Listing = FxHashMap<OsString, bool>;

impl Pass {
    /// `directory` as this pass has read it, listed on the first check.
    fn directory(&mut self, directory: &Path) -> &Directory {
        if !self.directories.contains_key(directory) {
            let read = Directory { listing: entry_names(directory), real: OnceCell::new() };
            self.directories.insert(directory.to_path_buf(), read);
        }
        &self.directories[directory]
    }

    /// Whether every real path the pass joined still holds: no file it was
    /// joined for was a link when read ([`read_source`]), each directory it
    /// read a real path for still resolves to it, and still lists each entry
    /// that was not a link as one that is not.
    fn real_paths_hold(&self) -> bool {
        !self.relinked && self.directories.iter().all(|(path, read)| {
            let Some(real) = read.real.get() else { return true };
            let now = entry_names(path);
            let plain_still = |(name, link): (&OsString, &bool)| {
                *link || now.as_ref().and_then(|now| now.get(name)) == Some(&false)
            };
            std::fs::canonicalize(path).ok() == *real && read.listing.iter().flatten().all(plain_still)
        })
    }
}

thread_local! {
    /// The open [`with_listing_cache`] scope's reads; None outside one.
    static PASS: RefCell<Option<Pass>> = const { RefCell::new(None) };
}

/// Runs `run` with each directory [`see_within`] or [`real_path`] checks
/// listed at most once, and resolved to its real path at most once: a
/// directory's listing is read the first time the pass checks it and
/// answers every later check in that pass. A limit: a file another process
/// writes to that directory after it is listed is not seen until the next
/// pass. Where a directory the pass joined a real path through was
/// relinked during it, or an entry it listed became a link or was one when
/// [`read_source`] read it, `run` runs again with every real path read from
/// the disk, so `run` must start afresh each time. Another limit: an
/// ancestor directory or a `package.json` relinked and restored between two
/// reads of one pass is not detected. A load during such changes has no
/// defined answer, and watch mode reloads, since each such path is a
/// recorded dependency. A nested scope shares the open one.
pub fn with_listing_cache<T>(mut run: impl FnMut() -> T) -> T {
    if PASS.with(|pass| pass.borrow().is_some()) {
        return run();
    }
    struct Close;
    impl Drop for Close {
        fn drop(&mut self) {
            PASS.with(|pass| *pass.borrow_mut() = None);
        }
    }
    let open = |join_real_paths| {
        PASS.with(|pass| *pass.borrow_mut() = Some(Pass { join_real_paths, ..Pass::default() }));
    };
    let _close = Close;
    open(true);
    let ran = run();
    if PASS.with(|pass| pass.borrow().as_ref().is_none_or(Pass::real_paths_hold)) {
        return ran;
    }
    open(false);
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

/// The entries `directory` lists; None where it cannot be read.
fn entry_names(directory: &Path) -> Option<Listing> {
    read_directory(directory).ok().map(|entries| {
        entries
            .flatten()
            .map(|entry| (entry.file_name(), entry.file_type().is_ok_and(|kind| kind.is_symlink())))
            .collect()
    })
}

/// `path` with its links and `.` segments resolved, as `require.resolve`
/// and Vite return it; as given when it cannot be. In a pass, a plain path
/// ([`is_plain`]) whose directory lists its name, spelled exactly, as an
/// entry that is not a link is its directory's real path, read once per
/// directory, joined with that name; a link, or a name spelled otherwise
/// (another case on a case-insensitive disk), is resolved from the disk.
pub fn real_path(path: PathBuf) -> PathBuf {
    real_path_in_pass(&path).unwrap_or_else(|| std::fs::canonicalize(&path).unwrap_or(path))
}

/// [`real_path`] from the open pass's directories; None where the disk
/// must answer.
fn real_path_in_pass(path: &Path) -> Option<PathBuf> {
    if !path.to_str().is_some_and(is_plain) {
        return None;
    }
    let (directory, name) = (path.parent()?, path.file_name()?);
    PASS.with(|pass| {
        let mut pass = pass.borrow_mut();
        let read = pass.as_mut().filter(|pass| pass.join_real_paths)?.directory(directory);
        if read.listing.as_ref()?.get(name) != Some(&false) {
            return None;
        }
        let real = read.real.get_or_init(|| std::fs::canonicalize(directory).ok());
        Some(real.as_ref()?.join(name))
    })
}

/// The source at `path`, a real path [`real_path`] gave. In a pass that
/// joins real paths, the last segment is opened without following a link:
/// one there now means the joined real path went stale after its directory
/// was listed, so the pass runs again reading every real path from the
/// disk, and the source is read through the link meanwhile.
pub fn read_source(path: &str) -> std::io::Result<String> {
    #[cfg(unix)]
    if PASS.with(|pass| pass.borrow().as_ref().is_some_and(|pass| pass.join_real_paths)) {
        use std::io::Read;
        use std::os::unix::fs::OpenOptionsExt;
        match std::fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(path) {
            Ok(mut file) => {
                let mut source = String::new();
                file.read_to_string(&mut source)?;
                return Ok(source);
            }
            Err(error) if error.raw_os_error() == Some(libc::ELOOP) => {
                PASS.with(|pass| pass.borrow_mut().as_mut().map(|pass| pass.relinked = true));
            }
            Err(error) => return Err(error),
        }
    }
    std::fs::read_to_string(path)
}

/// Whether `path` is absolute and spelled with no `.`, `..` or empty
/// segment, so its components are its `/`-separated segments as written.
fn is_plain(path: &str) -> bool {
    path == "/"
        || path.starts_with('/')
        && !path.ends_with('/')
        && path[1..].split('/').all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

/// [`see_on_disk`] for a plain candidate and base ([`is_plain`]), which the
/// lexical form leaves as written: the same answer, reading each directory
/// as a slice of the candidate rather than a path built per check. None
/// where either is not plain.
fn see_plain(base: &Path, candidate: &str) -> Option<Seen> {
    let base = base.to_str()?;
    if !is_plain(candidate) || !is_plain(base) {
        return None;
    }
    if !Path::new(candidate).is_file() {
        return Some(Seen::Missing);
    }
    // The segments the candidate shares with the base, from the root.
    let mut shared = 0;
    for (segment, base_segment) in candidate[1..].split('/').zip(base[1..].split('/')) {
        if segment != base_segment {
            break;
        }
        shared += 1 + segment.len();
    }
    if shared >= candidate.len() {
        return Some(Seen::File);
    }
    // Each segment below them must be listed, spelled exactly, by the
    // directory above it.
    let mut start = shared;
    for segment in candidate[shared + 1..].split('/') {
        let directory = if start == 0 { "/" } else { &candidate[..start] };
        if !lists(Path::new(directory), std::ffi::OsStr::new(segment)) {
            let actual = std::fs::canonicalize(candidate).unwrap_or_else(|_| PathBuf::from(candidate));
            return Some(Seen::CaseOnly(actual.to_string_lossy().to_string()));
        }
        start += 1 + segment.len();
    }
    Some(Seen::File)
}

/// Whether `directory` lists an entry spelled exactly `name`.
fn lists(directory: &Path, name: &std::ffi::OsStr) -> bool {
    let directory = if directory.as_os_str().is_empty() { Path::new(".") } else { directory };
    PASS.with(|pass| match pass.borrow_mut().as_mut() {
        Some(pass) => pass.directory(directory).listing.as_ref().is_some_and(|names| names.contains_key(name)),
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

    /// Contract: a pass's real path is the one `fs::canonicalize` gives, even
    /// where a link changes during the pass: a directory link retargeted
    /// after a file through it resolved, a listed file that became a link,
    /// and one that was a link only while its source was read. A stale one
    /// sends watch to the wrong file.
    #[test]
    fn a_pass_never_returns_a_stale_real_path() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!("animus-relink-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for side in ["old", "new"] {
            std::fs::create_dir_all(dir.join(side)).expect("create fixture");
            for file in ["a.js", "b.js"] {
                std::fs::write(dir.join(side).join(file), "").expect("write fixture");
            }
        }
        let dir = std::fs::canonicalize(&dir).expect("canonical fixture");
        let relink = |link: &str, to: &str| {
            let _ = std::fs::remove_file(dir.join(link));
            symlink(to, dir.join(link)).expect("link fixture");
        };
        relink("bridge", "old");
        let retargeted = with_listing_cache(|| {
            real_path(dir.join("bridge/a.js"));
            relink("bridge", "new");
            real_path(dir.join("bridge/b.js"))
        });
        let became_link = with_listing_cache(|| {
            real_path(dir.join("old/a.js"));
            relink("old/b.js", "../new/b.js");
            real_path(dir.join("old/b.js"))
        });
        // A listed file that is a link only while its source is read: the
        // source and the real path must name the same file.
        std::fs::create_dir_all(dir.join("swap")).expect("create fixture");
        std::fs::write(dir.join("swap/a.js"), "").expect("write fixture");
        std::fs::write(dir.join("swap/b.js"), "swap").expect("write fixture");
        std::fs::write(dir.join("new/b.js"), "new").expect("write fixture");
        let runs = std::cell::Cell::new(0);
        let read_through = with_listing_cache(|| {
            runs.set(runs.get() + 1);
            real_path(dir.join("swap/a.js"));
            let path = real_path(dir.join("swap/b.js"));
            if runs.get() == 1 {
                relink("swap/b.js", "../new/b.js");
            }
            let source = read_source(&path.to_string_lossy()).expect("read fixture");
            if runs.get() == 1 {
                std::fs::remove_file(dir.join("swap/b.js")).expect("unlink fixture");
                std::fs::write(dir.join("swap/b.js"), "swap").expect("restore fixture");
            }
            (path, source)
        });
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(retargeted, dir.join("new/b.js"));
        assert_eq!(became_link, dir.join("new/b.js"));
        assert_eq!(read_through, (dir.join("swap/b.js"), "swap".to_string()));
    }

    /// Contract: the allocation-free check of a plain path answers exactly as
    /// the lexical check, for each shape a resolution meets.
    #[test]
    fn a_plain_path_is_seen_as_its_lexical_form() {
        let dir = std::env::temp_dir().join(format!("animus-plain-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("pkg/esm/outlined")).expect("create fixture");
        std::fs::write(dir.join("pkg/esm/outlined/Icon.mjs"), "").expect("write fixture");
        std::fs::write(dir.join("pkg/esm/helper.mjs"), "").expect("write fixture");
        let dir = std::fs::canonicalize(&dir).expect("canonical fixture");
        let at = |path: &str| dir.join(path).to_string_lossy().to_string();
        let bases = [dir.join("pkg/esm"), dir.join("pkg/esm/outlined"), dir.join("elsewhere"), PathBuf::from("/")];
        let candidates = [
            "pkg/esm/outlined/Icon.mjs",
            "pkg/esm/helper.mjs",
            "pkg/esm/Outlined/Icon.mjs",
            "pkg/esm/outlined/icon.mjs",
            "pkg/esm/outlined/Absent.mjs",
            "pkg/esm/outlined",
        ];
        for base in &bases {
            for candidate in candidates.iter().map(|candidate| at(candidate)) {
                let plain = see_plain(base, &candidate).expect("a plain path");
                assert_eq!(plain, see_lexical(base, &candidate), "{candidate} from {base:?}");
            }
            let itself = base.to_string_lossy().to_string();
            assert_eq!(see_plain(base, &itself).expect("a plain path"), see_lexical(base, &itself));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
