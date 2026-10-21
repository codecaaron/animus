import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createLogger, resolveConfig } from 'vite';
import { afterEach, describe, expect, test } from 'vitest';

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
import { bundleRemoval } from '../src/bundle-removal';
import { applyResolvedConfig } from '../src/config';
import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

import type { AnimusExtractOptions } from '../src/index';

afterEach(() => {
  disposeTempRoots();
});

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
  customLogger.info = (message) => {
    warnings.push(message);
  };
  const ctx = new PluginContext(
    { system: './src/system.ts', ...options },
    () => ({
      ...nativeFunctions(),
      loadSystemModule: () => ({
        propConfig: '{}',
        groupRegistry: '{}',
        scalesJson: '{}',
        variableMapJson: '{}',
        variableCss: '',
        // A contextual variable the stylesheet animates unregistered: a
        // property finding at info severity.
        contextualVarsJson: '{"glow":["glow"]}',
        dependencies: [],
      }),
      extractModuleFacts: factsExtractor({
        [system]: { ...emptyFacts(system), imports: systemImportFacts(source) },
      }),
      analyzeProject: () =>
        JSON.stringify(
          makeManifest({
            css: '@keyframes pulse { from { --glow: 0 } to { --glow: 1 } }',
          })
        ),
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
  return { run, warnings, ctx };
}

describe('buildStart gate: include resolution', () => {
  test('strict mode throws naming every unresolvable specifier', async () => {
    const { run } = await buildIncluding(['@x/missing', '@x/typo'], {
      strict: true,
    });

    await expect(run()).rejects.toThrow(
      '[animus] ✖ src/system.ts: includes: unresolvable include specifier(s): @x/missing, @x/typo [animus.discovery.unresolvable-include]'
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
  // Animus code and answers that code's own level: turning every code off
  // leaves a build that writes none, a `kind:warn` key reaches only
  // warn-severity findings, and the self-check does not report a finding
  // again under its own code. Bundle removal's info lines are coded too,
  // every finding line ends with its own code in brackets, and a strict
  // failure prints its records the same way.
  test('a build with every Animus code off writes no warning', async () => {
    // An include that resolves to nothing, a pattern that matches nothing,
    // and a tree of build output that is analysed.
    const build = (options: Partial<AnimusExtractOptions> = {}) =>
      buildIncluding(
        ['@x/missing'],
        { exclude: ['dist', 'stories'], ...options },
        { 'out/bundle.js': `export const x = '${'x'.repeat(300 * 1024)}';\n` }
      );

    // A client build beside another environment keeps every component's
    // CSS, and says so.
    const removal = (ctx: PluginContext) =>
      bundleRemoval(ctx, {}, [], {
        otherEnvironments: ['ssr'],
        manifests: new Set(),
        emit: () => {},
      });

    // Verbose, so info findings print beside the status lines.
    const reported = await build({ verbose: true });
    await reported.run();
    removal(reported.ctx);
    const findings = reported.warnings.filter((line) =>
      /^\[animus\] [⚠ℹ] /.test(line)
    );
    const codes = findings.map(
      (line) => / \[(animus\.[a-z.-]+)\]$/.exec(line)?.[1]
    );
    expect(codes).not.toContain(undefined);
    expect(codes).toEqual(
      expect.arrayContaining([
        'animus.discovery.unresolvable-include',
        'animus.discovery.exclude-unmatched',
        'animus.discovery.output-trees',
        'animus.bundle.removal-kept',
        'animus.property.unregistered-animation',
      ])
    );
    // A code is written in brackets, never in parentheses.
    expect(
      reported.warnings.filter((line) => line.includes('(animus.'))
    ).toEqual([]);

    const silenced = await build({ diagnostics: { 'animus.*': 'off' } });
    await silenced.run();
    removal(silenced.ctx);
    expect(silenced.warnings).toEqual([]);

    // An error-severity finding is no `kind:warn` record.
    const kindOff = await build({
      strict: true,
      diagnostics: { 'kind:warn': 'off' },
    });
    // Each record of a strict failure is a finding line like any other:
    // `[animus]`, the record, and its own code in brackets.
    await expect(kindOff.run()).rejects.toThrow(
      /^\[animus\] strict: 1 error diagnostic\(s\):\n\[animus\] ✖ [^\n]* \[animus\.discovery\.unresolvable-include\]$/
    );

    // The include's own level holds: the self-check does not name it again.
    const verified = await build({
      verify: true,
      diagnostics: { 'animus.discovery.unresolvable-include': 'off' },
    });
    await verified.run();
    expect(
      verified.warnings.filter((line) => line.includes('@x/missing'))
    ).toEqual([]);
  });

  test('no unresolvable outcomes is a no-op in both modes', async () => {
    const { run, warnings } = await buildIncluding([], { strict: true });

    await run();
    expect(
      warnings.filter((line) => line.includes('unresolvable include'))
    ).toEqual([]);
  });
});
