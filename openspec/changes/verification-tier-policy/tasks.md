## 1. Bun Version Pin (foundation)

- [x] 1.1 Pin bun to version **1.3.11** (local + netlify already use this; 1.3.11 is pre-1.3.12-createRequire-regression). Recorded in `.tool-versions` at repo root with a single line `bun 1.3.11`.
- [x] 1.2 `oven-sh/setup-bun@v2` consumes `bun-version-file: .tool-versions` — applied to all 4 sites in one change rather than phased rollout (atomic-cutover consistent with design Decision 7).
- [x] 1.3 Updated all 4 `oven-sh/setup-bun@v2` sites in `.github/workflows/ci.yaml` (lint, build-extract, verify, release jobs) with `with: bun-version-file: .tool-versions`.
- [x] 1.4 `netlify.toml` `BUN_VERSION = "1.3.11"` already matches `.tool-versions` pin. No edit required; kept as-is.
- [ ] 1.5 Run local `bun install && bun run verify` to confirm no version drift; push to a feature branch and confirm CI green with the pinned version. (Deferred to Phase F validation.)

## 2. Audit Current Verification Surface

- [ ] 2.1 Inventory current root `package.json` scripts: list every `verify:*`, `test:*`, `build:*`, `clean:*`, `dev:*`, `deploy:*`, `compile`, `lint`, `format`, `check`, `check:fix` with a one-line description of what each does today.
- [ ] 2.2 Identify which atomic concerns each current script mixes (e.g., `verify` mixes `build:ts` + `compile` + `test` + `test:rust` + `test:types` + `check` — some are atomic, some are composite).
- [ ] 2.3 Map current scripts to the target tier table: which current script becomes which atomic tier, which becomes which composite orchestrator, which is removed entirely.
- [ ] 2.4 Cross-reference per-package `package.json` scripts: which atomic tiers are actually implemented per-package (e.g., `packages/_integration` has its own `test` script that `verify:integration` should delegate to).

## 3. Atomic Tier Scripts

- [x] 3.1 Created `scripts/verify/` directory for per-tier shell scripts.
- [x] 3.2 Wrote `scripts/verify/lint.sh` — no preconditions; exec `bun run check`.
- [x] 3.3 Wrote `scripts/verify/compile.sh` — precondition: `node_modules/.bin/tsc` exists; exec `bun run --filter './packages/*' compile`.
- [x] 3.4 Wrote `scripts/verify/types.sh` — precondition: `node_modules/.bin/tsc` exists; exec `tsc -p packages/system/__tests__/tsconfig.test-d.json --noEmit`.
- [x] 3.5 Wrote `scripts/verify/unit-rust.sh` — no preconditions; `cd packages/extract && cargo test --lib`.
- [x] 3.6 Wrote `scripts/verify/unit-ts.sh` — no preconditions; explicit path list: `bun test packages/system/__tests__ packages/vite-plugin/tests packages/properties/__tests__`.
- [x] 3.7 Wrote `scripts/verify/canary.sh` — NAPI existence + mtime-freshness preconditions; exec `bun test packages/extract/tests/canary.test.ts`.
- [x] 3.8 Wrote `scripts/verify/integration.sh` — NAPI-fresh AND `packages/extract/dist/index.mjs` preconditions; exec `bun run --filter '@animus-ui/integration' test`.
- [x] 3.9 Wrote `scripts/verify/build-next.sh` — NAPI-fresh AND `packages/extract/dist/index.mjs` preconditions; exec `bun run --filter '@animus-ui/next-test-app' build` (path + filter identifier stay at current values; rename is owned by `e2e-workspace-topology`).
- [x] 3.10 Wrote `scripts/verify/build-showcase.sh` — NAPI-fresh AND `packages/extract/dist/index.mjs` preconditions; exec `bun run --filter './packages/showcase' build`.
- [x] 3.11 Wrote `scripts/verify/assert-next.sh` — precondition: `packages/next-test-app/.next/` exists; exec `bash packages/next-test-app/scripts/assert-next-build.sh` (path updates in `e2e-workspace-topology`).
- [x] 3.12 Wrote `scripts/verify/assert-showcase.sh` — precondition: `packages/showcase/dist/` exists; exec `bash scripts/assert-showcase.sh`.
- [ ] 3.13 For every atomic tier script, confirm that running it with a clean slate (no upstream artifacts) exits non-zero with a readable "ERROR: X missing. Run: Y" message. (Validated in Phase F §8.)
- [ ] 3.14 For every atomic tier script, confirm that running it with upstream artifacts present executes only its single concern and does not rebuild upstream. (Validated in Phase F §8.)

## 4. Composite Orchestrator Scripts

- [x] 4.1 `verify` defined as `verify:lint && verify:compile && verify:types && verify:unit:ts && verify:unit:rust && verify:canary` (fast gate; excludes integration, build, assert).
- [x] 4.2 `verify:full` defined as `verify && verify:integration && verify:build:next && verify:build:showcase && verify:assert:next && verify:assert:showcase`.
- [x] 4.3 `verify:ci` defined mirroring CI order: `verify:lint → verify:unit:rust → build:extract → build:ts → verify:compile → verify:types → verify:unit:ts → verify:canary → verify:integration → verify:build:showcase → verify:assert:showcase`. Includes integration (CI `bun test` picks it up) and showcase build+assert (CI `test:showcase`). `bun run build:extract` and `bun run build:ts` invoked inline (CI materializes these before verify).
- [x] 4.4 `verify:next` defined as `verify:build:next && verify:assert:next`.
- [x] 4.5 `verify:showcase` defined as `verify:build:showcase && verify:assert:showcase` (was previously `bun run build:all && --filter showcase build` — breaking redefinition per design Decision 7).
- [ ] 4.6 Confirm composite orchestrators show which atomic tier failed when they fail. (Validated in Phase F §8 — fail-loud preconditions emit per-tier error messages; `&&` short-circuits on first non-zero.)
- [x] 4.7 Removed 5 orphaned scripts (`test:canary`, `test:next`, `test:showcase`, `test:types`, `test:rust`) in-place. No deprecation aliases — atomic cutover per design Decision 7.

## 5. CLAUDE.md: Root Verification Tier Table

- [x] 5.1 Replaced "Verification Commands" table in root `CLAUDE.md` with two tables under `### Verification Tiers`: Atomic Tiers and Composite Orchestrators.
- [x] 5.2 Populated 11 atomic tier rows with all 5 columns (Command, What it covers, Upstream requires, Fails loud when, Typical runtime).
- [x] 5.3 Populated 5 composite orchestrator rows (verify, verify:full, verify:ci, verify:next, verify:showcase).
- [x] 5.4 Added explicit note: "Per-package `CLAUDE.md` files MUST NOT duplicate it — they link back here."
- [x] 5.5 Added forward-pointer: "For domain-specific guidance, drill into `packages/<name>/CLAUDE.md` after consulting this table."

## 6. CLAUDE.md: Root Change-Type Map

- [x] 6.1 Added `### Change-Type Map` section after the Verification Tier Table (sub-heading of Monorepo Build System, for index-depth parity with Verification Tiers).
- [x] 6.2 Populated 11 canonical rows (system, extract Rust, extract TS, vite-plugin, next-plugin, showcase code, properties, _integration tests, test-ds, CI/scripts/tool-versions, broad refactor).
- [x] 6.3 Added sidebar "No verify tier required" bulleted list covering `openspec/**`, MDX content, and root markdown.
- [x] 6.4 Added ownership rule: "any change introducing a new top-level edit surface (e.g., a new publishable package, a new `e2e/*` fixture) MUST add a corresponding row to this map in the same change that introduces the surface."

## 7. Per-Package CLAUDE.md Deduplication

- [x] 7.1 `packages/system/CLAUDE.md` — replaced `bun run test:types` inline reference with link-back to root § Verification Tiers.
- [x] 7.2 `packages/extract/CLAUDE.md` — replaced "## Verification" block (`bun run test:canary`, `bun test`) with link-back note calling out relevant atomic tiers.
- [x] 7.3 `packages/vite-plugin/CLAUDE.md` — no verify-command listing present (grep confirmed); no edit required.
- [x] 7.4 `packages/showcase/CLAUDE.md` — replaced "## Verification" block (`bun run test:showcase`, `bun run verify:showcase`) with link-back note.
- [x] 7.5 `.claude/rules/TESTING.md` — rewrote entire "Tiers & Commands" section to use new `verify:*` tier names (this is the auto-loaded rules file enumerating test tiers; staying in sync with the policy).

## 8. Validation

- [ ] 8.1 Scripted clean-slate precondition enumeration deferred — preconditions proven correct in-session via verify:canary runtime (NAPI + mtime check fires correctly) and via shell-script inspection against design.md Decision 1. Full clean-slate enumeration captured as §11 follow-up.
- [x] 8.2 Atomic tiers run with upstream artifacts present; all validated green in-session:
  - `verify:lint` ✓ (after `check:fix` resolved pre-existing formatter drift in 6 files)
  - `verify:compile` ✓ (tsc --noEmit across all packages)
  - `verify:types` ✓
  - `verify:unit:rust` ✓ (254 passed, 0 failed)
  - `verify:unit:ts` ✓ (108 pass, 0 fail, 311 expect calls, 354ms)
  - `verify:canary` ✓ (192 pass, 4 snapshots, 413 expect calls, 97ms)
  - `verify:integration` ✓ (87 pass, 183 expect calls)
  - `verify:build:showcase` ✓ (vite build, 704ms)
  - `verify:assert:showcase` ✓ (6/6 positional assertions)
  - `verify:build:next` ✓ (post pre-existing type-fix by maintainer)
  - `verify:assert:next` ✗ — pre-existing issue, DEFERRED (see §11.8)
- [x] 8.3 `bun run verify` (fast gate) passes end-to-end. Wall-clock inside-loop reasonable (~15s local, dominated by unit:rust cargo compile).
- [ ] 8.4 `bun run verify:full` not run as a single end-to-end composite in-session; individual constituent tiers (above) cover its coverage surface 10-of-11 — only the single pre-existing assert:next gap blocks the composite pass. Gate on §11.8 follow-up.
- [ ] 8.5 `bun run verify:ci` not run in-session — CI confirmation delegated to actual CI via §8.7 push.
- [ ] 8.6 Explicit `touch packages/extract/src/lib.rs` stale-binary scenario test deferred — logic matches design.md Decision 1 exactly; NAPI existence + mtime check visible in `scripts/verify/canary.sh`. Captured as §11 follow-up.
- [x] 8.7 Maintainer pushed change to `next` branch directly (prerelease / solo-author context). CI run in-flight. Authoritative CI signal expected via maintainer report.

## 9. Documentation + Announce

- [x] 9.1 Cross-check performed. The existing `bun-workspace` spec § "Simplified root scripts" enumerated `test:canary` and `test:showcase` by name — both are removed by this change. Added `specs/bun-workspace/spec.md` with MODIFIED "Simplified root scripts" requirement updating the script inventory scenario to enumerate the new `verify:*` atomic + composite scripts and explicitly exclude the 5 removed orphans. Version pin itself is covered by the new `verification-tier-policy/spec.md` § "Bun Version Pin" — no duplication in bun-workspace.
- [x] 9.2 Changelog note (captured in this task file below):
  - **BREAKING**: `verify`, `verify:full`, `verify:showcase` semantics changed.
    - Old `verify`: `build:ts && compile && bun test && test:rust && test:types && check` (built TS, mixed test scopes, ran biome check)
    - New `verify`: fast-gate composite — `verify:lint && verify:compile && verify:types && verify:unit:ts && verify:unit:rust && verify:canary`. No builds. No showcase.
    - Old `verify:full`: `build:all && bun test && test:rust && check && test:showcase`
    - New `verify:full`: fast-gate + integration + all build + all assert tiers.
    - Old `verify:showcase`: `build:all && --filter showcase build`
    - New `verify:showcase`: composite `verify:build:showcase && verify:assert:showcase`.
  - **REMOVED** (no aliases): `test:canary`, `test:next`, `test:showcase`, `test:types`, `test:rust`. Migration: use corresponding `verify:*` tiers per root CLAUDE.md Change-Type Map.
  - **ADDED**: 11 atomic `verify:*` tiers + new composites `verify:ci`, `verify:next`.
- [x] 9.3 Memory cleanup surfaced: `.claude/rules/TESTING.md` was updated inline (it auto-loads and enumerated old tier names). No other personal CLAUDE.md or session-note drift detected in scope (session memory files describe the changes themselves, not verify-command semantics). Downstream session notes referencing old `test:*` names will be self-rotting as future sessions re-ground against root CLAUDE.md.

## 10. Post-Merge Integration

- [ ] 10.1 After merge, confirm `legacy-package-archival` and `e2e-workspace-topology` adopt tier-compatible naming rather than adding monolithic scripts.
- [ ] 10.2 Confirm no orphaned `test:*` scripts remain; all verification entry points go through the tier policy.

## 11. Deferred Items (Tier-3, address after Tiers 1–2 complete)

- [ ] 11.1 Decide on `verify:dev` / `verify:hmr` tier: add an atomic tier covering HMR/dev-server smoke (e.g., boot dev server, trigger a file change, confirm transform re-run) — OR — declare explicitly out of scope with justification (e.g., "HMR verification belongs to `integration-test-infrastructure`; inner-loop HMR debugging is live-observed, not scripted"). Document the decision in `design.md` as Decision 9.
- [ ] 11.2 Benchmark step: measure `verify` fast-gate wall-clock time on a clean build and compare against the pre-change `verify` wall-clock time. Record the numbers in a file or commit message. If new `verify` is slower than previous, investigate overlap between `verify:compile` + `verify:types` + `verify:unit:ts` and potentially drop one from the fast gate with justification.
- [ ] 11.3 Add an `Upstream artifacts needed` column to the Change-Type Map — so agents know whether to run `bun run build:all` before the listed tier set (e.g., `verify:integration` needs `build:ts`; `verify:compile` does not).
- [ ] 11.4 Add multi-precondition failure scenario to the spec: when a tier has multiple preconditions and more than one fails, should the script print all violations or short-circuit at the first? Current spec says short-circuit; evaluate whether full-enumeration is worth the script complexity.
- [ ] 11.5 Clarify `verify:assert:*` "fails loud when" column: "fails loud when build output dist is missing; fails normally (non-zero exit) when assertions themselves fail." The distinction matters for interpreting CI failures.
- [ ] 11.6 Document the `cd legacy/<pkg> && bun install` footgun (legacy packages have `workspace:*` cross-refs that no longer resolve) in root CLAUDE.md `## Legacy Packages` section — add to that section's task list in `legacy-package-archival`.
- [ ] 11.7 Idempotency pre-check for `legacy-package-archival` task 4: add a state-recording step before any `private:`/`publishConfig:` edit so the task is safely re-runnable.
- [ ] 11.8 Investigate `verify:assert:next` finding: "FAIL: CSS contains @layer base" + "FAIL: CSS contains @layer variants" after a clean next-test-app build. Surfaced by the verification-tier-policy apply but NOT caused by it — pre-existing extraction output gap in next-test-app (showcase assertions pass all 6, so not a general extraction regression). Candidates: next-plugin CSS handling for app-router vs pages-router, layer ordering in the virtual stylesheet emission path, missing extraction for a component category in next-test-app. Not blocking merge of verification-tier-policy; this tier correctly surfaced the issue.
- [ ] 11.9 Clean-slate precondition enumeration (task §8.1): scripted run that deletes upstream artifacts in turn and runs each tier to confirm every precondition fires with the expected "ERROR: X missing. Run: Y" shape. Worth writing as `scripts/verify/_test-preconditions.sh` in a follow-up, idempotent + no cargo side-effects.
- [ ] 11.10 Explicit stale-binary scenario (task §8.6): `touch packages/extract/src/lib.rs` → run `verify:canary` → confirm "ERROR: NAPI binary is stale" message. Small risk of perturbing cargo incremental cache; worth doing once deliberately with a `bun run rebuild` follow-up.
