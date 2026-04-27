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
#   require_biome, require_knip_binary, require_typescript,
#   require_code_hygiene_deps — used by the code-hygiene orchestrator
#   (scripts/hygiene/run.sh).

require_bun_install() {
  if [ ! -x node_modules/.bin/tsc ]; then
    echo "ERROR: tsc binary not found at node_modules/.bin/tsc. Run: bun install" >&2
    return 1
  fi
}

require_fresh_napi() {
  local napi_binary
  napi_binary=$(ls packages/extract/*.node 2>/dev/null | head -n1 || true)
  if [ -z "$napi_binary" ]; then
    echo "ERROR: NAPI binary missing. Run: bun run build:extract" >&2
    return 1
  fi
  local newest_src
  newest_src=$(find packages/extract/src -name '*.rs' -newer "$napi_binary" -print -quit 2>/dev/null || true)
  if [ -n "$newest_src" ]; then
    echo "ERROR: NAPI binary is stale (Rust source newer than .node). Run: bun run build:extract" >&2
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
  # Probe order: .mjs (tsdown emits this for extract/vite-plugin/next-plugin)
  # then .js (tsdown emits this for packages with `"type": "module"` in
  # package.json, e.g. system/properties). Both are valid published ESM
  # entries; take the first that exists as the key artifact.
  local dist_entry=""
  for candidate in "packages/$pkg/dist/index.mjs" "packages/$pkg/dist/index.js"; do
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

require_biome() {
  if ! bunx --bun @biomejs/biome --version >/dev/null 2>&1; then
    echo "ERROR: biome missing. Run: bun install" >&2
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
  require_biome || return 1
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
        echo "ERROR: $pkg_dir/dist missing. Run: bun run build:ts" >&2
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
        echo "ERROR: $pkg_dir/dist stale vs src. Run: bun run build:ts" >&2
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
