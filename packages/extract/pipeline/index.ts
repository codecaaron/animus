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
export type {
  AnimusCoreOptions,
  AnimusMode,
  DriverNamespace,
  ExcludeMatcher,
  OptionProvenance,
  ResolvedMode,
  Verbosity,
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
  resolveVerbosity,
} from './core-options';
export { compareDiscoveryOrder, discoverFiles } from './discover-files';
export type {
  CollectedExternalPackages,
  ExternalPackageOutcome,
  ModuleParser,
  ModuleRecord,
  SourceKitDependency,
} from './discover-packages';
export {
  collectExternalPackageSources,
  engineModuleParser,
  excludeCollectedPackages,
  extractSystemFilePackages,
  findPackageRoot,
  firstOwners,
  importedKitPackages,
  isExcludedPackageRelativePath,
  resolveAbsolutePathSpecifier,
  sourceKitDependencies,
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
  SerializedSourceEntry,
  SourceEntryOwnership,
  SourceIngestionDiagnostic,
  SourceIngestionOptions,
  SourceIngestionResult,
  SourceParserDiagnostic,
} from './source-ingestion';
export {
  ingestSourceEntries,
  isAdvisorySourceDiagnostic,
  parseFilesJson,
  projectExternalFileOwners,
} from './source-ingestion';
export type { SourceIngestor, SourceIngestorHost } from './source-ingestion';
export { createSourceCorpus } from './source-corpus';
export type {
  PublishedSourceCorpus,
  SourceCorpus,
  SourceCorpusCache,
} from './source-corpus';
export {
  findAssetSpecifiers,
  findSheetAssetSpecifiers,
  generatedModuleCode,
  reportSurvivingAssetPlaceholders,
  substituteAssetPlaceholders,
  substituteSheetAssets,
} from './asset-placeholders';
export type { AssetSheets } from './asset-placeholders';
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
export { readTsconfigAliasPairs } from './tsconfig-paths';
export type {
  DynamicPropConfigEntry,
  DynamicPropMeta,
} from './dynamic-prop-config';
export { buildDynamicPropConfig } from './dynamic-prop-config';
export type { CssDiagnosticLike } from './error-diagnostics';
export { assertNoErrorDiagnostics } from './error-diagnostics';
export type {
  ManifestComponentDescriptor,
  ManifestComponentSheets,
  ManifestSheets,
  ProjectManifest,
} from './manifest-schema';
export type {
  DiagnosticLevel,
  DiagnosticLevels,
  ManifestDiagnostic,
} from './manifest-diagnostics';
export {
  DIAGNOSTIC_LEVELS,
  DiagnosticFailure,
  INVALID_PROPERTY_REGISTRATION,
  isUnresolvedParentDrop,
  surfaceManifestDiagnostics,
  isDeletedSource,
  noKitFilesDiagnostics,
  unreadableSourceDiagnostic,
  unresolvedParentName,
  VOCABULARY_COLLISION,
  VOCABULARY_LEGACY_VERB,
  systemLoadDiagnostics,
  vocabularyWitnessDiagnostics,
} from './manifest-diagnostics';
export type { DefaultExtension, PreprocessMdxResult } from './mdx-preprocessor';
export {
  DEFAULT_EXTENSIONS,
  ENGINE_TRANSFORM_EXTENSIONS,
  isEngineTransformExtension,
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
export { camelToKebab, stableStringify } from './utils';
export { toWatchKeys } from './watch-keys';
