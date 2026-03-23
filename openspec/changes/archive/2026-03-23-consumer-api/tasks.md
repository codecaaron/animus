## 1. Export Extract Config from Core

- [x] 1.1 Added `getExtractConfig()` to `packages/core/src/config.ts`
- [x] 1.2 Exported from `packages/core/src/index.ts`
- [x] 1.3 Also exported group objects (color, border, flex, grid, space, layout, typography, shadows, background, positioning, transitions) for custom instances

## 2. Plugin Auto-Config

- [x] 2.1 Plugin auto-imports config from `@animus-ui/core` via bun subprocess when no `config` option provided
- [x] 2.2 `config` and `groupRegistry` options remain as escape hatches

## 3. Plugin Theme Path

- [x] 3.1 Added `themePath?: string` to `AnimusExtractOptions`
- [x] 3.2 Auto-detection checks `src/theme.ts`, `src/theme.js`, `theme.ts`, `theme.js`
- [x] 3.3 Theme evaluation via bun subprocess for .ts files
- [x] 3.4 Refactored `evaluateThemeObject` as pure function in theme-evaluator.ts

## 4. Showcase Simplification

- [x] 4.1 `packages/showcase/vite.config.ts` reduced to 10 lines — zero serialization
- [x] 4.2 Build succeeds with extraction + variable emission
- [x] 4.3 All 91 tests pass (82 canary + 9 evaluator)

## 5. Fixes Applied

- [x] 5.1 Fixed `@animus-ui/core` missing from vite-plugin dependencies (GAP 1)
- [x] 5.2 Fixed `config-serializer.ts` broken subpath import `@animus-ui/core/transforms`
- [x] 5.3 Removed static re-export of config-serializer that caused Node ESM/lodash failure
- [x] 5.4 Fixed `readdirSync` type mismatch (Dirent vs string)
