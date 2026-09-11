// Re-exporting this entry from the main one would pull the generator into
// application bundles. The `.js` specifier is required by node16 ESM.
export {
  type AppearanceBootstrapArtifact,
  type AppearanceBootstrapOptions,
  type AppearanceBootstrapTheme,
  createAppearanceBootstrap,
} from './createAppearanceBootstrap.js';
