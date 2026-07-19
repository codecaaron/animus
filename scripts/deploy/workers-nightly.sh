#!/usr/bin/env bash
set -euo pipefail

BUNX_BIN="${BUNX_BIN:-bunx}"
BUN_BIN="${BUN_BIN:-bun}"
targets=(showcase vite vinext react-router)
owners=(
  '@animus-ui/showcase'
  '@animus-ui/vite-app'
  '@animus-ui/vinext-app'
  '@animus-ui/react-router-app'
)

if [[ "${GITHUB_REF:-}" != 'refs/heads/main' ]]; then
  echo "ERROR: nightly Worker deployment requires GITHUB_REF=refs/heads/main" >&2
  exit 1
fi

for variable in GITHUB_SHA CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN; do
  if [[ -z "${!variable:-}" ]]; then
    echo "ERROR: ${variable} is required for nightly Worker deployment" >&2
    exit 1
  fi
done

"$BUNX_BIN" vp run build:extract-v1
"$BUNX_BIN" vp run build:extract-v2
"$BUNX_BIN" vp run build:ts

for owner in "${owners[@]}"; do
  "$BUNX_BIN" vp run "${owner}#verify:build"
done

for owner in "${owners[@]}"; do
  "$BUNX_BIN" vp run "${owner}#verify:assert"
done

for owner in "${owners[@]}"; do
  "$BUNX_BIN" vp run "${owner}#verify:dry-run"
done

failed_targets=()
for target in "${targets[@]}"; do
  echo "[nightly] deploy target=${target} source-sha=${GITHUB_SHA}"
  if ! "$BUN_BIN" run "deploy:${target}"; then
    echo "ERROR: deploy failed: ${target}" >&2
    failed_targets+=("$target")
  fi
done

if ((${#failed_targets[@]} != 0)); then
  echo "ERROR: nightly Worker deployment failed for targets: ${failed_targets[*]}" >&2
  exit 1
fi
