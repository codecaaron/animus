#!/usr/bin/env bash
set -euo pipefail

# verify:build:react-router — React Router v8 SSR Worker production build.
# Preconditions: fresh NAPI binaries and every imported Animus package dist.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi
require_fresh_napi_v2
require_fresh_package_dist extract
require_fresh_package_dist system
require_fresh_package_dist vite-plugin
require_fresh_package_dist properties
require_fresh_package_dist test-ds

exec bun run --filter '@animus-ui/react-router-app' build
