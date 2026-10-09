import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const CLEAR = join(ROOT, 'scripts/verify/clear-consumer-output.ts');
const BUILD_CONSUMER = join(ROOT, 'scripts/verify/build-consumer.sh');
const temporaryDirectories: string[] = [];

const trackedFiles = [
  'app/package.json',
  'app/src/page.tsx',
  // Output names below the build root are source, not output.
  'app/src/build/index.ts',
  'app/src/dist.ts',
  'app/variant/next.config.ts',
];
const appOutput = [
  'app/.animus/styles.css',
  'app/.next/server/page.js',
  'app/build/server.js',
  'app/dist/index.js',
  'app/tsconfig.tsbuildinfo',
];
const variantOutput = ['app/variant/.next/server/page.js'];
const keptUntracked = [
  'app/node_modules/pkg/dist/index.js',
  'app/node_modules/.cache/entry',
  'app/.receipts/build.json',
];

function writeFiles(root: string, paths: readonly string[]): void {
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${path}\n`);
  }
}

function git(repository: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'animus-clear-consumer-'));
  temporaryDirectories.push(directory);
  return directory;
}

function consumerRepository(): string {
  const repository = temporaryDirectory();
  git(repository, ['init', '--quiet']);
  writeFiles(repository, trackedFiles);
  writeFileSync(
    join(repository, 'app/package.json'),
    '{ "name": "animus-clear-consumer-fixture" }\n'
  );
  git(repository, ['add', '--', ...trackedFiles]);
  writeFiles(repository, [...appOutput, ...variantOutput, ...keptUntracked]);
  return repository;
}

function existing(root: string, paths: readonly string[]): string[] {
  return paths.filter((path) => existsSync(join(root, path)));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('clear-consumer-output', () => {
  it('removes only the known build output of the directory it is given', () => {
    const repository = consumerRepository();

    const result = spawnSync('bun', [CLEAR, 'app'], {
      cwd: repository,
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(existing(repository, appOutput)).toEqual([]);
    expect(existing(repository, trackedFiles)).toEqual(trackedFiles);
    expect(existing(repository, variantOutput)).toEqual(variantOutput);
    expect(existing(repository, keptUntracked)).toEqual(keptUntracked);
  });

  it('removes nothing when git tracks a file inside build output', () => {
    const repository = consumerRepository();
    writeFiles(repository, ['app/dist/committed.js']);
    git(repository, ['add', '--force', '--', 'app/dist/committed.js']);

    const result = spawnSync('bun', [CLEAR, 'app'], {
      cwd: repository,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dist/committed.js');
    expect(existing(repository, appOutput)).toEqual(appOutput);
  });

  it('succeeds without output to clear', () => {
    const directory = temporaryDirectory();
    writeFiles(directory, trackedFiles);

    const result = spawnSync('bun', [CLEAR, 'app'], {
      cwd: directory,
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
  });
});

describe('build-consumer', () => {
  // The fixture is no workspace package, so each build stops at its
  // prerequisites; the stale output must already be gone by then.
  it('clears the consumer before checking prerequisites', () => {
    const repository = consumerRepository();

    const result = spawnSync('bash', [BUILD_CONSUMER], {
      cwd: join(repository, 'app'),
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(existing(repository, appOutput)).toEqual([]);
    expect(existing(repository, variantOutput)).toEqual(variantOutput);
  });

  it('clears only the build root it is given', () => {
    const repository = consumerRepository();

    const result = spawnSync(
      'bash',
      [BUILD_CONSUMER, 'build:variant', 'variant'],
      {
        cwd: join(repository, 'app'),
        encoding: 'utf8',
      }
    );

    expect(result.status).not.toBe(0);
    expect(existing(repository, variantOutput)).toEqual([]);
    expect(existing(repository, appOutput)).toEqual(appOutput);
  });
});
