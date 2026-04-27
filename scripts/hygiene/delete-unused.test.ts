// scripts/hygiene/delete-unused.test.ts
//
// Contract + behavior tests for the biome-2.x-JSON deleter.
//
// NB: the first `biome 2.x JSON shape contract` test is intentionally rigid.
// If biome changes the diagnostic JSON schema (e.g., biome 3.x renaming
// `location.path` or moving coordinates to `span`), this test fails loud and
// points the maintainer at scripts/hygiene/delete-unused.ts as the single
// adaptation site.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyDeletions } from './delete-unused.ts';

type Diag = {
  category: string;
  location: {
    path: string;
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
};

function diag(
  category: string,
  line: number,
  column: number,
  endColumn = column + 1
): Diag {
  return {
    category,
    location: {
      path: 'fixture.ts',
      start: { line, column },
      end: { line, column: endColumn },
    },
  };
}

describe('biome 2.x JSON shape contract', () => {
  test('diagnostics use biome 2.x field shape: location.path: string + start/end {line, column}', () => {
    const sample = diag('lint/correctness/noUnusedVariables', 1, 7);
    expect(typeof sample.location.path).toBe('string');
    expect(typeof sample.location.start.line).toBe('number');
    expect(typeof sample.location.start.column).toBe('number');
    expect(typeof sample.location.end.line).toBe('number');
    expect(typeof sample.location.end.column).toBe('number');
    // Biome 1.x fields MUST NOT be present on the expected shape
    expect(
      (sample.location as unknown as { span?: unknown }).span
    ).toBeUndefined();
    expect(
      (sample.location as unknown as { sourceCode?: unknown }).sourceCode
    ).toBeUndefined();
  });

  test('live biome 2.x output uses `lint/` category prefix', () => {
    // Empirical assertion against the real biome binary. Session 89 (2026-04-24)
    // caught a fictional-vs-real mismatch: my deleter filtered on
    // 'correctness/noUnusedVariables' while biome actually emits
    // 'lint/correctness/noUnusedVariables'. If biome ever drops or changes the
    // prefix, this test fails loud and the normalizer in delete-unused.ts is
    // the one-file fix point.
    const dir = mkdtempSync(join(tmpdir(), 'hygiene-contract-'));
    try {
      const path = join(dir, 'fixture.ts');
      writeFileSync(path, 'const deadLocal = 1;\nexport const live = 2;\n');
      const result = spawnSync(
        'bunx',
        ['--bun', '@biomejs/biome', 'check', '--reporter=json', path],
        { encoding: 'utf-8' }
      );
      const report = JSON.parse(result.stdout);
      const unusedDiag = report.diagnostics.find((d: { category: string }) =>
        d.category.endsWith('noUnusedVariables')
      );
      expect(unusedDiag).toBeDefined();
      expect(unusedDiag.category.startsWith('lint/')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('top-level declarations', () => {
  test('unused const (single declarator) is deleted', () => {
    const src = 'const unusedConst = 1;\nexport const live = 2;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 7),
    ]);
    expect(out).toBe('export const live = 2;\n');
  });

  test('unused function is deleted', () => {
    const src =
      'function unusedFn() {\n  return 1;\n}\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 10),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused class is deleted', () => {
    const src =
      'class UnusedClass {\n  method() { return 1; }\n}\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 7),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused type alias is deleted', () => {
    const src = 'type UnusedType = { x: number };\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 6),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused interface is deleted', () => {
    const src =
      'interface UnusedInterface {\n  x: number;\n}\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 11),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused enum is deleted', () => {
    const src = 'enum UnusedEnum {\n  A,\n  B,\n}\nexport const live = 1;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 6),
    ]);
    expect(out).toBe('export const live = 1;\n');
  });

  test('unused block-local let is deleted', () => {
    const src = 'function outer() {\n  let unusedLocal = 1;\n  return 2;\n}\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 2, 7),
    ]);
    expect(out).toBe('function outer() {\n  return 2;\n}\n');
  });
});

describe('multi-declarator VariableStatement', () => {
  test('first of three declarators is dead: removes the first declarator and its comma', () => {
    const src = 'const a = 1, b = 2, c = 3;\nexport const live = b + c;\n';
    // `a` at line 1, column 7
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 7),
    ]);
    expect(out).toBe('const b = 2, c = 3;\nexport const live = b + c;\n');
  });

  test('middle of three declarators is dead: removes middle declarator + its comma', () => {
    const src = 'const a = 1, b = 2, c = 3;\nexport const live = a + c;\n';
    // `b` at line 1, column 14
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 14),
    ]);
    expect(out).toBe('const a = 1, c = 3;\nexport const live = a + c;\n');
  });

  test('last of three declarators is dead: removes last declarator + preceding comma', () => {
    const src = 'const a = 1, b = 2, c = 3;\nexport const live = a + b;\n';
    // `c` at line 1, column 21
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 21),
    ]);
    expect(out).toBe('const a = 1, b = 2;\nexport const live = a + b;\n');
  });
});

describe('destructured binding elements', () => {
  test('first field of object destructuring is dead', () => {
    const src = 'const { a, b } = obj;\nexport const live = b;\n';
    // `a` at line 1, column 9
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 9),
    ]);
    expect(out).toBe('const { b } = obj;\nexport const live = b;\n');
  });

  test('middle field of object destructuring is dead', () => {
    const src = 'const { a, b, c } = obj;\nexport const live = a + c;\n';
    // `b` at line 1, column 12
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 12),
    ]);
    expect(out).toBe('const { a, c } = obj;\nexport const live = a + c;\n');
  });

  test('last field of object destructuring is dead', () => {
    const src = 'const { a, b, c } = obj;\nexport const live = a + b;\n';
    // `c` at line 1, column 15
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 15),
    ]);
    expect(out).toBe('const { a, b } = obj;\nexport const live = a + b;\n');
  });

  test('first element of array destructuring is dead', () => {
    const src = 'const [a, b] = arr;\nexport const live = b;\n';
    // `a` at line 1, column 8
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 8),
    ]);
    expect(out).toBe('const [b] = arr;\nexport const live = b;\n');
  });
});

describe('function parameter handling (destructured-field-only filter)', () => {
  test('destructured-field unused in function param IS deleted', () => {
    const src =
      'function f({ a, b }: Opts) {\n  return b;\n}\nexport const live = f({ a: 1, b: 2 });\n';
    // `a` at line 1, column 14
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedFunctionParameters', 1, 14),
    ]);
    expect(out).toBe(
      'function f({ b }: Opts) {\n  return b;\n}\nexport const live = f({ a: 1, b: 2 });\n'
    );
  });

  test('positional function parameter is NOT deleted (arity-preserving rename is biome-owned)', () => {
    const src =
      'export function f(unusedA: number, b: number) {\n  return b;\n}\n';
    // `unusedA` at line 1, column 19
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedFunctionParameters', 1, 19),
    ]);
    expect(out).toBe(src); // unchanged
  });
});

describe('multi-diagnostic within a single file', () => {
  test('two unrelated dead decls in one file: both deleted, offsets preserved', () => {
    const src = 'const deadA = 1;\nconst deadB = 2;\nexport const live = 3;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 7),
      diag('correctness/noUnusedVariables', 2, 7),
    ]);
    expect(out).toBe('export const live = 3;\n');
  });

  test('overlapping/duplicate diagnostics do not double-splice', () => {
    const src = 'const deadA = 1;\nexport const live = 2;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedVariables', 1, 7),
      diag('correctness/noUnusedVariables', 1, 7), // duplicate
    ]);
    expect(out).toBe('export const live = 2;\n');
  });
});

describe('non-target categories are ignored', () => {
  test('noUnusedImports diagnostic is not processed by the deleter', () => {
    // noUnusedImports is biome's job in Layer B; the deleter skips this category
    // entirely so Layer B's delete and Layer C's delete do not collide.
    const src = "import { unused } from 'x';\nexport const live = 1;\n";
    const out = applyDeletions('fixture.ts', src, [
      diag('correctness/noUnusedImports', 1, 10),
    ]);
    expect(out).toBe(src); // unchanged
  });

  test('unrelated diagnostic category is skipped', () => {
    const src = 'const live = 1;\nexport { live };\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('style/useConst', 1, 7),
    ]);
    expect(out).toBe(src);
  });

  test('category prefix `lint/` is accepted (real biome 2.x shape)', () => {
    const src = 'const deadConst = 1;\nexport const live = 2;\n';
    const out = applyDeletions('fixture.ts', src, [
      diag('lint/correctness/noUnusedVariables', 1, 7),
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
    // Biome flags only the implementation (line 3, col 10) for overloaded
    // functions; the signature-only overloads above are not separately
    // flagged. The deleter must expand the range to include the full group.
    const out = applyDeletions('fixture.ts', src, [
      diag('lint/correctness/noUnusedVariables', 3, 10),
    ]);
    expect(out).not.toContain('mapValues');
    expect(out).toContain('export const live = 1;');
  });
});

describe('Layer C category-drift canary', () => {
  // Closes the session-89 silent-no-op class of regression: if biome ever
  // renames a category in a way the deleter's normalizer doesn't catch, the
  // drift receipt fires and the presenter surfaces a WARN.
  //
  // Direct in-process invocation of main() is not exposed; the canary lives
  // inside main() so we drive it via a subprocess that pipes synthetic JSON
  // and writes receipts to a temp file via env vars.
  test('biome diagnostics with only unknown categories produce a drift receipt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hygiene-drift-'));
    try {
      const receiptsPath = join(dir, 'receipts.jsonl');
      writeFileSync(receiptsPath, '');
      const synthetic = {
        diagnostics: [
          {
            category: 'lint/correctness/totallyNewBiomeRule',
            location: {
              path: 'fixture.ts',
              start: { line: 1, column: 1 },
              end: { line: 1, column: 2 },
            },
          },
          {
            category: 'lint/style/anotherRenamedRule',
            location: {
              path: 'fixture.ts',
              start: { line: 2, column: 1 },
              end: { line: 2, column: 2 },
            },
          },
        ],
      };
      const inputPath = join(dir, 'biome.json');
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
      expect(drift.kind).toBe('category-drift');
      expect(drift.extras.categoriesSeen).toEqual([
        'lint/correctness/totallyNewBiomeRule',
        'lint/style/anotherRenamedRule',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('biome diagnostics with at least one known category do NOT produce drift', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hygiene-no-drift-'));
    try {
      const receiptsPath = join(dir, 'receipts.jsonl');
      writeFileSync(receiptsPath, '');
      // Mix: one known (will match), one unknown (would otherwise trigger drift)
      const synthetic = {
        diagnostics: [
          {
            category: 'lint/correctness/noUnusedVariables',
            location: {
              path: 'fixture.ts',
              start: { line: 1, column: 7 },
              end: { line: 1, column: 11 },
            },
          },
          {
            category: 'lint/style/somethingElse',
            location: {
              path: 'fixture.ts',
              start: { line: 2, column: 1 },
              end: { line: 2, column: 2 },
            },
          },
        ],
      };
      const inputPath = join(dir, 'biome.json');
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
    // Biome flags the implementation only — line 6 in the fixture (function unused(x: ...): ...)
    const out = applyDeletions(fixturePath, src, [
      diag('lint/correctness/noUnusedVariables', 6, 10),
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
      diag('lint/correctness/noUnusedVariables', 1, 11),
    ]);
    expect(out).not.toContain('namespace Unused');
    expect(out).not.toContain('helper');
  });
});

describe('live biome pipeline integration', () => {
  test('real biome JSON flows through applyDeletions end-to-end', () => {
    // This is the belt-and-suspenders check that unit tests can not provide:
    // spawn biome, pipe its real --reporter=json output into applyDeletions,
    // assert the cascade's intra-file cleanup actually happens.
    // If biome renames fields, changes category shape, or otherwise breaks
    // the contract between Layer B (biome) and Layer C (this deleter), this
    // test catches it — unit tests alone would still pass on stale assumptions.
    const dir = mkdtempSync(join(tmpdir(), 'hygiene-live-'));
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

      const biome = spawnSync(
        'bunx',
        ['--bun', '@biomejs/biome', 'check', '--reporter=json', path],
        { encoding: 'utf-8' }
      );
      const report = JSON.parse(biome.stdout);
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
