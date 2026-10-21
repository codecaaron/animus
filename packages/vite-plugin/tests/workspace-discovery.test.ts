import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from 'vite';
import { afterEach, expect, test } from 'vitest';

import { nativeFunctions } from '../../extract/tests/native-functions';
import {
  createKitWorkspace,
  disposeTempRoots,
} from '../../extract/tests/session/session-fixtures';
import {
  emptyFacts,
  factsExtractor,
  systemImportFacts,
} from '../../extract/tests/source-ingestion-fixtures';
import { runBuildStart } from '../src/build-start';
import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

afterEach(() => disposeTempRoots());

const SYSTEM = `import { createSystem } from '@animus-ui/system';
import kit from '@kits/ui';
export const system = createSystem({}).extend(kit);
`;

/** A build of an app whose system extends `@kits/ui`, a workspace the app's
 *  manifest declares and nothing links into node_modules: Vite resolves
 *  nothing for it, and the stand-in loader resolves the workspace's
 *  `main`, else its `src/index.ts`. */
async function buildWithUnlinkedKit(
  prepareKit: (kit: string) => void
): Promise<{ analysed: string; ctx: PluginContext }> {
  const { app, kit } = createKitWorkspace(SYSTEM);
  prepareKit(kit);
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({ name: 'app', workspaces: ['../kits/ui'] })
  );
  const system = join(app, 'src', 'system.ts');
  let analysed = '';
  const ctx = new PluginContext({ system: './src/system.ts' }, () => ({
    ...nativeFunctions(),
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      dependencies: [],
    }),
    extractModuleFacts: factsExtractor({
      [system]: { ...emptyFacts(system), imports: systemImportFacts(SYSTEM) },
    }),
    resolveSpecifier: (
      specifier: string,
      _fromDir: string,
      _conditions?: readonly string[],
      workspaces?: Record<string, string>
    ) => {
      if (!workspaces || !Object.hasOwn(workspaces, specifier)) return {};
      const dir = workspaces[specifier];
      const { main } = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf-8')
      );
      return { path: join(dir, main ?? 'src/index.ts') };
    },
    // The stand-in locator: the fixture links no workspace into
    // node_modules, so a declared workspace answers.
    locatePackage: (
      name: string,
      _fromDir: string,
      workspaces?: Record<string, string>
    ) => workspaces?.[name] ?? null,
    // The stand-in table: `src/` where the kit has one, with its index as
    // the root entry, else its runtime entry's directory.
    resolveKitSourceRoot: (
      _specifier: string,
      _fromDir: string,
      _conditions?: readonly string[],
      _workspaces?: Record<string, string>,
      _extensionPolicyJson?: string,
      hostEntry?: string,
      packageDir?: string
    ) => {
      const src = join(packageDir ?? '', 'src');
      return JSON.stringify(
        existsSync(src)
          ? {
              rule: 'src',
              root: src,
              entries: ['.ts', '.tsx']
                .map((extension) => join(src, `index${extension}`))
                .filter((file) => existsSync(file))
                .slice(0, 1)
                .map((file) => ['.', file]),
              invalid: [],
              unresolved: null,
            }
          : {
              rule: 'compiled',
              root: hostEntry ? dirname(hostEntry) : null,
              entries: [],
              invalid: [],
              unresolved: null,
            }
      );
    },
    analyzeProject: (...args: unknown[]) => {
      analysed = String(args[0]);
      return JSON.stringify(makeManifest());
    },
  }));
  ctx.rootDir = app;
  ctx.isProd = true;
  ctx.emissionProd = true;
  ctx.logger = createLogger('silent');
  await runBuildStart(ctx, async () => null);
  return { analysed, ctx };
}

// Contract: a workspace package Vite cannot resolve is admitted through the
// system loader only where a source entry redirects Vite's import of it.
test('an unlinked source workspace is analysed, with its import redirected to source', async () => {
  const { analysed, ctx } = await buildWithUnlinkedKit(() => {});

  expect(analysed).toContain('Button.tsx');
  expect(ctx.externalSourceEntries.get('@kits/ui')).toMatch(
    /kits\/ui\/src\/index\.ts$/
  );
});

test('an unlinked compiled-only workspace stays unresolvable', async () => {
  const { analysed, ctx } = await buildWithUnlinkedKit((kit) => {
    rmSync(join(kit, 'src'), { recursive: true, force: true });
    mkdirSync(join(kit, 'dist'));
    writeFileSync(join(kit, 'dist', 'index.js'), 'export const ui = 1;\n');
    writeFileSync(
      join(kit, 'package.json'),
      JSON.stringify({ name: '@kits/ui', main: 'dist/index.js' })
    );
  });

  expect(analysed).not.toContain('dist/index.js');
  expect(ctx.externalSourceEntries.has('@kits/ui')).toBe(false);
});
