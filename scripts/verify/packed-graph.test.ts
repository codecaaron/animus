import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveTarballInputs,
  validateInstalledInternalGraph,
  validateInternalManifestEdges,
  type PackageManifest,
} from './packed-graph';

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('packed manifest graph', () => {
  it('reports a stale embedded internal dependency edge', () => {
    const manifests = new Map<string, PackageManifest>([
      ['@animus-ui/extract', { name: '@animus-ui/extract', version: '0.1.1' }],
      [
        '@animus-ui/next-plugin',
        {
          name: '@animus-ui/next-plugin',
          version: '0.1.1',
          dependencies: { '@animus-ui/extract': '0.1.0' },
        },
      ],
    ]);

    expect(validateInternalManifestEdges(manifests)).toEqual([
      expect.objectContaining({
        dependent: '@animus-ui/next-plugin',
        dependency: '@animus-ui/extract',
        declaredVersion: '0.1.0',
        expectedVersion: '0.1.1',
      }),
    ]);
  });

  it('reports a nested installed internal package mismatch with its path', () => {
    const root = temporaryDirectory('animus-packed-graph-');
    const parentPackage = join(root, 'node_modules/@animus-ui/next-plugin');
    const nestedPackage = join(
      parentPackage,
      'node_modules/@animus-ui/extract'
    );
    mkdirSync(nestedPackage, { recursive: true });
    writeFileSync(
      join(parentPackage, 'package.json'),
      JSON.stringify({ name: '@animus-ui/next-plugin', version: '0.1.1' })
    );
    writeFileSync(
      join(nestedPackage, 'package.json'),
      JSON.stringify({ name: '@animus-ui/extract', version: '0.1.0' })
    );

    expect(
      validateInstalledInternalGraph(
        root,
        new Map([
          ['@animus-ui/next-plugin', '0.1.1'],
          ['@animus-ui/extract', '0.1.1'],
        ])
      )
    ).toEqual([
      expect.objectContaining({
        packageName: '@animus-ui/extract',
        installedVersion: '0.1.0',
        expectedVersion: '0.1.1',
        path: nestedPackage,
      }),
    ]);
  });
});

describe('packed tarball input resolution', () => {
  it('resolves the complete immutable five-package set', () => {
    const directory = temporaryDirectory('animus-tarballs-');
    for (const packageName of [
      'properties',
      'system',
      'extract',
      'vite-plugin',
      'next-plugin',
    ]) {
      writeFileSync(join(directory, `animus-ui-${packageName}-0.1.1.tgz`), '');
    }

    const result = resolveTarballInputs(['--tarballs-dir', directory]);

    expect(result.mode).toBe('supplied');
    expect(result.tarballs).toEqual(
      new Map([
        [
          '@animus-ui/properties',
          join(directory, 'animus-ui-properties-0.1.1.tgz'),
        ],
        ['@animus-ui/system', join(directory, 'animus-ui-system-0.1.1.tgz')],
        ['@animus-ui/extract', join(directory, 'animus-ui-extract-0.1.1.tgz')],
        [
          '@animus-ui/vite-plugin',
          join(directory, 'animus-ui-vite-plugin-0.1.1.tgz'),
        ],
        [
          '@animus-ui/next-plugin',
          join(directory, 'animus-ui-next-plugin-0.1.1.tgz'),
        ],
      ])
    );
  });

  it('identifies a missing supplied package tarball', () => {
    const directory = temporaryDirectory('animus-tarballs-missing-');
    for (const packageName of [
      'properties',
      'system',
      'extract',
      'vite-plugin',
    ]) {
      writeFileSync(join(directory, `animus-ui-${packageName}-0.1.1.tgz`), '');
    }

    expect(() => resolveTarballInputs(['--tarballs-dir', directory])).toThrow(
      /missing tarball for @animus-ui\/next-plugin/
    );
  });

  it('rejects unknown packed verification flags', () => {
    expect(() => resolveTarballInputs(['--repack'])).toThrow(
      /unknown argument '--repack'/
    );
  });
});
