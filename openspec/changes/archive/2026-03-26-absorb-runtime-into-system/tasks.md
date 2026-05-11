## 1. Move Runtime Source into System

- [x] 1.1 Create `packages/system/src/runtime/index.ts` — copy `createComponent`, all types, and `serializeValueKey` from `packages/runtime/src/index.ts`
- [x] 1.2 Update `packages/system/src/index.ts` — add `export { createComponent } from './runtime'`
- [x] 1.3 Update `packages/system/src/Animus.ts` — change import from `'@animus-ui/runtime'` to `'./runtime'`
- [x] 1.4 Update `packages/system/src/AnimusExtended.ts` — change import from `'@animus-ui/runtime'` to `'./runtime'`

## 2. Update System Package Metadata

- [x] 2.1 Remove `"@animus-ui/runtime": "workspace:*"` from `packages/system/package.json` dependencies
- [x] 2.2 Verify React peer dep exists with range `^18.0.0 || ^19.0.0`

## 3. Update Rust Transform Emitter

- [x] 3.1 Change import path in `packages/extract/src/transform_emitter.rs:147` from `@animus-ui/runtime` to `@animus-ui/system`
- [x] 3.2 Update test assertion at `transform_emitter.rs:328` to expect `@animus-ui/system`
- [x] 3.3 Update test assertion at `transform_emitter.rs:455` to expect `@animus-ui/system`

## 4. Update Canary Tests

- [x] 4.1 Update `packages/extract/tests/canary.test.ts:165` assertion to expect `@animus-ui/system`
- [x] 4.2 Update `packages/extract/tests/canary.test.ts:1125` assertion to expect `@animus-ui/system`
- [x] 4.3 Update `packages/extract/tests/canary.test.ts:1145` assertion to expect `@animus-ui/system`

## 5. Remove Runtime from Workspace

- [x] 5.1 Remove `packages/runtime` from root `package.json` workspaces array
- [x] 5.2 Remove runtime from `build:ts` script order, `compile` script in root `package.json`
- [x] 5.3 Remove `"@animus-ui/runtime": "workspace:*"` from `packages/showcase/package.json` dependencies

## 6. Update CI Release Workflow

- [x] 6.1 Remove runtime from the TS package publish list in CI workflow (version bump + publish loops)

## 7. Verification

- [x] 7.1 Run `bun install` to resolve updated workspace
- [x] 7.2 Run `bun run verify` — build:ts passes, canary tests pass. Pre-existing type errors in showcase from NarrowPrimitive fix (not caused by this change)
- [x] 7.3 Run `bun run test:canary` — 107/107 pass with `@animus-ui/system` import path
- [x] 7.4 Run `bun run verify:showcase` — showcase builds (294KB JS, 12KB CSS, extraction working with @animus-ui/system imports)
