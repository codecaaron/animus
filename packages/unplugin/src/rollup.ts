/**
 * Rollup entry: `import animus from '@animus-ui/unplugin/rollup'`.
 * ORDERING: list this plugin BEFORE any TS/JSX transpiler — the engine
 * parses raw TSX (rollup has no enforce ordering).
 */

import { createRollupPlugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';

/** Named beside default: keeps the CJS emission on the `exports.default`
 *  interop shape (attw node16 — a lone default compiles to a bare
 *  `module.exports =` that contradicts the declaration). */
export const animusRollup = createRollupPlugin(unpluginFactory);

export default animusRollup;
