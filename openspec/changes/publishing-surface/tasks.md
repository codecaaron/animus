## 1. Rename Runtime → React

- [ ] 1.1 Rename `packages/runtime/` directory to `packages/react/`
- [ ] 1.2 Update `package.json` name from `@animus-ui/runtime` to `@animus-ui/react`
- [ ] 1.3 Update all `@animus-ui/runtime` import references in the monorepo to `@animus-ui/react`
- [ ] 1.4 Update root `package.json` build scripts if they reference runtime by filter name
- [ ] 1.5 Update root `CLAUDE.md` build order documentation

## 2. System Re-exports Theming

- [ ] 2.1 Add `createTheme` re-export to `packages/system/src/index.ts`
- [ ] 2.2 Re-export relevant theming types (ThemeBuilder, etc.) from system index
- [ ] 2.3 Update `packages/system/package.json` — ensure `@animus-ui/theming` is in `dependencies` (not `workspace:*` — use version range)
- [ ] 2.4 Update showcase `ds.ts` to import `createTheme` from `@animus-ui/system` instead of `@animus-ui/theming`

## 3. Vite Plugin — Kill Core Dependency

- [ ] 3.1 Audit `config-serializer.ts` usage — confirm all its consumers now use system's serialize output
- [ ] 3.2 Audit `resolve-transforms.ts` usage — confirm transform resolution uses serialize().transforms
- [ ] 3.3 Delete `config-serializer.ts` and `resolve-transforms.ts` (or gut their core imports)
- [ ] 3.4 Remove `@animus-ui/core` from vite-plugin's `dependencies`
- [ ] 3.5 Update any remaining `require('@animus-ui/core')` references in plugin source

## 4. Vite Plugin — Runtime Option

- [ ] 4.1 Add `runtime?: string` to plugin options interface (default: `'@animus-ui/react'`)
- [ ] 4.2 Update transform output to use `options.runtime` instead of hardcoded `'@animus-ui/runtime'`
- [ ] 4.3 Pass runtime option through to `transform_file` output generation

## 5. Publishing Metadata

- [ ] 5.1 Remove `private: true` from system, react, extract, vite-plugin package.json files
- [ ] 5.2 Add `author`, `license`, `repository`, `homepage`, `publishConfig` to all four packages
- [ ] 5.3 Add `exports` field to system (with `./groups` subpath), react, extract, vite-plugin
- [ ] 5.4 Add `files` field to all four packages (`["dist"]` for TS, `["index.js", "index.d.ts"]` for extract)
- [ ] 5.5 Convert all `workspace:*` references to version ranges (`^0.1.0-next.1`)
- [ ] 5.6 Set all publishable package versions to `0.1.0-next.1`

## 6. Verification

- [ ] 6.1 Run `bun run verify` — all tests and type checks pass
- [ ] 6.2 Run `npm pack --dry-run` on each publishable package — verify tarball contents
- [ ] 6.3 Verify showcase builds with updated import paths (`bun run verify:showcase`)
- [ ] 6.4 Verify `createTheme` is importable from `@animus-ui/system` in showcase
