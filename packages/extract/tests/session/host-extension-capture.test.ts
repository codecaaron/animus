import { describe, expect, it } from 'vitest';

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
