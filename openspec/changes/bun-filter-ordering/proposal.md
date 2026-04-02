## Why

The root `build:ts` script is a hand-maintained sequential `&&` chain that must be manually updated every time a package is added or reordered. Adding `@animus-ui/properties` is the immediate trigger, but the underlying problem is that the build order is encoded as a fragile string rather than derived from the dependency graph. Bun workspaces already support topological ordering via `--filter` (fixed in Jan 2025, issue #13239) — we should use it.

## What Changes

- **Replace `build:ts` hand-maintained `&&` chain** with `bun run --filter '*' build` — bun reads `package.json` dependencies and executes in topological order automatically
- **Replace `compile` hand-maintained `&&` chain** with equivalent `--filter` invocation for type-checking
- **Ensure all buildable packages have consistent `build` and `compile` scripts** in their own `package.json` so `--filter` can discover and execute them
- **Skip packages that haven't changed** is NOT in scope — caching is deferred to Vite+ adoption. This change solves ordering only.

## Capabilities

### New Capabilities
- `workspace-build-ordering`: Dependency-aware build orchestration using bun workspace topological ordering

### Modified Capabilities
- `build-orchestration`: Build scripts use `--filter` topological ordering instead of hand-maintained sequential chains
- `build-verification`: Verify scripts updated to use new build orchestration

## Impact

- `package.json` (root) — rewrite `build:ts`, `compile`, and dependent scripts (`verify`, `verify:full`, etc.)
- Individual package `package.json` files — ensure each has a `build` script (some may only have it via tsdown config)
- No code changes, no API changes, no dependency changes
- Legacy packages (`core`, `theming`, `runtime`) need `build` scripts to participate in `--filter` discovery even if they're not actively developed
