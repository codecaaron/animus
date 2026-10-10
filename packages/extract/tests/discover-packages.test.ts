import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { extractSystemFilePackages } from '../pipeline/discover-packages';

import type { ModuleRecord } from '../pipeline/discover-packages';
import type { ManifestDiagnostic } from '../pipeline/manifest-diagnostics';

const writeFixture = (contents: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-packages-'));
  const path = join(dir, 'ds.ts');
  writeFileSync(path, contents, 'utf-8');
  return path;
};

describe('extractSystemFilePackages', () => {
  test('discovers package from constructor-arg includes with single identifier', async () => {
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
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@animus-ui/test-ds');
      expect(pkgs).not.toContain('@animus-ui/system');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers multiple packages from constructor-arg includes', async () => {
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
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@ds-a/core');
      expect(pkgs).toContain('@ds-b/core');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers package from legacy chain-method includes (migration fallback)', async () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as testDs } from '@animus-ui/test-ds';

      export const { system: ds } = createSystem()
        .addGroup('space', {})
        .includes([testDs])
        .build();
    `);

    try {
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@animus-ui/test-ds');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('constructor-arg and chain-method forms produce equivalent discovery', async () => {
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
      const fromConstructor = (
        await extractSystemFilePackages(constructorForm)
      ).sort();
      const fromChain = (await extractSystemFilePackages(chainForm)).sort();
      expect(fromConstructor).toEqual(fromChain);
      expect(fromConstructor).toContain('@animus-ui/test-ds');
    } finally {
      rmSync(constructorForm, { force: true });
      rmSync(join(constructorForm, '..'), { recursive: true, force: true });
      rmSync(chainForm, { force: true });
      rmSync(join(chainForm, '..'), { recursive: true, force: true });
    }
  });

  test('returns empty when no includes declared', async () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      export const { system: ds } = createSystem()
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toEqual([]);
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('resolves relative-path imports in includes against the system file', async () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { local } from '../sibling/src/index';

      export const { system } = createSystem({ includes: [local] })
        .addGroup('x', {})
        .build();
    `);

    try {
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toEqual([resolve(join(path, '..'), '../sibling/src/index')]);
      expect(pkgs[0].startsWith('.')).toBe(false);
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('bare specifiers are unchanged alongside a relative one', async () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as bare } from '@animus-ui/test-ds';
      import { local } from './local-system';

      export const { system } = createSystem({ includes: [bare, local] })
        .addGroup('x', {})
        .build();
    `);

    try {
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@animus-ui/test-ds');
      expect(pkgs).toContain(join(path, '..', 'local-system'));
      expect(pkgs).toHaveLength(2);
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('supports renamed imports (import { ds as alias })', async () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as myDs } from '@scope/my-ds';

      export const { system } = createSystem({ includes: [myDs] })
        .addGroup('x', {})
        .build();
    `);

    try {
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@scope/my-ds');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers package from a from() chain call', async () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { ds as kitDs } from '@acme/ui-kit';

      export const { system: ds } = createSystem()
        .from(kitDs)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).not.toContain('@animus-ui/system');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers every source of repeated from() calls', async () => {
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
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@ds-a/core');
      expect(pkgs).toContain('@ds-b/core');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('traces a library-bundle identifier (and its member form) to its import', async () => {
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
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).toContain('@acme/other-kit');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('createTheme().from() never contributes discovery membership', async () => {
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
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).not.toContain('@acme/tokens-only');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers package from an extend() chain call', async () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/kit';

      export const { system: ds } = createSystem()
        .extend(kit)
        .addGroup('space', {})
        .build();
    `);

    try {
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/kit');
      expect(pkgs).not.toContain('@animus-ui/system');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('discovers every source of a mixed extend()/from() chain', async () => {
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
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@ds-a/core');
      expect(pkgs).toContain('@ds-b/core');
      expect(pkgs).toContain('@ds-c/core');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('createTheme().extend() never contributes discovery membership', async () => {
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
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).not.toContain('@acme/tokens-only');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('extend() and every legacy form feed one deduplicated set', async () => {
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
      const pkgs = (await extractSystemFilePackages(path)).sort();
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

  test('extend() sources survive a reformatted chain', async () => {
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
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('extend() traces a library-bundle identifier (and its member form) to its import', async () => {
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
      const pkgs = await extractSystemFilePackages(path);
      expect(pkgs).toContain('@acme/ui-kit');
      expect(pkgs).toContain('@acme/other-kit');
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  test('preserves a package export subpath for host resolution', async () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { system } from '@acme/ui-kit/definition';

      export const { system: ds } = createSystem().extend(system).build();
    `);

    try {
      expect(await extractSystemFilePackages(path)).toEqual([
        '@acme/ui-kit/definition',
      ]);
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });
});

/** A scanner that stops at ordinary trivia drops kits silently: outcomes
 *  derive only from the returned specifiers, so a missing kit is invisible. */
describe('extractSystemFilePackages chain-scan tolerance', () => {
  const expectDiscovered = async (
    contents: string,
    expected: string[]
  ): Promise<void> => {
    const path = writeFixture(contents);
    try {
      const pkgs = await extractSystemFilePackages(path);
      for (const specifier of expected) {
        expect(pkgs).toContain(specifier);
      }
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  };

  test('a line comment between the call and the first link', async () => {
    await expectDiscovered(
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

  test('a block comment between the call and the first link', async () => {
    await expectDiscovered(
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

  test('a comment between two links keeps the later kit', async () => {
    await expectDiscovered(
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

  test('a multiline argument with a trailing comma', async () => {
    await expectDiscovered(
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

  test('a builder chain split across statements', async () => {
    await expectDiscovered(
      `
      import { createSystem } from '@animus-ui/system';
      import { kit } from '@acme/ui-kit';

      const base = createSystem({});
      export const { system: ds } = base.extend(kit).build();
    `,
      ['@acme/ui-kit']
    );
  });

  test('transitively bound builder chains contribute every kit', async () => {
    await expectDiscovered(
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

  test('a split statement never adopts a createTheme() chain', async () => {
    await expectDiscovered(
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
      expect(await extractSystemFilePackages(path)).not.toContain(
        '@acme/tokens-only'
      );
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });
});

describe('extractSystemFilePackages root bindings', () => {
  test('reads a binding as a root by its followed identity, keeping spelling when it cannot be followed, and reports an unimported call instead', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'discover-roots-'));
    const files = {
      'animus.ts': `export { createSystem as makeSystem } from '@animus-ui/system';`,
      'factory.ts': `export function createSystem() { return { extend: (k) => k }; }`,
      'ds.ts': [
        `import { makeSystem } from './animus';`,
        `import { createSystem } from './factory';`,
        `import { createSystem as cs } from '@acme/unresolved';`,
        `import { ds as kitA } from '@acme/a';`,
        `import { ds as kitB } from '@acme/b';`,
        `import { ds as kitC } from '@acme/c';`,
        `export const a = makeSystem().extend(kitA).build();`,
        `export const b = createSystem().extend(kitB);`,
        `export const c = cs().extend(kitC).build();`,
      ].join('\n'),
      // No import and no local binding: undefined where the loader runs.
      'bare.ts': [
        `import { ds as kitD } from '@acme/d';`,
        `export const d = createSystem().extend(kitD).build();`,
      ].join('\n'),
    };
    const animus: ModuleRecord = {
      imports: [],
      exports: [
        {
          exported: 'makeSystem',
          local: null,
          source: '@animus-ui/system',
          original: 'createSystem',
        },
      ],
    };
    const system: ModuleRecord = {
      imports: [
        { local: 'makeSystem', imported: 'makeSystem', source: './animus' },
        {
          local: 'createSystem',
          imported: 'createSystem',
          source: './factory',
        },
        { local: 'cs', imported: 'createSystem', source: '@acme/unresolved' },
        { local: 'kitA', imported: 'ds', source: '@acme/a' },
        { local: 'kitB', imported: 'ds', source: '@acme/b' },
        { local: 'kitC', imported: 'ds', source: '@acme/c' },
      ],
      exports: [],
    };
    const records = new Map([
      ['animus.ts', animus],
      ['factory.ts', { imports: [], exports: [] }],
      ['ds.ts', system],
      [
        'bare.ts',
        {
          imports: [{ local: 'kitD', imported: 'ds', source: '@acme/d' }],
          exports: [],
        },
      ],
    ]);
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(dir, name), contents, 'utf-8');
    }
    const diagnostics: ManifestDiagnostic[] = [];

    const discover = (file: string) =>
      extractSystemFilePackages(
        join(dir, file),
        (_source, path) => records.get(basename(path)) ?? null,
        (diagnostic) => diagnostics.push(diagnostic),
        () => null
      );

    try {
      const pkgs = await discover('ds.ts');
      // The lookalike is shown to be another function; the unresolved
      // package cannot be followed, so its import keeps spelling's root.
      expect(pkgs).toEqual(['@acme/a', '@acme/c']);
      expect(diagnostics).toMatchObject([
        {
          component: 'createSystem',
          code: 'animus.discovery.unproven-root-binding',
          severity: 'warn',
          line: 2,
          column: 10,
        },
        {
          component: 'cs',
          code: 'animus.discovery.unproven-root-binding',
          severity: 'warn',
          line: 3,
          column: 26,
        },
      ]);

      // A bare call is no root, and it is reported once at the call.
      diagnostics.length = 0;
      expect(await discover('bare.ts')).toEqual([]);
      expect(diagnostics).toMatchObject([
        {
          component: 'createSystem',
          code: 'animus.discovery.unimported-create-system',
          severity: 'warn',
          line: 2,
          column: 18,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
