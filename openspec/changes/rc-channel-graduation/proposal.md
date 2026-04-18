## Why

The Animus packages have been iterating on the `0.1.0-next.X` dev-prerelease channel since March 2026 (currently `0.1.0-next.61`) with zero active npm consumers — older consumers died off years ago. The 5-persona API surface audit (session 79) validated that the MVP surface is close to final. We are ready to publish a public RC for evangelism, iterate remaining MVP concerns with breaking-changes allowed, and graduate to `1.0.0` stable with a commitment to patches-only for a stabilization window.

Three concrete forcing functions make this a single change:
1. The CI publish pipeline hardcodes "any prerelease → `next` dist-tag" (`.github/workflows/ci.yaml:180-184`). Publishing `1.0.0-rc.0` today would overwrite the `next` dist-tag pointer, colliding with dev prereleases.
2. Two pre-RC API-surface items — `SystemBuilder.includes()` (a no-op stub) and keyframes-via-selector-key (works but not idiomatic) — need to be resolved before `rc.0` is cut. Under pre-1.0 they were deferrable; under an RC-then-freeze arc they are not.
3. The release script enforces `BRANCH=main`, but `next` is 140 commits ahead of `main`. A merge-to-main decision is a graduation prerequisite, not a nice-to-have.

## What Changes

### Release mechanics
- **CHANGE** CI dist-tag mapping from "any prerelease → `next`" to channel-scoped: version suffix `-rc.N` → `--tag rc`, `-next.N` → `--tag next`. Derived from the semver prerelease identifier, not a string contains-`-` check.
- **ADD** local pre-publish verify gate: `scripts/release.sh` invokes `verify:ci` before commit-tag-push. Currently the script delegates entirely to CI with no local correctness check.
- **ADD** graduation runbook as a single document (`docs/release-runbook.md` or equivalent) covering three flows: cut `rc.0`, iterate `rc.N`, graduate to `1.0.0`.
- **ADD** stale-channel guard to `get_latest_tag`: if the resolved CURRENT comes from a channel other than the one requested via `--channel` (or the default), require explicit channel and refuse to auto-bump. Protects against the `v0.1.1-beta.*` drift tags from 2022 silently becoming the baseline.
- **DECIDE** merge strategy for `next` → `main` (140 commits). Decision captured in design.md; mechanics captured in runbook.
- **DECIDE** CHANGELOG mechanism. Current `CHANGELOG.md` is dead (last entry 2022-01-09, lerna "Version bump only" junk). Either reset the file, append going forward, or auto-generate from conventional commits.
- **DECIDE** `latest` dist-tag policy during the RC period. Publishing `rc.0` does not auto-update `latest` (prereleases don't). Either retarget `latest` to the current `rc.N` for evangelism frictionlessness (unconventional) or leave `latest` stale at `0.1.0-next.1` and direct consumers to `@rc` (semver-pure, higher friction).

### Pre-RC API surface
- **APPLY** `SystemBuilder.includes()` relocation from chain method to constructor arg. Current state: runtime is a no-op at `packages/system/src/SystemBuilder.ts:140-148`, but the method IS load-bearing as a static-analysis marker — `packages/extract/pipeline/discover-packages.ts` regex-parses `.includes([...])` calls to discover external DS packages (see `includes-driven-discovery` spec). Relocation preserves the discovery semantic under a cleaner call-site shape; the `discover-packages.ts` regex and the `includes-driven-discovery` spec scenarios must update together. DELETE is not viable — it would remove the multi-package DS consumption model.
- **APPLY** keyframes idiomacy. Current state: works via `createGlobalStyles({ "@keyframes foo": {...} })` structured selector form with full prop-config resolution. Idiomacy gap: string-keyed name, no typed reference. Decision (D6 refined 2026-04-17 after 5-persona panel review + KWATZ): add top-level `keyframes()` factory returning a branded **collection** of typed `KeyframeRef`s (one per named keyframe). Distributed authoring (any file, any package). Extraction-time binding substitution (Rust) resolves `motion.ember` references in component styles to static names at emit time — task 3.6 moves from "deferred" to "in scope". Frame body vocabulary narrows to CSS + `{scale.key}` token refs (no bare scale keys). Structured form remains supported in parallel.

### Graduation commitment
- **ADD** stabilization-window contract: after graduating to `1.0.0`, commit to patches-only (no minor/major) for a defined window. Strictness (strict patches-only vs. loose cooling-off) and duration captured in design.md; documented in runbook.

## Capabilities

### New Capabilities
- `rc-graduation-runbook`: Single document prescribing the three operational flows (cut rc.0, iterate rc.N, graduate to 1.0.0). Codifies channel selection, dist-tag consequences, verify gate invocation, and post-graduation stabilization commitment. Referenced by `release-workflow` spec.

### Modified Capabilities
- `release-workflow`: CI publish alignment requirement (currently pins "any prerelease → `next`") is modified to channel-scoped dist-tag derivation. Adds local pre-publish verify gate requirement and stale-channel guard requirement.
- `system-builder`: `includes()` relocated from builder chain method to `createSystem({ includes })` constructor argument. The current runtime is a no-op because the mechanism is a static-analysis marker consumed by the extraction pipeline (see `includes-driven-discovery`) — relocation preserves the extraction behavior, just under a cleaner call-site shape.
- `includes-driven-discovery`: AST detection pattern updated from chain-method form (`.includes([...])`) to constructor-argument form (`createSystem({ includes: [...] })`). The `discover-packages.ts` parser must learn the new pattern. Migration path: support both patterns briefly during RC iteration, hard-cut to constructor form before graduation.
- `global-styles-system`: Keyframes idiomacy — adds typed top-level `keyframes()` collection factory returning branded `KeyframeRef`s per named keyframe. Frame body vocabulary narrows to CSS + `{scale.key}` token refs (no bare scale keys) because the factory is not system-bound. Extraction-time binding substitution (Rust) resolves `collection.name` member-expression references in component styles to static names. Structured `@keyframes` selector form remains supported.

## Impact

**Code affected:**
- `scripts/release.sh` — verify-gate invocation, stale-channel guard in `get_latest_tag`
- `.github/workflows/ci.yaml` — channel-scoped dist-tag derivation (lines 180-184 area)
- `packages/system/src/SystemBuilder.ts` — `includes()` relocation from chain method to constructor arg
- `packages/extract/pipeline/discover-packages.ts` — regex update to parse `createSystem({ includes: [...] })` constructor-arg pattern (currently parses `.includes([...])` chain form)
- `packages/showcase/src/ds.ts:647` — migrate existing `.includes([testDs])` call site to constructor-arg form
- `packages/system/src/keyframes.ts` — refactor from single-branded-block to branded-collection-of-refs shape (per D6 refinement)
- `packages/extract/src/system_loader.rs` — update `extract_keyframes_blocks` to walk the collection's `__frames` record and emit one block per named keyframe (currently expects single-block shape)
- `packages/extract/src/` — implement extraction-time binding substitution for `motion.ember`-style references in component styles (task 3.6 — was deferred, now in scope)
- `packages/extract/src/theme_resolver.rs` — existing `resolve_keyframes_block` reused (no change)
- `packages/vite-plugin/src/index.ts`, `packages/next-plugin/src/plugin.ts` — no structural change; collection-shape discovery reads through SerializedConfig-adjacent keyframesBlocksJson threading already in place
- `CHANGELOG.md` — reset/append/auto decision
- `docs/` or `openspec/` — new runbook location

**APIs affected (public surface):**
- `createSystem()` / `SystemBuilder.includes()` — narrowing
- `createGlobalStyles` — structured `@keyframes` form unchanged
- `keyframes` (new top-level export) — branded collection factory returning `Keyframes<Map>` (record of `KeyframeRef<Name>` per named key)
- `ThemedCSSProps.animationName` — widened to accept `KeyframeRef<string> | string`

**Consumers affected:** Zero active npm consumers. `e2e/next-app` and `packages/showcase` are the only in-tree consumers and will be updated as part of the change.

**Dependencies:** No new external dependencies.

**Out of scope (explicit):**
- Multi-system composition IMPLEMENTATION. Only decides API location/shape of `includes()`.
- New 1.1.0 features.
- Mutative git operations (CLAUDE.md §1 forbids tag deletion). The `v0.1.1-beta.*` drift tags from 2022 are tolerated via release-script guards, not removed.
- Rewriting existing published prereleases on npm.
