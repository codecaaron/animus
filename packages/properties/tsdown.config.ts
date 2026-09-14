import { createConfig } from '../../tsdown.config.base.ts';

// Must stay ESM: the Rust system-loader evaluates this package as an ES module
// and CJS output fails there with "exports is not defined". So it cannot take
// the CJS-only shape that clears `attw --profile node16` — an attw node16
// complaint against this package has no fix at this config.
export default createConfig();
