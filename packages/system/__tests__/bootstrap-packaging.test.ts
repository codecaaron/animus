/**
 * Packaging + entry-point isolation tests for the bootstrap generator
 * (increment 02).
 *
 * Covers spec `color-mode-bootstrap` → "Bootstrap entry-point isolation":
 * the generator is reachable ONLY from the dedicated `./bootstrap` subpath, and
 * no import path leads from the component/runtime entries into `src/bootstrap/`
 * (guardrail G3 — extracted component bundles gain no runtime exports).
 *
 * The reachability crawl is local and deliberately OVER-approximating: the
 * specifier regex also matches specifier-shaped text inside comments, which can
 * only add edges, never hide one. (The repo's oxc-backed scanner in
 * `scripts/verify/topology.ts` is not importable here — this package's
 * type-contract tier pins `rootDir` to `packages/system`, so a cross-root
 * import fails `verify:types` with TS6059.)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as bootstrapEntry from '../src/bootstrap';

const packageRoot = resolve(fileURLToPath(import.meta.url), '../..');
const sourceRoot = resolve(packageRoot, 'src');
const bootstrapRoot = resolve(sourceRoot, 'bootstrap');

const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf8')
) as {
  exports: Record<string, Record<string, string>>;
};

/** Resolve a relative specifier to a source file on disk, or null. */
function resolveSourceFile(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier).replace(/\.js$/, '');
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Matches `from '…'`, `import '…'`, and `import('…')` specifiers. */
const SPECIFIER_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** Every source file transitively reachable from `entries` via relative imports. */
function reachableFiles(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const target = resolveSourceFile(file, specifier);
      if (target) queue.push(target);
    }
  }
  return seen;
}

describe('bootstrap packaging', () => {
  it('declares the ./bootstrap subpath mirroring ./groups', () => {
    const groups = manifest.exports['./groups'];
    const bootstrap = manifest.exports['./bootstrap'];

    expect(bootstrap).toBeDefined();
    expect(Object.keys(bootstrap)).toEqual(Object.keys(groups));
    expect(bootstrap.types).toBe('./dist/bootstrap/index.d.ts');
    expect(bootstrap.import).toBe('./dist/bootstrap/index.js');
  });

  it('registers the bootstrap entry in the build config', () => {
    const buildConfig = readFileSync(
      resolve(packageRoot, 'tsdown.config.ts'),
      'utf8'
    );

    expect(buildConfig).toContain('./src/bootstrap/index.ts');
  });

  it('serves createAppearanceBootstrap from the dedicated entry', () => {
    expect(typeof bootstrapEntry.createAppearanceBootstrap).toBe('function');
  });
});

describe('bootstrap entry-point isolation (G3)', () => {
  const componentEntries = [
    resolve(sourceRoot, 'index.ts'),
    resolve(sourceRoot, 'groups/index.ts'),
  ];

  it('component entries never mention bootstrap', () => {
    for (const entry of componentEntries) {
      expect(readFileSync(entry, 'utf8')).not.toContain('bootstrap');
    }
  });

  it('no import path reaches src/bootstrap from the component entries', () => {
    const reachable = reachableFiles(componentEntries);
    const leaks = [...reachable].filter((file) =>
      file.startsWith(`${bootstrapRoot}/`)
    );

    expect(leaks).toEqual([]);
  });

  it('the crawl is non-vacuous (it walks past the entry files)', () => {
    const reachable = reachableFiles(componentEntries);

    expect(reachable.size).toBeGreaterThan(componentEntries.length);
    expect(reachable.has(resolve(sourceRoot, 'Animus.ts'))).toBe(true);
  });

  it('the crawl DOES report src/bootstrap when an edge exists', () => {
    // Control for the ban check above: crawling the bootstrap entry itself must
    // surface a src/bootstrap file, so an empty result there means "no edge",
    // not "crawl blind".
    const reachable = reachableFiles([resolve(bootstrapRoot, 'index.ts')]);
    const inBootstrap = [...reachable].filter((file) =>
      file.startsWith(`${bootstrapRoot}/`)
    );

    expect(inBootstrap).toContain(
      resolve(bootstrapRoot, 'createAppearanceBootstrap.ts')
    );
  });

  it('the bootstrap module does not touch the serialize wire (G5)', () => {
    const generator = readFileSync(
      resolve(bootstrapRoot, 'createAppearanceBootstrap.ts'),
      'utf8'
    );
    const index = readFileSync(resolve(bootstrapRoot, 'index.ts'), 'utf8');

    expect(generator).not.toContain('serialize');
    expect(index).not.toContain('serialize');
  });
});
