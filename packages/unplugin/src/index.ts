/**
 * `@animus-ui/unplugin` — the Animus transform host for non-plugin
 * bundlers (openspec: standalone-extraction-cli, D4/D10). Per-bundler
 * entry points live on subpaths (`./rollup`, `./esbuild`, `./rspack`,
 * `./webpack`); this root exports the unplugin instance and the factory.
 *
 * UNSTABLE MODULE SURFACE: the supported consumer surface is the
 * per-bundler subpath entries. The factory and instance exports exist for
 * the repo's own lanes and tests and may change without semver ceremony
 * until the consumer contract ships (standalone-extraction-cli inc 07).
 */

import { createUnplugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';
export { unpluginFactory };

/** The unplugin instance: `animusUnplugin.rollup(options)`, `.esbuild(…)`,
 *  `.webpack(…)`, `.rspack(…)`. */
export const animusUnplugin = createUnplugin(unpluginFactory);

export default animusUnplugin;
