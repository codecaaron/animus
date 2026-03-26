## 1. Fix ThemedCSSProps Fallback Branch

- [x] 1.1 In `system/src/types/config.ts` line 129, replace `unknown` with `Omit<PropertyTypes, keyof Config> & { [P in keyof Config]?: ThemedScale<Config[P]> }`

## 2. Type Regression Tests

- [x] 2.1 Import `ThemedCSSProps` and `Prop` in `system/__tests__/types.test-d.tsx`
- [x] 2.2 Add negative assertion: `_NestedNotUnknown` — resolved type for nested selector key must not be `unknown`
- [x] 2.3 Add positive assertions: nested selectors in `.styles()` with CSS properties and system props
- [x] 2.4 Add positive assertions: nested selectors in `.variant()` base and variant options
- [x] 2.5 Add positive assertions: nested selectors in `.states()`

## 3. Verification

- [x] 3.1 Run `bun run test:types` — all type assertions compile clean
- [ ] 3.2 Run `bun run verify` — full build + test + biome check passes
