// @vitest-environment node
import { mkdirSync, symlinkSync } from 'fs';
import { join, sep } from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { replacementEpochPath } from '../../../extract/session/session-paths';
import { getSessionArtifactDir } from '../../../extract/session/singleton';
import animusLoader from '../../src/loader';
import { AnimusWebpackPlugin } from '../../src/plugin';
import {
  probeRealEnginePrerequisites,
  REPO_ROOT,
  WEBPACK_FIXTURES,
} from './prerequisites';
import {
  buildHarnessWebpackConfig,
  createHarnessProject,
  createWatchState,
  epochHygieneViolations,
  installLoaderRecorder,
  loadFixtureWebpack,
  LOADER_IMPL_KEY,
  resetAnimusGlobals,
  runWatchSession,
  writeLoaderShim,
} from './watch-session';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const disposers: Array<() => void> = [];
const prereq = probeRealEnginePrerequisites();

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  Reflect.deleteProperty(globalThis, LOADER_IMPL_KEY);
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

export const ds = createSystem()
  .addGroup('surface', color)
  .build()
  .seal();
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

describe.skipIf(!prereq.ok)(
  'real engine: shape edit rebuilds descendants in the same compilation [next-app]',
  () => {
    test(`prerequisites present${prereq.ok ? '' : ` — SKIPPED: ${prereq.reason}`}`, () => {
      expect(prereq.ok).toBe(true);
    });

    test('variant added to a parent: the extending descendant serves the merged config from the triggering compilation', async () => {
      const webpack = loadFixtureWebpack(WEBPACK_FIXTURES[0].webpackPath);
      resetAnimusGlobals();

      const project = createHarnessProject({ entryModules: [] });
      disposers.push(() => project.dispose());
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
        animusLoader,
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
        config: buildHarnessWebpackConfig({
          root: project.root,
          shimPath,
          plugins: [plugin],
          resolve: { extensions: ['.ts', '.tsx', '.js'] },
          rulesTest: /src[\\/].*\.ts$/,
        }),
        state,
        steps: [
          // A throwaway edit: the turn after cold absorbs a one-time
          // cold-artifact recheck.
          () =>
            project.write('src/Button.ts', buttonSource(false) + '// touch\n'),
          () => project.write('src/Button.ts', buttonSource(true)),
        ],
        settleMs: 1500,
      });

      expect(records.length).toBeGreaterThanOrEqual(3);
      for (const record of records) {
        expect(record.errors).toEqual([]);
      }

      const coldFancy = outputs.find(
        (o) => o.file === 'src/Fancy.ts' && o.turn === 1
      );
      expect(coldFancy).toBeDefined();
      expect(coldFancy!.code).toContain('createComponent');
      expect(coldFancy!.code).not.toContain('tone');

      const fancyAfterEdit = outputs.filter(
        (o) => o.file === 'src/Fancy.ts' && o.turn >= 3
      );
      expect(fancyAfterEdit.length).toBeGreaterThanOrEqual(1);
      const merged = fancyAfterEdit[fancyAfterEdit.length - 1];
      expect(merged.code).toContain('createComponent');
      expect(merged.code).toContain('tone');
      expect(merged.code).toContain('loud');

      const buttonEditTurns = state.modifiedByTurn.size
        ? [...state.modifiedByTurn.entries()]
            .filter(([, files]) =>
              files.some((f) => f.endsWith(`${sep}Button.ts`))
            )
            .map(([turn]) => turn)
        : [];
      expect(buttonEditTurns.length).toBeGreaterThanOrEqual(1);
      expect(buttonEditTurns).toContain(merged.turn);

      const finalBundle = records[records.length - 1].bundle;
      const fancyRegion = finalBundle.slice(
        finalBundle.indexOf('src/Fancy.ts')
      );
      expect(fancyRegion).toContain('tone');

      expect(
        epochHygieneViolations(
          records,
          replacementEpochPath(getSessionArtifactDir()!)
        )
      ).toEqual([]);
    });
  }
);
