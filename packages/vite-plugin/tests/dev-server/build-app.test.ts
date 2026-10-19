import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { BuildEnvironment, createBuilder } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

import type { Logger, ViteBuilder } from 'vite-plus';

/** Fails the client build while `failing.client` is set. */
const failing = { client: false };
const failClient = {
  name: 'fail-client',
  transform(this: { environment: { name: string } }) {
    if (failing.client && this.environment.name === 'client') {
      throw new Error('planned client failure');
    }
    return null;
  },
};

/** Delays every SSR transform, so the client environment closes first. */
const slowSsr = {
  name: 'slow-ssr',
  enforce: 'pre' as const,
  async transform(this: { environment: { name: string } }) {
    if (this.environment.name === 'ssr') {
      await new Promise((settle) => setTimeout(settle, 300));
    }
    return null;
  },
};

interface EnvironmentBuild {
  build: {
    outDir: string;
    ssr?: true;
    rollupOptions: { input: string };
  };
}

interface ParallelBuildConfig {
  root: string;
  configFile: false;
  logLevel: 'silent';
  plugins: Array<
    typeof slowSsr | typeof failClient | ReturnType<typeof animusExtract>
  >;
  environments: { client: EnvironmentBuild; ssr: EnvironmentBuild };
  builder: { buildApp(app: ViteBuilder): Promise<void> };
}

type StartParallelBuild = (
  config: ParallelBuildConfig
) => Promise<{ buildApp(): Promise<void> }>;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(dir, entry.name))
      : [join(dir, entry.name)]
  );
}

/**
 * A custom `buildApp` builds a shared plugin's environments in parallel: the
 * first to close must not retire the Session and engine the others still
 * transform with.
 */
describe('environments built in parallel', () => {
  it('the first environment to close leaves the others their Session', async () => {
    const fixture = createDevFixture();
    try {
      const input = join(fixture.root, 'src', 'main.ts');
      // SAFETY: vite-plus runs Vite's builder and consumes the same plugin
      // hooks; only the nominal declarations differ, and tsc overflows on them.
      const startParallelBuild = createBuilder as StartParallelBuild;
      const builder = await startParallelBuild({
        root: fixture.root,
        configFile: false,
        logLevel: 'silent',
        plugins: [slowSsr, animusExtract({ system: './src/ds.ts' })],
        environments: {
          client: {
            build: { outDir: 'dist/client', rollupOptions: { input } },
          },
          ssr: {
            build: { outDir: 'dist/ssr', ssr: true, rollupOptions: { input } },
          },
        },
        builder: {
          async buildApp(app) {
            await Promise.all([
              app.build(app.environments.client),
              app.build(app.environments.ssr),
            ]);
          },
        },
      });
      await builder.buildApp();

      const ssrCode = filesUnder(join(fixture.root, 'dist', 'ssr'))
        .filter((file) => file.endsWith('.js'))
        .map((file) => readFileSync(file, 'utf-8'))
        .join('\n');
      expect(ssrCode).toContain('createComponent');
      expect(ssrCode).not.toContain('.styles(');
    } finally {
      fixture.dispose();
    }
  });

  // Contract: a build reports what it extracted once, whichever
  // environment analyses first, and 'System loaded' prints the system
  // load's own time, not the whole pipeline's.
  it('reports its extraction once, and the system load by its own time', async () => {
    const fixture = createDevFixture();
    try {
      const lines: string[] = [];
      const input = join(fixture.root, 'src', 'main.ts');
      // SAFETY: vite-plus runs Vite's builder and consumes the same plugin
      // hooks; only the nominal declarations differ, and tsc overflows on them.
      const startLoggedBuild = createBuilder as (
        config: Omit<ParallelBuildConfig, 'logLevel'> & {
          customLogger: Logger;
        }
      ) => Promise<{ buildApp(): Promise<void> }>;
      const builder = await startLoggedBuild({
        root: fixture.root,
        configFile: false,
        customLogger: recordingLogger(lines),
        plugins: [
          slowSsr,
          animusExtract({ system: './src/ds.ts', verbose: true }),
        ],
        environments: {
          client: {
            build: { outDir: 'dist/client', rollupOptions: { input } },
          },
          ssr: {
            build: { outDir: 'dist/ssr', ssr: true, rollupOptions: { input } },
          },
        },
        builder: {
          async buildApp(app) {
            await Promise.all([
              app.build(app.environments.client),
              app.build(app.environments.ssr),
            ]);
          },
        },
      });
      await builder.buildApp();

      expect(lines.filter((line) => line.includes('Extracted '))).toHaveLength(
        1
      );
      const loads = lines
        .map((line) => /System loaded: .*\((\d+)ms\)/.exec(line)?.[1])
        .filter((ms) => ms !== undefined);
      const systemLoads = new Set(
        lines.map((line) => /system-load\s+(\d+)ms/.exec(line)?.[1])
      );
      expect(loads.length).toBeGreaterThan(0);
      for (const ms of loads) expect(systemLoads).toContain(ms);
    } finally {
      fixture.dispose();
    }
  });

  it('a builder reused while an earlier build still runs builds after it', async () => {
    const fixture = createDevFixture();
    try {
      // Every environment build either app starts, in order.
      const builds: Array<Promise<object | void>> = [];
      const builder = await parallelBuilder(fixture.root, async (app) => {
        const started = [
          app.build(app.environments.client),
          app.build(app.environments.ssr),
        ];
        builds.push(...started);
        await Promise.all(started);
      });
      // The client fails at once; the slow SSR build is still running when
      // the builder is reused.
      failing.client = true;
      await expect(builder.buildApp()).rejects.toThrow(
        'planned client failure'
      );
      failing.client = false;
      await builder.buildApp();

      const outcomes = await Promise.allSettled(builds);
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        'rejected',
        'fulfilled',
        'fulfilled',
        'fulfilled',
      ]);
    } finally {
      failing.client = false;
      fixture.dispose();
    }
  });

  it('two environments under one name build one after the other', async () => {
    const fixture = createDevFixture();
    try {
      // A second, distinct environment object under the client's name.
      const builder = await parallelBuilder(fixture.root, async (app) => {
        const twin = new BuildEnvironment('client', app.config);
        await twin.init();
        await Promise.all([
          app.build(app.environments.client),
          app.build(twin),
        ]);
      });

      await expect(builder.buildApp()).resolves.toBeUndefined();
    } finally {
      fixture.dispose();
    }
  });
});

/**
 * Contract: every finding line a real build prints ends with its own Animus
 * code in brackets, names that code once, and writes no code in parentheses,
 * whether the system loader, the host or the engine raised it. Source
 * ingestion lines, which keep their legacy codes, are out of its scope.
 */
describe('finding lines of a real build', () => {
  it('end with their own code, named once', async () => {
    const fixture = createDevFixture();
    try {
      // A selector alias with no subject outside quotes (a host finding).
      fixture.write(
        'src/ds.ts',
        `import { createSystem } from '@animus-ui/system';
import { color, space } from '@animus-ui/system/groups';
import './side';

export { tokens } from './theme';

export const ds = createSystem()
  .addGroup('space', space)
  .addGroup('surface', color)
  .addSelectors({ _quoted: '[data-x="&"]' })
  .build()
  .seal();
`
      );
      // A registration in a function the system does not reach (a loader
      // finding).
      fixture.write(
        'src/side.ts',
        `import { createSystem } from '@animus-ui/system';

export function later() {
  return createSystem().build().registerGlobalStyles({});
}
`
      );
      // Skips whose reason carries its code (engine findings), written
      // inline and held in a const, whose reason names it after the code.
      fixture.write(
        'src/Probe.ts',
        `import { ds } from './ds';

const held = { '[data-y="&"]': { color: 'blue' } };

export const Probe = ds
  .styles({ '[data-x="&"]': { color: 'red' } })
  .asElement('div');

export const Held = ds.styles(held).asElement('div');
`
      );
      const lines: string[] = [];
      // SAFETY: as above.
      const startLoggedBuild = createBuilder as (config: {
        root: string;
        configFile: false;
        customLogger: Logger;
        plugins: ReturnType<typeof animusExtract>[];
        build: {
          outDir: string;
          write: false;
          rollupOptions: { input: string };
        };
      }) => Promise<{ buildApp(): Promise<void> }>;
      const builder = await startLoggedBuild({
        root: fixture.root,
        configFile: false,
        customLogger: recordingLogger(lines),
        // Verbose, so info findings print too.
        plugins: [animusExtract({ system: './src/ds.ts', verbose: true })],
        build: {
          outDir: 'dist',
          write: false,
          rollupOptions: { input: join(fixture.root, 'src', 'main.ts') },
        },
      });
      await builder.buildApp();

      const findings = lines.filter((line) => /^\[animus\] [⚠ℹ✖] /.test(line));
      const codes = findings.map(
        (line) => / \[(animus\.[a-z.-]+)\]$/.exec(line)?.[1]
      );
      expect(codes).not.toContain(undefined);
      expect(codes).toEqual(
        expect.arrayContaining([
          'animus.selector.unsupported-subject',
          'animus.system.registration-unproved',
        ])
      );
      // The engine's skip and the host's alias finding share a code.
      expect(
        findings.filter((line) => /(Probe|Held): skipped/.test(line))
      ).toHaveLength(2);
      for (const [index, line] of findings.entries()) {
        expect(line.split(codes[index]!), line).toHaveLength(2);
      }
      expect(lines.filter((line) => line.includes('(animus.'))).toEqual([]);
    } finally {
      fixture.dispose();
    }
  });
});

/** A logger that records every line it is given. */
function recordingLogger(lines: string[]): Logger {
  const record = (message: string) => {
    lines.push(message);
  };
  return {
    info: record,
    warn: record,
    warnOnce: record,
    error: record,
    clearScreen: () => {},
    hasErrorLogged: () => false,
    hasWarned: false,
  };
}

/** A builder whose app builds client and SSR in parallel, SSR slowly,
 *  unless `buildApp` builds otherwise. */
function parallelBuilder(
  root: string,
  buildApp: (app: ViteBuilder) => Promise<void> = async (app) => {
    await Promise.all([
      app.build(app.environments.client),
      app.build(app.environments.ssr),
    ]);
  }
) {
  const input = join(root, 'src', 'main.ts');
  // SAFETY: as above.
  const startParallelBuild = createBuilder as StartParallelBuild;
  return startParallelBuild({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [slowSsr, failClient, animusExtract({ system: './src/ds.ts' })],
    environments: {
      client: { build: { outDir: 'dist/client', rollupOptions: { input } } },
      ssr: {
        build: { outDir: 'dist/ssr', ssr: true, rollupOptions: { input } },
      },
    },
    builder: { buildApp },
  });
}
