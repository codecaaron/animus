#!/usr/bin/env bash
set -euo pipefail

# verify:canary — NAPI boundary snapshot tests.
# Preconditions: both compatibility and default NAPI binaries are fresh.
# Does NOT require packages/extract/dist/ — canary requires loaders directly.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi
require_fresh_napi_v2

exec bun test packages/extract/tests/canary.test.ts
