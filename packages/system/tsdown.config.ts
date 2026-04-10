import { createConfig } from '../../tsdown.config.base';

export default createConfig({
  entry: [
    './src/index.ts',
    './src/groups/index.ts',
    './src/runtime-entry.ts',
    './src/compose.ts',
    './src/composeWithContext.ts',
  ],
});
