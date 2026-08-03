import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { REPO_ROOT } from './prerequisites';

/**
 * The dev-lane fixture app: the smallest project shape that still has every
 * feature the dev server's incremental machinery depends on.
 *
 *   src/theme.ts   — tokens, imported RELATIVELY by the system module, so a
 *                    transitive system dependency exists to mutate
 *   src/ds.ts      — the system module named in the plugin options
 *   src/Button.ts  — a builder-chain component
 *   src/Sentinel.ts— a second component used purely as a watcher barrier
 *   src/main.ts    — the html entry's module
 *   index.html     — the app document
 *
 * The fixture lives in a fresh `mkdtemp` directory per run so no two runs (or
 * two servers in one run) can share watcher or cache state. `@animus-ui/system`
 * is symlinked in rather than installed: the Rust system loader resolves the
 * workspace package from the system file's directory, and the fixture must
 * resolve it exactly as a consumer app would.
 */

export function themeSource(brandHex: string): string {
  return `import { createTheme } from '@animus-ui/system';

export const tokens = createTheme()
  .addColors({ brand: { 500: '${brandHex}' } })
  .addColorModes('light', {
    light: { primary: 'brand.500' },
    dark: { primary: 'brand.500' },
  })
  .addScale({
    name: 'space',
    values: { 0: '0', 4: '0.25rem', 8: '0.5rem', 16: '1rem' },
  })
  .build();
`;
}

/** A theme file that cannot be parsed — used by the failure/recovery scenarios. */
export function brokenThemeSource(): string {
  return `import { createTheme } from '@animus-ui/system';

export const tokens = createTheme(
`;
}

/**
 * The system module. `marker` only changes a comment: the geological reset
 * fires on the system file changing at all, so the marker makes each touch a
 * distinct on-disk revision without altering the system's meaning.
 */
export function systemSource(marker: string): string {
  return `import { createSystem } from '@animus-ui/system';
import { color, space } from '@animus-ui/system/groups';

export { tokens } from './theme';

// ${marker}
export const { system: ds } = createSystem()
  .addGroup('space', space)
  .addGroup('surface', color)
  .build();
`;
}

export function componentSource(
  name: string,
  tag: string,
  padding: string
): string {
  return `import { ds } from './ds';

export const ${name} = ds
  .styles({ padding: '${padding}', bg: 'primary' })
  .asElement('${tag}');
`;
}

const INDEX_HTML = `<!doctype html>
<html>
  <head>
    <title>animus dev lane</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const MAIN_SOURCE = `import { Button } from './Button';
import { Sentinel } from './Sentinel';

export const roots = [Button, Sentinel];
`;

export interface DevFixture {
  /** Absolute, symlink-resolved project root handed to the dev server. */
  readonly root: string;
  /** Overwrite one project-relative file. */
  write(relativePath: string, source: string): void;
  /** Delete one project-relative file. */
  remove(relativePath: string): void;
  /** Write the sentinel component with a unique padding value. */
  writeSentinel(padding: string): void;
  /** Remove the whole temp directory. */
  dispose(): void;
}

export const INITIAL_BRAND_HEX = '#3b82f6';
export const INITIAL_BUTTON_PADDING = '8px';

export function createDevFixture(): DevFixture {
  // realpath: macOS hands back /var/... while the watcher reports /private/var,
  // and the plugin compares the system path against `resolve(root, system)`.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-dev-lane-')));

  const write = (relativePath: string, source: string): void => {
    const absolute = join(root, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, source);
  };

  mkdirSync(join(root, 'node_modules/@animus-ui'), { recursive: true });
  symlinkSync(
    join(REPO_ROOT, 'packages/system'),
    join(root, 'node_modules/@animus-ui/system'),
    'dir'
  );

  write(
    'package.json',
    `${JSON.stringify(
      {
        name: 'animus-dev-lane-fixture',
        private: true,
        version: '0.0.0',
        type: 'module',
      },
      null,
      2
    )}\n`
  );
  write('index.html', INDEX_HTML);
  write('src/theme.ts', themeSource(INITIAL_BRAND_HEX));
  write('src/ds.ts', systemSource('initial'));
  write('src/Button.ts', componentSource('Button', 'button', '8px'));
  write('src/Sentinel.ts', componentSource('Sentinel', 'aside', '1px'));
  write('src/main.ts', MAIN_SOURCE);

  return {
    root,
    write,
    remove: (relativePath: string) => rmSync(join(root, relativePath)),
    writeSentinel: (padding: string) =>
      write('src/Sentinel.ts', componentSource('Sentinel', 'aside', padding)),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
