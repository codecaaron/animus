#!/usr/bin/env bash
set -euo pipefail

# verify:unit:ts — TS unit tests across explicit path list.
# bun test transpiles TS on the fly; no dist/ precondition.
# Explicit path list (not glob-exclusion) per tasks §3.6 — bun test globs by filename,
# not path, so canary (packages/extract/tests) and integration (_integration/__tests__)
# cannot be reliably excluded via a pattern. Listed paths ARE the unit-test scope.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

exec bun test \
  packages/system/__tests__ \
  packages/vite-plugin/tests \
  packages/properties/__tests__ \
  packages/_assertions/__tests__
