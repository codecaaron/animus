## Why

The Animus packages have been iterating on the `0.1.0-next.X` dev-prerelease channel since March 2026 (currently `0.1.0-next.61`) with zero active npm consumers — older consumers died off years ago. The 5-persona API surface audit (session 79) validated that the MVP surface is close to final. We are ready to publish a public RC for evangelism, iterate remaining MVP concerns with breaking-changes allowed, and graduate to `1.0.0` stable with a commitment to patches-only for a stabilization window.

Two concrete forcing functions make this a single change:

1. The CI publish pipeline hardcodes "any prerelease → `next` dist-tag" (`.github/workflows/ci.yaml:180-184`). Publishing `1.0.0-rc.0` today would overwrite the `next` dist-tag pointer, colliding with dev prereleases.
2. The release script enforces `BRANCH=main`, but `next` is 140 commits ahead of `main`. A merge-to-main decision is a graduation prerequisite, not a nice-to-have.

## What Changes

### Release mechanics

- **CHANGE** CI dist-tag mapping from "any prerelease → `next`" to channel-scoped: version suffix `-rc.N` → `--tag rc`, `-next.N` → `--tag next`. Derived from the semver prerelease identifier, not a string contains-`-` check.
- **ADD** local pre-publish verify gate: `scripts/release.sh` invokes `verify:ci` before commit-tag-push. Currently the script delegates entirely to CI with no local correctness check.
- **ADD** graduation runbook as a single document (`docs/release-runbook.md` or equivalent) covering three flows: cut `rc.0`, iterate `rc.N`, graduate to `1.0.0`.
- **ADD** stale-channel guard to `get_latest_tag`: if the resolved CURRENT comes from a channel other than the one requested via `--channel` (or the default), require explicit channel and refuse to auto-bump. Protects against the `v0.1.1-beta.*` drift tags from 2022 silently becoming the baseline.
- **DECIDE** merge strategy for `next` → `main` (140 commits). Decision captured in design.md; mechanics captured in runbook.
- **DECIDE** CHANGELOG mechanism. Current `CHANGELOG.md` is dead (last entry 2022-01-09, lerna "Version bump only" junk). Either reset the file, append going forward, or auto-generate from conventional commits.
- **DECIDE** `latest` dist-tag policy during the RC period. Publishing `rc.0` does not auto-update `latest` (prereleases don't). Either retarget `latest` to the current `rc.N` for evangelism frictionlessness (unconventional) or leave `latest` stale at `0.1.0-next.1` and direct consumers to `@rc` (semver-pure, higher friction).

### Graduation commitment

- **ADD** stabilization-window contract: after graduating to `1.0.0`, commit to patches-only (no minor/major) for a defined window. Strictness (strict patches-only vs. loose cooling-off) and duration captured in design.md; documented in runbook.

## Capabilities

### New Capabilities

- `rc-graduation-runbook`: Single document prescribing the three operational flows (cut rc.0, iterate rc.N, graduate to 1.0.0). Codifies channel selection, dist-tag consequences, verify gate invocation, and post-graduation stabilization commitment. Referenced by `release-workflow` spec.

### Modified Capabilities

- `release-workflow`: CI publish alignment requirement (currently pins "any prerelease → `next`") is modified to channel-scoped dist-tag derivation. Adds local pre-publish verify gate requirement and stale-channel guard requirement.

## Impact

**Code affected:**

- `scripts/release.sh` — verify-gate invocation, stale-channel guard in `get_latest_tag`
- `.github/workflows/ci.yaml` — channel-scoped dist-tag derivation (lines 180-184 area)
- `CHANGELOG.md` — reset/append/auto decision
- `docs/` or `openspec/` — new runbook location

**APIs affected (public surface):**

- CI publish routing — channel-scoped dist-tag derivation replaces "any prerelease → next" mapping.

**Consumers affected:** Zero active npm consumers.

**Dependencies:** No new external dependencies.

**Out of scope (explicit):**

- New 1.1.0 features.
- Mutative git operations (CLAUDE.md §1 forbids tag deletion). The `v0.1.1-beta.*` drift tags from 2022 are tolerated via release-script guards, not removed.
- Rewriting existing published prereleases on npm.
- Pre-RC API-surface work (keyframes primitive, includes() relocation) — those shipped under `rc-channel-graduation` §§2–3 in code but are covered by downstream capability-scoped change proposals (e.g., `theme-typed-keyframes-binding`) for their spec-history ownership.
