// Named import: the dual-format host ships CJS for both conditions (attw
// node16 shape), and a Node-ESM default import of CJS binds the exports
// OBJECT — the named export is the sanctioned ESM-config spelling
// (`require('@animus-ui/unplugin/rollup').default` covers CJS configs).
import { animusRollup as animus } from '@animus-ui/unplugin/rollup';
// The lane's REAL consumer build: rollup through the published transform
// host (openspec: standalone-extraction-cli inc 05 — the prototype/ dir is
// retained as the DEF-1 measurement record; THIS config is the product
// path). The host supplies the __ANIMUS_DEV__ define, the stylesheet and
// system-props resolution, the kit-specifier redirects, and emits the
// stylesheet as a real asset (dist/animus.css).
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'rollup-plugin-esbuild';

const lane = dirname(fileURLToPath(import.meta.url));

export default {
  input: resolve(lane, 'src/entry.tsx'),
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [
    // The host FIRST: its transform must see raw TSX (the engine parses
    // source; rollup has no enforce ordering — config order is the law).
    animus({
      root: lane,
      system: './src/ds.ts',
      strict: true,
      // Emission inputs PINNED (D6/D10, the inc 04 parity lesson): the
      // CLI-vs-host payload-parity assert compares bytes, so the host and
      // the `animus build` step must agree on mode and exclusions.
      mode: 'production',
      exclude: ['fixtures/**'],
    }),
    esbuild({ jsx: 'automatic', target: 'es2022' }),
    nodeResolve({ extensions: ['.mjs', '.js', '.ts', '.tsx'] }),
    commonjs(),
  ],
  // dir output: the host emits the stylesheet asset alongside the bundle.
  output: {
    dir: resolve(lane, 'dist'),
    entryFileNames: 'bundle.mjs',
    format: 'esm',
  },
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  },
};
