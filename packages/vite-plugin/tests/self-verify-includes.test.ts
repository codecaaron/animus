import { createLogger } from 'vite';
import { describe, expect, test } from 'vitest';

import { PluginContext } from '../src/context';
import { makeComponent, makeManifest } from './manifest-fixture';

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
  test('an include that resolved but discovered nothing fails verification', () => {
    const ctx = makeContext(true);
    ctx.externalPackageOutcomes = [
      { specifier: '@x/ds', outcome: 'empty', fileCount: 0 },
    ];

    expect(() => ctx.runSelfVerify()).toThrow(
      "[animus:verify] include '@x/ds' resolved but discovered no component sources"
    );
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
      { specifier: '@x/ds', outcome: 'empty', fileCount: 0 },
    ];

    ctx.runSelfVerify();

    expect(warnings).toEqual([
      "[animus:verify] include '@x/ds' resolved but discovered no component sources",
    ]);
  });
});

describe('buildStart gate: enforceIncludeResolution', () => {
  test('strict mode throws naming every unresolvable specifier', () => {
    const ctx = makeContext(true);
    ctx.externalPackageOutcomes = [
      { specifier: '@x/missing', outcome: 'unresolvable', fileCount: 0 },
      { specifier: '@x/typo', outcome: 'unresolvable', fileCount: 0 },
      { specifier: '@x/ds', outcome: 'resolved', fileCount: 3 },
    ];

    expect(() => ctx.enforceIncludeResolution()).toThrow(
      '[animus-extract] unresolvable include specifier(s): @x/missing, @x/typo'
    );
  });

  test('non-strict mode warns and continues', () => {
    const ctx = makeContext(false);
    const warnings: string[] = [];
    ctx.logger = createLogger('silent');
    ctx.logger.warn = (message) => warnings.push(message);
    ctx.externalPackageOutcomes = [
      { specifier: '@x/missing', outcome: 'unresolvable', fileCount: 0 },
    ];

    expect(() => ctx.enforceIncludeResolution()).not.toThrow();
    expect(warnings).toEqual([
      '[animus] [animus-extract] unresolvable include specifier(s): @x/missing',
    ]);
  });

  test('no unresolvable outcomes is a no-op in both modes', () => {
    const ctx = makeContext(true);
    ctx.externalPackageOutcomes = [
      { specifier: '@x/ds', outcome: 'resolved', fileCount: 3 },
      { specifier: '@x/empty', outcome: 'empty', fileCount: 0 },
    ];

    expect(() => ctx.enforceIncludeResolution()).not.toThrow();
  });
});
