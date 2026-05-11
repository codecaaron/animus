## Context

The monorepo has grown from 3 published TS packages (core, theming, ui) to include a Rust NAPI extraction crate, a Vite plugin, a runtime shim, and a showcase app. The root `package.json` scripts were written for the original 3-package era and never updated. The build dependency graph is:

```
extract (Rust/NAPI) ─────────────────────┐
                                          ├──→ vite-plugin
core ──→ theming ──→ ui                   │
  │                                       │
  └──→ runtime                            │
  └───────────────────────────────────────┘
```

The showcase app depends on everything (vite-plugin + core + theming + runtime) and serves as the integration smoke test.

Two packages (vite-plugin, runtime) reference `tsdown` in their build scripts but have no `tsdown.config.ts`, meaning they silently use tsdown defaults instead of the shared base config.

## Goals / Non-Goals

**Goals:**
- Single command (`bun run verify`) that validates the entire project from scratch
- Granular build commands for common workflows (e.g., "just rebuild the Rust crate")
- Clean command that wipes all artifacts to a known-good state
- Fix missing tsdown configs for vite-plugin and runtime
- Encode the build DAG explicitly so no tribal knowledge is needed

**Non-Goals:**
- Adding turbo, nx, or any task orchestration tool (bun scripts are sufficient for this repo size)
- CI/CD pipeline (separate concern, this is local developer workflow)
- Watch mode / dev mode coordination (existing `vite dev` in showcase handles this)
- Publishing/release automation

## Decisions

### Decision 1: Flat script namespace with colon-separated grouping

Scripts use `verb:scope` naming: `build:extract`, `build:ts`, `build:all`, `test:canary`, `test:showcase`.

**Why over alternatives:**
- Nested scripts (turbo pipeline) — rejected per bun-workspace spec, no orchestration tools
- Individual `bun run --filter` calls — too verbose for common operations, doesn't encode ordering
- Makefile — adds another tool; bun scripts are sufficient and colocated with the project

### Decision 2: Sequential `&&` chains for build ordering, not parallel

`build:all` runs stages sequentially: `build:extract && build:ts`. Within `build:ts`, packages run in dependency order via `--filter` chains.

**Why not parallel:** The DAG has real dependencies — vite-plugin imports from core and extract. Parallel builds would race. Bun's `--filter` doesn't support topological ordering. The total build time is dominated by the Rust crate (~15s release), so parallelizing TS builds (~1s each) saves negligible time.

### Decision 3: `verify` replaces the existing `verify` script

The current `verify` only does `compile && check` (typecheck + biome). The new `verify` runs the full pipeline: `clean && build:all && test && compile && check`. This is a breaking change to the script's behavior but aligns with what "verify" should mean.

**Why not a new name:** `verify` IS the right name. Partial verification is worse than no verification — it gives false confidence. The old behavior is covered by `compile` and `check` individually.

### Decision 4: Showcase build as integration smoke test

`test:showcase` runs `bun run --filter './packages/showcase' build`. If the showcase app builds, the entire extraction pipeline is working end-to-end: Rust crate → Vite plugin → theme evaluation → CSS extraction → React components.

**Why not a dedicated integration test:** The showcase app IS the integration test. It exercises the real consumer API path. A separate integration test would be a weaker copy of what showcase already validates.

### Decision 5: tsdown configs for vite-plugin and runtime use shared base

Both packages get a `tsdown.config.ts` importing `createConfig()` from the base. Vite-plugin overrides `platform: 'node'` since it runs in Vite's Node process, not the browser.

## Risks / Trade-offs

- **[Risk] `verify` takes ~20-30s** → Acceptable for a "is everything green" check. Granular scripts (`test:canary`, `compile`) exist for faster feedback loops.
- **[Risk] Sequential build is slower than necessary** → At current repo size (8 packages), the difference is ~2-3s. Revisit if package count grows significantly.
- **[Risk] `clean` before `verify` means full rebuild every time** → This is intentional. `verify` is the "I need to be sure" command. For iterative work, use granular scripts.
- **[Risk] Breaking `verify` behavior** → Low impact since the old behavior was incomplete and rarely used as-is.
