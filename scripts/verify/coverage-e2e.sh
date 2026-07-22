#!/usr/bin/env bash
set -euo pipefail

# verify:coverage:e2e — V8 line coverage for packages/*/src code exercised by
# consumer production builds (the lanes the vitest unit runner never executes:
# next-plugin/vite-plugin pipelines, extract TS pipeline helpers). Covers all
# five consumers: next-app, vite-app, showcase, vinext-app, react-router-app.
#
# Flow: rebuild TS dists with sourcemaps (ANIMUS_BUILD_SOURCEMAP=1) → run the
# consumer build+assert lanes under NODE_V8_COVERAGE → v8-to-lcov.mjs remaps
# dist/ coverage back to src/ and writes coverage/e2e/lcov.info → rebuild
# sourcemap-free dists so packed/publish artifact shape is unchanged.
#
# Assert lanes run under bun and contribute no V8 coverage; they are included
# so the lane fails loud on a broken build rather than reporting coverage for
# output nothing asserts against.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_bun_install

failed=0
recipe=()
if ! require_fresh_napi_v2; then
  failed=1
  recipe+=("vp run build:extract-v2")
fi
if [ "$failed" -ne 0 ]; then
  recipe_text=""
  for command in "${recipe[@]}"; do
    if [ -n "$recipe_text" ]; then
      recipe_text+=" && "
    fi
    recipe_text+="$command"
  done
  echo "PREPARE: $recipe_text" >&2
  exit 1
fi

RAW_DIR="$ROOT/coverage/e2e/raw"
REPORT_DIR="$ROOT/coverage/e2e"
rm -rf "$RAW_DIR"
mkdir -p "$RAW_DIR"

ANIMUS_BUILD_SOURCEMAP=1 vp run build:ts

# NODE_DISABLE_COMPILE_CACHE: modules served from Node's compile cache (Next
# enables it) report whole-script coverage instead of per-block counts, which
# reads as 100% on every loaded file.
export NODE_DISABLE_COMPILE_CACHE=1

NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/next-app#verify:build'
NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/next-app#verify:assert'
NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/vite-app#verify:build'
NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/vite-app#verify:assert'
NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/showcase#verify:build'
NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/showcase#verify:assert'
NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/vinext-app#verify:build'
NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/vinext-app#verify:assert'
NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/react-router-app#verify:build'
NODE_V8_COVERAGE="$RAW_DIR" vp run '@animus-ui/react-router-app#verify:assert'

# Custom remapper (not c8): scripts loaded through Next's next.config.ts
# require hook execute as SWC-recompiled copies under their original dist
# filename, which breaks any on-disk remap. See v8-to-lcov.mjs header.
node "$ROOT/scripts/verify/v8-to-lcov.mjs" "$RAW_DIR" "$REPORT_DIR/lcov.info" "$ROOT"

# ANIMUS_COVERAGE_KEEP_RAW=1 preserves the raw V8 output for debugging
# attribution problems (e.g. whole-script records from a cached compile).
if [ "${ANIMUS_COVERAGE_KEEP_RAW:-0}" != "1" ]; then
  rm -rf "$RAW_DIR"
fi

# Restore the canonical sourcemap-free dists.
vp run build:ts

echo "coverage:e2e report written to coverage/e2e/lcov.info"
