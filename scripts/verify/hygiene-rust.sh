#!/usr/bin/env bash
set -euo pipefail

# verify:hygiene:rust — unused-dep checks for extraction Rust crates.
# Source-only tier; no upstream artifact preconditions. Requires cargo-machete
# on PATH (tool precondition enforced by require_cargo_machete).

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/verify/_preconditions.sh"

require_cargo_machete

# Fail-closed cargo-machete ignore guard (design D5 / guardrail G5): reject any
# non-empty [package.metadata.cargo-machete].ignored list before the detector
# runs, so an ignore entry cannot silence a genuinely-unused dependency. The two
# crates are independent (no Cargo workspace since retire-extract-v1), so each is
# checked from its own manifest with --no-deps.
for crate in system-loader extract-v2; do
  (cd "$ROOT/packages/extract/crates/$crate" \
    && cargo metadata --no-deps --format-version 1) \
    | bun "$ROOT/scripts/verify/rust-policy.ts" metadata
done

cd "$ROOT/packages/extract/crates/system-loader"
cargo machete

cd "$ROOT/packages/extract/crates/extract-v2"
exec cargo machete
