import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createBuilder } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

import type { ViteBuilder } from 'vite-plus';

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
  build: { outDir: string; ssr?: true; rollupOptions: { input: string } };
}

interface ParallelBuildConfig {
  root: string;
  configFile: false;
  logLevel: 'silent';
  plugins: Array<typeof slowSsr | ReturnType<typeof animusExtract>>;
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
});
