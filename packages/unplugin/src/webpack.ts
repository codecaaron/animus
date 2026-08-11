/**
 * webpack entry: `import Animus from '@animus-ui/unplugin/webpack'`.
 * The dev-signal define is applied via the compiler's own DefinePlugin;
 * the host transform is registered `enforce: 'pre'` so it precedes
 * TS/JSX transpilation loaders.
 */

import { createWebpackPlugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';

/** Named beside default: keeps the CJS emission on the `exports.default`
 *  interop shape (attw node16). */
export const animusWebpack = createWebpackPlugin(unpluginFactory);

export default animusWebpack;
