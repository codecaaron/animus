#!/usr/bin/env bash
set -euo pipefail

# verify:build:vite — Vite consumer fixture build.
# Preconditions: fresh NAPI + fresh extract/system/vite-plugin/properties dists.
# The bundler invokes the Vite plugin at build time and consumer code resolves
# @animus-ui/system through dist.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi
require_fresh_package_dist extract
require_fresh_package_dist system
require_fresh_package_dist vite-plugin
require_fresh_package_dist properties

exec bun run --filter '@animus-ui/vite-app' build
