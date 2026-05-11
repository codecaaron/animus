## Why

The extraction pipeline currently discovers files only within the consumer app's own source tree, excluding node_modules entirely. This prevents Animus from serving the library-to-consumer use case — the primary adoption path for design systems — where components ship from a separate workspace package and must have their styles extracted against the consumer's theme.

## What Changes

- New cosmetic `.includes()` method on SystemBuilder: a no-op at runtime that returns `this`. Its sole purpose is to force the consumer to import external DS instances in `ds.ts`, making those import declarations visible to OXC.
- OXC-based import tracing in the plugin: at build time, the plugin reads the system entry file's AST, extracts import specifiers from packages referenced in `.includes()`, resolves those packages to source directories, and walks their files alongside app files.
- External package files are passed to the Rust `analyzeProject`/`transform_file` pipeline identically to app files — no special-casing.
- New `packages/test-ds` workspace package: 3-4 components (Button, Card, Badge, Alert) built with the Animus builder chain, plus a reference theme (not consumed by the plugin).
- Consumer theme remains the single source of truth — the library's own ds instance is never loaded by the consumer's plugin.
- Both showcase and next-test-app gain test-ds components, proving extraction works end-to-end.

## Consumer API

```typescript
// Consumer's ds.ts
import { system as coreSystem } from '@my-ds/core';

const { system: ds } = createSystem()
  .addGroup('space', space)
  .addGroup('layout', layout)
  .includes([coreSystem])   // cosmetic — forces the import, OXC reads it
  .build();
```

No plugin configuration needed. The plugin reads ds.ts, sees the `@my-ds/core` import, resolves the package, walks its source files.

## Capabilities

### New Capabilities

- `external-package-file-discovery`: OXC traces import declarations from the system entry file to discover external packages. Plugin resolves those packages to source paths and includes their files in the extraction walk. Token refs in library components resolve against the consumer's theme CSS variables.
- `system-builder-includes`: Cosmetic `.includes()` method on SystemBuilder — no-op at runtime, exists to centralize external DS declarations in the system entry file.

### Modified Capabilities

- `vite-extraction-plugin`: File discovery extended to include OXC-traced external packages from the system entry file.
- `next-webpack-plugin`: Same file discovery extension mirrored.

## Impact

- **system**: SystemBuilder gains `.includes()` method (no-op, returns `this`). Type signature accepts `SystemInstance[]`.
- **extract (Rust crate)**: No changes. OXC `import_resolver` already parses import declarations; plugin reads these to get package specifiers.
- **vite-plugin**: `buildStart` reads system file AST for external package imports, resolves and walks them.
- **next-webpack-plugin**: Same discovery logic mirrored.
- **packages/test-ds**: New workspace package — added to bun workspaces, tsdown build, exports components + reference theme.
- **showcase**: Adds `@animus-ui/test-ds` dependency, uses `.includes()` in ds.ts.
- **next-test-app**: Adds `@animus-ui/test-ds` dependency, uses `.includes()` in ds.ts.
- No breaking changes — `.includes()` is additive and optional.
