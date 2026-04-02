## 1. Standardize package scripts

- [x] 1.1 Add `build:ts` script to all TS library packages that don't have it (core, theming, system, vite-plugin, next-plugin, test-ds, runtime, ui) — `"build:ts": "tsdown && tsc -p tsconfig.build.json"`
- [x] 1.2 Update `build` script in TS-only packages to alias `build:ts` — `"build": "bun run build:ts"`
- [x] 1.3 Update extract's scripts: rename current pipeline-only build to `build:ts`, ensure `build` runs Rust then `build:ts` — `"build:ts": "tsdown && tsc -p tsconfig.build.json"`, `"build": "napi build --platform --release && bun run build:ts"`
- [x] 1.4 Add `compile` script (`tsc --noEmit`) to extract (currently missing)
- [x] 1.5 Verify each package's `build:ts` runs successfully in isolation

## 2. Update root build scripts

- [x] 2.1 Replace `build:ts` with `bun run --filter './packages/*' build:ts` (exclude showcase/next-test-app from library build by not giving them `build:ts`)
- [x] 2.2 Replace `build:all` with `bun run --filter '@animus-ui/extract' build && bun run build:ts` (kept as-is — already correct)
- [x] 2.3 Replace `compile` with `bun run --filter './packages/*' compile`
- [x] 2.4 Update `build:extract` to remain as-is (explicit extract-only build)
- [x] 2.5 Verify `build:ts` builds packages in correct topological order

## 3. Verify existing commands

- [x] 3.1 Run `bun run verify` — confirm identical behavior to before (build:ts + compile + test + check all pass)
- [ ] 3.2 Run `bun run build:all` — confirm Rust + TS builds complete
- [ ] 3.3 Run `bun run verify:showcase` — confirm showcase builds with all deps
- [x] 3.4 Run `bun test` — confirm all tests pass (378 pass, 0 fail)
