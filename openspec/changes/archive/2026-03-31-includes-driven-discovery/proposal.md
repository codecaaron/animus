## Why

Both plugins (vite-plugin, next-webpack-plugin) discover external packages by scanning the source of EVERY discovered file for imports matching `packagePatterns` (default `@animus-ui/*`). This is O(n) regex over all source files — wasteful when the consumer has already declared their external DS dependencies via `.includes()` in ds.ts. The system entry file is the single topology declaration; the plugin should read it directly instead of brute-forcing discovery from the entire file set.

## What Changes

- Replace the package discovery phase in vite-plugin (`buildStart` step 5, lines 718-791) with system-file-driven discovery: read ds.ts source, extract non-relative import specifiers, resolve and walk only those packages.
- Replace the equivalent `resolvePackages()` method in next-webpack-plugin with the same approach.
- Remove the `packagePatterns` option from both plugin configs — it becomes unnecessary when discovery is driven by `.includes()` imports.
- The package resolution and file walking logic (step 2 of the current flow — resolve specifier, find src/, walk files) is unchanged. Only the discovery source changes: from "scan all files" to "read one file."

## Capabilities

### New Capabilities

- `includes-driven-discovery`: Plugin reads the system entry file (ds.ts), extracts import specifiers from its top-level import declarations, resolves matching packages to source directories, and walks their files. Replaces the O(n) regex scan of all source files with a single-file read.

### Modified Capabilities

- `vite-extraction-plugin`: Package discovery phase replaced. `packagePatterns` option removed.

## Impact

- **vite-plugin**: `AnimusExtractOptions.packagePatterns` removed. `buildStart` step 5 rewritten to parse system file imports instead of scanning all file entries. Package resolution + file walking reused as-is.
- **next-webpack-plugin**: `resolvePackages()` method replaced with system-file import parsing. `packagePatterns` option removed from config type.
- **No changes to**: SystemBuilder, test-ds, Rust crate, consumer apps (`.includes()` already wired in ds.ts).
- **Breaking**: Consumers using custom `packagePatterns` would need to switch to `.includes()`. Since this option is not yet documented or used externally, this is a safe removal.
