#!/usr/bin/env bash
set -euo pipefail

# Runs its arguments once the host's v2 NAPI binary is fresh: the
# TypeScript unit and coverage tiers probe files through the native engine.

if [ "$#" -eq 0 ]; then
  echo "ERROR: with-fresh-napi.sh needs the command to run once the binary is fresh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi_v2

exec "$@"
