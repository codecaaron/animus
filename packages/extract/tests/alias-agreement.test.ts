import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  aliasesAgreeByConstruction,
  compareAliases,
} from '../pipeline/alias-agreement';
import { buildPathAliasesJson } from '../pipeline/path-aliases';

describe('compareAliases', () => {
  // Contract: an alias the host resolves to another file than the analysis
  // does is reported, and an agreeing one is not (spec §2.2 A7).
  test('reports an alias the host resolves elsewhere', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-alias-agreement-'));
    for (const file of ['src/ui/Button.tsx', 'src/alt/Button.tsx']) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'export const Button = 1;\n');
    }
    const source =
      "import { Button } from '@ui/Button';\nimport { x } from './local';\n";
    const fileEntries = [
      { path: 'src/App.tsx', source },
      { path: 'src/ui/Button.tsx', source: 'export const Button = 1;\n' },
    ];
    const compare = (host: string | null) =>
      compareAliases({
        rootDir: root,
        fileEntries,
        pathAliasesJson:
          buildPathAliasesJson(
            [{ pattern: '@ui', target: join(root, 'src/ui'), kind: 'prefix' }],
            root
          )?.json ?? null,
        order: undefined,
        readings: {},
        // Only the aliased specifier is asked about.
        moduleSpecifiers: () =>
          JSON.stringify({
            files: { 'src/App.tsx': ['@ui/Button', './local'] },
          }),
        resolve: async (specifier) => {
          expect(specifier).toBe('@ui/Button');
          return host;
        },
      }).then((found) => found.map(({ file, code }) => `${file} ${code}`));
    try {
      expect({
        agrees: await compare(join(root, 'src/ui/Button.tsx?v=1')),
        elsewhere: await compare(join(root, 'src/alt/Button.tsx')),
        nothing: await compare(null),
      }).toEqual({
        agrees: [],
        elsewhere: ['src/App.tsx animus.discovery.alias-mismatch'],
        nothing: ['src/App.tsx animus.discovery.alias-mismatch'],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('aliasesAgreeByConstruction', () => {
  // Contract: a host that reads tsconfig paths itself (Turbopack) agrees by
  // construction only when it reads the session's tsconfig and no alias of
  // its own overlaps a pattern the session reads (spec §2.2 A7).
  test('agrees only on the same tsconfig with no overlapping alias', () => {
    const agrees = (hostTsconfigPath: string | undefined, keys: string[]) =>
      aliasesAgreeByConstruction({
        rootDir: '/app',
        hostTsconfigPath,
        hostAliasKeys: keys,
        sessionPatterns: ['@', '~lib/x.ts'],
      });
    expect({
      defaults: agrees(undefined, []),
      sameFile: agrees('./tsconfig.json', ['lodash']),
      otherFile: agrees('tsconfig.app.json', []),
      overlapping: agrees(undefined, ['@/components/*']),
      exactOverlap: agrees(undefined, ['~lib/x.ts']),
    }).toEqual({
      defaults: true,
      sameFile: true,
      otherFile: false,
      overlapping: false,
      exactOverlap: false,
    });
  });
});
