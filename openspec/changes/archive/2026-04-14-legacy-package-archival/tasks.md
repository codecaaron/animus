## 1. Pre-Move Verification

- [x] 1.1 Re-run grep `@animus-ui/(core|theming|components|docs|runtime)` across all non-legacy, non-node_modules, non-archive source to re-confirm zero production imports at the time of execution (the earlier verification was at proposal time; this re-runs immediately before the move as a final gate). → VERIFIED: 37 TS/TSX hits are all within legacy packages themselves + `packages/extract/tests/canary.test.ts` Rust fixture strings (not runtime imports). No active package imports legacy.
- [x] 1.2 Confirm no `packages/*/package.json` declares a dependency, devDependency, peerDependency, or optionalDependency on `@animus-ui/core`, `@animus-ui/theming`, `@animus-ui/components`, `@animus-ui/docs`, or `@animus-ui/runtime`. → VERIFIED: only legacy siblings depend on each other (theming→core, ui→core+theming). No active package declares legacy deps.
- [x] 1.3 Check archived openspec content for references to `packages/<legacy-name>/` paths; note any that will show broken paths post-move but MUST remain unchanged as historical record. → NOTED: archive references exist in 2026-03-30-*, 2026-04-03-*, 2026-04-11-* archives; preserved as historical state per decision.
- [x] 1.4 Record baseline: run `bun run verify` (or `bun run verify:full` if the `verification-tier-policy` change is already applied) and confirm green before moving anything. → GREEN: lint + compile + types + unit:ts + unit:rust (254 pass) + canary (192 pass, 4 snapshots) all green pre-move.
- [x] 1.5 **Pre-flip state recording (idempotency)**: before editing any legacy `package.json`, record the current state of `private` and `publishConfig` fields for each of the 5 legacy packages. Makes task 4 re-runnable and provides a before/after diff for review. → RECORDED: core/theming/ui/runtime all have `private:true` + `publishConfig:{access:public}`; _docs has only `private:true` (no publishConfig).

## 2. File Moves

- [x] 2.1 `git mv packages/core legacy/core`
- [x] 2.2 `git mv packages/theming legacy/theming`
- [x] 2.3 `git mv packages/ui legacy/ui`
- [x] 2.4 `git mv packages/_docs legacy/_docs`
- [x] 2.5 `git mv packages/runtime legacy/runtime`
- [x] 2.6 Verify `ls packages/` shows 9 entries (no core, theming, ui, _docs, runtime); verify `ls legacy/` shows the 5 moved directories. → VERIFIED: packages/ = 9 entries (_integration, extract, next-plugin, next-test-app, properties, showcase, system, test-ds, vite-plugin); legacy/ = 5 entries (_docs, core, runtime, theming, ui).
- [x] 2.7 Verify `git status` shows the moves as renames (not add + delete). → VERIFIED: `git status --short` shows `R  packages/<name>/... -> legacy/<name>/...` for all moved files.

## 3. Workspaces Array Update

- [x] 3.1 Edit root `package.json` `workspaces` array: remove `"packages/core"` and `"packages/theming"` entries.
- [x] 3.2 Confirm final array has 9 entries: `_integration, extract, next-plugin, next-test-app, properties, showcase, system, test-ds, vite-plugin`. → VERIFIED.
- [x] 3.3 Do NOT add `legacy/*` to the workspaces array — legacy is explicitly excluded from the workspace graph. → HELD.

## 4. Privacy Flips

- [x] 4.1 Edit `legacy/core/package.json`: confirm `"private": true` is set (already set per inspection — reassert); **remove the `publishConfig` field entirely** (currently `{ "access": "public" }`). → DONE: `private:true` retained, publishConfig block removed.
- [x] 4.2 Edit `legacy/runtime/package.json`: confirm `"private": true`; **remove the `publishConfig` field entirely** (currently `{ "access": "public" }`). → DONE.
- [x] 4.3 Edit `legacy/theming/package.json`: confirm `"private": true`; **remove the `publishConfig` field entirely** (currently `{ "access": "public" }`). Do NOT skip this — the proposal originally missed this file; verified it also carries `publishConfig`. → DONE.
- [x] 4.4 Edit `legacy/ui/package.json`: confirm `"private": true`; **remove the `publishConfig` field entirely** (currently `{ "access": "public" }`). Do NOT skip this — same as `theming`. → DONE.
- [x] 4.5 Verify `legacy/_docs/package.json`: already has `"private": true`, already lacks `publishConfig` per inspection. No edit required but confirm. → CONFIRMED: `_docs` package.json has only `name/version/private:true`. No edit.

## 5. Publish Guard Cross-Check

- [x] 5.1 Read `scripts/release.sh` line 22 `PACKAGES=(properties system extract vite-plugin next-plugin)`; confirm no legacy names present. → VERIFIED.
- [x] 5.2 Read `.github/workflows/ci.yaml` (version bump loop and publish loop — look for package-name iteration); confirm no legacy names present. → VERIFIED: version-bump loop (ci.yaml:180) = `properties system extract vite-plugin next-plugin`; publish loop (ci.yaml:262) = `properties system vite-plugin next-plugin`. No legacy names.
- [x] 5.3 If any cross-reference exists (e.g., comments referencing "core was published as @animus-ui/core"), update to reflect archival. → NONE FOUND in scripts or CI.

## 6. Root CLAUDE.md Update

- [x] 6.1 Add a `## Legacy Packages` section to root `CLAUDE.md` after the `## Monorepo Build System` section.
- [x] 6.2 In that section, state: `legacy/` sits at repo root as a sibling to `packages/`; packages there are preserved for reference only; they do not install, build, or publish.
- [x] 6.3 State the one-way independence rule: `packages/*` and `e2e/*` MUST NOT import from `legacy/*`.
- [x] 6.4 List the five current legacy packages with their former published names.
- [x] 6.5 Note the `cd legacy/<pkg> && bun install` footgun: legacy `package.json`s have `workspace:*` cross-references to each other that no longer resolve (since legacy is excluded from the workspace graph). Document this as expected — `bun install` inside a legacy package will fail, and that is the intended signal. Running/installing/building legacy code is not supported post-archival. → NOTE: also updated Package Build Order to reflect post-archival active chain (extract → properties → system → plugins → consumers) and absorbed the prior inline legacy note.

## 7. Tooling Leakage Prevention

- [x] 7.1 Update `biome.json` to exclude `legacy/**` from linting: add `"!legacy/**"` to the top-level `files.includes` array (or equivalent exclusion mechanism). → DONE.
- [x] 7.2 Remove the two dead `packages/_docs/...` override entries in `biome.json` (currently at `packages/_docs/pages/_document.tsx` and `packages/_docs/components/Highlighter/Highlighter.tsx`). After the move, these paths no longer exist and the overrides become dead weight. → DONE.
- [x] 7.3 Confirm root `tsconfig.json` does not have an `include` that would pull in `legacy/**` (currently no explicit include — safe, but verify). → CONFIRMED: no explicit `include`; `exclude: ["**/node_modules"]` only.
- [x] 7.4 Confirm `scripts/assert-showcase.sh` and any other shell scripts do not reference legacy package paths. → CONFIRMED: assert-showcase.sh only references `packages/showcase/dist`; verify scripts reference only active packages.

## 8. Per-Package CLAUDE.md Cross-Check

- [x] 8.1 Read `packages/system/CLAUDE.md`, `packages/extract/CLAUDE.md`, `packages/vite-plugin/CLAUDE.md`, `packages/showcase/CLAUDE.md` for mentions of `@animus-ui/core`, `@animus-ui/theming`, `@animus-ui/components`, `@animus-ui/runtime`; update to note their legacy status where referenced. → DONE: system/CLAUDE.md architecture section rewritten (stale "re-exports from core" claim removed; Relationship table replaced with actual runtime edges incl. properties + plugins; legacy row added); showcase/CLAUDE.md two `@animus-ui/core` contrast-refs annotated with legacy pointer; extract + vite-plugin clean.
- [x] 8.2 If any per-package CLAUDE.md references `packages/<legacy-name>/` as an active reference point, update to `legacy/<name>/` with a note about archival. → DONE: system/CLAUDE.md `core/src/Animus.ts` → `packages/system/src/Animus.ts` (actual post-restructure location — the class hierarchy is in system now, not core).
- [x] 8.3 Do not rewrite archived openspec content; historical references to `packages/<legacy-name>/` are accepted as archival state. → HELD.

## 9. Legacy Package CLAUDE.md Annotation (optional)

- [x] 9.1 For each `legacy/<name>/CLAUDE.md` that exists, prepend a one-line warning: `# LEGACY — this package is archived. See root CLAUDE.md § Legacy Packages.` → DONE for `legacy/core/CLAUDE.md` and `legacy/theming/CLAUDE.md` (the only two extant).
- [x] 9.2 If a legacy package has no CLAUDE.md, do not create one — archival state does not require new documentation. → HELD: `legacy/ui`, `legacy/_docs`, `legacy/runtime` have no CLAUDE.md; none created.

## 10. Post-Move Verification

- [x] 10.1 Run `bun install` from repo root; confirm clean install with no errors. → DONE: `Saved lockfile; 2 packages removed [109ms]` — exactly the 2 legacy workspace entries (`@animus-ui/core`, `@animus-ui/theming`) removed. No errors.
- [x] 10.2 Regenerate `bun.lock` if needed (`rm -rf node_modules && bun install`) to clear any stale references to `@animus-ui/core` / `@animus-ui/theming` workspace entries. → NOT REQUIRED: plain `bun install` auto-updated the lockfile; `grep -c '@animus-ui/(core|theming|components|runtime|docs)' bun.lock` → 0.
- [x] 10.3 Confirm no symlinks were created under `node_modules/@animus-ui/` for the five archived package names (or if they exist as stale, remove via `rm -rf node_modules && bun install`). → VERIFIED: `ls node_modules/@animus-ui/` → `showcase` only. No legacy names present.
- [x] 10.4 Run `bun run verify` (or `bun run verify:full` if the `verification-tier-policy` change is already applied); confirm green. → 10/11 tiers GREEN: lint + compile + types + unit:ts + unit:rust (254) + canary (192, 4 snapshots — inline snapshot in "snapshot: real doc site" describe regenerated after path update, see §addendum below) + integration + build:next + build:showcase + assert:showcase. Only `verify:assert:next` fails, exactly matching the pre-existing §11.8 `@layer base`/`@layer variants` gap documented in the archived `verification-tier-policy` change — 5 of 7 next-assert checks pass; 2 fail on the same @layer presence checks unrelated to this change.
- [x] 10.5 Run `bun run build:all`; confirm no legacy package appears in build output. → DONE (covered by verify:full's build tiers): build:extract + build:ts ran across the 9 active workspaces; no legacy names in build output.
- [x] 10.6 Run `biome check` locally; confirm `legacy/**` is skipped (no lint errors from archived code). → DONE: `Checked 220 files in 68ms. No fixes applied.` (Down from previous file-count; legacy/** excluded.)
- [x] 10.7 Test filter behavior: `bun run --filter @animus-ui/core build` — confirm it reports no matching workspace (verifying legacy exclusion). → VERIFIED for all 4 legacy publish-names: `@animus-ui/core`, `@animus-ui/theming`, `@animus-ui/components`, `@animus-ui/runtime` all return `error: No packages matched the filter`.

### §10 Addendum — canary path fix (consequence of §2 moves, applied under this change)

The `snapshot: real doc site` describe in `packages/extract/tests/canary.test.ts` scanned `packages/_docs/elements|components|pages` and `packages/ui/src/` as its realistic multi-package corpus, and mapped `@animus-ui/components` → `packages/ui/src/index.ts` in its layer5PackageMap. After the §2 moves those paths resolved to empty file sets, so the test extracted 0 components and the inline CSS snapshot assertion failed.

Fix: repointed the dirs array + layer5PackageMap to `legacy/ui/src`, `legacy/_docs/elements`, `legacy/_docs/components`, `legacy/_docs/pages`, `legacy/ui/src/index.ts`. Re-ran `bun test packages/extract/tests/canary.test.ts -u` to regenerate the inline CSS snapshot — class-name hashes are derived from `filename::binding`, so the new `legacy/…` filenames produced new hashes; the CSS structure and component counts are preserved (`components_total ≥ 23` still holds; `components_extracted ≥ 8` still holds). 192 pass / 0 fail / 4 snapshots. The canary's seal is preserved; it now seals the post-archival corpus, which is exactly what this change reframes "the realistic multi-package extraction fixture" to mean.

## 11. CI Validation

- [ ] 11.1 Push branch to remote; observe CI pipeline. → DEFERRED TO MAINTAINER per session-74 "passing on CI" framing — local verify suite (10/11 tiers green + known-gap on verify:assert:next) is sufficient evidence for archive.
- [ ] 11.2 Confirm `lint`, `test-rust`, `build-extract`, `verify` jobs pass. → DEFERRED (see 11.1).
- [ ] 11.3 Confirm no references to legacy package paths appear in CI output. → DEFERRED (see 11.1).

## 12. Post-Merge Follow-Ups (tracked separately, not blockers)

- [ ] 12.1 File a follow-up item to add a CI grep check (or lint rule) enforcing the one-way independence rule as part of `e2e-workspace-topology` or a later change. → QUEUED: belongs to `e2e-workspace-topology` scope.
- [ ] 12.2 File a follow-up item to eventually delete legacy packages outright once no test fixtures or archived spec references them (no timeline; this is a long-horizon cleanup). → QUEUED: long-horizon. Note: canary "real doc site" describe now anchors legacy/ui + legacy/_docs as a permanent fixture — deletion would require either replacing the canary corpus (e.g., with showcase) or removing the describe.
