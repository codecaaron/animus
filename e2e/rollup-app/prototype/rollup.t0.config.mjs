import { resolve } from 'node:path';

import { animusT0 } from './animus-t0-plugin.mjs';
import { lane, sharedConfig } from './rollup.shared.mjs';

export default sharedConfig(
  animusT0({ root: lane, system: './src/ds.ts' }),
  resolve(lane, 'prototype/out/t0-bundle.mjs')
);
