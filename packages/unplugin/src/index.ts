import { createUnplugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';
export { unpluginFactory };

export const animusUnplugin = createUnplugin(unpluginFactory);

export default animusUnplugin;
