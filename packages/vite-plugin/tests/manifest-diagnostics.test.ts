import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

import { surfaceManifestDiagnostics } from '../src/manifest-diagnostics';

const aliasWarn = {
  file: 'src/broken.tsx',
  component: 'Broken',
  kind: 'warn',
  message:
    "unresolvable token alias {colors.missing} in 'border' — declaration dropped",
};

describe('Vite manifest diagnostic surfacing', () => {
  test('surfaces one warn with file, component, property, and alias context', () => {
    const warnings: string[] = [];

    surfaceManifestDiagnostics({ diagnostics: [aliasWarn] }, (message) =>
      warnings.push(message)
    );

    expect(warnings).toEqual([
      "⚠ src/broken.tsx: Broken: unresolvable token alias {colors.missing} in 'border' — declaration dropped",
    ]);
  });

  test('preserves bail and skip wording', () => {
    const warnings: string[] = [];

    surfaceManifestDiagnostics(
      {
        diagnostics: [
          {
            file: 'src/bail.tsx',
            component: 'Bailed',
            kind: 'bail',
            message: 'stage evaluation failed',
          },
          {
            file: 'src/skip.tsx',
            component: 'Skipped',
            kind: 'skip',
            message: 'dynamic borderColor',
          },
        ],
      },
      (message) => warnings.push(message)
    );

    expect(warnings).toEqual([
      '⚠ Bailed not extracted: stage evaluation failed',
      '⚠ Skipped: skipped dynamic borderColor',
    ]);
  });

  test('ignores unknown diagnostic kinds', () => {
    const warnings: string[] = [];

    surfaceManifestDiagnostics(
      { diagnostics: [{ ...aliasWarn, kind: 'future-kind' }] },
      (message) => warnings.push(message)
    );

    expect(warnings).toEqual([]);
  });

  test('routes v2 system loading through the v2 native module', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'packages/vite-plugin/src/index.ts'),
      'utf8'
    );

    expect(source).not.toContain(
      "require('@animus-ui/extract').loadSystemModule"
    );
    expect(source).toContain('native.loadSystemModule(...args)');
  });
});
