import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createBuilder } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import { createDevFixture } from '../../vite-plugin/tests/dev-server/fixture';
import { animusUnplugin } from '../src/index';

import type { ViteBuilder } from 'vite-plus';

interface EnvironmentBuild {
  build: { outDir: string; ssr?: true; rollupOptions: { input: string } };
}

interface ParallelBuildConfig {
  root: string;
  configFile: false;
  logLevel: 'silent';
  plugins: Array<ReturnType<typeof animusUnplugin.vite>>;
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
 * A custom Vite `buildApp` builds environments in parallel on one plugin
 * instance: they share one pipeline and one Session, never claiming the
 * build twice.
 */
describe('unplugin under Vite with environments built in parallel', () => {
  it('both environments build from one shared analysis', async () => {
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
        plugins: [
          animusUnplugin.vite({ system: './src/ds.ts', root: fixture.root }),
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
