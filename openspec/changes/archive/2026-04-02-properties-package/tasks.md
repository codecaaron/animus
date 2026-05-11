## 1. Package scaffold

- [x] 1.1 Create `packages/properties/` directory with `src/index.ts` barrel
- [x] 1.2 Create `packages/properties/package.json` — name `@animus-ui/properties`, dependency on `csstype: 3.1.3`, barrel-only export config (`"."` entry point, no subpaths)
- [x] 1.3 Create `packages/properties/tsconfig.json` and `tsconfig.build.json`
- [x] 1.4 Create `packages/properties/tsdown.config.ts` using the shared base config
- [x] 1.5 Add `"packages/properties"` to root `package.json` `workspaces` array
- [x] 1.6 N/A — bun-filter-ordering change handles this automatically via `--filter './packages/*' build:ts`
- [x] 1.7 N/A — bun-filter-ordering change handles this automatically via `--filter './packages/*' compile`
- [x] 1.8 Verify `bun install` resolves the new workspace package

## 2. Property data modules

- [x] 2.1 Create `src/unitless.ts` — export `UNITLESS_PROPERTIES` as `Set<string>` with 44 properties in kebab-case (42 existing + `aspect-ratio` + `scale`). Add JSDoc explaining kebab-case convention and why.
- [x] 2.2 Create `src/shorthands.ts` — export `SHORTHAND_PROPERTIES` as `readonly string[]` in camelCase, deduplicated (remove duplicate `transition` from source). Add JSDoc explaining camelCase convention, scope (registered prop-config shorthands), and why it differs from unitless casing.
- [x] 2.3 Create `src/csstype.ts` — wildcard re-export from `csstype` (`export type * from 'csstype'`)
- [x] 2.4 Wire all exports through `src/index.ts` barrel
- [x] 2.5 Verify `bun run build` succeeds for the properties package

## 3. Package tests

- [x] 3.1 Create `packages/properties/__tests__/properties.test.ts` — assert UNITLESS set size (44), SHORTHAND array has no duplicates, all UNITLESS entries are kebab-case, all SHORTHAND entries are camelCase
- [x] 3.2 Verify tests pass (9/9 pass)

## 4. Consumer migration — extract

- [x] 4.1 Add `@animus-ui/properties: workspace:*` to `packages/extract/package.json` dependencies
- [x] 4.2 Update `packages/extract/pipeline/unit-fallback.ts` — remove inline UNITLESS set, import `UNITLESS_PROPERTIES` from `@animus-ui/properties`
- [x] 4.3 Verify extract pipeline builds and existing unit-fallback tests pass

## 5. Consumer migration — system

- [x] 5.1 Add `@animus-ui/properties: workspace:*` to `packages/system/package.json` dependencies
- [x] 5.2 Update `packages/system/src/runtime/resolveClasses.ts` — remove inline unitless set, import `UNITLESS_PROPERTIES` from `@animus-ui/properties`
- [ ] 5.3 Migrate `csstype` dependency from system to properties (update type imports in system to use `@animus-ui/properties`) — deferred: system's csstype usage is in devDependencies and types/, needs broader audit
- [x] 5.4 Verify system builds and existing tests pass

## 6. Verification

- [x] 6.1 Run build:ts + compile + test + check — all pass (387 tests, 0 failures)
- [x] 6.2 Verify both pipeline (post-processing) and runtime (resolveClasses) use the shared UNITLESS set via import trace
- [x] 6.3 Remove R2 tasks from `v1-review-fixes/tasks.md` (subsumed by this change)
