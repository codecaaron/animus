# enforce-workspace-topology

## Why

The one-way workspace dependency rule (`e2e/*` may import `packages/*`; `packages/*` must not import `e2e/*`; nothing imports `legacy/*`) currently holds by discipline alone — root CLAUDE.md explicitly flags "No automated enforcement yet — candidate for a future CI grep or lint rule." Exploration confirmed the tree is clean today (zero violations), so enforcement can lock in a green state now, before a violation ever lands.

## What Changes

**Boundary enforcement**
- From: the one-way dependency rule is documentation-only (CLAUDE.md, `legacy-directory-topology`, `e2e-workspace-convention`).
- To: an executable check verifies the rule across its three real vectors — source-level imports crossing top-level boundaries, tsconfig `paths` aliases, and `packages/* → e2e/*` workspace `package.json` dependencies (legacy packages have no `package.json`, so package-name resolution into `legacy/` is structurally impossible; relative paths and aliases are the vectors that matter).
- Reason: undocumented-failure prevention is cheapest while the violation count is zero.
- Impact: non-breaking; additive check that passes on the current tree.

**Verification wiring**
- The check joins the verify surface (tier placement — extending `verify:lint` vs a new atomic tier — is resolved during design once the prototype's runtime is measured) and fails loud with the offending file list, matching the repo's `ERROR: X ... Run: Y` convention.

**CLAUDE.md updates**
- The "No automated enforcement yet" caveat in § One-Way Dependency Rule is replaced with a pointer to the check, and the Change-Type Map gains a row for the new check's edit surface (per the map's ownership rule).

## Capabilities

### New Capabilities
- `arch-workspace-topology`: architectural constraint capability — the one-way dependency rule as executable-check-backed requirements (rg boundary greps, tsconfig alias scan, workspace dependency assertion), the first inhabitant of the `arch-*` namespace.

### Modified Capabilities
- `e2e-workspace-convention`: the one-way dependency rule requirement gains an enforcement scenario — a violation is caught by a named, runnable check rather than review discipline.

## Impact

- New check script under `scripts/` (exact surface decided in design; Change-Type Map row added alongside).
- `vite.config.ts` `run.tasks` — task graph entry for the check's tier placement.
- `CLAUDE.md` — § One-Way Dependency Rule caveat replaced; Change-Type Map row added.
- `openspec/specs/` — `arch-workspace-topology/` added, `e2e-workspace-convention` delta.
- No changes to published package code or runtime behavior; no new dependencies for publishable packages.
