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

describe('Next manifest diagnostic surfacing', () => {
  test('surfaces one warn with file, component, property, and alias context', () => {
    const warnings: string[] = [];

    surfaceManifestDiagnostics({ diagnostics: [aliasWarn] }, (message) =>
      warnings.push(message)
    );

    expect(warnings).toEqual([
      "⚠ src/broken.tsx: Broken: unresolvable token alias {colors.missing} in 'border' — declaration dropped",
    ]);
  });

  test('does not surface bail or skip diagnostics', () => {
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

    expect(warnings).toEqual([]);
  });

  test('ignores unknown diagnostic kinds', () => {
    const warnings: string[] = [];

    surfaceManifestDiagnostics(
      { diagnostics: [{ ...aliasWarn, kind: 'future-kind' }] },
      (message) => warnings.push(message)
    );

    expect(warnings).toEqual([]);
  });

  test('routes production and HMR manifests through the same helper', () => {
    const pluginSource = readFileSync(
      resolve(process.cwd(), 'packages/next-plugin/src/plugin.ts'),
      'utf8'
    );
    const productionSource = pluginSource.slice(
      pluginSource.indexOf('private async runFullPipeline'),
      pluginSource.indexOf('private loadSystem')
    );
    const hmrSource = pluginSource.slice(
      pluginSource.indexOf('private async runIncrementalPipeline'),
      pluginSource.indexOf('/** Expose file cache for HMR change detection */')
    );
    const parseAndSurface =
      /const manifest = JSON\.parse\(manifestJson\);\s*surfaceManifestDiagnostics\(manifest,/;

    expect(productionSource).toMatch(parseAndSurface);
    expect(
      productionSource.match(/surfaceManifestDiagnostics\(manifest,/g) ?? []
    ).toHaveLength(1);
    expect(hmrSource).toMatch(parseAndSurface);
    expect(
      hmrSource.match(/surfaceManifestDiagnostics\(manifest,/g) ?? []
    ).toHaveLength(1);
  });

  test('routes v2 system loading through the v2 native module', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'packages/next-plugin/src/singleton.ts'),
      'utf8'
    );

    expect(source).not.toContain(
      "require('@animus-ui/extract').loadSystemModule"
    );
    expect(source).toContain('native.loadSystemModule(...args)');
  });
});
