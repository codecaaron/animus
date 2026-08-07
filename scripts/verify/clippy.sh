#!/usr/bin/env bash
set -euo pipefail

# verify:clippy — strict Clippy checks for all active extraction Rust crates.
# Source-only tier; no upstream artifact preconditions.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
unset RUSTUP_TOOLCHAIN

# Fail-closed authored-source suppression guard (design D5 / guardrail G4):
# reject crate/module/cfg_attr allow|expect(warnings|clippy::all) before Clippy
# runs, so a blanket suppression cannot absorb unrelated future failures while
# `clippy -D warnings` still reports green. Narrow named-lint allows pass.
# Crate ROOTS (not just src/): --all-targets also compiles build.rs, tests/,
# examples/, and benches/ — a blanket allow there would bypass a src/-only
# scan. rust-policy recurses and prunes target/ itself.
bun "$ROOT/scripts/verify/rust-policy.ts" source \
  "$ROOT/packages/extract/crates/extract-v2" \
  "$ROOT/packages/extract/crates/system-loader"

# Lint-posture parity guard: the two crates are separate Cargo workspaces
# (packages/extract/CLAUDE.md), so `[workspace.lints]` inheritance is
# unavailable and each Cargo.toml carries a hand-duplicated `[lints]` table.
# Without this, adding or downgrading a lint in one crate leaves the other on
# the old posture and CI still reports green.
bun "$ROOT/scripts/verify/rust-policy.ts" lints \
  "$ROOT/packages/extract/crates/extract-v2/Cargo.toml" \
  "$ROOT/packages/extract/crates/system-loader/Cargo.toml"

cd "$ROOT/packages/extract/crates/system-loader"
cargo clippy --workspace --all-targets --all-features -- -D warnings

cd "$ROOT/packages/extract/crates/extract-v2"
exec cargo clippy --workspace --all-targets --all-features -- -D warnings
