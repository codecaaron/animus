#!/usr/bin/env bash
set -euo pipefail

# verify:lint — biome check (linter + formatter).
# Source-only tier; no upstream artifact preconditions.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

exec bun run check
