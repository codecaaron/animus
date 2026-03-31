## 1. SystemBuilder `.includes()` Method

- [x] 1.1 Add `.includes(systems: SystemInstance[])` method to SystemBuilder that returns `this` (no-op)
- [x] 1.2 Add type signature — accepts array of SystemInstance (or a minimal structural type that SystemInstance satisfies)
- [x] 1.3 Verify `.includes()` chains correctly: `createSystem().addGroup(...).includes([...]).build()` compiles and produces identical output to without `.includes()`

## 2. Create test-ds Package Scaffold

- [x] 2.1 Create `packages/test-ds/package.json` with name `@animus-ui/test-ds`, workspace deps on `@animus-ui/system`, and tsdown build config
- [x] 2.2 Create `packages/test-ds/tsconfig.json` and `packages/test-ds/tsconfig.build.json` following the pattern of other TS packages
- [x] 2.3 Create `packages/test-ds/tsdown.config.ts` to build `src/index.ts` as ESM
- [x] 2.4 Register `packages/test-ds` in the root `package.json` workspaces array

## 3. Create test-ds Reference Theme

- [x] 3.1 Create `packages/test-ds/src/theme.ts` with a reference theme using `createTheme().build()` — include color tokens (`primary`, `secondary`, `neutral`, `danger`), space scale, and font-size scale matching the token vocabulary the components will use

## 4. Create test-ds System Config (Library-Dev Only)

- [x] 4.1 Create `packages/test-ds/src/system.ts` exporting a SystemInstance for library development — not exported from `index.ts`

## 5. Create test-ds Components

- [x] 5.1 Create `packages/test-ds/src/components/Button.tsx` — base styles, `variant` (primary/secondary/ghost), system props (`px`, `py`)
- [x] 5.2 Create `packages/test-ds/src/components/Card.tsx` — base styles including `bg`, `p`, `borderRadius`, system props
- [x] 5.3 Create `packages/test-ds/src/components/Badge.tsx` — states (`disabled`, `active`), color variants (`neutral`, `danger`)
- [x] 5.4 Create `packages/test-ds/src/components/Alert.tsx` — compound variants (variant x intent combinations)

## 6. Create test-ds Exports

- [x] 6.1 Create `packages/test-ds/src/index.ts` exporting all four components and the reference theme — do NOT export the system config

## 7. Plugin: OXC Import Tracing from System Entry File

- [x] 7.1-7.5 EXISTING: vite-plugin already has `packagePatterns` (default `['@animus-ui/*']`) that scans imports, resolves packages, walks source dirs, and appends to fileEntries. `@animus-ui/test-ds` matches automatically. OXC-based .includes() tracing is a future refinement over this regex approach.

## 8. Plugin: Next-Webpack-Plugin Mirror

- [x] 8.1-8.2 EXISTING: next-webpack-plugin already has matching `packagePatterns` support with same default `['@animus-ui/*']`. Same mechanism as vite-plugin.

## 9. Update Showcase

- [x] 9.1 Add `@animus-ui/test-ds: 'workspace:*'` to `packages/showcase/package.json`
- [x] 9.2 Showcase discovers test-ds via existing packagePatterns (default `@animus-ui/*`) — component imports in page files trigger discovery
- [x] 9.3 Import and render Button + Card from test-ds in showcase Examples page
- [x] 9.4 Showcase theme already has primary, secondary, surface, text, background, danger — covers test-ds component tokens

## 10. Update next-test-app

- [x] 10.1 Add `@animus-ui/test-ds: 'workspace:*'` to next-test-app's `package.json`
- [x] 10.2 Next-test-app discovers test-ds via existing packagePatterns — component imports trigger discovery
- [x] 10.3 Import and render Button + Card from test-ds in next-test-app legacy page

## 11. Verification

- [x] 11.1 Run `bun run verify:showcase` — showcase builds, extracted CSS includes `animus-Button-c3dcf2f0` (test-ds) with variants `--variant-primary/secondary/ghost`, token refs resolved to `var(--color-primary)` etc.
- [x] 11.2 Run `bun run verify:full` — all tests, biome checks, Rust tests, type tests, showcase build + assertions pass
- [x] 11.3 Post-build assertion: `animus-Button-c3dcf2f0` (test-ds) with `--variant-primary/secondary/ghost` confirmed in showcase CSS. Two distinct Button hashes confirm test-ds and showcase Buttons are both extracted.
- [x] 11.4 Verify extraction warnings surface correctly when a consumer theme is missing a token that test-ds components reference
