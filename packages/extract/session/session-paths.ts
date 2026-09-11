import { join } from 'path';

/**
 * Session artifact names, path derivations, and artifact shapes. Imports no
 * session or singleton module: the Turbopack loader graph stays worker-local.
 */

/** Session-dir-relative name of the replacement-epoch disk witness. */
export const REPLACEMENT_EPOCH_ARTIFACT = 'replacements-epoch';

/** Virtual module id of the emitted system-props module. */
export const TURBOPACK_SYSTEM_PROPS_ID = 'virtual:animus/system-props';

/** Session-dir-relative name of the analysis-commit transaction artifact. */
export const ANALYSIS_COMMIT_ARTIFACT = 'analysis-commit';

/** Session-dir-relative name of the analysis-status artifact. */
export const ANALYSIS_STATUS_ARTIFACT = 'analysis-status.json';

/** Session-dir-relative name of the manifest payload artifact. */
export const MANIFEST_ARTIFACT = 'manifest.json';

/** Session-dir-relative name of the analysis-inputs payload artifact — the
 *  Turbopack loader-worker hydration corpus. */
export const ANALYSIS_INPUTS_ARTIFACT = 'analysis-inputs.json';

/** Session-dir-relative name of the emitted stylesheet artifact. */
export const STYLES_ARTIFACT = 'styles.css';

/** Session-dir-relative name of the emitted system-props module. */
export const SYSTEM_PROPS_ARTIFACT = 'system-props.js';

/** Session-dir-relative directory holding copied asset() files. */
export const SESSION_ASSETS_DIR = 'assets';

/** The standalone CLI's published-set commit record in the flat `.animus/`
 *  tree; the session's start hygiene keys on this name before deleting. */
export const CLI_COMMIT_ARTIFACT = 'commit.json';

/** Advisory claim record (pid plus heartbeat) of whichever directory holds
 *  it; sessions write it into their own tree too, despite the `CLI_` name. */
export const CLI_LOCK_ARTIFACT = 'lock.json';

/** Project-relative artifact directory: the CLI's default output tree and
 *  the parent of every session tree. One spelling, or the tree splits. */
export const ANIMUS_ARTIFACT_DIR = '.animus';

/** Module id the Rust emitter injects, and the alias key both bundlers
 *  register. A literal on purpose: a rename breaks built consumer packages. */
export const ANIMUS_CSS_MODULE_ID = '.animus/styles.css';

export function sessionsRootDir(rootDir: string): string {
  return join(rootDir, ANIMUS_ARTIFACT_DIR, 'sessions');
}

export function sessionArtifactDir(rootDir: string, sessionId: string): string {
  return join(sessionsRootDir(rootDir), sessionId);
}

export function replacementEpochPath(sessionDir: string): string {
  return join(sessionDir, REPLACEMENT_EPOCH_ARTIFACT);
}

export function analysisCommitPath(sessionDir: string): string {
  return join(sessionDir, ANALYSIS_COMMIT_ARTIFACT);
}

export function analysisStatusPath(sessionDir: string): string {
  return join(sessionDir, ANALYSIS_STATUS_ARTIFACT);
}

export function manifestPath(sessionDir: string): string {
  return join(sessionDir, MANIFEST_ARTIFACT);
}

export function analysisInputsPath(sessionDir: string): string {
  return join(sessionDir, ANALYSIS_INPUTS_ARTIFACT);
}

export function stylesPath(sessionDir: string): string {
  return join(sessionDir, STYLES_ARTIFACT);
}

export function systemPropsPath(sessionDir: string): string {
  return join(sessionDir, SYSTEM_PROPS_ARTIFACT);
}

/** Advisory: a loader reads it only after observing a source/commit
 *  mismatch, to decide whether to wait. No reader branches on `schema`. */
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
  /** False until the session's first complete publication, true on every
   *  later write including failures; never regresses within a session. */
  ready?: boolean;
}

/** Transaction identity: every hash is of the DISK payload bytes, envelope
 *  included. `inputsHash` is absent when no hydration corpus is persisted. */
export interface AnalysisCommit {
  schema: 1;
  sessionId: string;
  /** Forensic ordinal only: no reader decides anything from it, and it is
   *  monotonic per session directory only because publication is exclusive. */
  generation: number;
  replacementEpoch: string;
  manifestHash: string;
  inputsHash?: string;
  stylesHash: string;
}

/** Embedded in every payload artifact; `payloadHash` lets a same-session
 *  restart seed its write guards without rebuilding the payload bytes. */
export interface SessionEnvelope {
  sessionId: string;
  generation: number;
  replacementEpoch: string;
  payloadHash: string;
}

/** Splices the envelope in as a leading `__animusSession` field without
 *  re-serializing: parse/re-stringify would reformat engine-emitted JSON. */
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

/** Trailing-comment side-band: a leading comment would displace the `@layer`
 *  declaration consumers pin at offset 0. */
export function envelopeCssArtifact(
  payload: string,
  envelopeJson: string
): string {
  return `${payload}\n/* __animusSession ${envelopeJson} */\n`;
}

export const ENVELOPE_CSS_COMMENT_RE = /\/\* __animusSession (\{.*\}) \*\//;

/** Envelope of a JSON artifact's bytes, or undefined when it carries none.
 *  Throws on unparseable bytes; callers decide torn-artifact policy. */
export function readJsonEnvelope(bytes: string): SessionEnvelope | undefined {
  // SAFETY: `envelopeJsonArtifact` above is the only writer of this side-band,
  // so the key is either absent or the object it spliced in.
  return (JSON.parse(bytes) as { __animusSession?: SessionEnvelope })
    .__animusSession;
}

/** Envelope of the CSS side-band comment, or undefined when it is absent.
 *  Throws on an unparseable envelope body. */
export function readCssEnvelope(bytes: string): SessionEnvelope | undefined {
  const match = bytes.match(ENVELOPE_CSS_COMMENT_RE);
  // SAFETY: the capture comes from the regex above, which matches only the
  // side-band `envelopeCssArtifact` writes; an unparseable body throws.
  return match ? (JSON.parse(match[1]) as SessionEnvelope) : undefined;
}
