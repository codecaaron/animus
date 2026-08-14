import { createConfig } from '../../tsdown.config.base.ts';

export default createConfig({
  entry: [
    './src/index.ts',
    './src/groups/index.ts',
    // Build-tooling-only entry: the appearance bootstrap generator. Isolated
    // from the component entries on purpose (spec: bootstrap entry-point
    // isolation) so extracted bundles never gain its storage-access code.
    './src/bootstrap/index.ts',
    // Runtime CLIENT entry: the appearance record write path. Ships in app
    // bundles; imports nothing from ./bootstrap (which reaches node:crypto).
    './src/appearance/index.ts',
    // Framework-neutral `.asClass()` runtime. Kept separate from runtime-entry
    // because that entry also exports React component factories.
    './src/class-resolver.ts',
    './src/runtime-entry.ts',
    './src/compose.ts',
    './src/composeWithContext.ts',
  ],
});
