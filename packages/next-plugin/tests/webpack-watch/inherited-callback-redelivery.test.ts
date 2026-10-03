// @vitest-environment node
import { mkdirSync, symlinkSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  getAnalyzedHashes,
  getReplacementEpoch,
} from '../../../extract/session/singleton';
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
  installLoaderRecorder,
  loadFixtureWebpack,
  LOADER_IMPL_KEY,
  resetAnimusGlobals,
  runWatchSession,
  turnEvidence,
  writeLoaderShim,
} from './watch-session';

import type { CompilationRecord } from './watch-session';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const disposers: Array<() => void> = [];
const prereq = probeRealEnginePrerequisites();

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  Reflect.deleteProperty(globalThis, LOADER_IMPL_KEY);
  resetAnimusGlobals();
  vi.restoreAllMocks();
});

const DS_SOURCE = `import { createSystem, createTheme } from '@animus-ui/system';

export const theme = createTheme().addBreakpoints({ sm: 640 }).build();

export const ds = createSystem().build().seal();
`;

/** The callback closes over private module state: editing STEP changes what
 *  the parent module delivers without changing any replacement plan. */
function parentSource(step: number): string {
  return `import { ds } from './ds';

const STEP = ${step};

export const Parent = ds
  .props({ inl: { property: 'minWidth', transform: (v) => \`\${Number(v) * STEP}px\` } })
  .asElement('div');
`;
}

const CHILD_SOURCE = `import { Parent } from './Parent';

export const Child = Parent.extend().styles({ margin: '4px' }).asElement('div');
`;

const GRAND_SOURCE = `import { Child } from './Child';

export const Grand = Child.extend().styles({ padding: '2px' }).asElement('div');
`;

const PLAIN_SOURCE = `import { ds } from './ds';

export const Plain = ds
  .props({ far: { property: 'textIndent', transform: (v) => \`\${Number(v) * 7}px\` } })
  .asElement('div');
`;

/** Runtime-only values keep each extension's inherited callback delivered. */
const USAGE_SOURCE = `import { Child } from './Child';
import { Grand } from './Grand';
import { Plain } from './Plain';

export const App = ({ n }: { n: number }) => (
  <>
    <Child inl={n} />
    <Grand inl={n} />
    <Plain far={n} />
  </>
);
`;

interface HotUpdateRecord {
  modules: string[];
  code: string;
}

interface HarnessAsset {
  name: string;
  source: { source(): string | Buffer };
}

/** Records the module ids each compilation's hot update carries: the set a
 *  host re-evaluates in place. */
function hotUpdateRecorder(updates: HotUpdateRecord[]) {
  return {
    apply(compiler: {
      hooks: {
        afterCompile: {
          tap(
            name: string,
            fn: (compilation: { getAssets(): HarnessAsset[] }) => void
          ): void;
        };
      };
    }) {
      compiler.hooks.afterCompile.tap('hot-update-recorder', (compilation) => {
        const modules = new Set<string>();
        let code = '';
        for (const asset of compilation.getAssets()) {
          if (!asset.name.endsWith('.hot-update.js')) continue;
          const assetCode = String(asset.source.source());
          code += assetCode;
          for (const match of assetCode.matchAll(/"\.\/(src\/[\w.]+)"\s*:/g)) {
            modules.add(match[1]);
          }
        }
        updates.push({ modules: [...modules].sort(), code });
      });
    },
  };
}

/** A watched project whose Parent, Child and Grand form an extension chain
 *  across three modules, with an unrelated Plain. */
function createInheritingProject() {
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
  project.write('src/ds.ts', DS_SOURCE);
  project.write('src/Parent.ts', parentSource(3));
  project.write('src/Child.ts', CHILD_SOURCE);
  project.write('src/Grand.ts', GRAND_SOURCE);
  project.write('src/Plain.ts', PLAIN_SOURCE);
  project.write('src/Usage.tsx', USAGE_SOURCE);
  project.write(
    'entry.js',
    [
      "require('./src/Parent.ts');",
      "require('./src/Child.ts');",
      "require('./src/Grand.ts');",
      "require('./src/Plain.ts');",
      'if (module.hot) module.hot.accept();',
      '',
    ].join('\n')
  );
  const shimPath = writeLoaderShim(project.root);
  project.backdateAll();
  const state = createWatchState();
  const outputs: Array<{ file: string; turn: number; code: string }> = [];
  installLoaderRecorder(project.root, state, animusLoader, (file, turn, code) =>
    outputs.push({ file, turn, code })
  );
  const updates: HotUpdateRecord[] = [];
  const config = buildHarnessWebpackConfig({
    root: project.root,
    shimPath,
    plugins: [
      new AnimusWebpackPlugin({ system: './src/ds.ts', loaderPath: shimPath }),
      new webpack.HotModuleReplacementPlugin(),
      hotUpdateRecorder(updates),
    ],
    resolve: { extensions: ['.ts', '.tsx', '.js'] },
    rulesTest: /src[\\/].*\.ts$/,
  });
  return { webpack, project, state, updates, outputs, config };
}

const turnEditing = (records: CompilationRecord[], file: string, from = 0) =>
  records.findIndex(
    (record, index) =>
      index >= from && record.modifiedFiles.some((f) => f.endsWith(file))
  );

describe.skipIf(!prereq.ok)(
  'real engine: a parent-private edit re-delivers inheriting modules [next-app]',
  () => {
    test(`prerequisites present${prereq.ok ? '' : ` — SKIPPED: ${prereq.reason}`}`, () => {
      expect(prereq.ok).toBe(true);
    });

    test('the hot update carrying the parent also carries every module extending it, with plans unchanged', async () => {
      const { webpack, project, state, updates, config } =
        createInheritingProject();
      const epochs: Array<string | null> = [];

      const records = await runWatchSession({
        webpack,
        root: project.root,
        config,
        state,
        steps: [
          // The turn after cold absorbs a one-time cold-artifact recheck.
          () => {
            epochs.push(getReplacementEpoch());
            project.write('src/Plain.ts', PLAIN_SOURCE + '// touch\n');
          },
          () => {
            epochs.push(getReplacementEpoch());
            project.write('src/Parent.ts', parentSource(4));
          },
        ],
        settleMs: 1500,
      });
      epochs.push(getReplacementEpoch());

      const evidence = JSON.stringify({
        turns: turnEvidence(records),
        updates: updates.map((u) => u.modules),
        epochs,
      });
      expect(records.length, evidence).toBeGreaterThanOrEqual(3);
      for (const record of records) {
        expect(record.errors, evidence).toEqual([]);
      }
      // The premise: the edit moves neither a plan nor the epoch.
      expect(epochs[2], evidence).not.toBeNull();
      expect(epochs[2], evidence).toBe(epochs[1]);

      const stepRecord = turnEditing(records, 'Parent.ts');
      expect(stepRecord, evidence).toBeGreaterThan(0);
      expect(updates[stepRecord].modules, evidence).toEqual([
        'src/Child.ts',
        'src/Grand.ts',
        'src/Parent.ts',
      ]);
    });

    test('a parent edit the parser cannot finish fails its turn and keeps watching; the repair re-delivers every depth', async () => {
      const { webpack, project, state, updates, outputs, config } =
        createInheritingProject();
      const heldHashes: Array<string | undefined> = [];

      const records = await runWatchSession({
        webpack,
        root: project.root,
        config,
        state,
        steps: [
          () => project.write('src/Plain.ts', PLAIN_SOURCE + '// touch\n'),
          () => {
            heldHashes.push(getAnalyzedHashes()?.get('src/Parent.ts'));
            project.write(
              'src/Parent.ts',
              parentSource(4).replace('const STEP = 4;', 'const STEP = 4 +;')
            );
          },
          () => {
            heldHashes.push(getAnalyzedHashes()?.get('src/Parent.ts'));
            project.write('src/Parent.ts', parentSource(5));
          },
        ],
        settleMs: 1500,
      });

      const evidence = JSON.stringify({
        turns: turnEvidence(records),
        updates: updates.map((u) => u.modules),
        heldHashes,
      });
      const broken = turnEditing(records, 'Parent.ts');
      expect(broken, evidence).toBeGreaterThan(0);
      expect(records[broken].hasErrors, evidence).toBe(true);
      expect(records[broken].errors.join('\n'), evidence).toMatch(
        /analysis not published: .*src\/Parent\.ts/
      );
      // The rejected attempt published nothing: the held generation stands.
      expect(heldHashes[1], evidence).toBe(heldHashes[0]);
      // Extensions rebuilt in the failed turn keep the held generation.
      const childAt = (turn: number) =>
        outputs.findLast((o) => o.file === 'src/Child.ts' && o.turn <= turn)
          ?.code;
      const brokenTurn = records[broken].turn;
      expect(childAt(brokenTurn), evidence).toBe(childAt(brokenTurn - 1));

      const repaired = turnEditing(records, 'Parent.ts', broken + 1);
      expect(repaired, evidence).toBeGreaterThan(broken);
      expect(records[repaired].errors, evidence).toEqual([]);
      expect(getAnalyzedHashes()?.get('src/Parent.ts'), evidence).not.toBe(
        heldHashes[0]
      );
      expect(updates[repaired].modules, evidence).toEqual([
        'src/Child.ts',
        'src/Grand.ts',
        'src/Parent.ts',
      ]);
      expect(updates[repaired].code, evidence).toContain('const STEP = 5;');
      expect(childAt(records[repaired].turn), evidence).not.toBe(
        childAt(brokenTurn)
      );
    });
  }
);
