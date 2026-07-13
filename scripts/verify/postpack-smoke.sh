#!/usr/bin/env bash
set -euo pipefail

# verify: postpack smoke (G3, engine-release-packaging).
# Packs @animus-ui/extract and proves BOTH engine exports load from the
# extracted tarball. --expect-full-matrix additionally asserts all three
# targets' binaries are present for each engine (release-job mode).
# Fail-loud contract (root CLAUDE.md): name the missing artifact and the
# repairing command; never rebuild silently.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

EXPECT_FULL_MATRIX=0
if [ $# -gt 0 ]; then
  case "$1" in
    --expect-full-matrix) EXPECT_FULL_MATRIX=1 ;;
    *) echo "ERROR: unknown argument '$1' (supported: --expect-full-matrix)" >&2; exit 1 ;;
  esac
fi

if ! compgen -G "packages/extract/*.node" > /dev/null; then
  echo "ERROR: v1 NAPI binary missing. Run: vp run build:extract" >&2; exit 1
fi
if ! compgen -G "packages/extract/crates/extract-v2/*.node" > /dev/null; then
  echo "ERROR: v2 NAPI binary missing. Run: vp run build:extract-v2" >&2; exit 1
fi

PACK_DIR="$(mktemp -d)"
UNPACK_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR" "$UNPACK_DIR"' EXIT

(cd packages/extract && bun pm pack --destination "$PACK_DIR")
tar -xzf "$PACK_DIR"/*.tgz -C "$UNPACK_DIR"

if [ "$EXPECT_FULL_MATRIX" = 1 ]; then
  v1_count=$(ls "$UNPACK_DIR"/package/*.node 2>/dev/null | wc -l | tr -d ' ')
  v2_count=$(ls "$UNPACK_DIR"/package/crates/extract-v2/*.node 2>/dev/null | wc -l | tr -d ' ')
  if [ "$v1_count" -lt 3 ] || [ "$v2_count" -lt 3 ]; then
    echo "ERROR: packed tarball is missing engine binaries (v1=$v1_count, v2=$v2_count; expected >=3 each). Release matrix incomplete." >&2
    exit 1
  fi
fi

(cd "$UNPACK_DIR/package" && bun -e "require('./index.js'); require('./index-v2.js'); console.log('both engines load')")
