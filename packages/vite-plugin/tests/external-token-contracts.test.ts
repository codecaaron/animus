import { createLogger } from 'vite';
import { describe, expect, test } from 'vitest';

import { PluginContext } from '../src/context';

/**
 * The post-analysis gate over cross-source token contracts
 * (extraction-diagnostics): a discovered component referencing a token its
 * OWN package defines but the consumer theme does not warns in non-strict
 * mode and FAILS the build under `strict: true`; witness misses and
 * consumer-local files stay silent.
 */

const KIT_DIR = '/repo/packages/kit/src';

function makeContext(strict: boolean): PluginContext {
  const ctx = new PluginContext({ system: './src/ds.ts', strict });
  ctx.storedManifest = {
    diagnostics: [
      {
        file: 'packages/kit/src/Card.tsx',
        component: 'KitCard',
        kind: 'external-token-candidate',
        message: "'colors.externalAccent' did not resolve",
        token: 'colors.externalAccent',
      },
    ],
  };
  ctx.externalFileOwners = { 'packages/kit/src/Card.tsx': '@acme/ui-kit' };
  ctx.externalDirOwners = { [KIT_DIR]: '@acme/ui-kit' };
  ctx.system.sourceThemeManifestsJson = JSON.stringify({
    [`${KIT_DIR}/theme.ts`]: { referenceTokens: ['colors.externalAccent'] },
  });
  return ctx;
}

describe('enforceExternalTokenContracts', () => {
  test('strict mode fails the build naming token, component, and source', () => {
    const ctx = makeContext(true);

    expect(() => ctx.enforceExternalTokenContracts()).toThrow(
      /KitCard \(from '@acme\/ui-kit'\) references token 'colors\.externalAccent'.*createTheme\(\)\.extend\(/
    );
  });

  test('non-strict mode warns with the same teaching error and continues', () => {
    const ctx = makeContext(false);
    const warnings: string[] = [];
    ctx.logger = createLogger('silent');
    ctx.logger.warn = (message) => warnings.push(message);

    expect(() => ctx.enforceExternalTokenContracts()).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('KitCard');
    expect(warnings[0]).toContain("'@acme/ui-kit'");
    expect(warnings[0]).toContain('createTheme().extend(');
  });

  test('a fulfilled contract stays silent (no candidates in the manifest)', () => {
    const ctx = makeContext(true);
    ctx.storedManifest = { diagnostics: [] };

    expect(() => ctx.enforceExternalTokenContracts()).not.toThrow();
  });

  test('a witness miss stays silent even under strict', () => {
    const ctx = makeContext(true);
    ctx.system.sourceThemeManifestsJson = JSON.stringify({
      [`${KIT_DIR}/theme.ts`]: { referenceTokens: ['colors.somethingElse'] },
    });

    expect(() => ctx.enforceExternalTokenContracts()).not.toThrow();
  });

  test('a consumer-local candidate file stays silent even under strict', () => {
    const ctx = makeContext(true);
    ctx.externalFileOwners = {};

    expect(() => ctx.enforceExternalTokenContracts()).not.toThrow();
  });

  // Every analysis pass — buildStart, HMR re-analysis, new-file detection,
  // geological reset — flows through PluginContext.runAnalysis, so the gate
  // must fire there (next-plugin parity: both hosts share one pipeline
  // gate). Driven through the real method via the injected engine seam so
  // the pin is behavioral, not source-text layout.
  function makeAnalysisContext(strict: boolean): PluginContext {
    const manifest = {
      diagnostics: [
        {
          file: 'packages/kit/src/Card.tsx',
          component: 'KitCard',
          kind: 'external-token-candidate',
          message: "'colors.externalAccent' did not resolve",
          token: 'colors.externalAccent',
        },
      ],
      sheets: { global: '' },
      css: '',
    };
    const ctx = new PluginContext({ system: './src/ds.ts', strict }, () => ({
      analyzeProject: () => JSON.stringify(manifest),
    }));
    ctx.externalFileOwners = { 'packages/kit/src/Card.tsx': '@acme/ui-kit' };
    ctx.externalDirOwners = { [KIT_DIR]: '@acme/ui-kit' };
    ctx.system.sourceThemeManifestsJson = JSON.stringify({
      [`${KIT_DIR}/theme.ts`]: { referenceTokens: ['colors.externalAccent'] },
    });
    return ctx;
  }

  // The gate runs on PUBLICATION, not inside runAnalysis: the join
  // correlates diagnostics raised against generated MDX/Svelte children
  // through `externalFileOwners`, and those child keys enter the owner map
  // in `publishSourceIngestion` itself — enforcing inside runAnalysis
  // dropped a violation on the exact pass that introduced it.
  const cardEntry = {
    path: 'packages/kit/src/Card.tsx',
    source: 'export const KitCard = 1;\n',
    hash: 'h',
  };
  const cardIngestion = {
    originalEntries: [cardEntry],
    analysisEntries: [cardEntry],
    ownership: {
      [cardEntry.path]: {
        originalPath: cardEntry.path,
        originalHash: cardEntry.hash,
        analysisPaths: [cardEntry.path],
      },
    },
    diagnostics: [],
  };

  test('publication enforces the gate on every pass — strict throws after owners update', () => {
    const ctx = makeAnalysisContext(true);
    expect(ctx.runAnalysis([])).toBe(true);
    expect(() => ctx.publishSourceIngestion(cardIngestion)).toThrow(
      /references token 'colors\.externalAccent'/
    );
  });

  test('publication warns and continues in non-strict mode', () => {
    const ctx = makeAnalysisContext(false);
    const warnings: string[] = [];
    ctx.logger = createLogger('silent');
    ctx.logger.warn = (message) => warnings.push(message);

    expect(ctx.runAnalysis([])).toBe(true);
    expect(() => ctx.publishSourceIngestion(cardIngestion)).not.toThrow();
    expect(warnings.some((w) => w.includes('KitCard'))).toBe(true);
  });

  test('a published corpus without the file retires its owner entry', () => {
    // Ownership is projected from the corpus that just published, so an
    // owner whose original is gone cannot outlive it — the next generation's
    // diagnostics can only join through files that generation analyzed.
    const ctx = makeAnalysisContext(false);
    ctx.logger = createLogger('silent');
    ctx.logger.warn = () => {};

    ctx.publishSourceIngestion({
      originalEntries: [],
      analysisEntries: [],
      ownership: {},
      diagnostics: [],
    });

    expect(ctx.externalFileOwners).toEqual({});
  });

  test('a generated child inherits its original external owner', () => {
    // The correlation the projection exists for: diagnostics name the
    // generated `.tsx` child, ownership is recorded for the `.svelte`
    // original.
    const ctx = makeAnalysisContext(false);
    ctx.logger = createLogger('silent');
    ctx.logger.warn = () => {};
    ctx.externalFileOwners = { 'packages/kit/src/Card.svelte': '@acme/ui-kit' };

    ctx.publishSourceIngestion({
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
    });

    expect(ctx.externalFileOwners).toEqual({
      'packages/kit/src/Card.svelte': '@acme/ui-kit',
      'packages/kit/src/Card.svelte.tsx': '@acme/ui-kit',
    });
  });
});
