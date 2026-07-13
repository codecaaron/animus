//! Component identity — v1 css_generator::{content_hash, make_class_name}
//! ported byte-for-byte (FNV-1a, u32-truncated hex) + lib.rs stable_id.
//! The corpus oracle pins these against v1 manifest class names.

/// FNV-1a over bytes, truncated to u32 hex (v1 css_generator).
pub fn content_hash(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:08x}", hash as u32)
}

/// `{prefix}-{binding}-{hash}` (v1 css_generator::make_class_name).
pub fn make_class_name(binding: &str, hash_input: &str, prefix: &str) -> String {
    format!("{}-{}-{}", prefix, binding, content_hash(hash_input))
}

/// v1 lib.rs stable_id `{filename}::{binding}` → class name. Stable across
/// style edits (HMR-critical).
pub fn class_name_for(filename: &str, binding: &str, prefix: &str) -> String {
    make_class_name(binding, &format!("{filename}::{binding}"), prefix)
}
