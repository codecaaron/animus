#!/usr/bin/env bash
set -euo pipefail

# verify:tsc (consumer apps) — tsc --noEmit over an e2e app's own tsconfig.
# Closes the gap where no gate type-checked the e2e apps (vite build strips
# types unchecked; verify:compile covers packages/* only), which let real
# type drift hide in fixture components (Pulse.tsx, found 2026-07-22).
# Usage: tsc-consumer.sh <app-dir-relative-to-repo-root>

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_bun_install

APP_DIR="${1:?usage: tsc-consumer.sh <app dir, e.g. e2e/vite-app>}"
if [ ! -f "$APP_DIR/tsconfig.json" ]; then
  echo "ERROR: $APP_DIR/tsconfig.json missing" >&2
  exit 1
fi

exec node_modules/.bin/tsc -p "$APP_DIR/tsconfig.json" --noEmit
