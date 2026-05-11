## Phase 1: Unblock Beta Publishing

## 1. Package Metadata (DONE)

- [x] 1.1 Remove `private: true` from runtime, system, extract, vite-plugin package.json files
- [x] 1.2 Add `license: "MIT"` to runtime, system, extract, vite-plugin
- [x] 1.3 Add `repository`, `publishConfig: { "access": "public" }` to runtime, system, extract, vite-plugin
- [x] 1.4 Add `files` field to each package: `["dist"]` for TS packages, `["index.js", "index.d.ts", "*.node"]` for extract
- [x] 1.5 Fix vite-plugin extract dependency: changed `"^0.1.0"` → `"workspace:*"` for consistency

## 2. Version Alignment (DONE)

- [x] 2.1 All publishable packages at `0.1.0` base version (tags override at publish time)
- [x] 2.2 Extract `optionalDependencies` match base version

## 3. Verification

- [ ] 3.1 Run `npm pack --dry-run` in each publishable package — verify tarball contains only intended files
- [ ] 3.2 Run `bun run verify` — all builds, compiles, and tests pass
- [ ] 3.3 Inspect tarball contents: no test files, no source maps, no `.ts` source files leaking

---

## Phase 2: Package Restructuring (post-beta)

## 4. Rename Runtime → React

- [ ] 4.1 Rename `packages/runtime/` directory to `packages/react/`
- [ ] 4.2 Update `package.json` name from `@animus-ui/runtime` to `@animus-ui/react`
- [ ] 4.3 Update all `@animus-ui/runtime` import references in the monorepo to `@animus-ui/react`
- [ ] 4.4 Update root `package.json` build scripts and workspace list
- [ ] 4.5 Update root `CLAUDE.md` build order documentation

## 5. System Re-exports Theming

- [ ] 5.1 Add `createTheme` re-export to `packages/system/src/index.ts`
- [ ] 5.2 Re-export relevant theming types from system index
- [ ] 5.3 Update showcase `ds.ts` to import `createTheme` from `@animus-ui/system` instead of `@animus-ui/theming`

## 6. Vite Plugin — Kill Core Dependency

- [ ] 6.1 Audit `config-serializer.ts` — confirm consumers use system's serialize output
- [ ] 6.2 Audit `resolve-transforms.ts` — confirm transform resolution uses serialize().transforms
- [ ] 6.3 Delete or gut core imports from these files
- [ ] 6.4 Remove `@animus-ui/core` from vite-plugin's `dependencies`

## 7. Configurable Emitter Paths

- [ ] 7.1 Add `runtime?: string` to plugin options interface (default: `'@animus-ui/react'`)
- [ ] 7.2 Pass runtime import path through manifest config to Rust emitter
- [ ] 7.3 Update `transform_emitter.rs:143` to read from manifest config instead of hardcoded `@animus-ui/runtime`

## 8. Phase 2 Verification

- [ ] 8.1 Run `bun run verify` — all tests pass with new package names
- [ ] 8.2 Run `bun run verify:showcase` — showcase builds with updated imports
- [ ] 8.3 Verify `createTheme` importable from `@animus-ui/system`
