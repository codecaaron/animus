#!/usr/bin/env bash
# scripts/hygiene/cleanup-diff.sh
#
# Diff-scoped cleanup cascade. Runs three layers against the files changed
# between $BASE_REF and HEAD, iterating until convergence or the iteration
# cap is hit.
#
#   Layer 1 — intra-file unused-decl stripping (biome, scoped --unsafe)
#   Layer 2 — cross-file unused-export / unused-dep auto-fix (fallow fix)
#   Layer 3 — empty-file deletion (bash heuristic — whitespace/comments only)
#
# USAGE:
#   bash scripts/hygiene/cleanup-diff.sh             # dry-run (default)
#   bash scripts/hygiene/cleanup-diff.sh --apply     # mutate
#   bash scripts/hygiene/cleanup-diff.sh --base HEAD~3
#
# Env fallbacks:
#   HYGIENE_BASE_REF     base ref if --base not passed (default: main)
#
# CONTRACT: read-only `verify:*` tier family is unaffected. This script is
# the only sanctioned mutating entry point. Safety envelope runs
# verify:compile + verify:lint post-apply; on failure, script exits nonzero
# and does NOT auto-revert.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/verify/_preconditions.sh
source "$ROOT/scripts/verify/_preconditions.sh"

# ---------- flag parsing ----------

APPLY=0
BASE_REF="${HYGIENE_BASE_REF:-main}"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --base)
      BASE_REF="$2"
      shift 2
      ;;
    --base=*)
      BASE_REF="${1#--base=}"
      shift
      ;;
    -h | --help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

MODE="dry-run"
if [ "$APPLY" -eq 1 ]; then MODE="apply"; fi

# ---------- preconditions ----------

require_hygiene_cleanup_deps

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "ERROR: base ref '$BASE_REF' not found. Run: git fetch origin $BASE_REF" >&2
  exit 1
fi

# ---------- file-set derivation ----------

derive_file_set() {
  # Returns TS/JS files changed vs BASE_REF that still exist in the working tree.
  # Filters out legacy/**, node_modules/**, dist/**, target/** — out-of-scope by contract.
  # Deleted or non-existent paths are filtered out so layers don't trip on them.
  git diff --name-only "$BASE_REF"...HEAD 2>/dev/null \
    | grep -E '\.(ts|tsx|js|mjs|cjs)$' \
    | grep -v -E '^(legacy|node_modules|dist|target)/' \
    | grep -v -E '(^|/)(node_modules|dist|target|\.next|\.vite)/' \
    | while read -r f; do [ -f "$f" ] && echo "$f"; done \
    || true
}

FILES_INITIAL=$(derive_file_set)
FILES_COUNT_INITIAL=$(printf '%s\n' "$FILES_INITIAL" | grep -c . || true)

# ---------- header ----------

echo "==============================================="
echo "hygiene cleanup cascade"
echo "  base ref:   $BASE_REF"
echo "  mode:       $MODE"
echo "  files:      $FILES_COUNT_INITIAL (TS/JS in diff vs $BASE_REF)"
echo "==============================================="

if [ "$FILES_COUNT_INITIAL" -eq 0 ]; then
  echo "no TS/JS files in diff; nothing to do"
  exit 0
fi

# ---------- helpers ----------

# count files changed since a snapshot (by content hash)
snapshot_hashes() {
  local files="$1"
  printf '%s\n' "$files" | while read -r f; do
    [ -z "$f" ] && continue
    if [ -f "$f" ]; then
      shasum -a 1 "$f" 2>/dev/null || true
    else
      echo "<deleted> $f"
    fi
  done
}

count_diff_hashes() {
  local before="$1"
  local after="$2"
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | grep -c '^[<>]' || true
  # Note: diff output has 2 lines per change (< and >); caller divides by 2.
}

# Semantically-empty heuristic.
# Returns 0 (empty) if the file contains no semantically-load-bearing content:
# no top-level decls, no triple-slash directives, no declare blocks, no
# side-effect imports, no re-exports.
# Conservative — re-exports with dead-link targets are not deleted (MVP limitation).
# `.d.ts` files are preserved by default: deletion requires human review since
# triple-slash + declare-module patterns carry TS-ambient semantics.
is_semantically_empty() {
  local f="$1"
  # .d.ts is out-of-scope for auto-deletion
  case "$f" in
    *.d.ts) return 1 ;;
  esac
  # Triple-slash directives (///) are TS-semantic; preserve
  if grep -q -E '^[[:space:]]*///' "$f" 2>/dev/null; then return 1; fi
  # `declare module|namespace|global` blocks are ambient decls; preserve
  if grep -q -E '^[[:space:]]*declare[[:space:]]+(module|namespace|global)' "$f" 2>/dev/null; then return 1; fi
  # Any `import` statement (including side-effect `import './x'`) means
  # the file is an executable module, not empty
  if grep -q -E "^[[:space:]]*import([[:space:]]|['\"])" "$f" 2>/dev/null; then return 1; fi
  # Any top-level export keeps the file alive
  if grep -q -E '^[[:space:]]*export[[:space:]]' "$f" 2>/dev/null; then return 1; fi
  # Any other non-blank, non-comment line means content remains
  local content
  content=$(grep -v -E '^[[:space:]]*$' "$f" 2>/dev/null \
    | grep -v -E '^[[:space:]]*//' \
    | grep -v -E '^[[:space:]]*/\*' \
    | grep -v -E '^[[:space:]]*\*' \
    | grep -v -E '^[[:space:]]*\*/' \
    | head -n1 || true)
  if [ -z "$content" ]; then
    return 0
  fi
  return 1
}

# ---------- layer implementations ----------

layer1_biome() {
  local files="$1"
  local before after
  before=$(snapshot_hashes "$files")
  local file_args=()
  while IFS= read -r f; do
    [ -n "$f" ] && file_args+=("$f")
  done <<< "$files"
  [ ${#file_args[@]} -eq 0 ] && { echo "0"; return; }

  local biome_args=(
    check
    --only=correctness/noUnusedImports
    --only=correctness/noUnusedVariables
    --only=correctness/noUnusedFunctionParameters
    --only=correctness/noUnusedPrivateClassMembers
  )
  if [ "$APPLY" -eq 1 ]; then
    biome_args+=(--write --unsafe)
  fi

  bunx --bun @biomejs/biome "${biome_args[@]}" "${file_args[@]}" \
    >/tmp/hygiene-layer1.log 2>&1 || true

  after=$(snapshot_hashes "$files")
  local changes=$(count_diff_hashes "$before" "$after")
  echo $((changes / 2))
}

layer2_fallow() {
  local before after files="$1"
  before=$(snapshot_hashes "$files")

  local fallow_args=(fix --changed-since "$BASE_REF" --quiet)
  if [ "$APPLY" -eq 1 ]; then
    fallow_args+=(--yes)
  else
    fallow_args+=(--dry-run)
  fi

  set +e
  fallow "${fallow_args[@]}" >/tmp/hygiene-layer2.log 2>&1
  local ec=$?
  set -e
  if [ "$ec" -eq 2 ]; then
    echo "ERROR: fallow fix runtime failure (exit 2). See /tmp/hygiene-layer2.log" >&2
    return 1
  fi

  after=$(snapshot_hashes "$files")
  local changes=$(count_diff_hashes "$before" "$after")
  echo $((changes / 2))
}

layer3_empty_files() {
  local files="$1"
  local deleted=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ ! -f "$f" ] && continue
    if is_semantically_empty "$f"; then
      if [ "$APPLY" -eq 1 ]; then
        rm "$f"
      fi
      echo "  would delete: $f"
      deleted=$((deleted + 1))
    fi
  done <<< "$files"
  echo "$deleted"
}

# ---------- cascade loop ----------

MAX_ITERATIONS=5
iteration=0
cumulative_l1=0
cumulative_l2=0
cumulative_l3=0
disposition=""

while [ "$iteration" -lt "$MAX_ITERATIONS" ]; do
  iteration=$((iteration + 1))
  files=$(derive_file_set)
  files_count=$(printf '%s\n' "$files" | grep -c . || true)

  echo ""
  echo "--- iteration $iteration (working set: $files_count files) ---"

  if [ "$files_count" -eq 0 ]; then
    echo "  working set empty; cascade terminating"
    disposition="converged"
    break
  fi

  l1=$(layer1_biome "$files")
  echo "  Layer 1 (biome):           ${l1} files modified"
  cumulative_l1=$((cumulative_l1 + l1))

  l2=$(layer2_fallow "$files")
  echo "  Layer 2 (fallow fix):      ${l2} files modified"
  cumulative_l2=$((cumulative_l2 + l2))

  # Re-derive file set (Layer 2 may have touched files outside the diff, e.g. package.json)
  files=$(derive_file_set)

  l3_output=$(layer3_empty_files "$files")
  l3=$(printf '%s\n' "$l3_output" | tail -n1)
  l3_paths=$(printf '%s\n' "$l3_output" | grep '^  would delete:' || true)
  if [ "$APPLY" -eq 1 ]; then
    echo "  Layer 3 (empty-file):      ${l3} files deleted"
  else
    echo "  Layer 3 (empty-file):      ${l3} files flagged for deletion"
  fi
  [ -n "$l3_paths" ] && printf '%s\n' "$l3_paths"
  cumulative_l3=$((cumulative_l3 + l3))

  if [ "$l1" -eq 0 ] && [ "$l2" -eq 0 ] && [ "$l3" -eq 0 ]; then
    disposition="converged"
    break
  fi

  if [ "$APPLY" -eq 0 ]; then
    # Dry-run: cannot actually iterate because nothing was mutated.
    # Report the single-pass result and exit.
    disposition="dry-run-single-pass"
    break
  fi
done

if [ -z "$disposition" ]; then
  disposition="cap-hit"
fi

# ---------- final summary ----------

echo ""
echo "==============================================="
echo "cascade summary"
echo "  iterations:     $iteration"
echo "  Layer 1 total:  $cumulative_l1"
echo "  Layer 2 total:  $cumulative_l2"
echo "  Layer 3 total:  $cumulative_l3"
echo "  disposition:    $disposition"
echo "==============================================="

case "$disposition" in
  converged)
    : # continue to safety envelope if apply
    ;;
  dry-run-single-pass)
    echo "Run 'bun run hygiene:apply' to execute the cascade to convergence."
    exit 0
    ;;
  cap-hit)
    echo "ERROR: cascade hit MAX_ITERATIONS=$MAX_ITERATIONS without converging" >&2
    exit 1
    ;;
  *)
    echo "ERROR: unknown disposition: $disposition" >&2
    exit 1
    ;;
esac

# ---------- safety envelope (apply only) ----------

if [ "$APPLY" -eq 0 ]; then
  exit 0
fi

echo ""
echo "--- safety envelope: verify:compile ---"
if ! bun run verify:compile >/tmp/hygiene-verify-compile.log 2>&1; then
  echo "ERROR: verify:compile failed after cleanup. See /tmp/hygiene-verify-compile.log" >&2
  echo "NOTE: cleanup changes NOT reverted. Inspect with 'git diff' and partial-revert as needed." >&2
  exit 1
fi
echo "  ✓ verify:compile passed"

echo ""
echo "--- safety envelope: verify:lint ---"
if ! bun run verify:lint >/tmp/hygiene-verify-lint.log 2>&1; then
  echo "ERROR: verify:lint failed after cleanup. See /tmp/hygiene-verify-lint.log" >&2
  echo "NOTE: cleanup changes NOT reverted. Inspect with 'git diff' and partial-revert as needed." >&2
  exit 1
fi
echo "  ✓ verify:lint passed"

echo ""
echo "✓ cascade converged and safety envelope passed"
