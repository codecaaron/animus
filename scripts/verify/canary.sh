#!/usr/bin/env bash
set -euo pipefail

# verify:canary — v2 NAPI boundary snapshot tests.
# Preconditions: the v2 NAPI binary is fresh.
# The assembleStylesheet cases additionally read packages/extract/dist/, which
# the full build:extract composition (build:v2 && build:ts) materializes.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi_v2

exec bun test packages/extract/tests/canary.test.ts
