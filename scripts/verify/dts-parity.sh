#!/usr/bin/env bash
# scripts/verify/dts-parity.sh
#
# Declaration-emit parity gate: compares `.d.ts` output between the
# `tsc` (typescript) and `tsgo` (@typescript/native-preview) compilers
# across every workspace package that emits declarations.
#
# Used as a one-shot gate before swapping the canonical declaration-emit
# implementation (e.g., from tsc to tsgo or vice versa). Reusable: invoke
# any time both binaries are installed to verify byte-equal emit on the
# current source tree.
#
# Exit codes:
#   0 — byte-equal parity across every emitted .d.ts
#   1 — divergence (file diffs printed inline; non-empty exit suitable for CI)
#   2 — precondition failure (missing binary, missing tsconfig.build.json, etc.)
#
# Side-effect-free: writes only under PARITY_DIR (default /tmp/dts-parity).
# Source `dist/` directories are not modified.
#
# Override:
#   PARITY_DIR=<dir>  override scratch directory (default: /tmp/dts-parity)
#   PACKAGES="a b c"  whitespace-separated package list (default: all
#                     packages/*/tsconfig.build.json found at run time)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Pre-flight: both compiler binaries must exist
if [ ! -x node_modules/.bin/tsc ]; then
  echo "ERROR: tsc not found at node_modules/.bin/tsc. Run: bun install" >&2
  exit 2
fi
if [ ! -x node_modules/.bin/tsgo ]; then
  echo "ERROR: tsgo not found at node_modules/.bin/tsgo. Run: bun install" >&2
  exit 2
fi

PARITY_DIR="${PARITY_DIR:-/tmp/dts-parity}"
rm -rf "$PARITY_DIR"
mkdir -p "$PARITY_DIR/baseline" "$PARITY_DIR/candidate"

# Resolve package list. Default = every packages/*/tsconfig.build.json.
if [ -n "${PACKAGES:-}" ]; then
  read -r -a PKG_LIST <<< "$PACKAGES"
else
  PKG_LIST=()
  for f in packages/*/tsconfig.build.json; do
    [ -f "$f" ] || continue
    pkg_dir="${f%/tsconfig.build.json}"
    PKG_LIST+=("${pkg_dir#packages/}")
  done
fi

if [ "${#PKG_LIST[@]}" -eq 0 ]; then
  echo "ERROR: no packages with tsconfig.build.json found" >&2
  exit 2
fi

echo "== dts-parity =="
echo "  baseline:  tsc  ($(node_modules/.bin/tsc --version))"
echo "  candidate: tsgo ($(node_modules/.bin/tsgo --version))"
echo "  packages:  ${PKG_LIST[*]}"
echo "  scratch:   $PARITY_DIR"
echo ""

# Emit baseline (.d.ts via tsc)
echo "[1/3] emitting baseline via tsc..."
for pkg in "${PKG_LIST[@]}"; do
  config="packages/$pkg/tsconfig.build.json"
  if [ ! -f "$config" ]; then
    echo "  ERROR: $config not found" >&2
    exit 2
  fi
  out="$PARITY_DIR/baseline/$pkg"
  mkdir -p "$out"
  printf "  %-15s tsc  → %s\n" "$pkg" "$out"
  node_modules/.bin/tsc -p "$config" --outDir "$out" 2>&1 | sed "s/^/    /" || {
    echo "  ERROR: tsc emit failed for $pkg" >&2
    exit 2
  }
done
echo ""

# Emit candidate (.d.ts via tsgo)
echo "[2/3] emitting candidate via tsgo..."
for pkg in "${PKG_LIST[@]}"; do
  config="packages/$pkg/tsconfig.build.json"
  out="$PARITY_DIR/candidate/$pkg"
  mkdir -p "$out"
  printf "  %-15s tsgo → %s\n" "$pkg" "$out"
  node_modules/.bin/tsgo -p "$config" --outDir "$out" 2>&1 | sed "s/^/    /" || {
    echo "  ERROR: tsgo emit failed for $pkg" >&2
    exit 2
  }
done
echo ""

# Diff
echo "[3/3] comparing .d.ts trees..."
divergent_files=0
divergent_pkgs=()
for pkg in "${PKG_LIST[@]}"; do
  baseline="$PARITY_DIR/baseline/$pkg"
  candidate="$PARITY_DIR/candidate/$pkg"
  pkg_divergent=0

  # Files in baseline missing or differing in candidate
  while IFS= read -r f; do
    rel="${f#"$baseline"/}"
    cand="$candidate/$rel"
    if [ ! -f "$cand" ]; then
      echo "  ✗ $pkg/$rel — in baseline, missing in candidate"
      divergent_files=$((divergent_files + 1))
      pkg_divergent=1
    elif ! diff -q "$f" "$cand" >/dev/null 2>&1; then
      echo "  ✗ $pkg/$rel — content differs"
      divergent_files=$((divergent_files + 1))
      pkg_divergent=1
    fi
  done < <(find "$baseline" -name '*.d.ts' -o -name '*.d.ts.map')

  # Files in candidate not in baseline
  while IFS= read -r f; do
    rel="${f#"$candidate"/}"
    base="$baseline/$rel"
    if [ ! -f "$base" ]; then
      echo "  ✗ $pkg/$rel — in candidate, missing in baseline"
      divergent_files=$((divergent_files + 1))
      pkg_divergent=1
    fi
  done < <(find "$candidate" -name '*.d.ts' -o -name '*.d.ts.map')

  if [ "$pkg_divergent" -eq 1 ]; then
    divergent_pkgs+=("$pkg")
  fi
done

echo ""
if [ "$divergent_files" -eq 0 ]; then
  total=$(find "$PARITY_DIR/baseline" -name '*.d.ts' | wc -l | tr -d ' ')
  echo "✓ parity proven — $total .d.ts file(s) byte-equal across ${#PKG_LIST[@]} package(s)"
  echo "  scratch retained at $PARITY_DIR for inspection"
  exit 0
else
  echo "✗ divergence detected — $divergent_files file(s) across ${#divergent_pkgs[@]} package(s): ${divergent_pkgs[*]}"
  echo ""
  echo "Inspect with:  diff -ur $PARITY_DIR/baseline $PARITY_DIR/candidate"
  exit 1
fi
