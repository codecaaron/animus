#!/usr/bin/env bash
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
