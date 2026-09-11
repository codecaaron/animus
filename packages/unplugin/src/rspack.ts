import { createRspackPlugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';

export const animusRspack = createRspackPlugin(unpluginFactory);

export default animusRspack;
