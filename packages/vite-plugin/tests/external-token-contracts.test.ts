import { projectExternalFileOwners } from '@animus-ui/extract/pipeline';
import { join, resolve } from 'node:path';
import { createLogger, resolveConfig } from 'vite';
import { afterEach, describe, expect, test } from 'vitest';

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
  disposeTempRoots();
});

/** A Vite build of an app extending a sibling kit whose theme defines
 *  `colors.externalAccent`; the kit's Button references it unresolved. */
async function buildKitConsumer(strict: boolean) {
  const { app, kit } = createKitWorkspace();
  const system = join(app, 'src', 'system.ts');
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
      sourceThemeManifests: JSON.stringify({
        [join(kit, 'src', 'theme.ts')]: {
          referenceTokens: ['colors.externalAccent'],
        },
      }),
    }),
    extractFacts: factsExtractor({
      [system]: {
        ...emptyFacts(system),
        imports: systemImportFacts(KIT_SYSTEM_SOURCE),
      },
    }),
    analyzeProject: () =>
      JSON.stringify(
        makeManifest({
          diagnostics: [
            {
              file: '../kits/ui/src/Button.tsx',
              component: 'KitButton',
              kind: 'external-token-candidate',
              message: "'colors.externalAccent' did not resolve",
              token: 'colors.externalAccent',
            },
          ],
        })
      ),
  }));
  applyResolvedConfig(
    ctx,
    await resolveConfig(
      { configFile: false, root: app, logLevel: 'silent', customLogger },
      'build'
    )
  );
  const run = () =>
    runBuildStart(ctx, async (specifier) => resolve(app, 'src', specifier));
  return { run, warnings };
}

describe('external token contracts', () => {
  test('strict mode fails the build naming token, component, and source', async () => {
    const { run } = await buildKitConsumer(true);

    await expect(run()).rejects.toThrow(
      /\[animus\] ✖ .*: KitButton: \(from '[^']*kits\/ui\/src\/index\.ts'\) references token 'colors\.externalAccent'.*createTheme\(\)\.extend\(.*\[animus\.token\.external-undefined\]/
    );
  });

  test('non-strict mode warns with the same teaching error and continues', async () => {
    const { run, warnings } = await buildKitConsumer(false);

    await run();
    const taught = warnings.filter((line) => line.includes('KitButton'));
    expect(taught).toHaveLength(1);
    expect(taught[0]).toContain('kits/ui/src/index.ts');
    expect(taught[0]).toContain('createTheme().extend(');
  });
});

describe('external file ownership projection', () => {
  test('a published corpus without the file retires its owner entry', () => {
    // Ownership is projected from the corpus that just published, so an
    // owner whose original is gone cannot outlive it.
    expect(
      projectExternalFileOwners(
        {
          originalEntries: [],
          analysisEntries: [],
          ownership: {},
          diagnostics: [],
        },
        { 'packages/kit/src/Card.tsx': '@acme/ui-kit' }
      )
    ).toEqual({});
  });

  test('a generated child inherits its original external owner', () => {
    // Diagnostics name the generated `.tsx` child, not the `.svelte`
    // original that ownership is recorded for.
    expect(
      projectExternalFileOwners(
        {
          originalEntries: [],
          analysisEntries: [],
          ownership: {
            'packages/kit/src/Card.svelte': {
              originalPath: 'packages/kit/src/Card.svelte',
              originalHash: 'h',
              analysisPaths: ['packages/kit/src/Card.svelte.tsx'],
            },
          },
          diagnostics: [],
        },
        { 'packages/kit/src/Card.svelte': '@acme/ui-kit' }
      )
    ).toEqual({
      'packages/kit/src/Card.svelte': '@acme/ui-kit',
      'packages/kit/src/Card.svelte.tsx': '@acme/ui-kit',
    });
  });
});
