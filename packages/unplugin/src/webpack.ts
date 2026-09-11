import { createWebpackPlugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';

export const animusWebpack = createWebpackPlugin(unpluginFactory);

export default animusWebpack;
