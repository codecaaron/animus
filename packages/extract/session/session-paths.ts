import { join } from 'path';

/**
 * Session-scoped artifact names, path derivations, and the analysis-status
 * shape (openspec: next-turbopack-served-transform-coherence, design D1–D3)
 * — shared by the session writer (extraction-session), the webpack
 * plugin/loader, and the Turbopack loader.
 *
 * Deliberately free of singleton/session imports: the Turbopack loader
 * executes in isolated worker processes and its module graph must stay
 * worker-local (guardrail G1) — this module is pure path/shape vocabulary.
 */

/** Session-dir-relative name of the replacement-epoch disk witness
 *  (openspec: next-webpack-served-transform-coherence, design D2;
 *  session-scoped by next-turbopack-served-transform-coherence D2). */
export const REPLACEMENT_EPOCH_ARTIFACT = 'replacements-epoch';

/** Virtual module id of the emitted system-props module — session
 *  vocabulary shared by the orchestrator and the Turbopack config
 *  assembly (hoisted here so the session home stays framework-free). */
export const TURBOPACK_SYSTEM_PROPS_ID = 'virtual:animus/system-props';

/** Session-dir-relative name of the analysis-commit transaction artifact
 *  (design D1). */
export const ANALYSIS_COMMIT_ARTIFACT = 'analysis-commit';

/** Session-dir-relative name of the analysis-status artifact (design D3). */
export const ANALYSIS_STATUS_ARTIFACT = 'analysis-status.json';

/** Session-dir-relative name of the manifest payload artifact. */
export const MANIFEST_ARTIFACT = 'manifest.json';

/** Session-dir-relative name of the analysis-inputs payload artifact
 *  (Turbopack loader-worker hydration corpus). */
export const ANALYSIS_INPUTS_ARTIFACT = 'analysis-inputs.json';

/** Session-dir-relative name of the emitted stylesheet artifact. */
export const STYLES_ARTIFACT = 'styles.css';

/** Session-dir-relative name of the emitted system-props module. */
export const SYSTEM_PROPS_ARTIFACT = 'system-props.js';

/** Session-dir-relative directory holding copied asset() files. */
export const SESSION_ASSETS_DIR = 'assets';

/** The standalone CLI's published-set commit record, written into the flat
 *  `.animus/` tree (openspec: standalone-extraction-cli D3). Shared here so
 *  the CLI writer and the session's start hygiene agree on ONE name — the
 *  hygiene confinement gate keys on this record, and a renamed literal on
 *  either side would silently re-arm deletion of the CLI's published output. */
export const CLI_COMMIT_ARTIFACT = 'commit.json';

/** The standalone CLI's single-writer advisory lock in the flat `.animus/`
 *  tree. A live holder means a CLI invocation owns that tree right now. */
export const CLI_LOCK_ARTIFACT = 'lock.json';

/** The project-relative artifact directory: the flat tree the standalone CLI
 *  publishes into (its default `--out-dir`) AND the parent of every
 *  session-scoped tree. One directory, one spelling — the session's start
 *  hygiene, the watcher's ignore list, and the CLI's default all key on it,
 *  and a drifted literal on any of them silently splits the tree in two. */
export const ANIMUS_ARTIFACT_DIR = '.animus';

/** Module id the Rust emitter injects for the extracted stylesheet — and the
 *  exact resolve-alias KEY both bundler arms register for it (webpack's
 *  `resolve.alias`, Turbopack's `resolveAlias`), which the adapter's alias
 *  harvesting must skip. It lives in this fs-free vocabulary module rather
 *  than the session home so the Turbopack config assembly and the loader
 *  policy can spell it from ONE authority; a per-arm re-declaration would
 *  let the emitted id and an alias key drift apart silently.
 *
 *  Deliberately a literal, not `${ANIMUS_ARTIFACT_DIR}/${STYLES_ARTIFACT}`:
 *  this is a published wire identifier baked into already-built consumer
 *  packages, so it must NOT follow a rename of the artifact directory. */
export const ANIMUS_CSS_MODULE_ID = '.animus/styles.css';

/** Root of every session-scoped artifact tree for a project. */
export function sessionsRootDir(rootDir: string): string {
  return join(rootDir, ANIMUS_ARTIFACT_DIR, 'sessions');
}

/** One session's artifact directory (design D2: session-scoped trees,
 *  no global pointer). */
export function sessionArtifactDir(rootDir: string, sessionId: string): string {
  return join(sessionsRootDir(rootDir), sessionId);
}

/** Absolute path of a session's replacement-epoch artifact — the single
 *  derivation shared by the session writer, the webpack plugin's
 *  watch-ignore entry, and both loaders' file dependencies. Takes the
 *  SESSION directory (not the project root) since the artifact was
 *  relocated into the session tree. */
export function replacementEpochPath(sessionDir: string): string {
  return join(sessionDir, REPLACEMENT_EPOCH_ARTIFACT);
}

/** Absolute path of a session's analysis-commit artifact. */
export function analysisCommitPath(sessionDir: string): string {
  return join(sessionDir, ANALYSIS_COMMIT_ARTIFACT);
}

/** Absolute path of a session's analysis-status artifact. */
export function analysisStatusPath(sessionDir: string): string {
  return join(sessionDir, ANALYSIS_STATUS_ARTIFACT);
}

/** Absolute path of a session's manifest artifact. */
export function manifestPath(sessionDir: string): string {
  return join(sessionDir, MANIFEST_ARTIFACT);
}

/** Absolute path of a session's analysis-inputs artifact. */
export function analysisInputsPath(sessionDir: string): string {
  return join(sessionDir, ANALYSIS_INPUTS_ARTIFACT);
}

/** Absolute path of a session's stylesheet artifact. */
export function stylesPath(sessionDir: string): string {
  return join(sessionDir, STYLES_ARTIFACT);
}

/** Absolute path of a session's system-props module artifact. */
export function systemPropsPath(sessionDir: string): string {
  return join(sessionDir, SYSTEM_PROPS_ARTIFACT);
}

/** Session-scoped analysis-status shape (design D3). Successful loader
 *  invocations never depend on it; it exists so a loader observing a
 *  source/commit mismatch can decide — on evidence — whether to wait.
 *
 *  Schema 2 (openspec: standalone-extraction-cli, watch readiness) adds the
 *  additive `ready` field; every other field is unchanged, so schema-1
 *  readers keep working (no reader branches on the schema value — the bump
 *  records the shape revision for artifact archaeology). */
export interface AnalysisStatus {
  schema: 1 | 2;
  sessionId: string;
  attemptId: number;
  state:
    | 'starting'
    | 'debouncing'
    | 'analyzing'
    | 'committing'
    | 'idle'
    | 'failed';
  /** [(rootDir-relative sourceKey, observed content hash)] of the batch. */
  pending: Array<[string, string]>;
  /** Epoch-ms deadline for the active attempt (debounce ceiling + 2s). */
  deadlineAt: number;
  diagnostic?: string;
  /** Monotonic first-emission witness (additive, schema 2): absent or false
   *  until the session's FIRST successful complete publication, true on
   *  every status write after it — including 'failed' writes, which is what
   *  makes readiness distinct from `state: 'idle'` (idle recurs per attempt;
   *  ready never regresses within a session). */
  ready?: boolean;
}

/** analysis-commit artifact shape (design D1: the transaction identity —
 *  hashes are of the DISK payload bytes, envelope included). `inputsHash`
 *  is present only when the hydration corpus is persisted (Turbopack
 *  orchestration); webpack-mode commits omit it (spec:
 *  next-turbopack-integration, "Webpack mode skips the hydration corpus"). */
export interface AnalysisCommit {
  schema: 1;
  sessionId: string;
  /** FORENSIC ordinal, not a validity witness: no reader — in this repo or
   *  in a loader protocol — decides anything from it, and the commit's own
   *  skip guard deliberately compares hashes and the epoch instead. It is
   *  monotonic per session DIRECTORY only because publication ownership is
   *  exclusive (ExtractionSession.runFullPipeline claims it). Do not
   *  promote it to a coherence check without giving it a disk read. */
  generation: number;
  replacementEpoch: string;
  manifestHash: string;
  inputsHash?: string;
  stylesHash: string;
}

/** Envelope embedded in every payload artifact (design D2: sessionId in
 *  every artifact; payloadHash lets a same-session restart seed its write
 *  guards without byte-reconstructing the payload). */
export interface SessionEnvelope {
  sessionId: string;
  generation: number;
  replacementEpoch: string;
  payloadHash: string;
}

// ── Envelope encoding (single authority: writer, readers, and the protocol
// gauntlet's fabricators all consume these — the format is defined ONCE) ──

/** Splice the session envelope into a JSON-object payload as a leading
 *  `__animusSession` field, byte-preserving the payload's own content
 *  (parse/re-stringify could reformat engine-emitted JSON). */
export function envelopeJsonArtifact(
  payload: string,
  envelopeJson: string
): string {
  const trimmed = payload.trimStart();
  if (!trimmed.startsWith('{')) return payload;
  const rest = trimmed.slice(1).trimStart();
  if (rest.startsWith('}')) {
    return `{"__animusSession":${envelopeJson}}`;
  }
  return `{"__animusSession":${envelopeJson},${trimmed.slice(1)}`;
}

/** Trailing-comment side-band for the CSS artifact (a leading comment
 *  would displace the @layer declaration consumers pin at offset 0). */
export function envelopeCssArtifact(
  payload: string,
  envelopeJson: string
): string {
  return `${payload}\n/* __animusSession ${envelopeJson} */\n`;
}

/** Matches the CSS artifact's envelope side-band. */
export const ENVELOPE_CSS_COMMENT_RE = /\/\* __animusSession (\{.*\}) \*\//;

/** Envelope of a JSON artifact's bytes, or undefined when the artifact
 *  carries none. THROWS on unparseable bytes — callers decide whether a
 *  torn artifact fails closed or degrades. */
export function readJsonEnvelope(bytes: string): SessionEnvelope | undefined {
  return (JSON.parse(bytes) as { __animusSession?: SessionEnvelope })
    .__animusSession;
}

/** Envelope of the CSS artifact's side-band comment, or undefined when the
 *  side-band is absent. THROWS on an unparseable envelope body. */
export function readCssEnvelope(bytes: string): SessionEnvelope | undefined {
  const match = bytes.match(ENVELOPE_CSS_COMMENT_RE);
  return match ? (JSON.parse(match[1]) as SessionEnvelope) : undefined;
}
