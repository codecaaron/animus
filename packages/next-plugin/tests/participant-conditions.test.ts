/**
 * Participants of one Next build under different export conditions: the
 * client compiler resolves with `browser`, the server's with `node`.
 * Against the real engine.
 */
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ExtractionSession } from '../../extract/session/extraction-session';
import { getSharedCss, sessionKey } from '../../extract/session/singleton';
import {
  disposeTempRoots,
  makeTempRoot,
  resetAnimusGlobals,
} from '../../extract/tests/session/session-fixtures';
import { AnimusWebpackPlugin } from '../src/plugin';

const REPO_ROOT = resolve(__dirname, '../../..');

type PluginCompiler = Parameters<AnimusWebpackPlugin['apply']>[0];
type RunHandler = Parameters<PluginCompiler['hooks']['run']['tapPromise']>[1];

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
});

afterEach(() => {
  restoreGlobals();
  disposeTempRoots();
});

/** A project whose kit's root entry differs by condition. `systemImport`
 *  is what the system module imports from the kit. */
function createProject(systemImport: string): string {
  const root = realpathSync(makeTempRoot('animus-conditions-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', '@animus-ui'), { recursive: true });
  for (const name of ['system', 'properties']) {
    symlinkSync(
      join(REPO_ROOT, 'packages', name),
      join(root, 'node_modules', '@animus-ui', name)
    );
  }
  writeFileSync(join(root, 'package.json'), '{"name":"app"}');
  const kit = join(root, 'node_modules', '@kits', 'ui');
  mkdirSync(join(kit, 'src'), { recursive: true });
  writeFileSync(
    join(kit, 'package.json'),
    JSON.stringify({
      name: '@kits/ui',
      exports: {
        '.': {
          animus: { browser: './src/browser.ts', node: './src/node.ts' },
          browser: './dist/browser.mjs',
          node: './dist/node.mjs',
        },
        './definition': {
          animus: './src/definition.ts',
          default: './dist/definition.mjs',
        },
      },
    })
  );
  const kitSystem = (group: string) =>
    `import { createSystem } from '@animus-ui/system';
import { ${group} } from '@animus-ui/system/groups';

export const ds = createSystem().addGroup('${group}', ${group}).build().seal();
`;
  // The two root entries define different systems; the definition subpath
  // is one file under either condition.
  writeFileSync(
    join(kit, 'src', 'browser.ts'),
    kitSystem('color') + "export const brand = '#111111';\n"
  );
  writeFileSync(
    join(kit, 'src', 'node.ts'),
    kitSystem('space') + "export const brand = '#222222';\n"
  );
  writeFileSync(
    join(kit, 'src', 'definition.ts'),
    kitSystem('color') + "export const brand = '#333333';\n"
  );
  mkdirSync(join(kit, 'dist'), { recursive: true });
  for (const name of ['browser', 'node', 'definition']) {
    writeFileSync(join(kit, 'dist', `${name}.mjs`), 'export const ds = {};\n');
  }
  writeFileSync(
    join(root, 'src', 'system.ts'),
    `import { createSystem, createTheme } from '@animus-ui/system';
import { layout } from '@animus-ui/system/groups';
import { ds as kit, brand } from '${systemImport}';

export const tokens = createTheme().addColors({ brand: { 500: brand } }).build();

export const ds = createSystem({ includes: [kit] }).addGroup('layout', layout).build().seal();
`
  );
  writeFileSync(join(root, 'src', 'App.tsx'), 'export const App = 1;\n');
  return root;
}

/** A compiler that resolves with `condition`, as webpack's target default
 *  gives Next's client (`browser`) and server (`node`) compilers. */
function createCompiler(root: string, name: string, condition: string) {
  const run: RunHandler[] = [];
  const compiler: PluginCompiler = {
    hooks: {
      run: { tapPromise: (_name: string, fn: RunHandler) => void run.push(fn) },
      watchRun: { tapPromise: () => {} },
      compilation: { tap: () => {} },
      thisCompilation: { tap: () => {} },
    },
    context: root,
    options: {
      name,
      resolve: { conditionNames: ['webpack', 'production', condition] },
    },
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: -100 },
      sources: { RawSource: class {} },
      NormalModule: {
        getCompilationHooks: () => ({ needBuild: { tapAsync: () => {} } }),
      },
    },
  };
  return { compiler, run: () => run[0](compiler) };
}

type Side = 'client' | 'server';

/** One build's two compilers, run in `order`: the build's CSS, or what the
 *  second compiler's run rejected with. */
async function runBuild(
  root: string,
  order: readonly [Side, Side]
): Promise<{ css: string } | { rejected: unknown }> {
  const plugins = {
    client: new AnimusWebpackPlugin(
      { system: './src/system.ts' },
      { build: 'b' }
    ),
    server: new AnimusWebpackPlugin(
      { system: './src/system.ts' },
      { build: 'b' }
    ),
  };
  const compilers = {
    client: createCompiler(root, 'client', 'browser'),
    server: createCompiler(root, 'server', 'node'),
  };
  for (const side of ['client', 'server'] as const) {
    plugins[side].apply(compilers[side].compiler);
  }
  await compilers[order[0]].run();
  try {
    await compilers[order[1]].run();
  } catch (rejected) {
    return { rejected };
  }
  return { css: getSharedCss(sessionKey('b', root)) };
}

const ORDERS = [
  ['client', 'server'],
  ['server', 'client'],
] as const;

describe('one agreed system authority', () => {
  /** Contract: a build's system never depends on which participant arrives
   *  first (SA5, SE-2). Compilers whose conditions select one system share
   *  it in either order; conditions that select different systems fail the
   *  build in either order, naming both. */
  test("a build's system never depends on which participant arrives first", async () => {
    for (const order of ORDERS) {
      resetAnimusGlobals();
      // The system reads a kit subpath with one target under every condition.
      const outcome = await runBuild(
        createProject('@kits/ui/definition'),
        order
      );
      expect(outcome, order.join(' then ')).toEqual({
        css: expect.stringContaining('#333333'),
      });
    }
    for (const order of ORDERS) {
      resetAnimusGlobals();
      // The system reads the kit root, which `browser` and `node` select
      // differently.
      const outcome = await runBuild(createProject('@kits/ui'), order);
      expect('rejected' in outcome, order.join(' then ')).toBe(true);
      if (!('rejected' in outcome)) continue;
      // The plugin throws from the dist copy of the class: match its code.
      expect(outcome.rejected).toMatchObject({
        code: 'SessionConfigurationConflict',
      });
      expect(String(outcome.rejected)).toContain('browser]');
      expect(String(outcome.rejected)).toContain('node]');
    }
  }, 60000);

  /** Contract: the authority is the committed system's. A reload whose
   *  analysis fails commits nothing, so the authority, and the proofs other
   *  contexts made against it, stay the committed system's. */
  test('a failed reload leaves the committed authority', async () => {
    const root = createProject('@kits/ui/definition');
    const participant = (condition: string) => {
      const session = new ExtractionSession(
        { system: './src/system.ts' },
        { build: 'b' }
      );
      session.rootDir = root;
      session.conditions = ['webpack', 'development', condition];
      return session;
    };
    const owner = participant('browser');
    const other = participant('node');
    await owner.runFullPipeline();
    other.agreeWithSystemAuthority();

    // The edit selects the kit root, which differs by condition, and a
    // file that cannot parse fails the reload's analysis.
    const systemPath = join(root, 'src', 'system.ts');
    writeFileSync(
      systemPath,
      readFileSync(systemPath, 'utf-8').replace(
        '@kits/ui/definition',
        '@kits/ui'
      )
    );
    const brokenPath = join(root, 'src', 'Broken.tsx');
    writeFileSync(brokenPath, 'export const Broken = (;\n');
    await expect(
      owner.handleWatchUpdate({
        modifiedFiles: new Set([systemPath, brokenPath]),
        removedFiles: new Set(),
      })
    ).rejects.toThrow();

    expect(getSharedCss(owner.key)).toContain('#333333');
    expect(() => other.agreeWithSystemAuthority()).not.toThrow();
  }, 60000);

  /** Contract: a reload's proofs are its own. A reload can change what
   *  another context resolves while the owner's system stays the same, so
   *  each committed reload discards every other context's proof. */
  test('a reload discards every other context proof', async () => {
    const root = createProject('@kits/ui');
    const manifestPath = join(
      root,
      'node_modules',
      '@kits',
      'ui',
      'package.json'
    );
    const exportsTo = (node: string) =>
      writeFileSync(
        manifestPath,
        JSON.stringify({
          name: '@kits/ui',
          exports: {
            '.': {
              animus: { browser: './src/definition.ts', node },
              default: './dist/definition.mjs',
            },
          },
        })
      );
    // Both conditions select one file: the contexts agree.
    exportsTo('./src/definition.ts');
    const participant = (condition: string) => {
      const session = new ExtractionSession(
        { system: './src/system.ts' },
        { build: 'b' }
      );
      session.rootDir = root;
      session.conditions = ['webpack', 'development', condition];
      return session;
    };
    const owner = participant('browser');
    const other = participant('node');
    await owner.runFullPipeline();
    other.agreeWithSystemAuthority();

    // The manifest moves `node` to another file; the owner's reload commits
    // the same system it had.
    exportsTo('./src/node.ts');
    const systemPath = join(root, 'src', 'system.ts');
    writeFileSync(systemPath, readFileSync(systemPath, 'utf-8'));
    await owner.handleWatchUpdate({
      modifiedFiles: new Set([systemPath, manifestPath]),
      removedFiles: new Set(),
    });

    expect(getSharedCss(owner.key)).toContain('#333333');
    expect(() => other.agreeWithSystemAuthority()).toThrow(
      'SessionConfigurationConflict'
    );
  }, 60000);
});
