# @animus-ui/unplugin

Animus transform host for non-plugin bundlers — rollup, esbuild, rspack,
and webpack entry points over the one extraction session. Transforms
`@animus-ui/system` builder chains into static CSS at build time, delivers
the stylesheet as a real emitted asset (`animus.css`), and supplies the
`__ANIMUS_DEV__` define.

Vite users: use [`@animus-ui/vite-plugin`](../vite-plugin). Next.js users:
use [`@animus-ui/next-plugin`](../next-plugin). The root export's reachable
`.vite` adapter is **unsupported** — the supported surface is exactly the
four subpath entries below.

## Install

```bash
npm install --save-dev @animus-ui/unplugin
npm install @animus-ui/system
```

Requires Node `>=22.12.0`. Native engine binaries ship for darwin-arm64,
linux-x64-gnu, and linux-arm64-gnu.

## Setup (rollup)

<!-- source lane: e2e/rollup-app/rollup.config.mjs (lane pinning removed); verified by running the lane build and the genericized shape against the lane sources — both exit 0 and emit animus.css -->

```js
// rollup.config.mjs — ESM configs use the NAMED export.
import { animusRollup as animus } from '@animus-ui/unplugin/rollup';
import esbuild from 'rollup-plugin-esbuild';

export default {
  input: 'src/entry.tsx',
  plugins: [
    // The host FIRST: its transform must see raw TSX (rollup has no
    // enforce ordering — config order is the law).
    animus({ system: './src/ds.ts', strict: true }),
    esbuild({ jsx: 'automatic', target: 'es2022' }),
  ],
  output: { dir: 'dist', format: 'esm' },
};
```

The other bundlers follow the same shape from their own subpaths:
`animusEsbuild` from `@animus-ui/unplugin/esbuild`, `animusRspack` from
`@animus-ui/unplugin/rspack`, `animusWebpack` from
`@animus-ui/unplugin/webpack`. In CJS config files use the default export:

<!-- source lane: package export shape proven by e2e/rollup-app; verified by running `node -e "require('@animus-ui/unplugin/rollup').default"` from the lane (a function) -->

```js
// CJS config files:
const animus = require('@animus-ui/unplugin/rollup').default;
```

A Node-ESM **default** import of the CJS build binds the exports object,
not the plugin function — in ESM configs, always use the named export.

## Plugin ordering

The extraction engine parses **raw TSX** — this host's transform must run
before any TS/JSX transpilation. `enforce: 'pre'` orders webpack and rspack
loader chains automatically; **rollup consumers must list this plugin
before their transpiler** in the config. Mis-ordered builds emit a
source-drift warning (`transform-time source … differs from analyze-time
source`) followed by a bundler parse error on TSX syntax — move the Animus
plugin first to fix it.

## What it does

- Runs the one `ExtractionSession` at `buildStart` inside your bundler's
  process; per-file transforms come from retained engine state. Analysis
  failure is build failure — never a silent passthrough.
- Resolves the stylesheet id (`.animus/styles.css`), the system-props id,
  and one redirect per admitted design-system kit specifier to the exact
  entry extraction analyzed. tsconfig `paths` are the alias source.
- Emits the extracted stylesheet as a real `animus.css` asset (for esbuild:
  written into `outdir`, or beside `outfile`).
- Supplies the `__ANIMUS_DEV__` dev-signal define through each bundler's
  own mechanism.

## Options

Options are the shared driver core (`system`, `exclude`, `strict`, `mode`,
`targets`, `minify`, …); unknown keys fail loud. `mode`
(`'development' | 'production'`) selects **emission only** — the minify
default, the dev-signal define, engine dev diagnostics — never process
lifecycle. When absent, the bundler's own command oracle applies (webpack/
rspack `compiler.options.mode`, rollup watch mode), else `production`
(esbuild exposes no signal). `exclude` patterns are glob-aware and MERGE
with the defaults (`node_modules`, `dist`, `.test.`, `.spec.`, `.next`,
`.animus`).

The full consumer contract — module-id families, the define contract,
artifact set, platform matrix — lives in the
[standalone extraction contract](https://github.com/codecaaron/animus/blob/main/docs/standalone-extraction.md).

## License

MIT
