## Why

The global styles resolution logic in the Vite plugin was written as a JavaScript string template concatenated inside a TypeScript file — an escaped string-in-string abomination that was unlintable, untestable, and unmaintainable. The `resolve-transforms.ts` script already established the pattern of standalone subprocess scripts. Global styles resolution should follow the same pattern.

Additionally, the resolution logic needed to handle `@keyframes` at-rules, which are structurally different from normal selector → property CSS. Keyframe blocks contain nested selectors (percentage stops) with their own property declarations, and they don't need prop config resolution — just raw camelToKebab serialization.

## What Changes

- New `resolve-global-styles.ts` standalone script in `packages/vite-plugin/src/` — receives system path, theme JSON path, and output file path as CLI args
- The script imports the system module, extracts `globalStyles` from `.serialize()`, resolves props through the full config + theme + transforms, and writes resolved CSS to output
- `@keyframes` selectors detected and delegated to `serializeRawBlock()` — raw structural serialization with camelToKebab on property names, no scale/transform resolution
- `loadSystem()` in the plugin now invokes the standalone script instead of writing + executing a temp JS file with inline string logic
- Script resolution uses the same candidate path pattern as `resolve-transforms.ts` (dist/, src/, package.json-resolved)

## Capabilities

### Modified Capabilities
- `vite-extraction-plugin`: Global styles resolution moved from inline string template to standalone subprocess script. Adds `@keyframes` support via structural serialization.

## Impact

- **Vite plugin** (`packages/vite-plugin/`): New `src/resolve-global-styles.ts` file. `loadSystem()` simplified — no more `writeFileSync` of generated JS code for global style resolution.
