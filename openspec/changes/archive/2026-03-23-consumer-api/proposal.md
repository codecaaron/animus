## Why

Building a showcase app revealed that the Vite plugin's consumer API requires workarounds that a real developer would never discover. Two blocking gaps prevent the "happy path":

1. **Config serialization requires private internals.** The Rust pipeline needs serialized `propRegistry` and `groupRegistry`. These are `#private` fields on `AnimusConfig`. The only way to access them is importing from source (`@animus-ui/core/src/config`) and manually spreading group objects — which is what the smoke test does via a test fixture subprocess. No public API exists.

2. **Theme evaluation requires plugin internals.** `evaluateTheme` needs `ssrLoadModule`, which is only available inside Vite's dev server or plugin hooks. A consumer writing `vite.config.ts` has no access to this. The `{ scales, variables }` option works but forces the consumer to figure out HOW to evaluate their theme module — there's no documented, clean path.

The ideal consumer experience is:

```ts
import { animusExtract } from '@animus-ui/vite-plugin';

export default defineConfig({
  plugins: [animusExtract()]
});
```

Zero configuration. The plugin auto-detects the theme, serializes config from `@animus-ui/core`, and handles everything internally.

## What Changes

- **`@animus-ui/core` exports config data publicly**: Export `propRegistry` and `groupRegistry` (or a convenience function `getSerializedConfig()`) from the main index. This gives the plugin (and any consumer) access to the prop→CSS property→scale mapping.
- **Plugin auto-serializes config**: `animusExtract` imports from `@animus-ui/core` at `buildStart` and serializes config automatically. No `config` or `groupRegistry` options needed for default usage.
- **Plugin evaluates theme internally**: Add `themePath?: string` option. During `buildStart`, use Vite's `this.resolve()` + dynamic `import()` (or `ssrLoadModule` when available) to evaluate the theme module and extract both flattened scales and variable CSS. The `theme: string | { scales, variables }` options remain as escape hatches.
- **Auto-detection of theme path**: If no `themePath` is provided, scan for `theme.ts`, `theme.js`, `src/theme.ts`, `src/theme.js` and use the first one found.

## Capabilities

### New Capabilities

_None — this is an API improvement on existing capabilities._

### Modified Capabilities

- `vite-extraction-plugin`: Plugin factory accepts `themePath` option and auto-detects config, theme, and group registry without consumer-provided serialization.

## Impact

- **`packages/core/src/index.ts`**: Export `propRegistry` and `groupRegistry` (or accessor functions)
- **`packages/core/src/config.ts`**: Make registry data accessible without `#private`
- **`packages/vite-plugin/src/index.ts`**: Auto-import config from `@animus-ui/core`, add `themePath` with auto-detection, evaluate theme in `buildStart`
- **`packages/showcase/vite.config.ts`**: Simplify to near-zero config
- **Developer experience**: `animusExtract()` with zero options works out of the box
