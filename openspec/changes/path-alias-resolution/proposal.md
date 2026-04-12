# Path Alias Resolution in Extraction Pipeline

## Problem

The Rust import resolver handles two path shapes:
- **Relative paths** (`./foo`, `../bar`) → `resolve_relative_path()` in `import_resolver.rs`
- **Package specifiers** (`@animus-ui/system`) → lookup in `packageMap` (populated by vite-plugin)

It does NOT handle **tsconfig path aliases** like `@admin/*` → `./src/*`. These are resolved by Vite (via `tsconfigPaths()` plugin) and TypeScript, but are invisible to the Rust extraction pipeline.

### Impact

If a component file uses an aliased import to reference another component:
```typescript
// src/components/NavBar.tsx
import { Button } from '@admin/components/Button';

export const NavBar = Button.extend().styles({ ... }).asElement('nav');
```

The `.extend()` provenance chain cannot be resolved. `Button` becomes an unresolvable binding, and `NavBar` is excluded from extraction (falls through to runtime) or extracted without parent styles.

### Scope Assessment Needed

This may or may not be a real problem today:
- If all Animus component files import each other with relative paths, the gap doesn't bite.
- If consumers use aliased imports between component files (reasonable in large projects), extraction silently degrades.

### Observed in

Blockworks os-admin uses `@admin/*` → `./src/*` (tsconfig + vite resolve alias). Need to audit whether any Animus component imports use this alias.

## Proposed Direction

### Option A: Accept alias config in plugin options

```typescript
animusExtract({
  system: './src/ds.ts',
  pathAliases: {
    '@admin/*': './src/*',
  },
})
```

The plugin passes aliases to the Rust pipeline, which resolves them before falling through to the package map.

### Option B: Read tsconfig.json automatically

The plugin reads `tsconfig.json` (or the file specified by `tsconfig` Vite config), extracts `compilerOptions.paths`, and passes them to the Rust resolver. Zero-config for projects already using tsconfig paths.

### Option C: Use Vite's resolve at analysis time

Instead of a static `packageMap`, provide a dynamic resolution callback that calls Vite's `this.resolve()` for non-relative imports. This would handle aliases, package.json exports, and all other Vite resolution semantics. However, crossing the NAPI boundary for each resolution call adds latency.

### Option D: Document the limitation

If aliased imports between component files are uncommon, document that component files should use relative imports for extraction compatibility. Aliases for non-component imports (utils, hooks, types) are fine.

## Research Needed

- Audit blockworks os-admin: do any component files use `@admin/*` to import other Animus components?
- Survey common Vite project structures: how prevalent are aliased imports between component files?
- Benchmark Option C: what's the latency cost of crossing NAPI for each resolution call? At 196 components with ~3 imports each, that's ~600 NAPI calls.
- Check if the next-plugin has the same gap (likely yes — same Rust resolver).

## Key Files

- `packages/extract/src/import_resolver.rs` — `resolve_bindings()`, `FileModuleInfo`
- `packages/extract/src/project_analyzer.rs` — `resolve_path` closure (line 443), `resolve_relative_path()` (line 784)
- `packages/vite-plugin/src/index.ts` — `packageMap` construction (line 547), `analyzeProject` call (line 380)
