#!/usr/bin/env bash
set -euo pipefail

# verify:compile — tsc --noEmit across all packages.
# Reads source; no dist/ precondition.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_bun_install

exec bun run --filter './packages/*' compile
