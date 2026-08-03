import { describe, expect, test } from 'vitest';

import { PluginContext } from '../src/context';

/**
 * The self-verify gate over external-package discovery outcomes: an include
 * that resolved but yielded no sources is a silent misconfiguration and must
 * surface; an UNRESOLVABLE include stays silent (spec-mandated skip in
 * external-package-file-discovery).
 */

/** A context whose other self-verify checks all pass. */
function makeContext(strict: boolean): PluginContext {
  const ctx = new PluginContext({ system: './src/ds.ts', strict });
  ctx.storedManifest = { components: { 'Button::src/Button.tsx': {} } };
  ctx.system.variableCss = ':root { --color-text: #000; }';
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

  test('an unresolvable include is not flagged', () => {
    const ctx = makeContext(true);
    ctx.externalPackageOutcomes = [
      { specifier: '@x/missing', outcome: 'unresolvable', fileCount: 0 },
      { specifier: '@x/ds', outcome: 'resolved', fileCount: 3 },
    ];

    expect(() => ctx.runSelfVerify()).not.toThrow();
  });

  test('non-strict mode warns instead of throwing', () => {
    const ctx = makeContext(false);
    const warnings: string[] = [];
    ctx.logger = {
      warn: (message: string) => warnings.push(message),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    ctx.externalPackageOutcomes = [
      { specifier: '@x/ds', outcome: 'empty', fileCount: 0 },
    ];

    ctx.runSelfVerify();

    expect(warnings).toEqual([
      "[animus:verify] include '@x/ds' resolved but discovered no component sources",
    ]);
  });
});
