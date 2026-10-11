import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
import { makeComponent, makeManifest } from './manifest-fixture';

afterEach(() => {
  disposeTempRoots();
});

/** The fixture satisfies every other self-verify check: discovered components
 *  require component CSS, so an empty sheet fails for the wrong reason. */
function makeContext(strict: boolean): PluginContext {
  const ctx = new PluginContext({ system: './src/ds.ts', strict });
  ctx.storedManifest = makeManifest({
    components: { 'Button::src/Button.tsx': makeComponent('src/Button.tsx') },
  });
  ctx.system.variableCss = ':root { --color-text: #000; }';
  ctx.resolvedComponentCss = '.animus-Button-abc { margin: 0; }';
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
async function buildIncluding(includes: string[], strict: boolean) {
  const { app } = createKitWorkspace();
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
  const ctx = new PluginContext({ system: './src/system.ts', strict }, () => ({
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
  }));
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
    const { run } = await buildIncluding(['@x/missing', '@x/typo'], true);

    await expect(run()).rejects.toThrow(
      '[animus-extract] unresolvable include specifier(s) in src/system.ts: @x/missing, @x/typo'
    );
  });

  test('non-strict mode warns and continues', async () => {
    const { run, warnings } = await buildIncluding(['@x/missing'], false);

    await run();
    expect(
      warnings.filter((line) => line.includes('unresolvable include'))
    ).toEqual([
      '[animus] [animus-extract] unresolvable include specifier(s) in src/system.ts: @x/missing',
    ]);
  });

  test('no unresolvable outcomes is a no-op in both modes', async () => {
    const { run, warnings } = await buildIncluding([], true);

    await run();
    expect(
      warnings.filter((line) => line.includes('unresolvable include'))
    ).toEqual([]);
  });
});
