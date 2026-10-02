import { assertNoErrorDiagnostics } from '@animus-ui/extract/pipeline';
import { createSystem, createTransform } from '@animus-ui/system';
import { join } from 'node:path';
/**
 * Both bundler plugins escalate error diagnostics through the one shared
 * gate, so the failure proven here is the failure each of them raises.
 */
import { describe, expect, test } from 'vitest';

import { readFixtureFile } from '../fixtures/read-fixtures';
import { config } from '../fixtures/setup';
import { runPipeline } from './run-pipeline';

import type { CssDiagnosticLike } from '@animus-ui/extract/pipeline';

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

/** The configured `width` binding returns an object for every value. */
const objectSystem = createSystem()
  .addProps({
    width: {
      property: 'width',
      transform: createTransform('size', (value) => ({ width: value })),
    },
  })
  .build()
  .seal()
  .toConfig();
const objectInputs = {
  propConfigJson: objectSystem.propConfig,
  groupRegistryJson: objectSystem.groupRegistry,
  transformSourcesJson: objectSystem.transformSources,
};

const invalidTransformFile = {
  path: 'fixtures/invalid-transform.tsx',
  source: `import { ds } from './setup';\n\nexport const Broken = ds.styles({ width: 4 }).asElement('div');\n\nexport function BrokenExample() {\n  return <Broken />;\n}\n`,
};

/** A second consumer of the same configured binding. */
const secondConsumerFile = {
  path: 'fixtures/also-broken.tsx',
  source: `import { ds } from './setup';\n\nexport const AlsoBroken = ds.styles({ width: 8 }).asElement('span');\n\nexport function AlsoBrokenExample() {\n  return <AlsoBroken />;\n}\n`,
};

const D8_MESSAGE =
  "transform 'size' returned object for prop 'width' — transforms must " +
  'return a string or finite number; rule-level styling ships as ' +
  'declaration scales (see composite-style-scales)';

type ManifestDiagnostic = CssDiagnosticLike & { severity?: string };

describe('invalid transform result — static escalation', () => {
  const { manifest, css } = runPipeline([invalidTransformFile], {
    inputs: objectInputs,
  });
  const diagnostics: ManifestDiagnostic[] = manifest.diagnostics ?? [];
  const errors = diagnostics.filter((d) => d.kind === 'error');

  test('manifest carries the kind:"error" diagnostic with the D8 message', () => {
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      file: 'fixtures/invalid-transform.tsx',
      component: 'Broken',
      kind: 'error',
      severity: 'error',
    });
    expect(errors[0].message).toBe(D8_MESSAGE);
  });

  test('no declaration is emitted for the invalid result (G4 tripwire)', () => {
    expect(css).not.toContain('[object Object]');
    expect(css).not.toMatch(/width:/);
    expect(manifest.css ?? '').not.toContain('[object Object]');
  });

  test('assertNoErrorDiagnostics throws the [animus]-prefixed D8 failure', () => {
    expect(() => assertNoErrorDiagnostics(manifest.diagnostics)).toThrow(
      `[animus] Broken (fixtures/invalid-transform.tsx): ${D8_MESSAGE}`
    );
  });
});

describe('multiple invalid results — aggregated escalation', () => {
  test('build failure lists every error entry across files', () => {
    const { manifest } = runPipeline(
      [invalidTransformFile, secondConsumerFile],
      { inputs: objectInputs }
    );
    let thrown: Error | null = null;
    try {
      assertNoErrorDiagnostics(manifest.diagnostics);
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    const lines = thrown!.message.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.every((line) => line.startsWith('[animus] '))).toBe(true);
    expect(thrown!.message).toContain(
      'Broken (fixtures/invalid-transform.tsx)'
    );
    expect(thrown!.message).toContain('AlsoBroken (fixtures/also-broken.tsx)');
  });
});

describe('valid transform results stay unaffected', () => {
  test('analyses without error diagnostics pass the gate and keep their CSS', () => {
    const entry = readFixtureFile(COMPONENTS, 'transforms.tsx');
    const { manifest } = runPipeline([entry], {
      inputs: { transformSourcesJson: config.transformSources },
    });
    expect(() => assertNoErrorDiagnostics(manifest.diagnostics)).not.toThrow();
    // Before unit fallback, which would also turn a raw `4` into `4px`.
    expect(manifest.css).toContain('width: 4px');
  });
});
