## Why

The Animus monorepo currently mixes publishable packages, deep-internal private packages (`_integration`, `test-ds`, `showcase`), and consumer test apps (`next-test-app`) all under `packages/`. This conflates three distinct purposes: **what ships**, **what verifies the pipeline**, and **what proves consumer-build behavior**. Adding a new consumer test fixture (Vite-based, planned in `integration-test-infrastructure`) into `packages/` continues the conflation and invites accidental additions to the publish graph.

This change introduces `e2e/` as a top-level directory sibling to `packages/` and `legacy/`. Consumer fixture applications (where the test surface is "a whole built app, asserted against positional output") live in `e2e/`. `packages/next-test-app` migrates to `e2e/next-app`. A new `packages/_assertions/` private workspace is scaffolded as the shared home for assertion utilities importable from both `packages/*` post-build scripts and `e2e/*` fixtures. This preserves the one-way dependency rule established in `legacy-package-archival` and prepares a clean home for subsequent integration-test work.

## What Changes

- **Create `e2e/` directory at repository root**, sibling to `packages/`, `legacy/`, `scripts/`, `openspec/`.
- **Migrate `packages/next-test-app` → `e2e/next-app`** via `git mv`. Update:
  - Root `package.json` `workspaces` array: remove `packages/next-test-app`, add `e2e/next-app`.
  - **Rename the package identity** from `@animus-ui/next-test-app` to `@animus-ui/next-app` so directory path and package name agree. Path ≠ name mismatches are a known agent-confusion pattern; two independent reviewers flagged this.
  - Root `package.json` `test:next` script: update path from `packages/next-test-app/scripts/assert-next-build.sh` to `e2e/next-app/scripts/assert-next-build.sh`; update the `--filter` target from `@animus-ui/next-test-app` to `@animus-ui/next-app`.
  - Any per-package `CLAUDE.md` or doc reference to `packages/next-test-app/` → `e2e/next-app/` and `@animus-ui/next-test-app` → `@animus-ui/next-app`.
- **Create `packages/_assertions/` as a new private workspace package** (`@animus-ui/assertions`). Scaffold only — empty `src/index.ts`, `package.json` with `private: true` and `@animus-ui/properties` / `@animus-ui/system` workspace deps as needed, standard `tsdown` + `tsc -p tsconfig.build.json` build scripts. No content; consumers add utilities as they're needed.
- **Register `packages/_assertions/` in workspaces array**. It's a `packages/` inhabitant following the `_` prefix convention (internal, not published).
- **Update root `CLAUDE.md`**: add `## Workspace Topology` section documenting the three-directory convention (`packages/`, `e2e/`, `legacy/`) and the one-way dependency rule (`e2e/*` may import `packages/*`; `packages/*` MUST NOT import `e2e/*`; neither may import `legacy/*`).
- **Update `verification-tier-policy` Change-Type Map and Verification Tier Table** (already in root CLAUDE.md from that change) to reference the new path for next-app: `e2e/next-app` instead of `packages/next-test-app`.
- **No CI topology changes in this change**. `verify:build:next` and `verify:assert:next` tiers continue to run as before, now pointing at the new path.
- **No vite-app fixture creation in this change**. The new Vite-based consumer test app is the subject of the separate `integration-test-infrastructure` change and depends on this topology landing first.

## Capabilities

### New Capabilities
- `e2e-workspace-convention`: what `e2e/` is, what belongs there (consumer fixture applications whose test surface is a whole built app), the one-way dependency rule across `packages/ | e2e/ | legacy/`, the naming convention for `e2e/*` workspaces, documentation location.
- `shared-assertions-scaffold`: the `packages/_assertions/` private workspace purpose (shared assertion utilities for post-build and E2E tests), its `@animus-ui/assertions` package identity, the importability rule (importable from both `packages/*` post-build scripts and `e2e/*` fixtures), scaffold-only initial state.

### Modified Capabilities
- `next-test-app-structure`: the existing spec describes `packages/next-test-app/` structure. This change relocates to `e2e/next-app/`; the spec requirements apply to the new path. Header and references updated.
- `bun-workspace`: workspaces array now includes `e2e/next-app` and `packages/_assertions` entries. The `legacy-package-archival` change already modifies this spec; this change adds to it.

## Impact

- **File moves**: `packages/next-test-app/` → `e2e/next-app/` via `git mv`. History preserved as rename.
- **New directory**: `packages/_assertions/` created with minimal scaffold (package.json, src/index.ts, tsconfig.json, tsconfig.build.json, CLAUDE.md).
- **Root `package.json`**: workspaces array edited (remove one entry, add two entries). `test:next` script path updated.
- **Root `CLAUDE.md`**: new `## Workspace Topology` section.
- **Per-package `CLAUDE.md`** references to `packages/next-test-app/` (if any) updated to `e2e/next-app/`.
- **No source code changes**. Components, tests, and fixtures inside the moved directory are unchanged.
- **No publish-graph changes**. `packages/_assertions` is private; `e2e/next-app` is private.
- **Change-Type Map row** (in root CLAUDE.md, installed by `verification-tier-policy`) for `packages/next-plugin/src/**` path target updates to use `verify:build:next && verify:assert:next` with the understanding that these tiers point at the new `e2e/next-app` location internally.
- **Rediscoverability**: `ls e2e/` shows consumer fixture apps distinctly from publishable packages. Root topology becomes self-explanatory: `packages/` (ships or deeply internal), `e2e/` (consumer proof), `legacy/` (archived).
- **Prerequisite for**: `integration-test-infrastructure` — that change adds `e2e/vite-app` fixture, structural assertion utilities inside `packages/_assertions/src/`, plugin self-verify option, manifest completeness tests, and storedSheets investigation. It assumes this topology exists.
