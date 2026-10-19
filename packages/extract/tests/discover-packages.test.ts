import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  excludeCollectedPackages,
  extractSystemFilePackages,
  firstOwners,
  importedKitDiagnostics,
  probeAbsolutePathSpecifier,
  staleDistIncludesDiagnostic,
  unresolvableIncludesDiagnostic,
} from '../pipeline/discover-packages';
import { webpackExtensionPolicy } from '../pipeline/host-extensions';
import { KIT_SYSTEM_NOT_INCLUDED } from '../pipeline/manifest-diagnostics';

import type { CollectedExternalPackages } from '../pipeline/discover-packages';
import type { ManifestDiagnostic } from '../pipeline/manifest-diagnostics';
import type { JsonValue } from '../pipeline/tsconfig-paths';

/** The native engine, whose own parse reads a system file's membership. */
const ENGINE = {
  systemMembership: (inputsJson: string): string =>
    createRequire(import.meta.url)('../index-v2.js').systemMembership(
      inputsJson
    ),
};

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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
        await extractSystemFilePackages(constructorForm, ENGINE)
      ).sort();
      const fromChain = (
        await extractSystemFilePackages(chainForm, ENGINE)
      ).sort();
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = (await extractSystemFilePackages(path, ENGINE)).sort();
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
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
      expect(await extractSystemFilePackages(path, ENGINE)).toEqual([
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
      const pkgs = await extractSystemFilePackages(path, ENGINE);
      for (const specifier of expected) {
        expect(pkgs).toContain(specifier);
      }
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  };

  // The lexer's spellings the engine read keeps, each a successful build
  // with no CSS where membership drops it.
  test('a system stored in an object property keeps its later links', async () => {
    await expectDiscovered(
      `
      import { createSystem } from '@animus-ui/system';
      import { system as kit } from 'plain-kit/definition';

      const holder = {};
      holder.base = createSystem();
      export const ds = holder.base.extend(kit).build().seal();
    `,
      ['plain-kit/definition']
    );
  });

  test('an includes nested in the argument, before its first closing brace', async () => {
    await expectDiscovered(
      `
      import { createSystem } from '@animus-ui/system';
      import { system as kit } from 'plain-kit/definition';

      export const ds = createSystem({ meta: { includes: [kit] } }).build().seal();
    `,
      ['plain-kit/definition']
    );
  });

  test("a namespace import's createSystem keeps its links", async () => {
    await expectDiscovered(
      `
      import * as animus from '@animus-ui/system';
      import { system as kit } from 'plain-kit/definition';

      export const ds = animus.createSystem().extend(kit).build().seal();
    `,
      ['plain-kit/definition']
    );
  });

  test('a long re-export chain to createSystem is followed to the end', async () => {
    const path = writeFixture(`
      import { createSystem } from './barrel1';
      import { system as kit } from 'plain-kit/definition';
      export const ds = createSystem().extend(kit).build().seal();
    `);
    const dir = dirname(path);
    for (let n = 1; n <= 40; n++) {
      writeFileSync(
        join(dir, `barrel${n}.ts`),
        n === 40
          ? `export { createSystem } from '@animus-ui/system';`
          : `export { createSystem } from './barrel${n + 1}';`
      );
    }
    const diagnostics: ManifestDiagnostic[] = [];
    try {
      expect(
        await extractSystemFilePackages(path, ENGINE, (d) =>
          diagnostics.push(d)
        )
      ).toEqual(['plain-kit/definition']);
      expect(diagnostics).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
      expect(await extractSystemFilePackages(path, ENGINE)).not.toContain(
        '@acme/tokens-only'
      );
    } finally {
      rmSync(path, { force: true });
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });
});

/** Contract: system membership is transitive and indirect. A kit another
 *  kit's system extends, a member re-exported through local modules, and a
 *  root held in an object literal are each members; a builder membership
 *  cannot follow is a finding, never a silent empty membership. */
describe('extractSystemFilePackages transitive membership', () => {
  /** An installed kit whose `definition` is `source`, under `nodeModules`. */
  const kit = (nodeModules: string, name: string, source: string): void => {
    const root = join(nodeModules, name);
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name,
        exports: { './definition': './dist/definition.js' },
      })
    );
    writeFileSync(join(root, 'dist', 'definition.js'), source);
  };
  /** Each package from the `node_modules` beside or above `importer`. */
  const resolvePackage = (specifier: string, importer: string) => {
    const [name] = specifier.split('/');
    for (
      let dir = dirname(importer);
      dir !== dirname(dir);
      dir = dirname(dir)
    ) {
      const file = join(dir, 'node_modules', name, 'dist', 'definition.js');
      if (existsSync(file)) return file;
    }
    return null;
  };
  const NESTED = `import { createSystem } from '@animus-ui/system';
export const ds = createSystem().build().seal();`;
  const KIT = `import { createSystem } from '@animus-ui/system';
import { ds as nested } from 'nested/definition';
export const ds = createSystem().extend(nested).build().seal();`;

  const read = async (
    system: string,
    files: Record<string, string> = {}
  ): Promise<{ members: string[]; codes: string[] }> => {
    const path = writeFixture(system);
    const dir = dirname(path);
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), source);
    }
    const codes: string[] = [];
    try {
      const members = await extractSystemFilePackages(
        path,
        ENGINE,
        (diagnostic) => codes.push(diagnostic.code ?? '')
      );
      return { members, codes };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("a kit another kit's system extends is a member", async () => {
    const path = writeFixture('');
    const dir = dirname(path);
    kit(join(dir, 'node_modules'), 'nested', NESTED);
    kit(join(dir, 'node_modules'), 'kit', KIT);
    writeFileSync(
      path,
      `import { createSystem } from '@animus-ui/system';
import { ds as kit } from 'kit/definition';
export const ds = createSystem().extend(kit).build().seal();`
    );
    try {
      expect(
        await extractSystemFilePackages(path, ENGINE, undefined, resolvePackage)
      ).toEqual(['kit/definition', 'nested/definition']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a kit's own import resolves from that kit", async () => {
    const path = writeFixture('');
    const dir = dirname(path);
    kit(join(dir, 'node_modules', 'kit', 'node_modules'), 'nested', NESTED);
    kit(join(dir, 'node_modules'), 'kit', KIT);
    writeFileSync(
      path,
      `import { createSystem } from '@animus-ui/system';
import { ds as kit } from 'kit/definition';
export const ds = createSystem().extend(kit).build().seal();`
    );
    const memberFiles = new Map<string, string>();
    try {
      expect(
        await extractSystemFilePackages(
          path,
          ENGINE,
          undefined,
          resolvePackage,
          undefined,
          memberFiles
        )
      ).toEqual(['kit/definition', 'nested/definition']);
      expect(memberFiles.get('nested/definition')).toBe(
        join(
          dir,
          'node_modules',
          'kit',
          'node_modules',
          'nested',
          'dist',
          'definition.js'
        )
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a member re-exported through local modules is the package they reach', async () => {
    const { members, codes } = await read(
      `import { createSystem } from '@animus-ui/system';
import { ds as kit } from './barrel';
export const ds = createSystem().extend(kit).build().seal();`,
      {
        'barrel.ts': `export * from './barrel2';`,
        'barrel2.ts': `export { system as ds } from 'plain-kit/definition';`,
      }
    );
    expect(members).toEqual(['plain-kit/definition']);
    expect(codes).toEqual([]);
  });

  test('a root held in an object literal keeps its links', async () => {
    const { members, codes } = await read(
      `import { createSystem } from '@animus-ui/system';
import { system as kit } from 'plain-kit/definition';
const roots = { ds: createSystem() };
export const ds = roots.ds.extend(kit).build().seal();`
    );
    expect(members).toEqual(['plain-kit/definition']);
    expect(codes).toEqual([]);
  });

  test('a builder membership cannot follow is a finding', async () => {
    const { members, codes } = await read(
      `import { createSystem } from '@animus-ui/system';
import { system as kit } from 'plain-kit/definition';
const wrap = (system) => system;
const base = wrap(createSystem());
export const ds = base.extend(kit).build().seal();`
    );
    expect(members).toEqual([]);
    expect(codes).toEqual(['animus.discovery.unfollowed-system-builder']);
  });

  /** The membership of `system` beside the installed `kit` and `nested`. */
  const readWithKits = async (
    kitSource: string,
    system: string,
    nestedSource = NESTED
  ): Promise<{ members: string[]; codes: string[] }> => {
    const path = writeFixture(system);
    const dir = dirname(path);
    kit(join(dir, 'node_modules'), 'nested', nestedSource);
    kit(join(dir, 'node_modules'), 'kit', kitSource);
    const codes: string[] = [];
    try {
      const members = await extractSystemFilePackages(
        path,
        ENGINE,
        (diagnostic) => codes.push(diagnostic.code ?? ''),
        resolvePackage
      );
      return { members, codes };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("a namespace import's member is a member, in the system and in a kit", async () => {
    expect(
      await readWithKits(
        `import { createSystem } from '@animus-ui/system';
import * as nested from 'nested/definition';
export const ds = createSystem().extend(nested.ds).build().seal();`,
        `import { createSystem } from '@animus-ui/system';
import * as kit from 'kit/definition';
export const ds = createSystem().extend(kit.ds).build().seal();`
      )
    ).toEqual({ members: ['kit/definition', 'nested/definition'], codes: [] });
  });

  test("a kit whose system is its default export has that system's members", async () => {
    expect(
      await readWithKits(
        `import { createSystem } from '@animus-ui/system';
import { ds as nested } from 'nested/definition';
export default createSystem().extend(nested).build().seal();`,
        `import { createSystem } from '@animus-ui/system';
import kit from 'kit/definition';
export const ds = createSystem().extend(kit).build().seal();`
      )
    ).toEqual({ members: ['kit/definition', 'nested/definition'], codes: [] });
  });

  test('a holder of a builder that membership cannot follow is a finding', async () => {
    for (const held of [
      `const holder = {};
holder.base = createSystem();
export const ds = holder['base'].extend(kit).build().seal();`,
      `const holder = { base: createSystem() };
const { base: renamed } = holder;
export const ds = renamed.extend(kit).build().seal();`,
      `const holder = { base: createSystem() };
const take = (from) => from.base;
export const ds = take(holder).extend(kit).build().seal();`,
      `const holder = { base: createSystem() };
const get = () => holder.base;
export const ds = get().extend(kit).build().seal();`,
      `const holder = { base: createSystem() };
const get = () => holder;
export const ds = get().base.extend(kit).build().seal();`,
    ]) {
      const { members, codes } =
        await read(`import { createSystem } from '@animus-ui/system';
import { system as kit } from 'plain-kit/definition';
${held}`);
      expect(members).toEqual([]);
      expect(new Set(codes)).toEqual(
        new Set(['animus.discovery.unfollowed-system-builder'])
      );
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
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(dir, name), contents, 'utf-8');
    }
    const diagnostics: ManifestDiagnostic[] = [];

    const discover = (file: string) =>
      extractSystemFilePackages(
        join(dir, file),
        ENGINE,
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

const SOURCES = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

// Contract: extraction opens the file the host resolver opens, as the
// system loader's `one_extension_policy_answers_system_and_analysis_alike`
// does for its lanes. Each row: a webpack-like host's resolve options, the
// files present, the specifier, the file it names (spec §2.2 A2).
test.each([
  // An exhausted alias ends resolution: no appended or index try.
  [
    { extensions: ['.js', '.ts'], extensionAlias: { '.js': ['.ts'] } },
    ['a.js.ts'],
    'a.js',
    null,
  ],
  [{ extensionAlias: { '.js': ['.ts'] } }, ['a.js/index.js'], 'a.js', null],
  // An alias key is the configured suffix, however many dots.
  [
    { extensions: ['.js', '.tsx'], extensionAlias: { '.view.js': ['.tsx'] } },
    ['x.tsx', 'x.view.js'],
    'x.view.js',
    'x.tsx',
  ],
  // A captured order is all the host tries: no analysis source past it.
  [{ extensions: ['.js'] }, ['only.ts'], 'only', null],
])('%j with %j: %s names %s', (options, present, specifier, named) => {
  const root = mkdtempSync(join(tmpdir(), 'discover-packages-'));
  for (const file of present) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'export {};\n');
  }
  const probed = probeAbsolutePathSpecifier(
    join(root, specifier),
    SOURCES,
    root,
    webpackExtensionPolicy('webpack', options, '5.105.4')
  );

  rmSync(root, { recursive: true, force: true });

  expect(probed.kind === 'found' ? relative(root, probed.path) : null).toBe(
    named
  );
});

describe('external-package outcome messages', () => {
  test('unresolvableIncludesDiagnostic names every unresolvable specifier, null when all resolve', () => {
    expect(
      unresolvableIncludesDiagnostic([
        { specifier: '@x/missing', outcome: 'unresolvable', fileCount: 0 },
        { specifier: '@x/ds', outcome: 'resolved', fileCount: 2 },
        { specifier: '@x/typo', outcome: 'unresolvable', fileCount: 0 },
      ])?.message
    ).toBe('unresolvable include specifier(s): @x/missing, @x/typo');
    expect(
      unresolvableIncludesDiagnostic([
        { specifier: '@x/ds', outcome: 'resolved', fileCount: 2 },
        { specifier: '@x/empty', outcome: 'empty', fileCount: 0 },
      ])
    ).toBeNull();
    // The resolver's reason, and the system file that includes the package.
    expect(
      unresolvableIncludesDiagnostic(
        [
          {
            specifier: '@x/blocked',
            outcome: 'unresolvable',
            fileCount: 0,
            reason: "exports no file for '.'",
          },
        ],
        'src/ds.ts'
      )
    ).toMatchObject({
      file: 'src/ds.ts',
      code: 'animus.discovery.unresolvable-include',
      severity: 'error',
      message:
        "unresolvable include specifier(s): @x/blocked (exports no file for '.')",
    });
  });
  test('staleDistIncludesDiagnostic names every stale package, null when none are stale', () => {
    expect(
      staleDistIncludesDiagnostic([
        { specifier: '@x/kit', outcome: 'stale-dist', fileCount: 3 },
        { specifier: '@x/ds', outcome: 'resolved', fileCount: 2 },
        { specifier: '@x/base', outcome: 'stale-dist', fileCount: 1 },
      ])?.message
    ).toBe(
      'stale dist for include specifier(s): @x/kit, @x/base — dist entry is older than the newest src/ file; rebuild the package(s) before extracting'
    );
    expect(
      staleDistIncludesDiagnostic([
        { specifier: '@x/ds', outcome: 'resolved', fileCount: 2 },
        { specifier: '@x/empty', outcome: 'empty', fileCount: 0 },
      ])
    ).toBeNull();
  });
});

/** The collector's output for kits under `/r/packages` with no source
 *  condition, as it records them: each specifier, its package, its files. */
function collectedKits(
  specifiers: Array<[specifier: string, pkg: 'a' | 'b', files: string[]]>
): CollectedExternalPackages {
  const collected: CollectedExternalPackages = {
    entries: [],
    packageMap: {},
    sourceEntries: new Map(),
    sourceEntrySideEffects: new Map(),
    packageDirs: [],
    linkedDirs: [],
    outputDirs: [],
    dirOwnerSets: {},
    dirExtensions: {},
    fileOwners: {},
    outcomes: [],
    diagnostics: [],
    kitDescriptors: [],
    packageInstances: {},
  };
  for (const [specifier, pkg, files] of specifiers) {
    const dir = `/r/packages/${pkg}/src`;
    const owner = `@x/${pkg}`;
    for (const file of files) {
      const path = `packages/${pkg}/src/${file}`;
      collected.entries.push({ path, source: '' });
      collected.fileOwners[path] = specifier;
    }
    collected.packageMap[specifier] = `packages/${pkg}/src/${files[0]}`;
    collected.sourceEntries.set(specifier, `${dir}/${files[0]}`);
    if (specifier !== owner) {
      collected.packageMap[owner] = `packages/${pkg}/src/index.ts`;
      collected.sourceEntries.set(owner, `${dir}/index.ts`);
    }
    collected.packageDirs.push(dir);
    collected.linkedDirs.push(dir);
    collected.dirOwnerSets[dir] = [specifier];
    collected.dirExtensions[dir] = ['.ts', '.tsx', '.mdx'];
    collected.outcomes.push({
      specifier,
      outcome: 'resolved',
      fileCount: files.length,
    });
  }
  return collected;
}

describe('excludeCollectedPackages', () => {
  test('excises a rejected specifier atomically', () => {
    const collected = collectedKits([
      ['@x/a', 'a', ['index.ts']],
      ['@x/b', 'b', ['index.ts', 'Card.tsx']],
    ]);
    const admitted = excludeCollectedPackages(
      collected,
      new Set(['@x/b']),
      '/r'
    );

    expect(admitted.entries.map((e) => e.path)).toEqual([
      'packages/a/src/index.ts',
    ]);
    expect(admitted.packageMap).toEqual({ '@x/a': 'packages/a/src/index.ts' });
    expect([...admitted.sourceEntries.keys()]).toEqual(['@x/a']);
    expect(admitted.packageDirs).toEqual(['/r/packages/a/src']);
    expect(firstOwners(admitted.dirOwnerSets)).toEqual({
      '/r/packages/a/src': '@x/a',
    });
    expect(admitted.dirOwnerSets).toEqual({ '/r/packages/a/src': ['@x/a'] });
    expect(admitted.fileOwners).toEqual({ 'packages/a/src/index.ts': '@x/a' });
    // Outcome records are reporting inputs, not membership — untouched.
    expect(admitted.outcomes).toEqual(collected.outcomes);
  });

  test('a derived root alias under a rejected dir is excised too', () => {
    // Nothing may keep resolving into an excluded package.
    const collected = collectedKits([
      ['@x/b/Card', 'b', ['Card.tsx', 'index.ts']],
    ]);
    expect(collected.packageMap['@x/b']).toBeDefined();
    const admitted = excludeCollectedPackages(
      collected,
      new Set(['@x/b/Card']),
      '/r'
    );

    expect(admitted.packageMap).toEqual({});
    expect(admitted.sourceEntries.size).toBe(0);
  });
});

// Contract: an imported kit the application's system does not include is an
// error; a kit the system includes, a package with no source condition, and
// a non-kit import are not.
test('an imported kit the system does not include is an error', () => {
  const root = mkdtempSync(join(tmpdir(), 'discover-packages-'));
  const pkg = (name: string, exports?: JsonValue): void => {
    const dir = join(root, 'node_modules', ...name.split('/'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const t = 1;\n');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, exports }));
  };
  const source = { '.': { animus: './src/index.ts' } };
  pkg('@acme/included', source);
  pkg('@acme/legacy');
  pkg('@acme/stray', source);
  const imports = ['@acme/included', '@acme/legacy', '@acme/stray', 'react'];
  const engine = {
    // The stand-in table: a kit declares `animus` in its `exports`.
    declaresKitSource: (dir: string) =>
      readFileSync(join(dir, 'package.json'), 'utf-8').includes('"animus"'),
    // The stand-in locator: the fixture installs every kit at the root.
    locatePackage: (name: string) => {
      const dir = join(root, 'node_modules', ...name.split('/'));
      return existsSync(dir) ? dir : null;
    },
    extractFacts: () =>
      JSON.stringify({
        parseCount: 1,
        files: {
          'src/App.tsx': {
            parsePanicked: false,
            imports: imports.map((specifier) => ({
              local: 'x',
              imported: 'x',
              source: specifier,
            })),
            exports: [],
          },
        },
      }),
  };

  const found = importedKitDiagnostics(
    [{ path: 'src/App.tsx', source: '', hash: '' }],
    engine,
    root,
    ['@acme/included', '@acme/legacy'],
    () => JSON.parse(engine.extractFacts())
  );
  rmSync(root, { recursive: true, force: true });

  expect(found.map((d) => [d.file, d.component, d.code, d.severity])).toEqual([
    ['src/App.tsx', '@acme/stray', KIT_SYSTEM_NOT_INCLUDED, 'error'],
  ]);
});
