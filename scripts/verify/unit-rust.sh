#!/usr/bin/env bash
set -euo pipefail

# verify:unit:rust — Rust unit tests (debug profile, library only).
# No upstream artifact preconditions; cargo handles its own build.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/packages/extract"

exec cargo test --lib
