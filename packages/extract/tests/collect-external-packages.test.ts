import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  collectExternalPackageSources,
  firstOwners,
  importedKitDiagnostics,
  nativeKitSourceRoot,
  nativePackageLocator,
  sourceKitDependencies,
  staleDistIncludesMessage,
} from '../pipeline/discover-packages';
import {
  BUILT_IN_EXTENSION_POLICY,
  extensionPolicyJson,
} from '../pipeline/host-extensions';
import {
  INVALID_KIT_SOURCE_CONDITION,
  KIT_SYSTEM_NOT_INCLUDED,
  KIT_WITHOUT_SOURCE_CONDITION,
  PACKAGE_MISMATCH,
  SYSTEM_INSTANCE_MISMATCH,
} from '../pipeline/manifest-diagnostics';
import { systemInstanceMismatches } from '../pipeline/system-instances';

import type { JsonValue } from '../pipeline/tsconfig-paths';

const native = require('../index-v2.js');

/** The native table's kit source roots, as a session with no host
 *  conditions and the built-in order reads them. */
const kitSourceRoot = (rootDir: string, conditions: readonly string[] = []) =>
  nativeKitSourceRoot(
    native,
    rootDir,
    conditions,
    {},
    extensionPolicyJson(BUILT_IN_EXTENSION_POLICY)
  );

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

function collect(
  rootDir: string,
  specifierEntries: Record<string, string | null>,
  overrides: Partial<Parameters<typeof collectExternalPackageSources>[0]> = {}
) {
  return collectExternalPackageSources({
    specifiers: Object.keys(specifierEntries),
    resolveSpecifier: (spec) => specifierEntries[spec],
    kitSourceRoot: kitSourceRoot(rootDir),
    locatePackage: nativePackageLocator(native, {}),
    rootDir,
    extensionsSet: EXTENSIONS,
    hasEntry: () => false,
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

    // App code imports the package root; without the root key those imports
    // bypass the src redirect and ship untransformed dist chains.
    expect(result.packageMap).toEqual({
      '@x/ds/definition': 'packages/ds/src/definition.ts',
      '@x/ds': 'packages/ds/src/index.ts',
    });
    expect(result.sourceEntries.get('@x/ds')).toBe(
      join(pkg, 'src', 'index.ts')
    );
    expect(result.sourceEntries.get('@x/ds/definition')).toBe(
      join(pkg, 'src', 'definition.ts')
    );
    // The root alias is derived, not declared, so only the declared specifier
    // records an outcome.
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

  test('a derived root alias keeps its module-resolution redirect', async () => {
    // The derived root alias is resolution-only: it redirects root imports to
    // src, and nothing evaluates the root entry.
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'kit'), {
      'src/index.ts': 'export const kitMotion = 1;',
      'src/definition.ts': 'export const system = 1;',
    });

    const result = await collect(root, {
      '@x/kit/definition': join(pkg, 'src', 'definition.ts'),
    });

    expect(result.packageMap['@x/kit']).toBe(
      relative(root, join(pkg, 'src', 'index.ts'))
    );
    expect(result.sourceEntries.get('@x/kit')).toBe(
      join(pkg, 'src', 'index.ts')
    );
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
      kitSourceRoot: kitSourceRoot(root),
      locatePackage: nativePackageLocator(native, {}),
      rootDir: root,
      extensionsSet: EXTENSIONS,
      hasEntry: () => false,
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
    // Extensionless, the way a relative `includes` specifier is written:
    // Node's resolver refuses it, so the collector's own probe must answer.
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

    // Nothing new to add, but the sources are in the analysis set: not the
    // silent "discovered nothing" failure the outcome exists to catch.
    expect(result.entries).toEqual([]);
    expect(result.outcomes).toEqual([
      { specifier: '@x/ds', outcome: 'resolved', fileCount: 1 },
    ]);
  });

  test('onSourceRead observes every readable discovered source verbatim', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export {};',
      'src/Doc.mdx': '# doc',
    });

    const observed: Array<[string, string]> = [];
    const result = await collect(
      root,
      { '@x/ds': join(pkg, 'dist', 'index.mjs') },
      {
        onSourceRead: (source, relPath) => {
          observed.push([relPath, source]);
        },
      }
    );

    // Discovery never rewrites or skips; adaptation happens later in
    // ingestSourceEntries.
    expect(observed.sort()).toEqual([
      ['packages/ds/src/Doc.mdx', '# doc'],
      ['packages/ds/src/index.ts', 'export {};'],
    ]);
    expect(result.entries.map((entry) => entry.path).sort()).toEqual([
      'packages/ds/src/Doc.mdx',
      'packages/ds/src/index.ts',
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

    expect(firstOwners(result.dirOwnerSets)).toEqual({
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
    const srcOnly = makePackage(join(root, 'packages', 'src-only'), {
      'src/index.ts': 'export const ds = 1;',
    });
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

  test('dirOwnerSets records EVERY specifier that claimed a package dir (set-valued ownership input)', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'ds'), {
      'src/index.ts': 'export const root = 1;',
      'src/definition.ts': 'export const system = 1;',
    });

    const result = await collect(root, {
      '@x/ds': join(pkg, 'src', 'index.ts'),
      '@x/ds/definition': join(pkg, 'src', 'definition.ts'),
    });

    expect(firstOwners(result.dirOwnerSets)).toEqual({
      [join(pkg, 'src')]: '@x/ds',
    });
    expect(result.dirOwnerSets).toEqual({
      [join(pkg, 'src')]: ['@x/ds', '@x/ds/definition'],
    });
  });

  test('a kit names its source through the animus export condition or exports that already target source', async () => {
    const root = realpathSync(makeRoot());
    const kit = (
      base: string,
      exports: Record<string, Record<string, string>>,
      files: Record<string, string>
    ): string => {
      makePackage(base, files);
      writeFileSync(join(base, 'package.json'), JSON.stringify({ exports }));
      return base;
    };
    const installed = kit(
      join(root, 'node_modules', '@acme', 'installed'),
      {
        '.': {
          types: './dist/index.d.ts',
          animus: './authoring/index.ts',
          import: './dist/index.mjs',
        },
        './system': {
          animus: './authoring/system.ts',
          import: './dist/system.mjs',
        },
      },
      {
        'authoring/index.ts': 'export * from "./parts/card";',
        'authoring/parts/card.tsx': 'export const Card = 1;',
        'authoring/system.ts': 'export const system = 1;',
        'dist/index.mjs': 'export const Card = 2;',
        'dist/system.mjs': 'export const system = 2;',
      }
    );
    // Linked from outside node_modules, with no runtime build to resolve.
    const linked = kit(
      join(root, 'kits', 'linked'),
      { '.': { animus: './src/index.ts' } },
      { 'src/index.ts': 'export const Badge = 1;' }
    );
    symlinkSync(linked, join(root, 'node_modules', '@acme', 'linked'), 'dir');
    const legacy = makePackage(join(root, 'node_modules', '@acme', 'legacy'), {
      'src/index.ts': 'export const Old = 1;',
    });
    // Every exports target is already source, so no condition is needed.
    const sourceOnly = kit(
      join(root, 'node_modules', '@acme', 'source'),
      {
        '.': { types: './src/index.ts', import: './src/index.ts' },
        './parts': {
          types: './src/parts/card.tsx',
          import: './src/parts/card.tsx',
        },
      },
      {
        'src/index.ts': 'export * from "./parts/card";',
        'src/parts/card.tsx': 'export const Card = 3;',
      }
    );
    // An exact entry only `require` or `types` reaches is not source, but
    // the entry the specifier selects is, so it is read as source.
    const requireOnly = kit(
      join(root, 'node_modules', '@acme', 'require-only'),
      {
        '.': { import: './src/index.ts' },
        './part': { require: './dist/index.cjs' },
      },
      {
        'src/index.ts': 'export const Req = 1;',
        'dist/index.cjs': 'exports.Req = 1;',
      }
    );
    const typesOnly = kit(
      join(root, 'node_modules', '@acme', 'types-only'),
      {
        '.': { import: './src/index.ts' },
        './types': { types: './src/types.ts' },
      },
      {
        'src/index.ts': 'export const Typed = 1;',
        'src/types.ts': 'export type T = 1;',
      }
    );

    const result = await collect(root, {
      '@acme/installed/system': join(installed, 'dist', 'system.mjs'),
      '@acme/legacy': join(legacy, 'dist', 'index.mjs'),
      '@acme/linked': null,
      '@acme/source': join(sourceOnly, 'src', 'index.ts'),
      '@acme/require-only': join(requireOnly, 'src', 'index.ts'),
      '@acme/types-only': join(typesOnly, 'src', 'index.ts'),
    });

    expect(Object.fromEntries(result.sourceEntries)).toEqual({
      '@acme/installed': join(installed, 'authoring', 'index.ts'),
      '@acme/installed/system': join(installed, 'authoring', 'system.ts'),
      '@acme/legacy': join(legacy, 'src', 'index.ts'),
      '@acme/linked': join(linked, 'src', 'index.ts'),
      '@acme/source': join(sourceOnly, 'src', 'index.ts'),
      '@acme/source/parts': join(sourceOnly, 'src', 'parts', 'card.tsx'),
      '@acme/require-only': join(requireOnly, 'src', 'index.ts'),
      '@acme/types-only': join(typesOnly, 'src', 'index.ts'),
    });
    expect(result.entries.map((e) => e.path).sort()).toEqual([
      'kits/linked/src/index.ts',
      'node_modules/@acme/installed/authoring/index.ts',
      'node_modules/@acme/installed/authoring/parts/card.tsx',
      'node_modules/@acme/installed/authoring/system.ts',
      'node_modules/@acme/legacy/src/index.ts',
      'node_modules/@acme/require-only/src/index.ts',
      'node_modules/@acme/source/src/index.ts',
      'node_modules/@acme/source/src/parts/card.tsx',
      'node_modules/@acme/types-only/src/index.ts',
      'node_modules/@acme/types-only/src/types.ts',
    ]);
    expect(result.outcomes.map((o) => o.outcome)).toEqual([
      'resolved',
      'resolved',
      'resolved',
      'resolved',
      'resolved',
      'resolved',
    ]);
    // The entry each specifier selects targets source, so a `require`- or
    // `types`-only sibling loses it no fidelity: only the guessed kit warns.
    expect(result.diagnostics.map((d) => [d.file, d.code])).toEqual([
      ['@acme/legacy', KIT_WITHOUT_SOURCE_CONDITION],
    ]);
  });
});

// Contract: a kit's root is the package Node locates for its name. A
// manifest nested below it, as `@bcoe/v8-coverage` publishes
// `dist/lib/package.json` with its own name, is part of the package.
test('a manifest nested below the package is no package root', async () => {
  const root = makeRoot();
  const pkg = join(root, 'node_modules', 'nested');
  for (const [file, source] of [
    [
      'package.json',
      JSON.stringify({ name: 'nested', main: 'dist/lib/index' }),
    ],
    ['dist/lib/package.json', JSON.stringify({ name: 'nested' })],
    ['dist/lib/index.js', 'export const Built = 1;'],
    ['src/index.ts', 'export const Source = 1;'],
  ]) {
    mkdirSync(join(pkg, file, '..'), { recursive: true });
    writeFileSync(join(pkg, file), source);
  }

  const result = await collect(root, {
    nested: join(pkg, 'dist', 'lib', 'index.js'),
  });

  expect(result.entries.map((e) => e.path)).toEqual([
    'node_modules/nested/src/index.ts',
  ]);
  expect(result.diagnostics.map((d) => [d.file, d.code])).toEqual([
    ['nested', KIT_WITHOUT_SOURCE_CONDITION],
  ]);
});

// An entry linked out of the package is not the package's file, so its
// nested manifest stays the root, as before.
test.skipIf(process.platform === 'win32')(
  'an entry linked out of the package keeps its nested root',
  async () => {
    const root = makeRoot();
    const pkg = join(root, 'node_modules', 'kit');
    for (const [file, source] of [
      [
        'package.json',
        JSON.stringify({ name: 'kit', main: './dist/index.js' }),
      ],
      ['dist/package.json', JSON.stringify({ name: 'kit' })],
      ['dist/src/index.ts', 'export const t = 2;'],
      ['src/index.ts', 'export const t = 1;'],
      ['../../cache/index.js', 'export const t = 7;'],
    ]) {
      mkdirSync(join(pkg, file, '..'), { recursive: true });
      writeFileSync(join(pkg, file), source);
    }
    symlinkSync(join(root, 'cache', 'index.js'), join(pkg, 'dist', 'index.js'));

    const result = await collect(root, {
      kit: join(pkg, 'dist', 'index.js'),
    });

    expect(result.entries.map((e) => e.path)).toEqual([
      'node_modules/kit/dist/src/index.ts',
    ]);
  }
);

// Contract: a path the filesystem opens under a spelling no directory lists
// is never read as that file, and an entry read from its runtime target in
// its place is analysed (exact spelling, spec §2.2 A2). Where the filesystem
// does not open the misspelling, the host finds nothing there either.
describe('collectExternalPackageSources under exact case', () => {
  test('an absolute include the host answers through a case variant is unresolvable', async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'tokens'), {
      'src/Token.ts': 'export const t = 1;',
    });
    const specifier = join(pkg, 'src', 'token.ts');
    // A case-insensitive host opens the file under the include's spelling;
    // a case-sensitive one finds nothing.
    const opens = existsSync(specifier);
    const result = await collect(root, {
      [specifier]: opens ? specifier : null,
    });

    expect(result.entries).toEqual([]);
    expect(result.outcomes).toEqual([
      expect.objectContaining({ specifier, outcome: 'unresolvable' }),
    ]);
    if (opens) {
      expect(result.outcomes[0].reason).toContain('spelled differently');
    }
  });

  test("a misspelled absolute include stays unresolvable when the host answers with the file's spelling", async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'tokens'), {
      'token.ts': 'export const t = 1;',
    });
    const specifier = join(pkg, 'Token.ts');
    // A case-insensitive host opens the include and answers with the
    // file's canonical spelling; a case-sensitive one finds nothing.
    const opens = existsSync(specifier);
    const result = await collect(root, {
      [specifier]: opens ? join(pkg, 'token.ts') : null,
    });

    expect(result.entries).toEqual([]);
    expect(result.outcomes).toEqual([
      expect.objectContaining({ specifier, outcome: 'unresolvable' }),
    ]);
    if (opens) {
      expect(result.outcomes[0].reason).toContain('spelled differently');
    }
  });

  test("an absolute include's `..` past a link is taken back lexically, as Node reads it", async () => {
    const root = makeRoot();
    const pkg = makePackage(join(root, 'packages', 'kit'), {
      'token.ts': 'export const t = 1;',
      'other/Token.ts': 'export const t = 2;',
      'other/sub/x.ts': 'export const x = 1;',
    });
    symlinkSync(join(pkg, 'other', 'sub'), join(pkg, 'link'));
    // Spelled raw: `join` would take the `..` back itself.
    const specifier = `${pkg}/link/../token.ts`;

    const result = await collect(root, { [specifier]: null });

    // The entry read is the package's own `token.ts`, not the file the link's
    // parent holds.
    expect(result.packageMap[specifier]).toBe('packages/kit/token.ts');
    expect(
      result.entries.find((entry) => entry.path === 'packages/kit/token.ts')
        ?.source
    ).toBe('export const t = 1;');
  });

  test('an entry whose source target is misspelled is analysed from its runtime target', async () => {
    const root = makeRoot();
    const pkg = join(root, 'node_modules', 'kit');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'kit',
        exports: {
          '.': { animus: './src/Index.ts', import: './dist/index.js' },
          './other': { animus: './src/other.ts' },
        },
      })
    );
    for (const [file, source] of [
      ['src/index.ts', 'export const Root = 1;'],
      ['src/other.ts', 'export const Other = 1;'],
      ['dist/index.js', 'export const Root = 1;'],
    ]) {
      mkdirSync(join(pkg, file, '..'), { recursive: true });
      writeFileSync(join(pkg, file), source);
    }

    const result = await collect(
      root,
      { kit: join(pkg, 'dist', 'index.js') },
      { extensionsSet: new Set(['.ts', '.tsx', '.js']) }
    );

    expect(result.entries.map((e) => e.path)).toContain(
      'node_modules/kit/dist/index.js'
    );
    expect(result.packageMap.kit).toBe('node_modules/kit/dist/index.js');
    const opens = existsSync(join(pkg, 'src', 'Index.ts'));
    expect(result.diagnostics.map((d) => d.message).join('\n')).toContain(
      opens ? 'spelled otherwise on disk' : 'is missing'
    );
  });
});

// Contract: discovery reads each kit entry from the file the system loader
// evaluates (spec §2.2 A3, A5): the same `animus` selection (arrays, nested
// conditions, a backslash read as `/`), the same source-targeting exports,
// and the loader's loud refusal of a selected percent-escaped target. Each
// row: the package's `exports`, its files, the host's runtime entry, the
// participant's conditions, and the file both read (or the refusal).
// spike-codex's fixtures from the #331 re-check, and wc's nested condition.
const JS_FILES = {
  'src/index.js': 1,
  'src\\index.js': 5,
  'src/second.js': 6,
  'src/a b.js': 2,
  'src/a%20b.js': 3,
  'src/a%zzb.js': 4,
  'dist/index.js': 9,
};
const TS_FILES = {
  'src/index.ts': 1,
  'src\\index.ts': 5,
  'src/second.ts': 6,
  'dist/index.js': 9,
  'src/a%20b.ts': 3,
  'src/a b.ts': 2,
};
const CONDITION_FILES = {
  'src/browser.ts': 1,
  'src/node.ts': 2,
  'dist/index.js': 9,
};
const REFUSED = 'percent-escape unsupported';
const STOP_FILES = {
  'src/first.js': 1,
  'src/second.js': 2,
  'dist/index.js': 9,
};
const conditional = (
  animus: JsonValue,
  runtime: JsonValue = './dist/index.js'
) => ({
  '.': { animus, import: runtime },
});
test.skipIf(process.platform === 'win32').each([
  [
    'backslash',
    conditional('./src\\index.js'),
    JS_FILES,
    'dist/index.js',
    [],
    'src/index.js',
  ],
  [
    'sugar-backslash',
    { animus: './src\\index.js', import: './dist/index.js' },
    JS_FILES,
    'dist/index.js',
    [],
    'src/index.js',
  ],
  [
    'array-backslash',
    conditional(['./src\\index.js', './src/second.js']),
    JS_FILES,
    'dist/index.js',
    [],
    'src/index.js',
  ],
  [
    'array-invalid-backslash',
    conditional(['invalid', './src\\index.js']),
    JS_FILES,
    'dist/index.js',
    [],
    'src/index.js',
  ],
  [
    'root-array-backslash',
    [{ animus: './src\\index.js', import: './dist/index.js' }],
    JS_FILES,
    'dist/index.js',
    [],
    'src/index.js',
  ],
  [
    'percent',
    conditional('./src/a%20b.js'),
    JS_FILES,
    'dist/index.js',
    [],
    REFUSED,
  ],
  [
    'percent-malformed',
    conditional('./src/a%zzb.js'),
    JS_FILES,
    'dist/index.js',
    [],
    REFUSED,
  ],
  [
    'array-percent',
    conditional(['./src/a%20b.js', './src/second.js']),
    JS_FILES,
    'dist/index.js',
    [],
    REFUSED,
  ],
  [
    'array-percent-malformed',
    conditional(['./src/a%zzb.js', './src/second.js']),
    JS_FILES,
    'dist/index.js',
    [],
    REFUSED,
  ],
  [
    'array-valid-first',
    conditional(['./src/second.js', './src/a%20b.js']),
    JS_FILES,
    'dist/index.js',
    [],
    'src/second.js',
  ],
  [
    'runtime-array-percent',
    conditional('./src/a%20b.js', ['./dist/index.js', './src/second.js']),
    JS_FILES,
    'dist/index.js',
    [],
    REFUSED,
  ],
  [
    'sugar-plain-backslash',
    './src\\index.js',
    JS_FILES,
    'src/index.js',
    [],
    'src/index.js',
  ],
  ['sugar-ts', './src\\index.ts', TS_FILES, 'src/index.ts', [], 'src/index.ts'],
  [
    'root-array-ts',
    ['./src\\index.ts', './src/second.ts'],
    TS_FILES,
    'src/index.ts',
    [],
    'src/index.ts',
  ],
  [
    'runtime-array-ts',
    { '.': { import: ['./src\\index.ts', './src/second.ts'] } },
    TS_FILES,
    'src/index.ts',
    [],
    'src/index.ts',
  ],
  [
    'animus-array-ts',
    conditional(['./src\\index.ts', './src/second.ts']),
    TS_FILES,
    'dist/index.js',
    [],
    'src/index.ts',
  ],
  [
    'percent-ts',
    conditional('./src/a%20b.ts'),
    TS_FILES,
    'dist/index.js',
    [],
    REFUSED,
  ],
  [
    'nested-animus-browser',
    {
      '.': {
        animus: { browser: './src/browser.ts', node: './src/node.ts' },
        browser: './dist/index.js',
        node: './dist/index.js',
      },
    },
    CONDITION_FILES,
    'dist/index.js',
    ['browser'],
    'src/browser.ts',
  ],
  [
    'dot-slash',
    conditional('./src/index.ts'),
    TS_FILES,
    'dist/index.js',
    [],
    'src/index.ts',
  ],
  [
    'empty-segment',
    conditional('./src//index.ts'),
    TS_FILES,
    'dist/index.js',
    [],
    'src/index.ts',
  ],
  [
    'no-dot-slash',
    conditional('src/index.ts'),
    TS_FILES,
    'dist/index.js',
    [],
    'dist/index.js',
  ],
  [
    'parent-segment',
    conditional('./src/../src/index.ts'),
    TS_FILES,
    'dist/index.js',
    [],
    'dist/index.js',
  ],
  [
    'dot-segment',
    conditional('./src/./index.ts'),
    TS_FILES,
    'dist/index.js',
    [],
    'dist/index.js',
  ],
  [
    'array-runtime-first',
    [
      './src/first.js',
      { animus: './src/second.js', import: './dist/index.js' },
    ],
    STOP_FILES,
    'src/first.js',
    [],
    'src/first.js',
  ],
  [
    'import-before-animus',
    {
      '.': {
        import: './src/first.js',
        default: { animus: './src/second.js', import: './dist/index.js' },
      },
    },
    STOP_FILES,
    'src/first.js',
    [],
    'src/first.js',
  ],
  [
    'nested-animus-node',
    {
      '.': {
        animus: { browser: './src/browser.ts', node: './src/node.ts' },
        browser: './dist/index.js',
        node: './dist/index.js',
      },
    },
    CONDITION_FILES,
    'dist/index.js',
    ['node'],
    'src/node.ts',
  ],
])(
  '%s: discovery reads the file the system loader evaluates',
  async (name, exports, files, hostEntry, conditions, read) => {
    const root = realpathSync(makeRoot());
    const pkg = join(root, 'node_modules', name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name, type: 'module', exports })
    );
    for (const [file, t] of Object.entries(files)) {
      mkdirSync(join(pkg, file, '..'), { recursive: true });
      writeFileSync(join(pkg, file), `export const t=${t};\n`);
    }

    const result = await collect(
      root,
      { [name]: join(pkg, hostEntry) },
      { kitSourceRoot: kitSourceRoot(root, conditions) }
    );
    const outcome = result.outcomes[0];
    const redirected =
      result.sourceEntries.get(name) ??
      (result.packageMap[name] && join(root, result.packageMap[name]));
    const loaded = native.resolveSpecifier(name, root, conditions);

    expect({
      discovery:
        outcome.outcome === 'unresolvable'
          ? outcome.reason
          : redirected && relative(pkg, redirected),
      loader: loaded.path ? relative(pkg, loaded.path) : loaded.unresolved,
      reported: result.diagnostics.some(
        (d) => d.code === INVALID_KIT_SOURCE_CONDITION
      ),
    }).toEqual(
      read === REFUSED
        ? {
            discovery: expect.stringContaining(REFUSED),
            loader: expect.stringContaining(REFUSED),
            reported: true,
          }
        : { discovery: read, loader: read, reported: read === 'dist/index.js' }
    );
  }
);

// Contract: AQ-3. A kit's source root comes with the rule that chose it: a
// valid `animus` condition gives its source root and no finding; a kit with
// none falls back to `src/` and reports kit-without-source-condition; a
// target outside the package falls back to the runtime entry and reports
// invalid-source-condition.
test.each([
  [
    { '.': { animus: './src/index.ts', import: './dist/index.js' } },
    'animus',
    'src',
    [],
  ],
  [
    { '.': { import: './dist/index.js' } },
    'src',
    'src',
    [KIT_WITHOUT_SOURCE_CONDITION],
  ],
  [
    { '.': { animus: '../outside.ts', import: './dist/index.js' } },
    'compiled',
    'dist',
    [INVALID_KIT_SOURCE_CONDITION],
  ],
])(
  '%j: the %s rule chooses the source root',
  async (exports, rule, rootDirName, codes) => {
    const root = realpathSync(makeRoot());
    const pkg = join(root, 'node_modules', 'kit');
    for (const file of ['src/index.ts', 'dist/index.js', '../outside.ts']) {
      mkdirSync(join(pkg, file, '..'), { recursive: true });
      writeFileSync(join(pkg, file), 'export const t = 1;\n');
    }
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'kit', exports })
    );
    const host = join(pkg, 'dist', 'index.js');

    const selection = kitSourceRoot(root)('kit', pkg, host);
    const result = await collect(root, { kit: host });

    expect({
      rule: selection?.rule,
      root: selection?.root && relative(pkg, selection.root),
      codes: result.diagnostics.map((d) => d.code),
    }).toEqual({ rule, root: rootDirName, codes });
  }
);

// Contract: a pattern entry's source facet is read as the loader reads it:
// `kit/foo` through `./*`'s `animus` target is `src/entries/foo.ts`, never a
// `src/` guess.
test('a wildcard entry is read through its animus target', async () => {
  const root = realpathSync(makeRoot());
  const pkg = join(root, 'node_modules', 'wild-kit');
  for (const file of ['src/entries/foo.ts', 'src/foo.ts', 'dist/foo.js']) {
    mkdirSync(join(pkg, file, '..'), { recursive: true });
    writeFileSync(join(pkg, file), 'export const t = 1;\n');
  }
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: 'wild-kit',
      exports: {
        './*': { animus: './src/entries/*.ts', import: './dist/*.js' },
      },
    })
  );

  const result = await collect(root, {
    'wild-kit/foo': join(pkg, 'dist', 'foo.js'),
  });
  const loaded = native.resolveSpecifier('wild-kit/foo', root, []);

  expect({
    discovery: relative(pkg, result.sourceEntries.get('wild-kit/foo') ?? ''),
    loader: relative(pkg, loaded.path ?? ''),
  }).toEqual({ discovery: 'src/entries/foo.ts', loader: 'src/entries/foo.ts' });
});

// Contract: a package is a kit when its manifest declares an `animus`
// condition anywhere in its `exports` (any entry, subpath or pattern, under
// any condition, valid or not), as the loader's table reads it. The app's
// declared source kits and the imported-kit check both read it so, whether
// or not the package's root entry resolves.
test.each([
  ['array', { '.': { animus: ['./src/index.ts'], import: './dist/index.js' } }],
  [
    'subpath-only',
    { './button': { animus: './src/index.ts', import: './dist/index.js' } },
  ],
  ['invalid-without-runtime', { '.': { animus: '../outside.ts' } }],
  [
    'nested-under-browser',
    {
      '.': {
        browser: { animus: './src/index.ts', default: './dist/index.js' },
      },
    },
  ],
  ['pattern-only', { './*': { animus: './src/*.ts', import: './dist/*.js' } }],
])('a %s kit is a kit to both checks', (declaration, exports) => {
  const name = `${declaration}-kit`;
  const root = realpathSync(makeRoot());
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: { [name]: '1.0.0' } })
  );
  const pkg = join(root, 'node_modules', name);
  for (const file of ['src/index.ts', 'dist/index.js']) {
    mkdirSync(join(pkg, file, '..'), { recursive: true });
    writeFileSync(join(pkg, file), 'export const t = 1;\n');
  }
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, exports }));
  const engine = {
    declaresKitSource: native.declaresKitSource,
    locatePackage: native.locatePackage,
    extractFacts: () =>
      JSON.stringify({
        parseCount: 1,
        files: {
          'src/App.tsx': {
            parsePanicked: false,
            imports: [{ local: 'x', imported: 'x', source: name }],
            exports: [],
          },
        },
      }),
  };

  expect({
    declared: sourceKitDependencies(root, engine).map((kit) => kit.name),
    imported: importedKitDiagnostics(
      [{ path: 'src/App.tsx', source: '' }],
      engine,
      root,
      []
    ).map((d) => [d.component, d.code]),
  }).toEqual({
    declared: [name],
    imported: [[name, KIT_SYSTEM_NOT_INCLUDED]],
  });
});

// Contract: a pattern entry whose runtime target is already source is that
// source, as the loader evaluates it: `kit/foo` through `./*` reads
// `src/entries/foo.ts`, never a `src/` guess, and a source-targeting export
// loses no source fidelity, so it reports no kit-without-source-condition.
test('a source-targeting wildcard entry is read as its source, with no finding', async () => {
  const root = realpathSync(makeRoot());
  const pkg = join(root, 'node_modules', 'source-wild');
  for (const file of ['src/entries/foo.ts', 'src/foo.ts']) {
    mkdirSync(join(pkg, file, '..'), { recursive: true });
    writeFileSync(join(pkg, file), 'export const t = 1;\n');
  }
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: 'source-wild',
      exports: { './*': './src/entries/*.ts' },
    })
  );

  const result = await collect(root, {
    'source-wild/foo': join(pkg, 'src', 'entries', 'foo.ts'),
  });
  const loaded = native.resolveSpecifier('source-wild/foo', root, []);

  expect({
    discovery: relative(
      pkg,
      result.sourceEntries.get('source-wild/foo') ??
        join(root, result.packageMap['source-wild/foo'] ?? '')
    ),
    loader: relative(pkg, loaded.path ?? ''),
    findings: result.diagnostics.map((d) => d.code),
  }).toEqual({
    discovery: 'src/entries/foo.ts',
    loader: 'src/entries/foo.ts',
    findings: [],
  });
});

// Contract: a refused percent entry is reported whichever of its package's
// specifiers the system includes first.
test.each([[['pct', 'pct/a%20b']], [['pct/a%20b', 'pct']]])(
  'a refused percent entry is reported for includes %j',
  async (order) => {
    const root = realpathSync(makeRoot());
    const pkg = join(root, 'node_modules', 'pct');
    for (const file of [
      'src/index.ts',
      'src/a%20b.ts',
      'dist/index.js',
      'dist/a%20b.js',
    ]) {
      mkdirSync(join(pkg, file, '..'), { recursive: true });
      writeFileSync(join(pkg, file), 'export const t = 1;\n');
    }
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'pct',
        exports: {
          '.': { animus: './src/index.ts', import: './dist/index.js' },
          './*': { animus: './src/*.ts', import: './dist/*.js' },
        },
      })
    );

    const result = await collect(
      root,
      Object.fromEntries(
        order.map((specifier) => [
          specifier,
          join(pkg, 'dist', `${specifier === 'pct' ? 'index' : 'a%20b'}.js`),
        ])
      )
    );

    expect(
      result.diagnostics
        .filter((d) => d.code === INVALID_KIT_SOURCE_CONDITION)
        .map((d) => d.message)
    ).toEqual([expect.stringContaining('percent-escape unsupported')]);
  }
);

// Contract: the source-targeting inference reads the entry the specifier
// selects; an unrelated entry whose target is compiled output vetoes nothing.
test('a source pattern beside a compiled root entry is read as its source', async () => {
  const root = realpathSync(makeRoot());
  const pkg = join(root, 'node_modules', 'mixed-root');
  for (const file of ['dist/index.js', 'src/entries/foo.ts', 'src/foo.ts']) {
    mkdirSync(join(pkg, file, '..'), { recursive: true });
    writeFileSync(join(pkg, file), 'export const t = 1;\n');
  }
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: 'mixed-root',
      exports: { '.': './dist/index.js', './*': './src/entries/*.ts' },
    })
  );

  const result = await collect(root, {
    'mixed-root/foo': join(pkg, 'src', 'entries', 'foo.ts'),
  });
  const loaded = native.resolveSpecifier('mixed-root/foo', root, []);

  expect({
    discovery: relative(
      pkg,
      result.sourceEntries.get('mixed-root/foo') ??
        join(root, result.packageMap['mixed-root/foo'] ?? '')
    ),
    loader: relative(pkg, loaded.path ?? ''),
    findings: result.diagnostics.map((d) => d.code),
  }).toEqual({
    discovery: 'src/entries/foo.ts',
    loader: 'src/entries/foo.ts',
    findings: [],
  });
});

// Contract: two copies of one package report their own findings, each
// naming its own target.
test('two copies of a kit report their own percent findings', async () => {
  const root = realpathSync(makeRoot());
  const copy = (dir: string, escaped: string): string => {
    for (const file of [
      'src/index.ts',
      'src/y.ts',
      `src/${escaped}.ts`,
      'dist/index.js',
      'dist/y.js',
      'dist/x.js',
    ]) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), 'export const t = 1;\n');
    }
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'pct',
        exports: {
          '.': { animus: './src/index.ts', import: './dist/index.js' },
          './y': { animus: './src/y.ts', import: './dist/y.js' },
          './x': { animus: `./src/${escaped}.ts`, import: './dist/x.js' },
        },
      })
    );
    return dir;
  };
  const first = copy(join(root, 'node_modules', 'pct'), 'a%20b');
  const second = copy(join(root, 'other', 'node_modules', 'pct'), 'c%20d');

  const result = await collect(root, {
    pct: join(first, 'dist', 'index.js'),
    'pct/y': join(second, 'dist', 'y.js'),
  });

  expect(
    result.diagnostics
      .filter((d) => d.code === INVALID_KIT_SOURCE_CONDITION)
      .map((d) => /a%20b|c%20d/.exec(d.message)?.[0])
      .sort()
  ).toEqual(['a%20b', 'c%20d']);
});

// Contract: discovery locates a package as the system loader does: the first
// `node_modules/<name>` up the tree, before a declared workspace of that
// name, at its real path; null where neither holds it.
test('locatePackage reads node_modules before the workspaces, at the real path', () => {
  const root = realpathSync(makeRoot());
  const linked = makePackage(join(root, 'packages', 'linked'), {});
  const unlinked = makePackage(join(root, 'packages', 'unlinked'), {});
  const shadowed = makePackage(join(root, 'packages', 'shadowed'), {});
  const installed = makePackage(
    join(root, 'node_modules', '@x', 'shadowed'),
    {}
  );
  symlinkSync(linked, join(root, 'node_modules', '@x', 'linked'));
  const locate = nativePackageLocator(native, {
    '@x/unlinked': unlinked,
    '@x/shadowed': shadowed,
  });

  expect(
    ['@x/linked', '@x/unlinked', '@x/shadowed', '@x/absent'].map((name) =>
      locate(name, join(root, 'app'))
    )
  ).toEqual([linked, unlinked, installed, null]);
});

// Contract: locating an unlinked workspace package admits nothing the host
// cannot load (spec §2.2 A2). Where only the system loader resolves it, a kit
// is admitted only where a source entry redirects the import: with only
// compiled output it is located but unresolvable; with an `animus` source
// condition it is admitted.
test.each([
  [undefined, false],
  [{ '.': { animus: './src/index.ts', default: './dist/index.js' } }, true],
])(
  'an unlinked workspace kit with exports %j is admitted: %s',
  async (exports, admitted) => {
    const root = realpathSync(makeRoot());
    const kit = join(root, 'packages', 'kit');
    makePackage(kit, { 'dist/index.js': 'export const t = 1;\n' });
    if (exports) {
      mkdirSync(join(kit, 'src'));
      writeFileSync(join(kit, 'src', 'index.ts'), 'export const t = 1;\n');
    }
    writeFileSync(
      join(kit, 'package.json'),
      JSON.stringify({
        name: '@x/kit',
        exports: exports ?? { '.': './dist/index.js' },
      })
    );
    const workspaces = { '@x/kit': kit };
    const result = await collect(
      root,
      {},
      {
        specifiers: ['@x/kit'],
        // The host resolves nothing; the system loader's answer is all.
        resolveSpecifier: (spec) =>
          native.resolveSpecifier(spec, root, [], workspaces).path ?? null,
        requireSourceEntry: () => true,
        kitSourceRoot: nativeKitSourceRoot(
          native,
          root,
          [],
          workspaces,
          extensionPolicyJson(BUILT_IN_EXTENSION_POLICY)
        ),
        locatePackage: nativePackageLocator(native, workspaces),
      }
    );

    expect({
      located: nativePackageLocator(native, workspaces)('@x/kit', root),
      admitted: Object.hasOwn(result.packageMap, '@x/kit'),
      outcome: result.outcomes[0]?.outcome,
    }).toEqual({
      located: kit,
      admitted,
      outcome: admitted
        ? expect.not.stringMatching(/^unresolvable$/)
        : 'unresolvable',
    });
  }
);

describe('a host-resolved package', () => {
  /** Contract: extraction reads the package the host resolves (spec §2.2
   *  A4), where a host alias resolves one package to another. An answer
   *  in no package of its own is read from the installed package, and is
   *  reported unless it lies under node_modules (a dependency cache). */
  test('extraction reads the package the host resolves', async () => {
    // Real, as the locator answers: macOS links /var.
    const root = realpathSync(makeRoot());
    writeFileSync(join(root, 'package.json'), '{"name":"app"}');
    const kit = (name: string, component: string): string => {
      const base = join(root, 'node_modules', name);
      makePackage(base, {
        [`src/${component}.tsx`]: `export const ${component} = 1;`,
        'src/index.ts': `export * from './${component}';`,
        'dist/index.mjs': `export const ${component} = 2;`,
      });
      writeFileSync(
        join(base, 'package.json'),
        JSON.stringify({
          name,
          exports: {
            '.': { animus: './src/index.ts', import: './dist/index.mjs' },
          },
        })
      );
      return base;
    };
    kit('kit', 'Installed');
    const aliased = kit('alt-kit', 'Aliased');
    const read = async (hostEntry: string) => {
      const result = await collect(root, { kit: hostEntry });
      return {
        files: result.entries.map((entry) => entry.path).sort(),
        redirects: Object.fromEntries(result.sourceEntries),
        mismatches: result.diagnostics.filter(
          (diagnostic) => diagnostic.code === PACKAGE_MISMATCH
        ),
      };
    };

    const alias = await read(join(aliased, 'dist', 'index.mjs'));
    expect(alias.files).toEqual([
      'node_modules/alt-kit/src/Aliased.tsx',
      'node_modules/alt-kit/src/index.ts',
    ]);
    // The host hands its plugins the aliased name.
    expect(alias.redirects).toEqual({
      kit: join(aliased, 'src', 'index.ts'),
      'alt-kit': join(aliased, 'src', 'index.ts'),
    });
    expect(alias.mismatches).toEqual([]);

    const installedFiles = [
      'node_modules/kit/src/Installed.tsx',
      'node_modules/kit/src/index.ts',
    ];
    const cache = join(root, 'node_modules', '.vite', 'deps', 'kit.js');
    mkdirSync(join(cache, '..'), { recursive: true });
    writeFileSync(cache, 'export const Installed = 3;');
    const cached = await read(cache);
    expect(cached.files).toEqual(installedFiles);
    expect(cached.mismatches).toEqual([]);

    const local = join(root, 'src', 'local-kit.ts');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(local, 'export const Local = 4;');
    const elsewhere = await read(local);
    expect(elsewhere.files).toEqual(installedFiles);
    expect(elsewhere.mismatches.map((d) => d.message)).toEqual([
      expect.stringContaining(`resolves 'kit' to src/local-kit.ts`),
    ]);
  });
});

describe('a kit the system evaluates', () => {
  /** Contract: the system and the analysis read one instance of each kit
   *  (spec §2.2 A4). A system-file kit whose analysed instance is not the
   *  one the system load evaluated fails, naming both. */
  test('is the instance extraction analyses', () => {
    const root = realpathSync(makeRoot());
    const installed = join(root, 'node_modules', 'kit');
    const aliased = join(root, 'node_modules', 'alt-kit');
    for (const dir of [installed, aliased]) {
      makePackage(dir, { 'src/definition.ts': 'export const system = 1;' });
    }
    const evaluatedFile = join(installed, 'src', 'definition.ts');
    const check = (analysedDir: string, evaluated = [evaluatedFile]) =>
      systemInstanceMismatches({
        rootDir: root,
        specifiers: ['kit/definition'],
        dirOwnerSets: { [join(analysedDir, 'src')]: ['kit/definition'] },
        evaluated,
        loaderResolve: () => evaluatedFile,
      }).map(({ code, message }) => [code, message]);

    expect(check(installed)).toEqual([]);
    expect(check(aliased)).toEqual([
      [
        SYSTEM_INSTANCE_MISMATCH,
        expect.stringContaining(
          "evaluates 'kit/definition' from node_modules/kit, but the host bundler resolves it to node_modules/alt-kit"
        ),
      ],
    ]);
    // A file the load never read is no evaluated instance.
    expect(check(aliased, [])).toEqual([]);
  });
});
