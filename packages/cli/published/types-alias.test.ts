import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PACKET_MANIFEST_FILE, runTypesAlias } from '../src/types-packet';

import type { TypesAliasOptions } from '../src/types-packet';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const TSC = join(REPO, 'node_modules/typescript/bin/tsc');
const SYSTEM_TYPES = join(REPO, 'packages/system/dist/index.d.ts');
// Each test runs the compiler several times (emit, then the command's own
// checks): about 3.5 s here and over 5 s on CI runners, past vitest's 5 s
// default. The limit only catches a hang.
const COMPILER_TEST_TIMEOUT_MS = 60_000;

// The fixture compiles against the built system declarations: verify:types
// runs this file after its fresh-dist checks, and it fails loud without them.
if (!existsSync(SYSTEM_TYPES)) {
  throw new Error(`ERROR: ${SYSTEM_TYPES} missing. Run: vp run build:ts`);
}

const FILES = {
  'package.json': JSON.stringify({
    name: 'alias-fixture',
    type: 'module',
    exports: { '.': { types: './types/index.d.ts' } },
  }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2023', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
    include: ['src'],
  }),
  'tsconfig.types.json': JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      noEmitOnError: true,
      outDir: './.types-raw',
      rootDir: './src',
    },
    include: ['src'],
  }),
  'src/ds.ts': `import { createSystem, createTheme } from '@animus-ui/system';
import { color, space } from '@animus-ui/system/groups';

export const theme = createTheme()
  .addBreakpoints({ md: 768 })
  .addColors({ ink: '#111111', paper: '#ffffff' })
  .addScale({ name: 'space', values: { sm: '4px', lg: '8px' } })
  .build();

type FixtureTheme = typeof theme;
declare module '@animus-ui/system' {
  interface Theme extends FixtureTheme {}
}

export const ds = createSystem().addGroup('space', space).addGroup('color', color).build().seal();
`,
  'src/Button.ts': `import { ds } from './ds';

export const Button = ds
  .styles({ display: 'inline-flex' })
  .variant({ prop: 'tone', variants: { calm: { color: 'ink' }, bold: { color: 'paper' } } })
  .asElement('button');
`,
  'src/Box.ts': `import { ds } from './ds';

export const Box = ds.styles({}).system({ space: true, color: true }).asElement('div');

// A global record whose name a component alias would take: the file
// mentions it, so the alias must not shadow it.
declare global {
  interface BoxComponent {
    sentinel: 'global';
  }
}
export declare const metadata: BoxComponent;
`,
  // The same record, its name spelled with an escape the text never shows.
  'src/Panel.ts': `import type { AnimusComponent } from '@animus-ui/system';

declare global {
  interface Panel\\u0043omponent {
    sentinel: 'global';
  }
}
export declare const Panel: AnimusComponent<'div', {}, {}, {}, {}, {}, {}, {}>;
export declare const panelMetadata: Panel\\u0043omponent;
`,
  // The augmentation edge tsc does not keep on its own.
  'src/index.ts': `export type {} from './ds';
export { Box, metadata } from './Box';
export { Button } from './Button';
export { Panel, panelMetadata } from './Panel';
`,
  'probes/use.tsx': `import { Box, Button, metadata, panelMetadata } from 'alias-fixture';

export const accepted = <><Button tone="calm" /><Box p={{ _: 'sm', md: 'lg' }} color="ink" /></>;
export const wrongTone = <Button tone="loud" />;
export const wrongBreakpoint = <Box p={{ _: 'sm', xxl: 'lg' }} />;
export const wrongColor = <Box color="sky" />;
export const sentinel: 'global' = metadata.sentinel;
export const escaped: 'global' = panelMetadata.sentinel;
`,
};

let root = '';

function emitDeclarations(): number | null {
  rmSync(join(root, '.types-raw'), { recursive: true, force: true });
  return spawnSync(process.execPath, [TSC, '-p', 'tsconfig.types.json'], {
    cwd: root,
  }).status;
}

function aliasOptions(): TypesAliasOptions {
  return {
    declDir: join(root, '.types-raw'),
    outDir: join(root, 'types'),
    project: join(root, 'tsconfig.types.json'),
    probesDir: join(root, 'probes'),
    anchors: [],
    tsc: TSC,
  };
}

interface ConsumerOptions {
  skipLibCheck: boolean;
  paths?: { 'alias-fixture': string[] };
}

/** The probe's diagnostic sites as a consumer sees them, with the package
 *  resolved to `entry` (or, when null, through its own exports). */
function consumerSites(entry: string | null): string[] {
  const config = join(root, 'tsconfig.consumer.json');
  const compilerOptions: ConsumerOptions = { skipLibCheck: false };
  if (entry !== null) compilerOptions.paths = { 'alias-fixture': [entry] };
  writeFileSync(
    config,
    JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions,
      files: ['probes/use.tsx'],
      include: [],
    })
  );
  const run = spawnSync(
    process.execPath,
    [TSC, '-p', config, '--pretty', 'false'],
    {
      cwd: root,
      encoding: 'utf8',
    }
  );
  rmSync(config);
  return (
    run.stdout
      .split('\n')
      .filter((line) => / error TS\d+:/.test(line))
      // tsc prints the path relative to the temporary directory's real path.
      .map((line) =>
        line.replace(/^.*(probes\/)/, '$1').replace(/: error (TS\d+):.*/, ' $1')
      )
  );
}

/** Every packet file and its bytes. */
function packetSnapshot(): string {
  const dir = join(root, 'types');
  expect(existsSync(join(dir, PACKET_MANIFEST_FILE))).toBe(true);
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
    .map((file) => `${file}\n${readFileSync(file, 'utf8')}`)
    .join('\n');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'animus-types-alias-'));
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  mkdirSync(join(root, 'node_modules/@animus-ui'), { recursive: true });
  mkdirSync(join(root, 'node_modules/@types'), { recursive: true });
  symlinkSync(
    join(REPO, 'packages/system'),
    join(root, 'node_modules/@animus-ui/system')
  );
  symlinkSync(
    join(REPO, 'node_modules/@types/react'),
    join(root, 'node_modules/@types/react')
  );
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

describe('animus types alias', () => {
  // Contract: an aliased packet type-checks exactly as the ordinary one.
  test(
    'an aliased packet type-checks exactly as the ordinary one',
    async () => {
      expect(emitDeclarations()).toBe(0);
      const report = await runTypesAlias(aliasOptions());

      // Not vacuous: the packet differs from the ordinary declarations, in
      // its registries and its component names. Box's and Panel's files
      // mention a global record each would name, so both keep their types.
      expect(
        report.aliases.reduce((sum, alias) => sum + alias.replacements, 0)
      ).toBeGreaterThan(0);
      expect(report.names).toEqual({ components: 1 });
      const expected = [
        'probes/use.tsx(4,34) TS2769',
        'probes/use.tsx(5,51) TS2769',
        'probes/use.tsx(6,32) TS2769',
      ];
      expect(consumerSites(join(root, '.types-raw/index.d.ts'))).toEqual(
        expected
      );
      expect(consumerSites(null)).toEqual(expected);
    },
    COMPILER_TEST_TIMEOUT_MS
  );

  // Contract: a failed producer never promotes.
  test(
    'a failed producer never promotes',
    async () => {
      expect(emitDeclarations()).toBe(0);
      await runTypesAlias(aliasOptions());
      const promoted = packetSnapshot();

      // The compiler fails: noEmitOnError leaves no output to alias.
      const button = join(root, 'src/Button.ts');
      const source = readFileSync(button, 'utf8');
      appendFileSync(button, "export const broken: number = 'x';\n");
      expect(emitDeclarations()).not.toBe(0);
      await expect(runTypesAlias(aliasOptions())).rejects.toThrow();
      writeFileSync(button, source);

      // The output does not check: the staged packet is discarded.
      expect(emitDeclarations()).toBe(0);
      appendFileSync(
        join(root, '.types-raw/Box.d.ts'),
        '\nexport declare const missing: import("./nowhere").X;\n'
      );
      await expect(runTypesAlias(aliasOptions())).rejects.toThrow();

      expect(packetSnapshot()).toBe(promoted);
    },
    COMPILER_TEST_TIMEOUT_MS
  );
});
