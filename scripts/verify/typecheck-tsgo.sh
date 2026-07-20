#!/usr/bin/env bash
set -euo pipefail

# Soak fallback diagnostic for the tsgo→tsc canonical swap (openspec change
# adopt-typescript-7-stable, typescript-toolchain soak path).
#
# Runs the PRIOR canonical type-check implementation (tsgo, TypeScript 7
# native preview) with equivalent arguments: per-package `compile:tsgo`
# scripts plus the type-contract tsconfig. Invoke directly:
#
#   bash scripts/verify/typecheck-tsgo.sh
#
# Deliberately NOT a vp run task: fallback diagnostics are excluded from
# root verify/verify:full and all owner claims, and the root task graph is
# budget-guarded (owner-graph.test.ts). Same direct-run pattern as
# dts-parity.sh. A follow-on change deletes this script, the per-package
# `compile:tsgo` scripts, and the @typescript/native-preview devDependency
# after >=1 week of stable canonical operation.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -x node_modules/.bin/tsgo ]; then
  echo "ERROR: tsgo not found — the soak fallback may already have been removed. Run: bun install" >&2
  exit 2
fi

bun run --filter './packages/*' compile:tsgo
exec node_modules/.bin/tsgo -p packages/system/__tests__/tsconfig.test-d.json --noEmit
