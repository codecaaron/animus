#!/usr/bin/env bash
set -euo pipefail

# verify:assert:next — positional assertions on Next build output.
# Precondition: packages/next-test-app/.next/ exists.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -d packages/next-test-app/.next ]; then
  echo "ERROR: packages/next-test-app/.next/ missing. Run: bun run verify:build:next" >&2
  exit 1
fi

exec bash packages/next-test-app/scripts/assert-next-build.sh
