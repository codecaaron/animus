#!/usr/bin/env bash
set -euo pipefail

# verify:clippy — strict Clippy checks for all active extraction Rust crates.
# Source-only tier; no upstream artifact preconditions.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
unset RUSTUP_TOOLCHAIN

cd "$ROOT/packages/extract"
cargo clippy --workspace --all-targets --all-features -- -D warnings

cd "$ROOT/packages/extract/crates/system-loader"
cargo clippy --workspace --all-targets --all-features -- -D warnings

cd "$ROOT/packages/extract/crates/extract-v2"
exec cargo clippy --workspace --all-targets --all-features -- -D warnings
