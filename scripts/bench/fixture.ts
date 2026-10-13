// The large-closure system fixture for verify:bench's loader row: a system
// whose kit reaches an icon package of thousands of .mjs files in two large
// directories, shaped like issuer's 6,303-path closure. Every icon imports a
// shared helper one directory up, and the package barrel imports every
// icon, so the loader resolves each file against a directory of thousands
// of entries: the shape #295's per-candidate directory listing made slow.
//
// Generated, never committed: the bytes are a function of ICONS_PER_SET, and
// the receipt records their digest (`fixtureDigest`).

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const ICON_SETS = ['outlined', 'filled'] as const;
const ICONS_PER_SET = 3125;

export interface LargeClosure {
  root: string;
  systemPath: string;
  /** Every generated file, relative to the root. */
  paths: string[];
}

/** Writes the fixture under `root`, replacing what is there, and links its
 *  `@animus-ui/system` to `systemPackage`. */
export function writeLargeClosure(
  root: string,
  systemPackage: string
): LargeClosure {
  rmSync(root, { recursive: true, force: true });
  const files = new Map<string, string>();
  files.set(
    'package.json',
    `${JSON.stringify({ name: 'bench-large-closure', private: true, type: 'module' })}\n`
  );
  files.set(
    'src/system.ts',
    [
      "import { createSystem, createTheme } from '@animus-ui/system';",
      "import { iconCount } from 'bench-kit';",
      '',
      'export const theme = createTheme()',
      "  .addColors({ bench: { ink: '#123456' } })",
      '  .build();',
      '',
      'export const ds = createSystem().build().seal();',
      '',
      'export const icons = iconCount;',
      '',
    ].join('\n')
  );
  files.set(
    'node_modules/bench-kit/package.json',
    `${JSON.stringify({ name: 'bench-kit', type: 'module', exports: './index.mjs' })}\n`
  );
  files.set(
    'node_modules/bench-kit/index.mjs',
    [
      "import * as icons from 'bench-icons';",
      '',
      'export const iconCount = Object.keys(icons).length;',
      '',
    ].join('\n')
  );
  files.set(
    'node_modules/bench-icons/package.json',
    `${JSON.stringify({ name: 'bench-icons', type: 'module', exports: './esm/index.mjs' })}\n`
  );
  files.set(
    'node_modules/bench-icons/esm/create-icon.mjs',
    'export const createIcon = (name, path) => ({ name, path });\n'
  );
  const barrel: string[] = [];
  for (const set of ICON_SETS) {
    for (let index = 0; index < ICONS_PER_SET; index++) {
      const name = `${set === 'outlined' ? 'Outlined' : 'Filled'}Icon${String(index).padStart(4, '0')}`;
      files.set(
        `node_modules/bench-icons/esm/${set}/${name}.mjs`,
        [
          "import { createIcon } from '../create-icon.mjs';",
          '',
          `export const ${name} = createIcon('${name}', 'M${index} 0h24v24H0z');`,
          '',
        ].join('\n')
      );
      barrel.push(`export { ${name} } from './${set}/${name}.mjs';`);
    }
  }
  files.set('node_modules/bench-icons/esm/index.mjs', `${barrel.join('\n')}\n`);

  for (const [path, source] of files) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  mkdirSync(join(root, 'node_modules/@animus-ui'), { recursive: true });
  symlinkSync(systemPackage, join(root, 'node_modules/@animus-ui/system'));
  return {
    root,
    systemPath: join(root, 'src/system.ts'),
    paths: [...files.keys()].sort(),
  };
}

/** sha256 over each fixture file's path and bytes, read from disk. */
export function fixtureDigest(fixture: LargeClosure): string {
  const hash = createHash('sha256');
  for (const path of fixture.paths) {
    hash.update(`${path}\0${readFileSync(join(fixture.root, path), 'utf8')}\0`);
  }
  return hash.digest('hex');
}
