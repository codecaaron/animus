## Tasks

### 1. Type Layer
- [x] 1.1 Add `negative?: boolean` to `Prop` interface in `system/src/types/config.ts`
- [x] 1.2 Add `NegateKeys<T>` and `NegativeOf<Config, Keys>` utility types
- [x] 1.3 Wire `NegativeOf` into `ScaleValue` (generic T version)
- [x] 1.4 Wire `NegativeOf` into `ThemedScaleValue` (augmented Theme version)

### 2. Prop Config
- [x] 2.1 Add `negative: true` to all margin props in `system/src/groups/index.ts`
- [x] 2.2 Add `negative: true` to positioning directionals (`inset`, `top`, `right`, `bottom`, `left`)

### 3. Runtime
- [x] 3.1 Update `lookupScaleValue` in `core/src/scales/lookupScaleValue.ts` — abs lookup + negate result

### 4. Extraction
- [x] 4.1 Update `resolve_value` in `extract/src/theme_resolver.rs` — abs lookup + negate CSS output
- [x] 4.2 Add `negate_css_value` helper function

### 5. Tests
- [x] 5.1 Type tests — positive: `m={-4}`, `mt={-8}`, `mx={-16}` compile
- [x] 5.2 Type tests — negative: `m={-99}` errors, `p={-4}` errors
- [x] 5.3 Runtime unit test — 7 tests in `lookupScaleValue.test.ts` (positive, negative, zero, unresolvable, numeric result, inline scale)
- [x] 5.4 Canary test — 4 tests: negative margin-top, margin-left, position top, system prop usage
- [x] 5.5 Rust integer preservation fix — `i.unsigned_abs()` to avoid float key mismatch

### 6. Verification
- [x] 6.1 `bun run verify` green — 231 tests, types clean, biome clean
- [x] 6.2 `bun run test:canary` green — 125 canary tests
