// @vitest-environment node
/**
 * Real-pipeline gauntlet lane (openspec:
 * next-webpack-served-transform-coherence, increment 03): ONE scenario runs
 * the entire stack for real — NAPI engine, real system module evaluation,
 * real analysis, the real plugin and the real loader — against the
 * next-app fixture's compiled webpack. A parent component gains a new
 * variant; the extending descendant must serve the merged config from the
 * TRIGGERING compilation (spec: next-webpack-integration, "Shape edit
 * rebuilds descendants in the triggering compilation").
 *
 * Skips loudly (with the exact build command) when the NAPI binary or the
 * package dists are absent — mirroring the dev-lane prerequisites idiom.
 */
import { mkdirSync, symlinkSync } from 'fs';
import { join, sep } from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import animusLoader from '../../src/loader';
import { AnimusWebpackPlugin } from '../../src/plugin';
import { replacementEpochPath } from '../../src/session-paths';
import { getSessionArtifactDir } from '../../src/singleton';
import {
  buildGauntletConfig,
  createGauntletProject,
  createWatchState,
  epochHygieneViolations,
  installLoaderRecorder,
  loadFixtureWebpack,
  LOADER_IMPL_KEY,
  resetAnimusGlobals,
  runWatchSession,
  writeLoaderShim,
} from './harness';
import {
  probeRealEnginePrerequisites,
  REPO_ROOT,
  WEBPACK_FIXTURES,
} from './prerequisites';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const g = globalThis as Record<string, unknown>;
const disposers: Array<() => void> = [];
const prereq = probeRealEnginePrerequisites();

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  delete g[LOADER_IMPL_KEY];
  resetAnimusGlobals();
  vi.restoreAllMocks();
});

const THEME_SOURCE = `import { createTheme } from '@animus-ui/system';

export const tokens = createTheme()
  .addColors({ brand: { 500: '#3b82f6' } })
  .addColorModes('light', {
    light: { primary: 'brand.500' },
    dark: { primary: 'brand.500' },
  })
  .build();
`;

const DS_SOURCE = `import { createSystem } from '@animus-ui/system';
import { color } from '@animus-ui/system/groups';

export { tokens } from './theme';

export const { system: ds } = createSystem()
  .addGroup('surface', color)
  .build();
`;

function buttonSource(withVariant: boolean): string {
  const variant = withVariant
    ? `\n  .variant({\n    prop: 'tone',\n    variants: { loud: { fontWeight: 700 } },\n  })`
    : '';
  return `import { ds } from './ds';

export const Button = ds
  .styles({ padding: '8px', bg: 'primary' })${variant}
  .asElement('button');
`;
}

const FANCY_SOURCE = `import { Button } from './Button';

export const Fancy = Button.extend()
  .styles({ margin: '4px' })
  .asElement('button');
`;

/** JSX usage keeps the variant alive through reconciliation pruning. */
const USAGE_SOURCE = `import { Fancy } from './Fancy';

export const App = () => <Fancy tone="loud" />;
`;

describe.skipIf(!prereq.ok)('real-engine gauntlet [next-app]', () => {
  test(`prerequisites present${prereq.ok ? '' : ` — SKIPPED: ${prereq.reason}`}`, () => {
    expect(prereq.ok).toBe(true);
  });

  test('variant added to a parent: the extending descendant serves the merged config from the triggering compilation', async () => {
    const webpack = loadFixtureWebpack(WEBPACK_FIXTURES[0].webpackPath);
    resetAnimusGlobals();

    const project = createGauntletProject({ entryModules: [] });
    disposers.push(() => project.dispose());
    // Real workspace packages, resolved exactly as a consumer app would.
    mkdirSync(join(project.root, 'node_modules/@animus-ui'), {
      recursive: true,
    });
    symlinkSync(
      join(REPO_ROOT, 'packages/system'),
      join(project.root, 'node_modules/@animus-ui/system')
    );
    symlinkSync(
      join(REPO_ROOT, 'packages/properties'),
      join(project.root, 'node_modules/@animus-ui/properties')
    );

    project.write('src/theme.ts', THEME_SOURCE);
    project.write('src/ds.ts', DS_SOURCE);
    project.write('src/Button.ts', buttonSource(false));
    project.write('src/Fancy.ts', FANCY_SOURCE);
    project.write('src/Usage.tsx', USAGE_SOURCE);
    project.write(
      'entry.js',
      "require('./src/Button.ts');\nrequire('./src/Fancy.ts');\n"
    );
    const shimPath = writeLoaderShim(project.root);
    project.backdateAll();

    const state = createWatchState();
    const outputs: Array<{ file: string; turn: number; code: string }> = [];
    installLoaderRecorder(
      project.root,
      state,
      animusLoader as unknown as (this: unknown, source: string) => string,
      (file, turn, code) => {
        outputs.push({ file, turn, code });
      }
    );

    const plugin = new AnimusWebpackPlugin({
      system: './src/ds.ts',
      loaderPath: shimPath,
    });

    const records = await runWatchSession({
      webpack,
      root: project.root,
      config: buildGauntletConfig({
        root: project.root,
        shimPath,
        plugins: [plugin],
        resolve: { extensions: ['.ts', '.tsx', '.js'] },
        rulesTest: /src[\\/].*\.ts$/,
      }),
      state,
      steps: [
        // Absorb the one-time cold-artifact snapshot (see differential N0).
        () =>
          project.write('src/Button.ts', buttonSource(false) + '// touch\n'),
        // The real shape edit: the parent gains a variant.
        () => project.write('src/Button.ts', buttonSource(true)),
      ],
      settleMs: 1500,
    });

    expect(records.length).toBeGreaterThanOrEqual(3);
    for (const record of records) {
      expect(record.errors).toEqual([]);
    }

    // Cold build extracted BOTH components for real (transform output is
    // engine-emitted createComponent code, not source passthrough).
    const coldFancy = outputs.find(
      (o) => o.file === 'src/Fancy.ts' && o.turn === 1
    );
    expect(coldFancy).toBeDefined();
    expect(coldFancy!.code).toContain('createComponent');
    expect(coldFancy!.code).not.toContain('tone');

    // The variant edit's triggering compilation re-ran the DESCENDANT's
    // loader and its freshly served transform carries the merged variant
    // config — same-compilation delivery through the real engine.
    const fancyAfterEdit = outputs.filter(
      (o) => o.file === 'src/Fancy.ts' && o.turn >= 3
    );
    expect(fancyAfterEdit.length).toBeGreaterThanOrEqual(1);
    const merged = fancyAfterEdit[fancyAfterEdit.length - 1];
    expect(merged.code).toContain('createComponent');
    expect(merged.code).toContain('tone');
    expect(merged.code).toContain('loud');

    // The Fancy rebuild happened in the SAME turn that carried the Button
    // edit — never a later catch-up turn.
    const buttonEditTurns = state.modifiedByTurn.size
      ? [...state.modifiedByTurn.entries()]
          .filter(([, files]) =>
            files.some((f) => f.endsWith(`${sep}Button.ts`))
          )
          .map(([turn]) => turn)
      : [];
    expect(buttonEditTurns.length).toBeGreaterThanOrEqual(1);
    expect(buttonEditTurns).toContain(merged.turn);

    // The served bundle's Fancy module region carries the merged config.
    const finalBundle = records[records.length - 1].bundle;
    const fancyRegion = finalBundle.slice(finalBundle.indexOf('src/Fancy.ts'));
    expect(fancyRegion).toContain('tone');

    // Hygiene holds under the real pipeline too (session-scoped path).
    expect(
      epochHygieneViolations(
        records,
        replacementEpochPath(getSessionArtifactDir()!)
      )
    ).toEqual([]);
  });
});
