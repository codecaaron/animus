import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, expect, test } from 'vitest';

import { disjointPackages } from '../pipeline/disjoint-packages';

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/** The manifest fields the closure reads. */
interface Manifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: boolean }>;
}

function installed(app: string, name: string, manifest: Manifest): void {
  write(
    join(app, 'node_modules', name, 'package.json'),
    JSON.stringify({ name, ...manifest })
  );
}

/** An outside package is disjoint only when every package its installed
 *  closure reaches is readable, installed under node_modules, and none of
 *  the analysed ones: a linked package, an unreadable manifest, a missing
 *  required dependency and a peer that is an analysed package each keep
 *  it, and what reaches it, from the list. A missing optional dependency
 *  or optional peer is not installed, so it changes nothing. */
test('an outside package is disjoint only when its whole installed closure is readable and reaches nothing analysed', () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-disjoint-')));
  const app = join(root, 'app');
  const rows: Array<[string, Manifest, boolean]> = [
    ['plain', {}, true],
    ['uses-plain', { dependencies: { plain: '1' } }, true],
    ['broken', {}, false],
    ['uses-broken', { dependencies: { broken: '1' } }, false],
    ['uses-linked', { dependencies: { linked: '1' } }, false],
    ['needs-missing', { dependencies: { absent: '1' } }, false],
    ['optional-missing', { optionalDependencies: { absent: '1' } }, true],
    [
      'optional-peer-missing',
      {
        peerDependencies: { absent: '1' },
        peerDependenciesMeta: { absent: { optional: true } },
      },
      true,
    ],
    ['peer-of-analysed', { peerDependencies: { '@app/kit': '1' } }, false],
    ['reaches-analysed', { dependencies: { 'peer-of-analysed': '1' } }, false],
  ];
  for (const [name, manifest] of rows) installed(app, name, manifest);
  write(join(app, 'node_modules', 'broken', 'package.json'), '{ not json');
  // A workspace package linked into node_modules: its real path lies
  // outside node_modules, so it may import any workspace file.
  write(
    join(root, 'workspace', 'linked', 'package.json'),
    JSON.stringify({ name: 'linked' })
  );
  symlinkSync(
    join(root, 'workspace', 'linked'),
    join(app, 'node_modules', 'linked')
  );
  write(
    join(app, 'package.json'),
    JSON.stringify({
      name: 'app',
      dependencies: Object.fromEntries(
        [...rows.map(([name]) => name), 'linked'].map((name) => [name, '1'])
      ),
    })
  );

  const disjoint = disjointPackages([app], new Set(['app', '@app/kit']));

  for (const [name, , expected] of rows) {
    expect(disjoint.includes(name), name).toBe(expected);
  }
  expect(disjoint.includes('linked')).toBe(false);
});

/** A cycle is judged as a whole: a package whose cycle reaches an
 *  analysed package is not disjoint, whichever member is met first. */
test('a dependency cycle that reaches an analysed package lists none of its members', () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-disjoint-')));
  const app = join(root, 'app');
  installed(app, 'a', { dependencies: { b: '1', app: '1' } });
  installed(app, 'b', { dependencies: { a: '1' } });
  installed(app, 'app', {});
  write(
    join(app, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: { a: '1', b: '1' } })
  );

  expect(disjointPackages([app], new Set(['app']))).toEqual([]);
});
