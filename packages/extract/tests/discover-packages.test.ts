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
});
