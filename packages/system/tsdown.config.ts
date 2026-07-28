import { createConfig } from '../../tsdown.config.base.ts';

export default createConfig({
  entry: [
    './src/index.ts',
    './src/groups/index.ts',
    // Build-tooling-only entry: the appearance bootstrap generator. Isolated
    // from the component entries on purpose (spec: bootstrap entry-point
    // isolation) so extracted bundles never gain its storage-access code.
    './src/bootstrap/index.ts',
    './src/runtime-entry.ts',
    './src/compose.ts',
    './src/composeWithContext.ts',
  ],
});
