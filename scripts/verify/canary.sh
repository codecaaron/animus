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

# static-css-overrides shares the canary's precondition (it drives the REAL
# v2 engine), so it runs in this NAPI-gated lane, not verify:unit:ts.
exec bun test packages/extract/tests/canary.test.ts packages/extract/tests/static-css-overrides.test.ts
