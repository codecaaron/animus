#!/bin/bash
# Post-build assertions for showcase output.
# Catches silent CSS loss, unresolved transforms, and runtime dependency leakage.

set -e

DIST="packages/showcase/dist"
ERRORS=0

fail() {
  echo "FAIL: $1"
  ERRORS=$((ERRORS + 1))
}

pass() {
  echo "  ok: $1"
}

echo "[animus] Asserting showcase output..."

# 1. CSS file exists and is non-empty
CSS_FILE=$(find "$DIST/assets" -name "*.css" -type f 2>/dev/null | head -1)
if [ -z "$CSS_FILE" ]; then
  fail "No CSS file found in $DIST/assets/"
elif [ ! -s "$CSS_FILE" ]; then
  fail "CSS file is empty: $CSS_FILE"
else
  pass "CSS file exists: $(basename "$CSS_FILE")"
fi

# 2. CSS contains @layer declarations
if [ -n "$CSS_FILE" ] && grep -q "@layer anm-global" "$CSS_FILE"; then
  pass "CSS contains @layer declarations"
else
  fail "CSS missing @layer declarations"
fi

# 3. CSS does NOT contain __TRANSFORM__ placeholders
if [ -n "$CSS_FILE" ] && grep -q "__TRANSFORM__" "$CSS_FILE"; then
  fail "CSS contains unresolved __TRANSFORM__ placeholders"
else
  pass "No unresolved __TRANSFORM__ placeholders"
fi

# 4. CSS contains :root block (variable declarations)
if [ -n "$CSS_FILE" ] && grep -q ":root" "$CSS_FILE"; then
  pass "CSS contains :root variable declarations"
else
  fail "CSS missing :root variable declarations"
fi

# 5. CSS contains animus- class names
if [ -n "$CSS_FILE" ] && grep -q "animus-" "$CSS_FILE"; then
  pass "CSS contains animus- class names"
else
  fail "CSS missing animus- class names"
fi

# 6. JS files do NOT contain @emotion
EMOTION_MATCH=$(grep -rl "@emotion" "$DIST/assets/"*.js 2>/dev/null || true)
if [ -n "$EMOTION_MATCH" ]; then
  fail "JS bundle contains @emotion imports: $EMOTION_MATCH"
else
  pass "No @emotion imports in JS bundle"
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "[animus] $ERRORS assertion(s) failed."
  exit 1
else
  echo "[animus] All showcase assertions passed."
fi
