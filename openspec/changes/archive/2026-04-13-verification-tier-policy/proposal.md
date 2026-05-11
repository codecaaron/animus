## Why

The current verification surface is a monolithic set of composite scripts (`verify`, `verify:full`, `verify:showcase`) that expose no isolation or rediscoverability contract. Agents and humans cannot target a narrow change, cannot rediscover which tier covers what, and have no authoritative map from change-type to verification-set — so they defensively run the slowest pipeline, which adds noise and slows inner-loop dev. This change installs a verification **policy layer** with isolatable tiers, fail-loud upstream-artifact preconditions, and a single rediscoverable surface in root CLAUDE.md.

## What Changes

- **Introduce atomic verification tiers** replacing silent upstream assumptions with explicit fail-loud preconditions. Tier naming convention: `verify:<tier>[:<scope>]` (colon-separated).
- **Atomic tiers**: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`. Each is isolatable; each fails loud if its upstream artifacts are missing (no silent rebuilds).
- **Composite orchestrators**: `verify` (fast gate), `verify:full` (full pipeline), `verify:ci` (best-effort local CI simulation), `verify:next` (build:next + assert:next), `verify:showcase` (build:showcase + assert:showcase).
- **Fail-loud precondition contract**: every tier script begins with a shell precondition that exits with a clear "upstream required: run X" message if its inputs are missing. Shell chosen for parity with existing `assert-*.sh`.
- **Bun version pin**: add `.tool-versions` at repo root; update all 4 `oven-sh/setup-bun@v2` sites in `ci.yaml` to use `bun-version-file: .tool-versions`. Unblocks `verify:ci` as a reliable CI simulation and removes the bun 1.3.12 createRequire regression class.
- **Single source of truth for verification docs**: root CLAUDE.md gains a **Verification Tier Table** (command · what it covers · upstream requires · fails loud when · typical runtime). Per-package CLAUDE.md files MUST NOT duplicate this table — they link back to the root.
- **Change-Type Map in root CLAUDE.md**: 11 canonical rows (table) + sidebar note on non-verify edit surfaces. Authoritative instruction surface for agents picking minimum verification for narrow changes. The initial table:

  | You changed | Run |
  |---|---|
  | `packages/system/src/**` | `verify:compile && verify:types && verify:unit:ts` |
  | `packages/extract/src/**/*.rs` | `verify:unit:rust && verify:canary && verify:integration` |
  | `packages/extract/src/**/*.ts` (NAPI TS binding / pipeline) | `verify:canary && verify:integration` |
  | `packages/vite-plugin/src/**` | `verify:compile && verify:integration && verify:showcase` |
  | `packages/next-plugin/src/**` | `verify:compile && verify:next` |
  | `packages/showcase/src/**` (code; MDX content excluded — see sidebar) | `verify:showcase` |
  | `packages/properties/src/**` | `verify:compile && verify:unit:ts` |
  | `packages/_integration/__tests__/**` | `verify:integration` |
  | `packages/test-ds/src/**` | `verify:unit:ts && verify:next && verify:showcase` |
  | `.github/workflows/ci.yaml`, `scripts/**`, `.tool-versions` | `verify:ci` |
  | Broad refactor across multiple surfaces | `verify:full` |

  Sidebar — **no verify tier required**: `openspec/**` (run `openspec validate` instead), MDX content under `packages/showcase/src/content/**`, root markdown (`CLAUDE.md`, `README.md`, `docs/**`).

  `verify:next` and `verify:showcase` are new composite orchestrators chaining the build + assert tiers for each consumer (defined below).
- **Per-package script policy**: per-package `package.json` scripts remain available as the actual implementation invoked by root orchestrators via `bun run --filter`. They are not the primary human/agent surface — the root table is.
- **BREAKING**: the existing `verify`, `verify:full`, and `verify:showcase` composite scripts change semantics. `verify` becomes the fast gate (no showcase/next builds). `verify:full` gains `verify:integration` and the new build+assert tiers. `verify:showcase` is retained as an alias or removed in favor of `verify:build:showcase && verify:assert:showcase`.

## Capabilities

### New Capabilities
- `verification-tier-policy`: the tier naming convention, atomic vs composite distinction, fail-loud precondition contract, root CLAUDE.md Verification Tier Table as single source of truth, Change-Type Map as authoritative "what to run for what change", `verify:ci` CI-simulation semantics, per-package script referencing policy, and bun version pin via `.tool-versions` + `bun-version-file` CI input.

### Modified Capabilities
<!-- None. Existing specs (build-verification, build-orchestration, bun-workspace) describe build behavior, not the verification policy layer this change introduces. They may be cross-referenced from the new spec but are not modified. -->

## Impact

- **`package.json` (root)**: `scripts` block rewritten. New atomic tier scripts added. Existing `verify` / `verify:full` / `verify:showcase` redefined. `test:next` / `test:showcase` / `test:canary` / `test:rust` / `test:types` either deprecated or aliased onto the new tier names.
- **`.github/workflows/ci.yaml`**: 4 `setup-bun@v2` sites updated to use `bun-version-file: .tool-versions`. No job topology changes.
- **`.tool-versions` (new file, repo root)**: declares bun version for local + CI parity.
- **`CLAUDE.md` (root)**: Verification Tier Table + Change-Type Map sections added; scattered verify-command documentation consolidated here.
- **Per-package `CLAUDE.md` files** (`system/`, `extract/`, `vite-plugin/`, `showcase/`): verify-command documentation stripped and replaced with a link back to root CLAUDE.md.
- **Existing shell/TS assertion scripts** (`scripts/assert-showcase.sh`, `packages/next-test-app/scripts/assert-next-build.sh`): invoked by the new `verify:assert:*` tiers. Scripts themselves unchanged in this change (full TS rewrite happens later in `integration-test-infrastructure`).
- **Agent inner-loop**: the Change-Type Map becomes the primary instruction surface for picking minimum verification. Reduces defensive `verify:full` runs.
- **No source code changes outside scripts and documentation.** No API surface changes to any published package.
- **Prerequisite for**: `legacy-package-archival` and `e2e-workspace-topology` — both adopt the tier contract rather than add more monolithic scripts.
