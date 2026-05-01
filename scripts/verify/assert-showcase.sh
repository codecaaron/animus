#!/usr/bin/env bash
set -euo pipefail

# verify:assert:showcase — positional assertions on showcase build output.
# Precondition: packages/showcase/dist/ exists.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_dir packages/showcase/dist 'vp run verify:build:showcase'
require_fresh_package_dist _assertions

exec bun run scripts/assert-showcase-build.ts
