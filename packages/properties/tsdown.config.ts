import { createConfigWithDeclarations } from '../../tsdown.config.base.ts';

// Must stay ESM: the Rust system-loader evaluates this package as an ES module
// and CJS output fails there with "exports is not defined". So `require()` of
// it stays unsupported, and `attw --profile node16` reports that as
// CJSResolvesToESM; the esm-only profile is its contract.
export default createConfigWithDeclarations();
