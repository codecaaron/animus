#!/usr/bin/env bash
set -euo pipefail

# verify:assert:showcase — positional assertions on showcase build output.
# Precondition: packages/showcase/dist/ exists.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -d packages/showcase/dist ]; then
  echo "ERROR: packages/showcase/dist/ missing. Run: bun run verify:build:showcase" >&2
  exit 1
fi

exec bash scripts/assert-showcase.sh
