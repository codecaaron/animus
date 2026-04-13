#!/usr/bin/env bash
set -euo pipefail

# verify:compile — tsc --noEmit across all packages.
# Reads source; no dist/ precondition.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -x node_modules/.bin/tsc ]; then
  echo "ERROR: tsc binary not found at node_modules/.bin/tsc. Run: bun install" >&2
  exit 1
fi

exec bun run --filter './packages/*' compile
