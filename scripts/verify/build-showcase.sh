#!/usr/bin/env bash
set -euo pipefail

# verify:build:showcase — Showcase vite build.
# Preconditions: fresh NAPI binary AND packages/extract/dist/ (vite plugin invokes extract).

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

if [ ! -f packages/extract/dist/index.mjs ]; then
  echo "ERROR: packages/extract/dist/index.mjs missing. Run: bun run build:ts" >&2
  exit 1
fi

exec bun run --filter './packages/showcase' build
