#!/usr/bin/env bash
set -euo pipefail

# verify:types — type-contract tests via tsconfig.test-d.json.
# Reads packages/system/__tests__/tsconfig.test-d.json which includes ../src/** directly.
# No dist/ precondition.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -x node_modules/.bin/tsc ]; then
  echo "ERROR: tsc binary not found at node_modules/.bin/tsc. Run: bun install" >&2
  exit 1
fi

exec node_modules/.bin/tsc -p packages/system/__tests__/tsconfig.test-d.json --noEmit
