import {
  buildAnalyzeProjectArgs,
  contentHash,
  createV2EngineApi,
  parseFilesJson,
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

import type { LoaderContextBase, LoaderPolicyOptions } from './loader-core';
import type {
  AnalyzeProjectInputs,
  EngineApi,
  V2ExtractEngine,
} from '@animus-ui/extract/pipeline';
import type {
  AnalysisCommit,
  AnalysisStatus,
} from '@animus-ui/extract/session';

interface AnalysisInputsArtifact extends AnalyzeProjectInputs {
  analyzedHashes?: Record<string, string>;
}

export interface TurbopackLoaderOptions extends LoaderPolicyOptions {
  rootDir?: string;
  sessionId?: string;
  sessionDir?: string;
}

type LoaderCallback = (err: Error | null, content?: string) => void;

type LoaderContext = LoaderContextBase<TurbopackLoaderOptions> & {
  async?: () => LoaderCallback;
};

let engine: V2ExtractEngine | null = null;
let sentSources: Map<string, string> | null = null;
let driftWarned = false;
let hydratedKey: string | null = null;
let hydratedManifestJson: string | null = null;
let hydratedFileHashes: Map<string, string> | null = null;

// Indirect module id keeps the require dynamic under bundling.
const engineModuleId = '@animus-ui/extract';
const engineApi = createV2EngineApi({
  label: 'animus-next-turbopack',
  isV2: () => true,
  loadNativeEngine: () => require(engineModuleId),
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

type LoaderEngineApi = () => Pick<
  EngineApi,
  'analyzeProject' | 'transformFile'
>;
let engineApiImpl: LoaderEngineApi = engineApi;

/** @internal test seam. */
export function __setTurbopackLoaderEngineApiForTests(
  api: LoaderEngineApi | null
): void {
  engineApiImpl = api ?? engineApi;
}

type LoaderFs = Pick<typeof nodeFs, 'readFileSync' | 'existsSync'>;
let fsImpl: LoaderFs = nodeFs;

/** @internal test seam. */
export function __setTurbopackLoaderFsForTests(fs: LoaderFs | null): void {
  fsImpl = fs ?? nodeFs;
}

const epochSeenPaths = new Set<string>();

/** @internal test seam. */
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

const ARTIFACT_READ_RETRIES = 5;

function hydrateSession(sessionDir: string, sessionId: string): HydrateOutcome {
  const commitPath = analysisCommitPath(sessionDir);
  for (let attempt = 0; attempt < ARTIFACT_READ_RETRIES; attempt++) {
    const c0raw = readFileOrNull(commitPath);
    if (c0raw === null) return { kind: 'absent' };
    let c0: AnalysisCommit;
    try {
      // SAFETY: animus's own wire; every field read below is re-decided
      // against the payload bytes, and an unparseable payload is retried.
      c0 = JSON.parse(c0raw) as AnalysisCommit;
    } catch {
      continue;
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
    if (manifestRaw === null || inputsRaw === null) continue;
    if (
      contentHash(manifestRaw) !== c0.manifestHash ||
      contentHash(inputsRaw) !== c0.inputsHash
    ) {
      continue;
    }
    const c1raw = readFileOrNull(commitPath);
    if (c1raw !== c0raw) continue;

    let inputs: AnalyzeProjectInputs;
    let fileHashes: Map<string, string>;
    try {
      const envelopeSession = readJsonEnvelope(manifestRaw)?.sessionId;
      if (envelopeSession !== undefined && envelopeSession !== sessionId) {
        return { kind: 'foreign', artifactSessionId: String(envelopeSession) };
      }
      // SAFETY: animus's own hydration corpus, already proven to be the
      // generation the commit names; a mismatched shape fails the catch below.
      const inputsParsed = JSON.parse(inputsRaw) as AnalysisInputsArtifact;
      inputs = inputsParsed;
      fileHashes = inputsParsed.analyzedHashes
        ? new Map(Object.entries(inputsParsed.analyzedHashes))
        : new Map(
            parseFilesJson(inputs.filesJson, 'animus-next-turbopack').map(
              (entry) => [entry.path, entry.hash ?? contentHash(entry.source)]
            )
          );
    } catch {
      return { kind: 'torn' };
    }
    const { analyzeProject } = engineApiImpl();
    hydratedManifestJson = analyzeProject(...buildAnalyzeProjectArgs(inputs));
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
    // SAFETY: animus's own wire, validated no further than parseability —
    // the wait loop re-decides every field it reads against the value in hand.
    return JSON.parse(raw) as AnalysisStatus;
  } catch {
    return null;
  }
}

const hasReadableDeadline = (status: AnalysisStatus): boolean =>
  Object.prototype.toString.call(status.deadlineAt) === '[object Number]';

const CATCHUP_POLL_INITIAL_MS = 10;
const CATCHUP_POLL_MAX_MS = 25;
const CATCHUP_WAIT_MARGIN_MS = 50;
const CATCHUP_NO_DEADLINE_CAP_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ACTIVE_STATES: ReadonlySet<AnalysisStatus['state']> = new Set([
  'starting',
  'debouncing',
  'analyzing',
  'committing',
]);

export default function animusTurbopackLoader(
  this: LoaderContext,
  source: string
): void {
  if (this.async === undefined) {
    throw new Error(
      '[animus-extract] the Animus Turbopack loader requires an async-capable loader runner (this.async is unavailable)'
    );
  }
  const callback = this.async();
  runLoader(this, source).then(
    (code) => callback(null, code),
    <Thrown>(thrown: Thrown) =>
      callback(thrown instanceof Error ? thrown : new Error(String(thrown)))
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
    return source;
  }

  const commitPath = analysisCommitPath(sessionDir);
  const statusPath = analysisStatusPath(sessionDir);
  const epochPath = replacementEpochPath(sessionDir);

  if (
    ctx.addDependency !== undefined &&
    (epochSeenPaths.has(epochPath) || fsImpl.existsSync(epochPath))
  ) {
    epochSeenPaths.add(epochPath);
    ctx.addDependency(epochPath);
  }

  const filename = relative(rootDir, ctx.resourcePath);
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
      engineApi: engineApiImpl,
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
      `ANIMUS_ARTIFACT_READ_TORN: could not obtain a consistent committed artifact set for ${filename} after ${ARTIFACT_READ_RETRIES} attempts`
    );
  }
  let sourceHash: string | null = null;
  if (outcome.kind === 'ok') {
    const analyzedHash = outcome.hydration.fileHashes.get(filename);
    if (analyzedHash === undefined) {
      return transform(outcome.hydration.manifestJson);
    }
    sourceHash = contentHash(source);
    if (analyzedHash === sourceHash) {
      return transform(outcome.hydration.manifestJson);
    }
  }

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

async function awaitCoverage(args: {
  source: string;
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
  const noDeadlineCap =
    Date.now() + CATCHUP_NO_DEADLINE_CAP_MS + CATCHUP_WAIT_MARGIN_MS;
  let poll = CATCHUP_POLL_INITIAL_MS;

  for (;;) {
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
    if (hasReadableDeadline(status)) {
      if (now > status.deadlineAt) {
        throw coverageFailure(
          `ANIMUS_ANALYSIS_STALLED: analysis attempt ${status.attemptId} exceeded its deadline while ${filename} waited for coverage`
        );
      }
    } else if (now > noDeadlineCap) {
      throw coverageFailure(
        `ANIMUS_ANALYSIS_CATCHING_UP: ${filename} changed after the committed analysis; timed out waiting for the commit to advance — retrying on the next invalidation`
      );
    }
    await sleep(poll);
    poll = CATCHUP_POLL_MAX_MS;
  }
}
