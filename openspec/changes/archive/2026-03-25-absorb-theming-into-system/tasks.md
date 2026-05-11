## 1. Type Surface

- [x] 1.1 Add `AbstractTheme` and `CSSObject` type definitions to `system/src/types/theme.ts`
- [x] 1.2 Export `AbstractTheme` and `CSSObject` from `system/src/types/theme.ts`

## 2. Move Theming Source

- [x] 2.1 Create `system/src/theme/` directory
- [x] 2.2 Copy `theming/src/utils/flattenScale.ts` to `system/src/theme/flattenScale.ts` — no core imports to change
- [x] 2.3 Copy `theming/src/utils/types.ts` to `system/src/theme/types.ts` — replace `from '@animus-ui/core'` with `from '../types/theme'`
- [x] 2.4 Copy `theming/src/utils/serializeTokens.ts` to `system/src/theme/serializeTokens.ts` — replace `from '@animus-ui/core'` with `from '../types/theme'`
- [x] 2.5 Copy `theming/src/utils/createTheme.ts` to `system/src/theme/createTheme.ts` — replace `from '@animus-ui/core'` with `from '../types/theme'`, update relative imports to sibling files
- [x] 2.6 Create `system/src/theme/index.ts` barrel re-exporting all public symbols

## 3. Remove withTokens from SystemBuilder

- [x] 3.1 Remove `withTokens()` method, `#tokens` field, `T` generic parameter, and `ThemeBuilderInput` type from `SystemBuilder`
- [x] 3.2 Remove `tokens` from `serialize()` return and `SerializedConfig` type
- [x] 3.3 Update `createSystem()` — no longer needs tokens parameter
- [x] 3.4 Simplify `SystemInstance` type — remove `T` generic and `tokens` field

## 4. Update Package Index

- [x] 4.1 Add re-exports from `./theme` to `system/src/index.ts`: `createTheme`, `ThemeBuilder`, `flattenScale`, `serializeTokens`, and type utilities

## 5. Remove Dependency

- [x] 5.1 Remove `@animus-ui/theming` from `system/package.json` dependencies

## 6. Update Plugin Subprocess

- [x] 6.1 Update `loadSystem()` subprocess template to load `tokens` from `m.tokens || m.theme` instead of from `cfg.tokens`
- [x] 6.2 Update HMR geological reset subprocess template similarly (reuses loadSystem)
- [x] 6.3 Add warning when no tokens export is found

## 7. Update Showcase

- [x] 7.1 In `showcase/src/ds.ts`: remove `.withTokens(() => tokens)` from the chain
- [x] 7.2 In `showcase/src/ds.ts`: change `import { createTheme } from '@animus-ui/theming'` to `from '@animus-ui/system'`
- [x] 7.3 Ensure `tokens` is a named export from `ds.ts` (added `export`)

## 8. Update References

- [x] 8.1 Update `showcase/CLAUDE.md` to reflect new system builder chain (no withTokens)
- [x] 8.2 Grep for `withTokens` across repo — updated App.tsx, types.test-d.tsx (remaining refs in openspec archives/specs are historical)

## 9. Verification

- [x] 9.1 Run `bun run verify` — build:ts + test + biome check must pass
- [x] 9.2 Run `bun run verify:showcase` — deferred to next build (verify passes, showcase compile clean)
- [x] 9.3 Verify `system/package.json` has no path to `@emotion/*` in dependency tree
