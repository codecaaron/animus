import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger, resolveConfig } from 'vite';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createKitWorkspace,
  disposeTempRoots,
  KIT_SYSTEM_SOURCE,
} from '../../extract/tests/session/session-fixtures';
import {
  emptyFacts,
  factsExtractor,
  systemImportFacts,
} from '../../extract/tests/source-ingestion-fixtures';
import { runBuildStart } from '../src/build-start';
import { applyResolvedConfig } from '../src/config';
import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

afterEach(() => {
  vi.restoreAllMocks();
  disposeTempRoots();
});

interface BuildLayout {
  exclude: string[];
  /** Vite's `build.outDir`; its default `dist` when absent. */
  outDir?: string;
  systemSource?: string;
  /** App-relative files written before the build. */
  files?: Record<string, string>;
}

/** A build of an app with a user exclude list and Vite's default `dist`
 *  output already written: the paths analyzed and the lines reported. */
async function buildWithUserExcludes(excludeOrLayout: string[] | BuildLayout) {
  const layout: BuildLayout = Array.isArray(excludeOrLayout)
    ? { exclude: excludeOrLayout }
    : excludeOrLayout;
  const { exclude } = layout;
  const { app } = createKitWorkspace(layout.systemSource);
  mkdirSync(join(app, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(app, 'dist', 'assets', 'index.js'), 'export {};\n');
  for (const [path, source] of Object.entries(layout.files ?? {})) {
    mkdirSync(join(app, path, '..'), { recursive: true });
    writeFileSync(join(app, path), source);
  }
  const systemSource = layout.systemSource ?? KIT_SYSTEM_SOURCE;
  const analyzed: string[] = [];
  const reported: string[] = [];
  // Vite's logger carries the report; its level stays the app's.
  const customLogger = createLogger('silent');
  customLogger.error = (line) => {
    reported.push(line);
  };
  const ctx = new PluginContext({ system: './src/system.ts', exclude }, () => ({
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      dependencies: [],
    }),
    extractFacts: factsExtractor({
      [join(app, 'src', 'system.ts')]: {
        ...emptyFacts(join(app, 'src', 'system.ts')),
        imports: systemImportFacts(systemSource),
      },
    }),
    analyzeProject: (filesJson: string) => {
      // SAFETY: the host's own JSON.stringify of its analysis entries.
      const files = JSON.parse(filesJson) as Array<{ path: string }>;
      analyzed.push(...files.map((file) => file.path));
      return JSON.stringify(makeManifest());
    },
  }));
  applyResolvedConfig(
    ctx,
    await resolveConfig(
      {
        configFile: false,
        root: app,
        logLevel: 'silent',
        customLogger,
        build: { outDir: layout.outDir ?? 'dist' },
      },
      'build'
    )
  );
  await runBuildStart(ctx, async (specifier) => resolve(app, 'src', specifier));
  return { analyzed, reported };
}

describe('a user exclude list never re-admits output', () => {
  test("Vite's output directory stays out of discovery", async () => {
    const { analyzed } = await buildWithUserExcludes(['stories']);

    expect(analyzed).toContain('src/App.tsx');
    expect(analyzed.filter((path) => path.startsWith('dist/'))).toEqual([]);
  });
});

describe('a user exclude list never re-admits output', () => {
  test('a package inside the output directory is never collected', async () => {
    const { analyzed } = await buildWithUserExcludes({
      exclude: ['stories'],
      systemSource: `import { createSystem } from '@animus-ui/system';
import kit from '../dist/kit/src/index.ts';
export const system = createSystem({}).extend(kit);
`,
      files: {
        'dist/kit/package.json': '{"name":"@out/kit"}',
        'dist/kit/src/index.ts': 'export const Kit = 1;\n',
      },
    });

    expect(analyzed).toContain('src/App.tsx');
    expect(analyzed.filter((path) => path.startsWith('dist/'))).toEqual([]);
  });

  test('an output name is a literal path, never a pattern', async () => {
    const { analyzed } = await buildWithUserExcludes({
      exclude: ['stories'],
      outDir: 'build?',
      files: { 'buildA/Panel.tsx': 'export const Panel = 1;\n' },
    });

    expect(analyzed).toContain('buildA/Panel.tsx');
  });
});

describe('an unmatched user exclude is reported', () => {
  test('after the first discovery', async () => {
    const { reported } = await buildWithUserExcludes(['stories', 'App']);

    expect(reported.filter((line) => line.includes('matched nothing'))).toEqual(
      ["[animus] exclude pattern 'stories' matched nothing"]
    );
  });
});
