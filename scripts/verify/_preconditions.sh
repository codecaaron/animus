#!/usr/bin/env bash
# scripts/verify/_preconditions.sh
#
# Shared precondition helpers for atomic verify:* tier scripts AND for
# the hygiene:* mutating scripts under scripts/hygiene/.
#
# USAGE: this file is SOURCED (not executed) by each caller script:
#   source "$ROOT/scripts/verify/_preconditions.sh"
# The shebang above is for editor/lint tooling only; the file is never
# invoked as an executable.
#
# CONTRACT: callers MUST have `set -euo pipefail` active before sourcing.
# Each `require_*` function returns non-zero on failure AND emits an
# actionable "ERROR: <what>. Run: <fix-command>" line to stderr. Under
# `set -e`, that non-zero return aborts the caller script.
#
# Adding a new helper: follow the `require_<noun>[_<modifier>]` naming
# convention and preserve the "ERROR: ... Run: ..." stderr message shape.
#
# Helper families:
#   require_bun_install, require_fresh_napi, require_fresh_package_dist,
#   require_dir — used by scripts/verify/* tiers.
#   require_cargo_machete — used by Rust hygiene tiers.
#   require_vp_lint, require_knip_binary, require_typescript,
#   require_code_hygiene_deps — used by the code-hygiene orchestrator
#   (scripts/hygiene/run.sh).

# Canonical type-check binary per the typescript-toolchain capability.
# Single source-of-truth: every helper that probes the type-check
# implementation reads this variable. Update in one place when the
# canonical type-check implementation changes.
TYPECHECK_BINARY="${TYPECHECK_BINARY:-tsgo}"

require_bun_install() {
  if [ ! -x "node_modules/.bin/$TYPECHECK_BINARY" ]; then
    echo "ERROR: $TYPECHECK_BINARY binary not found at node_modules/.bin/$TYPECHECK_BINARY. Run: bun install" >&2
    return 1
  fi
}

require_fresh_napi_v2() {
  local napi_binary
  napi_binary=$(ls packages/extract/crates/extract-v2/*.node 2>/dev/null | head -n1 || true)
  if [ -z "$napi_binary" ]; then
    echo "ERROR: v2 NAPI binary missing. Run: vp run build:extract-v2" >&2
    return 1
  fi
  local newest_input
  newest_input=$(find \
    packages/extract/crates/extract-v2/src \
    packages/extract/crates/extract-v2/build.rs \
    packages/extract/crates/extract-v2/Cargo.toml \
    packages/extract/crates/extract-v2/Cargo.lock \
    packages/extract/crates/extract-v2/rust-toolchain.toml \
    packages/extract/crates/system-loader/src \
    packages/extract/crates/system-loader/Cargo.toml \
    packages/extract/crates/system-loader/Cargo.lock \
    packages/extract/crates/system-loader/rust-toolchain.toml \
    -type f -newer "$napi_binary" -print -quit 2>/dev/null || true)
  if [ -n "$newest_input" ]; then
    echo "ERROR: v2 NAPI binary stale (Rust input newer: $newest_input). Run: vp run build:extract-v2" >&2
    return 1
  fi
}

require_fresh_napi() {
  local napi_binary
  napi_binary=$(ls packages/extract/*.node 2>/dev/null | head -n1 || true)
  if [ -z "$napi_binary" ]; then
    echo "ERROR: NAPI binary missing. Run: vp run build:extract" >&2
    return 1
  fi
  local newest_src
  newest_src=$(find \
    packages/extract/src \
    packages/extract/build.rs \
    packages/extract/Cargo.toml \
    packages/extract/Cargo.lock \
    packages/extract/rust-toolchain.toml \
    packages/extract/crates/system-loader/src \
    packages/extract/crates/system-loader/Cargo.toml \
    packages/extract/crates/system-loader/Cargo.lock \
    packages/extract/crates/system-loader/rust-toolchain.toml \
    -type f -newer "$napi_binary" -print -quit 2>/dev/null || true)
  if [ -n "$newest_src" ]; then
    echo "ERROR: NAPI binary is stale (Rust input newer: $newest_src). Run: vp run build:extract" >&2
    return 1
  fi
}

require_fresh_package_dist() {
  local pkg="$1"
  if [ -z "$pkg" ]; then
    echo "ERROR: require_fresh_package_dist called without package name" >&2
    return 1
  fi
  local fix_cmd="bun run --filter '@animus-ui/$pkg' build:ts"
  # Probe order across every tsdown output flavor; take the first that exists
  # as the key artifact for the freshness comparison:
  #   .mjs — esm output in a package without "type": "module" (e.g. next-plugin
  #          still emits index.mjs alongside its CJS main).
  #   .cjs — cjs output in a package without "type": "module" and platform:node
  #          (extract/pipeline, vite-plugin, next-plugin main — CJS is required
  #          for `attw --profile node16` per release-truth-v1 inc 07).
  #   .js  — esm or cjs output whose extension defaults to .js (system and
  #          properties are both ESM `"type": "module"` — both emit dist/index.js).
  local dist_entry=""
  for candidate in "packages/$pkg/dist/index.mjs" "packages/$pkg/dist/index.cjs" "packages/$pkg/dist/index.js"; do
    if [ -f "$candidate" ]; then
      dist_entry="$candidate"
      break
    fi
  done
  if [ -z "$dist_entry" ]; then
    echo "ERROR: packages/$pkg/dist/ missing. Run: $fix_cmd" >&2
    return 1
  fi
  local newest_src
  newest_src=$(find "packages/$pkg/src" \( -name '*.ts' -o -name '*.tsx' \) -newer "$dist_entry" -print -quit 2>/dev/null || true)
  if [ -n "$newest_src" ]; then
    echo "ERROR: packages/$pkg/dist/ is stale (src newer than dist). Run: $fix_cmd" >&2
    return 1
  fi
}

require_dir() {
  local target_path="$1"
  local fix_cmd="$2"
  if [ ! -d "$target_path" ]; then
    echo "ERROR: $target_path missing. Run: $fix_cmd" >&2
    return 1
  fi
}

require_cargo_machete() {
  if ! command -v cargo-machete >/dev/null 2>&1; then
    echo "ERROR: cargo-machete missing. Run: cargo install cargo-machete" >&2
    return 1
  fi
}

require_vp_lint() {
  if ! bunx vp lint --version >/dev/null 2>&1; then
    echo "ERROR: vp lint missing. Run: bun install" >&2
    return 1
  fi
}

require_knip_binary() {
  if ! bunx --bun knip --version >/dev/null 2>&1; then
    echo "ERROR: knip missing. Run: bun install" >&2
    return 1
  fi
}

require_typescript() {
  if [ ! -x node_modules/typescript/bin/tsc ]; then
    echo "ERROR: typescript missing. Run: bun install" >&2
    return 1
  fi
}

require_code_hygiene_deps() {
  require_vp_lint || return 1
  require_knip_binary || return 1
  require_typescript || return 1
}

# Iterate workspace directories and check their dist/ artifacts vs src/.
# Used by scripts/hygiene/run.sh as a precondition before the cascade —
# knip resolves cross-workspace imports against package.json main/module
# (i.e., dist/), so a stale dist can cause knip to flag live exports as
# unused.
#
# Args:
#   $1   — mode ("fix" or "scan"): fix → ERROR + non-zero return on stale;
#          scan → WARN + zero return (preserves preview ergonomics)
#   $@   — workspace directories (e.g. "packages/system" "packages/properties").
#          When omitted, iterates packages/* (excludes legacy/ implicitly).
#
# Skip rules:
#   - workspaces whose package.json lacks both `main` and `module` (no dist)
#   - workspaces where src/ does not exist (nothing to compare against)
require_dist_fresh_for_workspaces() {
  local mode="${1:-fix}"
  shift || true
  local -a dirs=("$@")
  if [ "${#dirs[@]}" -eq 0 ]; then
    local d
    for d in packages/*/; do
      dirs+=("${d%/}")
    done
  fi

  local stale_count=0
  local pkg_dir pkg_json main_field module_field dist_entry candidate newest_src
  for pkg_dir in "${dirs[@]}"; do
    case "$pkg_dir" in legacy/*) continue;; esac
    pkg_json="$pkg_dir/package.json"
    [ -f "$pkg_json" ] || continue
    main_field="$(jq -r '.main // empty' "$pkg_json" 2>/dev/null || true)"
    module_field="$(jq -r '.module // empty' "$pkg_json" 2>/dev/null || true)"
    if [ -z "$main_field" ] && [ -z "$module_field" ]; then
      continue
    fi

    dist_entry=""
    for candidate in "$module_field" "$main_field"; do
      [ -z "$candidate" ] && continue
      if [ -f "$pkg_dir/$candidate" ]; then
        dist_entry="$pkg_dir/$candidate"
        break
      fi
    done

    if [ -z "$dist_entry" ]; then
      if [ "$mode" = "fix" ]; then
        echo "ERROR: $pkg_dir/dist missing. Run: vp run build:ts" >&2
        stale_count=$((stale_count + 1))
      else
        echo "WARN: $pkg_dir/dist missing (would block fix mode)" >&2
      fi
      continue
    fi

    [ -d "$pkg_dir/src" ] || continue
    newest_src="$(find "$pkg_dir/src" \( -name '*.ts' -o -name '*.tsx' \) -newer "$dist_entry" -print -quit 2>/dev/null || true)"
    if [ -n "$newest_src" ]; then
      if [ "$mode" = "fix" ]; then
        echo "ERROR: $pkg_dir/dist stale vs src. Run: vp run build:ts" >&2
        stale_count=$((stale_count + 1))
      else
        echo "WARN: $pkg_dir/dist stale vs src (would block fix mode)" >&2
      fi
    fi
  done

  if [ "$mode" = "fix" ] && [ "$stale_count" -gt 0 ]; then
    return 1
  fi
  return 0
}
