# **MANDATORY** RULES

1. Never use mutative git operations

## Monorepo Build System

### Package Build Order

```
extract (Rust/NAPI) → core → theming → system → vite-plugin → showcase
```

Deprecated/legacy packages (not in build pipeline): `runtime`, `ui`, `_docs`. `core` and `theming` are legacy — `system` re-exports what consumers need.

All TS packages use `tsdown && tsc -p tsconfig.build.json`. The Rust crate uses `napi build --platform --release`.

### Verification Tiers

This table is the single source of truth for verification commands. Per-package `CLAUDE.md` files MUST NOT duplicate it — they link back here. Every atomic tier fails loud with a readable `ERROR: X missing. Run: Y` message if its upstream artifacts are absent — no tier silently rebuilds upstream. Run the minimum tier set for your change (see Change-Type Map below) rather than defaulting to `verify:full`.

#### Atomic Tiers

| Command | What it covers | Upstream requires | Fails loud when | Typical runtime |
|---|---|---|---|---|
| `bun run verify:lint` | `biome check` (linter + formatter) | `bun install` | lint rule violation or formatter drift | fast |
| `bun run verify:compile` | `tsc --noEmit` across all packages | `bun install` | type error in any package `src/` | medium |
| `bun run verify:types` | type-contract tests via `tsconfig.test-d.json` | `bun install` | compile-time contract assertion fails | medium |
| `bun run verify:unit:rust` | `cargo test --lib` (debug profile) | Rust toolchain | Rust unit test fails | medium |
| `bun run verify:unit:ts` | `bun test` on `system/__tests__`, `vite-plugin/tests`, `properties/__tests__` | `bun install` | TS unit test fails | fast |
| `bun run verify:canary` | NAPI boundary snapshot tests | fresh NAPI `.node` binary (mtime > Rust src) | NAPI binary missing or stale | medium |
| `bun run verify:integration` | full pipeline E2E in `packages/_integration/__tests__` | NAPI binary + `packages/extract/dist/index.mjs` | NAPI stale or extract dist missing | medium |
| `bun run verify:build:next` | Next consumer fixture build | NAPI binary + `packages/extract/dist/` | NAPI stale or extract dist missing | slow |
| `bun run verify:build:showcase` | showcase vite build | NAPI binary + `packages/extract/dist/` | NAPI stale or extract dist missing | slow |
| `bun run verify:assert:next` | positional assertions on Next build output | `packages/next-test-app/.next/` | build output missing | fast |
| `bun run verify:assert:showcase` | positional assertions on showcase dist | `packages/showcase/dist/` | build output missing | fast |

#### Composite Orchestrators

| Command | What it covers | When to use |
|---|---|---|
| `bun run verify` | fast gate: lint + compile + types + unit:ts + unit:rust + canary | inner-loop (no build, no assert, no integration) |
| `bun run verify:full` | `verify` + integration + all build + all assert tiers | full local pipeline proof |
| `bun run verify:ci` | best-effort mirror of CI job order + coverage | simulate CI locally before pushing |
| `bun run verify:next` | `verify:build:next && verify:assert:next` | focused Next consumer proof |
| `bun run verify:showcase` | `verify:build:showcase && verify:assert:showcase` | focused showcase consumer proof |

> For domain-specific guidance, drill into `packages/<name>/CLAUDE.md` after consulting this table. Per-package files contain build-system details and common-failure patterns that are NOT duplicated at the root.

### Change-Type Map

Authoritative map from edit surface to minimum verification-tier set. Prefer the narrow set over `verify:full` when your change is scoped.

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

**No verify tier required** for:
- `openspec/**` — use `openspec validate <change>` instead
- MDX content under `packages/showcase/src/content/**`
- Root markdown (`CLAUDE.md`, `README.md`, `docs/**`)

**Ownership rule**: any change introducing a new top-level edit surface (e.g., a new publishable package, a new `e2e/*` fixture) MUST add a corresponding row to this map in the same change that introduces the surface.

### Cache Tiers

| Command | Removes | Speed | Use when |
|---------|---------|-------|----------|
| `bun run clean:light` | `.vite` cache + `dist/` | Fast (<1s) | Transforms seem stale, styles not updating |
| `bun run clean:full` | Above + Rust `target/` + `.node` binary | Slow (rebuild = 30-60s) | NAPI errors, signature changes, nothing works |
| `bun run clean` | `dist/` + `target/` only | Fast | Legacy, backward compat |

### Debugging Decision Tree

```
Symptom                              → Fix
─────────────────────────────────────────────────────────────
Styles not updating in dev           → Restart dev server
Transforms seem stale                → bun run clean:light
NAPI function errors / wrong arity   → bun run rebuild
`verify:canary` "NAPI stale" error   → bun run build:extract
`verify:*` "dist missing" error      → bun run build:ts (or bun run build:all)
Showcase builds but styles missing   → Check virtual:animus/styles.css in browser devtools
CSS has __TRANSFORM__ placeholders   → Transform subprocess failed — check terminal warnings
"Nothing works"                      → bun run rebuild (nuclear option)
```

### Key Rules

- **bun** is the package manager. Never npm/npx. Version is pinned in `.tool-versions` (also consumed by CI via `bun-version-file`).
- **No React resolve aliases** in vite.config.ts — they break the extraction transform pipeline.
- **Extraction is production AND dev.** The plugin runs in both modes. Dev server holds buildStart results in memory — restart to pick up system changes.
- **Atomic tiers do not silently rebuild.** If a `verify:*` tier fails with an `ERROR: X missing. Run: Y` message, run `Y` and retry the tier. Tiers never invoke their upstream builds themselves.
- See package-level CLAUDE.md files in `system/`, `extract/`, `vite-plugin/`, `showcase/` for detailed per-package guidance.
