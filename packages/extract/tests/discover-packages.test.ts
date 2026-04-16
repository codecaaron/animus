import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  test('ignores relative-path imports in includes', () => {
    const path = writeFixture(`
      import { createSystem } from '@animus-ui/system';
      import { local } from './local-system';

      export const { system } = createSystem({ includes: [local] })
        .addGroup('x', {})
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
});
