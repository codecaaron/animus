/**
 * The animus host adapter (DESIGN §11) — the real provider implementation over
 * an extraction run's emitted artifacts.
 *
 * Engine-free by design: `manifest.json` and the emitted stylesheet already
 * contain every rule that can exist, the condition under which it applies, and
 * the source construct that produced it. That closure is what the oracle's
 * whole value rests on (DESIGN §0), so the adapter's job is to read it
 * faithfully and to be loud about the places where it stops — unmodeled CSS
 * constructs throw `AnimusAdapterError`, and the modeled-but-underdetermined
 * ones (host-tree shape, container geometry, dynamic values, runtime writes)
 * leave the boundary as declared obligations rather than as guesses.
 */

export {
  conditionFor,
  containerDimension,
  cutsOfPredicates,
  dimensionOf,
  MODE_DIMENSION,
  predicateOf,
  PSEUDO_STATE_EXCLUSION,
  VIEWPORT_DIMENSION,
} from './conditions';
export { parseDeclarations, parseStylesheet, splitTopLevel } from './css-parse';
export type {
  AtCondition,
  FontFaceBlock,
  KeyframesBlock,
  LayerStatement,
  ParsedDeclaration,
  ParsedRule,
  ParsedStylesheet,
} from './css-parse';

export {
  createAnimusDependencies,
  componentDependency,
  fileDependency,
  manifestDependency,
  ruleDependency,
  tokenDependency,
} from './dependency';
export type { AnimusDependencyInput } from './dependency';

export { AnimusAdapterError } from './errors';
export type { AnimusAdapterErrorContext } from './errors';

export { createAnimusHost } from './host';
export type { AnimusHost, AnimusHostInput, AnimusHostOptions } from './host';

export { classesAtPoint, createAnimusIdentity } from './identity';
export type { AnimusIdentityInput } from './identity';

export {
  COMMIT_FILE,
  loadAnimusArtifacts,
  MANIFEST_FILE,
  STYLESHEET_FILE,
} from './loader';

export { asManifest } from './manifest-types';
export type {
  AnimusManifest,
  ManifestChain,
  ManifestComponent,
  ManifestDynamicProp,
  ManifestSheets,
  ManifestUsageResidue,
} from './manifest-types';

export { buildObligations, MANIFEST_ORIGIN } from './obligations';
export type { AnimusObligationInput } from './obligations';

export { parseComponents, parseConfig } from './replacement';
export type {
  CompoundConfig,
  ParsedComponent,
  ReplacementConfig,
  VariantConfig,
} from './replacement';

export {
  componentDimensions,
  createAnimusScenarios,
  DEFAULT_VIEWPORT_MAX,
  DEFAULT_VIEWPORT_MIN,
  dimensionOwners,
  stateDimension,
  variantDimension,
} from './scenario';
export type { AnimusScenarioInput } from './scenario';

export { analyzeSelector, splitSelectorList } from './selector';
export type { AnalyzedSelector, SelectorClassification } from './selector';

export { createAnimusTokens, ROOT_MODE } from './tokens';
export type { AnimusTokens, Breakpoint } from './tokens';

export { buildUniverse, findChain } from './universe';
export type { UniverseBuild, UniverseRule } from './universe';
