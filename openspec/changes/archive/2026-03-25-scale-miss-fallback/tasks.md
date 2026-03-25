## 1. Unit Fallback Implementation

- [x] 1.1 Add `UNITLESS_PROPERTIES` Set constant with ~50 kebab-case property names matching @emotion/unitless
- [x] 1.2 Implement `applyUnitFallback(css: string): string` — regex-based, handles shorthand values per-number
- [x] 1.3 Call `applyUnitFallback()` after transform resolution in the main buildStart flow
- [x] 1.4 Covers both code paths (system subprocess and legacy subprocess both flow through the same resolvedComponentCss assignment)

## 2. Verification

- [ ] 2.1 Add canary test: source with `p={8}` where 8 is NOT in scale → CSS output contains `padding:8px`
- [ ] 2.2 Add canary test: source with `lineHeight={1.5}` → CSS output contains `line-height:1.5` (no px)
- [ ] 2.3 Run `bun run verify` — all existing tests pass
- [ ] 2.4 Run `bun run verify:showcase` — showcase builds correctly
