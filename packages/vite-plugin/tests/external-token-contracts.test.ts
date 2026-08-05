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
    ctx.logger = {
      warn: (message: string) => warnings.push(message),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

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

  test('runAnalysis enforces the gate on every pass — strict throws through the analysis path', () => {
    expect(() => makeAnalysisContext(true).runAnalysis([])).toThrow(
      /references token 'colors\.externalAccent'/
    );
  });

  test('runAnalysis warns and continues in non-strict mode', () => {
    const ctx = makeAnalysisContext(false);
    const warnings: string[] = [];
    ctx.logger = {
      warn: (message: string) => warnings.push(message),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    expect(() => ctx.runAnalysis([])).not.toThrow();
    expect(warnings.some((w) => w.includes('KitCard'))).toBe(true);
  });
});
