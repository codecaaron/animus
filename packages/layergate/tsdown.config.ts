import { createConfigWithDeclarations } from '../../tsdown.config.base.ts';

// Dual format: Vite configs and the Animus plugins that load the adapter
// are CJS as often as ESM.
export default createConfigWithDeclarations({
  entry: ['./src/index.ts', './src/vite.ts'],
  format: ['esm', 'cjs'],
  platform: 'node',
});
