import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createLogger, resolveConfig } from 'vite';
import { afterEach, describe, expect, test } from 'vitest';

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
import { applyResolvedConfig } from '../src/config';
import { PluginContext } from '../src/context';
import { serve } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { AnimusExtractOptions } from '../src/index';

afterEach(() => {
  disposeTempRoots();
});

/** The fixture satisfies every other self-verify check: discovered components
 *  require component CSS, so an empty sheet fails for the wrong reason. */
function makeContext(strict: boolean): PluginContext {
  const ctx = new PluginContext({ system: './src/ds.ts', strict });
  serve(ctx, {
    manifest: makeManifest({
      components: { 'Button::src/Button.tsx': makeComponent('src/Button.tsx') },
    }),
    system: { ...ctx.system, variableCss: ':root { --color-text: #000; }' },
    analysisComponentCss: '.animus-Button-abc { margin: 0; }',
  });
  return ctx;
}

describe('self-verify: external package include outcomes', () => {
  test('an include that resolved but discovered nothing passes verification under strict', () => {
    // An empty kit is discovery's coded warning, never a verify failure.
    const ctx = makeContext(true);
    ctx.externalPackageOutcomes = [
      { specifier: '@x/ds', outcome: 'empty', fileCount: 0 },
    ];

    expect(() => ctx.runSelfVerify()).not.toThrow();
  });

  test('an unresolvable include fails verification', () => {
    const ctx = makeContext(true);
    ctx.externalPackageOutcomes = [
      { specifier: '@x/missing', outcome: 'unresolvable', fileCount: 0 },
      { specifier: '@x/ds', outcome: 'resolved', fileCount: 3 },
    ];

    expect(() => ctx.runSelfVerify()).toThrow(
      "[animus:verify] include '@x/missing' could not be resolved"
    );
  });

  test('non-strict mode warns instead of throwing', () => {
    const ctx = makeContext(false);
    const warnings: string[] = [];
    ctx.logger = createLogger('silent');
    ctx.logger.warn = (message) => warnings.push(message);
    ctx.externalPackageOutcomes = [
      { specifier: '@x/missing', outcome: 'unresolvable', fileCount: 0 },
    ];

    ctx.runSelfVerify();

    expect(warnings).toEqual([
      "[animus:verify] include '@x/missing' could not be resolved",
    ]);
  });
});

/** A Vite build whose system extends `includes`, none of which resolves. */
async function buildIncluding(
  includes: string[],
  options: Partial<AnimusExtractOptions> = {},
  files: Record<string, string> = {}
) {
  const { app } = createKitWorkspace();
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(app, path)), { recursive: true });
    writeFileSync(join(app, path), source);
  }
  const system = join(app, 'src', 'system.ts');
  const source =
    "import { createSystem } from '@animus-ui/system';\n" +
    "import kit from '../../kits/ui/src/index.ts';\n" +
    includes
      .map(
        (specifier, index) => `import include${index} from '${specifier}';\n`
      )
      .join('') +
    `export const system = createSystem({}).extend(kit)${includes
      .map((_, index) => `.extend(include${index})`)
      .join('')};\n`;
  writeFileSync(system, source);
  const warnings: string[] = [];
  const customLogger = createLogger('silent');
  customLogger.warn = (message) => {
    warnings.push(message);
  };
  customLogger.error = (message) => {
    warnings.push(message);
  };
  const ctx = new PluginContext(
    { system: './src/system.ts', ...options },
    () => ({
      loadSystemModule: () => ({
        propConfig: '{}',
        groupRegistry: '{}',
        scalesJson: '{}',
        variableMapJson: '{}',
        variableCss: '',
        dependencies: [],
      }),
      extractFacts: factsExtractor({
        [system]: { ...emptyFacts(system), imports: systemImportFacts(source) },
      }),
      analyzeProject: () => JSON.stringify(makeManifest()),
      locatePackage: () => null,
      declaresKitSource: () => false,
    })
  );
  applyResolvedConfig(
    ctx,
    await resolveConfig(
      { configFile: false, root: app, logLevel: 'silent', customLogger },
      'build'
    )
  );
  const run = () =>
    runBuildStart(ctx, async (specifier) =>
      specifier.startsWith('.') ? resolve(app, 'src', specifier) : null
    );
  return { run, warnings };
}

describe('buildStart gate: include resolution', () => {
  test('strict mode throws naming every unresolvable specifier', async () => {
    const { run } = await buildIncluding(['@x/missing', '@x/typo'], {
      strict: true,
    });

    await expect(run()).rejects.toThrow(
      'animus.discovery.unresolvable-include — src/system.ts: includes: unresolvable include specifier(s): @x/missing, @x/typo'
    );
  });

  test('non-strict mode warns and continues', async () => {
    const { run, warnings } = await buildIncluding(['@x/missing']);

    await run();
    expect(
      warnings.filter((line) => line.includes('unresolvable include'))
    ).toEqual([
      '[animus] ⚠ src/system.ts: includes: unresolvable include specifier(s): @x/missing [animus.discovery.unresolvable-include]',
    ]);
  });

  // Contract: every warning a build writes about the project carries an
  // Animus code, so turning every code off leaves a build that writes none.
  test('a build with every Animus code off writes no warning', async () => {
    // An include that resolves to nothing, a pattern that matches nothing,
    // and a tree of build output that is analysed.
    const build = (diagnostics?: AnimusExtractOptions['diagnostics']) =>
      buildIncluding(
        ['@x/missing'],
        { exclude: ['dist', 'stories'], diagnostics },
        { 'out/bundle.js': `export const x = '${'x'.repeat(300 * 1024)}';\n` }
      );

    const reported = await build();
    await reported.run();
    const codes = reported.warnings.map(
      (line) => / \[(animus\.[a-z.-]+)\]$/.exec(line)?.[1]
    );
    expect(codes).not.toContain(undefined);
    expect(codes).toEqual(
      expect.arrayContaining([
        'animus.discovery.unresolvable-include',
        'animus.discovery.exclude-unmatched',
        'animus.discovery.output-trees',
      ])
    );

    const silenced = await build({ 'animus.*': 'off' });
    await silenced.run();
    expect(silenced.warnings).toEqual([]);
  });

  test('no unresolvable outcomes is a no-op in both modes', async () => {
    const { run, warnings } = await buildIncluding([], { strict: true });

    await run();
    expect(
      warnings.filter((line) => line.includes('unresolvable include'))
    ).toEqual([]);
  });
});
