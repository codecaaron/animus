#!/usr/bin/env bash
set -euo pipefail

# verify:hygiene:rust — unused-dep checks for extraction Rust crates.
# Source-only tier; no upstream artifact preconditions. Requires cargo-machete
# on PATH (tool precondition enforced by require_cargo_machete).

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/verify/_preconditions.sh"

require_cargo_machete

cd "$ROOT/packages/extract"
cargo machete

cd "$ROOT/packages/extract/crates/system-loader"
cargo machete

cd "$ROOT/packages/extract/crates/extract-v2"
exec cargo machete
