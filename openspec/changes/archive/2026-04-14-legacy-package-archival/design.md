## Context

Five packages in `packages/` — `core`, `theming`, `ui`, `_docs`, `runtime` — are legacy. The Animus architecture has migrated to a `system` + `extract` + `vite-plugin` + `next-plugin` + `properties` surface (5 publishable packages), plus private consumers (`_integration`, `showcase`, `test-ds`, `next-test-app`). The legacy five are:

- `core`: old emotion-runtime-based CSS-in-JS foundation. Still theoretically viable for emotion-only use cases, but the user (sole author, Staff Engineer) confirmed: "unless you see a reason to maintain the emotion runtime... we should not be publishing them anymore." No reason found.
- `theming`: theme utilities built on `core`. Only consumed by `ui` and `_docs`.
- `ui` (published as `@animus-ui/components`): legacy component library built on `core` + `theming`. Only consumed by `_docs`.
- `_docs`: old documentation app built on `core` + `theming` + `ui`. Superseded by `showcase`.
- `runtime`: production runtime shim stub. Orphan — imported by nothing.

Grep verified (April 2026, session 72): no production package imports any of the five. The Rust string references in `packages/extract/src/*.rs` are external-package resolution fixtures testing the extractor, not runtime dependencies. Archived openspec content references them for historical purposes.

Workspaces-array current state (`package.json:4-16`):
- Listed: `_integration, core, extract, next-plugin, next-test-app, properties, showcase, system, test-ds, theming, vite-plugin` (11 entries)
- NOT listed but on disk: `_docs, runtime, ui` (3 entries — already excluded from workspace resolution; just occupy disk space)

So the scoped removal is **2 entries** (`core`, `theming`) from the workspaces array plus **5 directory moves** on disk.

Publish loops (`release.sh:22`, `ci.yaml:166`, `ci.yaml:248`) list `properties, system, extract, vite-plugin, next-plugin` — legacy packages already absent. No publish-graph cleanup needed.

## Goals / Non-Goals

**Goals:**
- Structurally separate "on-disk code" from "publishable code" by using two top-level directories with distinct semantics.
- Preserve git history for the moved packages via `git mv`.
- Ensure no production package imports legacy (enforced by grep + optional CI check).
- Reduce `ls packages/` surface from 14 to 9 entries, lowering cognitive load for repo exploration.
- Prepare the workspaces array for the future transition to glob expansion (`packages/*` + `e2e/*`) without legacy contamination.
- Keep legacy code browsable and readable — not deleted. Useful for reference, pattern copy, and historical context.

**Non-Goals:**
- Deleting legacy packages. Moving preserves history and browsability. Deletion is a future decision.
- Maintaining the emotion runtime. User explicitly confirmed no reason to keep publishing.
- Refactoring any legacy code. Moves are file-system operations only.
- Addressing other legacy cleanup (e.g., `tmp/` directory, archived docs). Scoped to the five packages.

## Decisions

### Decision 1: Separate `legacy/` directory, not `packages/_legacy/`

`legacy/` sits at the repository root as a sibling to `packages/`, not as a prefixed subdirectory inside `packages/`.

**Rationale**: the user's framing was explicit — "packages on disk or whatever what we're actually going to publish is separate." A sibling directory encodes the separation structurally. An agent doing `ls` at the repo root sees two distinct groups: "the active code" (`packages/`) and "the archived code" (`legacy/`). Putting legacy inside `packages/` would require the underscore-prefix convention (`_legacy`) and still visually associate legacy with the active set.

**Alternatives considered**:
- `packages/_graveyard/`: keeps the prefix convention but buries legacy inside the active directory. Rejected — the whole point is visible separation.
- Delete outright: git history preserves removed files, but browsability requires `git log` archaeology. Rejected — legacy code is useful for reference during the migration window.
- `archive/` directory name: conflates with `openspec/changes/archive/` which has unrelated semantics. Rejected — `legacy/` is unambiguous.

### Decision 2: Move all five as a unit, not piecemeal

Single change, single commit window, all five packages move together.

**Rationale**: piecemeal moves would leave the repo in an ambiguous state (some legacy in `packages/`, some in `legacy/`). The cluster is already self-contained (no production imports), so the blast radius of a unit move is the same as any single move. Unit move is clearer, faster, and eliminates the intermediate ambiguous state.

**Alternatives considered**:
- Move `core` only, see how it goes, then move others: adds PR overhead with no benefit.
- Move `_docs` + `ui` first (easiest, pure UI code), then `core` + `theming` + `runtime` later: same as above, with the added cost of an intermediate state where `ui` imports `core` across the `packages/` ↔ `legacy/` boundary.

### Decision 3: Remove legacy from workspaces array; keep explicit listing

The workspaces array remains an explicit enumeration (not a glob). Removing `core` and `theming` from the array is a targeted edit.

**Rationale**: converting to glob (`packages/*`) is premature — that belongs to `e2e-workspace-topology`, which also adds `e2e/*`. Separating the two changes keeps each review-focused. Explicit enumeration during this change means bun install behavior is predictable: exactly the 9 remaining packages install and symlink.

**Alternatives considered**:
- Convert to `["packages/*"]` in this change: couples legacy removal with the workspace-convention shift. Rejected — separation of concerns, plus legacy would still be pulled in by the glob until moved.
- Include `legacy/*` in workspaces so legacy packages install/link: rejected — defeats the purpose. Legacy code is for reading, not running.

### Decision 4: Move via `git mv`, one mv per directory

Use `git mv packages/X legacy/X` for each of the five. Git tracks this as a rename, preserving history.

**Rationale**: `git mv` is the standard idiom. The alternative (manual `mv` + `git add`) can lose rename detection depending on content similarity thresholds.

**Alternatives considered**:
- `mv` + `git add`: works but requires `git log --follow` to trace history for each file. Rejected — suboptimal DX.

### Decision 5: Privacy flip for all legacy packages with `publishConfig`

Four of the five legacy packages currently have `publishConfig: { access: public }` in their `package.json` — verified by direct inspection: `core`, `runtime`, `theming`, `ui`. Only `_docs` lacks it. This is a latent hazard — if a future release script ever generalized package selection (e.g., "publish everything with `publishConfig.access`"), these four would accidentally publish.

Strip `publishConfig` from all four. Ensure `private: true` is set on every moved package. All five are already `private: true` per inspection, but reassert to be safe.

**Rationale**: defense-in-depth. Explicit publish lists are the primary gate; private flag is the secondary gate. Legacy packages should have both.

**Alternatives considered**:
- Leave `publishConfig` as-is: weak. Rejected.

### Decision 6: No forward-compat symlink or alias

No `packages/core -> legacy/core` symlink. No redirect. If anything imports `@animus-ui/core`, it breaks and that's the intended signal.

**Rationale**: grep verified zero production imports. Any future accidental import should surface as a clear "module not found" error, not a silently resolvable alias.

**Alternatives considered**:
- Symlink for compatibility: hides the boundary crossing. Rejected.

## Risks / Trade-offs

**[Risk] An import of a legacy package is missed by the grep pass → Mitigation**: CI runs `bun install && bun run build:ts` — any unresolvable import fails the build. Additionally, the `verification-tier-policy` tier structure (once in place) catches this via `verify:compile`.

**[Risk] A downstream external consumer depends on `@animus-ui/core` or `@animus-ui/components` → Mitigation**: none needed — user confirmed no publish intent for these. Current `release.sh:22` publish list does not include them, and they have been effectively unpublished for the current release series.

**[Risk] Agents continue to read legacy code and assume it's active → Mitigation**: `legacy/` directory name is self-documenting. Root CLAUDE.md adds an explicit section. Per-package legacy CLAUDE.md files (where present) can add a header warning.

**[Risk] Archived openspec content references `packages/core` paths that no longer exist → Accepted**: archived specs are historical records; broken path references in archives are acceptable. A note in root CLAUDE.md about archive/active divergence is sufficient.

**[Trade-off] Git history requires `--follow` to trace files post-move → Accepted**: standard git cost for any directory rename. `git log --follow legacy/core/src/...` works.

**[Trade-off] The `legacy/` directory grows the repo's top-level surface → Accepted**: one more top-level entry is a small cost for the structural clarity gained.

## Migration Plan

1. **Pre-check**: re-run grep `@animus-ui/(core|theming|components|docs|runtime)` on non-legacy, non-node_modules source. Expect zero production hits.
2. **File moves** (in a single commit):
   - `git mv packages/core legacy/core`
   - `git mv packages/theming legacy/theming`
   - `git mv packages/ui legacy/ui`
   - `git mv packages/_docs legacy/_docs`
   - `git mv packages/runtime legacy/runtime`
3. **Workspaces array edit**: remove `packages/core` and `packages/theming` entries from root `package.json` workspaces array. Result: 9 entries.
4. **Privacy flips**: edit `legacy/core/package.json` and `legacy/runtime/package.json` to remove `publishConfig` and add/confirm `private: true`. Verify `legacy/theming/package.json`, `legacy/ui/package.json`, `legacy/_docs/package.json` already have `private: true`.
5. **Root CLAUDE.md**: add `## Legacy Packages` section documenting the convention and one-way independence rule.
6. **Verify locally**: `bun install && bun run verify` (using tier structure if already landed, else current `verify`) — expect green.
7. **Push to feature branch**: confirm CI green.
8. **Merge**: single commit, atomic.

Rollback: revert the single commit; the five directories return to `packages/` and the workspaces array is restored.

## Open Questions

- **Convert workspaces array to glob now or wait for `e2e-workspace-topology`?** Leaning: wait — this change keeps the array explicit. The topology change does the glob conversion plus `e2e/*` addition together, which is a more coherent review.
- **Should archived openspec content be rewritten to reference `legacy/<pkg>` paths?** Leaning: no — archives are historical; rewriting them muddies history. A one-line note in root CLAUDE.md explaining the archive/active path divergence suffices.
- **Should legacy packages be deleted eventually?** Leaning: not in this change. Deletion is a separate decision tied to when the codebase stops referencing them in any tooling (extraction test fixtures, etc.).
- **Any value in a CI check that fails if `packages/*` imports from `legacy/*`?** Leaning: yes, eventually, as part of the one-way-dependency rule enforcement in `e2e-workspace-topology`. Not in scope for this change, but queue as a follow-up.
