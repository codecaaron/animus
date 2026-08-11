/**
 * esbuild entry: `import animus from '@animus-ui/unplugin/esbuild'`.
 * The dev-signal define rides `build.initialOptions.define`; the emitted
 * stylesheet is written into `outdir` (or beside `outfile`).
 */

import { createEsbuildPlugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';

/** Named beside default: keeps the CJS emission on the `exports.default`
 *  interop shape (attw node16). */
export const animusEsbuild = createEsbuildPlugin(unpluginFactory);

export default animusEsbuild;
