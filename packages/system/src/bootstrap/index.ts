// Dedicated bootstrap entry (`@animus-ui/system/bootstrap`).
//
// Build-tooling surface only: nothing here is re-exported from the main or
// `/groups` entries, so the generator and its storage-access code can never
// reach an extracted application bundle.
// The `.js` extension is REQUIRED: tsc preserves this specifier verbatim into
// `dist/bootstrap/index.d.ts`, and an extensionless relative specifier fails
// node16-ESM type resolution (attw DEF-5 bounded gate in verify:packed). Same
// convention as `./conditions.js` in the main entry.
export {
  type AppearanceBootstrapArtifact,
  type AppearanceBootstrapOptions,
  type AppearanceBootstrapTheme,
  createAppearanceBootstrap,
} from './createAppearanceBootstrap.js';
