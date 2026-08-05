import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  collectExternalPackageSources,
  staleDistIncludesMessage,
  unresolvableIncludesMessage,
} from '../pipeline/discover-packages';

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

  test('redirects a package export subpath to its matching source module', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export const root = 1;',
      'src/definition.ts': 'export const system = 1;',
      'dist/definition.mjs': 'export const system = 1;',
    });

    const result = await collect(root, {
      '@x/ds/definition': join(pkg, 'dist', 'definition.mjs'),
    });

    expect(result.packageMap).toEqual({
      '@x/ds/definition': 'packages/ds/src/definition.ts',
      // Derived root alias — see the dedicated subpath/root-alias tests.
      '@x/ds': 'packages/ds/src/index.ts',
    });
    expect(result.sourceEntries.get('@x/ds/definition')).toBe(
      join(pkg, 'src', 'definition.ts')
    );
  });

  test('a subpath specifier also registers its package root for app-side imports', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export const root = 1;',
      'src/definition.ts': 'export const system = 1;',
      'dist/definition.mjs': 'export const system = 1;',
    });

    const result = await collect(root, {
      '@x/ds/definition': join(pkg, 'dist', 'definition.mjs'),
    });

    // ds.ts declares the kit at a subpath, but app code imports the package
    // root — without the root key, root imports bypass the src redirect and
    // ship untransformed dist chains.
    expect(result.packageMap).toEqual({
      '@x/ds/definition': 'packages/ds/src/definition.ts',
      '@x/ds': 'packages/ds/src/index.ts',
    });
    expect(result.sourceEntries.get('@x/ds')).toBe(
      join(pkg, 'src', 'index.ts')
    );
    // The alias is derived, not declared: exactly one outcome record.
    expect(result.outcomes).toEqual([
      { specifier: '@x/ds/definition', outcome: 'resolved', fileCount: 2 },
    ]);
  });

  test('an unscoped subpath specifier registers its package root too', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'kit'), {
      'src/index.ts': 'export const root = 1;',
      'src/definition.ts': 'export const system = 1;',
    });

    const result = await collect(root, {
      'kit/definition': join(pkg, 'src', 'definition.ts'),
    });

    expect(result.packageMap['kit']).toBe('packages/kit/src/index.ts');
    expect(result.sourceEntries.get('kit')).toBe(join(pkg, 'src', 'index.ts'));
  });

  test('a package without a root source entry registers no root alias', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      // Subpath-only src layout: nothing for the root to redirect to.
      'src/definition.ts': 'export const system = 1;',
    });

    const result = await collect(root, {
      '@x/ds/definition': join(pkg, 'src', 'definition.ts'),
    });

    expect(result.packageMap).toEqual({
      '@x/ds/definition': 'packages/ds/src/definition.ts',
    });
    expect(result.sourceEntries.has('@x/ds')).toBe(false);
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

  test('no src/ — walks compiled component modules beside the definition entry', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'node_modules', '@x', 'compiled-ds'), {
      'dist/definition.mjs': 'export const system = 1;',
      'dist/Button.mjs': 'export const Button = 1;',
      'dist/Button.d.ts': 'export declare const Button: unknown;',
      'dist/Button.mjs.map': '{}',
    });
    const entry = join(pkg, 'dist', 'definition.mjs');

    const result = await collect(root, { '@x/compiled-ds/definition': entry });

    expect(result.entries.map((item) => item.path).sort()).toEqual([
      relative(root, join(pkg, 'dist', 'Button.mjs')),
      relative(root, entry),
    ]);
    expect(result.packageDirs).toEqual([join(pkg, 'dist')]);
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

  test('an absolute-path specifier the resolver declines discovers the package src', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'sibling'), {
      'src/index.ts': 'export * from "./Card";',
      'src/Card.tsx': 'export const Card = 1;',
    });
    // Extensionless, as a relative `includes` specifier resolves — the kind
    // Node's resolver refuses, so the collector's own probe must answer.
    const specifier = join(pkg, 'src', 'index');

    const result = await collect(root, { [specifier]: null });

    expect(result.entries.map((e) => e.path).sort()).toEqual([
      'packages/sibling/src/Card.tsx',
      'packages/sibling/src/index.ts',
    ]);
    expect(result.packageMap).toEqual({
      [specifier]: 'packages/sibling/src/index.ts',
    });
    expect(result.sourceEntries.get(specifier)).toBe(
      join(pkg, 'src', 'index.ts')
    );
    expect(result.packageDirs).toEqual([join(pkg, 'src')]);
  });

  test('a directory specifier resolves through its index file', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'sibling'), {
      'src/index.ts': 'export const ds = 1;',
    });

    const result = await collect(root, { [join(pkg, 'src')]: null });

    expect(result.entries.map((e) => e.path)).toEqual([
      'packages/sibling/src/index.ts',
    ]);
    expect(result.packageDirs).toEqual([join(pkg, 'src')]);
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

  test('records a resolved outcome carrying the discovered file count', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export * from "./Button";',
      'src/Button.tsx': 'export const Button = 1;',
    });

    const result = await collect(root, {
      '@x/ds': join(pkg, 'dist', 'index.mjs'),
    });

    expect(result.outcomes).toEqual([
      { specifier: '@x/ds', outcome: 'resolved', fileCount: 2 },
    ]);
  });

  test('records an unresolvable outcome per specifier, in declaration order', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export const ds = 1;',
    });

    const result = await collect(root, {
      nope: null,
      '@x/ds': join(pkg, 'dist', 'index.mjs'),
    });

    expect(result.outcomes).toEqual([
      { specifier: 'nope', outcome: 'unresolvable', fileCount: 0 },
      { specifier: '@x/ds', outcome: 'resolved', fileCount: 1 },
    ]);
  });

  test('unresolvableIncludesMessage names every unresolvable specifier, null when all resolve', () => {
    expect(
      unresolvableIncludesMessage([
        { specifier: '@x/missing', outcome: 'unresolvable', fileCount: 0 },
        { specifier: '@x/ds', outcome: 'resolved', fileCount: 2 },
        { specifier: '@x/typo', outcome: 'unresolvable', fileCount: 0 },
      ])
    ).toBe(
      '[animus-extract] unresolvable include specifier(s): @x/missing, @x/typo'
    );
    expect(
      unresolvableIncludesMessage([
        { specifier: '@x/ds', outcome: 'resolved', fileCount: 2 },
        { specifier: '@x/empty', outcome: 'empty', fileCount: 0 },
      ])
    ).toBeNull();
  });

  test('records an empty outcome when a resolved package contributes no sources', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      // Everything under src/ is filtered out by the package-scoped excludes.
      'src/Button.test.tsx': 'test file',
      'main.ts': 'export {};',
    });

    const result = await collect(root, { '@x/ds': join(pkg, 'main.ts') });

    expect(result.entries).toEqual([]);
    expect(result.outcomes).toEqual([
      { specifier: '@x/ds', outcome: 'empty', fileCount: 0 },
    ]);
  });

  test('files the caller already has count toward the specifier, not against it', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export const a = 1;',
    });

    const result = await collect(
      root,
      { '@x/ds': join(pkg, 'dist', 'index.mjs') },
      { hasEntry: () => true }
    );

    // Nothing new to add, but the sources ARE in the analysis set — this is
    // not the silent "discovered nothing" failure the outcome exists to catch.
    expect(result.entries).toEqual([]);
    expect(result.outcomes).toEqual([
      { specifier: '@x/ds', outcome: 'resolved', fileCount: 1 },
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

  test('attributes pushed files and dirs to their owning specifier', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'kit'), {
      'src/index.ts': 'export const ds = 1;',
      'src/Card.tsx': 'export const Card = 2;',
    });

    const result = await collect(root, {
      '@acme/ui-kit': join(pkg, 'src', 'index.ts'),
    });

    expect(result.dirOwners).toEqual({
      [join(pkg, 'src')]: '@acme/ui-kit',
    });
    expect(result.fileOwners).toEqual({
      [relative(root, join(pkg, 'src', 'index.ts'))]: '@acme/ui-kit',
      [relative(root, join(pkg, 'src', 'Card.tsx'))]: '@acme/ui-kit',
    });
  });

  test('files the caller already supplied stay unattributed (consumer-owned)', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'kit'), {
      'src/index.ts': 'export const ds = 1;',
      'src/Card.tsx': 'export const Card = 2;',
    });
    const ownedRel = relative(root, join(pkg, 'src', 'Card.tsx'));

    const result = await collect(
      root,
      { '@acme/ui-kit': join(pkg, 'src', 'index.ts') },
      { hasEntry: (relPath) => relPath === ownedRel }
    );

    expect(result.fileOwners[ownedRel]).toBeUndefined();
    expect(
      result.fileOwners[relative(root, join(pkg, 'src', 'index.ts'))]
    ).toBe('@acme/ui-kit');
  });

  test('a dist entry older than the newest src file yields a stale-dist outcome', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export const ds = 1;',
      'dist/index.mjs': 'export const ds = 1;',
    });
    const distEntry = join(pkg, 'dist', 'index.mjs');
    const past = new Date(Date.now() - 60_000);
    utimesSync(distEntry, past, past);

    const result = await collect(root, { '@x/ds': distEntry });

    expect(result.outcomes).toEqual([
      { specifier: '@x/ds', outcome: 'stale-dist', fileCount: 1 },
    ]);
  });

  test('a dist entry at least as new as every src file stays resolved', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export const ds = 1;',
      'dist/index.mjs': 'export const ds = 1;',
    });
    const distEntry = join(pkg, 'dist', 'index.mjs');
    const future = new Date(Date.now() + 60_000);
    utimesSync(distEntry, future, future);

    const result = await collect(root, { '@x/ds': distEntry });

    expect(result.outcomes).toEqual([
      { specifier: '@x/ds', outcome: 'resolved', fileCount: 1 },
    ]);
    expect(staleDistIncludesMessage(result.outcomes)).toBeNull();
  });

  test('the freshness gate does not apply without a dist entry or without src/', async () => {
    const root = makeRoot();
    // Entry resolves inside src/ — there is no dist entry to be stale.
    const srcOnly = makePackage(join(root, 'packages', 'src-only'), {
      'src/index.ts': 'export const ds = 1;',
    });
    // No src/ tree — the dist entry is ingested directly, nothing to compare.
    const distOnly = makePackage(join(root, 'packages', 'dist-only'), {
      'dist/index.mjs': 'export const flat = 1;',
    });
    const distOnlyEntry = join(distOnly, 'dist', 'index.mjs');
    const past = new Date(Date.now() - 60_000);
    utimesSync(distOnlyEntry, past, past);

    const result = await collect(root, {
      '@x/src-only': join(srcOnly, 'src', 'index.ts'),
      '@x/dist-only': distOnlyEntry,
    });

    expect(result.outcomes).toEqual([
      { specifier: '@x/src-only', outcome: 'resolved', fileCount: 1 },
      { specifier: '@x/dist-only', outcome: 'resolved', fileCount: 1 },
    ]);
  });

  test('staleDistIncludesMessage names every stale package, null when none are stale', () => {
    expect(
      staleDistIncludesMessage([
        { specifier: '@x/kit', outcome: 'stale-dist', fileCount: 3 },
        { specifier: '@x/ds', outcome: 'resolved', fileCount: 2 },
        { specifier: '@x/base', outcome: 'stale-dist', fileCount: 1 },
      ])
    ).toBe(
      '[animus-extract] stale dist for include specifier(s): @x/kit, @x/base — dist entry is older than the newest src/ file; rebuild the package(s) before extracting'
    );
    expect(
      staleDistIncludesMessage([
        { specifier: '@x/ds', outcome: 'resolved', fileCount: 2 },
        { specifier: '@x/empty', outcome: 'empty', fileCount: 0 },
      ])
    ).toBeNull();
  });
});
