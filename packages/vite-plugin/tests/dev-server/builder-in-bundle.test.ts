import { join } from 'path';
import { createBuilder } from 'vite-plus';
import { describe, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

import type { Logger } from 'vite-plus';

vi.setConfig({ testTimeout: 60_000 });

const SHIPPED = 'animus.bundle.system-builder-shipped';

interface LoggedBuildConfig {
  root: string;
  configFile: false;
  customLogger: Logger;
  plugins: ReturnType<typeof animusExtract>[];
  environments: {
    client: { build: { outDir: string; rollupOptions: { input: string } } };
  };
}

/** The lines a production client build of the fixture logs, with
 *  `runtimeRead` as main.ts's runtime read of the system module, if any.
 *  An app build drops an entry's exports, so a read needs an effect. */
async function buildLog(runtimeRead: string | null): Promise<string[]> {
  const fixture = createDevFixture();
  try {
    // Truthful sideEffects: a system module nothing reads is dropped.
    fixture.write(
      'package.json',
      '{"name":"animus-builder-fixture","private":true,"type":"module","sideEffects":false}\n'
    );
    // Both bundles keep the components, and so the runtime, through an
    // effect: only `runtimeRead` differs.
    fixture.write(
      'src/main.ts',
      `import { Button } from './Button';\nimport { Sentinel } from './Sentinel';\n${runtimeRead ?? ''}\n\nObject.assign(globalThis, { roots: [Button, Sentinel] });\n`
    );
    const lines: string[] = [];
    const record = (message: string) => lines.push(message);
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
      plugins: [animusExtract({ system: './src/ds.ts', verbose: true })],
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
    return lines;
  } finally {
    fixture.dispose();
  }
}

const prerequisites = probeEnginePrerequisites();
const suite = prerequisites.ok ? describe : describe.skip;

// Contract: a client bundle that ships the system builder reports it at
// info, naming the chunk and the import chain that keeps it; one that drops
// it reports nothing.
suite('a production client build and the system builder', () => {
  it('reports a bundle that ships the builder, at info, with its import chain', async () => {
    const lines = (
      await buildLog(
        "import { ds } from './ds';\n\nObject.assign(globalThis, { system: ds });"
      )
    ).filter((line) => line.includes(SHIPPED));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /ℹ \S+\.js: bundle: ships the system builder .* through src\/main\.ts → src\/ds\.ts\./
    );
  });

  it('reports nothing where the bundle drops the builder', async () => {
    const lines = await buildLog(null);
    expect(lines.filter((line) => line.includes(SHIPPED))).toEqual([]);
  });
});
