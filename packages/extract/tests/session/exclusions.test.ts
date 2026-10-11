import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
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
  lastAnalyzedPaths,
  makeSession,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalyzeProjectArgs } from '../../pipeline';

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

  test('two passes that fail after discovery, then a success, report once', async () => {
    const root = createProject('animus-report-once-');
    const session = makeSession(root, { exclude: ['stories'] });
    mocks.analyzeProject
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockImplementationOnce(() => {
        throw new Error('boom');
      });

    await expect(session.runFullPipeline()).rejects.toThrow('boom');
    await expect(session.runFullPipeline()).rejects.toThrow('boom');
    await session.runFullPipeline();

    expect(unmatched()).toHaveLength(1);
    session.close();
  });

  test('a user pattern an output directory also excludes counts as matched', async () => {
    const root = createProject('animus-shadowed-exclude-');
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out', 'styles.js'), 'export {};\n');
    const session = makeSession(root, { exclude: ['out'] });
    session.structuralExclude = ['out'];

    await session.runFullPipeline();

    expect(unmatched()).toEqual([]);
    session.close();
  });
});

describe('a user exclude list never re-admits output', () => {
  test('a source-tree link into an output directory is never analysed', async () => {
    const root = realpathSync(createProject('animus-output-link-'));
    mkdirSync(join(root, 'build'));
    writeFileSync(join(root, 'build', 'Leak.tsx'), 'export const Leak = 1;\n');
    symlinkSync(join(root, 'build'), join(root, 'src', 'linked'), 'dir');
    const session = makeSession(root);
    session.structuralExclude = ['build'];

    await session.runFullPipeline();

    expect(
      lastAnalyzedPaths(mocks.analyzeProject).filter((path) =>
        path.includes('Leak')
      )
    ).toEqual([]);
    session.close();
  });
});
