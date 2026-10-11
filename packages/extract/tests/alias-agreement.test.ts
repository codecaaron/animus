import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  AliasAgreementCache,
  compareAliases,
} from '../pipeline/alias-agreement';
import { buildPathAliasesJson } from '../pipeline/path-aliases';

describe('compareAliases', () => {
  // Contract: an alias the host resolves to another physical file than the
  // analysis does is reported, and an agreeing one is not; a request the
  // host's resolver fails on is unavailable, never a failure (spec §2.2 A7).
  test('reports an alias the host resolves elsewhere', async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'animus-alias-agreement-'))
    );
    for (const file of ['src/ui/Button.tsx', 'src/alt/Button.tsx']) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'export const Button = 1;\n');
    }
    symlinkSync(join(root, 'src/ui'), join(root, 'linked'));
    const caseInsensitive = existsSync(join(root, 'SRC/UI/BUTTON.TSX'));
    const entry = (source: string, hash = source) => [
      { path: 'src/App.tsx', source, hash },
      {
        path: 'src/ui/Button.tsx',
        source: 'export const Button = 1;\n',
        hash: 'b',
      },
    ];
    const pathAliasesJson =
      buildPathAliasesJson(
        [{ pattern: '@ui', target: join(root, 'src/ui'), kind: 'prefix' }],
        root
      )?.json ?? null;
    const resolved: string[] = [];
    const compare = (
      host: (specifier: string) => string | null,
      specifiers = ['@ui/Button', './local'],
      fileEntries = entry('a'),
      cache = new AliasAgreementCache()
    ) =>
      compareAliases({
        rootDir: root,
        fileEntries,
        pathAliasesJson,
        order: undefined,
        readings: {},
        // The parser's decoded specifiers, whatever the source spells.
        moduleSpecifiers: () =>
          JSON.stringify({ files: { 'src/App.tsx': specifiers } }),
        resolve: async (specifier) => {
          resolved.push(specifier);
          return host(specifier);
        },
        cache,
      }).then(({ findings, unavailable }) => ({
        found: findings.map(({ file, code }) => `${file} ${code}`),
        unavailable,
      }));
    const mismatch = {
      found: ['src/App.tsx animus.discovery.alias-mismatch'],
      unavailable: 0,
    };
    const none = { found: [], unavailable: 0 };
    try {
      expect({
        agrees: await compare(() => join(root, 'src/ui/Button.tsx?v=1')),
        elsewhere: await compare(() => join(root, 'src/alt/Button.tsx')),
        nothing: await compare(() => null),
        linked: await compare(() => join(root, 'linked/Button.tsx')),
        devServer: await compare(
          () => `/@fs${join(root, 'src/ui/Button.tsx')}`
        ),
        caseVariant: caseInsensitive
          ? await compare(() => join(root, 'src/UI/Button.tsx'))
          : none,
        // A resolver that fails on one request leaves that request
        // unavailable and the others compared.
        failing: await compare(
          (specifier) => {
            if (specifier === '@ui/Blocked') throw new Error('blocked');
            return join(root, 'src/alt/Button.tsx');
          },
          ['@ui/Blocked', '@ui/Button']
        ),
        // `'@ui\\u002fButton'` in the source: the decoded specifier counts.
        escaped: await compare(
          () => join(root, 'src/alt/Button.tsx'),
          ['@ui/Button'],
          entry("import { Button } from '@ui\\u002fButton';\n")
        ),
      }).toEqual({
        agrees: none,
        elsewhere: mismatch,
        nothing: mismatch,
        linked: none,
        devServer: none,
        caseVariant: none,
        failing: { ...mismatch, unavailable: 1 },
        escaped: mismatch,
      });
      expect(resolved.every((specifier) => specifier.startsWith('@ui'))).toBe(
        true
      );
      // An unchanged file is not resolved again; a changed alias set
      // compares every file again.
      const cache = new AliasAgreementCache();
      const host = () => join(root, 'src/alt/Button.tsx');
      await compare(host, ['@ui/Button'], entry('a'), cache);
      resolved.length = 0;
      const again = await compare(host, ['@ui/Button'], entry('a'), cache);
      expect({ again, resolvedAgain: resolved.length }).toEqual({
        again: mismatch,
        resolvedAgain: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('package instances', () => {
  // Contract: an import the host resolves, from its importer, into another
  // instance of a discovered package than the one read is reported (spec
  // §2.2 A4, SA1): an error where that instance's file is not analysed, a
  // warning where a source redirect serves the instance read instead; the
  // instance read, or an analysed file, is no finding.
  test('an importer resolving another instance is reported', async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'animus-package-instances-'))
    );
    const read = join(root, 'node_modules', 'kit');
    const nested = join(root, 'src', 'node_modules', 'kit');
    for (const dir of [read, nested]) {
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), '{"name":"kit"}');
      writeFileSync(join(dir, 'dist', 'index.js'), 'export const Box = 1;\n');
    }
    const compare = (resolved: string, redirected: string[] = []) =>
      compareAliases({
        rootDir: root,
        fileEntries: [
          { path: 'src/App.tsx', source: 'a', hash: 'a' },
          { path: 'node_modules/kit/dist/index.js', source: 'b', hash: 'b' },
        ],
        pathAliasesJson: null,
        order: undefined,
        readings: {},
        moduleSpecifiers: () =>
          JSON.stringify({ files: { 'src/App.tsx': ['kit', './local'] } }),
        resolve: async (specifier) => (specifier === 'kit' ? resolved : null),
        cache: new AliasAgreementCache(),
        packages: { roots: { kit: read }, redirected: new Set(redirected) },
      }).then(({ findings }) =>
        findings.map(({ file, code, kind }) => `${file} ${code} ${kind}`)
      );
    try {
      expect({
        read: await compare(join(read, 'dist', 'index.js')),
        unread: await compare(join(nested, 'dist', 'index.js')),
        replaced: await compare(join(nested, 'dist', 'index.js'), ['kit']),
      }).toEqual({
        read: [],
        unread: ['src/App.tsx animus.discovery.unread-package-instance error'],
        replaced: [
          'src/App.tsx animus.discovery.replaced-package-instance warn',
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
