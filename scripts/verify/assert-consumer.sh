#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo 'ERROR: assert-consumer expects: root-relative-output root-relative-assertion' >&2
  exit 2
fi

OUTPUT_DIR="$1"
ASSERTION_PATH="$2"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CALLER_DIR="$PWD"
CALLER_MANIFEST="$CALLER_DIR/package.json"

validate_root_path() {
  local kind="$1"
  local candidate="$2"
  if [ -z "$candidate" ] || [ "${candidate#/}" != "$candidate" ]; then
    echo "ERROR: $kind path must be root-relative and remain within repository: $candidate" >&2
    return 1
  fi
  local resolved
  resolved=$(bun -e "import { resolve } from 'node:path'; console.log(resolve(process.argv[1], process.argv[2]))" "$ROOT" "$candidate")
  case "$resolved" in
    "$ROOT"|"$ROOT"/*) return 0 ;;
    *)
      echo "ERROR: $kind path must be root-relative and remain within repository: $candidate" >&2
      return 1
      ;;
  esac
}

validate_root_path output "$OUTPUT_DIR" || exit 2
validate_root_path assertion "$ASSERTION_PATH" || exit 2

if [ ! -f "$CALLER_MANIFEST" ]; then
  echo "ERROR: consumer package manifest missing at $CALLER_MANIFEST" >&2
  exit 2
fi

OWNER_PACKAGE=$(bun -e "import { readFileSync } from 'node:fs'; console.log(JSON.parse(readFileSync(process.argv[1], 'utf8')).name ?? '')" "$CALLER_MANIFEST")
if [ -z "$OWNER_PACKAGE" ]; then
  echo "ERROR: consumer package at $CALLER_DIR has no package name" >&2
  exit 2
fi

cd "$ROOT"
source "$ROOT/scripts/verify/_preconditions.sh"

require_dir "$OUTPUT_DIR" "vp run $OWNER_PACKAGE#verify:build"
require_fresh_package_dist packages/_assertions

exec bun run "$ASSERTION_PATH"
