import {
  buildAnalyzeProjectArgs,
  contentHash,
  createV2EngineApi,
} from '@animus-ui/extract/pipeline';
import {
  analysisCommitPath,
  analysisInputsPath,
  analysisStatusPath,
  manifestPath,
  readJsonEnvelope,
  replacementEpochPath,
  sessionArtifactDir,
} from '@animus-ui/extract/session';
import * as nodeFs from 'fs';
import { relative } from 'path';

import { transformWithManifest } from './loader-core';

import type { LoaderPolicyOptions } from './loader-core';
import type {
  AnalyzeProjectInputs,
  V2ExtractEngine,
} from '@animus-ui/extract/pipeline';
import type { AnalysisStatus } from '@animus-ui/extract/session';

/** JSON-serializable loader options (Turbopack forwards them across process
 *  boundaries). The session identity is a REAL task input (design D2):
 *  restarts mint a new session id, so cross-session cache reuse is
 *  impossible by construction — restart-cold is normative. */
export interface TurbopackLoaderOptions extends LoaderPolicyOptions {
  rootDir?: string;
  sessionId?: string;
  sessionDir?: string;
}

type LoaderCallback = (err: Error | null, content?: string) => void;

type LoaderContext = {
  resourcePath: string;
  rootContext: string;
  getOptions: () => TurbopackLoaderOptions;
  /** File-dependency registration (Turbopack loader-runner IPC sends
   *  dependencies BEFORE the error check — throw-after-addDependency is a
   *  sound recovery primitive; see design D3). */
  addDependency?: (file: string) => void;
  /** Async-completion handle (webpack loader convention) — required: the
   *  evidence-based catch-up wait cannot run synchronously. */
  async?: () => LoaderCallback;
};

// Worker-local engine + hydration state. Turbopack executes JS loaders in
// isolated, ephemeral worker processes — module scope IS worker scope, and
// nothing here is (or may be) shared across files beyond this process
// (spec: next-turbopack-integration / Stateless per-file transformation;
// guardrail G1). The singleton module must never be imported from this
// graph.
let engine: V2ExtractEngine | null = null;
let sentSources: Map<string, string> | null = null;
let driftWarned = false;
/** Hydration identity: `${commitPath}:${contentHash(commitRaw)}` — the
 *  commit CONTENT keys hydration; mtime/size never do (design D1). */
let hydratedKey: string | null = null;
let hydratedManifestJson: string | null = null;
/** Committed per-file analyzed content hashes (from the inputs). */
let hydratedFileHashes: Map<string, string> | null = null;

// Indirect module id keeps the require dynamic under bundling.
const engineModuleId = '@animus-ui/extract';
const engineApi = createV2EngineApi({
  label: 'animus-next-turbopack',
  isV2: () => true,
  loadNativeEngine: () => require(engineModuleId),
  // Generated session artifacts and other files outside the analysis
  // universe pass through unchanged, matching the webpack loader.
  passThroughUnknownPaths: true,
  store: {
    getEngine: () => engine,
    setEngine: (next) => {
      engine = next;
    },
    getSentSources: () => sentSources,
    setSentSources: (sources) => {
      sentSources = sources;
    },
    getDriftWarned: () => driftWarned,
    setDriftWarned: (value) => {
      driftWarned = value;
    },
  },
});

// ── Injected filesystem seam ───────────────────────────────────────────────
// The protocol gauntlet must stage torn-read windows between this loader's
// artifact reads; fs builtins are not interceptable by the runner's module
// mocker, so the reads go through this swappable, worker-local seam.

type LoaderFs = Pick<typeof nodeFs, 'readFileSync' | 'existsSync'>;
let fsImpl: LoaderFs = nodeFs;

/** @internal test seam — pass null to restore the real fs. */
export function __setTurbopackLoaderFsForTests(fs: LoaderFs | null): void {
  fsImpl = fs ?? nodeFs;
}

/** Epoch artifact paths SEEN on disk (per-worker) — the artifact is never
 *  deleted once written, so a positive probe is stable; negatives re-probe. */
const epochSeenPaths = new Set<string>();

/** @internal test seam — drop worker-local hydration state. */
export function __resetTurbopackLoaderStateForTests(): void {
  hydratedKey = null;
  hydratedManifestJson = null;
  hydratedFileHashes = null;
  epochSeenPaths.clear();
}

function readFileOrNull(path: string): string | null {
  try {
    return fsImpl.readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

// ── Seqlock hydration (design D1 read half) ────────────────────────────────

interface Hydration {
  manifestJson: string;
  fileHashes: Map<string, string>;
  commitRaw: string;
}

type HydrateOutcome =
  | { kind: 'ok'; hydration: Hydration }
  | { kind: 'absent' }
  | { kind: 'foreign'; artifactSessionId: string }
  | { kind: 'torn' };

const SEQLOCK_RETRIES = 5;

/**
 * Seqlock-style artifact read: commit C0 → payloads → hash verification
 * against C0 → commit re-read; accept only if unchanged, else retry
 * (bounded) — a torn or mismatched set is never consumed (design D1).
 * Hydration replays the committed analysis inputs once per commit content.
 */
function hydrateSession(sessionDir: string, sessionId: string): HydrateOutcome {
  const commitPath = analysisCommitPath(sessionDir);
  for (let attempt = 0; attempt < SEQLOCK_RETRIES; attempt++) {
    const c0raw = readFileOrNull(commitPath);
    if (c0raw === null) return { kind: 'absent' };
    let c0: {
      schema?: number;
      sessionId?: string;
      manifestHash?: string;
      inputsHash?: string;
    };
    try {
      c0 = JSON.parse(c0raw) as typeof c0;
    } catch {
      continue; // torn commit write — retry
    }
    if (c0.sessionId !== sessionId) {
      return { kind: 'foreign', artifactSessionId: String(c0.sessionId) };
    }

    const key = `${commitPath}:${contentHash(c0raw)}`;
    if (
      key === hydratedKey &&
      hydratedManifestJson !== null &&
      hydratedFileHashes !== null
    ) {
      return {
        kind: 'ok',
        hydration: {
          manifestJson: hydratedManifestJson,
          fileHashes: hydratedFileHashes,
          commitRaw: c0raw,
        },
      };
    }

    const manifestRaw = readFileOrNull(manifestPath(sessionDir));
    const inputsRaw = readFileOrNull(analysisInputsPath(sessionDir));
    if (manifestRaw === null || inputsRaw === null) continue; // torn window
    if (
      contentHash(manifestRaw) !== c0.manifestHash ||
      contentHash(inputsRaw) !== c0.inputsHash
    ) {
      continue; // payloads belong to another generation — retry
    }
    const c1raw = readFileOrNull(commitPath);
    if (c1raw !== c0raw) continue; // commit advanced mid-read — retry

    // Consistent snapshot: parse, verify the embedded session, replay.
    let inputs: AnalyzeProjectInputs;
    let fileHashes: Map<string, string>;
    try {
      const envelopeSession = readJsonEnvelope(manifestRaw)?.sessionId;
      if (envelopeSession !== undefined && envelopeSession !== sessionId) {
        return { kind: 'foreign', artifactSessionId: String(envelopeSession) };
      }
      const inputsParsed = JSON.parse(inputsRaw) as AnalyzeProjectInputs & {
        analyzedHashes?: Record<string, string>;
      };
      inputs = inputsParsed;
      // Preferred: the writer's top-level path→hash map (no source-corpus
      // parse); filesJson derivation stays as the legacy-artifact fallback.
      fileHashes = inputsParsed.analyzedHashes
        ? new Map(Object.entries(inputsParsed.analyzedHashes))
        : new Map(
            (
              JSON.parse(inputs.filesJson) as Array<{
                path: string;
                source: string;
                hash?: string;
              }>
            ).map((entry) => [
              entry.path,
              entry.hash ?? contentHash(entry.source),
            ])
          );
    } catch {
      // Hash-verified yet unparseable: committed garbage — fail closed
      // rather than half-consume or silently pass through.
      return { kind: 'torn' };
    }
    const { analyzeProject } = engineApi();
    hydratedManifestJson = analyzeProject(
      ...buildAnalyzeProjectArgs(inputs)
    ) as string;
    hydratedFileHashes = fileHashes;
    hydratedKey = key;
    return {
      kind: 'ok',
      hydration: {
        manifestJson: hydratedManifestJson,
        fileHashes,
        commitRaw: c0raw,
      },
    };
  }
  return { kind: 'torn' };
}

function readStatus(sessionDir: string): AnalysisStatus | null {
  const raw = readFileOrNull(analysisStatusPath(sessionDir));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as AnalysisStatus;
  } catch {
    return null; // torn status write — indistinguishable from absent
  }
}

// ── Catch-up bounds (design D3) ────────────────────────────────────────────

const CATCHUP_POLL_INITIAL_MS = 10;
const CATCHUP_POLL_MAX_MS = 25;
const CATCHUP_WAIT_MARGIN_MS = 50;
const CATCHUP_WATCHDOG_MS = 2000;
/** The loader cannot read the orchestrator's configured debounce, so its
 *  own ceiling assumes the default watcher debounce. */
const DEFAULT_DEBOUNCE_CEILING_MS = 75;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ACTIVE_STATES: ReadonlySet<AnalysisStatus['state']> = new Set([
  'starting',
  'debouncing',
  'analyzing',
  'committing',
]);

/**
 * Turbopack loader for Animus source transformation. Derives everything
 * from the incoming source, its JSON-serializable options (carrying the
 * session identity), and the session's COMMITTED disk artifacts written by
 * the out-of-band orchestrator. Async by contract — the evidence-based
 * catch-up (design D3) waits, bounded, for an imminent commit.
 */
export default function animusTurbopackLoader(
  this: LoaderContext,
  source: string
): void {
  if (typeof this.async !== 'function') {
    // Runtime existence check: the catch-up protocol cannot exist on a
    // sync-only runner — fail immediately instead of serving stale bytes.
    throw new Error(
      '[animus-extract] the Animus Turbopack loader requires an async-capable loader runner (this.async is unavailable)'
    );
  }
  const callback = this.async();
  runLoader(this, source).then(
    (code) => callback(null, code),
    (err: unknown) =>
      callback(err instanceof Error ? err : new Error(String(err)))
  );
}

async function runLoader(ctx: LoaderContext, source: string): Promise<string> {
  const opts = ctx.getOptions?.() ?? {};
  const rootDir = opts.rootDir ?? ctx.rootContext;
  const sessionId = opts.sessionId;
  const sessionDir =
    opts.sessionDir ??
    (sessionId !== undefined
      ? sessionArtifactDir(rootDir, sessionId)
      : undefined);
  if (sessionId === undefined || sessionDir === undefined) {
    // Unwired setup (no session identity in the options): nothing to
    // hydrate from — statelessness demands the untouched source.
    return source;
  }

  const commitPath = analysisCommitPath(sessionDir);
  const statusPath = analysisStatusPath(sessionDir);
  const epochPath = replacementEpochPath(sessionDir);

  // Epoch dependency on every invocation with a published artifact — the
  // live fan-out trigger (consult §T: T epoch = live invalidation trigger).
  // Plan-changing analyses move the epoch and re-fire every animus-loaded
  // module; style-only analyses keep it byte-identical and fan out to zero
  // loaders (NS4).
  if (
    typeof ctx.addDependency === 'function' &&
    (epochSeenPaths.has(epochPath) || fsImpl.existsSync(epochPath))
  ) {
    epochSeenPaths.add(epochPath);
    ctx.addDependency(epochPath);
  }

  const filename = relative(rootDir, ctx.resourcePath);
  /** EVERY failing path registers the commit + status artifacts as
   *  dependencies BEFORE throwing (the loader-runner sends dependency IPC
   *  ahead of the error check upstream), so a landing commit or status
   *  transition re-triggers the invocation — the documented
   *  read→registration race makes this a recovery aid, never the primary
   *  wakeup (design D3). Successful paths add NO commit/status dependency. */
  const coverageFailure = (message: string): Error => {
    ctx.addDependency?.(commitPath);
    ctx.addDependency?.(statusPath);
    return new Error(message);
  };

  const transform = (manifestJson: string): string =>
    transformWithManifest({
      source,
      filename,
      manifestJson,
      engineApi,
      opts,
    });

  const outcome = hydrateSession(sessionDir, sessionId);
  if (outcome.kind === 'foreign') {
    throw coverageFailure(
      `ANIMUS_FOREIGN_SESSION: artifacts under ${sessionDir} belong to session ${outcome.artifactSessionId}, not ${sessionId} — refusing to transform from a foreign generation`
    );
  }
  if (outcome.kind === 'torn') {
    throw coverageFailure(
      `ANIMUS_ARTIFACT_READ_TORN: could not obtain a consistent committed artifact set for ${filename} after ${SEQLOCK_RETRIES} attempts`
    );
  }
  let sourceHash: string | null = null;
  if (outcome.kind === 'ok') {
    const analyzedHash = outcome.hydration.fileHashes.get(filename);
    if (analyzedHash === undefined) {
      // Outside the committed analysis universe: existing passthrough
      // policy (manifest lookup gates the transform; the stylesheet-import
      // policy still applies inside loader-core).
      return transform(outcome.hydration.manifestJson);
    }
    sourceHash = contentHash(source);
    if (analyzedHash === sourceHash) {
      return transform(outcome.hydration.manifestJson);
    }
  }

  // The committed analysis does not cover this input (commit absent, or the
  // analyzed hash mismatches the current source): decide on evidence. The
  // source hash rides along — hashed at most once per invocation.
  return awaitCoverage({
    source,
    sourceHash: sourceHash ?? contentHash(source),
    filename,
    sessionId,
    sessionDir,
    coverageFailure,
    transform,
  });
}

/**
 * The catch-up decision table (design D3 — implemented verbatim). Waits —
 * polled, bounded — ONLY in the two evidence states: commit absent while an
 * attempt is active, or the active attempt's pending set contains this file
 * at its current hash. Everything else fails immediately with its stable
 * diagnostic. The moment a commit lands that covers the input, the seqlock
 * hydration consumes it and the transform proceeds with no diagnostic.
 */
async function awaitCoverage(args: {
  source: string;
  /** contentHash(source), computed once by the caller. */
  sourceHash: string;
  filename: string;
  sessionId: string;
  sessionDir: string;
  coverageFailure: (message: string) => Error;
  transform: (manifestJson: string) => string;
}): Promise<string> {
  const {
    source,
    sourceHash,
    filename,
    sessionId,
    sessionDir,
    coverageFailure,
    transform,
  } = args;
  const ceiling =
    Date.now() +
    DEFAULT_DEBOUNCE_CEILING_MS +
    CATCHUP_WATCHDOG_MS +
    CATCHUP_WAIT_MARGIN_MS;
  let poll = CATCHUP_POLL_INITIAL_MS;

  for (;;) {
    // Commit advancement first: a commit covering this input is the success
    // path — seqlock hydrate + transform, no dependencies registered.
    const outcome = hydrateSession(sessionDir, sessionId);
    if (outcome.kind === 'foreign') {
      throw coverageFailure(
        `ANIMUS_FOREIGN_SESSION: artifacts under ${sessionDir} belong to session ${outcome.artifactSessionId}, not ${sessionId}`
      );
    }
    if (outcome.kind === 'ok') {
      const analyzedHash = outcome.hydration.fileHashes.get(filename);
      if (analyzedHash !== undefined && analyzedHash === sourceHash) {
        return transform(outcome.hydration.manifestJson);
      }
    }
    const commitPresent = outcome.kind === 'ok';

    const status = readStatus(sessionDir);
    if (status === null) {
      if (!commitPresent) {
        // No commit AND no status: the session has no artifacts at all —
        // the missing-artifacts passthrough (spec: Stateless per-file
        // transformation), not a coverage failure.
        return source;
      }
      throw coverageFailure(
        `ANIMUS_ANALYSIS_CATCHING_UP: ${filename} is not covered by the committed analysis and no analysis-status exists for session ${sessionId} — is the animus orchestrator running?`
      );
    }
    if (status.sessionId !== sessionId) {
      throw coverageFailure(
        `ANIMUS_FOREIGN_SESSION: analysis-status belongs to session ${status.sessionId}, not ${sessionId}`
      );
    }
    if (status.state === 'failed') {
      throw coverageFailure(
        `ANIMUS_ANALYSIS_FAILED: the analysis covering ${filename} failed: ${status.diagnostic ?? 'unknown analysis error'}`
      );
    }
    if (status.state === 'idle' || !ACTIVE_STATES.has(status.state)) {
      throw coverageFailure(
        `ANIMUS_ANALYSIS_NOT_SCHEDULED: ${filename} changed but no analysis attempt is scheduled for it (watcher miss?)`
      );
    }
    if (commitPresent) {
      // Commit old: wait only when the active attempt OBSERVED this exact
      // content; an attempt that has not seen it will not deliver it.
      const observed = (status.pending ?? []).some(
        ([key, hash]) => key === filename && hash === sourceHash
      );
      if (!observed) {
        throw coverageFailure(
          `ANIMUS_ANALYSIS_NOT_SCHEDULED: the active analysis attempt (${status.attemptId}) has not observed ${filename} at its current content`
        );
      }
    }
    const now = Date.now();
    if (typeof status.deadlineAt === 'number' && now > status.deadlineAt) {
      throw coverageFailure(
        `ANIMUS_ANALYSIS_STALLED: analysis attempt ${status.attemptId} exceeded its deadline while ${filename} waited for coverage`
      );
    }
    if (now > ceiling) {
      throw coverageFailure(
        `ANIMUS_ANALYSIS_CATCHING_UP: ${filename} changed after the committed analysis; timed out waiting for the commit to advance — retrying on the next invalidation`
      );
    }
    await sleep(poll);
    poll = CATCHUP_POLL_MAX_MS;
  }
}
