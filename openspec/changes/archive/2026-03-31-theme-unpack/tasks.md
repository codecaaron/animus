## 1. Audit Builder Chain

- [ ] 1.1 Read `createTheme.ts` and map what raw config data is currently retained per builder call (addColors, addColorModes, addScale, addContextualVars)
- [ ] 1.2 Identify the gap: confirm nested colors are not stored raw, mode alias maps are not stored raw, and scale values-only config is not stored raw

## 2. Type Design

- [ ] 2.1 Add `UnpackedTheme<Colors, Scales, Modes, Breakpoints>` interface to `packages/system/src/types/theme.ts`
- [ ] 2.2 Define the `scales` field type: `Record<string, { values: Record<string | number, unknown> }>` keyed by scale name
- [ ] 2.3 Define the `colorModes` field type: `{ default: string, modes: Record<string, unknown> } | undefined`
- [ ] 2.4 Export `UnpackedTheme` from `packages/system/src/index.ts`

## 3. Raw Config Storage

- [ ] 3.1 Add `#rawConfig` private field to `ThemeBuilder` with shape `{ colors, colorModes, scales, breakpoints }`
- [ ] 3.2 Carry `#rawConfig` through `#checkpoint` (copy forward on each builder step)
- [ ] 3.3 In `addColors`: merge nested colors input into `#rawConfig.colors` (preserve nesting, not flat form)
- [ ] 3.4 In `addColorModes`: store `{ default: initialMode, modes: modeConfig }` into `#rawConfig.colorModes`
- [ ] 3.5 In `addScale`: store `{ values }` under `#rawConfig.scales[name]`
- [ ] 3.6 In constructor: initialize `#rawConfig.breakpoints` from base theme's `breakpoints`

## 4. Implement unpack()

- [ ] 4.1 In `build()`, assemble the unpack payload from `#rawConfig` plus `_contextualVars` (if present)
- [ ] 4.2 Attach `unpack()` to the built theme via `Object.defineProperty` with `enumerable: false, configurable: false, writable: false`
- [ ] 4.3 Ensure `unpack()` return type is `UnpackedTheme<...>` with the correct generic params threaded through from the builder chain

## 5. Builder Type Signature

- [ ] 5.1 Update the `build()` return type in `ThemeBuilder` to include `& { unpack(): UnpackedTheme<...> }`
- [ ] 5.2 Verify TypeScript does not widen the return type — the exact shape of colors/scales/modes must be preserved, not erased to `Record<string, unknown>`

## 6. Tests — Round-Trip

- [ ] 6.1 Test: build a theme with colors, scales, colorModes, and breakpoints → call `unpack()` → rebuild → assert token paths and CSS variables match the original
- [ ] 6.2 Test: `unpack()` is not present in `Object.keys(tokens)` (non-enumerable)
- [ ] 6.3 Test: `unpack()` is not present in `JSON.stringify(tokens)` output

## 7. Tests — Consumer Patterns

- [ ] 7.1 Test: unpack + augment colors — spread unpacked colors with an extra key, rebuild, verify new token appears alongside original tokens
- [ ] 7.2 Test: unpack + partial scales — spread only a subset of scales, rebuild, verify omitted scale tokens are absent
- [ ] 7.3 Test: unpack + mode override — spread unpacked colorModes.modes with one mode alias changed, rebuild, verify updated alias is reflected in CSS output

## 8. Tests — Type Inference

- [ ] 8.1 Type test: `unpack().colors` has the exact nested type passed to `addColors()` (not widened to `Record<string, unknown>`)
- [ ] 8.2 Type test: spreading `{ ...unpack().colors, brand: { 500: '#custom' } }` into `addColors()` compiles without error and infers merged type

## 9. Integration

- [ ] 9.1 If `packages/showcase` or `test-ds` contains a theme definition, add a usage example demonstrating `unpack()` in a consumer context
- [ ] 9.2 Run `bun run verify` to confirm no regressions across build, tests, and biome checks
