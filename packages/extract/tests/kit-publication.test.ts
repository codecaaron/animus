import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { kitPublicationFailures } from '../pipeline/kit-publication';
import { probeEnginePrerequisites } from './engine-prerequisites';

import type { JsonValue } from '../pipeline/tsconfig-paths';

const prerequisites = probeEnginePrerequisites();
const suite = prerequisites.ok ? describe : describe.skip;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface KitManifest {
  name: string;
  version: string;
  type: string;
  files?: string[];
  exports: JsonValue;
  dependencies: Record<string, string>;
}

/** A source kit whose `animus` target imports a palette, by `palette`, and
 *  a type from an undeclared package, which type stripping erases. `files`
 *  null publishes by `.npmignore`; `edit` changes the manifest or a file. */
function kit(
  files: string[] | null,
  palette: string,
  edit?: (
    manifest: KitManifest,
    write: (path: string, contents: string) => void
  ) => void
): string {
  // One level down, so a file outside the package stays in the scratch dir.
  const scratch = mkdtempSync(join(tmpdir(), 'animus-kit-publication-'));
  roots.push(scratch);
  const root = join(scratch, 'kit');
  const write = (path: string, contents: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  const manifest: KitManifest = {
    name: '@acme/kit',
    version: '1.0.0',
    type: 'module',
    exports: {
      '.': { animus: './src/index.ts', import: './dist/index.js' },
    },
    dependencies: { '@animus-ui/system': '1' },
  };
  if (files !== null) manifest.files = files;
  write(
    'src/index.ts',
    [
      "import type { Theme } from 'types-only';",
      "import { createSystem } from '@animus-ui/system';",
      `import { palette } from '${palette}';`,
      "export * from './parts';",
      'export const system = createSystem().build().seal();',
    ].join('\n')
  );
  write('src/parts.ts', "export const part = import('./lazy');");
  write('src/lazy.ts', 'export const lazy = 1;');
  write('helpers/palette.ts', 'export const palette = {};');
  write('dist/index.js', 'export const system = {};');
  edit?.(manifest, write);
  write('package.json', JSON.stringify(manifest));
  return root;
}

suite('kit publication', () => {
  // SAFETY: the host's native binary exists (the probe above), so this is the
  // engine the CLI's build reads.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const engine = require('../index-v2.js');

  it('passes a complete package and names the file, import and cause of each gap', () => {
    // Every target, relative import and package is published or declared.
    expect(
      kitPublicationFailures(
        kit(['src', 'helpers', 'dist'], '../helpers/palette'),
        engine
      )
    ).toEqual([]);

    expect(
      kitPublicationFailures(kit(['dist'], '../helpers/palette'), engine)
    ).toEqual([
      'package.json: the "animus" target of exports["."], src/index.ts, is not in the published files',
    ]);
    // `export *` and a literal `import()` are followed like imports.
    expect(
      kitPublicationFailures(
        kit(['src/index.ts', 'helpers', 'dist'], '../helpers/palette'),
        engine
      )
    ).toEqual([
      "src/index.ts: import './parts' resolves to src/parts.ts, which is not in the published files",
    ]);
    expect(
      kitPublicationFailures(kit(['src', 'dist'], '../helpers/palette'), engine)
    ).toEqual([
      "src/index.ts: import '../helpers/palette' resolves to helpers/palette.ts, which is not in the published files",
    ]);
    expect(
      kitPublicationFailures(
        kit(['src', 'helpers', 'dist'], '../helpers/missing'),
        engine
      )
    ).toEqual([
      "src/index.ts: import '../helpers/missing' resolves to no file in the package",
    ]);
    expect(
      kitPublicationFailures(
        kit(['src', 'helpers', 'dist'], '@acme/workspace-theme'),
        engine
      )
    ).toEqual([
      "src/index.ts: import '@acme/workspace-theme' names the package @acme/workspace-theme, which package.json does not declare in dependencies, peerDependencies or optionalDependencies",
    ]);

    // npm's own rules decide what publishes: `.npmignore`, and brace globs.
    expect(
      kitPublicationFailures(
        kit(null, '../helpers/palette', (_, write) =>
          write('.npmignore', 'helpers/\n')
        ),
        engine
      )
    ).toEqual([
      "src/index.ts: import '../helpers/palette' resolves to helpers/palette.ts, which is not in the published files",
    ]);
    expect(
      kitPublicationFailures(
        kit(['src/**/*.{ts,tsx}', 'helpers', 'dist'], '../helpers/palette'),
        engine
      )
    ).toEqual([]);
    // A relative import must stay in the package.
    expect(
      kitPublicationFailures(
        kit(null, '../../outside', (_, write) =>
          write('../outside.ts', 'export const palette = {};')
        ),
        engine
      )
    ).toEqual([
      "src/index.ts: import '../../outside' resolves to ../outside.ts, outside the package",
    ]);
    // A template `import()` with no expressions names its module.
    expect(
      kitPublicationFailures(
        kit(['src', 'dist'], '../helpers/palette', (_, write) =>
          write(
            'src/parts.ts',
            'export const part = import(`../helpers/lazy`);'
          )
        ),
        engine
      )
    ).toEqual([
      "src/index.ts: import '../helpers/palette' resolves to helpers/palette.ts, which is not in the published files",
      "src/parts.ts: import '../helpers/lazy' resolves to no file in the package",
    ]);
    // A nested or pattern `animus` target is checked as an exact one is.
    expect(
      kitPublicationFailures(
        kit(['src', 'helpers', 'dist'], '../helpers/palette', (manifest) => {
          manifest.exports = {
            '.': { animus: './src/index.ts', import: './dist/index.js' },
            './extra': { browser: { animus: './src/missing.ts' } },
            './parts/*': { animus: './src/parts/*.ts' },
          };
        }),
        engine
      )
    ).toEqual([
      'package.json: the "animus" target of exports["./extra"], ./src/missing.ts, does not exist in the package',
      'package.json: the "animus" target of exports["./parts/*"], ./src/parts/*.ts, matches no file in the package',
    ]);
    // Node puts one subpath into every `*`, so `a-b` is no target of `*-*`.
    expect(
      kitPublicationFailures(
        kit(
          ['src', 'helpers', 'dist', 'parts/a-a.js'],
          '../helpers/palette',
          (manifest, write) => {
            manifest.exports = {
              '.': { animus: './src/index.ts', import: './dist/index.js' },
              './parts/*': { animus: './parts/*-*.js' },
            };
            write('parts/a-a.js', 'export const part = 1;');
            write('parts/a-b.js', 'export const part = 2;');
          }
        ),
        engine
      )
    ).toEqual([]);
  });
});
