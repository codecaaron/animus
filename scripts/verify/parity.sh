#!/usr/bin/env bash
# verify:parity after oracle inversion: committed extractor baselines vs a fresh extractor.
# Ordinary verification never writes packages/_parity/baselines/**.
set -euo pipefail
cd "$(dirname "$0")/../.."

source scripts/verify/_preconditions.sh
require_fresh_napi

cd packages/_parity
bun run src/cli.ts --self-check --both
bun run src/cli.ts --self-check --threads 1,8 --both
bun run tools/seam-battery.ts
exec bun run src/cli.ts --both
