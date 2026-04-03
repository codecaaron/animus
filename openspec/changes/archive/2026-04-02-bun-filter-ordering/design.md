## Context

The root `package.json` `build:ts` script is a hand-maintained sequential `&&` chain:

```
core → theming → system → test-ds → extract:pipeline → vite-plugin → next-plugin
```

Every new package requires manually editing this string. The `compile` script has the same problem. Bun workspaces support topological ordering via `--filter` (issue #13239 fixed Jan 2025) — we should derive build order from `package.json` dependencies instead of maintaining it manually.

**Key wrinkle:** The repo has a two-tier build strategy. `build:ts` is the fast path (TS only, ~5s). `build:all` includes the Rust NAPI crate (~30-60s). Extract's `build` script includes Rust compilation, but `build:ts` deliberately only runs `build:pipeline` (TS portion). The `--filter` migration must preserve this two-tier distinction.

## Goals / Non-Goals

**Goals:**
- Derive build order from dependency graph instead of hand-maintained strings
- Preserve the fast `build:ts` / full `build:all` distinction
- Keep all existing verification commands working identically
- Make adding new packages require zero root script changes

**Non-Goals:**
- Build caching (deferred to Vite+ adoption)
- Changing what each package builds (just changing orchestration)
- Parallelization (bun `--filter` runs topologically, not in parallel)
- Modifying the Rust crate build process

## Decisions

### 1. Two script tiers via naming convention

Each buildable package gets two optional scripts:
- `build` — the full build (whatever that package needs, including Rust for extract)
- `build:ts` — the TS-only build (tsdown + tsc). Packages that are TS-only can just alias this to `build`.

Root scripts become:
```json
"build:ts": "bun run --filter './packages/*' build:ts",
"build:all": "bun run --filter '@animus-ui/extract' build && bun run --filter './packages/*' build:ts",
"compile": "bun run --filter './packages/*' compile"
```

**Rationale:** `--filter` skips packages that don't have the named script. Packages without `build:ts` (like `_integration`, `_docs`) are naturally excluded. Extract's `build:ts` runs only the pipeline portion. `build:all` runs extract's full Rust build first, then all TS builds.

**Alternative considered:** Exclude extract via `--filter '!@animus-ui/extract'`. Rejected — fragile, requires remembering to update the exclusion pattern for future non-TS packages.

### 2. Package script standardization

| Package | `build:ts` | `build` | `compile` |
|---------|-----------|---------|-----------|
| properties (new) | `tsdown && tsc -p tsconfig.build.json` | = build:ts | `tsc --noEmit` |
| core | `tsdown && tsc -p tsconfig.build.json` | = build:ts | `tsc --noEmit` |
| theming | `tsdown && tsc -p tsconfig.build.json` | = build:ts | `tsc --noEmit` |
| system | `tsdown && tsc -p tsconfig.build.json` | = build:ts | `tsc --noEmit` |
| extract | `tsdown && tsc -p tsconfig.build.json` (pipeline only) | `napi build... && build:ts` | add `tsc --noEmit` |
| vite-plugin | `tsdown && tsc -p tsconfig.build.json` | = build:ts | `tsc --noEmit` |
| next-plugin | `tsdown && tsc -p tsconfig.build.json` | = build:ts | `tsc --noEmit` |
| test-ds | `tsdown && tsc -p tsconfig.build.json` | = build:ts | `tsc --noEmit` |
| showcase | skip (not in pipeline) | `vite build` | `tsc --noEmit` |
| _integration | skip | skip | skip |

Packages that are TS-only: `"build:ts": "tsdown && tsc -p tsconfig.build.json", "build": "bun run build:ts"`.
Extract: `"build:ts": "tsdown && tsc -p tsconfig.build.json", "build": "napi build --platform --release && bun run build:ts"`.
Showcase excluded from `build:ts` filter (it's an app build, not a library build — keep as separate step).

### 3. Verification script updates

```json
"verify": "bun run build:ts && bun run compile && bun test && bun run test:rust && bun run test:types && bun run check",
"verify:full": "bun run build:all && bun test && bun run test:rust && bun run check && bun run test:showcase"
```

These stay structurally the same — `build:ts` and `build:all` just call `--filter` internally now.

### 4. Showcase and next-test-app stay manual

These are app builds, not library builds. They don't participate in the `--filter './packages/*' build:ts` chain. They're invoked explicitly:
```json
"test:showcase": "bun run --filter './packages/showcase' build && ...",
"test:next": "bun run --filter '@animus-ui/next-test-app' build && ..."
```

## Risks / Trade-offs

- **[bun --filter ordering correctness]** → Topological ordering was buggy until Jan 2025 fix. Mitigation: verify with `--dry-run` if available, or add a CI step that asserts build order by checking dist/ timestamps.
- **[Silent script skipping]** → If a package's `build:ts` script is missing or misspelled, `--filter` silently skips it. Mitigation: the `verify` command catches this — if a downstream package fails to build, the missing upstream build surfaces as an import error.
- **[No caching]** → Every `bun run build:ts` rebuilds everything, even if unchanged. Accepted trade-off — caching deferred to Vite+. Build times are currently ~5s for TS-only, acceptable.
