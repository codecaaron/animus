#!/usr/bin/env bash
set -euo pipefail

# verify:types — type-contract tests, in two halves.
#
# Source: packages/system/__tests__/tsconfig.test-d.json reads ../src/**.
#
# Published declarations: consumer fixtures import the packages as a consumer
# does, so they resolve through each package's exports to its built dist
# declarations. Each project compiles under consumer-strict options on the
# repo's TypeScript and on 5.9 (e2e/next16-app installs it), and pins exact
# public types: a type that widens, erases or overflows (TS2590) fails here.
# Needs a fresh `vp run build:ts`.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_bun_install

node_modules/.bin/tsc -p packages/system/__tests__/tsconfig.test-d.json --noEmit

require_fresh_package_dist system
require_fresh_package_dist test-ds

TS59=e2e/next16-app/node_modules/typescript/bin/tsc
if [ ! -f "$TS59" ]; then
  echo "ERROR: TypeScript 5.9 missing at $TS59. Run: bun install" >&2
  exit 1
fi
case "$(node "$TS59" --version)" in
  "Version 5.9."*) ;;
  *)
    echo "ERROR: $TS59 is $(node "$TS59" --version), not 5.9: e2e/next16-app's typescript pin moved. Point TS59 in scripts/verify/types.sh at a 5.9 install" >&2
    exit 1
    ;;
esac

# check_published <label> <project tsconfig> <package>...
# Compiles the project and reads its file list. Fails when it has errors,
# when a named package resolves to anything but its dist declarations, or
# when a fixture beside the tsconfig is not in the program.
check_published() {
  local label="$1" project="$2"
  shift 2
  local compiler=(node_modules/.bin/tsc)
  [ "$label" = "TS 5.9" ] && compiler=(node "$TS59")
  local listed
  if ! listed=$("${compiler[@]}" -p "$project" --noEmit --listFiles 2>&1); then
    printf '%s\n' "$listed" | grep -v '^/' >&2 || true
    echo "ERROR: published declarations fail $project on $label" >&2
    return 1
  fi
  local failed=0 package fixture
  for package in "$@"; do
    if ! printf '%s\n' "$listed" | grep -q "/packages/$package/dist/index\.d\.ts$"; then
      echo "ERROR: $project on $label did not read packages/$package/dist declarations" >&2
      failed=1
    fi
  done
  if printf '%s\n' "$listed" | grep -E "/packages/[^/]+/src/"; then
    echo "ERROR: $project on $label read package source, not dist" >&2
    failed=1
  fi
  for fixture in "$(dirname "$project")"/*.ts "$(dirname "$project")"/*.tsx; do
    [ -e "$fixture" ] || continue
    if ! printf '%s\n' "$listed" | grep -q "/$fixture$"; then
      echo "ERROR: $project on $label does not compile $fixture" >&2
      failed=1
    fi
  done
  return "$failed"
}

# Each project and compiler runs in parallel; a failure prints its own report.
PROJECTS=(
  "packages/system/__tests__/published/tsconfig.json system"
  "packages/system/__tests__/published/tsconfig.exact.json system"
  "packages/system/__tests__/published/scale/tsconfig.json system"
  "packages/system/__tests__/published/scale/tsconfig.exact.json system"
  "packages/test-ds/__tests__/published/tsconfig.json system test-ds"
)
REPORTS="$(mktemp -d)"
trap 'rm -rf "$REPORTS"' EXIT
pids=()
run=0
for label in "TS 7" "TS 5.9"; do
  for entry in "${PROJECTS[@]}"; do
    read -r -a args <<<"$entry"
    check_published "$label" "${args[@]}" >"$REPORTS/$run" 2>&1 &
    pids+=("$!")
    run=$((run + 1))
  done
done
status=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    cat "$REPORTS/$i" >&2
    status=1
  fi
done
exit "$status"
