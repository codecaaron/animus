## 1. Define TokenRef Type

- [ ] 1.1 Add `TokenRef` type to `system/src/types/theme.ts`: `` type TokenRef = `{${keyof LiteralPaths<TokenScales<Theme>> & string}}` ``
- [ ] 1.2 Import `LiteralPaths` from the theme module in `types/theme.ts`
- [ ] 1.3 Export `TokenRef` from `system/src/index.ts`

## 2. Inject into PropertyTypes

- [ ] 2.1 Import `TokenRef` in `system/src/types/properties.ts`
- [ ] 2.2 Update `PropertyTypes` Overrides default from `(string & {}) | 0` to `(string & {}) | 0 | TokenRef`
- [ ] 2.3 Update `AnimusCSSProperties` Overrides default similarly
- [ ] 2.4 Update `PropertyValues` Overrides reference in `config.ts` if needed

## 3. Type Regression Tests

- [ ] 3.1 Import `TokenRef` in `system/__tests__/types.test-d.tsx`
- [ ] 3.2 Structural assertion: `TokenRef` is not `never` when Theme is augmented
- [ ] 3.3 Positive assertion: token ref string assignable to `TokenRef` type
- [ ] 3.4 Negative assertion (`@ts-expect-error`): invalid token path rejected by `TokenRef`
- [ ] 3.5 Positive assertion: compound value with token ref accepted in `.styles()` (e.g., `border`, `boxShadow`)
- [ ] 3.6 Negative assertion (`@ts-expect-error`): invalid token ref rejected in `.styles()` compound value when using `TokenRef` directly
- [ ] 3.7 Collapse guard: `(string & {}) | TokenRef` does not collapse to `string` — `unknown extends` check

## 4. Verification

- [ ] 4.1 Run `bun run test:types` — all type assertions compile clean
- [ ] 4.2 Run `bun run verify` — full build + test + biome check passes
- [ ] 4.3 Verify TokenRef autocomplete in IDE (manual check — hover over TokenRef, confirm union members visible)
