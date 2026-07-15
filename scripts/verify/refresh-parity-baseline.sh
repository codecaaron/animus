#!/usr/bin/env bash
# Privileged parity-oracle refresh. The CLI validates the checked standing
# journal intent, both modes, exact registered drift, CSS, parse budget, and
# fresh-process/thread determinism before publishing the mode pair.
set -euo pipefail
cd "$(dirname "$0")/../.."

intent="${1:-}"
if [ -z "$intent" ]; then
  echo "ERROR: refresh intent missing. Record a checked entry in packages/_parity/baseline-intents.md, then pass its id."; exit 1
fi
source scripts/verify/_preconditions.sh
require_fresh_napi_v2

cd packages/_parity
bun run src/cli.ts --refresh-baseline "$intent"
