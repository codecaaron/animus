#!/usr/bin/env bash
set -euo pipefail

BUNX_BIN="${BUNX_BIN:-bunx}"
BUN_BIN="${BUN_BIN:-bun}"
mode="${1:-}"
targets=(showcase vite vinext react-router)
owners=(
  '@animus-ui/showcase'
  '@animus-ui/vite-app'
  '@animus-ui/vinext-app'
  '@animus-ui/react-router-app'
)

if [[ "$mode" != validate && "$mode" != deploy ]]; then
  echo "ERROR: usage: $0 <validate|deploy>" >&2
  exit 2
fi
if [[ "${GITHUB_REF:-}" != 'refs/heads/main' ]]; then
  echo "ERROR: Worker deployment requires GITHUB_REF=refs/heads/main" >&2
  exit 1
fi
if [[ -z "${GITHUB_SHA:-}" ]]; then
  echo "ERROR: GITHUB_SHA is required for Worker deployment" >&2
  exit 1
fi

if [[ "$mode" == validate ]]; then
  "$BUN_BIN" -e "const m=require('./packages/extract/animus-extract.linux-x64-gnu.node'); if (!Object.keys(m).length) throw new Error('V1 NAPI exports missing')"
  "$BUN_BIN" -e "const m=require('./packages/extract/crates/extract-v2/animus-extract-v2.linux-x64-gnu.node'); if (!Object.keys(m).length) throw new Error('V2 NAPI exports missing')"
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
  exit 0
fi

for variable in CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN; do
  if [[ -z "${!variable:-}" ]]; then
    echo "ERROR: ${variable} is required for Worker deployment" >&2
    exit 1
  fi
done

failed_targets=()
for target in "${targets[@]}"; do
  echo "[workers] deploy target=${target} source-sha=${GITHUB_SHA}"
  if ! "$BUN_BIN" run "deploy:${target}"; then
    echo "ERROR: deploy failed: ${target}" >&2
    failed_targets+=("$target")
  fi
done

if ((${#failed_targets[@]} != 0)); then
  echo "ERROR: Worker deployment failed for targets: ${failed_targets[*]}" >&2
  exit 1
fi
