#!/usr/bin/env bash
set -euo pipefail

# verify:canary — extractor NAPI boundary snapshot tests.
# Preconditions: the extractor binary is fresh.
# The assembleStylesheet cases additionally read packages/extract/dist/, which
# the full build:extract composition (build:extractor && build:ts) materializes.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_fresh_napi

# static-css-overrides and property-diagnostics share the canary's precondition
# (they drive the REAL extractor), so they run in this NAPI-gated lane, not
# verify:unit:ts. So does the external-package collector, which reads each
# kit's source root from the native table; system membership, which the
# engine reads from its own parse; and the alias comparison, whose aliased
# bases are the engine's expansion. So does the system-load cache, whose
# contract reads what the real loader read and found missing.
exec bun test packages/extract/tests/canary.test.ts packages/extract/tests/collect-external-packages.test.ts packages/extract/tests/static-css-overrides.test.ts packages/extract/tests/property-diagnostics.test.ts packages/extract/tests/prefix-contextual-vars.test.ts packages/extract/tests/skipped-sources.test.ts packages/extract/tests/kit-publication.test.ts packages/extract/tests/discover-packages.test.ts packages/extract/tests/extension-policy.test.ts packages/extract/tests/alias-agreement.test.ts packages/extract/tests/system-load-cache.test.ts
