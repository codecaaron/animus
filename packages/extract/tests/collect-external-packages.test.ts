import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { collectExternalPackageSources } from '../pipeline/discover-packages';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-collect-pkgs-'));
  tempRoots.push(root);
  return root;
}

/** Create a package dir with package.json and the given files. */
function makePackage(base: string, files: Record<string, string>): string {
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'package.json'), '{"name":"pkg"}');
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(base, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return base;
}

const EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.mdx']);

const identity = async (
  source: string,
  relPath: string
): Promise<{ source: string; relPath: string }> => ({ source, relPath });

function collect(
  rootDir: string,
  specifierEntries: Record<string, string | null>,
  overrides: Partial<Parameters<typeof collectExternalPackageSources>[0]> = {}
) {
  return collectExternalPackageSources({
    specifiers: Object.keys(specifierEntries),
    resolveSpecifier: (spec) => specifierEntries[spec],
    rootDir,
    extensionsSet: EXTENSIONS,
    hasEntry: () => false,
    preprocessFile: identity,
    onUnreadable: () => {},
    ...overrides,
  });
}

describe('collectExternalPackageSources', () => {
  test('discovers src/ files, redirects to src/index.ts, and applies package-scoped excludes', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export * from "./Button";',
      'src/Button.tsx': 'export const Button = 1;',
      'src/Button.test.tsx': 'test file',
      'src/nested/node_modules/dep.ts': 'nested dep',
    });

    const result = await collect(root, {
      '@x/ds': join(pkg, 'dist', 'index.mjs'),
    });

    expect(result.entries.map((e) => e.path).sort()).toEqual([
      'packages/ds/src/Button.tsx',
      'packages/ds/src/index.ts',
    ]);
    expect(result.packageMap).toEqual({
      '@x/ds': 'packages/ds/src/index.ts',
    });
    expect(result.sourceEntries.get('@x/ds')).toBe(
      join(pkg, 'src', 'index.ts')
    );
    expect(result.packageDirs).toEqual([join(pkg, 'src')]);
  });

  test('an npm-installed package under node_modules still has its sources discovered', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'node_modules', '@x', 'ds'), {
      'src/index.ts': 'export const ds = 1;',
    });

    const result = await collect(root, {
      '@x/ds': join(pkg, 'dist', 'index.mjs'),
    });

    expect(result.entries.map((e) => e.path)).toEqual([
      relative(root, join(pkg, 'src', 'index.ts')),
    ]);
    expect(result.sourceEntries.size).toBe(1);
  });

  test('no src/ — ingests the resolved entry file itself, exempt from extension filters', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'node_modules', 'flat-pkg'), {
      'index.mjs': 'export const flat = 1;',
    });
    const entry = join(pkg, 'index.mjs');

    const result = await collect(root, { 'flat-pkg': entry });

    expect(result.entries).toEqual([
      { path: relative(root, entry), source: 'export const flat = 1;' },
    ]);
    expect(result.packageMap).toEqual({
      'flat-pkg': relative(root, entry),
    });
    expect(result.sourceEntries.size).toBe(0);
    expect(result.packageDirs).toEqual([pkg]);
  });

  test('src/ without index.ts falls back to the resolved entry in packageMap', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/Button.tsx': 'export const Button = 1;',
      'main.ts': 'export {};',
    });

    const result = await collect(root, { '@x/ds': join(pkg, 'main.ts') });

    expect(result.packageMap).toEqual({ '@x/ds': 'packages/ds/main.ts' });
    expect(result.sourceEntries.size).toBe(0);
  });

  test('unresolvable specifiers (null or throw) are silently skipped', async () => {
    const root = makeRoot();
    const result = await collectExternalPackageSources({
      specifiers: ['nope', 'boom'],
      resolveSpecifier: (spec) => {
        if (spec === 'boom') throw new Error('resolver exploded');
        return null;
      },
      rootDir: root,
      extensionsSet: EXTENSIONS,
      hasEntry: () => false,
      preprocessFile: identity,
      onUnreadable: () => {},
    });

    expect(result.entries).toEqual([]);
    expect(result.packageMap).toEqual({});
    expect(result.packageDirs).toEqual([]);
  });

  test('hasEntry dedups against the caller file set', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export const a = 1;',
      'src/Button.tsx': 'export const Button = 1;',
    });

    const result = await collect(
      root,
      { '@x/ds': join(pkg, 'dist', 'index.mjs') },
      { hasEntry: (relPath) => relPath === 'packages/ds/src/Button.tsx' }
    );

    expect(result.entries.map((e) => e.path)).toEqual([
      'packages/ds/src/index.ts',
    ]);
  });

  test('preprocessFile can rewrite paths (MDX) or skip files entirely', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export {};',
      'src/Doc.mdx': '# doc',
    });

    const result = await collect(
      root,
      { '@x/ds': join(pkg, 'dist', 'index.mjs') },
      {
        preprocessFile: async (source, relPath, absPath) => {
          if (absPath.endsWith('.mdx')) {
            return { source: 'compiled', relPath: relPath + '.tsx' };
          }
          if (relPath.endsWith('index.ts')) return null;
          return { source, relPath };
        },
      }
    );

    expect(result.entries).toEqual([
      { path: 'packages/ds/src/Doc.mdx.tsx', source: 'compiled' },
    ]);
  });
});
