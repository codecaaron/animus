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

import { REPO_ROOT } from '../../../extract/tests/engine-prerequisites';

/**
 * The dev-server fixture app. `@animus-ui/system` is symlinked in rather than
 * installed: the system loader resolves it from the system file's directory.
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

/** A one-export palette module — the second hop for the transitive test. */
export function paletteSource(brandHex: string): string {
  return `export const BRAND_500 = '${brandHex}';\n`;
}

/**
 * A theme that imports its brand hex from `./palette`, putting palette.ts two
 * hops from the system entry.
 */
export function themeViaPaletteSource(): string {
  return `import { createTheme } from '@animus-ui/system';
import { BRAND_500 } from './palette';

export const tokens = createTheme()
  .addColors({ brand: { 500: BRAND_500 } })
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

export function brokenThemeSource(): string {
  return `import { createTheme } from '@animus-ui/system';

export const tokens = createTheme(
`;
}

/**
 * The system module. `marker` only changes a comment, so each touch is a
 * distinct on-disk revision with the same meaning.
 */
export function systemSource(marker: string): string {
  return `import { createSystem } from '@animus-ui/system';
import { color, space } from '@animus-ui/system/groups';

export { tokens } from './theme';

// ${marker}
export const ds = createSystem()
  .addGroup('space', space)
  .addGroup('surface', color)
  .build()
  .seal();
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

/**
 * A component that opts into the `space` group. Only a JSX usage of an opted-in
 * prop mints a utility class, so the prop map needs this and `usageSource`.
 */
export function systemComponentSource(groups: string[] = ['space']): string {
  const optIn = groups.map((group) => `${group}: true`).join(', ');
  return `import { ds } from './ds';

export const Box = ds
  .styles({ bg: 'primary' })
  .system({ ${optIn} })
  .asElement('div');
`;
}

/**
 * The usage site. Nothing imports it: the plugin discovers it by walking the
 * project, so the dev server never has to transform its JSX.
 */
export function usageSource(paddingStep: number): string {
  return `import { Box } from './Box';

export const App = () => <Box p={${paddingStep}} />;
`;
}

const INDEX_HTML = `<!doctype html>
<html>
  <head>
    <title>animus dev-server fixture</title>
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
  write(relativePath: string, source: string): void;
  remove(relativePath: string): void;
  /** Write the sentinel component; the padding must be unique per barrier. */
  writeSentinel(padding: string): void;
  dispose(): void;
}

export const INITIAL_BRAND_HEX = '#3b82f6';
export const INITIAL_BUTTON_PADDING = '8px';
/** The `space` scale step `src/Usage.tsx` starts on. */
export const INITIAL_USAGE_STEP = 4;

export function createDevFixture(): DevFixture {
  // realpath: macOS hands back /var/... while the watcher reports /private/var,
  // and the plugin compares the system path against `resolve(root, system)`.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-dev-server-')));

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
        name: 'animus-dev-server-fixture',
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
  write('src/Box.ts', systemComponentSource());
  write('src/Usage.tsx', usageSource(INITIAL_USAGE_STEP));
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
