## 1. Type Infrastructure

- [ ] 1.1 Add `strict?: boolean` field to the `Prop` interface in `packages/system/src/types/config.ts`
- [ ] 1.2 Add `StrictOrEmpty` helper type: `Config['strict'] extends false ? true : IsEmpty<Scale>`
- [ ] 1.3 Update `ScaleValue` — replace `IsEmpty<Scale>` with `StrictOrEmpty<Config, Scale>` in all three branches (theme scale, MapScale, ArrayScale)
- [ ] 1.4 Update `ThemedScaleValue` — same replacement in all three branches

## 2. Type Tests — Positive Assertions

- [ ] 2.1 Test: prop with `strict: false` + theme scale accepts scale keys AND arbitrary strings
- [ ] 2.2 Test: prop with `strict: false` + `negative: true` produces negative keys alongside `(string & {})`
- [ ] 2.3 Test: prop with `strict: false` + responsive syntax accepts arbitrary strings per breakpoint
- [ ] 2.4 Test: prop with `strict: false` + inline MapScale accepts scale values AND arbitrary strings

## 3. Type Tests — Negative Assertions (Regression Guards)

- [ ] 3.1 Test: prop with `strict` omitted rejects arbitrary strings when scale has values (current behavior preserved)
- [ ] 3.2 Test: prop with `strict: true` rejects arbitrary strings when scale has values
- [ ] 3.3 Test: prop with empty scale still accepts full CSS values regardless of strict setting
- [ ] 3.4 Test: existing type assertions in `types.test-d.tsx` still pass (no regressions in negative scale, variant narrowing, etc.)

## 4. Verification

- [ ] 4.1 Run `bun run test:types` — zero errors
- [ ] 4.2 Run `bun run test` — 257+ tests pass
- [ ] 4.3 Run `bun run build:ts` — all packages build clean (no TS2590 or declaration emit issues)
- [ ] 4.4 Run `bun run test:canary` — 131+ canary tests pass
