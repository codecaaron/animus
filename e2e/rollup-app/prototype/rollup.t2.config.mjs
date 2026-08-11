import { resolve } from 'node:path';

import { animusT2 } from './animus-t2-plugin.mjs';
import { lane, sharedConfig } from './rollup.shared.mjs';

export default sharedConfig(
  animusT2({ root: lane, system: './src/ds.ts' }),
  resolve(lane, 'prototype/out/t2-bundle.mjs')
);
