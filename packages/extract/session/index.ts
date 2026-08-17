/**
 * `@animus-ui/extract/session` — the artifact-publishing extraction
 * session and its watcher orchestration, factored out of the Next plugin
 * (openspec: standalone-extraction-cli, D1). Every driver — the Next
 * plugin, the standalone CLI, the transform host — is a thin shell over
 * this one drive loop; none may fork it.
 *
 * UNSTABLE SURFACE: this subpath exists for Animus's own drivers; its
 * exports are the driver-consumed surface only (deliberately narrower than
 * the session modules — internal state mutators, envelope encoders, and
 * test seams stay off the published API) and may change without semver
 * ceremony until the standalone CLI ships its consumer contract
 * (standalone-extraction-cli inc 03/07).
 */
export { ExtractionSession, pruneStaleAssets } from './extraction-session';
export type { SessionOptions, WatchChanges } from './extraction-session';
export {
  collectSessionAssets,
  decodeCommitRecord,
  isLockHolderAlive,
  readCliLockRecord,
  verifyCommitRecord,
} from './published-set';
export type {
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
  getSharedSystemProps,
  setAnalysisStartedPromise,
  setSharedEngine,
} from './singleton';
