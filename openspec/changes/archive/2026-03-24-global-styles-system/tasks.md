## 1. System Builder

- [x] 1.1 Add `#globalStyles` private field to `SystemBuilder` class
- [x] 1.2 Add `.withGlobalStyles(styles)` method that returns a new `SystemBuilder` with the styles stored
- [x] 1.3 Add `globalStyles` optional field to `SerializedConfig` interface
- [x] 1.4 Update `serializeInstance()` to include `globalStyles` in the output when present
- [x] 1.5 Update `build()` to pass global styles through to the system instance and `serialize()`

## 2. Vite Plugin: Global Style Resolution

- [x] 2.1 Add `resolveGlobalStyles(globalStyles, propConfig, flatTheme, variableMap, transforms)` function in the vite plugin that resolves selector-keyed style objects to CSS string
- [x] 2.2 The resolver SHALL: look up each prop key in propConfig, resolve scale values from flatTheme, apply transforms directly (not as placeholders), convert camelCase to kebab-case, handle multi-property expansion
- [x] 2.3 The resolver SHALL handle pass-through CSS properties (no prop config entry) with camelCase → kebab-case conversion

## 3. Vite Plugin: Integration

- [x] 3.1 Update `loadSystem()` to read `globalStyles` from the serialized config output
- [x] 3.2 Resolve global styles using the function from 2.1 after theme evaluation (needs flatTheme + propConfig + transforms)
- [x] 3.3 Store resolved global CSS string in plugin closure alongside `variableCss`
- [x] 3.4 Update `load` hook to emit `variableCss + globalCss + componentCss` for the virtual module
- [x] 3.5 Update HMR geological reset to re-resolve global styles when system file changes

## 4. Showcase Migration

- [x] 4.1 Add `.withGlobalStyles()` call to `packages/showcase/src/ds.ts` with the reset and global styles from `reset.css` + `global.css`
- [x] 4.2 Remove `import './reset.css'` from `main.tsx`
- [x] 4.3 Keep `global.css` for animation/interaction CSS that can't use prop shorthand (keyframes, pseudo-element content, class-based transitions)
- [x] 4.4 Verify showcase builds and renders correctly with global styles from the system

## 5. Testing

- [x] 5.1 Verify `bun run build` in showcase produces CSS with the global styles prepended before `@layer` blocks
- [x] 5.2 Verify existing canary tests still pass (global styles change doesn't affect component extraction)
