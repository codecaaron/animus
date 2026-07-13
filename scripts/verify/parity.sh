#!/usr/bin/env bash
# verify:parity preconditions + harness invocation.
# Fail-loud contract (root CLAUDE.md): name the missing/stale artifact and
# the exact command that repairs it; never rebuild silently.
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! compgen -G "packages/extract/*.node" > /dev/null; then
  echo "ERROR: v1 NAPI binary missing. Run: vp run build:extract"; exit 1
fi
if ! compgen -G "packages/extract/crates/extract-v2/*.node" > /dev/null; then
  echo "ERROR: v2 NAPI binary missing. Run: vp run build:extract-v2"; exit 1
fi
# Freshness: any Rust source newer than its engine binary is a stale gate.
v1_bin=$(ls -t packages/extract/*.node | head -1)
if [ -n "$(find packages/extract/src -name '*.rs' -newer "$v1_bin" -print -quit)" ]; then
  echo "ERROR: v1 NAPI binary stale (src newer). Run: vp run build:extract"; exit 1
fi
v2_bin=$(ls -t packages/extract/crates/extract-v2/*.node | head -1)
if [ -n "$(find packages/extract/crates/extract-v2/src -name '*.rs' -newer "$v2_bin" -print -quit)" ]; then
  echo "ERROR: v2 NAPI binary stale (src newer). Run: vp run build:extract-v2"; exit 1
fi

cd packages/_parity
# Leg 1: self-checks (cross-process determinism; gates baselines) — BOTH
# engines, plus the v2 thread-variation leg (G8/NS6: rayon parallelism
# must not leak into outputs).
bun run src/cli.ts --engines v1,v1 --self-check --both
bun run src/cli.ts --engines v2,v2 --self-check --both
bun run src/cli.ts --engines v2,v2 --self-check --threads 1,8
# Leg 2: G-SEAM transform-evaluation battery, both engines vs recorded v1 baseline.
bun run tools/seam-battery.ts
bun run tools/seam-battery.ts --engine v2
# Leg 3: the real scoreboard — full v1-vs-v2 differential, both dev modes,
# with the v2 parse-budget check armed.
exec bun run src/cli.ts --engines v1,v2 --both --parse-count "$@"
