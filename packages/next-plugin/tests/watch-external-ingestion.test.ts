/**
 * External-source watch ingestion — membership, identity, and cross-volume
 * rejection wired into the session's watch pass (openspec:
 * external-source-watch-ingestion, increment 01; design D1/D2/D5; specs
 * workspace-source-ingestion + next-dev-hmr).
 *
 * Engine mocked at the singleton seam (same harness as
 * plugin-pipeline.test.ts); everything else — discovery, collection, the
 * identity handle, the session watch pass — runs for real against temp
 * workspace trees shaped like a monorepo (app root + sibling kits).
 */
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
  ExtractionSession,
  type SessionOptions,
} from '../../extract/session/extraction-session';
import {
  disposeTempRoots,
  makeManifest,
  makeTempRoot,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

import type {
  AnalysisSourceEntry,
  EngineApi,
} from '@animus-ui/extract/pipeline';

// Each mock carries the engine function's own signature (EngineApi is the
// contract the session calls through), so recorded calls stay typed at
// their real slots instead of being re-asserted at every read.
const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn<EngineApi['loadSystemModule']>(),
  analyzeProject: vi.fn<EngineApi['analyzeProject']>(),
  clearAnalysisCache: vi.fn<EngineApi['clearAnalysisCache']>(),
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

let restoreGlobals: () => void;

/** The engine's manifest for these workspaces — a COMPLETE `ProjectManifest`
 *  (the shared pipeline reads `manifest.sheets.global` and `manifest.css`
 *  as typed fields, not guarded ones), carrying the one value this suite
 *  cares about: the component CSS the Button sources produce. */
const MANIFEST = JSON.stringify(makeManifest({ css: '.btn{margin:8;}' }));

const SYSTEM_SOURCE = `import { createSystem } from '@animus-ui/system';
import kit from '../../kits/ui/src/index.ts';
export const system = createSystem({}).extend(kit);
`;

const BUTTON_V1 =
  "export const Button = animus.styles({ margin: 8 }).asElement('button');\n";
const BUTTON_V2 =
  "export const Button = animus.styles({ margin: 16 }).asElement('button');\n";

interface Workspace {
  parent: string;
  app: string;
  kit: string;
  kitOld: string;
}

function createWorkspace(systemSource: string = SYSTEM_SOURCE): Workspace {
  const parent = realpathSync(makeTempRoot('animus-ext-watch-'));
  const app = join(parent, 'app');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'package.json'), '{"name":"app"}');
  writeFileSync(join(app, 'src', 'system.ts'), systemSource);
  writeFileSync(join(app, 'src', 'App.tsx'), 'export const App = 1;\n');
  const kit = join(parent, 'kits', 'ui');
  mkdirSync(join(kit, 'src'), { recursive: true });
  writeFileSync(join(kit, 'package.json'), '{"name":"@kits/ui"}');
  writeFileSync(join(kit, 'src', 'index.ts'), "export * from './Button';\n");
  writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_V1);
  const kitOld = join(parent, 'kits', 'ui-old');
  mkdirSync(join(kitOld, 'src'), { recursive: true });
  writeFileSync(join(kitOld, 'src', 'Rogue.tsx'), 'export const Rogue = 1;\n');
  return { parent, app, kit, kitOld };
}

function makeSession(app: string, options: Partial<SessionOptions> = {}) {
  const session = new ExtractionSession({
    system: './src/system.ts',
    ...options,
  });
  session.rootDir = app;
  return session;
}

/** The file set the LAST analysis received: slot 0 of the engine call is
 *  the serialized analysis entry set (`buildAnalysisInputs`' `filesJson`). */
function lastAnalyzedFiles(): AnalysisSourceEntry[] {
  const calls = mocks.analyzeProject.mock.calls;
  return JSON.parse(calls[calls.length - 1][0]);
}

/** Paths (rootDir-relative) of the file set the LAST analysis received. */
function lastAnalyzedPaths(): string[] {
  expect(mocks.analyzeProject.mock.calls.length).toBeGreaterThan(0);
  return lastAnalyzedFiles().map((f) => f.path);
}

/** Source of one path in the LAST analyzed file set, or undefined. */
function lastAnalyzedSource(path: string): string | undefined {
  return lastAnalyzedFiles().find((f) => f.path === path)?.source;
}

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
    const { app, kit, kitOld } = createWorkspace();
    const session = makeSession(app);
    await session.runFullPipeline();

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));
    expect(lastAnalyzedPaths()).toContain(kitButtonKey);
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    // Edit the kit file AND touch the undeclared sibling in one batch.
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_V2);
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

    // The kit edit re-analyzed with the edited content; the sibling never
    // entered the universe.
    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
    expect(lastAnalyzedSource(kitButtonKey)).toBe(BUTTON_V2);
    const paths = lastAnalyzedPaths();
    expect(paths.some((p) => p.includes('ui-old'))).toBe(false);
  });

  test('symlink alias and canonical spellings collapse to one source identity', async () => {
    const { parent, app, kit } = createWorkspace();
    const alias = join(parent, 'link-ui');
    symlinkSync(kit, alias, 'dir');
    const session = makeSession(app);
    await session.runFullPipeline();
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));

    // Edit reported via the ALIAS spelling.
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_V2);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(alias, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
    expect(lastAnalyzedSource(kitButtonKey)).toBe(BUTTON_V2);
    // Exactly one entry for the physical file — no alias-forked duplicate.
    expect(
      lastAnalyzedPaths().filter((p) => p.endsWith('Button.tsx'))
    ).toHaveLength(1);

    // The same content re-reported via the CANONICAL spelling is a no-op:
    // both spellings share one identity and one cache entry.
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(kit, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
  });

  test('a nested symlink escape is rejected and never grows the universe', async () => {
    const { parent, app, kit } = createWorkspace();
    const session = makeSession(app);
    await session.runFullPipeline();
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    // The escape appears mid-session: kit/src/generated → outside tree.
    const outside = join(parent, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'Escape.tsx'), 'export const E = 1;\n');
    symlinkSync(outside, join(kit, 'src', 'generated'), 'dir');

    // A positive control rides the same batch so RED/GREEN is observable:
    // the kit edit must ingest, the escape must not.
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_V2);
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
    const { parent, app, kit } = createWorkspace();
    const alias = join(parent, 'link-ui');
    symlinkSync(kit, alias, 'dir');
    const session = makeSession(app);
    await session.runFullPipeline();

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));

    // Record the alias spelling while the file exists.
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_V2);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(alias, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(lastAnalyzedPaths()).toContain(kitButtonKey);
    const callsBeforeDelete = mocks.analyzeProject.mock.calls.length;

    // Delete on disk; the watcher reports the ALIAS spelling.
    rmSync(join(kit, 'src', 'Button.tsx'));
    await session.handleWatchUpdate({
      modifiedFiles: new Set(),
      removedFiles: new Set([join(alias, 'src', 'Button.tsx')]),
    });

    // The prune itself re-analyzed, and the ghost entry is gone.
    expect(mocks.analyzeProject.mock.calls.length).toBe(callsBeforeDelete + 1);
    expect(lastAnalyzedPaths()).not.toContain(kitButtonKey);
  });

  /**
   * The failure path restores `fileCache` so the same content analyzes again,
   * but the owner record was deleted eagerly and never restored. A restored
   * cache entry with no owner is silently invisible to
   * `correlateExternalTokenDiagnostics`, which skips any diagnostic whose file
   * has no owner — so that file's token-contract errors vanish for the rest of
   * the session (owners are otherwise rebuilt only by a full pipeline run).
   */
  test('a failed deletion attempt keeps the file owner alongside the restored cache', async () => {
    const { app, kit } = createWorkspace();
    const session = makeSession(app);
    await session.runFullPipeline();

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));
    // The owner record is session-private state; element access keeps the
    // session's own declared type instead of asserting a local slice.
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
    const { app, kit } = createWorkspace(
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
    const { app, kit } = createWorkspace();
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
    const { app } = createWorkspace();
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
    const { app, kit } = createWorkspace();
    const session = makeSession(app);
    await session.runFullPipeline();
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));
    const kitIndexKey = relative(app, join(kit, 'src', 'index.ts'));
    const kitNewKey = relative(app, join(kit, 'src', 'New.tsx'));

    // The hidden delta: one create, one edit, one delete — the watcher
    // reports ONLY the kit directory (webpack context-dependency shape).
    writeFileSync(join(kit, 'src', 'New.tsx'), 'export const New = 1;\n');
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_V2);
    rmSync(join(kit, 'src', 'index.ts'));
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(kit, 'src')]),
      removedFiles: new Set(),
    });

    // One re-analysis, on the ordinary incremental path (devMode=true —
    // no system dependency hid in the delta).
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
    expect(lastAnalyzedSource(kitButtonKey)).toBe(BUTTON_V2);
    expect(lastAnalyzedSource(kitNewKey)).toBe('export const New = 1;\n');
  });

  test('a directory report hiding a system-dependency edit wins the geological reset', async () => {
    const { app, kit } = createWorkspace();
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

    // The theme edit hides behind a bare directory report — a bare dir
    // event can never be classified before the rewalk.
    writeFileSync(join(kit, 'src', 'theme.ts'), 'export const theme = 2;\n');
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(kit, 'src')]),
      removedFiles: new Set(),
    });

    // The geological reset path won: the system reloaded and the analysis
    // ran as a FULL pipeline (devMode=false).
    expect(mocks.loadSystemModule.mock.calls.length).toBe(loadsAfterFull + 1);
    const lastCall =
      mocks.analyzeProject.mock.calls[
        mocks.analyzeProject.mock.calls.length - 1
      ];
    expect(lastCall[7]).toBe(false);
  });

  test('a removed root directory reconciles as full deletion', async () => {
    const { app, kit } = createWorkspace();
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
    const { app } = createWorkspace();
    const session = makeSession(app, { strict: true });
    session.sharesProjectVolume = () => false;

    await expect(session.runFullPipeline()).rejects.toThrow(
      'ANIMUS_EXTERNAL_CROSS_VOLUME_UNSUPPORTED'
    );
  });

  test('non-strict excludes the package atomically with a sticky diagnostic', async () => {
    const { app, kit } = createWorkspace();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession(app);
    session.sharesProjectVolume = () => false;

    await session.runFullPipeline();

    // No cache entries, no ownership, no watch roots, no resolve aliases.
    const paths = lastAnalyzedPaths();
    expect(paths.some((p) => p.includes('kits'))).toBe(false);
    expect(session.externalWatchRoots).toEqual([]);
    expect(session.externalRootOwners.size).toBe(0);
    expect(session.externalPackageDirs).toEqual([]);
    expect(session.externalSourceEntries.size).toBe(0);
    // The sticky diagnostic names the package.
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('ANIMUS_EXTERNAL_CROSS_VOLUME_UNSUPPORTED');
    expect(warned).toContain(join(kit, 'src', 'index.ts'));
    expect(
      [...session.stickyDiagnostics.values()].some((m) =>
        m.includes('ANIMUS_EXTERNAL_CROSS_VOLUME_UNSUPPORTED')
      )
    ).toBe(true);
    // A kit-file event after exclusion is not ingested.
    const calls = mocks.analyzeProject.mock.calls.length;
    writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_V2);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(kit, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(mocks.analyzeProject.mock.calls.length).toBe(calls);
  });

  test('an admitted kit that becomes cross-volume on reset is excluded like a removal', async () => {
    const { app, kit } = createWorkspace();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession(app);

    await session.runFullPipeline();
    const kitButtonKey = relative(app, join(kit, 'src', 'Button.tsx'));
    expect(lastAnalyzedPaths()).toContain(kitButtonKey);
    expect(session.externalWatchRoots).toHaveLength(1);

    // The reset re-resolves the kit to a cross-volume root.
    session.sharesProjectVolume = () => false;
    session.resetForHmr();
    await session.runFullPipeline();

    // Manifest input set, watch roots, and ownership are all kit-free.
    expect(lastAnalyzedPaths()).not.toContain(kitButtonKey);
    expect(session.externalWatchRoots).toEqual([]);
    expect(session.externalRootOwners.size).toBe(0);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('ANIMUS_EXTERNAL_CROSS_VOLUME_UNSUPPORTED')
      )
    ).toBe(true);

    // No ghost rides later incremental analyses (the fileCache carries no
    // entry for the excluded kit).
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
    // A dist-only kit is collected with a WIDENED extension set (the entry's
    // own `.mjs`). A directory-granularity event marks its root dirty; the
    // rewalk and later classification must use that same widened set — the
    // project default would see nothing, reconcile the whole kit as deleted,
    // and reject every later `.mjs` edit (a one-way door).
    const systemSource = `import { createSystem } from '@animus-ui/system';
import kit from '../../kits/compiled/dist/index.mjs';
export const system = createSystem({}).extend(kit);
`;
    const ws = createWorkspace(systemSource);
    const distKit = join(ws.parent, 'kits', 'compiled');
    mkdirSync(join(distKit, 'dist'), { recursive: true });
    writeFileSync(join(distKit, 'package.json'), '{"name":"@kits/compiled"}');
    writeFileSync(join(distKit, 'dist', 'index.mjs'), 'export default {};\n');
    writeFileSync(join(distKit, 'dist', 'Button.mjs'), BUTTON_V1);

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

    // No reconstructed deletion: the kit's files stay in the universe.
    expect(fileCache.has(kitIndexKey)).toBe(true);
    expect(fileCache.has(kitButtonKey)).toBe(true);

    // And a later `.mjs` edit is still ingestible through classification.
    writeFileSync(join(distKit, 'dist', 'Button.mjs'), BUTTON_V2);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(distKit, 'dist', 'Button.mjs')]),
      removedFiles: new Set(),
    });
    expect(lastAnalyzedSource(kitButtonKey)).toBe(BUTTON_V2);
  });
});
