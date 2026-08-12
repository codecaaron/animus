export type {
  AssembleStylesheetOptions,
  AssembleStylesheetParts,
} from './assemble-stylesheet';
export {
  ANIMUS_LAYERS,
  assembleStylesheet,
  stripLeadingLayerDeclaration,
  validateLayerOrder,
} from './assemble-stylesheet';
export type {
  AnalyzeProjectArgs,
  AnalyzeProjectInputs,
} from './analyze-project-args';
export { buildAnalyzeProjectArgs } from './analyze-project-args';
export type {
  EngineApi,
  TransformFileResult,
  V2EngineAdapterDeps,
  V2EngineStateStore,
  V2ExtractEngine,
} from './engine-adapter';
export { createV2EngineApi } from './engine-adapter';
export {
  assertNoRetiredEngineSelection,
  RETIRED_ENGINE_MESSAGE,
} from './engine-retirement';
export { contentHash } from './content-hash';
export {
  KEYFRAMES_EXPORT_COLLISION,
  KEYFRAMES_EXTERNAL_ENTRY_FAILED,
  mergeExternalKeyframes,
} from './external-keyframes';
export type { ExternalKeyframesMerge } from './external-keyframes';
export type {
  AnimusCoreOptions,
  AnimusMode,
  DriverNamespace,
  ExcludeMatcher,
  OptionProvenance,
  ResolvedMode,
} from './core-options';
export {
  AnimusConfigError,
  assertKnownOptionKeys,
  CORE_OPTION_KEYS,
  createExcludeMatcher,
  DEFAULT_EXCLUDE,
  DRIVER_NAMESPACES,
  REPLACEABLE_DEFAULT_EXCLUDE,
  STRUCTURAL_EXCLUDE,
  resolveMode,
} from './core-options';
export { discoverFiles } from './discover-files';
export type {
  CollectedExternalPackages,
  ExternalPackageOutcome,
} from './discover-packages';
export {
  collectExternalPackageSources,
  excludeCollectedPackages,
  extractSystemFilePackages,
  findPackageRoot,
  firstOwners,
  isExcludedPackageRelativePath,
  resolveAbsolutePathSpecifier,
  staleDistIncludesMessage,
  unresolvableIncludesMessage,
  walkPackageSources,
} from './discover-packages';
export type { ResolvedSourceId, SourceIdentity } from './source-identity';
export {
  createSourceIdentity,
  isPathWithinRoot,
  sharesVolumeRoot,
} from './source-identity';
export type {
  AdaptSvelteSourceResult,
  AdaptSvelteSourceOptions,
  SourceLocation,
  SourcePosition,
  SourceSpan,
  SvelteAdapterDiagnostic,
  SvelteOriginMapping,
  SvelteOriginMappingKind,
  SvelteResolverAccess,
  SvelteResolverAttribution,
  SvelteResolverAttributionRequest,
  SvelteResolverImportKind,
  SvelteScriptScope,
  SvelteSourceOrigin,
  SvelteVirtualEntry,
} from './svelte-source-adapter';
export { adaptSvelteSource } from './svelte-source-adapter';
export type {
  AnalysisSourceEntry,
  ExtractChainFact,
  ExtractExportFact,
  ExtractFactsResult,
  ExtractFileFacts,
  ExtractImportFact,
  NativeSourceDiagnostic,
  OriginalSourceEntry,
  RawSourceEntry,
  SourceEntryOwnership,
  SourceIngestionDiagnostic,
  SourceIngestionOptions,
  SourceIngestionResult,
  SourceParserDiagnostic,
} from './source-ingestion';
export {
  ingestSourceEntries,
  isAdvisorySourceDiagnostic,
  withoutInvalidOriginals,
} from './source-ingestion';
export {
  findAssetSpecifiers,
  substituteAssetPlaceholders,
} from './asset-placeholders';
export { resolveAssetFile, resolveThroughPathAliases } from './resolve-asset';
export { enforceExternalTokenContracts } from './correlate-external-tokens';
export { buildPathAliasesJson } from './path-aliases';
export type { LightningTargets } from './post-process-css';
export { postProcessCss, resolveLightningTargets } from './post-process-css';
export type {
  AnalysisOptions,
  EmitterConfig,
  ProjectAnalysisResult,
} from './run-analysis';
export {
  buildAnalysisInputs,
  clearEngineCache,
  runProjectAnalysis,
} from './run-analysis';
export type { StaticCssComponentOverride, StaticCssConfig } from './static-css';
export { serializeStaticCss } from './static-css';
export type { SystemConfig } from './system-config';
export { loadSystemConfig } from './system-config';
export type { StructuralCheckInput } from './structural-self-check';
export { runStructuralSelfCheck } from './structural-self-check';
export { buildSystemPropsModule } from './system-props-module';
export { formatRustTimingWaterfall } from './timing-waterfall';
export { readTsconfigAliasPairs } from './tsconfig-paths';
export type {
  DynamicPropConfigEntry,
  DynamicPropMeta,
} from './dynamic-prop-config';
export { buildDynamicPropConfig } from './dynamic-prop-config';
export type { CssDiagnosticLike } from './error-diagnostics';
export { assertNoErrorDiagnostics } from './error-diagnostics';
export type { ManifestDiagnostic } from './manifest-diagnostics';
export {
  isUnresolvedParentDrop,
  surfaceManifestDiagnostics,
  unresolvedParentName,
} from './manifest-diagnostics';
export type { DefaultExtension, PreprocessMdxResult } from './mdx-preprocessor';
export {
  DEFAULT_EXTENSIONS,
  ENGINE_TRANSFORM_EXTENSIONS,
  preprocessMdx,
} from './mdx-preprocessor';
export { applyPrefix } from './prefix';
export type { FilePlanSnapshot } from './replacement-plans';
export {
  diffFilePlans,
  hashReplacementPlans,
  snapshotFilePlans,
} from './replacement-plans';
export { applyUnitFallback } from './unit-fallback';
export { camelToKebab } from './utils';
export { toWatchKeys } from './watch-keys';
