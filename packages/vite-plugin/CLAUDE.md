# @animus-ui/vite-plugin — Extraction Plugin

Vite plugin that bridges the Rust extraction crate with the build pipeline. Runs in both dev and production. Loads the design system via subprocess, runs project analysis, serves extracted CSS via virtual module, and transforms source files.

## Plugin Lifecycle

### `buildStart` (runs once on server start / build start)
1. **Load system** — bun subprocess imports the system module, calls `.serialize()`, returns propConfig + groupRegistry + tokens + transforms + globalStyles
2. **Evaluate theme** — `evaluateThemeObject()` flattens token scales, builds CSS variable declarations, builds variable map for token alias resolution
3. **Resolve global styles** — separate bun subprocess resolves prop shorthand in global styles (bg → background-color, etc.) using the full prop config + theme + transforms
4. **Discover files** — recursive directory walk for .ts/.tsx/.js/.jsx
5. **Resolve packages** — finds workspace package sources matching `packagePatterns`
6. **Run analysis** — calls `analyzeProject()` from the Rust crate, produces manifest + CSS

### `resolveId` / `load` (virtual stylesheet)
- Virtual module: `virtual:animus/styles.css` → `\0virtual:animus/styles.css`
- Serves: `[variableCss] + [globalCss] + [resolvedComponentCss]`
- Variable CSS = `:root { --color-*: ... }` + color mode selectors
- Global CSS = `@layer global { reset + global styles }`
- Component CSS = `@layer base/variants/states/system/custom { ... }`

### `transform` (per-file source replacement)
- Replaces builder chains with `createComponent()` calls
- Adds `import 'virtual:animus/styles.css'`
- Uses manifest from `analyzeProject()` for class names and configs

### `handleHotUpdate` (dev HMR)
- Content-hash check skips unchanged files
- **Geological reset:** system/config/theme file change → full reload via subprocess
- CSS module invalidated alongside changed JS modules

## Subprocess Model

The plugin uses bun subprocesses for ESM isolation — the system module and its dependencies can't be imported directly into Vite's CJS plugin context.

| Subprocess | Purpose | When |
|------------|---------|------|
| System load | Import system, call `.serialize()` | buildStart, HMR geological reset |
| Global styles | Resolve prop shorthand with transforms | buildStart (after system load) |
| Transform resolution | Apply `__TRANSFORM__` placeholders | After analysis (if system has named transforms) |

## Vite Cache

**Location:** `node_modules/.vite/`

This cache stores pre-transformed module results. It persists across Vite dev server restarts. When the extraction pipeline changes (new NAPI signatures, new prop config, etc.), the cache may serve stale transforms.

**Fix:** `rm -rf node_modules/.vite/` or `bun run clean:light`

## Known Failure Modes

- **Dev server not reflecting changes:** The dev server holds `buildStart` results in memory. If you change the system file (ds.ts) or the plugin source, restart the dev server. Config/theme changes trigger automatic geological reset via HMR.
- **Vite resolve aliases break transforms:** Adding resolve aliases (e.g., for React) can cause Vite to discard transform hook results. The bundler treats aliased modules differently. Never add resolve aliases for packages used by extracted components.
- **Stale `.vite` cache:** After changing NAPI function signatures or plugin behavior, delete `node_modules/.vite/`. Symptoms: transforms appear correct in plugin logs but bundled output uses old code.
- **Subprocess failures are caught silently:** Global styles resolution and transform resolution catch errors and warn. Check terminal output for `[animus-extract]` warnings.

## Debug Logging

Add `console.log` statements in the plugin source (not the built dist). The plugin runs from `dist/index.mjs` — after editing source, rebuild: `bun run --filter './packages/vite-plugin' build`.

## Configuration

```typescript
animusExtract({
  system: './src/ds.ts',     // SystemInstance module (preferred)
  // OR legacy:
  // configPath: './config.ts',
  // themePath: './theme.ts',
  strict: true,               // Throw on extraction failures (CI)
  packagePatterns: ['@animus-ui/*'],  // Workspace packages to include
})
```
