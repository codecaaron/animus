import { createConfig } from '../../tsdown.config.base.ts';

// Must stay ESM: the Rust system-loader evaluates this package as an ES module
// and CJS output fails there with "exports is not defined".
export default createConfig();
