## 1. Shared Helper Library

- [x] 1.1 Create `scripts/verify/_preconditions.sh` starting with shebang `#!/usr/bin/env bash` (NOTE: sourced, not executed — shebang is for editor/lint tooling, not runtime). Make file executable for consistency.
- [x] 1.2 Implement `require_bun_install`:
  ```bash
  require_bun_install() {
    if [ ! -x node_modules/.bin/tsc ]; then
      echo "ERROR: tsc binary not found at node_modules/.bin/tsc. Run: bun install" >&2
      return 1
    fi
  }
  ```
- [x] 1.3 Implement `require_fresh_napi`:
  ```bash
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
  ```
- [x] 1.4 Implement `require_fresh_package_dist <pkg>`:
  ```bash
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
  _(Amended during apply: initial code assumed universal `index.mjs` emission; system and properties emit `index.js` with `package.json "type": "module"`. Probe-order added so both are valid key artifacts.)_
  ```
- [x] 1.5 Implement `require_dir <path> <fix_command>`:
  ```bash
  require_dir() {
    local target_path="$1"
    local fix_cmd="$2"
    if [ ! -d "$target_path" ]; then
      echo "ERROR: $target_path missing. Run: $fix_cmd" >&2
      return 1
    fi
  }
  ```
- [x] 1.6 Add a file-level header comment to `_preconditions.sh` explaining: the file is meant to be sourced (not executed); callers MUST have `set -euo pipefail` in force; each function returns non-zero on failure and emits an actionable `ERROR: X. Run: Y` line to stderr.

## 2. Rewrite Existing Atomic Tier Scripts to Use the Helper

- [x] 2.1 Rewrite `scripts/verify/canary.sh`: source `_preconditions.sh`, replace inline NAPI check with `require_fresh_napi`.
- [x] 2.2 Rewrite `scripts/verify/integration.sh`: source helper, call `require_fresh_napi && require_fresh_package_dist extract && require_fresh_package_dist system`.
- [x] 2.3 Rewrite `scripts/verify/build-next.sh`: source helper, call `require_fresh_napi && require_fresh_package_dist extract && require_fresh_package_dist system && require_fresh_package_dist next-plugin`.
- [x] 2.4 Rewrite `scripts/verify/build-showcase.sh`: source helper, call `require_fresh_napi && require_fresh_package_dist extract && require_fresh_package_dist system && require_fresh_package_dist vite-plugin && require_fresh_package_dist properties`.
- [x] 2.5 Rewrite `scripts/verify/assert-next.sh`: source helper, call `require_dir packages/next-test-app/.next 'bun run verify:build:next'` (update path if `e2e-workspace-topology` has landed).
- [x] 2.6 Rewrite `scripts/verify/assert-showcase.sh`: source helper, call `require_dir packages/showcase/dist 'bun run verify:build:showcase'`.
- [x] 2.7 Rewrite `scripts/verify/compile.sh`: source helper, call `require_bun_install`.
- [x] 2.8 Rewrite `scripts/verify/types.sh`: source helper, call `require_bun_install`.
- [x] 2.9 Optionally source helper in `scripts/verify/lint.sh`, `scripts/verify/unit-rust.sh`, `scripts/verify/unit-ts.sh` for consistency even though they currently require no precondition calls. Skip if it adds more noise than value — tier scripts with no preconditions are allowed not to source the helper. **Decision: SKIPPED.** Zero-precondition tiers left untouched; sourcing a helper whose functions are never called adds noise without value, and `unit-rust.sh` cd's into `packages/extract` before running, so its `$ROOT`-relative sourcing would require extra plumbing. Helper is sourced only where a `require_*` call is made.
- [x] 2.10 Ensure every rewritten script keeps `set -euo pipefail` and the self-locating `ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"` pattern at the top.
- [x] 2.11 Grep `scripts/verify/*.sh` for the strings `find packages/extract/src` and `ls packages/*/dist/` — confirm matches appear only in `_preconditions.sh`.

## 3. Validate Fail-Loud Behavior

- [x] 3.1 With a fresh workspace (all dists built), run `bun run verify:full`; confirm green across all tiers. **Substituted**: `verify:full` end-to-end blocked by pre-existing `verify:assert:next` @layer gap (verification-tier-policy §11.8). Equivalent coverage via individual tiers: `verify` fast-gate ✓, `verify:integration` ✓, `verify:build:next` ✓, `verify:build:showcase` ✓, `verify:assert:showcase` ✓. `verify:assert:next` still deferred.
- [x] 3.2 Delete `packages/extract/*.node`; run `bun run verify:canary`; confirm "ERROR: NAPI binary missing. Run: bun run build:extract" on stderr and exit code 1. **Verified**: exact message emitted, exit 1. Binary moved to /tmp and restored post-test (reversible).
- [x] 3.3 Restore NAPI binary (`bun run build:extract`); `touch packages/extract/src/lib.rs`; run `bun run verify:canary`; confirm "ERROR: NAPI binary is stale" message. **Verified**: "ERROR: NAPI binary is stale (Rust source newer than .node). Run: bun run build:extract" emitted, exit 1.
- [x] 3.4 Rebuild (`bun run build:extract`); touch `packages/system/src/types/config.ts`; run `bun run verify:build:next`; confirm "ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts". **Verified**: exact message emitted, exit 1.
- [x] 3.5 Rebuild system (`bun run --filter '@animus-ui/system' build:ts`); delete `packages/system/dist/`; run `bun run verify:build:next`; confirm "ERROR: packages/system/dist/ missing" message. **Verified**: "ERROR: packages/system/dist/ missing. Run: bun run --filter '@animus-ui/system' build:ts" emitted, exit 1. dist moved to /tmp and restored.
- [x] 3.6 Rebuild system; touch `packages/vite-plugin/src/index.ts`; run `bun run verify:build:showcase`; confirm stale message identifies `vite-plugin`. **Verified**: "ERROR: packages/vite-plugin/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/vite-plugin' build:ts" emitted, exit 1.
- [x] 3.7 Confirm short-circuit semantics: with BOTH `packages/system/dist/` stale AND `packages/vite-plugin/dist/` stale simultaneously, `verify:build:showcase` fails on the FIRST encountered stale check and does NOT enumerate both. **Verified**: script emits ONLY "ERROR: packages/system/dist/ is stale..." (system is earlier in the require_fresh_package_dist call order than vite-plugin). No vite-plugin message shown. Exit 1.
- [x] 3.8 Full-sweep: `bun run verify:full` after restoring all dists; confirm end-to-end green. **Substituted** (same substitution as §3.1): `verify:full` blocked by pre-existing `verify:assert:next` @layer gap. Equivalent coverage via `verify:build:next` ✓, `verify:build:showcase` ✓, `verify:assert:showcase` ✓ confirmed green after freshness restoration. `assert:next` deferred.

## 4. Update Spec + Documentation

- [x] 4.1 Confirm `specs/verification-tier-policy/spec.md` in this change captures the three changes: MODIFIED "Atomic Tier Isolation" (extended precondition list + dist-freshness rule), ADDED "Dist Freshness Precondition Pattern", ADDED "Shared Precondition Helper Library". (Done during propose phase; sanity check before apply.) **Verified**: all three present. Additionally amended during apply to reflect probe-order reality (`.mjs` → `.js`). `openspec validate --strict` clean after amendment.
- [x] 4.2 Update root `CLAUDE.md` § Verification Tiers to note the generalized staleness contract — specifically extend the "Upstream requires" column for `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:next`, `verify:showcase` with the per-package dist checks so the table matches the new script behavior. **Done**: atomic tier rows updated with explicit per-package fresh dist list; "Fails loud when" column extended to "NAPI or any upstream dist missing/stale". Composite rows (`verify:next`, `verify:showcase`) unchanged — their preconditions cascade from atomic tiers automatically.
- [x] 4.3 Close out `openspec/changes/archive/2026-04-13-verification-tier-policy/tasks.md` §11.11 as done-by-follow-up (noting that this change delivers it). **Done**: §11.11 flipped to `[x]` with "→ DONE-BY-FOLLOWUP" tag referencing this change.
- [x] 4.4 No per-package CLAUDE.md updates required — tier-specific text lives only in root.

## 5. Validation

- [x] 5.1 `openspec validate dist-staleness-preconditions --strict` — clean. **Re-run post-amendment**: valid.
- [x] 5.2 `bun run verify` (fast gate) — green. **Verified**: lint + compile + types + unit:ts + unit:rust (254 pass) + canary (192 pass, 4 snapshots).
- [x] 5.3 `bun run verify:full` — green (catches the full dependency graph). **Substituted** (same substitution as §3.1 / §3.8): `verify:full` blocked by pre-existing `verify:assert:next` @layer gap. All other tiers green; new preconditions exercised and passed.
- [ ] 5.4 Push branch, observe CI; confirm CI `verify` job still green with the generalized preconditions.

## 6. Post-Merge Follow-Ups

- [ ] 6.1 After this change merges, re-solicit the 5 reviewer personas (Release Eng, DX/Agent, Test Infra Skeptic, Monorepo Topology, OpenSpec Steward) per `feedback_reviewer_personas.md` — narrow focus to the helper library's API surface and the precondition-accuracy audit.
- [ ] 6.2 Consider a Tier-3 follow-up to enumerate ALL simultaneous staleness failures before exit (vs current short-circuit). Low priority; short-circuit covers 90%+ of cases.
- [ ] 6.3 Evaluate adding transitive staleness checks (e.g., `verify:build:showcase` checking `packages/core` indirectly if system depends on it) — likely unnecessary given `bun run build:ts` runs packages in dependency order, but worth a follow-up audit.
