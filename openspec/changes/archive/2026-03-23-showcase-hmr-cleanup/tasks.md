## 1. Theme Augmentation

- [x] 1.1 Add `declare module '@animus-ui/core' { interface Theme extends ShowcaseTheme {} }` to `packages/showcase/src/theme.ts`
- [x] 1.2 Verify showcase builds (Scale types resolve against actual theme)

## 2. Custom Instance Config Export

- [x] 2.1 Added `serializeExtractConfig()` utility to core (reads propRegistry/groupRegistry from any Animus instance). Showcase exports `getExtractConfig = () => serializeExtractConfig(ds)`
- [x] 2.2 Added `configPath` option to Vite plugin. Showcase vite.config uses `configPath: './src/custom-vocabulary.tsx'`

## 3. Showcase Component Consolidation

- [x] 3.1 Rewrite `packages/showcase/src/components.tsx` to use `ds` from `custom-vocabulary.tsx` instead of `animus` from `@animus-ui/core`
- [x] 3.2 Map existing group usage to custom groups: `color`→`surface`, `layout+flex+grid`→`arrange`, `typography`→`text`, `transitions`→`motion`
- [x] 3.3 Verify `bun run test:showcase` passes (Vite build succeeds with all components from custom instance)

## 4. Transform Verification

- [x] 4.1 Verify showcase builds with transforms (gridItemRatio, size, borderShorthand all resolve via custom config path)
- [x] 4.2 Verify canary test passes (serializeExtractConfig produces identical output to old hardcoded version)
- [x] 4.3 Verify `bun run verify` passes (full pipeline green)

## 5. CSS-Only HMR (DEFERRED — separate plugin change)

- [ ] 5.1 Enable extraction in dev mode (currently skipped with `if (!isProd) return`)
- [ ] 5.2 Replace full-reload with CSS module invalidation via `server.moduleGraph.invalidateModule()`
- [ ] 5.3 Add content-hash file cache
- [ ] 5.4 Return invalidated CSS module from `handleHotUpdate`

## 6. Validation

- [x] 6.1 Run `bun run verify` — full pipeline green
- [x] 6.2 Run `bun run test:showcase` — Vite build succeeds
- [ ] 6.3 Manual test: `cd packages/showcase && bun run dev` (DEFERRED — requires HMR)
