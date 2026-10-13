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

import { registryPackages } from '../pipeline/registry-packages';

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
  const read = () => registryPackages(root, listed, analysed);

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
