/**
 * rspack entry: `import Animus from '@animus-ui/unplugin/rspack'`.
 * Mirrors the webpack wiring (DefinePlugin define, `enforce: 'pre'`
 * loader ordering) over rspack's webpack-compatible surface.
 */

import { createRspackPlugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';

/** Named beside default: keeps the CJS emission on the `exports.default`
 *  interop shape (attw node16). */
export const animusRspack = createRspackPlugin(unpluginFactory);

export default animusRspack;
