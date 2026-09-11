import { createRollupPlugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';

export const animusRollup = createRollupPlugin(unpluginFactory);

export default animusRollup;
