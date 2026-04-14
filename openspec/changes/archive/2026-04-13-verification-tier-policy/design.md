## Context

The Animus monorepo currently exposes verification through three composite scripts (`verify`, `verify:full`, `verify:verify:showcase`) plus a scatter of `test:*` scripts, each of which silently assumes upstream artifacts. A developer or agent running `bun run test:canary` when the NAPI binary isn't built gets a confusing failure. Running a narrow verification set for a narrow change requires reading script bodies to understand the dependency chain. In practice, agents default to `verify:full` defensively — this inflates the inner-loop feedback cycle with unrelated build work.

The sole author (Staff Engineer) has explicitly framed the gap: "Having layers that we can target and instruct to isolate is likely useful. Long runs can slow down the loop and add noise for an agent. Ideally one main verification, then isolated steps that we can try and reduce the overall noise." The ask is a **policy layer** — isolation, rediscoverability, instructability — not a reduction in command count.

This change lands before two downstream topology changes (`legacy-package-archival`, `e2e-workspace-topology`) so those can adopt the tier contract rather than bolt on more monolithic scripts.

Current verification-adjacent state (April 2026, `next` branch):
- Root `package.json` scripts include `verify`, `verify:full`, `verify:showcase`, `test:canary`, `test:next`, `test:showcase`, `test:types`, `test:rust`. Each silently chains upstream work via `&&`.
- Root `CLAUDE.md` has a one-line table documenting `verify`, `verify:full`, `verify:showcase`, `test:canary`, `rebuild`. No isolation contract, no change-type map.
- Per-package `CLAUDE.md` files (system, extract, vite-plugin, showcase) duplicate fragments of verification guidance.
- `.github/workflows/ci.yaml` uses `oven-sh/setup-bun@v2` at 4 sites with no version pin. The bun 1.3.12 `createRequire` regression silently affected NAPI loading; fix was working around the bug with direct-path requires. A pinned bun version is prerequisite for `verify:ci` to be a meaningful local simulation of CI.
- Assertion scripts currently shell-based: `scripts/assert-showcase.sh`, `packages/next-test-app/scripts/assert-next-build.sh`. They use grep/test against build output. They will be invoked by the new `verify:assert:*` tiers unchanged; rewrite to TS is a later concern (`integration-test-infrastructure`).

## Goals / Non-Goals

**Goals:**
- Every verification tier is isolatable: running `verify:X` runs only X and fails loud if X's upstream artifacts are missing.
- Verification policy is rediscoverable from a single authoritative surface (root `CLAUDE.md` Verification Tier Table).
- Instructable change-type → verification-set map in root `CLAUDE.md` so agents select minimum viable verification for a given change.
- Local `verify:ci` simulates CI as closely as practical (not required to be byte-identical).
- Bun version parity between local and CI via `.tool-versions` + `bun-version-file` — eliminates the "works locally, fails in CI" class tied to bun version drift.
- Per-package scripts remain the actual implementation; root orchestrators compose them. Developers who work inside a single package can invoke per-package scripts directly; agents following the root policy use the root orchestrators.

**Non-Goals:**
- Rewriting existing assertion scripts (shell → TS). That work belongs to `integration-test-infrastructure`.
- Introducing a test runner change (bun:test stays). Runner choice is unaffected.
- Re-architecting CI job topology (`lint | test-rust | build-extract → verify → release`). Split/parallel `verify-e2e` is deferred until `e2e-workspace-topology` creates the content that would justify it.
- Adding new capabilities beyond verification policy. No new commands for `legacy/` or `e2e/` — those capabilities' own changes add the tier rows they need.
- Backwards compatibility for the pre-policy `verify`, `verify:full`, `verify:showcase` semantics. These are BREAKING changes (see proposal).

## Decisions

### Decision 1: Shell-based fail-loud preconditions (not JS/TS guards)

Each tier script starts with a shell precondition block that exits with a clear, actionable message if upstream artifacts are missing. Example pattern:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Preconditions
if ! ls packages/extract/*.node >/dev/null 2>&1; then
  echo "ERROR: NAPI binary missing. Run: bun run build:extract" >&2
  exit 1
fi
```

**Rationale**: parity with existing `scripts/assert-showcase.sh` and `packages/next-test-app/scripts/assert-next-build.sh` — no new language/runtime introduced. Shell is the minimum-complexity choice for a precondition gate. Escalation path (upgrade to TS) is available later if preconditions grow beyond file-existence checks. The user explicitly requested "whatever's easiest for you to write... reduce noise and easily legible in terms of intent while preserving capability."

**NAPI precondition — freshness check required**: `[ -f packages/extract/*.node ]` passes on stale binaries (prior-commit or wrong-platform `.node` files), which is the single most-cited failure mode in `packages/extract/CLAUDE.md`. The precondition for any NAPI-dependent tier MUST compare the `.node` mtime against the newest `packages/extract/src/**/*.rs` source mtime. Example:

```bash
# Precondition: fresh NAPI binary
if ! ls packages/extract/*.node >/dev/null 2>&1; then
  echo "ERROR: NAPI binary missing. Run: bun run build:extract" >&2
  exit 1
fi
newest_src=$(find packages/extract/src -name '*.rs' -newer packages/extract/*.node -print -quit 2>/dev/null)
if [ -n "$newest_src" ]; then
  echo "ERROR: NAPI binary is stale (Rust source newer than .node). Run: bun run build:extract" >&2
  exit 1
fi
```

**Precondition accuracy — read the actual script, not assumptions**: `verify:compile` invokes `tsc --noEmit` on per-package `src/` (no `dist/` needed). `verify:types` reads `packages/system/__tests__/tsconfig.test-d.json`, which includes `../src/**` directly (no `dist/` needed). `verify:canary` uses `require('../index.js')` — the NAPI wrapper — and does NOT need `packages/extract/dist/`. `verify:integration` DOES need `packages/extract/dist/` because it imports `@animus-ui/extract/pipeline`. Preconditions must be derived from the actual tier scripts, not generic "build:ts" assumptions.

**Alternatives considered**:
- TS script via `bun`: gives richer errors and shared utilities, but requires a small TS runner per tier — adds files and a build-dep before any preconditions fire. Rejected for now; reconsider if preconditions outgrow shell.
- Inline checks inside `package.json` scripts: impossible to express without escape hell and loses legibility.
- npm/bun `preverify:*` hooks: auto-run of hooks is the opposite of fail-loud. The policy is "fail if upstream missing," not "silently build upstream."

### Decision 2: Colon-separated tier naming (`verify:<tier>[:<scope>]`)

Naming convention: `verify:<tier>` for atomic tiers, `verify:<tier>:<scope>` when the tier has multiple scopes (e.g., `verify:unit:rust` vs `verify:unit:ts`, `verify:build:next` vs `verify:build:showcase`, `verify:assert:next` vs `verify:assert:showcase`).

**Rationale**: mirrors existing patterns in the repo (`build:ts`, `build:all`, `clean:light`, `clean:full`). Alphabetical listing in `package.json` naturally groups by tier. Agents can pattern-match with trailing globs in instructions (e.g., "run all `verify:assert:*`").

**Alternatives considered**:
- Dotted: `verify.unit.rust` — harder to pattern-match in bun filter syntax and breaks with shell glob expansion in some contexts.
- Hyphenated: `verify-unit-rust` — loses visual grouping since root-level commands all start with `verify-` regardless of tier.
- Nested bunfig config: over-engineered for a naming convention.

### Decision 3: Single source of truth = root CLAUDE.md Verification Tier Table

The root CLAUDE.md is the one place agents and humans look. Per-package CLAUDE.md files in `system/`, `extract/`, `vite-plugin/`, `showcase/` explicitly link back to the root table for verification commands — they do not re-document the same commands.

**Rationale**: the user identified that per-package scripts "rarely get read" and that the rediscoverability gap is about predictable structure, not more documentation. One source prevents drift. Cross-package verification commands belong at the root because they compose across packages.

**Alternatives considered**:
- Separate `VERIFICATION.md` at root: introduces yet another file; agents already know to read `CLAUDE.md`.
- Distributed in per-package CLAUDE.md files: guarantees drift. Rejected.

### Decision 4: Change-Type Map as in-repo authoritative instruction

The Change-Type Map is a table in root CLAUDE.md, maintained in tree. Canonical coverage: ~8-10 rows covering the primary edit surfaces (system, extract Rust, extract TS, vite-plugin, next-plugin, CSS cascade, token/theme, properties, openspec-only, broad refactor).

**Rationale**: the map is most useful when kept close to the code. Rows that rot fast (file paths) are visible in PR reviews. Rows added too eagerly (every edge case) inflate the map past the threshold where agents scan it rather than read it end-to-end. 8-10 rows is the sweet spot — tight enough to read at a glance, broad enough to cover the actual edit surface.

**Alternatives considered**:
- External doc (Notion / wiki): zero enforcement, guaranteed drift.
- Pre-commit hook that picks verification based on changed files: over-engineered, prescriptive, removes agent judgment. Rejected — the user explicitly wants agents *instructed*, not controlled.
- 30+ row exhaustive matrix: noise. Rejected.

### Decision 5: `verify:ci` is a best-effort CI mirror, not byte-identical

`verify:ci` reproduces CI's job set and ordering (`lint`, `test-rust`, `build-extract`, `verify` equivalent) locally. It explicitly runs `bun run build:extract` (producing the NAPI binary) before any tier that depends on it, mirroring CI's `build-extract` → `verify` dependency. It also runs `bun run build:ts` to produce `dist/` artifacts needed by tiers like `verify:integration`. Showcase build + assert is included (CI's `verify` job calls `bun run test:showcase`). Integration tier is included because CI's `bun test` step picks up `packages/_integration/__tests__` automatically.

It does not download artifacts (local build produces them). It does not run release steps. It does not attempt to match the CI runner OS or matrix-target count (CI builds 3 platform binaries; local builds 1). It does not run parallel jobs — it serializes into one stream.

**Rationale**: the user said "it should simulate [CI] as close as possible." Byte-identical reproduction requires containerized runners and binary-artifact round-trips — overkill for the signal we need (local reproducibility of a CI failure pattern). Best-effort mirror catches 90%+ of CI-vs-local divergence at ~5% of the engineering cost.

**Alternatives considered**:
- Docker-based `act` runner: reproduces CI exactly but adds Docker dependency and runtime. Too heavy for inner-loop.
- `verify:full` alias for `verify:ci`: loses the "this mirrors CI" semantic. Rejected — separate names for separate meanings.

### Decision 6: Bun version pin via `.tool-versions`

Single file `.tool-versions` at repo root declares bun version. All 4 CI sites use `bun-version-file: .tool-versions`. Local developers using `asdf` / `mise` / `proto` / other version managers get automatic local parity (`.tool-versions` is the cross-manager convention).

**Rationale**: the bun 1.3.12 `createRequire` regression was painful and version drift surfaces it unpredictably. Single file, cross-manager compatibility, zero extra tooling. `oven-sh/setup-bun@v2` natively supports `bun-version-file`.

**Alternatives considered**:
- Hardcode `bun-version: 1.3.14` (or whatever target) at each CI site: 4 places to update on upgrade, easy to drift.
- `packageManager` field in root `package.json` with `bun@X.Y.Z`: bun respects this but `setup-bun` does not consume it via `bun-version-file`. Still needs explicit CI param.
- `package.json` `engines.bun`: advisory-only, not enforced by `setup-bun`.

### Decision 7: `verify` semantics change is BREAKING, no compatibility shim

The redefinition of `verify`, `verify:full`, `verify:showcase` is a breaking change. No alias for the old behavior. CI and local devs update in lockstep with this change.

**Rationale**: no external consumers — this is an internal monorepo tooling contract. Compatibility shims would fossilize the old ambiguity. Clean break is clearer than a compatibility layer.

**Alternatives considered**:
- Deprecation period with warnings: buys delayed pain, not avoided pain. Rejected.
- Keep old names as aliases to new composites: obscures which is authoritative.

### Decision 8: Per-package scripts remain as implementation, root as policy

Per-package `package.json` `scripts` entries (e.g., `packages/_integration/package.json`'s `test` script) remain. Root orchestrators invoke them via `bun run --filter`. Per-package scripts are not the primary interface — the root Verification Tier Table is.

**Rationale**: keeps implementation close to the code, keeps interface close to the policy. Developers working deeply in a single package can still `cd packages/X && bun run test` without going through the root.

## Risks / Trade-offs

**[Risk] Fail-loud preconditions surface more failures than the current silent-build pattern → Mitigation**: the new failures are the signal we want. Each fail-loud message includes the exact command to satisfy the precondition. The cost of a clear "run X first" error is less than the cost of a confused debugging session.

**[Risk] Change-Type Map goes stale as packages evolve → Mitigation**: map is in tree, surfaces in PR diffs; rows covering new packages/edit-surfaces get added in the same change that introduces them. Owner rule: any change that adds a new top-level edit surface (e.g., a new publishable package) must add a Change-Type Map row.

**[Risk] `verify:ci` drifts from actual CI → Mitigation**: both definitions live in the same repo; the CI workflow and `verify:ci` script can be diffed. Acceptable drift boundary: command set and order match; runner-specific artifact downloads do not.

**[Risk] Agents ignore the Change-Type Map and run `verify:full` anyway → Mitigation**: per-session CLAUDE.md guidance can reference the map. This risk is inherent to any policy — the map's existence is necessary but not sufficient. Evidence of agent adoption is the signal for iteration.

**[Risk] Bun version pin is too aggressive — forces upgrades the codebase isn't ready for → Mitigation**: the pin is a declaration, not a floor. Upgrading bun is an explicit, scoped change: update `.tool-versions`, verify, commit. No auto-upgrade.

**[Trade-off] Shell preconditions limit error richness → Accepted**: if preconditions grow beyond file-existence checks (e.g., "NAPI binary loadable as module"), upgrade that specific precondition to TS. Until then, shell suffices.

**[Trade-off] `verify:ci` is best-effort, not reproducible CI → Accepted**: full reproduction costs Docker complexity; 90% coverage at 5% cost is the right trade for inner-loop work.

## Migration Plan

Atomic cutover, consistent with Decision 7 (BREAKING, no compat shim). Single commit:

1. **Write all atomic tier scripts + composite orchestrators.** Old `verify`, `verify:full`, `verify:showcase` are redefined in-place to the new semantics in the same commit — no side-by-side coexistence.
2. **Update CLAUDE.md** (root + per-package) and `ci.yaml` (bun pin via `.tool-versions`) in the same commit.
3. **Remove orphaned `test:*` scripts** (`test:canary`, `test:next`, `test:showcase`, `test:types`, `test:rust`) in the same commit — do not leave deprecation aliases.
4. **Verify locally and in CI** that every tier runs in isolation and every composite passes.
5. **Post-merge**: update internal prompts / memory entries referencing old verify semantics.

Rollback: revert the single commit; prior state restored. No persisted state to undo.

## Open Questions

- Does `test:types` (type-contract tests via `tsconfig.test-d.json`) become `verify:types` exactly, or does it need a scope suffix (`verify:types:contract`) to leave room for future type check variants? **Leaning**: `verify:types` covers the current contract tests; add scope only when a second variant is introduced.
- Should the Verification Tier Table live in root CLAUDE.md or in a top-level `VERIFICATION.md` that CLAUDE.md references? **Leaning**: in CLAUDE.md — agents already load it; extra file adds an indirection without benefit.
- For `verify:ci`: does it run the `lint`, `test-rust`, `build-extract`, `verify` tier-set in CI's actual order, or does it flatten for speed? **Leaning**: preserve order — the whole point is to surface order-dependent CI failures locally.
