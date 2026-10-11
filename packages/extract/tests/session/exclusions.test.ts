import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';

setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
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

let restoreGlobals: () => void;
let reported: string[];

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockImplementation(() => buildManifest({}));
  mocks.clearAnalysisCache.mockReset();
  reported = [];
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    reported.push(parts.map(String).join(' '));
  });
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

const unmatched = () =>
  reported.filter((line) => line.includes('matched nothing'));

describe('an unmatched user exclude is reported', () => {
  test('once per build, after its first full discovery', async () => {
    const root = createProject('animus-unmatched-exclude-');
    const session = makeSession(root, { exclude: ['Button', 'stories'] });

    await session.runFullPipeline();
    await session.runFullPipeline();

    expect(unmatched()).toEqual([
      "[animus] exclude pattern 'stories' matched nothing",
    ]);
    session.close();
  });

  test('a pattern matching only paths an output exclusion takes first counts as matched', async () => {
    const root = createProject('animus-shadowed-exclude-');
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out', 'styles.js'), 'export {};\n');
    const session = makeSession(root, { exclude: ['styles'] });
    session.structuralExclude = ['out/**'];

    await session.runFullPipeline();

    expect(unmatched()).toEqual([]);
    session.close();
  });
});
