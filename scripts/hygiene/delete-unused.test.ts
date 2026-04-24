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
    const sample = diag('correctness/noUnusedVariables', 1, 7);
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
});
