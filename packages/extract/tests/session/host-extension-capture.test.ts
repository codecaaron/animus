import { describe, expect, it } from 'vitest';

import { BUILT_IN_ASSET_SOURCE } from '../../pipeline/built-in-asset-types';
import {
  builtInAssetClassification,
  esbuildAssetClassification,
  viteAssetClassification,
  webpackAssetClassification,
} from '../../pipeline/host-assets';
import { webpackExtensionPolicy } from '../../pipeline/host-extensions';

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

// Contract: a host's asset classification is read from its own
// configuration (spec §2.2 A8); without one, the built-in list (Vite's known
// asset types, less svg) answers, labelled with its reason.
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
        (path) => classified.isAsset(path)
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

    expect([esbuild.isAsset('a.png'), esbuild.isAsset('a.svg')]).toEqual([
      true,
      false,
    ]);
    expect([vite.isAsset('m.glb'), vite.isAsset('a.png')]).toEqual([
      true,
      false,
    ]);
  });

  it('answers with the built-in list, less svg, where no host classifies', () => {
    const builtIn = builtInAssetClassification(
      'hostOptionUnreadable',
      'rollup'
    );

    expect(
      ['a.png', 'a.jpeg', 'f.woff2', 'a.svg', 'a.json'].map((path) =>
        builtIn.isAsset(path)
      )
    ).toEqual([true, true, true, false, false]);
    expect(builtIn.resolverVersion).toBe(
      `built-in (hostOptionUnreadable: rollup; ${BUILT_IN_ASSET_SOURCE})`
    );
  });
});
