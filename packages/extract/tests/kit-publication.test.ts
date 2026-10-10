import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { kitPublicationFailures } from '../pipeline/kit-publication';
import { probeEnginePrerequisites } from './engine-prerequisites';

const prerequisites = probeEnginePrerequisites();
const suite = prerequisites.ok ? describe : describe.skip;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A source kit whose `animus` target imports a palette, by `palette`, and
 *  a type from an undeclared package, which type stripping erases. */
function kit(files: string[], palette: string): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-kit-publication-'));
  roots.push(root);
  const write = (path: string, contents: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  write(
    'package.json',
    JSON.stringify({
      name: '@acme/kit',
      type: 'module',
      files,
      exports: {
        '.': { animus: './src/index.ts', import: './dist/index.js' },
      },
      dependencies: { '@animus-ui/system': '1' },
    })
  );
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
  });
});
