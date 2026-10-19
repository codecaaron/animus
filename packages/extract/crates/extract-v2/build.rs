use std::fs;
use std::path::{Path, PathBuf};

/// Everything compiled into the engine that its behaviour can depend on: both
/// crates' sources (data files included), manifests, lockfiles and
/// toolchains, as `require_fresh_napi_v2` (scripts/verify/_preconditions.sh)
/// lists the engine's inputs.
const INPUTS: &[&str] = &[
    "src",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "build.rs",
    "../system-loader/src",
    "../system-loader/Cargo.toml",
    "../system-loader/Cargo.lock",
    "../system-loader/rust-toolchain.toml",
];

fn main() {
    napi_build::setup();

    // The engine build id: a digest of every input, so a rebuild from other
    // sources, the system loader's included, names itself differently.
    let mut files = Vec::new();
    for input in INPUTS {
        println!("cargo:rerun-if-changed={input}");
        collect(Path::new(input), &mut files);
    }
    files.sort();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for file in &files {
        let contents = fs::read(file).unwrap_or_default();
        for byte in file.to_string_lossy().bytes().chain([0]).chain(contents).chain([0]) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    }
    println!("cargo:rustc-env=ANIMUS_ENGINE_BUILD_ID={hash:016x}");
}

fn collect(path: &Path, files: &mut Vec<PathBuf>) {
    match fs::read_dir(path) {
        Ok(entries) => {
            for entry in entries.flatten() {
                collect(&entry.path(), files);
            }
        }
        Err(_) if path.is_file() => files.push(path.to_path_buf()),
        Err(_) => {}
    }
}
