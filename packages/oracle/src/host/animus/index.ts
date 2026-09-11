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

export { buildObligations } from './obligations';
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
