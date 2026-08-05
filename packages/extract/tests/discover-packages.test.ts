import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { extractSystemFilePackages } from '../pipeline/discover-packages';

const writeFixture = (contents: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-packages-'));
  const path = join(dir, 'ds.ts');
  writeFileSync(path, contents, 'utf-8');
  return path;
};

describe('extractSystemFilePackages', () => {
  test('discovers package from constructor-arg includes with single identifier', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as testDs } from '@animus-ui/test-ds';

      export const { system: ds } = createSystem({
        includes: [testDs],
      })
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@animus-ui/test-ds');
      expect(pkgs).not.toContain('@animus-ui/system');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers multiple packages from constructor-arg includes', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as a } from '@ds-a/core';
      import { ds as b } from '@ds-b/core';

      export const { system: ds } = createSystem({
        includes: [a, b],
      })
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@ds-a/core');
      expect(pkgs).toContain('@ds-b/core');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers package from legacy chain-method includes (migration fallback)', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as testDs } from '@animus-ui/test-ds';

      export const { system: ds } = createSystem()
        .addGroup('space', {})
        .includes([testDs])
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@animus-ui/test-ds');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('constructor-arg and chain-method forms produce equivalent discovery', () => {
    const constructorForm = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as testDs } from '@animus-ui/test-ds';
      export const { system } = createSystem({ includes: [testDs] })
        .addGroup('x', {})
        .build();
    `);

    const chainForm = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as testDs } from '@animus-ui/test-ds';
      export const { system } = createSystem()
        .addGroup('x', {})
        .includes([testDs])
        .build();
    `);

    try {
      const fromConstructor = extractSystemFilePackages(constructorForm).sort();
      const fromChain = extractSystemFilePackages(chainForm).sort();
      expect(fromConstructor).toEqual(fromChain);
      expect(fromConstructor).toContain('@animus-ui/test-ds');
    } finally {
      rmSync(constructorForm, { force: true });
      rmSync(join(constructorForm, '..'), { recursive: true, force: true });
      rmSync(chainForm, { force: true });
      rmSync(join(chainForm, '..'), { recursive: true, force: true });
    }
  });

  test('returns empty when no includes declared', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      export const { system: ds } = createSystem()
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toEqual([]);
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('resolves relative-path imports in includes against the system file', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { local } from '../sibling/src/index';

      export const { system } = createSystem({ includes: [local] })
        .addGroup('x', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toEqual([resolve(join(path, '..'), '../sibling/src/index')]);
      expect(pkgs[0].startsWith('.')).toBe(false);
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('bare specifiers are unchanged alongside a relative one', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as bare } from '@animus-ui/test-ds';
      import { local } from './local-system';

      export const { system } = createSystem({ includes: [bare, local] })
        .addGroup('x', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@animus-ui/test-ds');
      expect(pkgs).toContain(join(path, '..', 'local-system'));
      expect(pkgs).toHaveLength(2);
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('supports renamed imports (import { ds as alias })', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as myDs } from '@scope/my-ds';

      export const { system } = createSystem({ includes: [myDs] })
        .addGroup('x', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@scope/my-ds');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers package from a from() chain call', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as kitDs } from '@acme/ui-kit';

      export const { system: ds } = createSystem()
        .from(kitDs)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).not.toContain('@animus-ui/system');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers every source of repeated from() calls', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as a } from '@ds-a/core';
      import { ds as b } from '@ds-b/core';

      export const { system: ds } = createSystem()
        .from(a)
        .from(b)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@ds-a/core');
      expect(pkgs).toContain('@ds-b/core');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('traces a library-bundle identifier (and its member form) to its import', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/ui-kit';
      import { other } from '@acme/other-kit';

      export const { system: ds } = createSystem()
        .from(kit)
        .from(other.system)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).toContain('@acme/other-kit');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('from() and legacy includes forms contribute to one discovered set', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as legacyDs } from '@animus-ui/test-ds';
      import { ds as kitDs } from '@acme/ui-kit';

      export const { system: ds } = createSystem({ includes: [legacyDs] })
        .from(kitDs)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@animus-ui/test-ds');
      expect(pkgs).toContain('@acme/ui-kit');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('createTheme().from() never contributes discovery membership', () => {
    const path = writeFixture(`
      import { createSystem, createTheme } from '@animus-ui/system';
      import { tokens as kitTokens } from '@acme/tokens-only';
      import { ds as kitDs } from '@acme/ui-kit';

      export const tokens = createTheme()
        .from(kitTokens)
        .addColors({ brand: { 500: '#3b82f6' } })
        .build();

      export const { system: ds } = createSystem()
        .from(kitDs)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).not.toContain('@acme/tokens-only');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('from() sources survive a reformatted chain', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as kitDs } from '@acme/ui-kit';

      export const { system: ds } = createSystem()
        .from(
          kitDs
        )
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers package from an extend() chain call', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/kit';

      export const { system: ds } = createSystem()
        .extend(kit)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/kit');
      expect(pkgs).not.toContain('@animus-ui/system');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers every source of repeated extend() calls', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as a } from '@ds-a/core';
      import { ds as b } from '@ds-b/core';

      export const { system: ds } = createSystem()
        .extend(a)
        .extend(b)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@ds-a/core');
      expect(pkgs).toContain('@ds-b/core');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers every source of a mixed extend()/from() chain', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as a } from '@ds-a/core';
      import { ds as b } from '@ds-b/core';
      import { ds as c } from '@ds-c/core';

      export const { system: ds } = createSystem()
        .extend(a)
        .from(b)
        .extend(c)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@ds-a/core');
      expect(pkgs).toContain('@ds-b/core');
      expect(pkgs).toContain('@ds-c/core');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('createTheme().extend() never contributes discovery membership', () => {
    const path = writeFixture(`
      import { createSystem, createTheme } from '@animus-ui/system';
      import { tokens as kitTokens } from '@acme/tokens-only';
      import { ds as kitDs } from '@acme/ui-kit';

      export const theme = createTheme()
        .extend(kitTokens)
        .addColors({ brand: { 500: '#3b82f6' } })
        .build();

      export const { system: ds } = createSystem()
        .extend(kitDs)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).not.toContain('@acme/tokens-only');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('extend() and every legacy form feed one deduplicated set', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as legacyDs } from '@animus-ui/test-ds';
      import { kit } from '@acme/ui-kit';
      import { base } from '@acme/base';

      export const { system: ds } = createSystem({ includes: [legacyDs, kit] })
        .extend(kit)
        .from(base)
        .addGroup('space', {})
        .build();
    `);

    try {
      // Every named package appears exactly once — the package declared
      // through both the includes: constructor and the extend() chain dedupes.
      const pkgs = extractSystemFilePackages(path).sort();
      expect(pkgs).toEqual([
        '@acme/base',
        '@acme/ui-kit',
        '@animus-ui/test-ds',
      ]);
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('extend() sources survive a reformatted chain', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as kitDs } from '@acme/ui-kit';

      export const { system: ds } = createSystem()
        .extend(
          kitDs
        )
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('extend() traces a library-bundle identifier (and its member form) to its import', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/ui-kit';
      import { other } from '@acme/other-kit';

      export const { system: ds } = createSystem()
        .extend(kit)
        .extend(other.system)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).toContain('@acme/other-kit');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('preserves a package export subpath for host resolution', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { system } from '@acme/ui-kit/definition';

      export const { system: ds } = createSystem().extend(system).build();
    `);

    try {
      expect(extractSystemFilePackages(path)).toEqual([
        '@acme/ui-kit/definition',
      ]);
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });
});

/**
 * Trivia tolerance for the extension-chain scan: comments, multiline
 * argument formatting, and builder chains split across statements are
 * ordinary authoring shapes — a scanner that stops at them drops kits with
 * no diagnostic (outcomes derive only from the returned specifiers, so a
 * missing kit is invisible to the strict gates).
 */
describe('extractSystemFilePackages chain-scan tolerance', () => {
  const expectDiscovered = (contents: string, expected: string[]): void => {
    const path = writeFixture(contents);
    try {
      const pkgs = extractSystemFilePackages(path);
      for (const specifier of expected) {
        expect(pkgs).toContain(specifier);
      }
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  };

  test('a line comment between the call and the first link', () => {
    expectDiscovered(
      `
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/ui-kit';

      export const { system: ds } = createSystem({}) // base system
        .extend(kit)
        .build();
    `,
      ['@acme/ui-kit']
    );
  });

  test('a block comment between the call and the first link', () => {
    expectDiscovered(
      `
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/ui-kit';

      export const { system: ds } = createSystem({}) /* base */
        .extend(kit)
        .build();
    `,
      ['@acme/ui-kit']
    );
  });

  test('a comment between two links keeps the later kit', () => {
    expectDiscovered(
      `
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/ui-kit';
      import { other } from '@acme/other-kit';

      export const { system: ds } = createSystem()
        .extend(kit) // primary kit
        .extend(other)
        .build();
    `,
      ['@acme/ui-kit', '@acme/other-kit']
    );
  });

  test('a multiline argument with a trailing comma', () => {
    expectDiscovered(
      `
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/ui-kit';

      export const { system: ds } = createSystem()
        .extend(
          kit,
        )
        .build();
    `,
      ['@acme/ui-kit']
    );
  });

  test('a builder chain split across statements', () => {
    expectDiscovered(
      `
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/ui-kit';

      const base = createSystem({});
      export const { system: ds } = base.extend(kit).build();
    `,
      ['@acme/ui-kit']
    );
  });

  test('transitively bound builder chains contribute every kit', () => {
    expectDiscovered(
      `
      import { createSystem } from '@animus-ui/system';
      import { a } from '@ds-a/core';
      import { b } from '@ds-b/core';

      const base = createSystem();
      const withA = base.extend(a);
      export const { system: ds } = withA.extend(b).build();
    `,
      ['@ds-a/core', '@ds-b/core']
    );
  });

  test('a split statement never adopts a createTheme() chain', () => {
    expectDiscovered(
      `
      import { createSystem, createTheme } from '@animus-ui/system';
      import { tokens } from '@acme/tokens-only';
      import { kit } from '@acme/ui-kit';

      const themeBase = createTheme();
      export const theme = themeBase.extend(tokens).build();

      const base = createSystem({});
      export const { system: ds } = base.extend(kit).build();
    `,
      ['@acme/ui-kit']
    );
    const path = writeFixture(`
      import { createSystem, createTheme } from '@animus-ui/system';
      import { tokens } from '@acme/tokens-only';
      import { kit } from '@acme/ui-kit';

      const themeBase = createTheme();
      export const theme = themeBase.extend(tokens).build();

      const base = createSystem({});
      export const { system: ds } = base.extend(kit).build();
    `);
    try {
      expect(extractSystemFilePackages(path)).not.toContain(
        '@acme/tokens-only'
      );
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });
});
