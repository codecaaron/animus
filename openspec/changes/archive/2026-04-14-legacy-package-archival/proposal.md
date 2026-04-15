## Why

Five packages — `core`, `theming`, `ui` (aka `@animus-ui/components`), `_docs`, and `runtime` — live in `packages/` but are no longer part of the production dependency graph. They import each other and nothing in the active graph (system, extract, vite-plugin, next-plugin, properties + consumers showcase, next-test-app, test-ds, _integration) imports them. They are a self-contained legacy cluster. Their continued presence in `packages/` conflates "on-disk" with "publishable" and creates grep noise + LLM confusion (e.g., an agent encountering `packages/core/src/` assumes it is part of the active codebase). This change moves them together to a sibling `legacy/` directory at repo root, marking them structurally as "not part of the publish graph."

## What Changes

- **Create `legacy/` directory at repository root**, sibling to `packages/`.
- **Move five package directories** as a unit:
  - `packages/core/` → `legacy/core/`
  - `packages/theming/` → `legacy/theming/`
  - `packages/ui/` → `legacy/ui/`
  - `packages/_docs/` → `legacy/_docs/`
  - `packages/runtime/` → `legacy/runtime/`
- **Mark all moved packages private**. Currently `core`, `runtime`, `theming`, and `ui` have `publishConfig: { access: public }` (verified via `package.json` inspection); `_docs` does not. Strip `publishConfig` from all four and ensure `private: true` is set on every moved package.
- **Remove moved packages from root `package.json` workspaces array**. The array remains explicit (no glob expansion to `legacy/*`) so `bun install` does not resolve legacy packages into the workspace graph. Legacy packages remain browsable and editable on disk; they just don't install or link.
- **Remove references from `release.sh` and `ci.yaml`** publish loops if present. (Current state: `release.sh:22` lists `properties system extract vite-plugin next-plugin` — legacy packages are already absent, confirm no latent references.)
- **Update root `CLAUDE.md`** to document the `legacy/` convention: "packages on disk ≠ publishable. `packages/` is the publish graph. `legacy/` is archived code preserved for reference; do not import, do not build, do not publish."
- **Update `packages/` package-level `CLAUDE.md` files** that reference legacy packages by import path (e.g., if `packages/showcase/CLAUDE.md` mentions `@animus-ui/core` for historical reasons, note its legacy status).
- **Verify no production package imports legacy packages**: run a grep pass and confirm clean separation. (Already verified once during the pre-restructure exploration — no production imports.)

## Capabilities

### New Capabilities
- `legacy-directory-topology`: the `legacy/` directory convention, what qualifies a package for archival, the one-way independence rule (legacy MUST NOT be imported from `packages/` or `e2e/`), workspace-exclusion policy, private-flag requirement, documentation location.

### Modified Capabilities
- `bun-workspace`: the root workspaces array change (remove 5 legacy entries) alters the workspace graph. The existing `bun-workspace` spec describes workspace resolution; this change removes packages from that graph.

## Impact

- **File moves**: 5 directories move from `packages/` to `legacy/`. Git history preserved via `git mv`.
- **Root `package.json`**: `workspaces` array drops `core`, `theming`, `ui` (Wait: `ui` is not currently listed; only `core` and `theming` are in the workspaces array per `package.json:5-15`. `_docs`, `runtime`, `ui` are on-disk but not in the workspaces array today. Confirm and remove only entries actually present.) → Correct scope: remove `packages/core` and `packages/theming` from workspaces; `_docs`, `runtime`, `ui` are already excluded and simply move to `legacy/` on disk.
- **Per-package `package.json` edits** in moved packages: ensure `private: true`; remove `publishConfig.access: public` from `core`, `runtime`, `theming`, `ui` (all four currently have it).
- **Import graph**: unchanged in practice because no production package imports the moved set (verified via grep of `@animus-ui/(core|theming|components|docs|runtime)` across non-node_modules source; all hits are within the legacy cluster, in Rust string fixtures, or in archived openspec content).
- **Scripts**: no changes needed. `release.sh` and `ci.yaml` publish lists do not reference legacy packages.
- **CLAUDE.md (root)**: add `## Legacy Packages` section documenting the convention and the one-way independence rule.
- **CLAUDE.md (per-package)**: minor edits where legacy packages are referenced by path.
- **External consumers**: none — all affected packages are private or already absent from published releases (verified by inspecting `release.sh:22` and `ci.yaml:166,248`).
- **Rediscoverability**: `ls packages/` drops from 14 entries to 9, reducing cognitive load for agents and humans doing initial repo exploration. `legacy/` is self-documenting by its name.
- **Prerequisite for**: `e2e-workspace-topology` — legacy cleanup must land first so the workspaces-array transition (from explicit list to glob-based `packages/*` + `e2e/*`) doesn't accidentally include legacy packages.
