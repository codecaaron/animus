#!/usr/bin/env bash
set -euo pipefail

# verify:compile — each package's `compile`: `bun check`, which reports the
# errors tsc does, except the showcase on tsc, where bun check types a
# variant's numeric keys as numbers and tsc does not.
# Reads source; no dist/ precondition.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_bun_install

exec bun run --filter './packages/*' compile
