//! Component identity: FNV-1a (u32-truncated hex) content hashes and the
//! class names derived from them.

/// FNV-1a over bytes, truncated to u32 hex.
pub fn content_hash(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:08x}", hash as u32)
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
