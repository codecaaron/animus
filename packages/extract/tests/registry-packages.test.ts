import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { foreignPackages, packageReaches } from '../pipeline/registry-packages';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

// Contract: a registry package's decision is kept across analyses only
// while every manifest it read and every lockfile above the root is
// unchanged; an edited manifest is read again.
test('a registry decision is read again once a manifest it read changes', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-registry-')));
  roots.push(root);
  interface Manifest {
    name: string;
    version?: string;
    dependencies?: Record<string, string>;
  }
  const write = (path: string, value: Manifest | Record<string, never>) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  };
  write('package.json', { name: 'app', dependencies: { reg: '^1.0.0' } });
  write('node_modules/reg/package.json', { name: 'reg', version: '1.0.0' });
  write('packages/local/package.json', { name: 'local' });
  write('packages/local/src/Card.ts', {});
  symlinkSync(
    join(root, 'packages/local'),
    join(root, 'node_modules/local'),
    'dir'
  );
  const listed = [
    { importer: 'src/App.ts', specifier: 'reg', identity: 'reg' },
  ];
  const analysed = new Set(['src/App.ts', 'packages/local/src/Card.ts']);
  const read = () => packageReaches(root, listed, analysed);

  expect(read()).toEqual([{ identity: 'reg', reaches: [] }]);
  expect(read()).toEqual([{ identity: 'reg', reaches: [] }]);

  write('node_modules/reg/package.json', {
    name: 'reg',
    version: '1.0.0',
    dependencies: { local: 'workspace:*' },
  });
  expect(read()).toEqual([
    { identity: 'reg', reaches: ['packages/local/src/Card.ts'] },
  ]);

  // A tarball's files share one fixed modification time: a manifest swapped
  // for one of the same size, under the same time, is still read again.
  const manifest = join(root, 'node_modules/reg/package.json');
  const tarballTime = new Date('1985-10-26T08:15:00Z');
  utimesSync(manifest, tarballTime, tarballTime);
  expect(read()).toEqual([
    { identity: 'reg', reaches: ['packages/local/src/Card.ts'] },
  ]);
  const swapped = readFileSync(manifest, 'utf-8').replace(
    '"local":"workspace:*"',
    '"lokal":"workspace:*"'
  );
  writeFileSync(manifest, swapped);
  utimesSync(manifest, tarballTime, tarballTime);
  expect(read()).toEqual([{ identity: 'reg', reaches: [] }]);
});

// Contract: a package is foreign to Animus unless it, or a package its
// dependencies and peers name at any depth, is an Animus package; the answer
// is read again once a manifest it read changes.
test('a package is foreign to Animus until it or a package it names at any depth is an Animus package', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-depends-')));
  roots.push(root);
  interface Manifest {
    name: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  }
  const write = (path: string, value: Manifest) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  };
  write('package.json', { name: 'app' });
  write('node_modules/chakra/package.json', {
    name: 'chakra',
    dependencies: { emotion: '^11.0.0' },
  });
  write('node_modules/emotion/package.json', { name: 'emotion' });
  write('node_modules/substrate/package.json', {
    name: 'substrate',
    peerDependencies: { '@animus-ui/system': '^0.1.0' },
  });
  write('node_modules/@animus-ui/properties/package.json', {
    name: '@animus-ui/properties',
  });
  write('node_modules/wrapper/package.json', {
    name: 'wrapper',
    dependencies: { substrate: '^1.0.0' },
  });
  // A workspace package, linked into node_modules.
  write('packages/ui-kit/package.json', {
    name: 'ui-kit',
    dependencies: { chakra: '^3.0.0' },
  });
  symlinkSync(
    join(root, 'packages/ui-kit'),
    join(root, 'node_modules/ui-kit'),
    'dir'
  );
  const foreign = () =>
    foreignPackages(
      ['ui-kit', 'chakra', 'substrate', 'wrapper', '@animus-ui/properties'].map(
        (name) => ({
          name,
          roots: [realpathSync(join(root, 'node_modules', name))],
        })
      ),
      new Set()
    );

  expect(foreign()).toEqual(['chakra', 'ui-kit']);

  // A package is foreign only where every instance its importers reach is.
  write('packages/nested/node_modules/chakra/package.json', {
    name: 'chakra',
    peerDependencies: { '@animus-ui/system': '^0.1.0' },
  });
  const instances = [
    realpathSync(join(root, 'node_modules/chakra')),
    realpathSync(join(root, 'packages/nested/node_modules/chakra')),
  ];
  expect(
    foreignPackages([{ name: 'chakra', roots: instances }], new Set())
  ).toEqual([]);
  expect(
    foreignPackages([{ name: 'chakra', roots: instances.reverse() }], new Set())
  ).toEqual([]);

  // Retargeting a symlink a walk followed, to a package with the same
  // manifest bytes, is read again.
  write('linked/a/emotion/package.json', { name: 'emotion' });
  write('linked/b/emotion/package.json', { name: 'emotion' });
  write('linked/b/emotion/node_modules/substrate-peer/package.json', {
    name: 'substrate-peer',
    peerDependencies: { '@animus-ui/system': '^0.1.0' },
  });
  rmSync(join(root, 'node_modules/emotion'), { recursive: true });
  symlinkSync(
    join(root, 'linked/a/emotion'),
    join(root, 'node_modules/emotion'),
    'dir'
  );
  expect(foreign()).toEqual(['chakra', 'ui-kit']);
  write('linked/b/emotion/package.json', {
    name: 'emotion',
    dependencies: { 'substrate-peer': '^1.0.0' },
  });
  write('linked/a/emotion/package.json', {
    name: 'emotion',
    dependencies: { 'substrate-peer': '^1.0.0' },
  });
  expect(foreign()).toEqual(['chakra', 'ui-kit']);
  rmSync(join(root, 'node_modules/emotion'));
  symlinkSync(
    join(root, 'linked/b/emotion'),
    join(root, 'node_modules/emotion'),
    'dir'
  );
  expect(foreign()).toEqual([]);
});
