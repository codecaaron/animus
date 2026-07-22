import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { buildPathAliasesJson } from '../pipeline/path-aliases';
import { readTsconfigAliasPairs } from '../pipeline/tsconfig-paths';

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-tsconfig-paths-'));
  tempRoots.push(root);
  return root;
}

function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('readTsconfigAliasPairs', () => {
  test('wildcard paths become prefix pairs resolved against baseUrl', () => {
    const root = makeRoot();
    write(
      root,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
      })
    );

    expect(readTsconfigAliasPairs(root)).toEqual([
      { pattern: '@', target: resolve(root, 'src'), kind: 'prefix' },
    ]);
  });

  test('tolerates JSONC comments and trailing commas', () => {
    const root = makeRoot();
    write(
      root,
      'tsconfig.json',
      [
        '{',
        '  // project config',
        '  "compilerOptions": {',
        '    /* block */ "baseUrl": ".",',
        '    "paths": { "@/*": ["./src/*"], },',
        '  },',
        '}',
      ].join('\n')
    );

    expect(readTsconfigAliasPairs(root)).toHaveLength(1);
  });

  test('follows extends chains; nearest paths wins wholesale', () => {
    const root = makeRoot();
    write(
      root,
      'tsconfig.base.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@base/*': ['./base/*'], '@shared/*': ['./shared/*'] },
        },
      })
    );
    write(
      root,
      'tsconfig.json',
      JSON.stringify({
        extends: './tsconfig.base.json',
        compilerOptions: { paths: { '@app/*': ['./app/*'] } },
      })
    );

    // Child paths replace the parent's entirely (TS semantics), and the
    // parent's baseUrl still applies.
    expect(readTsconfigAliasPairs(root)).toEqual([
      { pattern: '@app', target: resolve(root, 'app'), kind: 'prefix' },
    ]);
  });

  test('inherits paths from a two-deep extends chain', () => {
    const root = makeRoot();
    write(
      root,
      'tsconfig.a.json',
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@x/*': ['./x/*'] } },
      })
    );
    write(root, 'tsconfig.b.json', JSON.stringify({ extends: './tsconfig.a.json' }));
    write(root, 'tsconfig.json', JSON.stringify({ extends: './tsconfig.b.json' }));

    expect(readTsconfigAliasPairs(root)).toEqual([
      { pattern: '@x', target: resolve(root, 'x'), kind: 'prefix' },
    ]);
  });

  test('paths without baseUrl resolve against the declaring config directory', () => {
    const root = makeRoot();
    write(
      root,
      'config/tsconfig.shared.json',
      JSON.stringify({ compilerOptions: { paths: { '@lib/*': ['../lib/*'] } } })
    );
    write(
      root,
      'tsconfig.json',
      JSON.stringify({ extends: './config/tsconfig.shared.json' })
    );

    expect(readTsconfigAliasPairs(root)).toEqual([
      { pattern: '@lib', target: resolve(root, 'lib'), kind: 'prefix' },
    ]);
  });

  test('non-wildcard patterns become exact pairs; bare * is skipped', () => {
    const root = makeRoot();
    write(
      root,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@sys': ['./src/system.ts'],
            '*': ['./anything/*'],
          },
        },
      })
    );

    expect(readTsconfigAliasPairs(root)).toEqual([
      { pattern: '@sys', target: resolve(root, 'src/system.ts'), kind: 'exact' },
    ]);
  });

  test('missing tsconfig, unreadable parent, and extends cycles are tolerated', () => {
    const empty = makeRoot();
    expect(readTsconfigAliasPairs(empty)).toEqual([]);

    const root = makeRoot();
    write(root, 'tsconfig.json', JSON.stringify({ extends: './missing.json' }));
    expect(readTsconfigAliasPairs(root)).toEqual([]);

    const cyclic = makeRoot();
    write(cyclic, 'tsconfig.json', JSON.stringify({ extends: './tsconfig.json' }));
    expect(readTsconfigAliasPairs(cyclic)).toEqual([]);
  });

  test('pairs feed buildPathAliasesJson into the shared wire contract', () => {
    const root = makeRoot();
    write(
      root,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
      })
    );

    const built = buildPathAliasesJson(readTsconfigAliasPairs(root), root);
    expect(JSON.parse(built!.json)).toEqual({
      aliases: [{ pattern: '@/', replacement: 'src/', type: 'prefix' }],
    });
  });
});
