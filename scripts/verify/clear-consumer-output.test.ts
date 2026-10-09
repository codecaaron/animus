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
const ignoredOutput = [
  '.animus/',
  '.next/',
  'build/',
  'dist/',
  'tsconfig.tsbuildinfo',
  'node_modules/',
  '.receipts/',
];
// The `ERROR: <what>. Run: <fix>` line of scripts/verify/_preconditions.sh.
const ACTIONABLE_ERROR = /^ERROR: .+\. Run: .+$/m;

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

function ignore(repository: string, patterns: readonly string[]): void {
  writeFileSync(join(repository, 'app/.gitignore'), `${patterns.join('\n')}\n`);
}

function sourceRepository(): string {
  const repository = temporaryDirectory();
  git(repository, ['init', '--quiet']);
  writeFiles(repository, trackedFiles);
  writeFileSync(
    join(repository, 'app/package.json'),
    '{ "name": "animus-clear-consumer-fixture" }\n'
  );
  ignore(repository, ignoredOutput);
  git(repository, ['add', '--force', '--', ...trackedFiles, 'app/.gitignore']);
  return repository;
}

function consumerRepository(): string {
  const repository = sourceRepository();
  writeFiles(repository, [...appOutput, ...variantOutput, ...keptUntracked]);
  return repository;
}

function clear(cwd: string, args: readonly string[]) {
  return spawnSync('bun', [CLEAR, ...args], { cwd, encoding: 'utf8' });
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

    const result = clear(repository, ['app']);

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

    const result = clear(repository, ['app']);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(ACTIONABLE_ERROR);
    expect(result.stderr).toContain('dist/committed.js');
    expect(existing(repository, appOutput)).toEqual(appOutput);
  });

  it('removes nothing when git does not ignore a file inside build output', () => {
    const repository = consumerRepository();
    ignore(
      repository,
      ignoredOutput.filter((pattern) => pattern !== '.animus/')
    );

    const result = clear(repository, ['app']);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(ACTIONABLE_ERROR);
    expect(result.stderr).toContain('.animus/styles.css');
    expect(existing(repository, appOutput)).toEqual(appOutput);
  });

  it('matches output names exactly, even on a case-insensitive file system', () => {
    const repository = sourceRepository();
    writeFiles(repository, ['app/Build/index.ts']);
    git(repository, ['add', '--force', '--', 'app/Build/index.ts']);

    const result = clear(repository, ['app']);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(repository, 'app/Build/index.ts'))).toBe(true);
  });

  it('succeeds without output to clear among tracked files', () => {
    const repository = sourceRepository();

    const result = clear(repository, ['app']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    expect(existing(repository, trackedFiles)).toEqual(trackedFiles);
  });

  it('fails naming a build root that does not exist', () => {
    const repository = sourceRepository();

    const result = clear(repository, ['app/missing']);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(ACTIONABLE_ERROR);
    expect(result.stderr).toContain('app/missing');
  });

  it('fails, removing nothing, without git to tell tracked files apart', () => {
    const directory = temporaryDirectory();
    writeFiles(directory, appOutput);

    const result = spawnSync('bun', [CLEAR, 'app'], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(directory) },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(ACTIONABLE_ERROR);
    expect(result.stderr).toContain('git is needed');
    expect(existing(directory, appOutput)).toEqual(appOutput);
  });

  it('prints usage as an actionable error', () => {
    const result = clear(ROOT, []);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(ACTIONABLE_ERROR);
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

  it('takes an absolute build root as it is', () => {
    const repository = consumerRepository();

    const result = spawnSync(
      'bash',
      [BUILD_CONSUMER, 'build:variant', join(repository, 'app/variant')],
      { cwd: join(repository, 'app'), encoding: 'utf8' }
    );

    expect(result.stderr).not.toContain('missing');
    expect(existing(repository, variantOutput)).toEqual([]);
    expect(existing(repository, appOutput)).toEqual(appOutput);
  });
});
