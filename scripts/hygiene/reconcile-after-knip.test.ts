import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  fixEmptyModules,
  fixStaleBarrelReExports,
  getExportsOfFile,
} from './reconcile-after-knip';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'reconcile-'));
}

function write(dir: string, rel: string, content: string): string {
  const full = join(dir, rel);
  const parent = full.substring(0, full.lastIndexOf('/'));
  mkdirSync(parent, { recursive: true });
  writeFileSync(full, content, 'utf-8');
  return full;
}

describe('fixEmptyModules', () => {
  test('0-byte file gets `export {};` written', () => {
    const dir = scratch();
    try {
      const f = write(dir, 'packages/a/src/utils.ts', '');
      const fixed = fixEmptyModules([f]);
      expect(fixed).toEqual([f]);
      expect(readFileSync(f, 'utf-8')).toBe('export {};\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-empty file is left alone', () => {
    const dir = scratch();
    try {
      const f = write(dir, 'packages/a/src/utils.ts', 'export const x = 1;');
      const fixed = fixEmptyModules([f]);
      expect(fixed).toEqual([]);
      expect(readFileSync(f, 'utf-8')).toBe('export const x = 1;');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('file with only whitespace is NOT treated as empty', () => {
    // Whitespace files compile as empty scripts too, but playing it safe:
    // we only touch literally 0-byte files. Anything with content (even
    // whitespace) is left alone.
    const dir = scratch();
    try {
      const f = write(dir, 'packages/a/src/utils.ts', '\n\n');
      const fixed = fixEmptyModules([f]);
      expect(fixed).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('getExportsOfFile', () => {
  test('collects named exports from `export const/function/class/interface/type/enum`', () => {
    const dir = scratch();
    try {
      const f = write(
        dir,
        'a.ts',
        `
export const a = 1;
export function b() {}
export class C {}
export interface D {}
export type E = number;
export enum F { X }
`
      );
      const exps = getExportsOfFile(f);
      expect([...exps].sort()).toEqual(['C', 'D', 'E', 'F', 'a', 'b']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('collects named exports from `export { X, Y }` clauses', () => {
    const dir = scratch();
    try {
      const f = write(
        dir,
        'a.ts',
        `
const a = 1;
const b = 2;
export { a, b as renamed };
`
      );
      const exps = getExportsOfFile(f);
      expect([...exps].sort()).toEqual(['a', 'renamed']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('collects `default` for `export default`', () => {
    const dir = scratch();
    try {
      const f = write(dir, 'a.ts', `const x = 1;\nexport default x;\n`);
      const exps = getExportsOfFile(f);
      expect(exps.has('default')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-exported declarations are NOT collected (locally-declared-but-not-exported shape)', () => {
    const dir = scratch();
    try {
      const f = write(
        dir,
        'a.ts',
        `
const a = 1;
export const b = 2;
`
      );
      const exps = getExportsOfFile(f);
      expect(exps.has('a')).toBe(false);
      expect(exps.has('b')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixStaleBarrelReExports — TS2305 shape', () => {
  test('strips a single stale named re-export from a barrel', () => {
    const dir = scratch();
    try {
      write(dir, 'packages/a/src/source.ts', 'export {};\n');
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        `export { EmberGlow } from './source';\n`
      );
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([barrel]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).not.toContain('EmberGlow');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('preserves live bindings, strips only stale ones', () => {
    const dir = scratch();
    try {
      write(dir, 'packages/a/src/source.ts', 'export const Keep = 1;\n');
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        `export { Keep, Drop } from './source';\n`
      );
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([barrel]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).toContain('Keep');
      expect(out).not.toContain('Drop');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixStaleBarrelReExports — TS2459 shape (declared-but-not-exported)', () => {
  test('strips name when target has declaration but no `export` keyword', () => {
    const dir = scratch();
    try {
      write(
        dir,
        'packages/a/src/source.ts',
        `
export const Live = 1;
const Dead = 2;
`
      );
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        `export { Live, Dead } from './source';\n`
      );
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([barrel]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).toContain('Live');
      expect(out).not.toContain('Dead');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixStaleBarrelReExports — whole-declaration removal', () => {
  test('removes entire `export { X } from` when X is stale (all specifiers dead)', () => {
    const dir = scratch();
    try {
      write(dir, 'packages/a/src/source.ts', 'export {};\n');
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        [
          `export { Keep } from './other-source';`,
          `export { Dead } from './source';`,
          '',
        ].join('\n')
      );
      write(dir, 'packages/a/src/other-source.ts', 'export const Keep = 1;\n');
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([barrel]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).toContain('./other-source');
      expect(out).not.toContain("./source';");
      expect(out).not.toContain('Dead');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('removes `export { X } from` when target file has been deleted', () => {
    const dir = scratch();
    try {
      // target './gone' deliberately never created
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        `export { Zombie } from './gone';\n`
      );
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([barrel]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).not.toContain('Zombie');
      expect(out).not.toContain('./gone');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixStaleBarrelReExports — `export * from` handling', () => {
  test('leaves `export * from` alone when target is 0-byte (pass 1 handles emptiness)', () => {
    const dir = scratch();
    try {
      const empty = write(dir, 'packages/a/src/source.ts', '');
      // sanity: file is 0 bytes
      expect(readFileSync(empty, 'utf-8')).toBe('');
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        `export * from './source';\n`
      );
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([]);
      expect(readFileSync(barrel, 'utf-8')).toBe(`export * from './source';\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-relative specifiers (bare packages) are NOT touched', () => {
    const dir = scratch();
    try {
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        `export { SomeThing } from 'some-external-package';\n`
      );
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([]);
      expect(readFileSync(barrel, 'utf-8')).toContain(
        "from 'some-external-package'"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixStaleBarrelReExports — type-only re-exports', () => {
  test('preserves `export type` prefix when stripping', () => {
    const dir = scratch();
    try {
      write(dir, 'packages/a/src/source.ts', 'export type Live = number;\n');
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        `export type { Live, Dead } from './source';\n`
      );
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([barrel]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).toContain('export type');
      expect(out).toContain('Live');
      expect(out).not.toContain('Dead');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('getExportsOfFile — binding-pattern walker', () => {
  // Regression: a destructured binding export
  //   export const { system: ds, theme } = factory();
  // was silently treated as zero-export by the reconciler, causing barrels
  // re-exporting `ds` or `theme` to be erased as "all-stale" on 2026-04-26.

  test('object binding pattern: collects every renamed local binding', () => {
    const dir = scratch();
    try {
      const fixturePath = join(
        process.cwd(),
        'scripts/hygiene/__fixtures__/reconciler/destructured-binding-export.ts.in'
      );
      const sourceContent = readFileSync(fixturePath, 'utf-8');
      const f = write(dir, 'packages/a/src/source.ts', sourceContent);
      const exports = getExportsOfFile(f);
      expect(exports.has('ds')).toBe(true);
      expect(exports.has('theme')).toBe(true);
      // The factory const is private (no export modifier) — must NOT be added
      expect(exports.has('_factory')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('array binding pattern: skips holes and collects named slots', () => {
    const dir = scratch();
    try {
      const f = write(
        dir,
        'packages/a/src/source.ts',
        'export const [first, , third] = [1, 2, 3] as const;\n'
      );
      const exports = getExportsOfFile(f);
      expect(exports.has('first')).toBe(true);
      expect(exports.has('third')).toBe(true);
      expect(exports.size).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('barrel re-exporting from a destructured-binding source is preserved', () => {
    const dir = scratch();
    try {
      const fixturePath = join(
        process.cwd(),
        'scripts/hygiene/__fixtures__/reconciler/destructured-binding-export.ts.in'
      );
      const sourceContent = readFileSync(fixturePath, 'utf-8');
      write(dir, 'packages/a/src/system.ts', sourceContent);
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        `export { ds } from './system';\n`
      );
      const fixed = fixStaleBarrelReExports([barrel]);
      // No fix needed — `ds` is a real export of system.ts.
      expect(fixed).toEqual([]);
      expect(readFileSync(barrel, 'utf-8')).toContain(
        "export { ds } from './system';"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixStaleBarrelReExports — span-preserving partial removals', () => {
  // These fixtures lock in the trivia-preservation contract added in the
  // refine-code-hygiene-dx change. The prior synthesis path
  // (`el.getText().join(', ')`) silently dropped JSDoc, biome-ignore
  // directives, and per-element type modifiers from retained elements. The
  // span-preserving rewrite touches only the stale-element ranges in the
  // original source.

  test('JSDoc above a retained element is preserved', () => {
    const dir = scratch();
    try {
      const fixturePath = join(
        process.cwd(),
        'scripts/hygiene/__fixtures__/reconciler/jsdoc-above-retained.ts.in'
      );
      const barrelSource = readFileSync(fixturePath, 'utf-8');
      write(
        dir,
        'packages/a/src/target.ts',
        'export const a = 1;\nexport const c = 3;\n'
      );
      const barrel = write(dir, 'packages/a/src/index.ts', barrelSource);
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([barrel]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).toContain('/** doc-A */');
      expect(out).toContain('a');
      expect(out).toContain('c');
      expect(out).not.toContain(' b'); // ` b` would indicate stale element retained
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('per-element type modifier is preserved', () => {
    const dir = scratch();
    try {
      const fixturePath = join(
        process.cwd(),
        'scripts/hygiene/__fixtures__/reconciler/type-modifier-mixed.ts.in'
      );
      const barrelSource = readFileSync(fixturePath, 'utf-8');
      write(
        dir,
        'packages/a/src/target.ts',
        'export type Foo = number;\nexport const bar = 1;\n'
      );
      const barrel = write(dir, 'packages/a/src/index.ts', barrelSource);
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([barrel]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).toContain('type Foo');
      expect(out).toContain('bar');
      expect(out).not.toContain('baz');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('biome-ignore directive on a retained element is preserved', () => {
    const dir = scratch();
    try {
      const fixturePath = join(
        process.cwd(),
        'scripts/hygiene/__fixtures__/reconciler/biome-ignore-directive.ts.in'
      );
      const barrelSource = readFileSync(fixturePath, 'utf-8');
      write(dir, 'packages/a/src/target.ts', 'export const a = 1;\n');
      const barrel = write(dir, 'packages/a/src/index.ts', barrelSource);
      const fixed = fixStaleBarrelReExports([barrel]);
      expect(fixed).toEqual([barrel]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).toContain('biome-ignore');
      expect(out).toContain('a');
      expect(out).not.toMatch(/\bb\b/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixStaleBarrelReExports — CJS export = (Tier 3 corner case)', () => {
  // Aspirational: getExportsOfFile maps `export = X;` to the symbol "default",
  // which can mismatch consumer barrels that re-export under the original
  // import binding name. The reconciler MUST NOT strip a live re-export; it
  // is preferable to leave a true-positive stale re-export in place than to
  // strip a false-positive live one.
  test('does not strip live re-export of CJS-style import binding', () => {
    const dir = scratch();
    try {
      // CJS target: `export = X;` produces a default-style export only.
      write(
        dir,
        'packages/a/src/cjs-target.ts',
        ['const X = 42;', 'export = X;', ''].join('\n')
      );
      const barrel = write(
        dir,
        'packages/a/src/index.ts',
        ["import X from './cjs-target';", 'export { X };', ''].join('\n')
      );
      const fixed = fixStaleBarrelReExports([barrel]);
      // Reconciler is conservative when the re-export form has no module-
      // specifier (this barrel's `export { X }` is a local re-export). The
      // path filter (`isRelative`) means the reconciler only touches
      // re-exports with a relative module specifier — so this barrel is
      // skipped entirely, which is the correct behavior for a live re-export.
      expect(fixed).toEqual([]);
      const out = readFileSync(barrel, 'utf-8');
      expect(out).toContain("import X from './cjs-target'");
      expect(out).toContain('export { X };');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
