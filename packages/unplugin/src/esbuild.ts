import { createEsbuildPlugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';

export const animusEsbuild = createEsbuildPlugin(unpluginFactory);

export default animusEsbuild;
