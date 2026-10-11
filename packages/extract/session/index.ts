export { COALESCING_WINDOW_MS, CoalescingWindow } from './coalescing-window';
export type { WindowClock, WindowTimer } from './coalescing-window';
export { pruneStaleAssets } from '../pipeline/asset-copies';
export { ExtractionSession } from './extraction-session';
export type {
  SessionHost,
  SessionOptions,
  SessionOutcome,
  SessionPublication,
  WatchChanges,
} from './extraction-session';
export {
  checkLockLiveness,
  CLI_LOCK_HEARTBEAT_INTERVAL_MS,
  CLI_LOCK_STALE_AFTER_MS,
  collectSessionAssets,
  decodeCommitRecord,
  holdDirectoryClaim,
  isLockHolderAlive,
  lockRecordBytes,
  readCliLockRecord,
  verifyCommitRecord,
} from './published-set';
export type {
  CliLockLiveness,
  CliLockRecord,
  CommitRecord,
  SessionAsset,
} from './published-set';
export {
  analysisCommitPath,
  analysisInputsPath,
  analysisStatusPath,
  ANIMUS_ARTIFACT_DIR,
  ANIMUS_CSS_MODULE_ID,
  CLI_COMMIT_ARTIFACT,
  CLI_LOCK_ARTIFACT,
  MANIFEST_ARTIFACT,
  manifestPath,
  readJsonEnvelope,
  replacementEpochPath,
  SESSION_ASSETS_DIR,
  sessionArtifactDir,
  STYLES_ARTIFACT,
  stylesPath,
  SYSTEM_PROPS_ARTIFACT,
  systemPropsPath,
  TURBOPACK_SYSTEM_PROPS_ID,
} from './session-paths';
export type {
  AnalysisCommit,
  AnalysisStatus,
  SessionEnvelope,
} from './session-paths';
export {
  runSessionPipeline,
  startTurbopackWatcher,
} from './turbopack-orchestrator';
export type {
  TurbopackWatcherHandle,
  TurbopackWatchOutcome,
} from './turbopack-orchestrator';
export {
  engineApi,
  getAnalysisStartedPromise,
  getAnalyzedHashes,
  getManifestJson,
  getReplacementEpoch,
  getSessionArtifactDir,
  getSharedCss,
  getSharedExternalDirs,
  getSharedExternalEntries,
  getSharedExternalSideEffects,
  getSharedSystemProps,
  resetAnalysisStartedPromise,
  setAnalysisStartedPromise,
  createBuildId,
  engineFactory,
  engineHandle,
  releaseEngineHandle,
  EnvironmentFailure,
  findSession,
  joinSession,
  requireEngine,
  SessionConfigurationConflict,
  sessionKey,
} from './singleton';
export type {
  EngineHandleOptions,
  SessionKey,
  SessionState,
} from './singleton';
