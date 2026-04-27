#!/usr/bin/env bash
# scripts/hygiene/_receipts.sh
#
# Bash-side deletion-receipt emitter for the code-hygiene cascade. Source from
# scripts that need to emit receipts directly (Layer A/B/D bash wrappers via
# JSON pipelines). TS-side emission lives in scripts/hygiene/_receipts.ts and
# is used by delete-unused.ts (Layer C) and reconcile-after-knip.ts (Layer D1).
#
# Receipts file is truncated by run.sh at orchestrator startup; emit_receipt
# only appends. When RECEIPTS_FILE is unset, emit_receipt is a no-op.

emit_receipt() {
  # Args: layer verb target kind [extras_json]
  # Reads RECEIPTS_FILE and HYGIENE_ITER from env.
  local layer="$1" verb="$2" target="$3" kind="$4" extras="${5:-{\}}"
  if [ -z "${RECEIPTS_FILE:-}" ]; then
    return 0
  fi
  local target_json
  target_json="$(jq -Rsn --arg t "$target" '$t')"
  printf '{"v":1,"iter":%d,"layer":"%s","verb":"%s","target":%s,"kind":"%s","extras":%s}\n' \
    "${HYGIENE_ITER:-0}" "$layer" "$verb" "$target_json" "$kind" "$extras" \
    >> "$RECEIPTS_FILE"
}
