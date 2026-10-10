//! Component identity: FNV-1a (u32-truncated hex) content hashes and the
//! class names derived from them.

/// FNV-1a's state before any input.
pub const FNV_OFFSET: u64 = 0xcbf29ce484222325;

/// FNV-1a over `input`'s bytes, continuing from `hash`.
pub fn fnv1a(hash: u64, input: impl AsRef<[u8]>) -> u64 {
    input.as_ref().iter().fold(hash, |hash, b| (hash ^ *b as u64).wrapping_mul(0x100000001b3))
}

/// FNV-1a as a sink, so a value hashes as it serializes.
struct Fnv1a(u64);

impl std::io::Write for Fnv1a {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0 = fnv1a(self.0, buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// FNV-1a over bytes, truncated to u32 hex.
pub fn content_hash(input: &str) -> String {
    format!("{:08x}", fnv1a(FNV_OFFSET, input) as u32)
}

/// `{prefix}-{binding}-{hash}`.
pub fn make_class_name(binding: &str, hash_input: &str, prefix: &str) -> String {
    format!("{}-{}-{}", prefix, binding, content_hash(hash_input))
}

/// Class name hashed from `{filename}::{binding}`: stable across style
/// edits, which HMR depends on.
pub fn class_name_for(filename: &str, binding: &str, prefix: &str) -> String {
    make_class_name(binding, &format!("{filename}::{binding}"), prefix)
}

/// An FNV-1a state, all 64 bits as hex: a fingerprint, not a class suffix.
pub fn fingerprint(hash: u64) -> String {
    format!("{hash:016x}")
}

/// FNV-1a over `value`'s compact JSON, continuing from `hash`: insignificant
/// whitespace takes no part, and key order does.
pub fn fnv1a_json(hash: u64, value: &impl serde::Serialize) -> u64 {
    let mut sink = Fnv1a(hash);
    serde_json::to_writer(&mut sink, value).expect("JSON values serialize, and hashing cannot fail");
    sink.0
}

/// A definition's fingerprint: its evaluated stages in order, the source of
/// each callback a prop references with what its admission reads, and for an
/// extension its parent's fingerprint. Nothing that depends on where the
/// definition is installed takes part.
pub fn definition_fingerprint(stages: &[crate::facts::StageFacts], parent: Option<&str>) -> String {
    let stages: Vec<_> = stages
        .iter()
        .map(|stage| {
            (
                &stage.method,
                &stage.value,
                &stage.second_value,
                stage.skipped.iter().map(|(key, _)| key).collect::<Vec<_>>(),
                stage
                    .captured
                    .iter()
                    .map(|c| {
                        let callback = c.callback.as_ref().map(|binding| {
                            (&binding.definition.source, &binding.definition.module_host_bindings)
                        });
                        (&c.key, &c.source, callback)
                    })
                    .collect::<Vec<_>>(),
                &stage.config_identifier,
            )
        })
        .collect();
    fingerprint(fnv1a_json(FNV_OFFSET, &(parent, stages)))
}

/// The identity a definition's names hash in a system, which every copy of
/// that definition shares, wherever it is installed.
pub fn semantic_identity(system: &str, definition: &str) -> String {
    format!("{system}:{definition}")
}

/// The class name of each `(binding, identity)`, in order: `{prefix}-{binding}-{8 hex}`,
/// or the full 16 hex for every identity whose 8-hex suffix another identity
/// also takes, whatever its binding, so two definitions never share a class
/// or a prop's name.
pub fn class_names(definitions: &[(&str, &str)], prefix: &str) -> Vec<String> {
    let mut identities_by_suffix: rustc_hash::FxHashMap<String, rustc_hash::FxHashSet<&str>> = Default::default();
    for (_, identity) in definitions {
        identities_by_suffix.entry(content_hash(identity)).or_default().insert(identity);
    }
    definitions
        .iter()
        .map(|(binding, identity)| {
            if identities_by_suffix[&content_hash(identity)].len() > 1 {
                format!("{prefix}-{binding}-{}", fingerprint(fnv1a(FNV_OFFSET, identity)))
            } else {
                make_class_name(binding, identity, prefix)
            }
        })
        .collect()
}

/// A class name's whole suffix, 8 or 16 hex: the names a component's props
/// take carry it, so they never collide where the classes do not.
pub fn class_suffix(class_name: &str) -> &str {
    class_name.rsplit('-').next().unwrap_or(class_name)
}

/// A file of an installed package, whose source never changes in place:
/// under no root the host classifies as linked, and installed by the path
/// alone otherwise.
pub fn is_installed_file(path: &str, linked_dirs: &[String]) -> bool {
    let within = |dir: &String| {
        path.strip_prefix(dir.trim_end_matches(['/', '\\']))
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(['/', '\\']))
    };
    !linked_dirs.iter().any(within) && path.split(['/', '\\']).any(|segment| segment == "node_modules")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn definitions_whose_short_suffixes_collide_take_distinct_full_suffixes() {
        // Two identities whose 8-hex suffixes collide.
        let mut by_suffix: rustc_hash::FxHashMap<String, String> = Default::default();
        let (first, second) = (0u32..)
            .map(|n| format!("system:{n:016x}"))
            .find_map(|identity| {
                let suffix = content_hash(&identity);
                match by_suffix.get(&suffix) {
                    Some(earlier) => Some((earlier.clone(), identity)),
                    None => {
                        by_suffix.insert(suffix, identity);
                        None
                    }
                }
            })
            .expect("a 32-bit suffix collides within 2^32 identities");
        assert_eq!(make_class_name("Button", &first, "animus"), make_class_name("Button", &second, "animus"));
        let suffixes = |definitions: &[(&str, &str)]| -> Vec<String> {
            class_names(definitions, "animus").iter().map(|name| class_suffix(name).to_string()).collect()
        };
        let across = suffixes(&[("Button", &first), ("Card", &second)]);
        assert_ne!(across[0], across[1], "different definitions never share a suffix, whatever their bindings");
        let names = class_names(&[("Button", &first), ("Card", "system:other"), ("Button", &second), ("Button", &first)], "animus");
        assert_ne!(names[0], names[2], "different definitions never share a class");
        assert_eq!(names[0], names[3], "copies of one definition share theirs");
        assert!(class_suffix(&names[0]).len() == 16 && class_suffix(&names[2]).len() == 16);
        assert_eq!(names[1], make_class_name("Card", "system:other", "animus"));
        let shared = suffixes(&[("Button", &first), ("Card", &first), ("Card", &second)]);
        assert_eq!(shared[0], shared[1], "one definition under two bindings keeps one suffix");
    }
}
