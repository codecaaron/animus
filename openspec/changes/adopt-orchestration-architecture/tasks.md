## 1. New capability spec

- [x] 1.1 Author `specs/orchestration-architecture/spec.md` with 11 ADDED requirements (each with explicit scenarios):
  - **Single Orchestrator Surface** — exactly one root orchestrator owns task DAG, content-addressed caching, library packing, app bundling, lint/format/typecheck, test runner; singularity invariant
  - **Designated Orchestrator** — Vite+ (`vp` CLI, https://viteplus.dev) named with version-floor (alpha-or-later), rationale (in-ecosystem with Vite/Vitest/Rolldown/tsdown; bun support shipped; MIT licensed), swap-out criteria
  - **Migration Trigger Criteria** — Vite+ GA OR per-slice maintainer-signed risk-acceptance documented in follow-on `proposal.md`
  - **Loud-Fail Atomic-Tier Preconditions Survive Swap** — `ERROR: <missing/stale>. Run: <command>` shape; preconditions before tier work; non-zero exit; no silent upstream rebuild
  - **Change-Type Map Survives Swap** — root `CLAUDE.md` map's `Run` column updated atomically with each cutover follow-on
  - **Dependency-Derived Build Ordering Survives Swap** — new packages position via `package.json` `dependencies` without editing root orchestrator config
  - **Dist-Staleness Check Pattern Survives Swap** — existence AND mtime-vs-src; stale dist surfaces as precondition failure with rebuild command
  - **Atomic-Tier Isolation Survives Swap** — atomic tiers fail loud with the upstream rebuild command rather than silently invoking it
  - **Rust Pipeline Excluded from Orchestrator Scope** — `cargo` + `@napi-rs/cli` permanent owners; orchestrator MAY orchestrate Rust-tier invocations but SHALL NOT replace the toolchain; permanent boundary, not deferral
  - **Bun Version Pin Survives Swap** — `.tool-versions` authoritative; any orchestrator runtime-selection mechanism respects or layers cleanly; conflict resolved in favor of `.tool-versions`
  - **Follow-On Policy Decomposition** — minimum 5 cutover slices (orchestrator rebind, lint/format/typecheck rebind, library bundler rebind, test runner rebind, cleaning surface rebind); mega-change prohibited

## 2. Add binding requirements to consumer specs (ADDED-only)

- [x] 2.1 `specs/build-orchestration/spec.md` — ADD `Binding to orchestration-architecture`: build DAG / clean / verification-pipeline / granular-test surfaces realized through architecture-designated orchestrator; Rust NAPI step preserves `cargo` + `@napi-rs/cli` ownership; current binding (`bun run build:all` / `build:extract` / `build:ts` / `clean` / `verify`) documented as one valid implementation
- [x] 2.2 `specs/verification-tier-policy/spec.md` — ADD `Binding to orchestration-architecture`: atomic-tier loud-fail contract + `_preconditions.sh` semantics + Change-Type Map authoritativeness + dist-staleness check pattern survive rebind; orchestrator's task body MAY invoke `bash scripts/verify/<tier>.sh` until orchestrator-native hook demonstrably preserves every check
- [x] 2.3 `specs/workspace-build-ordering/spec.md` — ADD `Binding to orchestration-architecture`: dependency-derived ordering invariant + two-tier strategy (fast TS-only `build:ts` / full Rust+TS `build:all`) survive rebind; Rust NAPI step in full tier continues to invoke `cargo` / `napi build`
- [x] 2.4 `specs/code-hygiene/spec.md` — ADD `Binding to orchestration-architecture`: cascade structure (Layer A biome-safe → B biome-unsafe-scoped → C home-roll deleter → D knip) survives linter rebind; layer semantic contracts preserved (A's safe-fix, B's DELETE-only scope, C's intra-file dead-decl coverage, D's cross-file knip pruning); end-of-work-only contract (`bun run hygiene` SHALL NOT appear in `.github/workflows/*.yaml`) invariant under any rebind
- [x] 2.5 `specs/rolldown-build/spec.md` — ADD `Binding to orchestration-architecture`: Rolldown engine identity + ES-module output + `node_modules` externalization + TypeScript declaration emission survive bundler rebind; legacy package-path refresh (current text references `packages/core` / `theming` / `ui` which now live under `legacy/`) deferred to `migrate-build-to-vp-pack` follow-on

## 3. Re-anchor Bun-bound specs (ADDED + MODIFIED)

- [x] 3.1 `specs/bun-workspace/spec.md`:
  - ADD `Binding to orchestration-architecture` — Bun retains package-manager identity and workspace-resolution mechanism (`bun install`, `bun.lockb`, workspace topology); orchestration semantics delegated to architecture-designated orchestrator
  - MODIFY `Bun workspace script execution` — cross-workspace task dispatch owned by the orchestrator designated by `orchestration-architecture` (currently `bun run` / `bun run --filter`); workspace SHALL include `packages/` + `e2e/` and SHALL exclude `legacy/` under any binding
  - MODIFY `No competing orchestration tools` — singularity invariant references the architecture-designated orchestrator; NX/Lerna/Turborepo/Moon (and their config files: `nx.json` / `lerna.json` / `turbo.json` / `moon.yml`) prohibited unless one IS the designated orchestrator per a future rebind change
- [x] 3.2 `specs/bun-test/spec.md`:
  - ADD `Binding to orchestration-architecture` — test-runner contract owned by `orchestration-architecture`; current binding is `bun test`; rebind to a different runner (e.g., Vitest via `vp test`) preserves semantic requirements (snapshot inlining, parameterized fixtures, DOM environment availability) while updating only the invocation surface
  - MODIFY `Bun native test runner` — tests run via the architecture-designated test-runner binding (currently `bun test`); no Jest / `babel-jest` / `jest-environment-jsdom` dependencies SHALL be required under any binding
