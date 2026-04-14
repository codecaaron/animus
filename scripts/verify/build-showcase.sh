#!/usr/bin/env bash
set -euo pipefail

# verify:build:showcase — Showcase vite build.
# Preconditions: fresh NAPI + fresh extract/system/vite-plugin/properties dists.
# Showcase resolves all four packages through dist.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi
require_fresh_package_dist extract
require_fresh_package_dist system
require_fresh_package_dist vite-plugin
require_fresh_package_dist properties

exec bun run --filter './packages/showcase' build
