#!/usr/bin/env bash
# scripts/hygiene/run.sh
#
# End-of-work code-hygiene cascade orchestrator. Two modes (scan | fix),
# two scopes (changed | all). See openspec/specs/code-hygiene/spec.md for
# the authoritative contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# -----------------------------------------------------------------------------
# Defaults
# -----------------------------------------------------------------------------
MODE="scan"
SCOPE="changed"
BASE_REF="${HYGIENE_BASE_REF:-main}"
MAX_ITERATIONS="${HYGIENE_ITERATIONS:-5}"
YES_APPLY_ALL=0

# Help text is constructed AFTER env-var resolution so the displayed defaults
# match what the run will actually use. Built lazily inside print_help.
print_help() {
  cat <<EOF
Usage: bash scripts/hygiene/run.sh [flags]
       bun run hygiene [flags]

Flags:
  --mode=scan|fix       scan reports what would change; fix applies mutations (default: scan)
  --scope=changed|all   changed = git diff vs BASE; all = whole repo (default: changed)
  --base=<git-ref>      base ref for --scope=changed (env: HYGIENE_BASE_REF, currently: $BASE_REF)
  --iterations=<n>      cascade iteration cap (env: HYGIENE_ITERATIONS, currently: $MAX_ITERATIONS)
  --apply               alias for --mode=fix
  --all                 alias for --scope=all
  --yes-apply-all       required confirmation flag for non-interactive --apply --all
  -h, --help            this help

Scan mode requires a clean worktree (commit or stash first).
Fix mode runs a safety envelope (verify:compile + verify:lint) after the cascade.
On envelope failure the orchestrator exits non-zero WITHOUT auto-reverting.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode=*) MODE="${1#*=}" ;;
    --mode) MODE="$2"; shift ;;
    --scope=*) SCOPE="${1#*=}" ;;
    --scope) SCOPE="$2"; shift ;;
    --base=*) BASE_REF="${1#*=}" ;;
    --base) BASE_REF="$2"; shift ;;
    --iterations=*) MAX_ITERATIONS="${1#*=}" ;;
    --iterations) MAX_ITERATIONS="$2"; shift ;;
    --apply) MODE="fix" ;;
    --all) SCOPE="all" ;;
    --yes-apply-all) YES_APPLY_ALL=1 ;;
    -h|--help) print_help; exit 0 ;;
    *)
      echo "ERROR: unknown flag: $1" >&2
      echo "  See --help for usage." >&2
      exit 1
      ;;
  esac
  shift
done

case "$MODE" in
  scan|fix) ;;
  *) echo "ERROR: --mode must be scan or fix (got: $MODE)" >&2; exit 1 ;;
esac
case "$SCOPE" in
  changed|all) ;;
  *) echo "ERROR: --scope must be changed or all (got: $SCOPE)" >&2; exit 1 ;;
esac

# -----------------------------------------------------------------------------
# --apply --all confirmation gate (highest blast radius)
# -----------------------------------------------------------------------------
# Daily-driver `--apply` (changed scope) does not prompt. The `--apply --all`
# combination crosses workspace boundaries and can ripple into build-time-only
# consumers — surface it explicitly. TTY: interactive prompt. Non-TTY (agent):
# require explicit `--yes-apply-all` flag.
if [ "$MODE" = "fix" ] && [ "$SCOPE" = "all" ] && [ "$YES_APPLY_ALL" -ne 1 ]; then
  if [ -t 0 ]; then
    printf "Type 'apply-all' to continue: "
    read -r confirm || confirm=""
    if [ "$confirm" != "apply-all" ]; then
      echo "Aborted." >&2
      exit 1
    fi
  else
    echo "ERROR: --apply --all requires --yes-apply-all in non-interactive context" >&2
    exit 1
  fi
fi

# -----------------------------------------------------------------------------
# Preconditions
# -----------------------------------------------------------------------------
source "$ROOT/scripts/verify/_preconditions.sh"
require_code_hygiene_deps

# -----------------------------------------------------------------------------
# Receipts substrate
# -----------------------------------------------------------------------------
# Every layer-applied operation appends one v1-schema record to
# .hygiene/receipts.jsonl. The presenter (added in a later phase) derives
# the convergence verdict, Layer D volume signal, and category-drift WARN
# from this file. Per-run scope: truncated at startup.
RECEIPTS_DIR="$ROOT/.hygiene"
RECEIPTS_FILE="$RECEIPTS_DIR/receipts.jsonl"
mkdir -p "$RECEIPTS_DIR"
: > "$RECEIPTS_FILE"
export RECEIPTS_FILE
source "$ROOT/scripts/hygiene/_receipts.sh"

# -----------------------------------------------------------------------------
# Banner
# -----------------------------------------------------------------------------
echo "== code-hygiene =="
echo "  mode:       $MODE"
echo "  scope:      $SCOPE"
[ "$SCOPE" = "changed" ] && echo "  base:       $BASE_REF"
echo "  iterations: $MAX_ITERATIONS (max)"
echo

# -----------------------------------------------------------------------------
# Scan-mode clean-worktree guard + recovery snapshot
# -----------------------------------------------------------------------------
SNAPSHOT_SHA=""
if [ "$MODE" = "scan" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "ERROR: scan mode requires clean worktree. Commit or stash changes and re-run." >&2
    exit 1
  fi
  SNAPSHOT_SHA="$(git stash create 2>/dev/null || true)"
fi

# -----------------------------------------------------------------------------
# File-set derivation
# -----------------------------------------------------------------------------
declare -a FILES=()
if [ "$SCOPE" = "changed" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && [ -f "$line" ] && FILES+=("$line")
  done < <(git diff --name-only --diff-filter=d "$BASE_REF" -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' 2>/dev/null || true)
  echo "  files:      ${#FILES[@]} (changed vs $BASE_REF)"
else
  echo "  files:      (full repo — biome + knip use project config)"
fi

if [ "$SCOPE" = "changed" ] && [ "${#FILES[@]}" -eq 0 ]; then
  echo
  echo "No files in scope. Nothing to do."
  if [ -n "$SNAPSHOT_SHA" ]; then
    echo "recovery snapshot: $SNAPSHOT_SHA (recover via: git stash store $SNAPSHOT_SHA && git stash pop)"
  fi
  exit 0
fi

# -----------------------------------------------------------------------------
# Workspace derivation (Layer D scoping in scope=changed)
# -----------------------------------------------------------------------------
derive_workspaces() {
  local file dir name
  for file in "${FILES[@]}"; do
    dir="$(dirname "$file")"
    while [ "$dir" != "." ] && [ "$dir" != "/" ]; do
      if [ -f "$dir/package.json" ]; then
        name="$(sed -n 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$dir/package.json" | head -n 1)"
        [ -n "$name" ] && printf '%s\n' "$name"
        break
      fi
      dir="$(dirname "$dir")"
    done
  done | awk '!seen[$0]++'
}

declare -a KNIP_WORKSPACE_ARGS=()
if [ "$SCOPE" = "changed" ]; then
  while IFS= read -r ws; do
    [ -n "$ws" ] && KNIP_WORKSPACE_ARGS+=(--workspace "$ws")
  done < <(derive_workspaces)
  # Count = half (each ws uses two args)
  echo "  workspaces: $((${#KNIP_WORKSPACE_ARGS[@]} / 2)) targeted by knip"
fi

# Derive workspace dirs (paths) for dist-staleness checks. In scope=changed,
# walk each touched file up to its package.json. In scope=all, leave empty
# so the helper iterates packages/* itself.
derive_workspace_dirs() {
  local file dir
  for file in "${FILES[@]}"; do
    dir="$(dirname "$file")"
    while [ "$dir" != "." ] && [ "$dir" != "/" ]; do
      if [ -f "$dir/package.json" ]; then
        printf '%s\n' "$dir"
        break
      fi
      dir="$(dirname "$dir")"
    done
  done | awk '!seen[$0]++'
}

declare -a WORKSPACE_DIRS=()
if [ "$SCOPE" = "changed" ]; then
  while IFS= read -r d; do
    [ -n "$d" ] && WORKSPACE_DIRS+=("$d")
  done < <(derive_workspace_dirs)
fi

echo

# -----------------------------------------------------------------------------
# Dist-staleness precondition
# -----------------------------------------------------------------------------
# Knip resolves cross-workspace imports against package.json main/module
# (which point at dist/). A stale dist can make knip flag live exports as
# unused, which Layer D will then remove. Fix mode hard-fails; scan mode
# warns and continues to preserve preview ergonomics.
if [ "$MODE" = "fix" ]; then
  if ! require_dist_fresh_for_workspaces fix "${WORKSPACE_DIRS[@]}"; then
    exit 1
  fi
else
  require_dist_fresh_for_workspaces scan "${WORKSPACE_DIRS[@]}" || true
fi
echo

# -----------------------------------------------------------------------------
# Cascade
# -----------------------------------------------------------------------------
BIOME=(bunx --bun @biomejs/biome)
KNIP=(bunx --bun knip)

run_layer_a() {
  # Capture pre-fix diagnostics for receipts; biome's --write applies all safe
  # fixes, and we record one receipt per observed diagnostic as a best-effort
  # audit signal. False-positive receipts are noise; missing receipts would be
  # corruption — the trade is biased toward signal preservation.
  local biome_json=""
  if [ "$SCOPE" = "changed" ]; then
    biome_json="$("${BIOME[@]}" check --reporter=json "${FILES[@]}" 2>/dev/null || true)"
    "${BIOME[@]}" check --write "${FILES[@]}" >/dev/null 2>&1 || true
  else
    biome_json="$("${BIOME[@]}" check --reporter=json 2>/dev/null || true)"
    "${BIOME[@]}" check --write >/dev/null 2>&1 || true
  fi
  if [ -n "$biome_json" ]; then
    printf '%s' "$biome_json" | bun run "$ROOT/scripts/hygiene/_emit-biome-receipts.ts" A || true
  fi
}

run_layer_b() {
  local -a scoped=(
    --unsafe
    --only=correctness/noUnusedImports
    --only=correctness/noUnusedPrivateClassMembers
  )
  local biome_json=""
  if [ "$SCOPE" = "changed" ]; then
    biome_json="$("${BIOME[@]}" check --reporter=json "${scoped[@]}" "${FILES[@]}" 2>/dev/null || true)"
    "${BIOME[@]}" check --write "${scoped[@]}" "${FILES[@]}" >/dev/null 2>&1 || true
  else
    biome_json="$("${BIOME[@]}" check --reporter=json "${scoped[@]}" 2>/dev/null || true)"
    "${BIOME[@]}" check --write "${scoped[@]}" >/dev/null 2>&1 || true
  fi
  if [ -n "$biome_json" ]; then
    printf '%s' "$biome_json" | bun run "$ROOT/scripts/hygiene/_emit-biome-receipts.ts" B || true
  fi
}

run_layer_c() {
  local biome_json
  if [ "$SCOPE" = "changed" ]; then
    biome_json="$("${BIOME[@]}" check --reporter=json "${FILES[@]}" 2>/dev/null || true)"
  else
    biome_json="$("${BIOME[@]}" check --reporter=json 2>/dev/null || true)"
  fi
  if [ -z "$biome_json" ]; then
    return 0
  fi
  printf '%s' "$biome_json" | bun run "$ROOT/scripts/hygiene/delete-unused.ts" || true
}

run_layer_d() {
  # knip 6.6.2: comma-separated --fix-type does not parse; use repeated --fix-type= form.
  # `types` is intentionally excluded: `declare module` augmentations are
  # invisible to knip's import graph, and transitive type narrowing in
  # consumers (e.g., test-ds branded scales) can silently break compile.
  local -a knip_flags=(
    --fix
    --fix-type=exports
    --fix-type=dependencies
    --fix-type=files
    --allow-remove-files
    --no-progress
  )
  # Pre-fix JSON snapshot drives Layer D receipts. The same scope is used for
  # both the report and the fix to keep them in sync.
  local knip_json=""
  if [ "$SCOPE" = "changed" ]; then
    if [ "${#KNIP_WORKSPACE_ARGS[@]}" -eq 0 ]; then
      echo "  (no workspaces derived; skipping knip)"
      return 0
    fi
    knip_json="$("${KNIP[@]}" --reporter=json --no-progress "${KNIP_WORKSPACE_ARGS[@]}" 2>/dev/null || true)"
    "${KNIP[@]}" "${knip_flags[@]}" "${KNIP_WORKSPACE_ARGS[@]}" >/dev/null 2>&1 || true
  else
    knip_json="$("${KNIP[@]}" --reporter=json --no-progress 2>/dev/null || true)"
    "${KNIP[@]}" "${knip_flags[@]}" >/dev/null 2>&1 || true
  fi
  if [ -n "$knip_json" ]; then
    printf '%s' "$knip_json" | bun run "$ROOT/scripts/hygiene/_emit-knip-receipts.ts" || true
  fi
}

run_layer_d1() {
  # Post-knip coordination pass. Knip's --fix is a single-pass text splice
  # with no post-state reasoning — leaves two coordination gaps:
  #   - 0-byte files that TS treats as scripts (TS2306 on consumers)
  #   - barrel re-exports pointing at bindings knip removed at source
  #     (TS2305 / TS2459)
  # See scripts/hygiene/reconcile-after-knip.ts.
  bun run "$ROOT/scripts/hygiene/reconcile-after-knip.ts" || true
}

fingerprint() {
  # Snapshot of tracked-diff + untracked file list (content-agnostic for untracked).
  git diff HEAD 2>/dev/null
  echo "---untracked---"
  git ls-files --others --exclude-standard 2>/dev/null
}

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

iter=0
converged=0
while [ "$iter" -lt "$MAX_ITERATIONS" ]; do
  iter=$((iter + 1))
  export HYGIENE_ITER="$iter"
  fingerprint > "$TMPDIR/before.fp"

  echo "--- iteration $iter ---"
  echo "Layer A (biome safe)";         run_layer_a
  echo "Layer B (biome unsafe-scoped delete)";    run_layer_b
  echo "Layer C (home-roll deleter)";  run_layer_c
  echo "Layer D (knip --fix)";         run_layer_d
  echo "Layer D1 (reconcile-after-knip)"; run_layer_d1

  fingerprint > "$TMPDIR/after.fp"
  if cmp -s "$TMPDIR/before.fp" "$TMPDIR/after.fp"; then
    converged=1
    break
  fi
done

echo
# -----------------------------------------------------------------------------
# Verdict (presenter-derived, receipt-based)
# -----------------------------------------------------------------------------
# The fingerprint-based `converged` flag is no longer the source of truth — it
# is vulnerable to idempotent A/B churn (whitespace, mtime, .gitattributes
# filters). The presenter computes the verdict from the per-iteration deletion
# count in .hygiene/receipts.jsonl. See spec § "Cascade iterates to
# convergence or iteration cap".
HYGIENE_ITERATIONS_CAP="$MAX_ITERATIONS" \
  bun run "$ROOT/scripts/hygiene/presenter.ts" --cap="$MAX_ITERATIONS" || true

VERDICT_FILE="$RECEIPTS_DIR/verdict.json"
SUGGESTED_EXIT=0
VERDICT_LABEL="unknown"
if [ -f "$VERDICT_FILE" ]; then
  SUGGESTED_EXIT="$(sed -n 's/.*"suggestedExitCode":[[:space:]]*\([0-9]*\).*/\1/p' "$VERDICT_FILE" | head -n 1)"
  [ -z "$SUGGESTED_EXIT" ] && SUGGESTED_EXIT=0
  VERDICT_LABEL="$(sed -n 's/.*"convergence":[[:space:]]*"\([^"]*\)".*/\1/p' "$VERDICT_FILE" | head -n 1)"
  [ -z "$VERDICT_LABEL" ] && VERDICT_LABEL="unknown"
fi

echo

# -----------------------------------------------------------------------------
# Scan-mode report + restore
# -----------------------------------------------------------------------------
if [ "$MODE" = "scan" ]; then
  echo "== scan report =="
  git --no-pager diff --stat || true
  echo
  git --no-pager diff --name-status || true
  echo

  # Restore worktree to pre-cascade state
  git reset --hard HEAD >/dev/null 2>&1 || true
  git clean -fd >/dev/null 2>&1 || true

  echo "== summary =="
  echo "  mode:       scan"
  echo "  scope:      $SCOPE"
  echo "  iterations: $iter"
  echo "  result:     $VERDICT_LABEL"
  if [ -n "$SNAPSHOT_SHA" ]; then
    echo "  snapshot:   $SNAPSHOT_SHA"
    echo
    echo "recovery: git stash store $SNAPSHOT_SHA && git stash pop"
  else
    echo "  snapshot:   (none — worktree was clean)"
  fi
  exit 0
fi

# -----------------------------------------------------------------------------
# Fix-mode safety envelope (no auto-revert)
# -----------------------------------------------------------------------------
envelope_fail() {
  local tool="$1"
  echo
  echo "ERROR: $tool failed after hygiene cascade. Mutations NOT reverted." >&2
  echo >&2
  echo "  Audit trail: $RECEIPTS_FILE" >&2
  echo "    (structured per-layer deletion log; parse with jq for postmortem.)" >&2
  echo >&2
  echo "  Current state:" >&2
  git status --short >&2
  echo >&2
  echo "  Recovery options:" >&2
  echo "    1. Discard all hygiene mutations: git reset --hard HEAD" >&2
  echo "    2. Fix forward: inspect errors and edit." >&2
  echo "    3. Partial keep: git add -p, then git checkout -- for the rest." >&2
  exit 1
}

echo "== safety envelope =="
echo "Running verify:compile..."
bun run verify:compile || envelope_fail "verify:compile"

echo "Running verify:lint..."
bun run verify:lint || envelope_fail "verify:lint"

echo
echo "== summary =="
echo "  mode:       fix"
echo "  scope:      $SCOPE"
echo "  iterations: $iter"
echo "  result:     $VERDICT_LABEL"
echo "  envelope:   PASS"
echo "  receipts:   $RECEIPTS_FILE"
echo
echo "Inspect changes: git diff --stat"
exit "$SUGGESTED_EXIT"
