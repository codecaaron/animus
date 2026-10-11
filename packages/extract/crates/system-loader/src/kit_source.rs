//! A kit's source root (spec §2.2 A5): the directory discovery analyses for a
//! kit, chosen by a fixed fallback policy, with evidence of the rule that
//! chose it. It reads a kit's `exports` through the system loader's own
//! selection, so the facet analysed is the facet evaluated (A3); the host's
//! entry, where given, stays the authority for the runtime entry (A2).

use std::fs;
use std::path::{Path, PathBuf};

use crate::{
    condition_target, find_package_json, resolution, resolve_exports_entry, select_package_entry, split_specifier,
    target_path, ResolutionContext, Target,
};

/// The export condition a kit gives each public entry's original source.
const KIT_SOURCE_CONDITION: &str = "animus";

/// Which A5 rule chose a kit's source root.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum KitSourceRule {
    /// Each exact entry's `animus` target, as the loader selects it.
    Animus,
    /// No `animus` condition, and every exact entry's runtime target is
    /// TypeScript source in the package.
    SourceExports,
    /// The package's `src/` directory: a guess, losing source fidelity.
    Src,
    /// The directory of the runtime entry the host loads.
    Compiled,
}

/// A kit's source root and the evidence for it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitSourceRoot {
    /// The package directory, located as Node locates it.
    pub package_dir: String,
    pub rule: KitSourceRule,
    /// The directory analysed for the kit.
    pub root: Option<String>,
    /// Each exact entry's source file, by subpath: the `animus` targets or
    /// the source-targeting exports.
    pub entries: Vec<(String, String)>,
    /// `animus` targets the loader does not read as source, with why. Each
    /// falls back to the entry's runtime target.
    pub invalid: Vec<(String, String, String)>,
    /// The runtime entry: the host's answer where given, else the loader's.
    pub runtime_entry: Option<String>,
    /// The host's entry lies outside the located package (a dev server's
    /// dependency cache, or another copy).
    pub host_entry_outside_package: bool,
    /// Why the specifier names no file although the package was located:
    /// a selected `animus` target holding a percent-escape, which fails the
    /// load, or a source-targeting export spelled otherwise on disk.
    pub unresolved: Option<String>,
}

/// `specifier`'s kit source root, by A5's fixed order: `animus`, then
/// source-targeting exports, then `src/`, then the runtime entry's directory.
/// The package is `package_dir` where the caller located it, else located
/// from `from_dir` as `resolve_bare_specifier` locates it. `host_entry` is
/// the file the host resolves for the specifier, where one does: it is the
/// runtime entry, and with neither it nor a source entry for the specifier,
/// no host imports it.
pub fn resolve_kit_source_root(
    specifier: &str,
    from_dir: &str,
    context: &ResolutionContext,
    host_entry: Option<&str>,
    package_dir: Option<&str>,
) -> Result<KitSourceRoot, String> {
    let (name, subpath) = split_specifier(specifier);
    let manifest = match package_dir {
        Some(dir) => Path::new(dir).join("package.json"),
        None => match find_package_json(name, from_dir) {
            Ok(path) => path,
            Err(missing) => context.workspaces.get(name).map(|dir| dir.join("package.json")).ok_or(missing)?,
        },
    };
    let package_dir = manifest.parent().map(Path::to_path_buf).unwrap_or_default();
    let exports = fs::read_to_string(&manifest)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|json| json.get("exports").cloned());
    let loader_runtime = select_package_entry(manifest.clone(), subpath, context, specifier, false);
    let runtime_entry = match host_entry {
        Some(entry) => Some(entry.to_string()),
        None => loader_runtime.as_ref().ok().map(|(path, _)| path.clone()),
    };
    let real_package = fs::canonicalize(&package_dir).unwrap_or_else(|_| package_dir.clone());
    let host_entry_outside_package = host_entry
        .map(|entry| !fs::canonicalize(entry).unwrap_or_else(|_| PathBuf::from(entry)).starts_with(&real_package))
        .unwrap_or(false);
    let mut found = KitSourceRoot {
        package_dir: display(&package_dir),
        rule: KitSourceRule::Compiled,
        root: None,
        entries: Vec::new(),
        invalid: Vec::new(),
        runtime_entry,
        host_entry_outside_package,
        unresolved: None,
    };
    let entry_key = format!(".{subpath}");
    let exact = exact_entries(exports.as_ref());
    let unimportable =
        |found: &KitSourceRoot| found.runtime_entry.is_none() && !found.entries.iter().any(|(entry, _)| *entry == entry_key);
    let why_not_importable = || loader_runtime.as_ref().err().cloned().unwrap_or_default();

    // `animus`: each exact entry's source target, as the loader selects it.
    let mut declared = false;
    for (entry, value) in &exact {
        let Some(selected) = source_condition(value, &context.conditions) else {
            continue;
        };
        declared = true;
        let target = match selected {
            Target::Found(target) => target_path(&target),
            Target::Unmatched => {
                found.invalid.push((
                    entry.clone(),
                    animus_text(value),
                    format!("matches none of the conditions {:?}", context.conditions),
                ));
                continue;
            }
            Target::Blocked => {
                found.invalid.push((
                    entry.clone(),
                    animus_text(value),
                    "is no package target Node accepts (one starts with './' and has no '.', '..' or \
                     'node_modules' segment)"
                        .to_string(),
                ));
                continue;
            }
        };
        if target.contains('%') {
            // The loader refuses it loudly and tries nothing else.
            let reason = format!(
                "exports[{entry:?}].{KIT_SOURCE_CONDITION} of {manifest:?} selects {target:?} — percent-escape \
                 unsupported: spell the target without '%'"
            );
            found.invalid.push((
                entry.clone(),
                target,
                "holds a percent-escape, which the system loader refuses (percent-escape unsupported) — spell \
                 the target without '%'"
                    .to_string(),
            ));
            if *entry == entry_key {
                found.unresolved = Some(reason);
            }
            continue;
        }
        let file = resolution::lexical(&package_dir.join(&target));
        match resolution::see_within(&package_dir, &file.to_string_lossy()) {
            resolution::Seen::File => found.entries.push((entry.clone(), display(&file))),
            resolution::Seen::CaseOnly(actual) => found.invalid.push((
                entry.clone(),
                target,
                format!(
                    "is spelled otherwise on disk ({actual}), which a case- or normalization-sensitive \
                     filesystem does not load"
                ),
            )),
            resolution::Seen::Missing => found.invalid.push((entry.clone(), target, "is missing".to_string())),
        }
    }
    if declared {
        if found.unresolved.is_some() {
            return Ok(found);
        }
        if unimportable(&found) {
            return Err(why_not_importable());
        }
        found.root = common_directory(&found.entries);
        if found.root.is_some() {
            found.rule = KitSourceRule::Animus;
        } else {
            found.root = runtime_root(&found);
        }
        return Ok(found);
    }

    // Source-targeting exports: every exact entry's runtime target, as the
    // loader selects it, is TypeScript source in the package.
    let mut sources = Vec::new();
    for (entry, _) in &exact {
        let target = resolve_exports_entry(exports.as_ref().unwrap_or(&serde_json::Value::Null), entry, false, &context.conditions);
        let Some(target) = target.filter(|target| is_typescript_source(target) && !target.contains('%')) else {
            sources.clear();
            break;
        };
        let file = resolution::lexical(&package_dir.join(&target));
        match resolution::see_within(&package_dir, &file.to_string_lossy()) {
            resolution::Seen::File => sources.push((entry.clone(), display(&file))),
            resolution::Seen::CaseOnly(actual) => {
                found.unresolved = Some(resolution::case_mismatch_reason(
                    &format!("exports[{entry:?}] of {manifest:?}"),
                    &target,
                    &actual,
                    "spell the export target as the file is spelled",
                ));
                return Ok(found);
            }
            resolution::Seen::Missing => {
                sources.clear();
                break;
            }
        }
    }
    if !sources.is_empty() {
        found.rule = KitSourceRule::SourceExports;
        found.root = common_directory(&sources);
        found.entries = sources;
        if unimportable(&found) {
            return Err(why_not_importable());
        }
        return Ok(found);
    }

    if found.runtime_entry.is_none() {
        return Err(why_not_importable());
    }
    // `src/`: a guess. Discovery guesses each entry below it, through the
    // analysis set's extensions.
    let src = package_dir.join("src");
    if src.is_dir() {
        found.rule = KitSourceRule::Src;
        found.root = Some(display(&src));
        return Ok(found);
    }

    found.root = runtime_root(&found);
    Ok(found)
}

/// The `animus` target an entry's conditions select, as the loader's
/// source facet reads them: the first `animus` key met in condition order,
/// its array taking the first valid target. `None` where no `animus` key is
/// met.
fn source_condition(value: &serde_json::Value, conditions: &[String]) -> Option<Target> {
    match value {
        serde_json::Value::Array(values) => values.iter().find_map(|value| source_condition(value, conditions)),
        serde_json::Value::Object(obj) => obj
            .get(KIT_SOURCE_CONDITION)
            .map(|animus| condition_target(animus, true, conditions))
            .or_else(|| {
                obj.iter()
                    .filter(|(key, _)| {
                        matches!(key.as_str(), "import" | "default") || conditions.iter().any(|condition| condition == *key)
                    })
                    .find_map(|(_, value)| source_condition(value, conditions))
            }),
        _ => None,
    }
}

/// An entry's `animus` value as written, for a report.
fn animus_text(value: &serde_json::Value) -> String {
    let animus = match value {
        serde_json::Value::Object(obj) => obj.get(KIT_SOURCE_CONDITION),
        serde_json::Value::Array(values) => values.iter().find_map(|value| value.get(KIT_SOURCE_CONDITION)),
        _ => None,
    };
    match animus {
        Some(serde_json::Value::String(target)) => target.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

/// Each exact `exports` entry and its value; a bare target, an array or a
/// condition object with no `.` key is the `.` entry. `*` patterns name no
/// single file.
fn exact_entries(exports: Option<&serde_json::Value>) -> Vec<(String, serde_json::Value)> {
    let Some(exports) = exports.filter(|exports| !exports.is_null()) else {
        return Vec::new();
    };
    match exports.as_object().filter(|map| map.keys().any(|key| key.starts_with('.'))) {
        Some(map) => map
            .iter()
            .filter(|(key, _)| key.starts_with('.') && !key.contains('*'))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        None => vec![(".".to_string(), exports.clone())],
    }
}

/// A TypeScript source file; compiled output and declarations are not.
fn is_typescript_source(path: &str) -> bool {
    [".ts", ".tsx", ".mts", ".cts"].iter().any(|extension| path.ends_with(extension))
        && ![".d.ts", ".d.mts", ".d.cts"].iter().any(|declaration| path.ends_with(declaration))
}

/// The deepest directory holding every entry's file.
fn common_directory(entries: &[(String, String)]) -> Option<String> {
    let mut dirs = entries.iter().map(|(_, file)| Path::new(file).parent().map(Path::to_path_buf));
    let mut common: PathBuf = dirs.next()??;
    for dir in dirs {
        let dir = dir?;
        while !dir.starts_with(&common) {
            if !common.pop() {
                return None;
            }
        }
    }
    Some(display(&common))
}

/// The directory of the runtime entry.
fn runtime_root(found: &KitSourceRoot) -> Option<String> {
    found.runtime_entry.as_deref().and_then(|entry| Path::new(entry).parent()).map(display)
}

fn display(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
