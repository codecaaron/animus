#!/usr/bin/env bash
set -euo pipefail

# verify:canary — NAPI boundary snapshot tests.
# Precondition: fresh NAPI binary (exists AND newer than Rust source).
# Does NOT require packages/extract/dist/ — canary uses require('../index.js') directly.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

napi_binary=$(ls packages/extract/*.node 2>/dev/null | head -n1 || true)
if [ -z "$napi_binary" ]; then
  echo "ERROR: NAPI binary missing. Run: bun run build:extract" >&2
  exit 1
fi

newest_src=$(find packages/extract/src -name '*.rs' -newer "$napi_binary" -print -quit 2>/dev/null || true)
if [ -n "$newest_src" ]; then
  echo "ERROR: NAPI binary is stale (Rust source newer than .node). Run: bun run build:extract" >&2
  exit 1
fi

exec bun test packages/extract/tests/canary.test.ts
