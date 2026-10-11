import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { BuildEnvironment, createBuilder } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

import type { ViteBuilder } from 'vite-plus';

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

  it('a second build of a running environment is refused, naming it', async () => {
    const fixture = createDevFixture();
    try {
      const builder = await parallelBuilder(fixture.root);
      // The client fails at once; the slow SSR build is still running.
      failing.client = true;
      await expect(builder.buildApp()).rejects.toThrow(
        'planned client failure'
      );
      failing.client = false;

      await expect(builder.buildApp()).rejects.toThrow(
        'a previous build of environment ssr is still running on this plugin instance'
      );
    } finally {
      failing.client = false;
      fixture.dispose();
    }
  });

  it('two environments under one name are refused, naming it', async () => {
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

      await expect(builder.buildApp()).rejects.toThrow(
        'two environments named client build on this plugin instance at once'
      );
    } finally {
      fixture.dispose();
    }
  });
});

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
