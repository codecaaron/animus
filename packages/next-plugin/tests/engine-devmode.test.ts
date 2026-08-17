/**
 * Engine devMode derivation (core-options: `mode` "decides emitted bytes …
 * engine devMode").
 *
 * The engine's `dev_mode` flag (retain all components vs reconciliation
 * pruning) must follow an EXPLICIT `mode` option on every pipeline path —
 * a pinned-production watch must not flip to unpruned CSS on its first
 * incremental republication, and a pinned-development full build must
 * retain all components. Without an explicit mode the historical
 * per-pipeline default applies (full = false, incremental = true).
 *
 * Same harness as session-artifacts.test.ts: NAPI boundary mocked, session
 * real, temp project on disk. `devMode` is slot 7 of the positional
 * `analyzeProject` tuple (analyze-project-args.ts).
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../extract/session/singleton';

// Engine API injection through the singleton's globalThis-keyed test
// seam — reaches every copy of the module (source or dist), which a
// module mock cannot.
setEngineApiOverride(() => ({
  loadSystemModule: mocks.loadSystemModule,
  extractFacts: () => '{"files":{},"parseCount":0}',
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import { ExtractionSession } from '../../extract/session/extraction-session';
import {
  buildManifest,
  BUTTON_STYLE_EDIT,
  createProject as createFixtureProject,
  disposeTempRoots,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

import type { AnimusMode } from '../../extract/pipeline/core-options';
import type { SessionOptions } from '../../extract/session/extraction-session';
import type { AnalyzeProjectArgs } from '@animus-ui/extract/pipeline';

let restoreGlobals: () => void;

const DEV_MODE_SLOT = 7;

function lastDevModeArg(): boolean {
  const calls = mocks.analyzeProject.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][DEV_MODE_SLOT];
}

async function startSession(mode?: AnimusMode): Promise<ExtractionSession> {
  const root = createFixtureProject('animus-devmode-');
  mocks.analyzeProject.mockImplementation(() => buildManifest({}));
  // `mode` stays ABSENT unless the caller pins one — the historical
  // per-pipeline default only applies to an option object without the key.
  const options: SessionOptions = { system: './src/system.ts' };
  if (mode) options.mode = mode;
  const session = new ExtractionSession(options);
  session.rootDir = root;
  await session.runFullPipeline();
  return session;
}

async function runComponentEditCycle(
  session: ExtractionSession
): Promise<void> {
  const buttonPath = join(session.rootDir!, 'src', 'Button.tsx');
  writeFileSync(buttonPath, BUTTON_STYLE_EDIT);
  await session.handleWatchUpdate({
    modifiedFiles: new Set([buttonPath]),
    removedFiles: new Set(),
  });
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

describe('engine devMode derivation', () => {
  test('without an explicit mode, the pipeline path decides (full=false, incremental=true)', async () => {
    const session = await startSession();
    expect(lastDevModeArg()).toBe(false);
    await runComponentEditCycle(session);
    expect(lastDevModeArg()).toBe(true);
  });

  test('mode: "production" pins devMode=false across watch republication', async () => {
    const session = await startSession('production');
    expect(lastDevModeArg()).toBe(false);
    await runComponentEditCycle(session);
    // The regression this pins: a pinned-production watch republished
    // unpruned dev CSS on its first incremental cycle.
    expect(lastDevModeArg()).toBe(false);
  });

  test('mode: "development" reaches the engine on the full pipeline', async () => {
    await startSession('development');
    expect(lastDevModeArg()).toBe(true);
  });
});
