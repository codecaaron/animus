## 1. Pre-Move Verification

- [ ] 1.1 Re-run grep `@animus-ui/(core|theming|components|docs|runtime)` across all non-legacy, non-node_modules, non-archive source to re-confirm zero production imports at the time of execution (the earlier verification was at proposal time; this re-runs immediately before the move as a final gate).
- [ ] 1.2 Confirm no `packages/*/package.json` declares a dependency, devDependency, peerDependency, or optionalDependency on `@animus-ui/core`, `@animus-ui/theming`, `@animus-ui/components`, `@animus-ui/docs`, or `@animus-ui/runtime`.
- [ ] 1.3 Check archived openspec content for references to `packages/<legacy-name>/` paths; note any that will show broken paths post-move but MUST remain unchanged as historical record.
- [ ] 1.4 Record baseline: run `bun run verify` (or `bun run verify:full` if the `verification-tier-policy` change is already applied) and confirm green before moving anything.
- [ ] 1.5 **Pre-flip state recording (idempotency)**: before editing any legacy `package.json`, record the current state of `private` and `publishConfig` fields for each of the 5 legacy packages. Makes task 4 re-runnable and provides a before/after diff for review.

## 2. File Moves

- [ ] 2.1 `git mv packages/core legacy/core`
- [ ] 2.2 `git mv packages/theming legacy/theming`
- [ ] 2.3 `git mv packages/ui legacy/ui`
- [ ] 2.4 `git mv packages/_docs legacy/_docs`
- [ ] 2.5 `git mv packages/runtime legacy/runtime`
- [ ] 2.6 Verify `ls packages/` shows 9 entries (no core, theming, ui, _docs, runtime); verify `ls legacy/` shows the 5 moved directories.
- [ ] 2.7 Verify `git status` shows the moves as renames (not add + delete).

## 3. Workspaces Array Update

- [ ] 3.1 Edit root `package.json` `workspaces` array: remove `"packages/core"` and `"packages/theming"` entries.
- [ ] 3.2 Confirm final array has 9 entries: `_integration, extract, next-plugin, next-test-app, properties, showcase, system, test-ds, vite-plugin`.
- [ ] 3.3 Do NOT add `legacy/*` to the workspaces array — legacy is explicitly excluded from the workspace graph.

## 4. Privacy Flips

- [ ] 4.1 Edit `legacy/core/package.json`: confirm `"private": true` is set (already set per inspection — reassert); **remove the `publishConfig` field entirely** (currently `{ "access": "public" }`).
- [ ] 4.2 Edit `legacy/runtime/package.json`: confirm `"private": true`; **remove the `publishConfig` field entirely** (currently `{ "access": "public" }`).
- [ ] 4.3 Edit `legacy/theming/package.json`: confirm `"private": true`; **remove the `publishConfig` field entirely** (currently `{ "access": "public" }`). Do NOT skip this — the proposal originally missed this file; verified it also carries `publishConfig`.
- [ ] 4.4 Edit `legacy/ui/package.json`: confirm `"private": true`; **remove the `publishConfig` field entirely** (currently `{ "access": "public" }`). Do NOT skip this — same as `theming`.
- [ ] 4.5 Verify `legacy/_docs/package.json`: already has `"private": true`, already lacks `publishConfig` per inspection. No edit required but confirm.

## 5. Publish Guard Cross-Check

- [ ] 5.1 Read `scripts/release.sh` line 22 `PACKAGES=(properties system extract vite-plugin next-plugin)`; confirm no legacy names present.
- [ ] 5.2 Read `.github/workflows/ci.yaml` (version bump loop and publish loop — look for package-name iteration); confirm no legacy names present.
- [ ] 5.3 If any cross-reference exists (e.g., comments referencing "core was published as @animus-ui/core"), update to reflect archival.

## 6. Root CLAUDE.md Update

- [ ] 6.1 Add a `## Legacy Packages` section to root `CLAUDE.md` after the `## Monorepo Build System` section.
- [ ] 6.2 In that section, state: `legacy/` sits at repo root as a sibling to `packages/`; packages there are preserved for reference only; they do not install, build, or publish.
- [ ] 6.3 State the one-way independence rule: `packages/*` and `e2e/*` MUST NOT import from `legacy/*`.
- [ ] 6.4 List the five current legacy packages with their former published names.
- [ ] 6.5 Note the `cd legacy/<pkg> && bun install` footgun: legacy `package.json`s have `workspace:*` cross-references to each other that no longer resolve (since legacy is excluded from the workspace graph). Document this as expected — `bun install` inside a legacy package will fail, and that is the intended signal. Running/installing/building legacy code is not supported post-archival.

## 7. Tooling Leakage Prevention

- [ ] 7.1 Update `biome.json` to exclude `legacy/**` from linting: add `"!legacy/**"` to the top-level `files.includes` array (or equivalent exclusion mechanism).
- [ ] 7.2 Remove the two dead `packages/_docs/...` override entries in `biome.json` (currently at `packages/_docs/pages/_document.tsx` and `packages/_docs/components/Highlighter/Highlighter.tsx`). After the move, these paths no longer exist and the overrides become dead weight.
- [ ] 7.3 Confirm root `tsconfig.json` does not have an `include` that would pull in `legacy/**` (currently no explicit include — safe, but verify).
- [ ] 7.4 Confirm `scripts/assert-showcase.sh` and any other shell scripts do not reference legacy package paths.

## 8. Per-Package CLAUDE.md Cross-Check

- [ ] 8.1 Read `packages/system/CLAUDE.md`, `packages/extract/CLAUDE.md`, `packages/vite-plugin/CLAUDE.md`, `packages/showcase/CLAUDE.md` for mentions of `@animus-ui/core`, `@animus-ui/theming`, `@animus-ui/components`, `@animus-ui/runtime`; update to note their legacy status where referenced.
- [ ] 8.2 If any per-package CLAUDE.md references `packages/<legacy-name>/` as an active reference point, update to `legacy/<name>/` with a note about archival.
- [ ] 8.3 Do not rewrite archived openspec content; historical references to `packages/<legacy-name>/` are accepted as archival state.

## 9. Legacy Package CLAUDE.md Annotation (optional)

- [ ] 9.1 For each `legacy/<name>/CLAUDE.md` that exists, prepend a one-line warning: `# LEGACY — this package is archived. See root CLAUDE.md § Legacy Packages.`
- [ ] 9.2 If a legacy package has no CLAUDE.md, do not create one — archival state does not require new documentation.

## 10. Post-Move Verification

- [ ] 10.1 Run `bun install` from repo root; confirm clean install with no errors.
- [ ] 10.2 Regenerate `bun.lock` if needed (`rm -rf node_modules && bun install`) to clear any stale references to `@animus-ui/core` / `@animus-ui/theming` workspace entries.
- [ ] 10.3 Confirm no symlinks were created under `node_modules/@animus-ui/` for the five archived package names (or if they exist as stale, remove via `rm -rf node_modules && bun install`).
- [ ] 10.4 Run `bun run verify` (or `bun run verify:full` if the `verification-tier-policy` change is already applied); confirm green.
- [ ] 10.5 Run `bun run build:all`; confirm no legacy package appears in build output.
- [ ] 10.6 Run `biome check` locally; confirm `legacy/**` is skipped (no lint errors from archived code).
- [ ] 10.7 Test filter behavior: `bun run --filter @animus-ui/core build` — confirm it reports no matching workspace (verifying legacy exclusion).

## 11. CI Validation

- [ ] 11.1 Push branch to remote; observe CI pipeline.
- [ ] 11.2 Confirm `lint`, `test-rust`, `build-extract`, `verify` jobs pass.
- [ ] 11.3 Confirm no references to legacy package paths appear in CI output.

## 12. Post-Merge Follow-Ups (tracked separately, not blockers)

- [ ] 12.1 File a follow-up item to add a CI grep check (or lint rule) enforcing the one-way independence rule as part of `e2e-workspace-topology` or a later change.
- [ ] 12.2 File a follow-up item to eventually delete legacy packages outright once no test fixtures or archived spec references them (no timeline; this is a long-horizon cleanup).
