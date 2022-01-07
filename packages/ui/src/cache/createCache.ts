import createEmotionCache, { Options, StylisPlugin } from '@emotion/cache';
import { prefixer } from 'stylis';

import { focusVisible } from './plugins/focusVisisble';

export const createCache = (overrides?: Partial<Options>) =>
createEmotionCache({
    key: 'animus',
    speedy: process.env.NODE_ENV !== 'development',
    ...overrides,
    stylisPlugins: [
      ...(overrides?.stylisPlugins ?? []),
      focusVisible,
      prefixer as StylisPlugin,
    ],
  });
