#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

bunx vp test run \
  scripts/verify/workers-config.test.ts \
  scripts/verify/build-extract-v2.test.ts \
  e2e/vite-app/scripts/worker.test.ts

cd "$ROOT/e2e/vinext-app"
bunx vp test run --config vitest.config.ts \
  scripts/config.test.ts scripts/hydration.test.tsx

cd "$ROOT/e2e/react-router-app"
exec bunx vp test run --config vitest.config.ts \
  scripts/config.test.ts scripts/worker.test.ts scripts/hydration.test.tsx
