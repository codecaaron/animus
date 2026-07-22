import { describe, expect, test } from 'vitest';

import { buildPathAliasesJson } from '../pipeline/path-aliases';

const ROOT = '/proj';

describe('buildPathAliasesJson', () => {
  test('returns null when no pairs survive', () => {
    expect(buildPathAliasesJson([], ROOT)).toBeNull();
  });

  test('strips rootDir, classifies exact vs prefix, and normalizes slashes', () => {
    const built = buildPathAliasesJson(
      [
        { pattern: '@components', target: '/proj/src/components' },
        { pattern: '@sys', target: '/proj/src/system.ts' },
        { pattern: '~external', target: '/elsewhere/lib' },
      ],
      ROOT
    );
    expect(built?.count).toBe(3);
    expect(JSON.parse(built!.json)).toEqual({
      aliases: [
        {
          pattern: '@components/',
          replacement: 'src/components/',
          type: 'prefix',
        },
        { pattern: '~external/', replacement: '/elsewhere/lib/', type: 'prefix' },
        { pattern: '@sys', replacement: 'src/system.ts', type: 'exact' },
      ],
    });
  });

  test('sorts longest pattern first for matching priority', () => {
    const built = buildPathAliasesJson(
      [
        { pattern: '@a', target: '/proj/a' },
        { pattern: '@a/deep', target: '/proj/a/deep' },
      ],
      ROOT
    );
    const patterns = JSON.parse(built!.json).aliases.map(
      (e: { pattern: string }) => e.pattern
    );
    expect(patterns).toEqual(['@a/deep/', '@a/']);
  });

  test('kind: prefix forces prefix classification for file-like targets', () => {
    const built = buildPathAliasesJson(
      [{ pattern: 'lib', target: '/proj/src/lib.ts', kind: 'prefix' }],
      ROOT
    );
    expect(JSON.parse(built!.json)).toEqual({
      aliases: [{ pattern: 'lib/', replacement: 'src/lib.ts/', type: 'prefix' }],
    });
  });
});
