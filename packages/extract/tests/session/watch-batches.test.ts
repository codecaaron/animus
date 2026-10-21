import { writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { fakeEngineApi } from '../native-functions';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';

setEngineApiOverride(() => ({
  ...fakeEngineApi(),
  extractModuleFacts: () => '{"files":{},"parseCount":0}',
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

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockImplementation(() => buildManifest({}));
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('a configuration change runs the full pipeline', () => {
  test('a tsconfig edit reloads the system and re-reads its aliases', async () => {
    const root = createProject('animus-config-change-');
    const session = makeSession(root);
    session.development = true;
    session.aliasesFromTsconfig = true;
    await session.runFullPipeline();
    const loads = mocks.loadSystemModule.mock.calls.length;

    const tsconfig = join(root, 'tsconfig.json');
    writeFileSync(
      tsconfig,
      JSON.stringify({ compilerOptions: { paths: { '@ui/*': ['./src/*'] } } })
    );
    await session.handleWatchUpdate({ modifiedFiles: new Set([tsconfig]) });

    expect(mocks.loadSystemModule.mock.calls.length).toBe(loads + 1);
    expect(session.pathAliasesJson).toContain('@ui/');
    session.close();
  });
});

describe('an empty batch probes what the host did not report', () => {
  async function developmentSession(root: string) {
    const session = makeSession(root);
    session.development = true;
    await session.runFullPipeline();
    return session;
  }
  const emptyBatch = {
    modifiedFiles: new Set<string>(),
    removedFiles: new Set<string>(),
  };

  test('it reloads once for a changed system dependency, and never when nothing changed', async () => {
    const root = createProject('animus-empty-system-');
    const session = await developmentSession(root);
    const loads = mocks.loadSystemModule.mock.calls.length;

    await session.handleWatchUpdate(emptyBatch);
    expect(mocks.loadSystemModule.mock.calls.length).toBe(loads);

    writeFileSync(
      join(root, 'src', 'system.ts'),
      'export const system = { space: [1] };\n'
    );
    await session.handleWatchUpdate(emptyBatch);
    await session.handleWatchUpdate(emptyBatch);
    expect(mocks.loadSystemModule.mock.calls.length).toBe(loads + 1);
    session.close();
  });

  test('it reloads once for a changed configuration input', async () => {
    const root = createProject('animus-empty-config-');
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    const session = await developmentSession(root);
    const loads = mocks.loadSystemModule.mock.calls.length;

    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@ui/*': ['./src/*'] } } })
    );
    await session.handleWatchUpdate(emptyBatch);
    await session.handleWatchUpdate(emptyBatch);

    expect(mocks.loadSystemModule.mock.calls.length).toBe(loads + 1);
    session.close();
  });
});

describe('a configuration change runs the full pipeline', () => {
  test('creating a tsconfig the chain extends but cannot find reloads the system', async () => {
    const root = createProject('animus-config-extends-');
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ extends: './base.json' })
    );
    const session = makeSession(root);
    session.development = true;
    await session.runFullPipeline();
    const loads = mocks.loadSystemModule.mock.calls.length;

    const base = join(root, 'base.json');
    writeFileSync(base, JSON.stringify({ compilerOptions: {} }));
    await session.handleWatchUpdate({ modifiedFiles: new Set([base]) });

    expect(mocks.loadSystemModule.mock.calls.length).toBe(loads + 1);
    session.close();
  });
});
