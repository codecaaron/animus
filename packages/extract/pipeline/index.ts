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
  assertSupportedEngine,
  RETIRED_ENGINE_MESSAGE,
} from './engine-retirement';
export type { AssetCopy } from './asset-copies';
export { pruneStaleAssets, writeAssetCopy } from './asset-copies';
export { contentHash } from './content-hash';
export {
  assertRuntimeImportSuppliesTerminals,
  DEFAULT_RUNTIME_IMPORT,
} from './runtime-import';
export type { DiscoveryResolver, HostResolve } from './host-package-resolver';
export { AliasAgreementCache, compareAliases } from './alias-agreement';
export type { AliasAgreement } from './alias-agreement';
export { discoveryResolver } from './host-package-resolver';
export type { OutputTargets } from './output-targets';
export {
  analysedOutputs,
  esbuildOutputTargets,
  mergeOutputTargets,
  noOutputTargets,
  outputExclusions,
  rollupOutputTargets,
  viteOutputTargets,
  webpackOutputTargets,
} from './output-targets';
export type {
  AnimusCoreOptions,
  ClosedDynamicImport,
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
  outputExclusion,
  outputSourceGuard,
  outputSourceMessage,
  REPLACEABLE_DEFAULT_EXCLUDE,
  STRUCTURAL_EXCLUDE,
  resolveMode,
  resolveVerbosity,
  unmatchedExcludeLines,
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
  bareSpecifierPackageName,
  collectExternalPackageSources,
  engineModuleParser,
  excludeCollectedPackages,
  extractSystemFilePackages,
  fileSideEffects,
  findPackageRoot,
  nativeKitSourceRoot,
  nativePackageLocator,
  keepsKitSourceEffects,
  kitSourceModuleSideEffects,
  firstOwners,
  importedKitDiagnostics,
  isExcludedPackageRelativePath,
  probeAbsolutePathSpecifier,
  sourceKitDependencies,
  systemKitDependencies,
  staleDistIncludesMessage,
  unresolvableIncludesMessage,
  walkPackageSources,
} from './discover-packages';
export { caseMismatchReason } from './extension-policy';
export type { KitDescriptor, KitDescriptorRecord } from './kit-descriptor';
export {
  buildKitDescriptor,
  KIT_DESCRIPTOR_FILE,
  kitDescriptorDiagnostics,
  readKitDescriptor,
} from './kit-descriptor';
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
export type { SystemConfig, SystemLoadReads } from './system-config';
export { loadSystemConfig, systemLoadReads } from './system-config';
export type { HostExtensionPolicy } from './host-extensions';
export {
  BUILT_IN_EXTENSION_POLICY,
  esbuildExtensionPolicy,
  extensionPolicyJson,
  rollupExtensionPolicy,
  turbopackExtensionPolicy,
  viteExtensionPolicy,
  webpackExtensionPolicy,
} from './host-extensions';
export type { WorkspacePackages } from './workspace-packages';
export { declaredWorkspacePackages } from './workspace-packages';
export type { StructuralCheckInput } from './structural-self-check';
export { runStructuralSelfCheck } from './structural-self-check';
export { buildSystemPropsModule } from './system-props-module';
export { readTsconfigAliasPairs, tsconfigChainPaths } from './tsconfig-paths';
export type {
  DynamicPropConfigEntry,
  DynamicPropMeta,
} from './dynamic-prop-config';
export { buildDynamicPropConfig } from './dynamic-prop-config';
export type { CssDiagnosticLike } from './error-diagnostics';
export { assertNoErrorDiagnostics } from './error-diagnostics';
export type {
  ManifestComponentDescriptor,
  ManifestMissingInput,
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
  REGISTRATION_UNREACHED,
  REGISTRATION_UNPROVED,
  AUDIT_INCOMPLETE,
  loadFindingDiagnostics,
  surfaceManifestDiagnostics,
  isDeletedSource,
  noKitFilesDiagnostics,
  unreadableSourceDiagnostic,
  VOCABULARY_COLLISION,
  VOCABULARY_LEGACY_VERB,
  systemLoadDiagnostics,
  vocabularyWitnessDiagnostics,
} from './manifest-diagnostics';
export type {
  DefaultExtension,
  MdxUsageSourceResult,
} from './mdx-preprocessor';
export {
  DEFAULT_EXTENSIONS,
  ENGINE_TRANSFORM_EXTENSIONS,
  isEngineTransformExtension,
  mdxUsageSource,
} from './mdx-preprocessor';
export { kitPublicationFailures } from './kit-publication';
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
export type { IngestionOpening } from './source-ingestion';
export {
  builtInAssetClassification,
  esbuildAssetClassification,
  nextImageAssetClassification,
  viteAssetClassification,
} from './host-assets';
export type { HostAssetClassification } from './host-assets';
export { viteHostExpander, viteLoadExpander } from './vite-expansions';
export { webpackHostExpander, webpackLoadExpander } from './webpack-expansions';
export type {
  WebpackOptionsReading,
  WebpackResolveReading,
  WebpackRuleEntry,
  WebpackRuleReading,
} from './webpack-expansions';
export type {
  ExpandedPath,
  HostLoadExpander,
  ListedArgs,
  ListedLoad,
} from './host-expansions';
export { adaptedOriginals } from './probe-evidence';
export type { ServedFiles } from './served-files';
export { droppedExtensionMessage, servedFiles } from './served-files';
