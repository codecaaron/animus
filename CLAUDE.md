# **MANDATORY** RULES

1. Never use mutative git operations

## Workspace Topology

The repository has three top-level directories for code:

- **`packages/`** — publishable libraries (`properties`, `system`, `extract`, `vite-plugin`, `next-plugin`) and deep-internal private workspaces (`_assertions`, `_integration`, `test-ds`, `showcase`). Everything here either ships to npm or is load-bearing for the build/verification pipeline.
- **`e2e/`** — consumer fixture applications whose test surface is "build the whole app, assert against output." Current members: `next-app` (Next.js). Future members may include `vite-app`, etc. Never published.
- **`legacy/`** — archived packages preserved for reference only. Do not install, build, or publish. See § Legacy Packages below for the full catalog.

### One-Way Dependency Rule

Dependencies flow top-down (consumer direction):

- **`e2e/*` MAY import `packages/*`** — fixtures consume the libraries they verify.
- **`packages/*` MUST NOT import `e2e/*`** — libraries cannot depend on their downstream verifiers.
- **Neither `packages/*` nor `e2e/*` may import `legacy/*`** — the active graph must not depend on archived code.

Assertion utilities that need to be importable by both `packages/*` post-build scripts and `e2e/*` fixtures live in `packages/_assertions/` (a `packages/`-resident private package), so imports always flow top-down without crossing the `packages/ ← e2e/` boundary.

No automated enforcement yet — candidate for a future CI grep or lint rule.

## Monorepo Build System

### Package Build Order

`extract` (Rust/NAPI) → `properties` → `system` → `vite-plugin`/`next-plugin` → `showcase`/`next-app`. TS packages use `tsdown && tsc -p tsconfig.build.json`; Rust uses `napi build --platform --release`. See per-package `CLAUDE.md` for details.

### TypeScript Implementations

Two TypeScript implementations are installed concurrently. Each owns a distinct workload:

| Workload | Implementation | Binary | Package | Pinned version | Install |
|---|---|---|---|---|---|
| Type-check (`verify:compile`, `verify:types`) | `tsgo` (TypeScript 7 native preview, Go port) | `node_modules/.bin/tsgo` | `@typescript/native-preview` | `7.0.0-dev.20260421.2` | `bun add -d @typescript/native-preview@7.0.0-dev.20260421.2` |
| Declaration emit (`build:ts` → `tsgo -p tsconfig.build.json`) | `tsgo` (TypeScript 7 native preview, Go port) | `node_modules/.bin/tsgo` | `@typescript/native-preview` | `7.0.0-dev.20260421.2` | (same as above) |

Both workloads now use `tsgo`. The `typescript@6.0.3` package remains installed only to back the ad-hoc `verify:compile:tsc-fallback` parity-check path; it is not on any canonical script.

`@typescript/native-preview` is beta software. A parallel `verify:compile:tsc-fallback` script (per-package `compile:tsc-fallback`) preserves the `tsc`-based type-check path for ad-hoc parity checks during the soak window. Fallback scripts are NOT invoked by any composite orchestrator (`verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`, `verify:vite`); they are removed in a follow-on commit once `tsgo` is verified stable. Declaration-emit parity was gated by `bash scripts/verify/dts-parity.sh` (re-runnable any time both binaries are installed) — verdict: semantic byte-equality across all publishable packages.

### Verification Tiers

This table is the single source of truth for verification commands. Per-package `CLAUDE.md` files MUST NOT duplicate it — they link back here. Every atomic tier fails loud with a readable `ERROR: X missing. Run: Y` message if its upstream artifacts are absent — no tier silently rebuilds upstream. Run the minimum tier set for your change (see Change-Type Map below) rather than defaulting to `verify:full`.

> **Dispatch:** `vp run X` is the canonical and only invocation path for every migrated tier (verify:*, build:*, hygiene). The task graph lives in `vite.config.ts` `run.tasks`. `bun run` continues to work for unmigrated scripts (`clean*`, `dev:showcase`, `test`, `lint`/`format`/`check`/`check:fix`, `release`, `compile`). `bun run <migrated-name>` returns "script not found" by design — there is no transparent alias.

#### Atomic Tiers

| Command | What it covers | Upstream requires | Fails loud when | Typical runtime |
|---|---|---|---|---|
| `vp run verify:lint` | `biome check` (linter + formatter) | `bun install` | lint rule violation or formatter drift | fast |
| `vp run verify:compile` | `tsgo --noEmit` across all packages | `bun install` | type error in any package `src/` | fast |
| `vp run verify:types` | type-contract tests via `tsconfig.test-d.json` | `bun install` | compile-time contract assertion fails | medium |
| `vp run verify:unit:rust` | `cargo test --lib` (debug profile) | Rust toolchain | Rust unit test fails | medium |
| `vp run verify:unit:ts` | `bun test` on `system/__tests__`, `vite-plugin/tests`, `properties/__tests__` | `bun install` | TS unit test fails | fast |
| `vp run verify:hygiene:rust` | `cargo machete` dep-hygiene check on `packages/extract` | `cargo-machete` binary on PATH | unused dep found (or machete missing) | fast |
| `vp run verify:canary` | NAPI boundary snapshot tests | fresh NAPI `.node` binary (mtime > Rust src) | NAPI binary missing or stale | medium |
| `vp run verify:integration` | full pipeline E2E in `packages/_integration/__tests__` | fresh NAPI + fresh `extract/dist/` + fresh `system/dist/` | NAPI or any upstream dist missing/stale | medium |
| `vp run verify:build:next` | Next consumer fixture build | fresh NAPI + fresh `extract/dist/` + fresh `system/dist/` + fresh `next-plugin/dist/` | NAPI or any upstream dist missing/stale | slow |
| `vp run verify:build:showcase` | showcase vite build | fresh NAPI + fresh `extract/dist/` + fresh `system/dist/` + fresh `vite-plugin/dist/` + fresh `properties/dist/` | NAPI or any upstream dist missing/stale | slow |
| `vp run verify:build:vite` | Vite consumer fixture build (`e2e/vite-app`) | fresh NAPI + fresh `extract/dist/` + fresh `system/dist/` + fresh `vite-plugin/dist/` + fresh `properties/dist/` | NAPI or any upstream dist missing/stale | slow |
| `vp run verify:assert:next` | positional assertions on Next build output (TS, via `@animus-ui/assertions`) | `e2e/next-app/.next/` + fresh `_assertions/dist/` | build output missing or assertions dist stale | fast |
| `vp run verify:assert:showcase` | positional assertions on showcase dist (TS, via `@animus-ui/assertions`) | `packages/showcase/dist/` + fresh `_assertions/dist/` | build output missing or assertions dist stale | fast |
| `vp run verify:assert:vite` | positional assertions on Vite fixture dist (TS, via `@animus-ui/assertions`) | `e2e/vite-app/dist/` + fresh `_assertions/dist/` | build output missing or assertions dist stale | fast |

#### Composite Orchestrators

| Command | What it covers | When to use |
|---|---|---|
| `vp run verify` | fast gate: lint + compile + types + unit:ts + unit:rust + canary | inner-loop (no build, no assert, no integration) |
| `vp run verify:full` | `verify` + integration + all build + all assert tiers | full local pipeline proof |
| `vp run verify:ci` | best-effort mirror of CI job order + coverage | simulate CI locally before pushing |
| `vp run verify:next` | `verify:build:next && verify:assert:next` | focused Next consumer proof |
| `vp run verify:showcase` | `verify:build:showcase && verify:assert:showcase` | focused showcase consumer proof |
| `vp run verify:vite` | `verify:build:vite && verify:assert:vite` | focused Vite consumer proof |

> For domain-specific guidance, drill into `packages/<name>/CLAUDE.md` after consulting this table. Per-package files contain build-system details and common-failure patterns that are NOT duplicated at the root.

### Change-Type Map

Authoritative map from edit surface to minimum verification-tier set. Prefer the narrow set over `verify:full` when your change is scoped.

| You changed | Run |
|---|---|
| `packages/system/src/**` | `verify:compile && verify:types && verify:unit:ts` |
| `packages/extract/src/**/*.rs` | `verify:unit:rust && verify:canary && verify:integration` |
| `packages/extract/src/**/*.ts` (NAPI TS binding / pipeline) | `verify:canary && verify:integration` |
| `packages/extract/Cargo.toml` | `verify:hygiene:rust` |
| `.knip.json` | `vp run hygiene` |
| `scripts/hygiene/**` | `bun test scripts/hygiene/delete-unused.test.ts && vp run hygiene` |
| `packages/vite-plugin/src/**` | `verify:compile && verify:integration && verify:showcase && verify:vite` |
| `packages/next-plugin/src/**` | `verify:compile && verify:next` |
| `packages/_assertions/src/**` | `verify:unit:ts && verify:assert:next && verify:assert:showcase && verify:assert:vite` |
| `e2e/vite-app/src/**` | `verify:vite` |
| `packages/showcase/src/**` (code; MDX content excluded — see sidebar) | `verify:showcase` |
| `packages/properties/src/**` | `verify:compile && verify:unit:ts` |
| `packages/_integration/__tests__/**` | `verify:integration` |
| `packages/test-ds/src/**` | `verify:unit:ts && verify:next && verify:showcase` |
| `.github/workflows/ci.yaml`, `scripts/**`, `.tool-versions` | `verify:ci` |
| Broad refactor across multiple surfaces | `verify:full` |

**No verify tier required** for:
- `openspec/**` — use `openspec validate <change>` instead
- MDX content under `packages/showcase/src/content/**`
- Root markdown (`CLAUDE.md`, `README.md`, `docs/**`)

**Ownership rule**: any change introducing a new top-level edit surface (e.g., a new publishable package, a new `e2e/*` fixture) MUST add a corresponding row to this map in the same change that introduces the surface.

### Cache Tiers

`clean:light` — `.vite` + `dist/` (<1s); use when transforms seem stale. `clean:full` — adds Rust `target/` + `.node` binary (30-60s rebuild); use for NAPI errors or "nothing works." `clean` — legacy alias for `dist/` + `target/`.

### Debugging Quick-Ref

Symptom-to-fix table for extraction-pipeline failures: see [`packages/extract/CLAUDE.md`](packages/extract/CLAUDE.md) § Debugging Quick-Ref.

### Key Rules

- **bun for package-management; vp for task orchestration.** `bun install`, `bun.lockb`, `bun run --filter` per-package dispatch all stay bun-side. Migrated tiers (verify:*, build:*, hygiene) dispatch via `vp run X`. Bun version pinned in `.tool-versions` (consumed by CI via `bun-version-file`); never npm/npx.
- **vp env stays disabled.** `vp env use` SHALL NOT be invoked locally or in CI for this repo. `.tool-versions` is the sole bun-version source of truth (vp env injection broke tsdown's `unrun` resolver in PoC session 92). Note: vp v0.1.20 auto-writes `packageManager: bun@1.3.13` to `package.json` on every invocation; this is a known asymmetry with `.tool-versions: bun 1.3.11` — `.tool-versions` remains authoritative for asdf/mise/CI; the `packageManager` field is a corepack hint that we tolerate but do not honor.
- **No React resolve aliases** — they break the extraction transform pipeline.
- **Extraction runs in production AND dev.** Restart the dev server to pick up system changes (buildStart results held in memory).
- **Atomic tiers fail loud, never silently rebuild.** On `ERROR: X missing. Run: vp run build:extract` (or similar), run that command and retry. Tiers never invoke upstream builds themselves.

### Code Hygiene Workflow

End-of-work mutating cleanup at `scripts/hygiene/`. Never CI-invoked. See [`scripts/hygiene/CLAUDE.md`](scripts/hygiene/CLAUDE.md) for cascade architecture (Layers A/B/C/D/D1), verdicts, receipts schema, preconditions, and recovery semantics. Authoritative requirement surface: `openspec/specs/code-hygiene/spec.md`.

## Legacy Packages

`legacy/` holds archived packages preserved for reference only — never installed, built, or published. `packages/*` and `e2e/*` MUST NOT import from `legacy/*` (see § One-Way Dependency Rule). For the catalog of legacy packages, workspace exclusion mechanics, and archived openspec path references, see [`legacy/CLAUDE.md`](legacy/CLAUDE.md).
