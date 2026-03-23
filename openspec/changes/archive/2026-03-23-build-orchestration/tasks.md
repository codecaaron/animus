## 1. Fix Missing tsdown Configs

- [x] 1.1 Create `packages/vite-plugin/tsdown.config.ts` extending shared base with `platform: 'node'`
- [x] 1.2 Create `packages/runtime/tsdown.config.ts` extending shared base with default config
- [x] 1.3 Verify both packages build successfully: `cd packages/vite-plugin && bun run build` and `cd packages/runtime && bun run build`

## 2. Root Script DAG

- [x] 2.1 Add `build:extract` script: `bun run --filter '@animus-ui/extract' build`
- [x] 2.2 Add `build:ts` script: sequential `--filter` chain in dependency order (core → theming → runtime → vite-plugin → ui)
- [x] 2.3 Add `build:all` script: `bun run build:extract && bun run build:ts`
- [x] 2.4 Update existing `build` to alias `build:all`
- [x] 2.5 Add `clean` script: remove all `packages/*/dist/` and `packages/extract/target/`

## 3. Test and Verification Scripts

- [x] 3.1 Add `test:canary` script: `bun test packages/extract/tests/canary.test.ts`
- [x] 3.2 Add `test:showcase` script: `bun run --filter './packages/showcase' build`
- [x] 3.3 Update `verify` script: `bun run build:all && bun test && bun run compile && bun run check`

## 4. Validation

- [x] 4.1 Run `bun run clean` and confirm all artifacts removed
- [x] 4.2 Run `bun run verify` from clean state and confirm full green pipeline
- [x] 4.3 Run `bun run test:canary` in isolation and confirm canary snapshot passes
- [x] 4.4 Run `bun run test:showcase` in isolation and confirm showcase builds
