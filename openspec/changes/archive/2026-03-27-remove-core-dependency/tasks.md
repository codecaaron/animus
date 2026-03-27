## 1. Remove legacy config loading

- [x] 1.1 Remove `configPath`, `config`, `groupRegistry`, `theme`, `themePath` from `AnimusExtractOptions` interface
- [x] 1.2 Remove `loadConfig()` function
- [x] 1.3 Remove `loadTheme()` function
- [x] 1.4 Make `system` option required (removed default `= {}`)
- [x] 1.5 Update buildStart to call `loadSystem()` unconditionally (removed if/else branch)
- [x] 1.6 Update HMR geological reset to only handle system changes (removed isConfigChange/isThemeChange)

## 2. Remove legacy transform resolution

- [x] 2.1 Delete `resolve-transforms.ts`
- [x] 2.2 Remove `resolveTransformPlaceholders()` function from index.ts
- [x] 2.3 Remove `transformRegistry` Map declaration
- [x] 2.4 Remove `applyTransformPlaceholders()` in-process function
- [x] 2.5 Simplify transform resolution in `runAnalysis()` — system resolve script only, raw CSS fallback on failure

## 3. Clean up references

- [x] 3.1 Remove all JSDoc/comment references to `@animus-ui/core` auto-import in vite-plugin
- [x] 3.2 Remove `resolvedConfigPath` and `resolvedThemePath` variables
- [x] 3.3 Audit remaining imports — no transitive core references remain
- [x] 3.4 Update CLAUDE.md — remove legacy configPath/themePath from config example and docs

## 4. Verification

- [x] 4.1 `bun run verify` — 220 tests pass, types clean, biome clean
- [x] 4.2 `bun run verify:showcase` — 273KB JS, 14.5KB CSS, full extraction pipeline
- [x] 4.3 Confirm no `@animus-ui/core` in vite-plugin source (grep)
