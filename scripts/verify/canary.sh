#!/usr/bin/env bash
set -euo pipefail

# verify:canary — NAPI boundary snapshot tests.
# Precondition: fresh NAPI binary (exists AND newer than Rust source).
# Does NOT require packages/extract/dist/ — canary uses require('../index.js') directly.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi

exec bun test packages/extract/tests/canary.test.ts
