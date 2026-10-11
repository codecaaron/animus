import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUILT_IN_ASSET_SOURCE } from '../../pipeline/built-in-asset-types';
import {
  builtInAssetClassification,
  esbuildAssetClassification,
  viteAssetClassification,
  webpackAssetClassification,
} from '../../pipeline/host-assets';
import { webpackExtensionPolicy } from '../../pipeline/host-extensions';
import { hostCandidate } from '../../pipeline/probe-evidence';

// Contract: a webpack-like host's captured order is the order the bundler
// resolves an ESM import with, or `built-in` with the reason where it cannot
// be read (spec §2.2 A2).
describe('webpackExtensionPolicy', () => {
  it("merges a nested alias's `...` with its extension's root sequence", () => {
    const policy = webpackExtensionPolicy(
      'webpack',
      {
        extensionAlias: { '.js': ['.ts', '.js'] },
        byDependency: { esm: { extensionAlias: { '.js': ['.mts', '...'] } } },
      },
      '5.105.4'
    );

    // webpack 5.105.4 resolves `./x.js` through these, in this order.
    expect(policy.alias).toEqual([['.js', ['.mts', '.ts', '.js']]]);
  });

  it('reads a string extensionAlias value, at the root or for ESM, as unreadable', () => {
    for (const resolve of [
      { extensionAlias: { '.js': '...' } },
      {
        extensionAlias: { '.js': ['.ts', '.js'] },
        byDependency: { esm: { extensionAlias: { '.js': '...' } } },
      },
    ]) {
      expect(
        webpackExtensionPolicy('webpack', resolve, '5.105.4').resolverVersion
      ).toBe('built-in (hostOptionUnreadable: string extensionAlias)');
    }
  });

  it('reads an order that reaches unknown Rspack defaults as unreadable', () => {
    const extending = webpackExtensionPolicy(
      'rspack',
      { extensions: ['.custom', '...'] },
      '2.0.0'
    );
    const complete = webpackExtensionPolicy(
      'rspack',
      { extensions: ['.custom'] },
      '2.0.0'
    );

    expect(extending.resolverVersion).toBe(
      'built-in (hostOptionUnreadable: rspack@2.0.0 defaults)'
    );
    expect(complete.appended).toEqual(['.custom']);
    expect(complete.resolverVersion).toBe('rspack@2.0.0 captured');
  });
});

// Contract: a host's asset and stylesheet classification is read from its
// own configuration (spec §2.2 A8); without one, the built-in list (Vite's
// known asset types, less svg, and its CSS languages) answers, labelled with
// its reason. Where the host's reading is uncertain, a file is not opaque.
describe('host asset classification', () => {
  it("reads webpack's asset rules and Next's image loader, nested and logical", () => {
    const classified = webpackAssetClassification(
      'next-webpack',
      [
        { test: /\.m?js$/, loader: 'babel-loader' },
        {
          oneOf: [
            { test: /\.(png|svg)$/i, loader: 'next-image-loader' },
            {
              test: { and: [/\.woff2$/, { not: /legacy/ }] },
              type: 'asset/resource',
            },
            '...',
            false,
          ],
        },
      ],
      '5.98.0'
    );

    expect(
      ['a.png', 'a.svg', 'f.woff2', 'legacy/f.woff2', 'a.js', 'a.json'].map(
        (path) => classified.isAsset(path, '')
      )
    ).toEqual([true, true, true, false, false, false]);
    expect(classified.resolverVersion).toBe('next-webpack@5.98.0 captured');
  });

  it("reads esbuild's loader map and Vite's assetsInclude", () => {
    const esbuild = esbuildAssetClassification({
      '.png': 'file',
      '.svg': 'jsx',
    });
    const vite = viteAssetClassification((file) => file.endsWith('.glb'));

    expect([
      esbuild.isAsset('a.png', ''),
      esbuild.isAsset('a.svg', ''),
    ]).toEqual([true, false]);
    expect(
      ['m.glb', 'a.png', 'globals.css', 'x.css.ts'].map((file) =>
        vite.isAsset(file, '')
      )
    ).toEqual([true, false, true, false]);
    expect([
      vite.isAsset('x.js', '?raw'),
      vite.isAsset('x.js', '?foo'),
    ]).toEqual([true, false]);
  });

  it('answers with the built-in list, less svg, where no host classifies', () => {
    const builtIn = builtInAssetClassification(
      'hostOptionUnreadable',
      'rollup'
    );

    expect(
      [
        'a.png',
        'a.jpeg',
        'f.woff2',
        'a.svg',
        'a.json',
        'globals.css',
        'x.css.ts',
      ].map((path) => builtIn.isAsset(path, ''))
    ).toEqual([true, true, true, false, false, true, false]);
    expect(builtIn.resolverVersion).toBe(
      `built-in (hostOptionUnreadable: rollup; ${BUILT_IN_ASSET_SOURCE})`
    );
  });

  it('reads a webpack file as opaque only where every rule that can apply agrees', () => {
    const read = (
      file: string,
      rules: Parameters<typeof webpackAssetClassification>[1]
    ) => webpackAssetClassification('webpack', rules).isAsset(file, '');
    const data = '/app/src/selected.data';

    expect([
      read(data, [
        {
          oneOf: [
            { test: /\.data$/, type: 'javascript/auto' },
            { test: /\.data$/, type: 'asset/resource' },
          ],
        },
      ]),
      read(data, [
        { test: /\.data$/, type: 'asset/resource' },
        { test: /\.data$/, type: 'javascript/auto' },
      ]),
      read(data, [
        { test: /\.data$/, exclude: /selected/, type: 'asset/resource' },
      ]),
      read(data, [
        {
          include: '/elsewhere',
          rules: [{ test: /\.data$/, type: 'asset/resource' }],
        },
      ]),
      read(data, [
        { test: /\.data$/, type: 'asset/resource' },
        { test: /\.data$/, issuer: /\.css$/, type: 'javascript/auto' },
      ]),
      read(data, [
        { test: /\.data$/, resourceQuery: /raw/, type: 'asset/source' },
      ]),
      read(data, [
        { test: /\.data$/, include: '/app/src', type: 'asset/resource' },
      ]),
    ]).toEqual([false, false, false, false, false, false, true]);

    const nextCss = {
      oneOf: [
        {
          test: /\.css$/,
          issuer: /_document/,
          use: { loader: 'error-loader' },
        },
        {
          test: /\.css$/,
          issuerLayer: 'app',
          use: [
            '/n/loaders/next-flight-css-loader.js',
            { loader: '/n/loaders/css-loader/src' },
          ],
        },
      ],
    };
    expect([
      read('/app/globals.css', [nextCss]),
      read('/app/globals.css', [
        nextCss,
        { test: /\.css$/, use: 'postcss-loader' },
      ]),
    ]).toEqual([true, false]);
  });

  it("reads esbuild's loader for a file by its longest extension, exact case", () => {
    const esbuild = esbuildAssetClassification({
      '.png': 'file',
      '.PNG': 'js',
      '.bin': 'copy',
      '.data.js': 'file',
    });

    expect(
      [
        'a.png',
        'a.PNG',
        'a.bin',
        'x.data.js',
        'x.js',
        'globals.css',
        'x.css.ts',
        'm.module.css',
      ].map((file) => esbuild.isAsset(file, ''))
    ).toEqual([true, false, false, true, false, true, false, true]);
  });

  it('probes the file a query names, and reads it with the query', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-query-')));
    writeFileSync(join(root, 'selected.js'), 'export {};\n');
    writeFileSync(join(root, 'Button.tsx'), 'export {};\n');
    const read = (base: string) =>
      hostCandidate(root, base, new Set(['Button.tsx']), undefined, {
        isAsset: builtInAssetClassification('noHost').isAsset,
      });
    const readings = [
      'selected.js?foo',
      'selected.js?raw',
      'Button?foo',
      'Button?url',
    ].map(read);
    rmSync(root, { recursive: true, force: true });

    expect(readings).toEqual([
      {
        candidate: 'selected.js?foo',
        actual: null,
        analysedAs: null,
        reading: 'unanalysed',
      },
      {
        candidate: 'selected.js?raw',
        actual: null,
        analysedAs: null,
        reading: 'asset',
      },
      { candidate: 'Button.tsx?foo', actual: null, analysedAs: 'Button.tsx' },
      {
        candidate: 'Button.tsx?url',
        actual: null,
        analysedAs: null,
        reading: 'asset',
      },
    ]);
  });
});
