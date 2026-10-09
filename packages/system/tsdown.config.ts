import { createConfigWithDeclarations } from '../../tsdown.config.base.ts';

export default createConfigWithDeclarations({
  entry: [
    './src/index.ts',
    './src/groups/index.ts',
    // A separate entry: its storage-access code must not reach app bundles.
    './src/bootstrap/index.ts',
    // Ships in application bundles, so it must import nothing from
    // ./bootstrap, which reaches node:crypto.
    './src/appearance/index.ts',
    './src/class-resolver.ts',
    './src/runtime-entry.ts',
    './src/compose.ts',
    './src/composeWithContext.ts',
  ],
});
