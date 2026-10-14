/**
 * The system evaluates the kit instance the host resolves (C8): a bundler
 * alias of a kit extracts from the aliased instance instead of refusing.
 * Against the real engine.
 */
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { getSharedCss } from '../../session/singleton';
import {
  createAliasedKitApp,
  disposeTempRoots,
  makeSession,
  makeTempRoot,
  resetAnimusGlobals,
} from './session-fixtures';

import type { HostResolve } from '../../pipeline/host-package-resolver';
import type { ExtractionSession } from '../../session/extraction-session';

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
});

afterEach(() => {
  restoreGlobals();
  disposeTempRoots();
});

/** A host that aliases `kit` to `alt-kit`, as a bundler's `resolve.alias`
 *  would, and leaves anything else to the loader. */
function aliasingHost(root: string): HostResolve {
  return async (specifier) =>
    specifier === 'kit/definition'
      ? join(root, 'node_modules', 'alt-kit', 'dist', 'definition.mjs')
      : null;
}

function strictSession(
  root: string,
  host: HostResolve | null
): ExtractionSession {
  const session = makeSession(root, { strict: true }, { build: 'b' });
  session.hostResolve = host;
  return session;
}

/** An app whose system extends `kit/main` from its installed kit (A, brand
 *  `#aaaaaa`) and `outer/definition`, which extends `kit/base` from outer's
 *  own copy of kit (B, `#bbbbbb`) and re-exports B's brand: one package
 *  name, two instances. */
function twoInstanceApp(aliasedMain = false): string {
  const root = realpathSync(makeTempRoot('animus-two-instances-'));
  const write = (path: string, contents: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  mkdirSync(join(root, 'node_modules', '@animus-ui'), { recursive: true });
  for (const name of ['system', 'properties']) {
    symlinkSync(
      resolve(__dirname, '../../../..', 'packages', name),
      join(root, 'node_modules', '@animus-ui', name)
    );
  }
  write('package.json', '{"name":"app"}');
  const pkg = (dir: string, name: string, entries: string[]) => {
    write(
      `${dir}/package.json`,
      JSON.stringify({
        name,
        exports: Object.fromEntries(
          entries.map((entry) => [
            `./${entry}`,
            { animus: `./src/${entry}.ts`, default: `./dist/${entry}.mjs` },
          ])
        ),
      })
    );
    for (const entry of entries) {
      write(`${dir}/dist/${entry}.mjs`, 'export const ds = {};\n');
    }
  };
  const kitSource = (brand: string) =>
    `import { createSystem } from '@animus-ui/system';\nexport const ds = createSystem().build().seal();\nexport const brand = '${brand}';\n`;
  // A serves both entries, so taking A for outer's import loads silently.
  pkg('node_modules/kit', 'kit', ['main', 'base']);
  write('node_modules/kit/src/main.ts', kitSource('#aaaaaa'));
  write('node_modules/kit/src/base.ts', kitSource('#aaaaaa'));
  pkg('node_modules/outer/node_modules/kit', 'kit', ['base']);
  write(
    'node_modules/outer/node_modules/kit/src/base.ts',
    kitSource('#bbbbbb')
  );
  pkg('node_modules/outer', 'outer', ['definition']);
  // C, which a host aliasing `kit` to `alt-kit` serves for kit/main.
  pkg('node_modules/alt-kit', 'alt-kit', ['main', 'base']);
  write('node_modules/alt-kit/src/main.ts', kitSource('#cccccc'));
  write('node_modules/alt-kit/src/base.ts', kitSource('#cccccc'));
  write(
    'node_modules/outer/src/definition.ts',
    `import { createSystem } from '@animus-ui/system';\nimport { ds as base, brand } from 'kit/base';\nexport const ds = createSystem().extend(base).build().seal();\nexport { brand };\n`
  );
  write(
    'src/system.ts',
    aliasedMain
      ? `import { createSystem, createTheme } from '@animus-ui/system';\nimport { ds as main, brand } from 'kit/main';\nimport { ds as outer } from 'outer/definition';\nexport const theme = createTheme().addColors({ brand: { 500: brand } }).build();\nexport const ds = createSystem().extend(main).extend(outer).build().seal();\n`
      : `import { createSystem, createTheme } from '@animus-ui/system';\nimport { ds as main } from 'kit/main';\nimport { ds as outer, brand } from 'outer/definition';\nexport const theme = createTheme().addColors({ brand: { 500: brand } }).build();\nexport const ds = createSystem().extend(main).extend(outer).build().seal();\n`
  );
  write('src/App.tsx', 'export const App = 1;\n');
  return root;
}

/** The host the app's bundler is, with each kit's source condition: each
 *  specifier from the root to the source entry a source redirect serves. */
function nodeHost(root: string, aliasedMain = false): HostResolve {
  const entries = new Map([
    [
      'kit/main',
      aliasedMain
        ? 'node_modules/alt-kit/src/main.ts'
        : 'node_modules/kit/src/main.ts',
    ],
    ['outer/definition', 'node_modules/outer/src/definition.ts'],
  ]);
  return async (specifier) => {
    const entry = entries.get(specifier);
    return entry === undefined ? null : join(root, entry);
  };
}

describe("the system evaluates the host's kit instance", () => {
  /** Contract (C8): a strict build whose host aliases a kit evaluates the
   *  aliased instance, the one extraction analyses, so it extracts with
   *  that instance's vocabulary instead of failing with
   *  system-instance-mismatch. */
  test('an aliased kit extracts from the aliased instance', async () => {
    const root = createAliasedKitApp('animus-kit-instances-');
    const session = strictSession(root, aliasingHost(root));
    await session.runFullPipeline();
    expect(getSharedCss(session.key)).toContain('#ff6347');
    expect(getSharedCss(session.key)).not.toContain('#111111');
  }, 60000);

  /** Contract (C8): the instances a participant's host chooses are part of
   *  its resolution context. A participant joining a build whose host
   *  aliases a kit the owner's does not compares unequal, loads its own
   *  system, and refuses the conflict instead of reusing the owner's. */
  test('a participant with other kit instances does not reuse the system', async () => {
    const root = createAliasedKitApp('animus-kit-instances-');
    const owner = strictSession(root, null);
    await owner.runFullPipeline();
    expect(getSharedCss(owner.key)).toContain('#111111');
    const other = strictSession(root, aliasingHost(root));
    await expect(other.agreeWithSystemAuthority()).rejects.toThrow(
      'SessionConfigurationConflict'
    );
  }, 60000);

  /** Contract (C8's stated limit): the system evaluates one instance of a
   *  package. A kit name the system reaches as two instances is refused,
   *  naming both, and neither is taken from the host: the loader resolves
   *  it per importer, as without a host, never by which came first. */
  test('a kit name reaching two instances is refused, never resolved by order', async () => {
    const root = twoInstanceApp();
    const strict = strictSession(root, nodeHost(root));
    await expect(strict.runFullPipeline()).rejects.toThrow(
      /reaches 'kit' as two instances/
    );
  }, 60000);

  /** Contract (C8): a kit name reaching two instances is refused whatever
   *  its level, since no instance of it is both evaluated and served: with
   *  kit/main aliased to C and outer's own B, the loader would evaluate the
   *  installed A while the bundle serves C. */
  test('a two-instance kit is refused even with the code downgraded', async () => {
    const root = twoInstanceApp(true);
    const warned = makeSession(
      root,
      {
        strict: true,
        diagnostics: { 'animus.discovery.system-instance-mismatch': 'warn' },
      },
      { build: 'warned' }
    );
    warned.hostResolve = nodeHost(root, true);
    await expect(warned.runFullPipeline()).rejects.toThrow(
      /reaches 'kit' as two instances/
    );
    expect(getSharedCss(warned.key) ?? '').not.toContain('#aaaaaa');
  }, 60000);

  /** Contract (C8): a participant's check holds only against the authority
   *  current when its read of the host ends. Where the build commits
   *  another authority while the host answers, the participant checks
   *  against that one, never approving itself against a retired one. */
  test('a participant checks against the authority current after its read', async () => {
    const root = createAliasedKitApp('animus-kit-instances-');
    const owner = strictSession(root, null);
    await owner.runFullPipeline();
    let release: () => void = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    const other = strictSession(root, async () => {
      await held;
      return null;
    });
    const agreed = other.agreeWithSystemAuthority();
    // The owner commits another authority, under an aliasing host, while
    // the participant's host is still answering.
    owner.hostResolve = aliasingHost(root);
    await owner.runFullPipeline();
    expect(getSharedCss(owner.key)).toContain('#ff6347');
    release();
    await expect(agreed).rejects.toThrow('SessionConfigurationConflict');
  }, 60000);

  /** Contract (C8): a participant's check converges on an authority the
   *  build commits again with the same context and system, and refuses
   *  one still changing after three reads. */
  test('a participant settles on identical recommits and refuses endless change', async () => {
    const root = createAliasedKitApp('animus-kit-instances-');
    const owner = strictSession(root, null);
    await owner.runFullPipeline();
    let reads = 0;
    const recommitting =
      (change: boolean): HostResolve =>
      async () => {
        reads += 1;
        if (reads <= 20) {
          if (change) {
            owner.hostResolve =
              owner.hostResolve === null ? aliasingHost(root) : null;
          }
          await owner.runFullPipeline();
        }
        return null;
      };
    const same = strictSession(root, recommitting(false));
    await expect(same.agreeWithSystemAuthority()).resolves.toBeUndefined();
    // The same context and system: settled on the read that saw it.
    expect(reads).toBe(1);
    reads = 0;
    const moving = strictSession(root, recommitting(true));
    await expect(moving.agreeWithSystemAuthority()).rejects.toThrow(
      'SessionConfigurationConflict'
    );
    expect(reads).toBeLessThanOrEqual(3);
  }, 120000);
});
