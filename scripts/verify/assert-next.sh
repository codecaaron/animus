#!/usr/bin/env bash
set -euo pipefail

# verify:assert:next — positional assertions on Next build output.
# Precondition: packages/next-test-app/.next/ exists.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_dir packages/next-test-app/.next 'bun run verify:build:next'

exec bash packages/next-test-app/scripts/assert-next-build.sh
