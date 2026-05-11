// scripts/hygiene/delete-unused.test.ts
//
// Contract + behavior tests for the oxlint-JSON deleter.
//
// NB: the first `oxlint JSON shape contract` test is intentionally rigid.
// If oxlint changes the diagnostic JSON schema (e.g., renaming `filename`
// to `path` or moving coordinates out of `labels[0].span`), this test
// fails loud and points the maintainer at scripts/hygiene/delete-unused.ts
// as the single adaptation site.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// vp lint's underlying `ignore` crate panics on absolute paths outside
// the project root ("path is expected to be under the root"), and vp's
// lint config (vite.config.ts ignorePatterns) excludes `tmp/`,
// `node_modules/`, `dist/`, etc. — those skips apply even to explicit
// path arguments. Live tests must place fixtures at a project-root path
// that (a) is under the project root and (b) does not match any vp
// ignorePattern. The `.live-test-fixtures-*` prefix satisfies both;
// .gitignore prevents leak commits.
function liveFixtureDir(prefix: string): string {
  return mkdtempSync(join(process.cwd(), prefix));
}

import { applyDeletions } from './delete-unused.ts';

type OxlintSpan = {
  offset: number;
  length: number;
  line: number;
  column: number;
};
type OxlintLabel = { label: string; span: OxlintSpan };
type OxlintDiagnostic = {
  message: string;
  code: string;
  filename: string;
  severity: string;
  causes: unknown[];
  related: unknown[];
  url: string;
  help: string;
  labels: OxlintLabel[];
};

function diag(
  message: string,
  offset: number,
  opts: {
    code?: string;
    filename?: string;
    line?: number;
    column?: number;
    length?: number;
  } = {}
): OxlintDiagnostic {
  return {
    message,
    code: opts.code ?? 'eslint(no-unused-vars)',
    filename: opts.filename ?? 'fixture.ts',
    severity: 'error',
    causes: [],
    related: [],
    url: '',
    help: '',
    labels: [
      {
        label: '',
        span: {
          offset,
          length: opts.length ?? 1,
          line: opts.line ?? 1,
          column: opts.column ?? 1,
        },
      },
    ],
  };
}

describe('oxlint JSON shape contract', () => {
  test('diagnostics use oxlint field shape: code/message/filename + labels[0].span', () => {
    const sample = diag(
      "Variable 'unusedConst' is declared but never used.",
      6
    );
    expect(typeof sample.code).toBe('string');
    expect(typeof sample.message).toBe('string');
    expect(typeof sample.filename).toBe('string');
    expect(Array.isArray(sample.labels)).toBe(true);
    expect(typeof sample.labels[0].span.offset).toBe('number');
    expect(typeof sample.labels[0].span.line).toBe('number');
    expect(typeof sample.labels[0].span.column).toBe('number');
    // Biome 2.x fields MUST NOT be present on the expected oxlint shape
    expect(
      (sample as unknown as { category?: unknown }).category
    ).toBeUndefined();
    expect(
      (sample as unknown as { location?: unknown }).location
    ).toBeUndefined();
  });

  test('live oxlint output uses `eslint(...)` code wrapper', () => {
    // Empirical assertion against the real oxlint binary (via vp lint).
    // Session 89 (2026-04-24, biome-era) caught a fictional-vs-real mismatch
    // between the deleter's filter expectations and the linter's actual
    // category strings. Under oxlint, the equivalent risk surface is the
    // `eslint(<rule>)` code wrapper format. If oxlint changes this shape,
    // this test fails loud and the adapter in delete-unused.ts is the
    // one-file fix point.
    const dir = liveFixtureDir('.live-test-fixtures-contract-');
    try {
      const path = join(dir, 'fixture.ts');
      writeFileSync(path, 'const deadLocal = 1;\nexport const live = 2;\n');
      const result = spawnSync(
        'bunx',
        ['vp', 'lint', '--no-ignore', '--format=json', path],
        { encoding: 'utf-8' }
      );
      const report = JSON.parse(result.stdout);
      const unusedDiag = report.diagnostics.find((d: { message: string }) =>
        d.message.startsWith("Variable 'deadLocal'")
      );
      expect(unusedDiag).toBeDefined();
      expect(typeof unusedDiag.code).toBe('string');
      expect(unusedDiag.code.startsWith('eslint(')).toBe(true);
      expect(unusedDiag.code.endsWith(')')).toBe(true);
      expect(typeof unusedDiag.filename).toBe('string');
      expect(Array.isArray(unusedDiag.labels)).toBe(true);
      expect(typeof unusedDiag.labels[0].span.offset).toBe('number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('top-level declarations', () => {
  test('unused const (single declarator) is deleted', () => {
    const src = 'const unusedConst = 1;\nexport const live = 2;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Variable 'unusedConst' is declared but never used.",
        src.indexOf('unusedConst')
      ),
    ]);
    expect(out).toBe('export const live = 2;\n');
  });

  test('unused function is deleted', () => {
    const src =
      'function unusedFn() {\n  return 1;\n}\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Function 'unusedFn' is declared but never used.",
        src.indexOf('unusedFn')
      ),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused class is deleted', () => {
    const src =
      'class UnusedClass {\n  method() { return 1; }\n}\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Class 'UnusedClass' is declared but never used.",
        src.indexOf('UnusedClass')
      ),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused type alias is deleted', () => {
    const src = 'type UnusedType = { x: number };\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Type alias 'UnusedType' is declared but never used.",
        src.indexOf('UnusedType')
      ),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused interface is deleted', () => {
    const src =
      'interface UnusedInterface {\n  x: number;\n}\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Interface 'UnusedInterface' is declared but never used.",
        src.indexOf('UnusedInterface')
      ),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused enum is deleted', () => {
    const src = 'enum UnusedEnum {\n  A,\n  B,\n}\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Enum 'UnusedEnum' is declared but never used.",
        src.indexOf('UnusedEnum')
      ),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused block-local let is deleted', () => {
    const src = 'function outer() {\n  let unusedLocal = 1;\n  return 2;\n}\n';
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Variable 'unusedLocal' is declared but never used.",
        src.indexOf('unusedLocal')
      ),
    ]);
    expect(out).toBe('function outer() {\n  return 2;\n}\n');
  });
});

describe('multi-declarator VariableStatement', () => {
  test('first of three declarators is dead: removes the first declarator and its comma', () => {
    const src = 'const a = 1, b = 2, c = 3;\nexport const live = b + c;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag("Variable 'a' is declared but never used.", src.indexOf('a = 1')),
    ]);
    expect(out).toBe('const b = 2, c = 3;\nexport const live = b + c;\n');
  });

  test('middle of three declarators is dead: removes middle declarator + its comma', () => {
    const src = 'const a = 1, b = 2, c = 3;\nexport const live = a + c;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag("Variable 'b' is declared but never used.", src.indexOf('b = 2')),
    ]);
    expect(out).toBe('const a = 1, c = 3;\nexport const live = a + c;\n');
  });

  test('last of three declarators is dead: removes last declarator + preceding comma', () => {
    const src = 'const a = 1, b = 2, c = 3;\nexport const live = a + b;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag("Variable 'c' is declared but never used.", src.indexOf('c = 3')),
    ]);
    expect(out).toBe('const a = 1, b = 2;\nexport const live = a + b;\n');
  });
});

describe('destructured binding elements', () => {
  test('first field of object destructuring is dead', () => {
    const src = 'const { a, b } = obj;\nexport const live = b;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag("Variable 'a' is declared but never used.", src.indexOf('a, b')),
    ]);
    expect(out).toBe('const { b } = obj;\nexport const live = b;\n');
  });

  test('middle field of object destructuring is dead', () => {
    const src = 'const { a, b, c } = obj;\nexport const live = a + c;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag("Variable 'b' is declared but never used.", src.indexOf('b, c')),
    ]);
    expect(out).toBe('const { a, c } = obj;\nexport const live = a + c;\n');
  });

  test('last field of object destructuring is dead', () => {
    const src = 'const { a, b, c } = obj;\nexport const live = a + b;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag("Variable 'c' is declared but never used.", src.indexOf('c }')),
    ]);
    expect(out).toBe('const { a, b } = obj;\nexport const live = a + b;\n');
  });

  test('first element of array destructuring is dead', () => {
    const src = 'const [a, b] = arr;\nexport const live = b;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag("Variable 'a' is declared but never used.", src.indexOf('a, b')),
    ]);
    expect(out).toBe('const [b] = arr;\nexport const live = b;\n');
  });
});

describe('function parameter handling (destructured-field-only filter)', () => {
  test('destructured-field unused in function param IS deleted', () => {
    const src =
      'function f({ a, b }: Opts) {\n  return b;\n}\nexport const live = f({ a: 1, b: 2 });\n';
    // oxlint reports destructured-field unused params with "Parameter '<X>'" prefix
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Parameter 'a' is declared but never used. Unused parameters should start with a '_'.",
        src.indexOf('a, b')
      ),
    ]);
    expect(out).toBe(
      'function f({ b }: Opts) {\n  return b;\n}\nexport const live = f({ a: 1, b: 2 });\n'
    );
  });

  test('positional function parameter is NOT deleted (arity-preserving rename is linter-owned)', () => {
    const src =
      'export function f(unusedA: number, b: number) {\n  return b;\n}\n';
    // Synthetic case: oxlint with `args: 'after-used'` (default) does not flag
    // positional unused params before a used param. This test pins the
    // deleter's defensive behavior — even if a param-classified diagnostic
    // resolves to a top-level (non-binding-element) position, it must NOT
    // delete (preserve function arity).
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Parameter 'unusedA' is declared but never used. Unused parameters should start with a '_'.",
        src.indexOf('unusedA')
      ),
    ]);
    expect(out).toBe(src); // unchanged
  });
});

describe('multi-diagnostic within a single file', () => {
  test('two unrelated dead decls in one file: both deleted, offsets preserved', () => {
    const src = 'const deadA = 1;\nconst deadB = 2;\nexport const live = 3;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Variable 'deadA' is declared but never used.",
        src.indexOf('deadA')
      ),
      diag(
        "Variable 'deadB' is declared but never used.",
        src.indexOf('deadB')
      ),
    ]);
    expect(out).toBe('export const live = 3;\n');
  });

  test('overlapping/duplicate diagnostics do not double-splice', () => {
    const src = 'const deadA = 1;\nexport const live = 2;\n';
    const dupOffset = src.indexOf('deadA');
    const out = applyDeletions('fixture.ts', src, [
      diag("Variable 'deadA' is declared but never used.", dupOffset),
      diag("Variable 'deadA' is declared but never used.", dupOffset), // duplicate
    ]);
    expect(out).toBe('export const live = 2;\n');
  });
});

describe('non-target codes/messages are ignored', () => {
  test('import diagnostic is not processed by the deleter (Layer A handles imports)', () => {
    // Under oxlint, unused imports are removed by Layer A's
    // `vp lint --fix-suggestions`. Layer C must skip them so the layers
    // do not collide on the same diagnostic.
    const src = "import { unused } from 'x';\nexport const live = 1;\n";
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Identifier 'unused' is imported but never used.",
        src.indexOf('unused')
      ),
    ]);
    expect(out).toBe(src); // unchanged
  });

  test('unrelated linter rule is skipped', () => {
    const src = 'const live = 1;\nexport { live };\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('prefer const', src.indexOf('live'), {
        code: 'eslint(prefer-const)',
      }),
    ]);
    expect(out).toBe(src); // unchanged
  });

  test('code wrapper `eslint(...)` is unwrapped and accepted', () => {
    // Real oxlint output emits codes as `eslint(no-unused-vars)`; the
    // adapter unwraps the wrapper so internal logic operates on the bare
    // rule name. This test pins that unwrap behavior.
    const src = 'const deadConst = 1;\nexport const live = 2;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag(
        "Variable 'deadConst' is declared but never used.",
        src.indexOf('deadConst'),
        { code: 'eslint(no-unused-vars)' }
      ),
    ]);
    expect(out).toBe('export const live = 2;\n');
  });
});

describe('function overload groups', () => {
  test('deleting an unused overloaded function removes all signatures + implementation atomically', () => {
    const src = [
      'function mapValues<T, U>(obj: Record<string, T>, fn: (v: T) => U): Record<string, U>;',
      'function mapValues<T>(obj: Record<string, T>): T;',
      'function mapValues(obj: any, fn?: any): any { return obj; }',
      '',
      'export const live = 1;',
      '',
    ].join('\n');
    // oxlint flags only the implementation of an overloaded function; the
    // signature-only overloads above are not separately flagged. The deleter
    // must expand the range to include the full group (and any JSDoc trivia
    // between signatures, exercised by Tier 3 fixture below).
    const implOffset =
      src.indexOf('function mapValues(obj: any') + 'function '.length;
    const out = applyDeletions('fixture.ts', src, [
      diag("Function 'mapValues' is declared but never used.", implOffset),
    ]);
    expect(out).not.toContain('mapValues');
    expect(out).toContain('export const live = 1;');
  });
});

describe('Layer C code-drift canary', () => {
  // Closes the session-89 silent-no-op class of regression: if oxlint ever
  // renames a code in a way the deleter's discriminator doesn't catch, the
  // drift receipt fires and the presenter surfaces a WARN.
  //
  // Direct in-process invocation of main() is not exposed; the canary lives
  // inside main() so we drive it via a subprocess that pipes synthetic JSON
  // and writes receipts to a temp file via env vars.
  test('oxlint diagnostics with only unknown codes produce a drift receipt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hygiene-drift-'));
    try {
      const receiptsPath = join(dir, 'receipts.jsonl');
      writeFileSync(receiptsPath, '');
      const synthetic = {
        diagnostics: [
          {
            code: 'eslint(totally-new-rule)',
            message: "Variable 'x' is declared but never used.",
            filename: 'fixture.ts',
            severity: 'error',
            causes: [],
            related: [],
            url: '',
            help: '',
            labels: [
              {
                label: '',
                span: { offset: 0, length: 1, line: 1, column: 1 },
              },
            ],
          },
          {
            code: 'eslint(another-renamed-rule)',
            message: "Style violation 'y'.",
            filename: 'fixture.ts',
            severity: 'error',
            causes: [],
            related: [],
            url: '',
            help: '',
            labels: [
              {
                label: '',
                span: { offset: 5, length: 1, line: 2, column: 1 },
              },
            ],
          },
        ],
      };
      const inputPath = join(dir, 'oxlint.json');
      writeFileSync(inputPath, JSON.stringify(synthetic));

      const result = spawnSync(
        'bun',
        ['run', 'scripts/hygiene/delete-unused.ts', inputPath],
        {
          encoding: 'utf-8',
          env: {
            ...process.env,
            RECEIPTS_FILE: receiptsPath,
            HYGIENE_ITER: '1',
          },
        }
      );
      expect(result.status).toBe(0);
      const receipts = readFileSync(receiptsPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
      const drift = receipts.find(
        (r: { verb?: string }) => r.verb === 'drift-suspected'
      );
      expect(drift).toBeDefined();
      expect(drift.layer).toBe('C');
      expect(drift.kind).toBe('code-drift');
      expect(drift.extras.codesSeen).toEqual([
        'eslint(another-renamed-rule)',
        'eslint(totally-new-rule)',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('oxlint diagnostics with at least one known code do NOT produce drift', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hygiene-no-drift-'));
    try {
      const receiptsPath = join(dir, 'receipts.jsonl');
      writeFileSync(receiptsPath, '');
      // Mix: one known (will match), one unknown (would otherwise trigger drift)
      const synthetic = {
        diagnostics: [
          {
            code: 'eslint(no-unused-vars)',
            message: "Variable 'unusedConst' is declared but never used.",
            filename: 'fixture.ts',
            severity: 'error',
            causes: [],
            related: [],
            url: '',
            help: '',
            labels: [
              {
                label: '',
                span: { offset: 6, length: 11, line: 1, column: 7 },
              },
            ],
          },
          {
            code: 'eslint(some-unrelated-rule)',
            message: 'Some other lint message.',
            filename: 'fixture.ts',
            severity: 'error',
            causes: [],
            related: [],
            url: '',
            help: '',
            labels: [
              {
                label: '',
                span: { offset: 0, length: 1, line: 2, column: 1 },
              },
            ],
          },
        ],
      };
      const inputPath = join(dir, 'oxlint.json');
      writeFileSync(inputPath, JSON.stringify(synthetic));

      const result = spawnSync(
        'bun',
        ['run', 'scripts/hygiene/delete-unused.ts', inputPath],
        {
          encoding: 'utf-8',
          env: {
            ...process.env,
            RECEIPTS_FILE: receiptsPath,
            HYGIENE_ITER: '1',
          },
        }
      );
      expect(result.status).toBe(0);
      const receipts = readFileSync(receiptsPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
      const drift = receipts.find(
        (r: { verb?: string }) => r.verb === 'drift-suspected'
      );
      expect(drift).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Tier 3 corner-case fixtures', () => {
  test('function-overload-with-JSDoc: deletion absorbs JSDoc trivia between signatures and implementation', () => {
    const fixturePath = join(
      process.cwd(),
      'scripts/hygiene/__fixtures__/deleter/overload-with-jsdoc.ts.in'
    );
    const src = readFileSync(fixturePath, 'utf-8');
    // oxlint flags the implementation only — line 6 in the fixture
    // ("function unused(x: number | string)..."). Compute the offset of
    // the impl's `unused` identifier via indexOf on the impl signature.
    const implOffset =
      src.indexOf('function unused(x: number | string)') + 'function '.length;
    const out = applyDeletions(fixturePath, src, [
      diag("Function 'unused' is declared but never used.", implOffset),
    ]);
    expect(out).not.toContain('function unused');
    // The JSDoc between signature 2 and the implementation must be removed
    // along with the overload group rather than orphaned at top-level.
    expect(out).not.toContain('Overloaded helper');
  });

  test('unused namespace declaration is deleted (resolveTarget walks ts.isModuleDeclaration)', () => {
    const fixturePath = join(
      process.cwd(),
      'scripts/hygiene/__fixtures__/deleter/unused-namespace.ts.in'
    );
    const src = readFileSync(fixturePath, 'utf-8');
    // Diagnostic targets the `Unused` identifier on line 1.
    const out = applyDeletions(fixturePath, src, [
      diag(
        "Variable 'Unused' is declared but never used.",
        src.indexOf('Unused')
      ),
    ]);
    expect(out).not.toContain('namespace Unused');
    expect(out).not.toContain('helper');
  });
});

describe('live oxlint pipeline integration', () => {
  test('real oxlint JSON flows through applyDeletions end-to-end', () => {
    // Belt-and-suspenders check: spawn vp lint, pipe its real --format=json
    // output into applyDeletions, assert the cascade's intra-file cleanup
    // actually happens. If oxlint renames fields, changes code shape, or
    // otherwise breaks the contract between the linter and this deleter,
    // this test catches it — unit tests alone would still pass on stale
    // shape assumptions.
    const dir = liveFixtureDir('.live-test-fixtures-live-');
    try {
      const path = join(dir, 'fixture.ts');
      const src = [
        'type DeadType = { x: number };',
        'interface DeadInterface { y: number; }',
        'const deadConst = 1;',
        'function deadFn() { return 1; }',
        '',
        'export const live = 42;',
        '',
      ].join('\n');
      writeFileSync(path, src);

      const oxlint = spawnSync(
        'bunx',
        ['vp', 'lint', '--no-ignore', '--format=json', path],
        { encoding: 'utf-8' }
      );
      const report = JSON.parse(oxlint.stdout);
      expect(Array.isArray(report.diagnostics)).toBe(true);

      const cleaned = applyDeletions(path, src, report.diagnostics);
      // All four dead decls should be removed; the live export preserved.
      expect(cleaned).not.toContain('DeadType');
      expect(cleaned).not.toContain('DeadInterface');
      expect(cleaned).not.toContain('deadConst');
      expect(cleaned).not.toContain('deadFn');
      expect(cleaned).toContain('export const live = 42;');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
