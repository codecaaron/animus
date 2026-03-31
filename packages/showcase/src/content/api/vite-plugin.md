# Vite Plugin

`animusExtract(options: AnimusExtractOptions): Plugin`

Import from `@animus-ui/vite-plugin` and add to your Vite config. The plugin statically evaluates the system module in a subprocess, extracts all component styles, and emits a single atomic CSS bundle — no runtime style injection.

```typescript
import { animusExtract } from '@animus-ui/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    animusExtract({ system: './src/ds.ts' }),
  ],
});
```

### Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `system` | `string` | Yes | Path to the module exporting your system instance. Resolved relative to the Vite project root. |
| `include` | `string[]` | No | Glob patterns for files to include in the transform pass. Defaults to all `.tsx` and `.ts` files in the project. |
| `exclude` | `string[]` | No | Glob patterns for files to exclude from the transform pass. |
| `strict` | `boolean` | No | Throws a build error if any dynamic (non-static) style value is encountered. |
| `verbose` | `boolean` | No | Logs extraction diagnostics per file during build. Useful for debugging missing styles. |
| `targets` | `string[]` | No | Browser targets passed to Lightning CSS for transpilation during minification. |
| `minify` | `boolean` | No | Runs the output CSS through Lightning CSS for minification. Defaults to `true` in production builds. |
| `prefix` | `string` | No | Class name prefix applied to all generated classes. Defaults to `animus`. |
| `layers` | `string[]` | No | Override the default ordered `@layer` declaration list emitted at the top of the CSS output. |
