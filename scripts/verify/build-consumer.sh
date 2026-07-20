#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CALLER_DIR="$PWD"
CALLER_MANIFEST="$CALLER_DIR/package.json"

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

if ! CLOSURE=$(bun scripts/verify/workspace-graph.ts closure "$OWNER_PACKAGE"); then
  exit 1
fi

failed=0
recipe=()

if ! require_fresh_napi_v2; then
  failed=1
  recipe+=("vp run build:extract-v2")
fi

needs_typescript_build=0
while IFS=$'\t' read -r package_name package_dir; do
  [ -n "$package_name" ] || continue
  if ! require_fresh_package_dist "$package_dir"; then
    failed=1
    needs_typescript_build=1
  fi
done <<< "$CLOSURE"
if [ "$needs_typescript_build" -ne 0 ]; then
  recipe+=("vp run build:ts")
fi

if [ "$failed" -ne 0 ]; then
  recipe_text=""
  for command in "${recipe[@]}"; do
    if [ -n "$recipe_text" ]; then
      recipe_text+=" && "
    fi
    recipe_text+="$command"
  done
  echo "PREPARE: $recipe_text" >&2
  exit 1
fi

cd "$CALLER_DIR"
exec bun run build
