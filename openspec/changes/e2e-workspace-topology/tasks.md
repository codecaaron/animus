## 1. Pre-Move Verification

- [ ] 1.1 Confirm `legacy-package-archival` change has landed (this change depends on it being merged so that the workspaces array no longer contains legacy entries).
- [ ] 1.2 Record baseline: run `bun run verify` (using tier structure from `verification-tier-policy` if applied) and confirm green before restructuring.
- [ ] 1.3 Grep the repo for references to `packages/next-test-app` and `@animus-ui/next-test-app` to inventory all locations that will need path + name updates.

## 2. Create `e2e/` Directory and Move next-test-app

- [ ] 2.1 Run `git mv packages/next-test-app e2e/next-app`.
- [ ] 2.2 Verify `ls e2e/` shows exactly `next-app/`.
- [ ] 2.3 Verify `ls packages/` no longer contains `next-test-app`.
- [ ] 2.4 Verify `git status` shows the move as a rename (not add + delete).

## 3. Rename Package Identity (confirmed, not optional)

- [ ] 3.1 Edit `e2e/next-app/package.json`: change `"name"` field from `"@animus-ui/next-test-app"` to `"@animus-ui/next-app"`. This resolves the directory↔name mismatch flagged by review.
- [ ] 3.2 Update root `package.json` `test:next` script to use the new filter identifier: replace `--filter '@animus-ui/next-test-app'` with `--filter '@animus-ui/next-app'`; update the path to `e2e/next-app/scripts/assert-next-build.sh`.
- [ ] 3.3 Grep repo for any other reference to `@animus-ui/next-test-app` (CI workflow, per-package CLAUDE.md, docs, scripts) and update to `@animus-ui/next-app`.
- [ ] 3.4 Confirm the package remains `private: true` (no publishing concern from the rename).

## 4. Create `packages/_assertions/` Scaffold

- [ ] 4.1 Create `packages/_assertions/` directory.
- [ ] 4.2 Create `packages/_assertions/package.json` with:
  - `"name": "@animus-ui/assertions"`
  - `"version": "0.0.1"` (or `0.0.0` to signal unpublishable)
  - `"private": true`
  - `"description": "Shared assertion utilities for Animus post-build and E2E tests"`
  - `"type": "module"`
  - `"main": "./dist/index.js"`, `"module": "./dist/index.js"`, `"types": "./dist/index.d.ts"`
  - Scripts: `"build": "bun run build:ts"`, `"build:ts": "tsdown && tsc -p tsconfig.build.json"`, `"compile": "tsc --noEmit"`
  - `dependencies`: `"@animus-ui/properties": "workspace:*"` (and optionally `@animus-ui/system` if system types are imported by future utilities)
- [ ] 4.3 Create `packages/_assertions/src/index.ts` with a **scaffold-status header** (not a bare export):
  ```ts
  // @animus-ui/assertions — scaffold only.
  // See packages/_assertions/CLAUDE.md and the integration-test-infrastructure change for content roadmap.
  export {};
  ```
  The header comment is required (see spec `shared-assertions-scaffold/spec.md` Requirement "Scaffold Header Banner").
- [ ] 4.4 Create `packages/_assertions/tsconfig.json` following the pattern of other private packages (extending root `tsconfig.base` if one exists, else inline minimal config).
- [ ] 4.5 Create `packages/_assertions/tsconfig.build.json` for emit configuration.
- [ ] 4.6 Create `packages/_assertions/tsdown.config.ts` extending `tsdown.config.base.ts` if present, else minimal inline config.
- [ ] 4.7 Create `packages/_assertions/CLAUDE.md` with contents: "# @animus-ui/assertions — SCAFFOLD ONLY\n\nThis package is a scaffold for shared assertion utilities used by post-build scripts in `packages/*` and fixture apps in `e2e/*`. Content will be added by the `integration-test-infrastructure` change. Do not add utilities here without aligning to that change's specs."

## 5. Update Root `package.json`

- [ ] 5.1 In the `workspaces` array: remove `"packages/next-test-app"` (the entry is present; the `legacy-package-archival` change does not touch it). Add `"e2e/next-app"`. Add `"packages/_assertions"`.
- [ ] 5.2 Confirm the final workspaces array is 10 entries total — 9 under `packages/` (`_assertions`, `_integration`, `extract`, `next-plugin`, `properties`, `showcase`, `system`, `test-ds`, `vite-plugin`) + 1 under `e2e/` (`e2e/next-app`). Note: this count assumes `legacy-package-archival` already removed `packages/core` and `packages/theming`.
- [ ] 5.3 Update `test:next` script: change `packages/next-test-app/scripts/assert-next-build.sh` to `e2e/next-app/scripts/assert-next-build.sh`; update `--filter '@animus-ui/next-test-app'` to `--filter '@animus-ui/next-app'`.
- [ ] 5.4 Verify no other script references `packages/next-test-app` or `@animus-ui/next-test-app` (grep root `package.json` scripts block).

## 6. Update Root `CLAUDE.md`

- [ ] 6.1 Add a `## Workspace Topology` section (or similar) near the top, after the MANDATORY RULES or before the monorepo build system section.
- [ ] 6.2 In that section, describe the three-directory convention:
  - `packages/` — publishable packages (`properties`, `system`, `extract`, `vite-plugin`, `next-plugin`) + deep-internal private packages (`_integration`, `_assertions`, `test-ds`, `showcase`)
  - `e2e/` — consumer fixture applications (build + assert post-build): `next-app` (at minimum, as of this change)
  - `legacy/` — archived packages preserved for reference only (per `legacy-package-archival`)
- [ ] 6.3 State the one-way dependency rule: `e2e/*` may import `packages/*`; `packages/*` MUST NOT import `e2e/*`; neither may import `legacy/*`.
- [ ] 6.4 If `verification-tier-policy` has landed, update the Change-Type Map row for `packages/next-plugin/src/**` to `verify:compile && verify:next` (where `verify:next` is the composite chaining build + assert against the new `e2e/next-app` location).

## 7. Update Per-Package CLAUDE.md References

- [ ] 7.1 Read `packages/next-plugin/CLAUDE.md` (if present); update any reference to `packages/next-test-app/` → `e2e/next-app/` and `@animus-ui/next-test-app` → `@animus-ui/next-app`.
- [ ] 7.2 Read `packages/system/CLAUDE.md`, `packages/extract/CLAUDE.md`, `packages/vite-plugin/CLAUDE.md`, `packages/showcase/CLAUDE.md`; update stale path and name references.
- [ ] 7.3 Verify the new `e2e/next-app/CLAUDE.md` (inherited from the move) references its own location correctly — if it referenced `packages/next-test-app/` or `@animus-ui/next-test-app` internally, update.

## 8. Update Assertion Script Internal References

- [ ] 8.1 Read `e2e/next-app/scripts/assert-next-build.sh`; update any self-reference to `packages/next-test-app/` → `e2e/next-app/`.
- [ ] 8.2 Read `e2e/next-app/next.config.ts` (or `.js`); update any path reference to the new location (typically none — next config uses relative paths).

## 9. Verification

- [ ] 9.1 Run `bun install` from repo root; confirm clean install with no errors.
- [ ] 9.2 Run `bun run --filter @animus-ui/next-app build`; confirm build completes (verifies the rename).
- [ ] 9.3 Run `bun run test:next`; confirm it executes the build + assertion pipeline against the new path and filter identifier.
- [ ] 9.4 Run `bun run verify:full` (or `bun run verify` + relevant build/assert tiers if tier structure is in place); confirm green.
- [ ] 9.5 Confirm `packages/_assertions/` builds cleanly via `bun run --filter @animus-ui/assertions build`.
- [ ] 9.6 Grep repo for `packages/next-test-app` and `@animus-ui/next-test-app` — confirm only archived openspec content still references the old path/name.

## 10. CI Validation

- [ ] 10.1 Push branch to remote; observe CI pipeline.
- [ ] 10.2 Confirm all CI jobs pass with the new paths and package name.
- [ ] 10.3 Note: `test:next` is not currently in CI's `verify` job. Its inclusion is out of scope for this change — flag as follow-up if not already queued.

## 11. Post-Merge Follow-Ups (tracked separately, not blockers)

- [ ] 11.1 Queue: add `verify:build:next && verify:assert:next` to CI `verify` job as part of `integration-test-infrastructure`.
- [ ] 11.2 Queue: add CI/lint enforcement of the one-way dependency rule (`packages/* ↛ e2e/*`, `packages/* ↛ legacy/*`, `e2e/* ↛ legacy/*`).
- [ ] 11.3 Queue: decide whether to convert workspaces array to glob (`packages/*`, `e2e/*`) — trivial one-line change when ready.
- [ ] 11.4 Queue: `integration-test-infrastructure` rebase — its tasks 0.1 (bun pin), 1.1–1.4 (e2e/helpers/), 2.1 (e2e/vite-app/), 4.3 (packages/next-test-app path) all need updating to point at the new topology: bun pin is handled here, shared utilities go in `packages/_assertions/src/`, vite-app is still in `e2e/vite-app/` (creation now valid post-this-change), and next-app assertions target `e2e/next-app/`.
