#!/usr/bin/env bash
set -euo pipefail

# Post-build assertions for the Next.js test app.
# Validates extraction correctness against .next/ output.

cd "$(dirname "$0")/.."

PASS=0
FAIL=0

assert() {
  local desc="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

assert_not() {
  local desc="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  fi
}

echo "Asserting Next.js build output..."
echo ""

# CSS assertions — find CSS files in .next output
assert "CSS contains @layer base" \
  find .next -name '*.css' -exec grep -lq '@layer base' {} +

assert "CSS contains @layer variants" \
  find .next -name '*.css' -exec grep -lq '@layer variants' {} +

assert_not "No __TRANSFORM__ placeholders in CSS" \
  find .next -name '*.css' -exec grep -lq '__TRANSFORM__' {} +

# Class name assertions — check JS/HTML for animus- prefix
assert "Output contains animus- class names" \
  grep -rq 'animus-' .next/

# No Emotion runtime
assert_not "No @emotion in JS bundles" \
  find .next/static -name '*.js' -exec grep -lq '@emotion' {} +

# Both routers rendered
assert "App Router output exists" \
  test -d .next/server/app

assert "Pages Router legacy page rendered" \
  find .next/server/pages -name 'legacy*' -print -quit

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
