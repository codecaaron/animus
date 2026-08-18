/**
 * Session-scoped artifact transaction — WRITER side (openspec:
 * next-turbopack-served-transform-coherence, design D1 data half + D2 —
 * increment 01).
 *
 * Every completed analysis writes its artifacts under
 * `.animus/sessions/<sessionId>/` in transaction order: payloads (manifest →
 * analysis-inputs [Turbopack orchestration only — webpack mode skips the
 * hydration corpus] → styles.css) → analysis-commit → replacements-epoch
 * (last, only when the value moved). Payload artifacts embed a
 * `__animusSession` envelope; the in-process manifest is envelope-free. The
 * session maintains `analysis-status.json` around every analysis, prunes
 * stale session directories at session start, deletes legacy flat
 * artifacts, and reconciles sibling sessions' epoch artifacts on every
 * epoch move (the webpack cold-cache validity witness — a sibling artifact
 * whose value disagrees with the fresh epoch is deleted so restored-module
 * snapshots referencing it invalidate; an agreeing sibling stays
 * byte-untouched so warm restores survive).
 *
 * Same harness as replacement-epoch.test.ts: NAPI boundary mocked, session
 * and pure pipeline helpers real, temp project on disk.
 */
import {
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonObject,
} from '@animus-ui/assertions';
import { contentHash } from '@animus-ui/extract/pipeline';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../extract/session/singleton';

// Engine API injection through the singleton's globalThis-keyed test
// seam — reaches every copy of the module (source or dist), which a
// module mock cannot.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import { ExtractionSession } from '../../extract/session/extraction-session';
import { readCliLockRecord } from '../../extract/session/published-set';
import {
  ANALYSIS_COMMIT_ARTIFACT,
  ANALYSIS_STATUS_ARTIFACT,
  REPLACEMENT_EPOCH_ARTIFACT,
  sessionArtifactDir,
  type AnalysisCommit,
  type AnalysisStatus,
  type SessionEnvelope,
} from '../../extract/session/session-paths';
import { getManifestJson } from '../../extract/session/singleton';
import {
  buildManifest,
  BUTTON_STYLE_EDIT,
  createProject as createFixtureProject,
  disposeTempRoots,
  expectedEpoch,
  PLAN_A,
  PLAN_B,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

import type { ReplacementPlan, ReplacementPlans } from './singleton-fixtures';
import type { JsonObject, JsonValue } from '@animus-ui/assertions';
import type { ManifestComponentDescriptor } from '@animus-ui/extract/pipeline';

let restoreGlobals: () => void;

interface DiskManifest {
  __animusSession: SessionEnvelope;
  components: ReplacementPlans;
}

interface EngineManifest {
  components: ReplacementPlans;
}

interface AnalysisInputsArtifact {
  __animusSession: SessionEnvelope;
  filesJson: string;
}

interface CliCommitRecord {
  schema: 1;
  payloads: { [artifactName: string]: { hash: string } };
}

interface CliPayloadBytes {
  'styles.css': string;
  'system-props.js': string;
  'manifest.json': string;
}

function isReplacementPlan(
  value: JsonValue
): value is JsonObject & ReplacementPlan {
  return (
    isJsonObject(value) &&
    isJsonString(value.file) &&
    isJsonString(value.replacement)
  );
}

function parseReplacementPlans(candidate: JsonValue, artifactName: string) {
  if (!isJsonObject(candidate)) {
    throw new TypeError(`${artifactName}.components must be an object`);
  }
  const plans: ReplacementPlans = {};
  for (const [componentId, plan] of Object.entries(candidate)) {
    if (!isReplacementPlan(plan)) {
      throw new TypeError(
        `${artifactName}.components.${componentId} is malformed`
      );
    }
    plans[componentId] = plan;
  }
  return plans;
}

function parseSessionEnvelope(
  candidate: JsonValue,
  artifactName: string
): SessionEnvelope {
  if (
    !isJsonObject(candidate) ||
    !isJsonString(candidate.sessionId) ||
    !isJsonNumber(candidate.generation) ||
    !isJsonString(candidate.replacementEpoch) ||
    !isJsonString(candidate.payloadHash)
  ) {
    throw new TypeError(`${artifactName} session envelope is malformed`);
  }
  return {
    sessionId: candidate.sessionId,
    generation: candidate.generation,
    replacementEpoch: candidate.replacementEpoch,
    payloadHash: candidate.payloadHash,
  };
}

function parseAnalysisCommit(bytes: string): AnalysisCommit {
  const candidate = parseJsonObject(bytes, ANALYSIS_COMMIT_ARTIFACT);
  if (
    candidate.schema !== 1 ||
    !isJsonString(candidate.sessionId) ||
    !isJsonNumber(candidate.generation) ||
    !isJsonString(candidate.replacementEpoch) ||
    !isJsonString(candidate.manifestHash) ||
    (candidate.inputsHash !== undefined &&
      !isJsonString(candidate.inputsHash)) ||
    !isJsonString(candidate.stylesHash)
  ) {
    throw new TypeError(`${ANALYSIS_COMMIT_ARTIFACT} is malformed`);
  }
  const commit: AnalysisCommit = {
    schema: 1,
    sessionId: candidate.sessionId,
    generation: candidate.generation,
    replacementEpoch: candidate.replacementEpoch,
    manifestHash: candidate.manifestHash,
    stylesHash: candidate.stylesHash,
  };
  if (candidate.inputsHash !== undefined) {
    commit.inputsHash = candidate.inputsHash;
  }
  return commit;
}

function parseStatusState(candidate: JsonValue): AnalysisStatus['state'] {
  switch (candidate) {
    case 'starting':
    case 'debouncing':
    case 'analyzing':
    case 'committing':
    case 'idle':
    case 'failed':
      return candidate;
    default:
      throw new TypeError(`${ANALYSIS_STATUS_ARTIFACT} state is invalid`);
  }
}

function parseAnalysisStatus(bytes: string): AnalysisStatus {
  const candidate = parseJsonObject(bytes, ANALYSIS_STATUS_ARTIFACT);
  if (
    (candidate.schema !== 1 && candidate.schema !== 2) ||
    !isJsonString(candidate.sessionId) ||
    !isJsonNumber(candidate.attemptId) ||
    !Array.isArray(candidate.pending) ||
    !isJsonNumber(candidate.deadlineAt) ||
    (candidate.diagnostic !== undefined &&
      !isJsonString(candidate.diagnostic)) ||
    (candidate.ready !== undefined && !isJsonBoolean(candidate.ready))
  ) {
    throw new TypeError(`${ANALYSIS_STATUS_ARTIFACT} is malformed`);
  }
  const pending = candidate.pending.map((entry, index) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !isJsonString(entry[0]) ||
      !isJsonString(entry[1])
    ) {
      throw new TypeError(
        `${ANALYSIS_STATUS_ARTIFACT}.pending[${index}] is malformed`
      );
    }
    return [entry[0], entry[1]] satisfies [string, string];
  });
  const status: AnalysisStatus = {
    schema: candidate.schema,
    sessionId: candidate.sessionId,
    attemptId: candidate.attemptId,
    state: parseStatusState(candidate.state),
    pending,
    deadlineAt: candidate.deadlineAt,
  };
  if (candidate.diagnostic !== undefined) {
    status.diagnostic = candidate.diagnostic;
  }
  if (candidate.ready !== undefined) status.ready = candidate.ready;
  return status;
}

function parseDiskManifest(bytes: string): DiskManifest {
  const candidate = parseJsonObject(bytes, 'manifest.json');
  return {
    __animusSession: parseSessionEnvelope(
      candidate.__animusSession,
      'manifest.json'
    ),
    components: parseReplacementPlans(candidate.components, 'manifest.json'),
  };
}

function parseEngineManifest(bytes: string): EngineManifest {
  const candidate = parseJsonObject(bytes, 'engine manifest');
  return {
    components: parseReplacementPlans(candidate.components, 'engine manifest'),
  };
}

function parseAnalysisInputs(bytes: string): AnalysisInputsArtifact {
  const candidate = parseJsonObject(bytes, 'analysis-inputs.json');
  if (!isJsonString(candidate.filesJson)) {
    throw new TypeError('analysis-inputs.json filesJson must be a string');
  }
  return {
    __animusSession: parseSessionEnvelope(
      candidate.__animusSession,
      'analysis-inputs.json'
    ),
    filesJson: candidate.filesJson,
  };
}

function parseCliCommitRecord(bytes: string): CliCommitRecord {
  const candidate = parseJsonObject(bytes, 'commit.json');
  if (candidate.schema !== 1 || !isJsonObject(candidate.payloads)) {
    throw new TypeError('commit.json is malformed');
  }
  const payloads: CliCommitRecord['payloads'] = {};
  for (const [artifactName, payload] of Object.entries(candidate.payloads)) {
    if (!isJsonObject(payload) || !isJsonString(payload.hash)) {
      throw new TypeError(`commit.json payload ${artifactName} is malformed`);
    }
    payloads[artifactName] = { hash: payload.hash };
  }
  return { schema: 1, payloads };
}

/** Byte-identical config-plan edit used by the shared fixture; these source
 *  bytes feed the watched-file content hash. */
const BUTTON_COMPONENT_PLAN_EDIT =
  "export const Button = animus.styles({ margin: 16 }).variant({}).asElement('button');\n";

function createProject(): string {
  return createFixtureProject('animus-session-artifacts-');
}

type WriteRecord = { name: string; content: string };

async function startSession(
  root: string,
  components: Record<string, ManifestComponentDescriptor>,
  writes?: WriteRecord[],
  opts?: { turbopack?: boolean }
): Promise<ExtractionSession> {
  mocks.analyzeProject.mockImplementation(() => buildManifest(components));
  const session = new ExtractionSession({ system: './src/system.ts' });
  session.rootDir = root;
  // Turbopack orchestration persists the analysis-inputs hydration corpus;
  // webpack mode (the default here) skips it (spec:
  // next-turbopack-integration, "Webpack mode skips the hydration corpus").
  if (opts?.turbopack) session.persistAnalysisInputs = true;
  if (writes) {
    session.onArtifactWrite = (name, content) => {
      writes.push({ name, content });
    };
  }
  await session.runFullPipeline();
  return session;
}

function readSessionArtifact(session: ExtractionSession, name: string): string {
  return readFileSync(join(session.sessionDir, name), 'utf-8');
}

function payloadNames(writes: WriteRecord[]): string[] {
  return writes
    .map((w) => w.name)
    .filter((name) => name !== ANALYSIS_STATUS_ARTIFACT);
}

function statusStates(writes: WriteRecord[]): string[] {
  return writes
    .filter((w) => w.name === ANALYSIS_STATUS_ARTIFACT)
    .map((w) => parseAnalysisStatus(w.content).state);
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset();
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('session directory + transaction write order (design D1/D2)', () => {
  test('artifacts land under .animus/sessions/<sessionId>/ and no flat paths are written', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A, undefined, {
      turbopack: true,
    });

    expect(session.sessionDir).toBe(
      sessionArtifactDir(root, session.sessionId)
    );
    for (const name of [
      'manifest.json',
      'analysis-inputs.json',
      'styles.css',
      'system-props.js',
      ANALYSIS_COMMIT_ARTIFACT,
      REPLACEMENT_EPOCH_ARTIFACT,
      ANALYSIS_STATUS_ARTIFACT,
    ]) {
      expect(existsSync(join(session.sessionDir, name)), name).toBe(true);
      // The flat legacy path is never written.
      expect(existsSync(join(root, '.animus', name)), `flat ${name}`).toBe(
        false
      );
    }
  });

  test('webpack mode skips the hydration corpus (spec scenario)', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);

    // No analysis-inputs artifact under webpack orchestration...
    expect(existsSync(join(session.sessionDir, 'analysis-inputs.json'))).toBe(
      false
    );
    // ...while the loader reads the manifest from process memory as before.
    expect(getManifestJson()).toBe(buildManifest(PLAN_A));
    // The webpack-mode commit carries NO inputsHash field.
    const commit = parseAnalysisCommit(
      readSessionArtifact(session, ANALYSIS_COMMIT_ARTIFACT)
    );
    expect('inputsHash' in commit).toBe(false);
  });

  test('write order (Turbopack): manifest → inputs → styles → system-props → commit → epoch', async () => {
    const root = createProject();
    const writes: WriteRecord[] = [];
    await startSession(root, PLAN_A, writes, { turbopack: true });

    expect(payloadNames(writes)).toEqual([
      'manifest.json',
      'analysis-inputs.json',
      'styles.css',
      'system-props.js',
      ANALYSIS_COMMIT_ARTIFACT,
      REPLACEMENT_EPOCH_ARTIFACT,
    ]);
  });

  test('write order (webpack): manifest → styles → system-props → commit → epoch, no inputs', async () => {
    const root = createProject();
    const writes: WriteRecord[] = [];
    await startSession(root, PLAN_A, writes);

    expect(payloadNames(writes)).toEqual([
      'manifest.json',
      'styles.css',
      'system-props.js',
      ANALYSIS_COMMIT_ARTIFACT,
      REPLACEMENT_EPOCH_ARTIFACT,
    ]);
  });

  test('a style-only re-analysis rewrites payloads + commit but never the epoch', async () => {
    const root = createProject();
    const writes: WriteRecord[] = [];
    const session = await startSession(root, PLAN_A, writes);
    writes.length = 0;

    mocks.analyzeProject.mockImplementation(() =>
      buildManifest(PLAN_A, '.btn{margin:16px;}')
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    const names = payloadNames(writes);
    expect(names).not.toContain(REPLACEMENT_EPOCH_ARTIFACT);
    expect(names).toContain(ANALYSIS_COMMIT_ARTIFACT);
    // The commit is the last artifact of a style-only transaction.
    expect(names[names.length - 1]).toBe(ANALYSIS_COMMIT_ARTIFACT);
  });
});

describe('analysis-commit content (design D1)', () => {
  test('commit carries sessionId, generation, epoch, and content hashes of the disk payloads', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A, undefined, {
      turbopack: true,
    });

    const commit = parseAnalysisCommit(
      readSessionArtifact(session, ANALYSIS_COMMIT_ARTIFACT)
    );
    expect(commit.schema).toBe(1);
    expect(commit.sessionId).toBe(session.sessionId);
    expect(commit.generation).toBe(1);
    expect(commit.replacementEpoch).toBe(expectedEpoch(PLAN_A));
    expect(commit.manifestHash).toBe(
      contentHash(readSessionArtifact(session, 'manifest.json'))
    );
    expect(commit.inputsHash).toBe(
      contentHash(readSessionArtifact(session, 'analysis-inputs.json'))
    );
    expect(commit.stylesHash).toBe(
      contentHash(readSessionArtifact(session, 'styles.css'))
    );
  });

  test('generation increments per changed analysis and the commit is skipped when nothing changed', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);

    // A SUCCESSOR session in the same process re-analyzes identical
    // content: byte-identical artifacts are not rewritten and the
    // generation holds. The predecessor closes first — publication
    // ownership is exclusive, so the handoff is sequential by contract.
    const commitStatBefore = statSync(
      join(session.sessionDir, ANALYSIS_COMMIT_ARTIFACT),
      { bigint: true }
    );
    session.close();
    const again = await startSession(root, PLAN_A);
    expect(again.sessionId).toBe(session.sessionId);
    const commitStatAfter = statSync(
      join(again.sessionDir, ANALYSIS_COMMIT_ARTIFACT),
      { bigint: true }
    );
    expect(commitStatAfter.ino).toBe(commitStatBefore.ino);
    expect(commitStatAfter.mtimeNs).toBe(commitStatBefore.mtimeNs);

    // A plan change advances the generation.
    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_B));
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_COMPONENT_PLAN_EDIT);
    await again.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    const commit = parseAnalysisCommit(
      readSessionArtifact(again, ANALYSIS_COMMIT_ARTIFACT)
    );
    expect(commit.generation).toBe(2);
    expect(commit.replacementEpoch).toBe(expectedEpoch(PLAN_B));
  });
});

describe('payload envelopes (spec: Manifest disk artifact)', () => {
  test('the disk manifest embeds __animusSession; the in-process manifest does not', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);

    const manifestJson = buildManifest(PLAN_A);
    const disk = parseDiskManifest(
      readSessionArtifact(session, 'manifest.json')
    );
    expect(disk.__animusSession).toBeDefined();
    expect(disk.__animusSession.sessionId).toBe(session.sessionId);
    expect(disk.__animusSession.generation).toBe(1);
    expect(disk.__animusSession.replacementEpoch).toBe(expectedEpoch(PLAN_A));
    expect(disk.__animusSession.payloadHash).toBe(contentHash(manifestJson));
    expect(disk.components).toEqual(
      parseEngineManifest(manifestJson).components
    );
    // In-process manifest is the verbatim engine output.
    expect(getManifestJson()).toBe(manifestJson);
  });

  test('the inputs and styles artifacts carry the envelope side-band', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A, undefined, {
      turbopack: true,
    });

    const inputs = parseAnalysisInputs(
      readSessionArtifact(session, 'analysis-inputs.json')
    );
    expect(inputs.__animusSession.sessionId).toBe(session.sessionId);

    const styles = readSessionArtifact(session, 'styles.css');
    const match = styles.match(/\/\* __animusSession (\{.*\}) \*\//);
    expect(match).not.toBeNull();
    if (!match) throw new TypeError('styles.css session envelope is missing');
    const envelopeCandidate: JsonValue = JSON.parse(match[1]);
    expect(
      parseSessionEnvelope(envelopeCandidate, 'styles.css').sessionId
    ).toBe(session.sessionId);
  });
});

describe('analysis-status lifecycle (design D3 data half)', () => {
  test('an analysis walks starting → analyzing → committing → idle with pending + deadline', async () => {
    const root = createProject();
    const writes: WriteRecord[] = [];
    const session = await startSession(root, PLAN_A, writes);
    expect(statusStates(writes)).toEqual([
      'starting',
      'analyzing',
      'committing',
      'idle',
    ]);
    writes.length = 0;

    const before = Date.now();
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest(PLAN_A, '.btn{margin:16px;}')
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    const statuses = writes
      .filter((w) => w.name === ANALYSIS_STATUS_ARTIFACT)
      .map((w) => parseAnalysisStatus(w.content));
    expect(statuses.map((s) => s.state)).toEqual([
      'starting',
      'analyzing',
      'committing',
      'idle',
    ]);
    for (const status of statuses) {
      expect(status.sessionId).toBe(session.sessionId);
      expect(status.attemptId).toBe(2);
    }
    // The active states carry the observed batch (relPath, sourceHash).
    expect(statuses[0].pending).toEqual([
      ['src/Button.tsx', contentHash(BUTTON_STYLE_EDIT)],
    ]);
    // Idle clears the pending set.
    expect(statuses[3].pending).toEqual([]);
    // deadlineAt = now + debounce ceiling + 2000ms watchdog.
    expect(statuses[0].deadlineAt).toBeGreaterThanOrEqual(before + 2000);
    expect(statuses[0].deadlineAt).toBeLessThanOrEqual(before + 2000 + 5000);
  });

  test('a failed analysis lands in state failed carrying the diagnostic', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);

    mocks.analyzeProject.mockImplementationOnce(() => {
      throw new Error('analysis boom');
    });
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_COMPONENT_PLAN_EDIT);
    await expect(
      session.handleWatchUpdate({
        modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
        removedFiles: new Set(),
      })
    ).rejects.toThrow('analysis boom');

    const status = parseAnalysisStatus(
      readSessionArtifact(session, ANALYSIS_STATUS_ARTIFACT)
    );
    expect(status.state).toBe('failed');
    expect(status.diagnostic).toContain('analysis boom');

    // The retry attempt increments attemptId and returns to idle.
    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_B));
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    const recovered = parseAnalysisStatus(
      readSessionArtifact(session, ANALYSIS_STATUS_ARTIFACT)
    );
    expect(recovered.state).toBe('idle');
    expect(recovered.attemptId).toBe(status.attemptId + 1);
  });

  test('every settled cycle reports its outcome, and a failure still rejects', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);
    const settled: string[] = [];
    // The seam the CLI watch used to obtain by REPLACING this method: its
    // publication policy needs the cycle boundary AND the failure (report
    // S8), which the success-only on* observers cannot carry.
    session.onCycleSettled = (cause) => {
      settled.push(cause === null ? 'ok' : `failed:${String(cause)}`);
    };

    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_B));
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_COMPONENT_PLAN_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(settled).toEqual(['ok']);

    mocks.analyzeProject.mockImplementationOnce(() => {
      throw new Error('analysis boom');
    });
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await expect(
      session.handleWatchUpdate({
        modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
        removedFiles: new Set(),
      })
    ).rejects.toThrow('analysis boom');

    expect(settled).toHaveLength(2);
    expect(settled[1]).toContain('analysis boom');
  });
});

describe('session-start hygiene (design D2)', () => {
  test('stale session dirs are pruned by age; fresh and own dirs survive', async () => {
    const root = createProject();
    const sessionsRoot = join(root, '.animus', 'sessions');
    const oldDir = join(sessionsRoot, 'old-session');
    const freshDir = join(sessionsRoot, 'fresh-session');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(freshDir, { recursive: true });
    writeFileSync(join(oldDir, 'manifest.json'), '{}');
    writeFileSync(join(freshDir, 'manifest.json'), '{}');
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(oldDir, stale, stale);

    const session = await startSession(root, PLAN_A);

    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(freshDir)).toBe(true);
    expect(existsSync(session.sessionDir)).toBe(true);
  });

  test('legacy flat artifacts are deleted at session start', async () => {
    const root = createProject();
    const flat = join(root, '.animus');
    mkdirSync(flat, { recursive: true });
    for (const name of [
      'manifest.json',
      'analysis-inputs.json',
      REPLACEMENT_EPOCH_ARTIFACT,
      'styles.css',
      'system-props.js',
    ]) {
      writeFileSync(join(flat, name), 'legacy');
    }

    await startSession(root, PLAN_A);

    for (const name of [
      'manifest.json',
      'analysis-inputs.json',
      REPLACEMENT_EPOCH_ARTIFACT,
      'styles.css',
      'system-props.js',
    ]) {
      expect(existsSync(join(flat, name)), name).toBe(false);
    }
  });

  /** A flat CLI published set: three payloads plus a commit record whose
   *  hashes match the payload bytes (writer.ts contract, schema 1). */
  function writeCliPublishedSet(flat: string): void {
    mkdirSync(flat, { recursive: true });
    const payloads = {
      'styles.css': '.published{color:red}',
      'system-props.js': 'export default {};',
      'manifest.json': '{"components":{}}',
    } satisfies CliPayloadBytes;
    const record = {
      schema: 1,
      payloads: Object.fromEntries(
        Object.entries(payloads).map(([name, bytes]) => [
          name,
          { hash: contentHash(bytes) },
        ])
      ),
    };
    for (const [name, bytes] of Object.entries(payloads)) {
      writeFileSync(join(flat, name), bytes);
    }
    writeFileSync(join(flat, 'commit.json'), JSON.stringify(record));
  }

  test('a VERIFIED flat CLI published set survives session hygiene', async () => {
    const root = createProject();
    const flat = join(root, '.animus');
    writeCliPublishedSet(flat);

    await startSession(root, PLAN_A);

    for (const name of ['styles.css', 'system-props.js', 'manifest.json']) {
      expect(existsSync(join(flat, name)), name).toBe(true);
    }
    expect(existsSync(join(flat, 'commit.json'))).toBe(true);
  });

  test('a verified set carrying a BINARY asset entry survives hygiene (byte-domain parity)', async () => {
    // The drift this pins: the hygiene gate once verified payloads as
    // utf-8 strings while the writer hashed raw bytes — any set with a
    // font could never verify and was deleted as debris.
    const root = createProject();
    const flat = join(root, '.animus');
    writeCliPublishedSet(flat);
    const fontBytes = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0xfe]);
    mkdirSync(join(flat, 'assets'), { recursive: true });
    writeFileSync(join(flat, 'assets', 'font.abc.woff2'), fontBytes);
    const record = parseCliCommitRecord(
      readFileSync(join(flat, 'commit.json'), 'utf-8')
    );
    record.payloads['assets/font.abc.woff2'] = { hash: contentHash(fontBytes) };
    writeFileSync(join(flat, 'commit.json'), JSON.stringify(record));

    await startSession(root, PLAN_A);

    expect(existsSync(join(flat, 'styles.css'))).toBe(true);
    expect(existsSync(join(flat, 'assets', 'font.abc.woff2'))).toBe(true);
    expect(existsSync(join(flat, 'commit.json'))).toBe(true);
  });

  test('an INCONSISTENT commit record is debris: payloads AND record are cleaned', async () => {
    const root = createProject();
    const flat = join(root, '.animus');
    writeCliPublishedSet(flat);
    // The marker outlives its payloads (aborted publish / manual edits):
    // the recorded hash no longer matches the bytes on disk.
    writeFileSync(join(flat, 'styles.css'), '.tampered{}');

    await startSession(root, PLAN_A);

    // The regression this pins: a bare existsSync(commit.json) gate let one
    // stale marker disable flat cleanup forever.
    for (const name of ['styles.css', 'system-props.js', 'manifest.json']) {
      expect(existsSync(join(flat, name)), name).toBe(false);
    }
    expect(existsSync(join(flat, 'commit.json'))).toBe(false);
  });

  test('a record naming NO payload is debris, not a certificate', async () => {
    const root = createProject();
    const flat = join(root, '.animus');
    writeCliPublishedSet(flat);
    // An array `payloads` enumerates zero entries: every hash it records
    // matches, vacuously. Admitting it would let a forged four-byte record
    // fence off any tree from hygiene forever.
    writeFileSync(
      join(flat, 'commit.json'),
      JSON.stringify({ schema: 1, payloads: [] })
    );

    await startSession(root, PLAN_A);

    for (const name of ['styles.css', 'system-props.js', 'manifest.json']) {
      expect(existsSync(join(flat, name)), name).toBe(false);
    }
    expect(existsSync(join(flat, 'commit.json'))).toBe(false);
  });

  test('a lock holder this process may not signal protects the flat tree', async () => {
    const root = createProject();
    const flat = join(root, '.animus');
    writeCliPublishedSet(flat);
    // Mid-publish instant (see below), but the holder is pid 1 — root-owned,
    // so the liveness probe gets EPERM rather than success. "Exists, not
    // ours" must read as LIVE here: reading it as dead deletes artifacts a
    // running CLI is mid-way through publishing.
    writeFileSync(join(flat, 'styles.css'), '.newer-generation{}');
    writeFileSync(
      join(flat, 'lock.json'),
      JSON.stringify({ pid: 1, startedAt: 'boot' })
    );

    await startSession(root, PLAN_A);

    for (const name of ['styles.css', 'system-props.js', 'manifest.json']) {
      expect(existsSync(join(flat, name)), name).toBe(true);
    }
  });

  test('a lock file that EXISTS but does not decode protects the flat tree', async () => {
    const root = createProject();
    const flat = join(root, '.animus');
    writeCliPublishedSet(flat);
    // Mid-publish instant (the set does not verify) under a lock whose
    // bytes are torn. "Cannot decode this lock" is not "nothing claims this
    // tree": reading it as unclaimed authorizes deleting the payloads a
    // live CLI may be publishing right now (ledger boundary row).
    writeFileSync(join(flat, 'styles.css'), '.newer-generation{}');
    writeFileSync(join(flat, 'lock.json'), '{"pid":');

    await startSession(root, PLAN_A);

    for (const name of ['styles.css', 'system-props.js', 'manifest.json']) {
      expect(existsSync(join(flat, name)), name).toBe(true);
    }
  });

  test('a lock read that fails for any reason other than absence surfaces', () => {
    const root = createProject();
    const flat = join(root, '.animus');
    mkdirSync(join(flat, 'lock.json'), { recursive: true });

    // EISDIR, not ENOENT: the read failed, so the holder is unknown. The
    // fail-open catch answered "no holder" for every errno — including the
    // EACCES case, on the branch that goes on to delete published payloads.
    expect(() => readCliLockRecord(flat)).toThrow(/EISDIR/);
    expect(readCliLockRecord(join(root, 'no-such-dir'))).toEqual({
      kind: 'none',
    });
  });

  test('a live CLI lock protects the flat tree even mid-publish (inconsistent instant)', async () => {
    const root = createProject();
    const flat = join(root, '.animus');
    writeCliPublishedSet(flat);
    // Mid-publish instant: payloads renamed, commit not yet rewritten…
    writeFileSync(join(flat, 'styles.css'), '.newer-generation{}');
    // …while a live CLI invocation holds the advisory lock (this pid).
    writeFileSync(
      join(flat, 'lock.json'),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
    );

    await startSession(root, PLAN_A);

    for (const name of ['styles.css', 'system-props.js', 'manifest.json']) {
      expect(existsSync(join(flat, name)), name).toBe(true);
    }
    expect(existsSync(join(flat, 'commit.json'))).toBe(true);
  });
});

describe('publication exclusivity (one publishing session per process)', () => {
  test('a second session publishing into the process-shared session dir fails loud', async () => {
    const root = createProject();
    const first = await startSession(root, PLAN_A);

    // Same process ⇒ same claimed sessionId ⇒ the SAME session directory,
    // while each instance carries its own payload write guards. Two live
    // publishers therefore wedge the manifest/commit pair permanently
    // (ANIMUS_ARTIFACT_READ_TORN); the second publication must be refused
    // instead, naming both claimants.
    const second = new ExtractionSession({ system: './src/system.ts' });
    second.rootDir = root;
    second.driverLabel = 'animus-second';

    await expect(second.runFullPipeline()).rejects.toThrow(
      /second Animus host/
    );
    await expect(second.runFullPipeline()).rejects.toThrow(first.sessionDir);
  });

  test('closing the owner releases the claim: the successor publishes', async () => {
    const root = createProject();
    const first = await startSession(root, PLAN_A);
    first.close();
    // Idempotent: a second close must not free a successor's claim.
    first.close();

    const second = await startSession(root, PLAN_A);
    expect(second.sessionId).toBe(first.sessionId);
    expect(getManifestJson()).toBe(buildManifest(PLAN_A));
  });
});

describe('sibling epoch reconciliation (webpack cold-cache witness)', () => {
  function writeSiblingEpoch(root: string, id: string, epoch: string): string {
    const dir = join(root, '.animus', 'sessions', id);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, REPLACEMENT_EPOCH_ARTIFACT);
    writeFileSync(path, JSON.stringify({ schema: 1, sessionId: id, epoch }));
    return path;
  }

  test('a sibling whose epoch agrees stays byte-untouched; a disagreeing sibling loses its artifact', async () => {
    const root = createProject();
    const agreeing = writeSiblingEpoch(
      root,
      'warm-prior',
      expectedEpoch(PLAN_A)
    );
    const disagreeing = writeSiblingEpoch(root, 'stale-prior', 'stale-epoch');
    const agreeingStat = statSync(agreeing, { bigint: true });

    await startSession(root, PLAN_A);

    expect(existsSync(disagreeing)).toBe(false);
    // The dir itself survives (age-based pruning owns dir lifecycle).
    expect(existsSync(join(root, '.animus', 'sessions', 'stale-prior'))).toBe(
      true
    );
    const after = statSync(agreeing, { bigint: true });
    expect(after.ino).toBe(agreeingStat.ino);
    expect(after.mtimeNs).toBe(agreeingStat.mtimeNs);
  });

  test('a sibling that restored its own artifact is reconciled again on the next move', async () => {
    const root = createProject();
    const prior = writeSiblingEpoch(root, 'peer-prior', 'stale-epoch');

    const session = await startSession(root, PLAN_A);
    expect(existsSync(prior)).toBe(false);

    // The peer publishes: its own `publishReplacementEpoch` probes DISK,
    // finds the artifact this session deleted, and rewrites it with the
    // peer's (still disagreeing) epoch — the self-heal that keeps loaders
    // from registering a permanently-satisfiable dependency. A later move
    // here must invalidate it AGAIN.
    writeSiblingEpoch(root, 'peer-prior', 'stale-epoch');

    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_B));
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_COMPONENT_PLAN_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    expect(existsSync(prior)).toBe(false);
  });

  test('a mid-session epoch move reconciles siblings that agreed with the previous value', async () => {
    const root = createProject();
    const prior = writeSiblingEpoch(root, 'warm-prior', expectedEpoch(PLAN_A));

    const session = await startSession(root, PLAN_A);
    expect(existsSync(prior)).toBe(true);

    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_B));
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_COMPONENT_PLAN_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    expect(existsSync(prior)).toBe(false);
  });
});
