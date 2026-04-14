#!/usr/bin/env bash
set -euo pipefail

# verify:integration — full pipeline E2E tests in packages/_integration/__tests__.
# Preconditions: fresh NAPI binary + fresh @animus-ui/extract dist + fresh @animus-ui/system dist.
# Integration imports @animus-ui/extract/pipeline AND resolves @animus-ui/system through dist.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi
require_fresh_package_dist extract
require_fresh_package_dist system

exec bun run --filter '@animus-ui/integration' test
