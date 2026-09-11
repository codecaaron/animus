import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as bootstrapEntry from '../src/bootstrap';

const packageRoot = resolve(fileURLToPath(import.meta.url), '../..');
const sourceRoot = resolve(packageRoot, 'src');
const bootstrapRoot = resolve(sourceRoot, 'bootstrap');

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is JsonObject {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isJsonString(value: JsonValue): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

function readExportMap(
  manifestPath: string
): Record<string, Record<string, string>> {
  const candidate: JsonValue = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!isJsonObject(candidate) || !isJsonObject(candidate.exports)) {
    throw new TypeError(`${manifestPath} declares no exports object`);
  }
  const declared = candidate.exports;
  for (const [subpath, conditions] of Object.entries(declared)) {
    if (
      !isJsonObject(conditions) ||
      !Object.values(conditions).every(isJsonString)
    ) {
      throw new TypeError(
        `${manifestPath} exports['${subpath}'] is not a condition map of strings`
      );
    }
  }
  // SAFETY: the loop above proved every entry is an object of string values;
  // returning the parsed object keeps the declared key order observable.
  return declared as JsonObject & Record<string, Record<string, string>>;
}

const packageExports = readExportMap(resolve(packageRoot, 'package.json'));

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

const SPECIFIER_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function reachableFiles(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined) break;
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
    const groups = packageExports['./groups'];
    const bootstrap = packageExports['./bootstrap'];

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
    expect(bootstrapEntry.createAppearanceBootstrap).toBeTypeOf('function');
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
