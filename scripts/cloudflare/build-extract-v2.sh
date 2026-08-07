#!/usr/bin/env bash
#
# Builds the v2 NAPI binary under an exactly-pinned Rust release.
#
# The channel read from rust-toolchain.toml is the single source of truth:
# `rustc --version` must resolve to that exact release or this script aborts
# BEFORE building. A missing cargo fails loud unless WORKERS_CI=1 (Cloudflare
# Workers Builds), which is the only place a network bootstrap is permitted:
# it fetches sh.rustup.rs over --proto '=https' --tlsv1.2 --fail, installs with
# --default-toolchain <channel> --profile minimal --no-modify-path, and removes
# the installer both on success and via the EXIT trap. Outside Workers CI this
# script must reach the network zero times.
#
# The CARGO_BIN/CURL_BIN/SH_BIN/RUSTC_BIN/BUN_BIN overrides exist so a
# regression suite can substitute doubles on PATH and assert: no network when
# cargo is missing, bootstrap skipped when cargo is present, a release mismatch
# aborting before the build, the installer removed after a bootstrap, and
# delegation to exactly `bun run --filter @animus-ui/extract build:v2`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CARGO_BIN="${CARGO_BIN:-cargo}"
CURL_BIN="${CURL_BIN:-curl}"
SH_BIN="${SH_BIN:-sh}"
RUSTC_BIN="${RUSTC_BIN:-rustc}"
BUN_BIN="${BUN_BIN:-bun}"

toolchain_file="packages/extract/crates/extract-v2/rust-toolchain.toml"
rust_channel="$(
  sed -nE 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"([^"]+)".*$/\1/p' "$toolchain_file" | head -n 1
)"

if [ -z "$rust_channel" ]; then
  echo "ERROR: Rust channel missing from $toolchain_file" >&2
  exit 1
fi

if ! command -v "$CARGO_BIN" >/dev/null 2>&1; then
  if [ "${WORKERS_CI:-}" != "1" ]; then
    echo "ERROR: cargo missing. Install Rust $rust_channel or set WORKERS_CI=1 in Cloudflare Workers Builds." >&2
    exit 1
  fi

  rustup_installer="$(mktemp)"
  cleanup() {
    if [ -n "${rustup_installer:-}" ]; then
      rm -f "$rustup_installer"
    fi
  }
  trap cleanup EXIT

  "$CURL_BIN" --proto '=https' --tlsv1.2 --fail --show-error --silent \
    https://sh.rustup.rs --output "$rustup_installer"
  "$SH_BIN" "$rustup_installer" -y \
    --default-toolchain "$rust_channel" \
    --profile minimal \
    --no-modify-path
  rm -f "$rustup_installer"
  rustup_installer=
  trap - EXIT
  export PATH="$HOME/.cargo/bin:$PATH"

  if ! command -v "$CARGO_BIN" >/dev/null 2>&1; then
    echo "ERROR: rustup completed but cargo is still unavailable. Expected Rust $rust_channel under \$HOME/.cargo/bin." >&2
    exit 1
  fi
fi

rust_version="$(
  cd packages/extract/crates/extract-v2
  "$RUSTC_BIN" --version
)"
rust_release="$(
  printf '%s\n' "$rust_version" | sed -nE 's/^rustc[[:space:]]+([^[:space:]]+).*/\1/p'
)"
if [ "$rust_release" != "$rust_channel" ]; then
  echo "ERROR: Rust release mismatch: expected $rust_channel from $toolchain_file, resolved ${rust_release:-unknown} from $RUSTC_BIN. Install or select Rust $rust_channel and retry." >&2
  exit 1
fi
echo "[build:extract-v2] $rust_version (channel $rust_channel)"

exec "$BUN_BIN" run --filter '@animus-ui/extract' build:v2
