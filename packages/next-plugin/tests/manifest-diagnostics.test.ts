import { surfaceManifestDiagnostics } from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

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

  test('surfaces bail and skip diagnostics (shared pipeline semantics)', () => {
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

  test('both pipelines route through a single shared diagnostic-surfacing core', () => {
    const pluginSource = readFileSync(
      resolve(process.cwd(), 'packages/next-plugin/src/plugin.ts'),
      'utf8'
    );
    const parseAndSurface =
      /const manifest = JSON\.parse\(manifestJson\);\s*surfaceManifestDiagnostics\(manifest,/;

    // There is exactly ONE surfaceManifestDiagnostics call site in the whole
    // plugin after the two pipelines collapsed onto a shared core.
    expect(
      pluginSource.match(/surfaceManifestDiagnostics\(manifest,/g) ?? []
    ).toHaveLength(1);

    // That single call lives in the shared analyzeAndEmit core, immediately
    // after the manifest parse.
    const coreSource = pluginSource.slice(
      pluginSource.indexOf('private async analyzeAndEmit'),
      pluginSource.indexOf('/** Expose file cache for HMR change detection */')
    );
    expect(coreSource).toMatch(parseAndSurface);
    expect(
      coreSource.match(/surfaceManifestDiagnostics\(manifest,/g) ?? []
    ).toHaveLength(1);

    // The core is reachable from both pipelines: production and HMR each
    // delegate to this.analyzeAndEmit(...).
    const productionSource = pluginSource.slice(
      pluginSource.indexOf('private async runFullPipeline'),
      pluginSource.indexOf('private loadSystem')
    );
    const hmrSource = pluginSource.slice(
      pluginSource.indexOf('private async runIncrementalPipeline'),
      pluginSource.indexOf('private async analyzeAndEmit')
    );
    expect(productionSource).toMatch(/this\.analyzeAndEmit\(/);
    expect(hmrSource).toMatch(/this\.analyzeAndEmit\(/);
  });

  test('routes v2 system loading through the v2 native module', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'packages/next-plugin/src/singleton.ts'),
      'utf8'
    );

    // No hardcoded v1 require for system loading.
    expect(source).not.toContain(
      "require('@animus-ui/extract').loadSystemModule"
    );
    // The adapter is hoisted: the singleton wires its engine API through the
    // single shared factory, which calls loadSystemModule on the native module.
    expect(source).toContain('createV2EngineApi(');
    const adapterSource = readFileSync(
      resolve(process.cwd(), 'packages/extract/pipeline/engine-adapter.ts'),
      'utf8'
    );
    expect(adapterSource).toContain('native.loadSystemModule(...args)');
  });
});
