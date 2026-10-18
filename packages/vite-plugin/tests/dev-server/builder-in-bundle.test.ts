import { cpSync, mkdirSync, symlinkSync } from 'fs';
import { join } from 'path';
import { createBuilder } from 'vite-plus';
import { describe, expect, it, vi } from 'vitest';

import {
  probeEnginePrerequisites,
  REPO_ROOT,
} from '../../../extract/tests/engine-prerequisites';
import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

import type { DevFixture } from './fixture';
import type { Logger } from 'vite-plus';

vi.setConfig({ testTimeout: 60_000 });

const SHIPPED = 'animus.bundle.system-builder-shipped';

/** A client import guard: the builder root is for the build, never the
 *  client, which needs only the runtime subpath. */
const forbidBuilderRoot = {
  name: 'forbid-runtime-builder-root',
  enforce: 'pre' as const,
  resolveId(id: string): null {
    if (id === '@animus-ui/system') {
      throw new Error('the builder root is compile-time only');
    }
    return null;
  },
};

interface LoggedBuildConfig {
  root: string;
  configFile: false;
  customLogger: Logger;
  resolve: { alias: Array<{ find: RegExp; replacement: string }> };
  plugins: Array<ReturnType<typeof animusExtract> | typeof forbidBuilderRoot>;
  environments: {
    client: { build: { outDir: string; rollupOptions: { input: string } } };
  };
}

interface BuildCase {
  /** main.ts's runtime read; an app build drops an entry's exports, so a
   *  read needs an effect. */
  runtimeRead?: string;
  verbose?: boolean;
  guard?: boolean;
  alias?: LoggedBuildConfig['resolve']['alias'];
  setup?: (fixture: DevFixture) => void;
}

/** The lines a production client build of the fixture logs. */
async function buildLog(build: BuildCase = {}): Promise<string[]> {
  const fixture = createDevFixture();
  try {
    // Truthful sideEffects: a system module nothing reads is dropped.
    fixture.write(
      'package.json',
      '{"name":"animus-builder-fixture","private":true,"type":"module","sideEffects":false}\n'
    );
    // Every bundle keeps the components, and so the runtime, through an
    // effect: only the runtime read differs.
    fixture.write(
      'src/main.ts',
      `import { Button } from './Button';\nimport { Sentinel } from './Sentinel';\n${build.runtimeRead ?? ''}\n\nObject.assign(globalThis, { roots: [Button, Sentinel] });\n`
    );
    build.setup?.(fixture);
    const lines: string[] = [];
    const record = (message: string) => {
      lines.push(message);
    };
    // SAFETY: vite-plus runs Vite's builder and consumes the same plugin
    // hooks; only the nominal declarations differ, and tsc overflows on them.
    const startBuild = createBuilder as (
      config: LoggedBuildConfig
    ) => Promise<{ buildApp(): Promise<void> }>;
    const builder = await startBuild({
      root: fixture.root,
      configFile: false,
      customLogger: {
        info: record,
        warn: record,
        warnOnce: record,
        error: record,
        clearScreen: () => {},
        hasErrorLogged: () => false,
        hasWarned: false,
      },
      resolve: { alias: build.alias ?? [] },
      plugins: [
        ...(build.guard ? [forbidBuilderRoot] : []),
        animusExtract({
          system: './src/ds.ts',
          verbose: build.verbose ?? true,
        }),
      ],
      environments: {
        client: {
          build: {
            outDir: 'dist',
            rollupOptions: { input: join(fixture.root, 'src', 'main.ts') },
          },
        },
      },
    });
    await builder.buildApp();
    return lines.filter((line) => line.includes(SHIPPED));
  } finally {
    fixture.dispose();
  }
}

const READS_SYSTEM =
  "import { ds } from './ds';\n\nObject.assign(globalThis, { system: ds });";

const prerequisites = probeEnginePrerequisites();
const suite = prerequisites.ok ? describe : describe.skip;

// Contract: a client bundle that ships the system builder reports it at
// info, naming the chunk and the import chain that keeps it, from any
// installed copy of the system package, its dist entry or its source; one
// that drops it reports nothing. Where the record would not print, nothing
// runs, so a client import guard on the builder root fails no build.
suite('a production client build and the system builder', () => {
  it('reports a bundle that ships the builder, at info, with its import chain', async () => {
    const lines = await buildLog({ runtimeRead: READS_SYSTEM });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /ℹ \S+\.js: bundle: ships the system builder .* through src\/main\.ts → src\/ds\.ts\./
    );
  });

  it('reports nothing where the bundle drops the builder', async () => {
    expect(await buildLog()).toEqual([]);
  });

  it('a client import guard on the builder root fails no build', async () => {
    expect(await buildLog({ guard: true, verbose: false })).toEqual([]);
    expect(await buildLog({ guard: true })).toEqual([]);
  });

  it("reports the builder of a kit's own copy of the system package", async () => {
    const lines = await buildLog({
      runtimeRead:
        "import { kitTheme } from './kit/index';\n\nObject.assign(globalThis, { kitTheme });",
      setup: (fixture) => {
        const copy = join(
          fixture.root,
          'src/kit/node_modules/@animus-ui/system'
        );
        const system = join(REPO_ROOT, 'packages/system');
        mkdirSync(copy, { recursive: true });
        cpSync(join(system, 'dist'), join(copy, 'dist'), { recursive: true });
        cpSync(join(system, 'package.json'), join(copy, 'package.json'));
        symlinkSync(join(system, 'node_modules'), join(copy, 'node_modules'));
        fixture.write(
          'src/kit/index.ts',
          "import { createTheme } from '@animus-ui/system';\n\nexport const kitTheme = createTheme().addColors({ foreign: 'purple' }).build();\n"
        );
      },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/through src\/main\.ts → src\/kit\/index\.ts\./);
  });

  it('reports the builder of a system package resolved to its source', async () => {
    const lines = await buildLog({
      runtimeRead: READS_SYSTEM,
      alias: [
        {
          find: /^@animus-ui\/system$/,
          replacement: join(REPO_ROOT, 'packages/system/src/index.ts'),
        },
      ],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/through src\/main\.ts → src\/ds\.ts\./);
  });
});
