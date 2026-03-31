## 1. Type Definition

- [ ] 1.1 Add `ColorTokenRef` template literal type to `packages/system/src/types/config.ts`
- [ ] 1.2 Add `ColorTokenRef` union to `ThemedScaleValue` when `Config['scale']` is `'colors'`
- [ ] 1.3 Add `ColorTokenRef` union to `ScaleValue` when `Config['scale']` is `'colors'`

## 2. Type Regression Tests

- [ ] 2.1 Add positive type assertions: `bg` accepts `{colors.X}` and `{colors.X/alpha}` token refs
- [ ] 2.2 Add positive type assertion: `bg` accepts token ref in compound value (e.g., `linear-gradient`)
- [ ] 2.3 Add negative type assertion: `p` (space scale) rejects token ref strings
- [ ] 2.4 Add negative type assertion: `bg` still rejects raw `rgba()` strings

## 3. Showcase Cleanup

- [ ] 3.1 Revert StratumRow `background` workaround to `bg` with `{colors.X/N}` token refs

## 4. Verification

- [ ] 4.1 `bun run verify` passes (build + test + types + biome)
- [ ] 4.2 `bun run verify:showcase` passes (full extraction pipeline + showcase build)
