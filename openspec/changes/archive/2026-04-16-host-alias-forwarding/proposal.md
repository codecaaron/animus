# Host Alias Forwarding

## Why

The Rust extraction pipeline resolves imports independently of the host bundler. It handles relative paths and package specifiers, but not tsconfig path aliases (`@admin/*` → `./src/*`). These aliases are already resolved by the host — Vite via `vite-tsconfig-paths` or `resolve.alias`, Next.js via its built-in tsconfig support — but the extraction pipeline doesn't consume that information. Result: `.extend()` provenance chains across aliased imports silently fail, and the child component is extracted without parent styles.

This is not our problem to solve — alias resolution is the host bundler's job. But consuming the host's already-resolved alias map IS our responsibility. The fix is ~30 lines of Rust pattern matching and ~10 lines per plugin adapter.

## What Changes

- Vite plugin reads `config.resolve.alias` from `configResolved` (already merged by whatever alias plugins the user has)
- Next plugin reads `config.resolve.alias` from the webpack config object it already receives
- Both plugins normalize aliases into a shared `{ pattern → target }` JSON shape
- New `path_aliases_json` parameter added to `analyzeProject()` NAPI function
- Rust `resolve_path` closure gains a third branch: relative → **alias expand + known-file probe** → package map
- Alias expansion does simple prefix matching, then probes the known file set with existing extension logic

## Capabilities

### New Capabilities
- `host-alias-forwarding`: Forwarding host-resolved path aliases to the Rust extraction pipeline for cross-file binding resolution

### Modified Capabilities
- `import-resolver`: The binding resolver gains alias-aware resolution between relative and package-map branches

## Impact

- `packages/extract/src/project_analyzer.rs` — `resolve_path` closure gains alias branch, new `expand_alias` helper
- `packages/extract/src/lib.rs` — `analyze_project` gains `path_aliases_json` parameter (13th)
- `packages/vite-plugin/src/index.ts` — `configResolved` extracts and normalizes `config.resolve.alias`
- `packages/next-plugin/src/with-animus.ts` — webpack config callback extracts `config.resolve.alias`
- No new dependencies. No breaking changes. Backwards compatible (empty alias map = current behavior).
