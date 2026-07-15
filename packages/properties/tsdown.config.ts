import { createConfig } from '../../tsdown.config.base.ts';

// ESM output. properties MUST stay ESM: the Rust system-loader (rquickjs)
// resolves this package's `import`/`default` condition and evaluates it as an
// ES module while loading a SystemInstance (see packages/extract/tests/
// canary.test.ts `loadSystemModule` — CJS output there fails with
// "exports is not defined"). This is why properties cannot adopt the CJS-only
// shape that clears `attw --profile node16`; see this increment's Output
// contract for the blocker.
export default createConfig();
