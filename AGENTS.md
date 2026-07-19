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

`extract` (Rust/NAPI) → `properties` → `system` → `vite-plugin`/`next-plugin` → `showcase`/`next-app`. TS packages use `tsdown && tsc -p tsconfig.build.json`; Rust uses `napi build --platform --release`. See per-package `AGENTS.md` for details.

### TypeScript Implementations

Two TypeScript implementations are installed concurrently. Each owns a distinct workload:

| Workload                                                      | Implementation                                | Binary                   | Package                      | Pinned version         | Install                                                      |
| ------------------------------------------------------------- | --------------------------------------------- | ------------------------ | ---------------------------- | ---------------------- | ------------------------------------------------------------ |
| Type-check (`verify:compile`, `verify:types`)                 | `tsgo` (TypeScript 7 native preview, Go port) | `node_modules/.bin/tsgo` | `@typescript/native-preview` | `7.0.0-dev.20260421.2` | `bun add -d @typescript/native-preview@7.0.0-dev.20260421.2` |
| Declaration emit (`build:ts` → `tsgo -p tsconfig.build.json`) | `tsgo` (TypeScript 7 native preview, Go port) | `node_modules/.bin/tsgo` | `@typescript/native-preview` | `7.0.0-dev.20260421.2` | (same as above)                                              |

Both workloads use `tsgo`. `@typescript/native-preview` is beta software. The declaration-emit parity tool `scripts/verify/dts-parity.sh` is retained as re-runnable scaffolding (requires reinstalling `typescript` to compare against `tsgo`).

### Verification Interface

This `AGENTS.md` is the single authoritative contributor interface for verification. Per-package instructions link here and must not duplicate the workflow or diagnostic tables. The task graph lives in `vite.config.ts` under `run.tasks`; invoke migrated tasks with `vp run`, never `bun run <migrated-name>`. `bun run` remains valid for unmigrated scripts such as `dev:showcase`, `test`, `lint`/`format`/`check`/`check:fix`, and `release`.

#### Ordinary Workflows

| Workflow               | Command                                                           | Evidence                                                                                                                                                                               | Explicit exclusions                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root fast              | `vp run verify`                                                   | Lint/format, compile and type contracts, TS/Rust units, strict Clippy, the current-host NAPI canary, and global Worker contracts once                                                  | Does not materialize prerequisites or run parity, integration, Rust dependency hygiene, consumer production builds/assertions/dry-runs, packed proof, or CI's platform matrix                 |
| Root full              | `vp run verify:full`                                              | Materializes v1 NAPI, v2 NAPI, and TS dists; runs the root fast claim; runs every discovered consumer-owner claim; then parity, integration, Rust dependency hygiene, and packed proof | Complete only for the current host: it does not reproduce CI's multi-runner/cross-platform NAPI matrix, credentialed publication, or deployment                                               |
| Package owner          | `vp run @animus-ui/vite-app#verify`                               | The selected owner builds and asserts its production output; Worker owners also perform their credential-free upload dry-run                                                           | Does not materialize shared Rust/TS prerequisites or run root-global source checks and Worker contracts; substitute another supported owner package name as needed                            |
| Fail-closed dependents | `vp run --fail-if-no-match -F '...@animus-ui/vite-plugin' verify` | Complete owner claims for packages selected from current workspace dependency edges                                                                                                    | Does not run unrelated owners or root-global diagnostics; `--fail-if-no-match` catches an empty selection, while the mandatory owner inventory catches a selected package that lacks `verify` |

Every workspace-filtered command must include `--fail-if-no-match`. Do not combine `--filter`/`-F` with `--recursive`; Vite+ treats them as mutually exclusive.

#### Atomic Diagnostics

Atomic diagnostics are narrow, actionable leaves. They never materialize missing upstream artifacts. If one fails with `ERROR: X missing` or a `PREPARE:` line, run the exact remediation it prints, then rerun the diagnostic. Owner claims follow the same fail-loud rule and do not rebuild shared Rust or TS prerequisites.

| Command                                             | What it covers                                                                                                                                                    | Upstream requires                                                                                                      | Fails loud when                                                            | Typical runtime |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------- |
| `vp run verify:lint`                                | `vp lint` + `vp fmt --check` (oxlint + oxfmt)                                                                                                                     | `bun install`                                                                                                          | lint rule violation or formatter drift                                     | fast            |
| `vp run verify:compile`                             | `tsgo --noEmit` across all packages                                                                                                                               | `bun install`                                                                                                          | type error in any package `src/`                                           | fast            |
| `vp run verify:types`                               | type-contract tests via `tsconfig.test-d.json`                                                                                                                    | `bun install`                                                                                                          | compile-time contract assertion fails                                      | medium          |
| `vp run verify:unit:rust`                           | `cargo test --lib` across v1 compatibility, shared loader, and v2 crates (debug profile)                                                                          | Rust toolchain                                                                                                         | Rust unit test fails                                                       | medium          |
| `vp run verify:clippy`                              | `cargo clippy --workspace --all-targets --all-features -- -D warnings` across all active Rust crates                                                              | Rust toolchain with Clippy                                                                                             | any Rust or Clippy warning                                                 | medium          |
| `vp run verify:unit:ts`                             | `bunx vp test run` (Vitest) on `system/__tests__`, `vite-plugin/tests`, `next-plugin/tests`, `properties/__tests__`, `_assertions/__tests__`, `_parity/__tests__` | `bun install`                                                                                                          | TS unit test fails                                                         | fast            |
| `vp run verify:workers:contracts`                   | structural, Worker behavior, and hydration contracts for all four Worker fixtures without production builds                                                       | `bun install`                                                                                                          | root command/task contract or fixture test fails                           | fast            |
| `vp run verify:hygiene:rust`                        | `cargo machete` dep-hygiene check across all active extraction Rust crates                                                                                        | `cargo-machete` binary on PATH                                                                                         | unused dep found (or machete missing)                                      | fast            |
| `vp run verify:canary`                              | NAPI boundary snapshot tests                                                                                                                                      | fresh NAPI `.node` binary (mtime > Rust src)                                                                           | NAPI binary missing or stale                                               | medium          |
| `vp run verify:parity`                              | v2 fresh-process/thread self-check, seam battery, and committed production/development oracle                                                                     | fresh v2 NAPI `.node` + committed parity baselines                                                                     | v2 input/baseline missing, stale, or divergent                             | medium          |
| `vp run verify:integration`                         | full pipeline E2E in `packages/_integration/__tests__`                                                                                                            | fresh NAPI + fresh `extract/dist/` + fresh `system/dist/`                                                              | NAPI or any upstream dist missing/stale                                    | medium          |
| `vp run @animus-ui/next-app#verify:build`           | Next consumer fixture build                                                                                                                                       | fresh NAPI + fresh `extract/dist/` + fresh `system/dist/` + fresh `next-plugin/dist/`                                  | NAPI or any upstream dist missing/stale                                    | slow            |
| `vp run @animus-ui/showcase#verify:build`           | showcase vite build                                                                                                                                               | fresh NAPI + fresh `extract/dist/` + fresh `system/dist/` + fresh `vite-plugin/dist/` + fresh `properties/dist/`       | NAPI or any upstream dist missing/stale                                    | slow            |
| `vp run @animus-ui/vite-app#verify:build`           | Vite consumer fixture build (`e2e/vite-app`)                                                                                                                      | fresh NAPI + fresh `extract/dist/` + fresh `system/dist/` + fresh `vite-plugin/dist/` + fresh `properties/dist/`       | NAPI or any upstream dist missing/stale                                    | slow            |
| `vp run @animus-ui/vinext-app#verify:build`         | Vinext App+Pages Worker production build                                                                                                                          | fresh v1/v2 NAPI + fresh `extract/dist/`, `system/dist/`, `vite-plugin/dist/`, `properties/dist/`, and `test-ds/dist/` | NAPI or any upstream dist missing/stale                                    | slow            |
| `vp run @animus-ui/react-router-app#verify:build`   | React Router v8 SSR Worker production build                                                                                                                       | fresh v1/v2 NAPI + fresh `extract/dist/`, `system/dist/`, `vite-plugin/dist/`, `properties/dist/`, and `test-ds/dist/` | NAPI or any upstream dist missing/stale                                    | slow            |
| `vp run @animus-ui/next-app#verify:assert`          | positional assertions on Next build output (TS, via `@animus-ui/assertions`)                                                                                      | `e2e/next-app/.next/` + fresh `_assertions/dist/`                                                                      | build output missing or assertions dist stale                              | fast            |
| `vp run @animus-ui/showcase#verify:assert`          | positional assertions on showcase dist (TS, via `@animus-ui/assertions`)                                                                                          | `packages/showcase/dist/` + fresh `_assertions/dist/`                                                                  | build output missing or assertions dist stale                              | fast            |
| `vp run @animus-ui/vite-app#verify:assert`          | positional assertions on Vite fixture dist (TS, via `@animus-ui/assertions`)                                                                                      | `e2e/vite-app/dist/` + fresh `_assertions/dist/`                                                                       | build output missing or assertions dist stale                              | fast            |
| `vp run @animus-ui/vinext-app#verify:assert`        | structural assertions on Vinext Worker output (TS, via `@animus-ui/assertions`)                                                                                   | `e2e/vinext-app/dist/` + fresh `_assertions/dist/`                                                                     | build output missing or assertions dist stale                              | fast            |
| `vp run @animus-ui/react-router-app#verify:assert`  | structural assertions on React Router Worker output (TS, via `@animus-ui/assertions`)                                                                             | `e2e/react-router-app/build/` + fresh `_assertions/dist/`                                                              | build output missing or assertions dist stale                              | fast            |
| `vp run @animus-ui/showcase#verify:dry-run`         | credential-free Wrangler validation for Worker `animus`                                                                                                           | `packages/showcase/dist/` + matching app-owned Worker config                                                           | build output missing, Worker identity mismatch, or Wrangler rejects output | fast            |
| `vp run @animus-ui/vite-app#verify:dry-run`         | credential-free Wrangler validation for Worker `animus-vite-canary`                                                                                               | `e2e/vite-app/dist/` + matching app-owned Worker config                                                                | build output missing, Worker identity mismatch, or Wrangler rejects output | fast            |
| `vp run @animus-ui/vinext-app#verify:dry-run`       | credential-free Wrangler validation for Worker `animus-vinext-canary`                                                                                             | `e2e/vinext-app/dist/` + matching app-owned Worker config                                                              | build output missing, Worker identity mismatch, or Wrangler rejects output | fast            |
| `vp run @animus-ui/react-router-app#verify:dry-run` | credential-free Wrangler validation for Worker `animus-react-router-canary`                                                                                       | `e2e/react-router-app/build/` + matching app-owned Worker config                                                       | build output missing, Worker identity mismatch, or Wrangler rejects output | fast            |

For domain-specific failure guidance, drill into `packages/<name>/AGENTS.md` after selecting a workflow or diagnostic here.

### Change-Type Map

This map routes an edit to the smallest sufficient claim plus any source-owned diagnostics. Commands are written in execution order.

| You changed                                                                                               | Run                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/system/src/**`                                                                                  | `vp run verify:compile && vp run verify:types && vp run verify:unit:ts`                                                                                      |
| `packages/extract/src/**/*.rs`                                                                            | `vp run verify:clippy && vp run verify:unit:rust && vp run verify:canary && vp run verify:integration`                                                       |
| `packages/extract/crates/extract-v2/src/**/*.rs`                                                          | `vp run verify:clippy && vp run verify:hygiene:rust && vp run verify:unit:rust && vp run verify:canary && vp run verify:parity && vp run verify:integration` |
| `packages/extract/crates/system-loader/**`                                                                | `vp run verify:clippy && vp run verify:hygiene:rust && vp run verify:unit:rust && vp run verify:canary && vp run verify:parity && vp run verify:integration` |
| `packages/extract/src/**/*.ts` (NAPI TS binding / pipeline)                                               | `vp run verify:compile && vp run verify:canary && vp run verify:integration`                                                                                 |
| `packages/extract/Cargo.toml`                                                                             | `vp run verify:clippy && vp run verify:hygiene:rust && vp run verify:unit:rust`                                                                              |
| `packages/extract/crates/extract-v2/Cargo.toml`                                                           | `vp run verify:clippy && vp run verify:hygiene:rust && vp run verify:unit:rust`                                                                              |
| `packages/_parity/**` (parity harness + corpus)                                                           | `vp run verify:unit:ts && vp run verify:parity`                                                                                                              |
| `.knip.json`                                                                                              | `vp run hygiene`                                                                                                                                             |
| `scripts/hygiene/**`                                                                                      | `bunx vp test run scripts/hygiene/ && vp run hygiene`                                                                                                        |
| `packages/vite-plugin/src/**`                                                                             | `vp run verify:compile && vp run verify:integration && vp run --fail-if-no-match -F '...@animus-ui/vite-plugin' verify`                                      |
| `packages/next-plugin/src/**`                                                                             | `vp run verify:compile && vp run @animus-ui/next-app#verify`                                                                                                 |
| `packages/_assertions/src/**`                                                                             | `vp run verify:unit:ts && vp run --fail-if-no-match -F './e2e/*' -F '!animus-packed-app' -F './packages/showcase' verify`                                    |
| `e2e/next-app/src/**`                                                                                     | `vp run @animus-ui/next-app#verify`                                                                                                                          |
| `e2e/vite-app/**`                                                                                         | `vp run verify:workers:contracts && vp run @animus-ui/vite-app#verify`                                                                                       |
| `e2e/vinext-app/**`                                                                                       | `vp run verify:workers:contracts && vp run @animus-ui/vinext-app#verify`                                                                                     |
| `e2e/react-router-app/**`                                                                                 | `vp run verify:workers:contracts && vp run @animus-ui/react-router-app#verify`                                                                               |
| `packages/showcase/src/**` (code; MDX content excluded — see sidebar)                                     | `vp run @animus-ui/showcase#verify`                                                                                                                          |
| `packages/showcase/wrangler.jsonc`                                                                        | `vp run verify:workers:contracts && vp run @animus-ui/showcase#verify`                                                                                       |
| `packages/properties/src/**`                                                                              | `vp run verify:compile && vp run verify:unit:ts`                                                                                                             |
| `packages/_integration/__tests__/**`                                                                      | `vp run verify:integration`                                                                                                                                  |
| `packages/test-ds/src/**`                                                                                 | `vp run verify:unit:ts && vp run --fail-if-no-match -F '...@animus-ui/test-ds' verify`                                                                       |
| `e2e/packed-app/**` or `scripts/verify/packed.sh`                                                         | `vp run verify:packed`                                                                                                                                       |
| `packages/{properties,system,extract,vite-plugin,next-plugin}/package.json` (deps, peers, exports, files) | `vp run verify:packed`                                                                                                                                       |
| `.github/workflows/ci.yaml`, `scripts/**`, `.tool-versions`                                               | `vp run verify:full`                                                                                                                                         |
| Worker orchestration (`vite.config.ts`, `scripts/verify/**`, root deploy scripts, Worker ignores)         | `vp run verify:full`                                                                                                                                         |
| Broad refactor across multiple surfaces                                                                   | `vp run verify:full`                                                                                                                                         |

**No verify tier required** for:

- `openspec/**` — use `openspec validate <change>` instead
- MDX content under `packages/showcase/src/content/**`
- Root markdown (`AGENTS.md`, `README.md`, `docs/**`)

**Ownership rule**: any change introducing a new top-level edit surface (e.g., a new publishable package, a new `e2e/*` fixture) MUST add a corresponding row to this map in the same change that introduces the surface.

### Cache Tiers

`clean:light` — `.vite` + `dist/` (<1s); use when transforms seem stale. `clean:full` — adds Rust `target/` + `.node` binary (30-60s rebuild); use for NAPI errors or "nothing works." `clean` — legacy alias for `dist/` + `target/`.

### Debugging Quick-Ref

Symptom-to-fix table for extraction-pipeline failures: see [`packages/extract/AGENTS.md`](packages/extract/AGENTS.md) § Debugging Quick-Ref.

### Key Rules

- **bun for package-management; vp for task orchestration; Node 24.18 LTS for repository and Workers builds.** `bun install`, `bun.lock`, `bun run --filter` per-package dispatch all stay bun-side. Migrated tiers (verify:_, build:_, hygiene) dispatch via `vp run X`. Bun version is pinned in `.tool-versions` (consumed by CI via `bun-version-file`); Node is pinned to 24.18.0 in `.tool-versions` (consumed by CI via `node-version-file`) and mirrored in `.node-version` for Cloudflare Workers Builds. Node 24.18.0 satisfies the React Router v8 canary and vp's native TypeScript-strip requirement. `vp run` works on Node 20 (it uses the Vite-bundled loader) but the rest of the vp surface requires Node 22+. Never npm/npx.
- **vp env stays disabled.** `vp env use` SHALL NOT be invoked locally or in CI for this repo. `.tool-versions` is the sole bun-version source of truth (vp env injection broke tsdown's `unrun` resolver in PoC session 92). Note: vp v0.1.20 auto-writes `packageManager: bun@1.3.13` to `package.json` on every invocation; this is a known asymmetry with `.tool-versions: bun 1.3.11` — `.tool-versions` remains authoritative for asdf/mise/CI; the `packageManager` field is a corepack hint that we tolerate but do not honor.
- **Bun ≥1.3.12 `createRequire` bug** — `createRequire(import.meta.url)` matches the `"types"` export condition as runtime, loading `.d.ts` files as JS (returns empty object). Workaround: use a direct relative path (e.g., `require('../../pkg/index.js')`) instead of `require('@scope/pkg')`. ESM `import` is unaffected; only the `createRequire` polyfill is affected. Bun 1.3.11 was last unaffected version.
- **No React resolve aliases** — they break the extraction transform pipeline. Aliasing `react`/`react-dom` forces React to an absolute path outside the package, which disrupts vite's module graph ordering: the transform hook fires and returns correct code, but vite's bundler uses the original untransformed source. Silent failure (zero errors, zero warnings). For React deduplication, use bun workspace hoisting, `package.json` `overrides`, or vite `dedupe` (separate from `resolve.alias`).
- **Extraction runs in production AND dev.** Restart the dev server to pick up system changes (buildStart results held in memory).
- **Atomic tiers fail loud, never silently rebuild.** On `ERROR: X missing. Run: vp run build:extract` (or similar), run that command and retry. Tiers never invoke upstream builds themselves.

### Code Hygiene Workflow

End-of-work mutating cleanup at `scripts/hygiene/`. Never CI-invoked. See [`scripts/hygiene/AGENTS.md`](scripts/hygiene/AGENTS.md) for cascade architecture (Layers A/B/C/D/D1), verdicts, receipts schema, preconditions, and recovery semantics. Authoritative requirement surface: `openspec/specs/code-hygiene/spec.md`.

## Legacy Packages

`legacy/` holds archived packages preserved for reference only — never installed, built, or published. `packages/*` and `e2e/*` MUST NOT import from `legacy/*` (see § One-Way Dependency Rule). For the catalog of legacy packages, workspace exclusion mechanics, and archived openspec path references, see [`legacy/AGENTS.md`](legacy/AGENTS.md).
