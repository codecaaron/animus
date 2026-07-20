#!/usr/bin/env bash
set -euo pipefail

# verify: postpack smoke (G3, engine-release-packaging).
# Packs @animus-ui/extract and proves the v2 engine (the package's only
# engine and root entry since retire-extract-v1) loads from the extracted
# tarball via the package root entry.
# --expect-full-matrix additionally asserts all three targets' binaries are
# present (release-job mode).
# Fail-loud contract (root AGENTS.md): name the missing artifact and the
# repairing command; never rebuild silently.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

EXPECT_FULL_MATRIX=0
TARBALL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-full-matrix)
      EXPECT_FULL_MATRIX=1
      shift
      ;;
    --tarball)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        echo "ERROR: --tarball requires an exact .tgz path" >&2
        exit 1
      fi
      case "$2" in
        /*) TARBALL="$2" ;;
        *) TARBALL="$ROOT/$2" ;;
      esac
      shift 2
      ;;
    *)
      echo "ERROR: unknown argument '$1' (supported: --tarball <path>, --expect-full-matrix)" >&2
      exit 1
      ;;
  esac
done

if [ -z "$TARBALL" ]; then
  if ! compgen -G "packages/extract/crates/extract-v2/*.node" > /dev/null; then
    echo "ERROR: v2 NAPI binary missing. Run: vp run build:extract-v2" >&2; exit 1
  fi
elif [ ! -f "$TARBALL" ]; then
  echo "ERROR: supplied extract tarball missing: $TARBALL" >&2
  exit 1
fi

PACK_DIR="$(mktemp -d)"
UNPACK_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR" "$UNPACK_DIR"' EXIT

if [ -z "$TARBALL" ]; then
  (cd packages/extract && bun pm pack --destination "$PACK_DIR")
  TARBALL=$(find "$PACK_DIR" -maxdepth 1 -type f -name '*.tgz' -print -quit)
fi
tar -xzf "$TARBALL" -C "$UNPACK_DIR"

if [ "$EXPECT_FULL_MATRIX" = 1 ]; then
  v2_count=$(ls "$UNPACK_DIR"/package/crates/extract-v2/*.node 2>/dev/null | wc -l | tr -d ' ')
  if [ "$v2_count" -lt 3 ]; then
    echo "ERROR: packed tarball is missing v2 engine binaries (v2=$v2_count; expected >=3). Release matrix incomplete." >&2
    exit 1
  fi
fi

(cd "$UNPACK_DIR/package" && bun -e "require('./index-v2.js'); console.log('v2 engine loads (package root entry)')")