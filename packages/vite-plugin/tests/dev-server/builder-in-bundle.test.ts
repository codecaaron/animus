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

/** A kit under src/kit with its own installed copy of the system package,
 *  building a theme from that copy. */
function withKitCopy(fixture: DevFixture): void {
  const copy = join(fixture.root, 'src/kit/node_modules/@animus-ui/system');
  const system = join(REPO_ROOT, 'packages/system');
  mkdirSync(copy, { recursive: true });
  cpSync(join(system, 'dist'), join(copy, 'dist'), { recursive: true });
  cpSync(join(system, 'package.json'), join(copy, 'package.json'));
  symlinkSync(join(system, 'node_modules'), join(copy, 'node_modules'));
  fixture.write(
    'src/kit/index.ts',
    "import { createTheme } from '@animus-ui/system';\n\nexport const kitTheme = createTheme().addColors({ foreign: 'purple' }).build();\n"
  );
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
      /ℹ \S+\.js: bundle: ships the system builder \(@animus-ui\/system's createSystem\)\. It is reached through src\/main\.ts → src\/ds\.ts: /
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
      setup: withKitCopy,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /ships the theme builder .* reached through src\/main\.ts → src\/kit\/index\.ts: /
    );
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
    expect(lines[0]).toMatch(
      /ships the system builder .* reached through src\/main\.ts → src\/ds\.ts: /
    );
  });

  // Contract: the chain passes through modules the chunk renders where such
  // a path exists, not through an importer the bundle tree-shook.
  it('a chain skips an importer the bundle tree-shook', async () => {
    const lines = await buildLog({
      runtimeRead:
        // `dead` keeps the import past the TypeScript transform; an app
        // build drops an entry's exports, so the bundle shakes `shaken.ts`.
        "import { unused } from './shaken';\nimport { read } from './reader';\n\nexport const dead = () => unused;\nObject.assign(globalThis, { read });",
      setup: (fixture) => {
        fixture.write(
          'src/shaken.ts',
          "import { ds } from './ds';\n\nexport const unused = ds;\n"
        );
        fixture.write(
          'src/holder.ts',
          "import { ds } from './ds';\n\nexport const held = ds;\n"
        );
        fixture.write(
          'src/reader.ts',
          "import { held } from './holder';\n\nexport const read = () => held;\n"
        );
      },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /reached through src\/main\.ts → src\/reader\.ts → src\/holder\.ts → src\/ds\.ts: /
    );
  });

  // Contract: the record names the builders the chunk renders: the system
  // builder, the theme builder, or both.
  it('names the theme builder alone where only a theme is read', async () => {
    const themeOnly = await buildLog({
      runtimeRead:
        "import { tokens } from './theme';\n\nObject.assign(globalThis, { tokens });",
    });
    expect(themeOnly).toHaveLength(1);
    expect(themeOnly[0]).toMatch(
      /ships the theme builder \(@animus-ui\/system's createTheme\)\. It is reached through src\/main\.ts → src\/theme\.ts: /
    );

    const both = await buildLog({
      runtimeRead: `${READS_SYSTEM}\nimport { tokens } from './theme';\n\nObject.assign(globalThis, { tokens });`,
    });
    expect(both).toHaveLength(1);
    expect(both[0]).toMatch(
      /ships the system and theme builders \(@animus-ui\/system's createSystem and createTheme\)\./
    );
  });

  // Contract: where both builders ship, each gets its own chain, to a module
  // that holds that builder: the system builder to the module calling
  // createSystem, the theme builder to the one calling createTheme.
  it('gives each shipped builder its own chain', async () => {
    const lines = await buildLog({
      runtimeRead:
        "import { read } from './reader';\nimport { tokens } from './theme';\n\nObject.assign(globalThis, { read, tokens });",
      setup: (fixture) =>
        fixture.write(
          'src/reader.ts',
          "import { ds } from './ds';\n\nexport const read = () => ds;\n"
        ),
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /The system builder is reached through src\/main\.ts → src\/reader\.ts → src\/ds\.ts; the theme builder is reached through src\/main\.ts → src\/theme\.ts: one import path to each/
    );
  });

  // Contract: a chain ends at a holder only where the bundle renders it and
  // its runtime import reaches the package instance rendering the builder
  // in that chunk; else it ends at that instance's own module.
  it("keeps each chunk's chain with its own package copy", async () => {
    const lines = await buildLog({
      runtimeRead:
        "import { tokens } from './theme';\n\nObject.assign(globalThis, { tokens });\nvoid import('./kit/index').then((kit) => Object.assign(globalThis, { kitTheme: kit.kitTheme }));",
      setup: withKitCopy,
    });

    expect(lines).toHaveLength(2);
    expect(lines).toContainEqual(
      expect.stringMatching(/reached through src\/main\.ts → src\/theme\.ts: /)
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /reached through src\/main\.ts → src\/kit\/index\.ts: /
      )
    );
  });

  it('a holder the bundle tree-shook explains nothing', async () => {
    const lines = await buildLog({
      runtimeRead:
        "import { unusedTheme } from './shaken-builder';\nimport { kitTheme } from './kit/index';\n\nexport const dead = () => unusedTheme;\nObject.assign(globalThis, { kitTheme });",
      setup: (fixture) => {
        withKitCopy(fixture);
        // Through a namespace, so the kit holds no named import of its own.
        fixture.write(
          'src/kit/index.ts',
          "import * as animus from '@animus-ui/system';\n\nexport const kitTheme = animus.createTheme().addColors({ foreign: 'purple' }).build();\n"
        );
        fixture.write(
          'src/shaken-builder.ts',
          "import { createTheme } from '@animus-ui/system';\n\nexport const unusedTheme = () => createTheme().build();\n"
        );
      },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /reached through src\/main\.ts → src\/kit\/index\.ts: /
    );
  });

  it('a type-only import of a builder holds nothing', async () => {
    const lines = await buildLog({
      runtimeRead:
        "import { read } from './reader';\nimport { marker } from './z-decoy';\n\nObject.assign(globalThis, { read, marker });",
      setup: (fixture) => {
        fixture.write(
          'src/reader.ts',
          "import { ds } from './ds';\n\nexport const read = () => ds;\n"
        );
        fixture.write(
          'src/z-decoy.ts',
          "import type { createSystem } from '@animus-ui/system';\n\nexport type Unused = ReturnType<typeof createSystem>;\nexport const marker = Object.assign(globalThis, { decoy: true });\n"
        );
      },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /reached through src\/main\.ts → src\/reader\.ts → src\/ds\.ts: /
    );
  });
});
