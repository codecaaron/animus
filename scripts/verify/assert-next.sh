#!/usr/bin/env bash
set -euo pipefail

# verify:assert:next — positional assertions on Next build output.
# Precondition: e2e/next-app/.next/ exists.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_dir e2e/next-app/.next 'bun run verify:build:next'

exec bash e2e/next-app/scripts/assert-next-build.sh
