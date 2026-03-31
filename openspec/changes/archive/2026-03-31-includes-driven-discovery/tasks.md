## 1. Extract system file import parser

- [x] 1.1 Create a `extractSystemFilePackages(systemFilePath: string): string[]` helper function that: reads the file, regex-extracts all `from '...'` / `from "..."` import specifiers, filters out relative imports (`./`, `../`), filters out `@animus-ui/system` and `@animus-ui/system/*`, returns the remaining external specifiers
- [x] 1.2 Add a known-skip list for common non-DS imports: `react`, `react-dom`, `next`, `vite`, `lodash`, etc. — these are never external DS packages

## 2. Vite-plugin: replace package discovery

- [x] 2.1 Remove `packagePatterns` from `AnimusExtractOptions` interface
- [x] 2.2 In `buildStart` step 5, replace the all-file regex scan (lines 718-738) with a call to `extractSystemFilePackages(resolvedSystemPath)`
- [x] 2.3 Keep the package resolution loop (lines 740-791) unchanged — it takes specifiers and resolves/walks them. Just feed it the new specifier set instead of the regex-scanned set
- [x] 2.4 Update the dev mode HMR path to use the same system-file-driven discovery (if applicable)

## 3. Next-webpack-plugin: replace package discovery

- [x] 3.1 Remove `packagePatterns` from the next-webpack-plugin config type
- [x] 3.2 Replace `resolvePackages()` method with the same `extractSystemFilePackages()` call + resolution logic
- [x] 3.3 Remove the `packagePatterns` pass-through in `with-animus.ts`

## 4. Shared helper location

- [x] 4.1 Decide where `extractSystemFilePackages` lives — if both plugins import it, place in `@animus-ui/extract/pipeline` (already shared). If duplicating is simpler, inline in each plugin (it's ~15 lines).

## 5. Verification

- [x] 5.1 `bun run verify:showcase` — showcase still discovers and extracts test-ds components via ds.ts `.includes()` import
- [x] 5.2 `bun run verify:full` — full pipeline passes
- [x] 5.3 Confirm that removing the `.includes()` import from ds.ts causes test-ds components to NOT be discovered (explicit-only behavior)
