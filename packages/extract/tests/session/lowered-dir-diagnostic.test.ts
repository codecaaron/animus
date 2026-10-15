/**
 * The lowered-:dir() diagnostic on repeated attempts of one Session: a
 * warning prints once per build, and an error fails every attempt.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';
import { parserStoppingAt } from '../source-ingestion-fixtures';

setEngineApiOverride(() => ({
  extractFacts: parserStoppingAt('(('),
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import {
  buildManifest,
  createProject,
  disposeTempRoots,
  makeSession,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { DiagnosticLevel } from '../../pipeline/manifest-diagnostics';

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject
    .mockReset()
    .mockImplementation(() => buildManifest({}, '.x:dir(rtl){color:red}'));
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

/** Two full attempts on one Session whose targets lower `:dir()`: what each
 *  attempt did, and how many coded warnings printed. */
async function twoAttempts(
  level: DiagnosticLevel | undefined,
  strict: boolean
) {
  const warn = vi.fn();
  const session = makeSession(
    createProject('animus-lowered-dir-'),
    {
      targets: 'safari 15',
      mode: 'production',
      strict,
      ...(level && { diagnostics: { 'animus.selector.lowered-dir': level } }),
    },
    { logger: { info: () => {}, warn, error: () => {} } }
  );
  const attempts: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    attempts.push(
      await session.runFullPipeline().then(
        () => 'publishes',
        () => 'throws'
      )
    );
  }
  const warnings = warn.mock.calls.filter(([line]) =>
    String(line).includes('animus.selector.lowered-dir')
  ).length;
  return { attempts, warnings };
}

describe('the lowered-:dir() diagnostic', () => {
  // Contract: an error-level diagnostic fails every attempt while its
  // condition holds; a warning prints once per build.
  for (const strict of [false, true]) {
    test(`levels on repeated attempts (strict: ${strict})`, async () => {
      expect(await twoAttempts('error', strict)).toEqual({
        attempts: ['throws', 'throws'],
        warnings: 0,
      });
      for (const level of ['warn', undefined] as const) {
        expect(await twoAttempts(level, strict)).toEqual({
          attempts: ['publishes', 'publishes'],
          warnings: 1,
        });
      }
      expect(await twoAttempts('off', strict)).toEqual({
        attempts: ['publishes', 'publishes'],
        warnings: 0,
      });
    });
  }
});
