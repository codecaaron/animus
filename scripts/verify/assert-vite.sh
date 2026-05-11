#!/usr/bin/env bash
set -euo pipefail

# verify:assert:vite — positional assertions on Vite build output.
# Precondition: e2e/vite-app/dist/ exists AND @animus-ui/assertions dist is fresh.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_dir e2e/vite-app/dist 'vp run verify:build:vite'
require_fresh_package_dist _assertions

exec bun run e2e/vite-app/scripts/assert-build.ts
