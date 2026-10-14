import { createUnplugin } from 'unplugin';

import { unpluginFactory } from './core';

export type { AnimusUnpluginOptions } from './options';
export { renderFontPreloads } from '@animus-ui/extract/pipeline';
export type { FontPreload } from '@animus-ui/extract/pipeline';
export { FONT_PRELOADS_ASSET_NAME } from './core';
export { unpluginFactory };

export const animusUnplugin = createUnplugin(unpluginFactory);

export default animusUnplugin;
