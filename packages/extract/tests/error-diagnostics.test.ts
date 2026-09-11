import { describe, expect, it } from 'vitest';

import { assertNoErrorDiagnostics } from '../pipeline/error-diagnostics';

import type { CssDiagnosticLike } from '../pipeline/error-diagnostics';

const objectResultError: CssDiagnosticLike & { severity?: string } = {
  file: 'src/invalid.tsx',
  component: 'Broken',
  kind: 'error',
  message:
    "transform 'size' returned object for prop 'width' — transforms must " +
    'return a string or finite number; rule-level styling ships as ' +
    'declaration scales (see composite-style-scales)',
  severity: 'error',
};

const severityErrorOnWarnKind: CssDiagnosticLike & { severity?: string } = {
  file: 'd.tsx',
  component: '_broken',
  kind: 'warn',
  message: 'selector alias without substitutable subject',
  severity: 'error',
};

function thrownFrom(run: () => void): Error | null {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new TypeError(
      `assertNoErrorDiagnostics threw a non-Error value: ${String(error)}`,
      { cause: error }
    );
  }
  return null;
}

describe('assertNoErrorDiagnostics', () => {
  it('accepts undefined and empty diagnostics', () => {
    expect(() => assertNoErrorDiagnostics(undefined)).not.toThrow();
    expect(() => assertNoErrorDiagnostics([])).not.toThrow();
  });

  it('never trips on warning-only diagnostics (bail/skip/warn, any severity)', () => {
    expect(() =>
      assertNoErrorDiagnostics([
        {
          file: 'a.tsx',
          component: 'Bailed',
          kind: 'bail',
          message: 'stage evaluation failed',
        },
        {
          file: 'b.tsx',
          component: 'Skipped',
          kind: 'skip',
          message: 'dynamic borderColor',
        },
        {
          file: 'c.tsx',
          component: 'Warned',
          kind: 'warn',
          message: "transform 'size' threw for prop 'width'; raw value applied",
        },
        severityErrorOnWarnKind,
      ])
    ).not.toThrow();
  });

  it('lists every error entry, one [animus]-prefixed line each', () => {
    const second: CssDiagnosticLike = {
      file: 'src/other.tsx',
      component: 'AlsoBroken',
      kind: 'error',
      message:
        "transform 'inline' returned non-finite-number for prop 'gap' — " +
        'transforms must return a string or finite number; rule-level ' +
        'styling ships as declaration scales (see composite-style-scales)',
    };
    const thrown = thrownFrom(() =>
      assertNoErrorDiagnostics([objectResultError, second])
    );
    expect(thrown).not.toBeNull();
    const lines = thrown!.message.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.startsWith('[animus] '))).toBe(true);
    expect(lines[0]).toContain('Broken');
    expect(lines[1]).toContain('AlsoBroken');
    expect(lines[1]).toContain('src/other.tsx');
    expect(lines[1]).toContain(second.message);
  });

  it('collapses byte-identical duplicate entries to one line', () => {
    // The engine records one entry per resolve position (a responsive value
    // can fail per breakpoint); the build failure repeats nothing.
    const thrown = thrownFrom(() =>
      assertNoErrorDiagnostics([
        objectResultError,
        { ...objectResultError },
        { ...objectResultError },
      ])
    );
    expect(thrown).not.toBeNull();
    expect(thrown!.message.split('\n')).toHaveLength(1);
  });

  it('renders placeholders, never "undefined" or empty parens, for absent fields', () => {
    const thrown = thrownFrom(() =>
      assertNoErrorDiagnostics([
        { file: '', component: '', kind: 'error', message: 'boom' },
      ])
    );
    expect(thrown!.message).toBe(
      '[animus] <unknown component> (<unknown file>): boom'
    );
  });

  it('pins the exact failure content (identical escalation in every host)', () => {
    const thrown = thrownFrom(() =>
      assertNoErrorDiagnostics([objectResultError])
    );
    expect(thrown?.message).toBe(
      "[animus] Broken (src/invalid.tsx): transform 'size' returned object " +
        "for prop 'width' — transforms must return a string or finite " +
        'number; rule-level styling ships as declaration scales (see ' +
        'composite-style-scales)'
    );
  });
});
