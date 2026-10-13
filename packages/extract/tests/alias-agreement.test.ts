import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const native = createRequire(import.meta.url)('../index-v2.js');

import {
  AliasAgreementCache,
  compareAliases,
  packageReadRecord,
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
        // The parser's decoded specifiers, whatever the source spells, with
        // the engine's own expansion of each one a path alias names.
        moduleSpecifiers: (_files, aliasesJson) =>
          JSON.stringify({
            files: { 'src/App.tsx': specifiers },
            bases: {
              'src/App.tsx': JSON.parse(
                native.moduleSpecifiers(
                  JSON.stringify([
                    {
                      path: 'src/App.tsx',
                      source: specifiers
                        .map(
                          (specifier) => `import ${JSON.stringify(specifier)};`
                        )
                        .join('\n'),
                    },
                  ]),
                  aliasesJson
                )
              ).bases['src/App.tsx'],
            },
          }),
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
  // Contract: an import the host resolves, from its importer, to a file
  // extraction never read is reported (spec §2.2 A4, SA1): another
  // instance's file is an error, or a warning where a source redirect
  // serves the instance read instead; an unanalysed file of the instance
  // read that declares builder chains (a compiled subpath) is an error. An
  // analysed file, or one with no chains, is no finding.
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
    // A compiled subpath of the instance read: builder chains, unanalysed.
    writeFileSync(join(read, 'dist', 'other.js'), 'builder\n');
    writeFileSync(join(read, 'dist', 'util.js'), 'helper\n');
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
        packages: packageReadRecord({
          rootDir: root,
          roots: { kit: read },
          redirected: new Set(redirected),
          analysed: ['src/App.tsx', 'node_modules/kit/dist/index.js'],
          rendersBuilder: (file) => file.endsWith('other.js'),
        }),
      }).then(({ findings }) =>
        findings.map(({ file, code, kind }) => `${file} ${code} ${kind}`)
      );
    try {
      expect({
        read: await compare(join(read, 'dist', 'index.js')),
        unread: await compare(join(nested, 'dist', 'index.js')),
        replaced: await compare(join(nested, 'dist', 'index.js'), ['kit']),
        compiledSubpath: await compare(join(read, 'dist', 'other.js')),
        helperSubpath: await compare(join(read, 'dist', 'util.js')),
      }).toEqual({
        read: [],
        unread: ['src/App.tsx animus.discovery.unread-package-instance error'],
        replaced: [
          'src/App.tsx animus.discovery.replaced-package-instance warn',
        ],
        compiledSubpath: [
          'src/App.tsx animus.discovery.unread-package-instance error',
        ],
        helperSubpath: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Contract: a host answer inside the package read is that instance, even
  // under a nested manifest carrying the package's name (`dist/lib`), and so
  // is a dev server's dependency-cache copy of it (`node_modules/.vite/
  // deps`). Neither is reported as another instance, and neither goes quiet:
  // an unredirected one that declares builder chains is still
  // unread-package-instance, an error, since the browser would render it
  // unstyled (the optimizer's copy served past the transform).
  test('a nested manifest or a dependency cache copy is the instance read, still reported', async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'animus-package-identity-'))
    );
    const read = join(root, 'node_modules', 'kit');
    const write = (path: string, source: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), source);
    };
    write('package.json', '{"name":"app"}');
    write('node_modules/kit/package.json', '{"name":"kit"}');
    write('node_modules/kit/dist/index.js', 'export const Box = 1;\n');
    write('node_modules/kit/dist/lib/package.json', '{"name":"kit"}');
    write('node_modules/kit/dist/lib/index.js', 'builder\n');
    write('node_modules/.vite/deps/kit.js', 'builder\n');
    const compare = (resolved: string) =>
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
          JSON.stringify({ files: { 'src/App.tsx': ['kit'] } }),
        resolve: async (specifier) => (specifier === 'kit' ? resolved : null),
        cache: new AliasAgreementCache(),
        packages: packageReadRecord({
          rootDir: root,
          roots: { kit: read },
          redirected: new Set(),
          analysed: ['src/App.tsx', 'node_modules/kit/dist/index.js'],
          rendersBuilder: (file) =>
            file.endsWith(join('lib', 'index.js')) || file.endsWith('kit.js'),
        }),
      }).then(({ findings }) =>
        findings.map(({ code, kind, message }) => ({
          code,
          kind,
          readInstance: message.includes('that it does not analyse'),
          anotherInstance: message.includes('in another instance'),
        }))
      );
    const reported = [
      {
        code: 'animus.discovery.unread-package-instance',
        kind: 'error',
        readInstance: true,
        anotherInstance: false,
      },
    ];
    try {
      expect({
        nestedManifest: await compare(join(read, 'dist', 'lib', 'index.js')),
        dependencyCache: await compare(
          join(root, 'node_modules', '.vite', 'deps', 'kit.js')
        ),
      }).toEqual({ nestedManifest: reported, dependencyCache: reported });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Contract: a copy of the package installed in the instance read's own
  // node_modules is another instance, never folded into it as a nested
  // manifest: the host's answer there is reported as one, a warning where
  // a source redirect serves the instance read, else an error.
  test('a dependency installed inside the instance read is another instance', async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'animus-nested-instance-'))
    );
    const read = join(root, 'node_modules', 'kit');
    const inner = join(read, 'node_modules', 'kit');
    const write = (path: string, source: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    };
    write(join(root, 'package.json'), '{"name":"app"}');
    write(join(read, 'package.json'), '{"name":"kit","version":"1.0.0"}');
    write(join(read, 'index.js'), 'export const Box = 1;\n');
    write(join(inner, 'package.json'), '{"name":"kit","version":"2.0.0"}');
    write(join(inner, 'index.js'), 'export const Box = 2;\n');
    const compare = (redirected: string[], builder: boolean) =>
      compareAliases({
        rootDir: root,
        fileEntries: [
          { path: 'src/App.tsx', source: 'a', hash: 'a' },
          { path: 'node_modules/kit/index.js', source: 'b', hash: 'b' },
        ],
        pathAliasesJson: null,
        order: undefined,
        readings: {},
        moduleSpecifiers: () =>
          JSON.stringify({ files: { 'src/App.tsx': ['kit'] } }),
        resolve: async (specifier) =>
          specifier === 'kit' ? join(inner, 'index.js') : null,
        cache: new AliasAgreementCache(),
        packages: packageReadRecord({
          rootDir: root,
          roots: { kit: read },
          redirected: new Set(redirected),
          analysed: ['src/App.tsx', 'node_modules/kit/index.js'],
          rendersBuilder: () => builder,
        }),
      }).then(({ findings }) =>
        findings.map(({ code, kind }) => `${code} ${kind}`)
      );
    try {
      expect({
        redirectedBuilder: await compare(['kit'], true),
        unredirectedPlain: await compare([], false),
      }).toEqual({
        redirectedBuilder: ['animus.discovery.replaced-package-instance warn'],
        unredirectedPlain: ['animus.discovery.unread-package-instance error'],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
