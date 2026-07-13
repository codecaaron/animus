#!/usr/bin/env bash
set -euo pipefail

# verify:build:next — Next consumer fixture build.
# Preconditions: fresh NAPI + fresh extract/system/next-plugin dists.
# The bundler invokes the Next plugin at build time and consumer code resolves
# @animus-ui/system through dist.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi
# Both engine binaries ship in the package (extract-v2-default-flip);
# the tier fails loud on a missing/stale v2 binary regardless of the
# engine the fixture selects.
require_fresh_napi_v2
require_fresh_package_dist extract
require_fresh_package_dist system
require_fresh_package_dist next-plugin

exec bun run --filter '@animus-ui/next-app' build
