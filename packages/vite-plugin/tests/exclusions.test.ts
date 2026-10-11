import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveConfig } from 'vite';
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

/** A build of an app with a user exclude list and Vite's default `dist`
 *  output already written: the paths analyzed and the lines reported. */
async function buildWithUserExcludes(exclude: string[]) {
  const { app } = createKitWorkspace();
  mkdirSync(join(app, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(app, 'dist', 'assets', 'index.js'), 'export {};\n');
  const analyzed: string[] = [];
  const reported: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    reported.push(parts.map(String).join(' '));
  });
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
        imports: systemImportFacts(KIT_SYSTEM_SOURCE),
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
      { configFile: false, root: app, logLevel: 'silent' },
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

describe('an unmatched user exclude is reported', () => {
  test('after the first discovery', async () => {
    const { reported } = await buildWithUserExcludes(['stories', 'App']);

    expect(reported.filter((line) => line.includes('matched nothing'))).toEqual(
      ["[animus] exclude pattern 'stories' matched nothing"]
    );
  });
});
