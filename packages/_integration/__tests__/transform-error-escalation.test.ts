import { assertNoErrorDiagnostics } from '@animus-ui/extract/pipeline';
import { join } from 'node:path';
/**
 * Static transform-result hardening, end to end (transform-result-hardening
 * design D3/D8; spec extraction-diagnostics §Error diagnostics fail the
 * build): a registered transform returning an object produces a
 * `kind: "error"` manifest diagnostic, emits NO declaration (never
 * `[object Object]` — guardrail G4), and the shared plugin gate
 * `assertNoErrorDiagnostics` throws the D8 message both bundler plugins
 * escalate identically (each calls this one helper at its accept point).
 *
 * Fixture sources are inline (keyframes-binding-substitution.test.ts
 * convention) — they still travel the real OXC parse → chain walk →
 * QuickJS transform evaluation path via run-pipeline. The valid-transform
 * control reuses the on-disk transforms.tsx fixture.
 */
import { describe, expect, test } from 'vitest';

import { readFixtureFile } from '../fixtures/read-fixtures';
import { runPipeline } from './run-pipeline';

import type { CssDiagnosticLike } from '@animus-ui/extract/pipeline';

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

/** Registers `size` (the width prop's transform) with an OBJECT return —
 *  the legacy-runtime shape the static gate now rejects. */
const invalidTransformFile = {
  path: 'fixtures/invalid-transform.tsx',
  source: `import { createTransform } from '@animus-ui/system';\nimport { ds } from './setup';\n\nexport const objectSize = createTransform('size', (value) => ({ width: value }));\n\nexport const Broken = ds.styles({ width: 4 }).asElement('div');\n\nexport function BrokenExample() {\n  return <Broken />;\n}\n`,
};

/** A second consumer in a DIFFERENT file — same invalid transform, so the
 *  aggregated failure must list both entries. */
const secondConsumerFile = {
  path: 'fixtures/also-broken.tsx',
  source: `import { ds } from './setup';\n\nexport const AlsoBroken = ds.styles({ width: 8 }).asElement('span');\n\nexport function AlsoBrokenExample() {\n  return <AlsoBroken />;\n}\n`,
};

const D8_MESSAGE =
  "transform 'size' returned object for prop 'width' — transforms must " +
  'return a string or finite number; rule-level styling ships as ' +
  'declaration scales (see composite-style-scales)';

describe('invalid transform result — static escalation', () => {
  const { manifest, css } = runPipeline([invalidTransformFile]);
  const errors = (
    (manifest.diagnostics ?? []) as Array<
      CssDiagnosticLike & { severity?: string }
    >
  ).filter((d) => d.kind === 'error');

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
    const { manifest } = runPipeline([
      invalidTransformFile,
      secondConsumerFile,
    ]);
    let thrown: Error | null = null;
    try {
      assertNoErrorDiagnostics(manifest.diagnostics);
    } catch (e) {
      thrown = e as Error;
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
    const { manifest, css } = runPipeline([entry]);
    expect(() => assertNoErrorDiagnostics(manifest.diagnostics)).not.toThrow();
    expect(css).toContain('width: 8px');
  });
});
