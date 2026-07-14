#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_dir e2e/vinext-app/dist 'vp run verify:build:vinext'
require_fresh_package_dist _assertions

exec bun run e2e/vinext-app/scripts/assert-build.ts
