#!/usr/bin/env bash
# verify:parity after oracle inversion: committed v2 baselines vs fresh v2.
# Ordinary verification never writes packages/_parity/baselines/**.
set -euo pipefail
cd "$(dirname "$0")/../.."

source scripts/verify/_preconditions.sh
require_fresh_napi_v2

cd packages/_parity
bun run src/cli.ts --self-check --both
bun run src/cli.ts --self-check --threads 1,8 --both
bun run tools/seam-battery.ts
exec bun run src/cli.ts --both
