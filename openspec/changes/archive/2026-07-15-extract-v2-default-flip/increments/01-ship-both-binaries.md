# Increment 01: ship-both-binaries

## Scope

- **Registry row**: 01 · mode: inline · review: subagent
- **Resolves** (Decision Ledger rows): — (implements D1's packaging half;
  DEF-3 flips at row 02's tick alongside the flip half)
- **Authors** (spec requirements): §engine-release-packaging/Published
  package carries both engine binaries, §engine-release-packaging/Missing
  engine binaries fail loud, §dual-engine-build/Release builds produce
  both engine binaries — all three already authored into
  specs/ at propose (envelope); this increment implements them.
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: external:release-window —
  satisfied by journal `signal` entry 2026-07-13 02:59 (user scheduled
  the ship-and-flip release event as this apply).
- **Footprint**: packages/extract/package.json,
  packages/extract/index-v2.js, .github/workflows/**, scripts/verify/**,
  openspec/changes/extract-v2-default-flip/**
- **Pushes to a later increment**: none

> Resolving signal that licensed creating this increment now: DEF-3 —
> journal `signal` entry 2026-07-13 02:59 (external:release-window; the
> user directed the apply, which is the release event per D1).

## Context Capsule

- **Objective**: The next tagged release publishes `@animus-ui/extract`
  with BOTH engine binaries loadable from the packed artifact. The
  release job downloads the CI-built `napi-v2-<target>` artifacts into
  `packages/extract/crates/extract-v2/` before `npm publish`, a postpack
  smoke (G3) gates publication, a missing binary for any supported
  target fails the release job, and the `index-v2.js` loader error
  message reflects the shipped reality. Consumer verify tiers gain the
  v2-binary precondition as a hard requirement.
- **In-scope guardrails** (from design.md Register):
  - G1: SHALL NOT weaken verify:parity: all 5 invocations remain —
    check: `rg -c 'cli.ts|seam-battery' scripts/verify/parity.sh` (expect
    >=5) and `bash scripts/verify/parity.sh | tail -1` (expect
    `PARITY GATE: PASS`) — STOP
  - G2: SHALL NOT remove v1 or its loader — check:
    `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs && rg -q 'load_system_module' packages/extract/src/lib.rs` — STOP
  - G3: SHALL NOT publish a package whose `./engine-v2` export cannot
    load — check: `cd packages/extract && bun pm pack --destination /tmp/animus-pack && mkdir -p /tmp/animus-pack-test && tar -xzf /tmp/animus-pack/*.tgz -C /tmp/animus-pack-test && cd /tmp/animus-pack-test/package && bun -e "require('./index.js'); require('./index-v2.js'); console.log('both engines load')"` — STOP
- **Requirements to draft**: none new — envelope specs cover this row.
- **Existing spec context**: change-level
  specs/engine-release-packaging/spec.md (both requirements),
  specs/dual-engine-build/spec.md (Release builds produce both engine
  binaries).
- **Relevant resolved decisions**: D1: ship-and-flip is one release
  event (this increment is the ship half). D3: retirement scoped to
  provably-dead surfaces (do NOT touch the Proxy here — row 03).
- **Upstream inputs**: none (first increment).
- **In-scope North Star criteria**: NS3 (release-seam failures are
  loud: missing binary = hard error, never silent fallback).
- **Prohibitions**: no version-control commands; no writes outside the
  declared footprint plus this increment file; never write to design.md,
  tasks.md, journal.md, or specs/ from a subagent (orchestrator-only).
- **Ground truth (verified 2026-07-13)**:
  - `packages/extract/package.json` `files` already includes
    `index-v2.js` and `crates/extract-v2/*.node`; exports map already has
    `./engine-v2` → `./index-v2.js`. No package.json change needed.
  - CI build job uploads `napi-${{ matrix.target }}` AND
    `napi-v2-${{ matrix.target }}` artifacts (ci.yaml ~lines 128-140).
  - The release job downloads ONLY the three v1 artifacts into
    `packages/extract/` (ci.yaml ~lines 267-285); v2 artifacts are never
    downloaded — this is the packaging gap.
  - v1 linux-arm64 download has `continue-on-error: true` and
    `generate_pkg` WARN-skips missing binaries — both violate the new
    dual-engine-build requirement (partial matrix must fail).
  - `index-v2.js` `loadNative()` error says the v2 engine is "under
    development and not yet distributed in npm releases — use engine:
    'v1' (the default)" and points at
    `openspec/changes/extract-v2-spine` (archived) — stale after this
    release.
  - `scripts/verify/build-showcase.sh` already calls
    `require_fresh_napi_v2`; `build-vite.sh` and `build-next.sh` do not.
    `require_fresh_napi_v2` exists in `scripts/verify/_preconditions.sh`.

## Plan

## Task 01.1: Release job downloads v2 binaries (strict matrix)

- [x] **Step 1:** In `.github/workflows/ci.yaml`, locate the release
  job's `Download linux-arm64 binary` step (rg -n "Download linux-arm64
  binary" .github/workflows/ci.yaml). Remove its
  `continue-on-error: true` line (partial matrix must fail the release).
- [x] **Step 2:** Immediately after that step, add three v2 downloads:

```yaml
      - name: Download darwin-arm64 v2 binary
        uses: actions/download-artifact@v4
        with:
          name: napi-v2-aarch64-apple-darwin
          path: packages/extract/crates/extract-v2/

      - name: Download linux-x64 v2 binary
        uses: actions/download-artifact@v4
        with:
          name: napi-v2-x86_64-unknown-linux-gnu
          path: packages/extract/crates/extract-v2/

      - name: Download linux-arm64 v2 binary
        uses: actions/download-artifact@v4
        with:
          name: napi-v2-aarch64-unknown-linux-gnu
          path: packages/extract/crates/extract-v2/
```

- [x] **Step 3:** In the `Generate platform packages` step, make a
  missing v1 binary fail loud: replace the
  `echo "WARNING: $binary not found, skipping $platform"` branch body
  with `echo "ERROR: $binary not found for $platform — release matrix is
  incomplete." >&2; exit 1`.

## Task 01.2: Postpack smoke script (G3) + CI wiring

- [x] **Step 1:** Create `scripts/verify/postpack-smoke.sh` (mode 755):

```bash
#!/usr/bin/env bash
set -euo pipefail

# verify: postpack smoke (G3, engine-release-packaging).
# Packs @animus-ui/extract and proves BOTH engine exports load from the
# extracted tarball. --expect-full-matrix additionally asserts all three
# targets' binaries are present for each engine (release-job mode).
# Fail-loud contract (root CLAUDE.md): name the missing artifact and the
# repairing command; never rebuild silently.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

EXPECT_FULL_MATRIX=0
if [ "${1:-}" = "--expect-full-matrix" ]; then EXPECT_FULL_MATRIX=1; fi

if ! compgen -G "packages/extract/*.node" > /dev/null; then
  echo "ERROR: v1 NAPI binary missing. Run: vp run build:extract" >&2; exit 1
fi
if ! compgen -G "packages/extract/crates/extract-v2/*.node" > /dev/null; then
  echo "ERROR: v2 NAPI binary missing. Run: vp run build:extract-v2" >&2; exit 1
fi

PACK_DIR="$(mktemp -d)"
UNPACK_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR" "$UNPACK_DIR"' EXIT

(cd packages/extract && bun pm pack --destination "$PACK_DIR")
tar -xzf "$PACK_DIR"/*.tgz -C "$UNPACK_DIR"

if [ "$EXPECT_FULL_MATRIX" = 1 ]; then
  v1_count=$(ls "$UNPACK_DIR"/package/*.node 2>/dev/null | wc -l | tr -d ' ')
  v2_count=$(ls "$UNPACK_DIR"/package/crates/extract-v2/*.node 2>/dev/null | wc -l | tr -d ' ')
  if [ "$v1_count" -lt 3 ] || [ "$v2_count" -lt 3 ]; then
    echo "ERROR: packed tarball is missing engine binaries (v1=$v1_count, v2=$v2_count; expected >=3 each). Release matrix incomplete." >&2
    exit 1
  fi
fi

(cd "$UNPACK_DIR/package" && bun -e "require('./index.js'); require('./index-v2.js'); console.log('both engines load')")
```

- [x] **Step 2:** Run `bash scripts/verify/postpack-smoke.sh` locally.
  Expected: `both engines load`.
- [x] **Step 3:** In `.github/workflows/ci.yaml` release job, add a step
  after the v2 downloads and BEFORE `Generate platform packages`:

```yaml
      - name: Postpack smoke (G3 — both engines load from tarball)
        run: bash scripts/verify/postpack-smoke.sh --expect-full-matrix
```

## Task 01.3: index-v2.js loader message truth-up

- [x] **Step 1:** In `packages/extract/index-v2.js`, replace the
  `loadNative()` throw message so it names the expected binary file and
  remediation without the stale "not yet distributed / use v1" language:

```js
  throw new Error(
    `@animus-ui/extract engine v2: native binary not found for ${platform}-${arch} ` +
      `(looked for ${candidates.join(', ')} under crates/extract-v2/). ` +
      `Published releases ship this binary for darwin-arm64, linux-x64-gnu and ` +
      `linux-arm64-gnu — reinstall the package, or set engine: 'v1' / ANIMUS_ENGINE=v1 ` +
      `as the escape hatch. In the animus workspace, build it with: vp run build:extract-v2.`
  );
```

- [x] **Step 2:** Run `node -e "require('./packages/extract/index-v2.js')"`.
  Expected: loads without throwing (darwin-arm64 binary present).

## Task 01.4: Consumer tiers require the v2 binary

- [x] **Step 1:** In `scripts/verify/build-vite.sh` and
  `scripts/verify/build-next.sh`, add after `require_fresh_napi`:

```bash
# Both engine binaries ship in the package (extract-v2-default-flip);
# the tier fails loud on a missing/stale v2 binary regardless of the
# engine the fixture selects.
require_fresh_napi_v2
```

- [x] **Step 2:** Run `bash scripts/verify/build-vite.sh` (or
  `vp run verify:build:vite`). Expected: precondition passes (binary
  exists) and the fixture builds.

## Guardrail gate

- [x] G1: `rg -c 'cli.ts|seam-battery' scripts/verify/parity.sh` >=5 AND
  `bash scripts/verify/parity.sh | tail -1` = `PARITY GATE: PASS` —
  result: pass (count=6; `PARITY GATE: PASS`, 2026-07-13 03:05)
- [x] G2: `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs && rg -q 'load_system_module' packages/extract/src/lib.rs` —
  result: pass (exit 0, 2026-07-13 03:04)
- [x] G3: `bash scripts/verify/postpack-smoke.sh` — result: pass (`both engines load`; tarball packs both .node binaries; re-run green after review fixes, 2026-07-13 03:09)

## Output contract (inline mode — collapsed into the checklists above)

- [x] Plan checkboxes ticked to reflect actual completion
- [x] Guardrail gate results recorded with output excerpts
- [x] Proposed journal entries: review-verdict + known-gap entries appended to journal.md
- [x] Surfaced variables (spawn candidates): none

## Spec authorship checklist (orchestrator)

- [x] Specs already authored at propose (envelope) — no new authorship
- [x] No Ledger rows flip at this row (DEF-3 flips at row 02)
- [x] Journal entries appended
- [x] Reorientation per cadence: off-beat entropy-auditor pass at this row; full pass due at row 02 (K=2)
- [x] Ticked registry row 01 in tasks.md with `· ticked: 2026-07-13 03:09`
