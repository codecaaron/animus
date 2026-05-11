## 1. Pre-Move Verification

- [x] 1.1 Confirm `legacy-package-archival` change has landed (this change depends on it being merged so that the workspaces array no longer contains legacy entries).
- [x] 1.2 Record baseline: run `bun run verify` (using tier structure from `verification-tier-policy` if applied) and confirm green before restructuring.
- [x] 1.3 Grep the repo for references to `packages/next-test-app` and `@animus-ui/next-test-app` to inventory all locations that will need path + name updates.

## 2. Create `e2e/` Directory and Move next-test-app

- [x] 2.1 Run `git mv packages/next-test-app e2e/next-app`.
- [x] 2.2 Verify `ls e2e/` shows exactly `next-app/`.
- [x] 2.3 Verify `ls packages/` no longer contains `next-test-app`.
- [x] 2.4 Verify `git status` shows the move as a rename (not add + delete).

## 3. Rename Package Identity (confirmed, not optional)

- [x] 3.1 Edit `e2e/next-app/package.json`: change `"name"` field from `"@animus-ui/next-test-app"` to `"@animus-ui/next-app"`. This resolves the directory↔name mismatch flagged by review.
- [x] 3.2 Update root `package.json` `test:next` script to use the new filter identifier: replace `--filter '@animus-ui/next-test-app'` with `--filter '@animus-ui/next-app'`; update the path to `e2e/next-app/scripts/assert-next-build.sh`. (Note: `test:next` was superseded by the `verify:next` composite during `verification-tier-policy`; the `--filter` and path actually live in `scripts/verify/build-next.sh` and `scripts/verify/assert-next.sh` — both updated.)
- [x] 3.3 Grep repo for any other reference to `@animus-ui/next-test-app` (CI workflow, per-package CLAUDE.md, docs, scripts) and update to `@animus-ui/next-app`. (Found + updated: `scripts/verify/build-next.sh` filter. No CI workflow or per-package CLAUDE.md references exist. `bun.lock` regenerates on install.)
- [x] 3.4 Confirm the package remains `private: true` (no publishing concern from the rename).

## 4. Create `packages/_assertions/` Scaffold

- [x] 4.1 Create `packages/_assertions/` directory.
- [x] 4.2 Create `packages/_assertions/package.json` with:
  - `"name": "@animus-ui/assertions"`
  - `"version": "0.0.1"` (or `0.0.0` to signal unpublishable)
  - `"private": true`
  - `"description": "Shared assertion utilities for Animus post-build and E2E tests"`
  - `"type": "module"`
  - `"main": "./dist/index.js"`, `"module": "./dist/index.js"`, `"types": "./dist/index.d.ts"`
  - Scripts: `"build": "bun run build:ts"`, `"build:ts": "tsdown && tsc -p tsconfig.build.json"`, `"compile": "tsc --noEmit"`
  - `dependencies`: `"@animus-ui/properties": "workspace:*"` (and optionally `@animus-ui/system` if system types are imported by future utilities)
- [x] 4.3 Create `packages/_assertions/src/index.ts` with a **scaffold-status header** (not a bare export):
  ```ts
  // @animus-ui/assertions — scaffold only.
  // See packages/_assertions/CLAUDE.md and the integration-test-infrastructure change for content roadmap.
  export {};
  ```
  The header comment is required (see spec `shared-assertions-scaffold/spec.md` Requirement "Scaffold Header Banner").
- [x] 4.4 Create `packages/_assertions/tsconfig.json` following the pattern of other private packages (extending root `tsconfig.base` if one exists, else inline minimal config).
- [x] 4.5 Create `packages/_assertions/tsconfig.build.json` for emit configuration.
- [x] 4.6 Create `packages/_assertions/tsdown.config.ts` extending `tsdown.config.base.ts` if present, else minimal inline config.
- [x] 4.7 Create `packages/_assertions/CLAUDE.md` with contents: "# @animus-ui/assertions — SCAFFOLD ONLY\n\nThis package is a scaffold for shared assertion utilities used by post-build scripts in `packages/*` and fixture apps in `e2e/*`. Content will be added by the `integration-test-infrastructure` change. Do not add utilities here without aligning to that change's specs."

## 5. Update Root `package.json`

- [x] 5.1 In the `workspaces` array: remove `"packages/next-test-app"` (the entry is present; the `legacy-package-archival` change does not touch it). Add `"e2e/next-app"`. Add `"packages/_assertions"`.
- [x] 5.2 Confirm the final workspaces array is 10 entries total — 9 under `packages/` (`_assertions`, `_integration`, `extract`, `next-plugin`, `properties`, `showcase`, `system`, `test-ds`, `vite-plugin`) + 1 under `e2e/` (`e2e/next-app`). Note: this count assumes `legacy-package-archival` already removed `packages/core` and `packages/theming`.
- [x] 5.3 Update `test:next` script: change `packages/next-test-app/scripts/assert-next-build.sh` to `e2e/next-app/scripts/assert-next-build.sh`; update `--filter '@animus-ui/next-test-app'` to `--filter '@animus-ui/next-app'`. (Landing surface: `scripts/verify/build-next.sh` + `scripts/verify/assert-next.sh` — `test:next` itself is absent post-VTP.)
- [x] 5.4 Verify no other script references `packages/next-test-app` or `@animus-ui/next-test-app` (grep root `package.json` scripts block). (Scripts block clean — `build:ts` uses `./packages/*` glob which correctly excludes `e2e/next-app`.)

## 6. Update Root `CLAUDE.md`

- [x] 6.1 Add a `## Workspace Topology` section (or similar) near the top, after the MANDATORY RULES or before the monorepo build system section.
- [x] 6.2 In that section, describe the three-directory convention:
  - `packages/` — publishable packages (`properties`, `system`, `extract`, `vite-plugin`, `next-plugin`) + deep-internal private packages (`_integration`, `_assertions`, `test-ds`, `showcase`)
  - `e2e/` — consumer fixture applications (build + assert post-build): `next-app` (at minimum, as of this change)
  - `legacy/` — archived packages preserved for reference only (per `legacy-package-archival`)
- [x] 6.3 State the one-way dependency rule: `e2e/*` may import `packages/*`; `packages/*` MUST NOT import `e2e/*`; neither may import `legacy/*`.
- [x] 6.4 If `verification-tier-policy` has landed, update the Change-Type Map row for `packages/next-plugin/src/**` to `verify:compile && verify:next` (where `verify:next` is the composite chaining build + assert against the new `e2e/next-app` location). (Row already reads `verify:compile && verify:next` from the VTP apply — value unchanged by this rename since the composite shell scripts now resolve the new path.)

## 7. Update Per-Package CLAUDE.md References

- [x] 7.1 Read `packages/next-plugin/CLAUDE.md` (if present); update any reference to `packages/next-test-app/` → `e2e/next-app/` and `@animus-ui/next-test-app` → `@animus-ui/next-app`. (Grep over `packages/**/CLAUDE.md` returned no matches for `next-test-app`; no update needed.)
- [x] 7.2 Read `packages/system/CLAUDE.md`, `packages/extract/CLAUDE.md`, `packages/vite-plugin/CLAUDE.md`, `packages/showcase/CLAUDE.md`; update stale path and name references. (Same grep — clean.)
- [x] 7.3 Verify the new `e2e/next-app/CLAUDE.md` (inherited from the move) references its own location correctly — if it referenced `packages/next-test-app/` or `@animus-ui/next-test-app` internally, update. (No `CLAUDE.md` exists in the moved directory — next-test-app never had one.)

## 8. Update Assertion Script Internal References

- [x] 8.1 Read `e2e/next-app/scripts/assert-next-build.sh`; update any self-reference to `packages/next-test-app/` → `e2e/next-app/`. (Script uses `cd "$(dirname "$0")/.."` with relative paths throughout — no self-references to the old path. Clean.)
- [x] 8.2 Read `e2e/next-app/next.config.ts` (or `.js`); update any path reference to the new location (typically none — next config uses relative paths). (`next.config.ts` is 7 lines; `system: './src/ds.ts'` relative — no location refs. Clean.)

## 9. Verification

- [x] 9.1 Run `bun install` from repo root; confirm clean install with no errors. (`Saved lockfile`, 1 package removed, no errors.)
- [x] 9.2 Run `bun run --filter @animus-ui/next-app build`; confirm build completes (verifies the rename). (Executed as part of `verify:build:next` subtier — exit 0, Next build output written to `e2e/next-app/.next/`.)
- [x] 9.3 Run `bun run test:next`; confirm it executes the build + assertion pipeline against the new path and filter identifier. (`test:next` superseded post-VTP; `verify:next` composite ran: `build-next.sh` green, `assert-next.sh` 5/7 pass with pre-existing §11.8 `@layer base/variants` gap — same state as session 75, not caused by this change.)
- [x] 9.4 Run `bun run verify:full` (or `bun run verify` + relevant build/assert tiers if tier structure is in place); confirm green. (10/11 tiers green; `verify:assert:next` failed with session-75's documented §11.8 pre-existing gap — build pipeline from `verify:lint` through `verify:build:{next,showcase}` and `verify:assert:showcase` all exit 0. Topology restructure introduced zero new regressions.)
- [x] 9.5 Confirm `packages/_assertions/` builds cleanly via `bun run --filter @animus-ui/assertions build`. (Built during `build:all` — `dist/index.js` (0 bytes, correct for empty export), `dist/index.d.ts` (46 bytes), `dist/index.d.ts.map` emitted.)
- [x] 9.6 Grep repo for `packages/next-test-app` and `@animus-ui/next-test-app` — confirm only archived openspec content still references the old path/name. (Remaining hits: this change's own artifacts, `openspec/changes/archive/**`, `openspec/changes/integration-test-infrastructure/**` (queue item 4 rebase), and main specs `next-test-app-structure` + `verification-tier-policy` (synced at archive time). `bun.lock` regenerated clean.)

## 10. CI Validation

- [ ] 10.1 Push branch to remote; observe CI pipeline.
- [ ] 10.2 Confirm all CI jobs pass with the new paths and package name.
- [ ] 10.3 Note: `test:next` is not currently in CI's `verify` job. Its inclusion is out of scope for this change — flag as follow-up if not already queued.

## 11. Post-Merge Follow-Ups (tracked separately, not blockers)

- [ ] 11.1 Queue: add `verify:build:next && verify:assert:next` to CI `verify` job as part of `integration-test-infrastructure`.
- [ ] 11.2 Queue: add CI/lint enforcement of the one-way dependency rule (`packages/* ↛ e2e/*`, `packages/* ↛ legacy/*`, `e2e/* ↛ legacy/*`).
- [ ] 11.3 Queue: decide whether to convert workspaces array to glob (`packages/*`, `e2e/*`) — trivial one-line change when ready.
- [ ] 11.4 Queue: `integration-test-infrastructure` rebase — its tasks 0.1 (bun pin), 1.1–1.4 (e2e/helpers/), 2.1 (e2e/vite-app/), 4.3 (packages/next-test-app path) all need updating to point at the new topology: bun pin is handled here, shared utilities go in `packages/_assertions/src/`, vite-app is still in `e2e/vite-app/` (creation now valid post-this-change), and next-app assertions target `e2e/next-app/`.
