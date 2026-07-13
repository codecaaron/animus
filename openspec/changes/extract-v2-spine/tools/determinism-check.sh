#!/usr/bin/env bash
# Increment 01 self-determinism check (G8, manual form): run the extraction
# twice in fresh processes and byte-diff the consumer-visible surface.
set -uo pipefail
cd "$(dirname "$0")"
OUT=${TMPDIR:-/tmp}/extract-determinism
mkdir -p "$OUT"
bun run determinism-run.ts > "$OUT/run1.json" 2>"$OUT/run1.err" || { echo "run1 failed"; cat "$OUT/run1.err"; exit 2; }
bun run determinism-run.ts > "$OUT/run2.json" 2>"$OUT/run2.err" || { echo "run2 failed"; cat "$OUT/run2.err"; exit 2; }
if diff -u "$OUT/run1.json" "$OUT/run2.json" > "$OUT/diff.txt"; then
  echo "DETERMINISTIC: two fresh-process runs byte-identical ($(wc -c < "$OUT/run1.json") bytes)"
else
  echo "NONDETERMINISTIC: fresh-process runs differ:"
  head -40 "$OUT/diff.txt"
  echo "(full diff: $OUT/diff.txt)"
  exit 1
fi
