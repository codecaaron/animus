#!/usr/bin/env bash
set -euo pipefail

# Runs its arguments once the host's v2 NAPI binary is fresh: the
# TypeScript unit and coverage tiers probe files through the native engine.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi_v2

exec "$@"
