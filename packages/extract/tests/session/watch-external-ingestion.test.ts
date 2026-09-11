import {
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join, relative } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  BUTTON_SOURCE,
  BUTTON_STYLE_EDIT,
  createKitWorkspace,
  disposeTempRoots,
  lastAnalyzedFiles as analyzedFiles,
  lastAnalyzedPaths as analyzedPaths,
  makeManifest,
  makeSession,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalysisSourceEntry, EngineApi } from '../../pipeline';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn<EngineApi['loadSystemModule']>(),
  analyzeProject: vi.fn<EngineApi['analyzeProject']>(),
  clearAnalysisCache: vi.fn<EngineApi['clearAnalysisCache']>(),
}));

import { setEngineApiOverride } from '../../session/singleton';

// Injection through the singleton's globalThis seam reaches every copy of
// the module (source or dist); a module mock does not.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

let restoreGlobals: () => void;

const MANIFEST = JSON.stringify(makeManifest({ css: '.btn{margin:8;}' }));

const lastAnalyzedFiles = (): AnalysisSourceEntry[] =>
  analyzedFiles(mocks.analyzeProject);
const lastAnalyzedPaths = (): string[] => analyzedPaths(mocks.analyzeProject);
const lastAnalyzedSource = (path: string): string | undefined =>
  lastAnalyzedFiles().find((f) => f.path === path)?.source;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockReturnValue(MANIFEST);
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('external membership in the watch pass', () => {
  test('a declared kit edit is ingested while an undeclared sibling is dropped', async () => {
    const { app, kit, kitOld } = createKitWorkspace();
    const session = makeSession(app);
    await session.runFullPipeline();

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));
    expect(lastAnalyzedPaths()).toContain(kitButtonKey);
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    writeFileSync(
      join(kitOld, 'src', 'Rogue.tsx'),
      'export const Rogue = 2;\n'
    );
    await session.handleWatchUpdate({
      modifiedFiles: new Set([
        join(kit, 'src', 'Button.tsx'),
        join(kitOld, 'src', 'Rogue.tsx'),
      ]),
      removedFiles: new Set(),
    });

    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
    expect(lastAnalyzedSource(kitButtonKey)).toBe(BUTTON_STYLE_EDIT);
    const paths = lastAnalyzedPaths();
    expect(paths.some((p) => p.includes('ui-old'))).toBe(false);
  });

  test('symlink alias and canonical spellings collapse to one source identity', async () => {
    const { parent, app, kit } = createKitWorkspace();
    const alias = join(parent, 'link-ui');
    symlinkSync(kit, alias, 'dir');
    const session = makeSession(app);
    await session.runFullPipeline();
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));

    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(alias, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
    expect(lastAnalyzedSource(kitButtonKey)).toBe(BUTTON_STYLE_EDIT);
    expect(
      lastAnalyzedPaths().filter((p) => p.endsWith('Button.tsx'))
    ).toHaveLength(1);

    // Re-reporting the same content via the canonical spelling is a no-op.
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(kit, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
  });

  test('a nested symlink escape is rejected and never grows the universe', async () => {
    const { parent, app, kit } = createKitWorkspace();
    const session = makeSession(app);
    await session.runFullPipeline();
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    const outside = join(parent, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'Escape.tsx'), 'export const E = 1;\n');
    symlinkSync(outside, join(kit, 'src', 'generated'), 'dir');

    // The kit edit is the positive control riding the same batch.
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([
        join(kit, 'src', 'Button.tsx'),
        join(kit, 'src', 'generated', 'Escape.tsx'),
      ]),
      removedFiles: new Set(),
    });

    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
    const paths = lastAnalyzedPaths();
    expect(paths.some((p) => p.includes('generated'))).toBe(false);
    expect(paths.some((p) => p.includes('outside'))).toBe(false);
  });

  test('a deleted kit file is pruned through its recorded alias identity', async () => {
    const { parent, app, kit } = createKitWorkspace();
    const alias = join(parent, 'link-ui');
    symlinkSync(kit, alias, 'dir');
    const session = makeSession(app);
    await session.runFullPipeline();

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));

    // Record the alias spelling while the file exists.
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(alias, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(lastAnalyzedPaths()).toContain(kitButtonKey);
    const callsBeforeDelete = mocks.analyzeProject.mock.calls.length;

    rmSync(join(kit, 'src', 'Button.tsx'));
    await session.handleWatchUpdate({
      modifiedFiles: new Set(),
      removedFiles: new Set([join(alias, 'src', 'Button.tsx')]),
    });

    expect(mocks.analyzeProject.mock.calls.length).toBe(callsBeforeDelete + 1);
    expect(lastAnalyzedPaths()).not.toContain(kitButtonKey);
  });

  /**
   * A restored cache entry whose owner record is missing hides that file's
   * token diagnostics for the rest of the session.
   */
  test('a failed deletion attempt keeps the file owner alongside the restored cache', async () => {
    const { app, kit } = createKitWorkspace();
    const session = makeSession(app);
    await session.runFullPipeline();

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));
    // Element access on private session state keeps the session's own
    // declared type instead of asserting a local slice.
    const owners = () => session['externalFileOwners'];
    expect(owners()[kitButtonKey]).toBeDefined();

    rmSync(join(kit, 'src', 'Button.tsx'));
    mocks.analyzeProject.mockImplementationOnce(() => {
      throw new Error('error diagnostics fail the build');
    });

    await expect(
      session.handleWatchUpdate({
        modifiedFiles: new Set(),
        removedFiles: new Set([join(kit, 'src', 'Button.tsx')]),
      })
    ).rejects.toThrow();

    expect(
      owners()[kitButtonKey],
      'owner must survive a failed attempt, like the cache entry does'
    ).toBeDefined();
  });

  test('duplicate specifiers on one canonical root share set-valued ownership', async () => {
    const { app, kit } = createKitWorkspace(
      `import { createSystem } from '@animus-ui/system';
import kitA from '../../kits/ui/src/index.ts';
import kitB from '../../kits/ui/src/Button.tsx';
export const system = createSystem({}).extend(kitA).extend(kitB);
`
    );
    const session = makeSession(app);
    await session.runFullPipeline();

    const canonicalRoot = realpathSync(join(kit, 'src'));
    expect(session.externalWatchRoots).toEqual([canonicalRoot]);
    expect(session.externalRootOwners.get(canonicalRoot)).toEqual(
      new Set([join(kit, 'src', 'index.ts'), join(kit, 'src', 'Button.tsx')])
    );
  });
});

describe('orchestrator seams (design D4)', () => {
  test('roots are announced before analysis and committed after publication', async () => {
    const { app, kit } = createKitWorkspace();
    const session = makeSession(app);
    const events: string[] = [];
    session.onExternalRootResolved = (root) => events.push(`resolved:${root}`);
    session.onExternalRootsCommitted = (roots) =>
      events.push(`committed:${roots.join(',')}`);
    mocks.analyzeProject.mockImplementation(() => {
      events.push('analyze');
      return MANIFEST;
    });

    await session.runFullPipeline();

    const canonical = realpathSync(join(kit, 'src'));
    const resolvedIndex = events.indexOf(`resolved:${canonical}`);
    const analyzeIndex = events.indexOf('analyze');
    expect(resolvedIndex).toBeGreaterThanOrEqual(0);
    expect(analyzeIndex).toBeGreaterThan(resolvedIndex);
    expect(events[events.length - 1]).toBe(`committed:${canonical}`);
  });

  test('a cross-volume root is never announced and commits an empty set', async () => {
    const { app } = createKitWorkspace();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession(app);
    session.sharesProjectVolume = () => false;
    const events: string[] = [];
    session.onExternalRootResolved = (root) => events.push(`resolved:${root}`);
    session.onExternalRootsCommitted = (roots) =>
      events.push(`committed:[${roots.join(',')}]`);

    await session.runFullPipeline();

    expect(events).toEqual(['committed:[]']);
  });
});

describe('dirty-root reconciliation (design D3)', () => {
  test('a dirty-root report reconstructs creations, edits, and deletions before analysis', async () => {
    const { app, kit } = createKitWorkspace();
    const session = makeSession(app);
    await session.runFullPipeline();
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));
    const kitIndexKey = relative(app, join(kit, 'src', 'index.ts'));
    const kitNewKey = relative(app, join(kit, 'src', 'New.tsx'));

    // The watcher reports only the kit directory (webpack context-dependency
    // shape), hiding one create, one edit, and one delete.
    writeFileSync(join(kit, 'src', 'New.tsx'), 'export const New = 1;\n');
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    rmSync(join(kit, 'src', 'index.ts'));
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(kit, 'src')]),
      removedFiles: new Set(),
    });

    // Slot 7 is devMode: the incremental path, since no system dependency
    // hid in the delta.
    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
    const lastCall =
      mocks.analyzeProject.mock.calls[
        mocks.analyzeProject.mock.calls.length - 1
      ];
    expect(lastCall[7]).toBe(true);
    const paths = lastAnalyzedPaths();
    expect(paths).toContain(kitNewKey);
    expect(paths).toContain(kitButtonKey);
    expect(paths).not.toContain(kitIndexKey);
    expect(lastAnalyzedSource(kitButtonKey)).toBe(BUTTON_STYLE_EDIT);
    expect(lastAnalyzedSource(kitNewKey)).toBe('export const New = 1;\n');
  });

  test('a directory report hiding a system-dependency edit triggers the system reload', async () => {
    const { app, kit } = createKitWorkspace();
    writeFileSync(join(kit, 'src', 'theme.ts'), 'export const theme = 1;\n');
    mocks.loadSystemModule.mockReset().mockImplementation(() => ({
      ...SYSTEM_CONFIG,
      dependencies: [
        join(app, 'src', 'system.ts'),
        join(kit, 'src', 'theme.ts'),
      ],
    }));
    const session = makeSession(app);
    await session.runFullPipeline();
    const loadsAfterFull = mocks.loadSystemModule.mock.calls.length;

    // The theme edit hides behind a bare directory report, which cannot be
    // classified before the rewalk.
    writeFileSync(join(kit, 'src', 'theme.ts'), 'export const theme = 2;\n');
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(kit, 'src')]),
      removedFiles: new Set(),
    });

    // Slot 7 is devMode: false marks the full-pipeline path.
    expect(mocks.loadSystemModule.mock.calls.length).toBe(loadsAfterFull + 1);
    const lastCall =
      mocks.analyzeProject.mock.calls[
        mocks.analyzeProject.mock.calls.length - 1
      ];
    expect(lastCall[7]).toBe(false);
  });

  test('a removed root directory reconciles as full deletion', async () => {
    const { app, kit } = createKitWorkspace();
    const session = makeSession(app);
    await session.runFullPipeline();
    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));
    expect(lastAnalyzedPaths()).toContain(kitButtonKey);
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    rmSync(join(kit, 'src'), { recursive: true });
    await session.handleWatchUpdate({
      modifiedFiles: new Set(),
      removedFiles: new Set([join(kit, 'src')]),
    });

    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
    const paths = lastAnalyzedPaths();
    expect(paths.some((p) => p.includes('kits'))).toBe(false);
  });
});

describe('cross-volume external roots (design D5)', () => {
  test('strict mode fails the pipeline naming the package', async () => {
    const { app } = createKitWorkspace();
    const session = makeSession(app, { strict: true });
    session.sharesProjectVolume = () => false;

    await expect(session.runFullPipeline()).rejects.toThrow(
      'ANIMUS_EXTERNAL_CROSS_VOLUME_UNSUPPORTED'
    );
  });

  test('non-strict excludes the package atomically with a sticky diagnostic', async () => {
    const { app, kit } = createKitWorkspace();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession(app);
    session.sharesProjectVolume = () => false;

    await session.runFullPipeline();

    const paths = lastAnalyzedPaths();
    expect(paths.some((p) => p.includes('kits'))).toBe(false);
    expect(session.externalWatchRoots).toEqual([]);
    expect(session.externalRootOwners.size).toBe(0);
    expect(session.externalPackageDirs).toEqual([]);
    expect(session.externalSourceEntries.size).toBe(0);
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('ANIMUS_EXTERNAL_CROSS_VOLUME_UNSUPPORTED');
    expect(warned).toContain(join(kit, 'src', 'index.ts'));
    expect(
      [...session.stickyDiagnostics.values()].some((m) =>
        m.includes('ANIMUS_EXTERNAL_CROSS_VOLUME_UNSUPPORTED')
      )
    ).toBe(true);
    const calls = mocks.analyzeProject.mock.calls.length;
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(kit, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(mocks.analyzeProject.mock.calls.length).toBe(calls);
  });

  test('an admitted kit that becomes cross-volume on reset is excluded like a removal', async () => {
    const { app, kit } = createKitWorkspace();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession(app);

    await session.runFullPipeline();
    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));
    expect(lastAnalyzedPaths()).toContain(kitButtonKey);
    expect(session.externalWatchRoots).toHaveLength(1);

    session.sharesProjectVolume = () => false;
    session.resetForHmr();
    await session.runFullPipeline();

    expect(lastAnalyzedPaths()).not.toContain(kitButtonKey);
    expect(session.externalWatchRoots).toEqual([]);
    expect(session.externalRootOwners.size).toBe(0);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('ANIMUS_EXTERNAL_CROSS_VOLUME_UNSUPPORTED')
      )
    ).toBe(true);

    writeFileSync(join(app, 'src', 'App.tsx'), 'export const App = 2;\n');
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(app, 'src', 'App.tsx')]),
      removedFiles: new Set(),
    });
    expect(lastAnalyzedPaths()).not.toContain(kitButtonKey);
  });
});

describe('external keyframes discovery', () => {
  test('a directory event on a dist-only root keeps its widened-extension files', async () => {
    // A dist-only kit is collected with a widened extension set; the rewalk
    // must reuse it, or the kit reconciles as deleted and `.mjs` edits die.
    const systemSource = `import { createSystem } from '@animus-ui/system';
import kit from '../../kits/compiled/dist/index.mjs';
export const system = createSystem({}).extend(kit);
`;
    const ws = createKitWorkspace(systemSource);
    const distKit = join(ws.parent, 'kits', 'compiled');
    mkdirSync(join(distKit, 'dist'), { recursive: true });
    writeFileSync(join(distKit, 'package.json'), '{"name":"@kits/compiled"}');
    writeFileSync(join(distKit, 'dist', 'index.mjs'), 'export default {};\n');
    writeFileSync(join(distKit, 'dist', 'Button.mjs'), BUTTON_SOURCE);

    const session = makeSession(ws.app);
    await session.runFullPipeline();
    const kitIndexKey = relative(ws.app, join(distKit, 'dist', 'index.mjs'));
    const kitButtonKey = relative(ws.app, join(distKit, 'dist', 'Button.mjs'));
    expect(lastAnalyzedPaths()).toContain(kitButtonKey);
    const fileCache = session['fileCache'];

    // Directory-granularity event on the dist root (turbopack's
    // filename==null case, webpack's contextDependency).
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(distKit, 'dist')]),
      removedFiles: new Set(),
    });

    expect(fileCache.has(kitIndexKey)).toBe(true);
    expect(fileCache.has(kitButtonKey)).toBe(true);

    writeFileSync(join(distKit, 'dist', 'Button.mjs'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(distKit, 'dist', 'Button.mjs')]),
      removedFiles: new Set(),
    });
    expect(lastAnalyzedSource(kitButtonKey)).toBe(BUTTON_STYLE_EDIT);
  });
});
