## 1. Standalone Script

- [x] 1.1 Create `resolve-global-styles.ts` in `packages/vite-plugin/src/` following `resolve-transforms.ts` pattern
- [x] 1.2 Script accepts CLI args: `<system-path> <theme-json-path> <output-file>`
- [x] 1.3 Imports system module, calls `.serialize()`, extracts `globalStyles`, `propConfig`, `transforms`
- [x] 1.4 Implements `camelToKebab()` for CSS property name conversion
- [x] 1.5 Implements `resolveBlock()` — iterates selectors, resolves props through config + theme scales + transforms
- [x] 1.6 Implements `serializeRawBlock()` — raw structural serialization for `@keyframes` (nested selector → property blocks, camelToKebab only, no prop resolution)
- [x] 1.7 `resolveBlock()` detects `@keyframes` selectors and delegates to `serializeRawBlock()`
- [x] 1.8 Writes `{ reset?: string, global?: string }` JSON to output file

## 2. Plugin Integration

- [x] 2.1 Replace inline string template in `loadSystem()` with subprocess call to `resolve-global-styles.ts`
- [x] 2.2 Write theme JSON to temp file, pass as arg alongside system path and output path
- [x] 2.3 Script resolution via candidate paths: `__pluginDir`, `../src/`, package.json-resolved
- [x] 2.4 Clean up temp files after subprocess completes
- [x] 2.5 Maintain existing error handling (catch + warn on failure)

## 3. Verification

- [x] 3.1 Plugin rebuild produces correct `dist/index.mjs`
- [x] 3.2 Showcase build produces global styles in `@layer global` including keyframes
- [x] 3.3 `@keyframes` blocks render correctly with nested percentage stops
