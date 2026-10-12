import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { build } from 'vite-plus';
import { afterEach, expect, test } from 'vitest';

import { animusExtract } from '../../src/index';

import type { Logger } from 'vite-plus';

const REPO_ROOT = resolve(__dirname, '../../../..');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Gamut's probe shape: the Vite root is `probe/`, a subdirectory of the app,
 * and the system file is the app's `src/ds.ts`, outside that root. `ds`
 * is the system file's source.
 */
function probeApp(ds: string) {
  const app = realpathSync(mkdtempSync(join(tmpdir(), 'animus-probe-root-')));
  roots.push(app);
  const write = (path: string, source: string): void => {
    mkdirSync(dirname(join(app, path)), { recursive: true });
    writeFileSync(join(app, path), source);
  };
  mkdirSync(join(app, 'node_modules/@animus-ui'), { recursive: true });
  symlinkSync(
    join(REPO_ROOT, 'packages/system'),
    join(app, 'node_modules/@animus-ui/system'),
    'dir'
  );
  write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
  write('src/ds.ts', ds);
  write('probe/tokens.ts', 'export const pad = { padding: 4 };\n');
  write(
    'probe/card.tsx',
    "import { ds } from '../src/ds';\nimport { pad } from './tokens';\nexport const Card = ds.styles({ ...pad }).asElement('div');\n"
  );
  write(
    'probe/main.tsx',
    "import { ds } from '../src/ds';\nimport { Card } from './card';\nexport const used = [ds, Card];\n"
  );
  return { app, probe: join(app, 'probe') };
}

const SYSTEM = `import { createSystem, createTheme } from '@animus-ui/system';
export const theme = createTheme().build();
export const ds = createSystem().build().seal();
`;

interface ProbeBuild {
  root: string;
  configFile: false;
  customLogger: Logger;
  plugins: ReturnType<typeof animusExtract>[];
  build: {
    outDir: string;
    lib: { entry: string; formats: ['es'] };
  };
}

interface BuildOutput {
  output: Array<{ fileName: string; source?: string | Uint8Array }>;
}

/** The stylesheet the build emits, and every warning it logs. */
async function buildProbe(
  ds: string
): Promise<{ css: string; warnings: string }> {
  const { app, probe } = probeApp(ds);
  const warnings: string[] = [];
  const record = (message: string) => warnings.push(message);
  // SAFETY: vite-plus runs Vite's build and consumes the same plugin hooks;
  // only the nominal declarations differ, and tsc overflows on them.
  const runBuild = build as (
    config: ProbeBuild
  ) => Promise<BuildOutput | BuildOutput[]>;
  const built = await runBuild({
    root: probe,
    configFile: false,
    customLogger: {
      info: () => {},
      warn: record,
      warnOnce: record,
      error: record,
      clearScreen: () => {},
      hasErrorLogged: () => false,
      hasWarned: false,
    },
    plugins: [animusExtract({ system: join(app, 'src/ds.ts') })],
    build: {
      outDir: join(app, 'out'),
      lib: { entry: 'main.tsx', formats: ['es'] },
    },
  });
  const css = [built]
    .flat()[0]
    .output.filter((file) => file.fileName.endsWith('.css'))
    .map((file) => String(file.source))
    .join('');
  return { css, warnings: warnings.join('\n') };
}

// Contract: a system file outside the Vite root is one of the system's own
// modules, analysed as the root's are. Importing it opens nothing, so the
// app's static stage inputs stay static; a write it makes is seen.
test('a system file outside the root opens nothing, and its writes are seen', async () => {
  const plain = await buildProbe(SYSTEM);
  expect(plain.css).toContain('padding:4px');
  expect(plain.warnings).not.toContain('animus.resolve.unanalysed-import');
  expect(plain.warnings).not.toContain('stage-evaluation-failed');

  const writing = await buildProbe(
    `${SYSTEM}import { pad } from '../probe/tokens';\npad.padding = 9;\n`
  );
  expect(writing.css).not.toContain('padding:4px');
});
