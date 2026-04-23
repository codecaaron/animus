#!/usr/bin/env bash
set -euo pipefail

# verify:hygiene:ts — fallow codebase-intelligence audit for the TS surface.
# Source-only tier; no upstream artifact preconditions. Requires fallow on PATH
# (tool precondition enforced by require_fallow_binary).

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/verify/_preconditions.sh"

require_fallow_binary

cd "$ROOT"
exec fallow audit
