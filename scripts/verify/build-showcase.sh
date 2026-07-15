#!/usr/bin/env bash
set -euo pipefail

# verify:build:showcase — Showcase vite build.
# Preconditions: fresh NAPI + fresh extract/system/vite-plugin/properties dists.
# Showcase resolves all four packages through dist.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi
# Showcase defaults to engine v2 (user flip, journal 2026-07-13 15:50) —
# the tier must fail loud on a missing/stale v2 binary, not die later in
# assert noise (row-13 review B2).
require_fresh_napi_v2
require_fresh_package_dist extract
require_fresh_package_dist system
require_fresh_package_dist vite-plugin
require_fresh_package_dist properties

exec bun run --filter './packages/showcase' build
