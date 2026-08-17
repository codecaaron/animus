import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  resolveAssetFile,
  resolveThroughPathAliases,
} from '../pipeline/resolve-asset';

/**
 * `pathAliasesJson` has exactly one encoder — `buildPathAliasesJson`, declared
 * "the single authoritative encoder of the wire format" — and every plugin
 * assignment routes through it. The old `catch { aliases = [] }` turned a
 * broken encoder into "no aliases configured", disabling ALL alias-based
 * `asset()` resolution and emitting dangling `url()`s instead of an error, and
 * it MEMOIZED that empty table against the same string for the process
 * lifetime.
 */
describe('resolveThroughPathAliases — internal wire', () => {
  it('throws on malformed alias JSON, naming the wire and the cause', () => {
    expect(() =>
      resolveThroughPathAliases('@fonts/inter.woff2', '/root', 'not json')
    ).toThrow(/pathAliasesJson/);
    expect(() =>
      resolveThroughPathAliases('@fonts/inter.woff2', '/root', 'not json')
    ).toThrow(/SyntaxError/);
  });

  it('keeps throwing on repeat calls — no failure is memoized', () => {
    const malformed = '{"aliases": [';
    expect(() =>
      resolveThroughPathAliases('@fonts/a.woff2', '/root', malformed)
    ).toThrow();
    expect(() =>
      resolveThroughPathAliases('@fonts/b.woff2', '/root', malformed)
    ).toThrow();
  });
});

describe('resolveAssetFile', () => {
  it('finds a physical asset when package.json is hidden by exports', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-resolve-asset-'));
    const packageRoot = join(root, 'node_modules', '@acme', 'tokens');
    const entry = join(packageRoot, 'dist', 'index.js');
    const asset = join(packageRoot, 'fonts', 'inter.woff2');
    mkdirSync(join(packageRoot, 'dist'), { recursive: true });
    mkdirSync(join(packageRoot, 'fonts'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@acme/tokens',
        exports: { '.': './dist/index.js' },
      })
    );
    writeFileSync(entry, 'module.exports = {};');
    writeFileSync(asset, 'font');

    try {
      const resolved = resolveAssetFile('@acme/tokens/fonts/inter.woff2', root);
      expect(resolved).not.toBeNull();
      expect(realpathSync(resolved!)).toBe(realpathSync(asset));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds an asset in a package that exports only a subpath', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-resolve-asset-'));
    const packageRoot = join(root, 'node_modules', '@acme', 'tokens');
    const definition = join(packageRoot, 'dist', 'definition.js');
    const asset = join(packageRoot, 'fonts', 'inter.woff2');
    mkdirSync(join(packageRoot, 'dist'), { recursive: true });
    mkdirSync(join(packageRoot, 'fonts'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@acme/tokens',
        exports: { './definition': './dist/definition.js' },
      })
    );
    writeFileSync(definition, 'module.exports = {};');
    writeFileSync(asset, 'font');

    try {
      const resolved = resolveAssetFile('@acme/tokens/fonts/inter.woff2', root);
      expect(resolved).not.toBeNull();
      expect(realpathSync(resolved!)).toBe(realpathSync(asset));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
