#!/usr/bin/env bash
set -euo pipefail

# verify:hygiene:rust — cargo-machete unused-dep check for packages/extract.
# Source-only tier; no upstream artifact preconditions. Requires cargo-machete
# on PATH (tool precondition enforced by require_cargo_machete).

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/verify/_preconditions.sh"

require_cargo_machete

cd "$ROOT/packages/extract"
exec cargo machete
