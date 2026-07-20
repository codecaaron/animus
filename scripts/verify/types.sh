#!/usr/bin/env bash
set -euo pipefail

# verify:types — type-contract tests via tsconfig.test-d.json.
# Reads packages/system/__tests__/tsconfig.test-d.json which includes ../src/** directly.
# No dist/ precondition.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_bun_install

exec node_modules/.bin/tsc -p packages/system/__tests__/tsconfig.test-d.json --noEmit
