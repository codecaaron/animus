## Context

After `legacy-package-archival` lands, `packages/` still conflates three purposes:

1. **Publishable**: `properties, system, extract, vite-plugin, next-plugin` — what ships to npm.
2. **Deep-internal private**: `_integration` (JS↔NAPI integration), `test-ds` (shared test DS), `_assertions` (new — shared assertion utilities), `showcase` (live docs/showcase app).
3. **Consumer fixture apps**: `next-test-app` (currently) — a fully built Next.js app whose purpose is to prove the `next-plugin` extraction pipeline end-to-end against built output.

The third purpose is distinct from the second: consumer fixtures are **whole-app build targets** whose test surface is "build → assert against output," not "run bun test." They exercise the real bundler integration in the real way a consumer would use it. Putting them next to publishable and deep-internal packages makes it structurally ambiguous which category a new entrant belongs to.

A new Vite-based consumer fixture is queued in `integration-test-infrastructure`. Adding it to `packages/` alongside `next-test-app` perpetuates the conflation. Better: carve out `e2e/` now, migrate `next-app`, establish the convention, and let the subsequent work land into clean structure.

The `packages/_assertions/` scaffold is created in this change (without content) because assertion utilities are imported from BOTH `packages/*` post-build scripts (e.g., `scripts/assert-showcase.sh` will eventually call TS utilities) AND `e2e/*` fixtures. If the utilities lived in `e2e/shared/`, then `packages/showcase` post-build would have to import across the one-way boundary. Putting them in `packages/_assertions/` keeps imports flowing top-down (from e2e into packages), which is permitted.

Current state (April 2026, session 72; after `legacy-package-archival`):
- `packages/` contains 9 active workspaces.
- `e2e/` does not exist.
- `packages/next-test-app` has ~7 components, imports from `@animus-ui/test-ds`, has its own `ds.ts`, and has a `scripts/assert-next-build.sh` post-build assertion script.
- Root `package.json` `test:next` script invokes `bun run --filter '@animus-ui/next-test-app' build && bash packages/next-test-app/scripts/assert-next-build.sh`.

## Goals / Non-Goals

**Goals:**
- `e2e/` directory exists at repo root as the home for consumer fixture applications.
- `next-test-app` relocates to `e2e/next-app` with git-rename history preservation.
- `packages/_assertions/` scaffold exists as the shared home for assertion utilities, importable top-down from `e2e/*` into `packages/*`.
- One-way dependency rule is documented: `e2e/*` MAY import `packages/*`; neither imports from `legacy/*`; `packages/*` MUST NOT import from `e2e/*`.
- Root `CLAUDE.md` `## Workspace Topology` section documents the three-directory convention authoritatively.
- Verification tier scripts (`verify:build:next`, `verify:assert:next`) continue to work after the move; they reference the new path.

**Non-Goals:**
- Creating the new Vite-based fixture (`e2e/vite-app`). That is `integration-test-infrastructure`.
- Populating `packages/_assertions/` with actual utilities. Scaffold only.
- Rewriting assertion scripts from shell to TS. Also `integration-test-infrastructure`.
- Adding CI topology changes (separate `verify-e2e` job). Deferred until e2e has enough content to justify parallelization.
- Enforcing the one-way dependency rule via CI check. Queued as follow-up; this change documents the rule but does not automate it.
- Moving `showcase` to `e2e/showcase`. `showcase` is more than a fixture — it is the live documentation surface and has its own publish-adjacent positioning (deployed to Netlify). It stays in `packages/`.

## Decisions

### Decision 1: `e2e/` directory name (not `fixtures/`, `apps/`, `sandboxes/`)

The new top-level directory is named `e2e/`.

**Rationale**: "E2E" (end-to-end) accurately describes the test category — consumer fixture apps test the whole pipeline end-to-end (DS definition → bundler integration → built output → assertions). The alternatives each have specific problems:

- `fixtures/`: too generic. Fixtures can also be test inputs, data files, golden outputs. Reserving the word for whole-app fixtures would be confusing.
- `apps/`: implies runnable/shippable apps. These apps are build-asserted, not shipped.
- `sandboxes/`: matches Panda CSS convention (their `sandbox/` directory has 17 demo apps), but Panda's sandboxes are demos, not test targets. Different purpose.
- `examples/`: suggests user-facing example code. These are internal verification targets.

**Alternatives considered**: all above; `e2e-fixtures/` (too long); `consumer/` (ambiguous).

### Decision 2: `next-app` (not `next-test-app`) as the new directory name

After the move, the directory is `e2e/next-app`, not `e2e/next-test-app`.

**Rationale**: within `e2e/`, every entry is already understood to be a test app. `next-test-app` doubles the redundancy (`test-app` + `e2e/`). Consistent naming for future entries: `e2e/next-app`, `e2e/vite-app`, `e2e/webpack-app` (hypothetical), etc. — bundler-keyed short names.

**Alternatives considered**:
- Keep `next-test-app` for continuity: adds friction on every future reference for unclear benefit.
- `next-fixture`: fine but breaks the "app" naming that communicates "this is a built application."

### Decision 3: `packages/_assertions/` location, not `e2e/assertions/`

The shared assertion utilities workspace lives at `packages/_assertions/`, following the `packages/_*` underscore-prefix convention for internal-not-published.

**Rationale**: assertion utilities are consumed by:
- `scripts/assert-showcase.sh` post-build for `packages/showcase` (when rewritten to TS in `integration-test-infrastructure`)
- `e2e/next-app/scripts/assert-next-build.sh` post-build (when rewritten to TS)
- `e2e/vite-app/scripts/assert-vite-build.sh` (new, in `integration-test-infrastructure`)
- Future post-build assertion scripts for any consumer

Imports must flow top-down: higher-level consumers (`e2e/*`) import from lower-level infrastructure (`packages/*`). If assertions lived in `e2e/assertions/`, then `scripts/assert-showcase.sh` (which belongs to `packages/showcase`'s build) would have to import from `e2e/*` — violating the one-way rule.

Placing in `packages/_assertions/` keeps all imports legal.

**Alternatives considered**:
- `e2e/shared/` or `e2e/assertions/`: breaks one-way rule for `packages/showcase` post-build. Rejected.
- Add to `packages/_integration/src/assertions/`: conflates JS↔NAPI integration-test scope with a shared utility library. `_integration` is for integration tests; `_assertions` is for shared utilities. Separate concerns.
- Standalone unscoped location (e.g., `shared/`): misses the workspace-package benefits (named import `@animus-ui/assertions`, `workspace:*` resolution).

### Decision 4: Scaffold only, no content in this change

`packages/_assertions/` ships with empty `src/index.ts`, standard `tsdown` + `tsc` build scripts, and a minimal `package.json`. No actual assertion utilities yet.

**Rationale**: keep this change tightly scoped to topology. Utilities land in `integration-test-infrastructure` where they're needed for the new Vite-app fixture and the shell→TS assertion script rewrite.

**Alternatives considered**:
- Include initial utilities (e.g., a `layerOrder()` positional assertion): fine but expands scope. Defer.

### Decision 5: Keep workspaces array explicit (no glob conversion yet)

The workspaces array remains an explicit list. Entries for `e2e/next-app` and `packages/_assertions` are added; `packages/next-test-app` is removed.

**Rationale**: glob expansion (`packages/*` + `e2e/*`) is a simpler final state but requires confidence that every directory under those globs is workspace-eligible. In particular, `packages/_graveyard` — if created — would accidentally be included by `packages/*`. Since `legacy-package-archival` already moves legacy out of `packages/`, the glob is safer than before, but explicit listing still avoids the risk of future accidental inclusion.

If the maintainer prefers glob now, this is a one-line change in this same edit. Call-out in Open Questions.

**Alternatives considered**:
- Convert to `["packages/*", "e2e/*"]`: simpler. Weigh against accidental-inclusion risk. Addressed in Open Questions.

### Decision 6: `test:next` script path update + package rename

Root `package.json` script name stays `test:next` (keeps the convenient alias stable). The internal path updates from `packages/next-test-app/scripts/assert-next-build.sh` to `e2e/next-app/scripts/assert-next-build.sh`. Additionally, the package identity renames from `@animus-ui/next-test-app` to `@animus-ui/next-app` so the directory path and package name agree — the `test:next` `--filter` target updates to match.

**Rationale**: keeping `test:next` as a script name avoids churn across CI/local/doc surfaces. Renaming the *package* to match the directory resolves the path↔name mismatch that two independent review personas flagged as a known agent-confusion vector ("is it `bun run --filter @animus-ui/next-app` or `@animus-ui/next-test-app`?"). Package name is an internal concern (the package is private — never published), so the rename cost is one `package.json` edit + root filter update.

**Alternatives considered**:
- Keep `@animus-ui/next-test-app` package identity: preserves zero-friction on import paths (there are none — it's a leaf), but the directory/name mismatch is real friction for filter commands and mental model.
- Rename `test:next` script to `test:next-app` or tier-only `verify:next`: unnecessary churn across documentation and CI for no gain.

### Decision 7: No CI topology change in this commit

CI jobs continue with their existing shape (`lint | test-rust | build-extract → verify → release`). `verify` still runs (with tier structure from `verification-tier-policy` once that change lands). `test:next` is already not in CI (preexisting gap); this change does not add it.

**Rationale**: pure topology change. Adding `test:next` to CI or splitting verify into verify-e2e is a separable concern, rightly owned by `integration-test-infrastructure` when the vite-app fixture needs its own CI coverage.

**Alternatives considered**:
- Add `verify:build:next && verify:assert:next` to CI verify job now: creeps scope. Rejected.

## Risks / Trade-offs

**[Risk] A reference to `packages/next-test-app/` is missed during the path-rename sweep → Mitigation**: grep the repo for the string `next-test-app` and `@animus-ui/next-test-app` before commit. Any orphan reference will surface as a broken test or import at verification time.

**[Risk] `packages/_assertions/` sitting empty is ambiguous — is it abandoned or under construction? → Mitigation**: its CLAUDE.md explicitly says "Scaffold only. Utilities added in `integration-test-infrastructure`." No ambiguity if read.

**[Risk] One-way dependency rule documented but not enforced → Accepted for now**: CI enforcement queued as follow-up. The `verification-tier-policy` change's `verify:compile` tier will surface any actual cross-boundary import as a TS compile error since the paths won't resolve.

**[Risk] Glob conversion question lingers as open → Accepted**: leaving the workspaces array explicit is safe; glob conversion can land in this change (if maintainer prefers) or later. Either way the convention of "only `packages/*` or `e2e/*` paths" is clear.

**[Trade-off] One more top-level directory (`e2e/`) → Accepted**: the cognitive gain (three clear categories) exceeds the cost (one more entry in `ls`).

**[Trade-off] `git mv` creates a large rename in the commit → Accepted**: standard cost of any directory rename. Review is straightforward since the content is unchanged.

## Migration Plan

1. **Pre-check**: confirm `legacy-package-archival` is merged (this change references the one-way independence rule it establishes).
2. **Create `e2e/` directory**: `mkdir e2e` (or let the `git mv` implicitly create it).
3. **Move next-test-app**: `git mv packages/next-test-app e2e/next-app`.
4. **Scaffold `packages/_assertions/`**:
   - Create `packages/_assertions/package.json` with name `@animus-ui/assertions`, `private: true`, minimal build scripts.
   - Create `packages/_assertions/src/index.ts` with an empty export.
   - Create `packages/_assertions/tsconfig.json` and `tsconfig.build.json` following the pattern of other private packages.
   - Create `packages/_assertions/CLAUDE.md` noting scaffold-only status.
5. **Update root `package.json`**: remove `packages/next-test-app` from workspaces; add `e2e/next-app` and `packages/_assertions`. Update `test:next` script path.
6. **Update root `CLAUDE.md`**: add `## Workspace Topology` section.
7. **Sweep references**: grep for `packages/next-test-app` and `@animus-ui/next-test-app`; update remaining occurrences in per-package CLAUDE.md and scripts where appropriate.
8. **Verify locally**: `bun install && bun run verify:full` (using tier structure from `verification-tier-policy` once applied). Expect green.
9. **Push + CI**: confirm all jobs pass.
10. **Merge**.

Rollback: revert the commit. Directory moves and workspace-array edits undo cleanly.

## Open Questions

- **Glob conversion now or later?** Leaning: **later** (keep explicit). Enables a cleaner review and preserves the safety buffer against accidental inclusion. If maintainer prefers glob now, trivial to flip in this change — `"workspaces": ["packages/*", "e2e/*"]` replaces the explicit list.
- **Does `packages/_assertions` need its own initial CLAUDE.md or defer to the assertion-library-focused spec in `integration-test-infrastructure`?** Leaning: minimal CLAUDE.md in this change ("scaffold only, see integration-test-infrastructure for content roadmap"); full CLAUDE.md with library guidance when utilities land.
- **Should `test:next` root script be renamed to align with tier naming (`verify:build:next && verify:assert:next`)?** Leaning: no rename in this change. `test:next` is a convenient composite alias. Tier-named scripts still work; both are available.
- **Should `showcase` also move to `e2e/showcase`?** Leaning: no — `showcase` is more than a fixture; it is deployed, has external consumers (hosted docs), and its build serves double-duty as both verification and product. Keep in `packages/`.
