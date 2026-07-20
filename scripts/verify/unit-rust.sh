#!/usr/bin/env bash
set -euo pipefail

# verify:unit:rust — all active extraction Rust unit tests (debug profile).
# No upstream artifact preconditions; cargo handles its own build.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
unset RUSTUP_TOOLCHAIN

cd "$ROOT/packages/extract/crates/system-loader"
cargo test --lib

cd "$ROOT/packages/extract/crates/extract-v2"
exec cargo test --lib
