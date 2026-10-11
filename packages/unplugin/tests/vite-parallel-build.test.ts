import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createBuilder } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import {
  createDevFixture,
  INITIAL_BRAND_HEX,
  themeSource,
} from '../../vite-plugin/tests/dev-server/fixture';
import { animusUnplugin } from '../src/index';

import type { ViteBuilder } from 'vite-plus';

interface EnvironmentBuild {
  build: {
    outDir: string;
    ssr?: true;
    emitAssets?: true;
    rollupOptions: { input: string };
  };
}

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

/** Delays every SSR transform, so the client environment ends first. */
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

interface ParallelBuildConfig {
  root: string;
  configFile: false;
  logLevel: 'silent';
  plugins: Array<
    ReturnType<typeof animusUnplugin.vite> | typeof failClient | typeof slowSsr
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

  it('a builder reused while an earlier build still runs keeps that build its assets', async () => {
    const fixture = createDevFixture();
    try {
      // A copied asset: an image scale value the Badge background reads.
      fixture.write(
        'assets/badge.svg',
        '<svg xmlns="http://www.w3.org/2000/svg"/>\n'
      );
      fixture.write(
        'src/theme.ts',
        `${themeSource(INITIAL_BRAND_HEX)
          .replace(
            "import { createTheme } from '@animus-ui/system';",
            "import { asset, createTheme } from '@animus-ui/system';"
          )
          .replace(
            '  .build();',
            `  .addScale({
    name: 'images',
    values: { badge: \`url("\${asset('./assets/badge.svg')}")\` },
  })
  .build();`
          )}`
      );
      fixture.write(
        'src/Badge.ts',
        "import { ds } from './ds';\n\nexport const Badge = ds\n  .styles({ backgroundImage: '{images.badge}' })\n  .asElement('span');\n"
      );
      fixture.write(
        'src/main.ts',
        "import { Badge } from './Badge';\nimport { Button } from './Button';\n\nexport const roots = [Badge, Button];\n"
      );
      const input = join(fixture.root, 'src', 'main.ts');
      // Every environment build either app starts, in order.
      const builds: Array<Promise<object | void>> = [];
      // SAFETY: as above.
      const startParallelBuild = createBuilder as StartParallelBuild;
      const builder = await startParallelBuild({
        root: fixture.root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          slowSsr,
          failClient,
          animusUnplugin.vite({ system: './src/ds.ts', root: fixture.root }),
        ],
        environments: {
          client: {
            build: { outDir: 'dist/client', rollupOptions: { input } },
          },
          // SSR emits assets too, so its stylesheet's asset must be there.
          ssr: {
            build: {
              outDir: 'dist/ssr',
              ssr: true,
              emitAssets: true,
              rollupOptions: { input },
            },
          },
        },
        builder: {
          async buildApp(app) {
            const started = [
              app.build(app.environments.client),
              app.build(app.environments.ssr),
            ];
            builds.push(...started);
            await Promise.all(started);
          },
        },
      });
      // The client fails at once; the slow SSR build is still running when
      // the builder is reused.
      failing.client = true;
      await expect(builder.buildApp()).rejects.toThrow(
        'planned client failure'
      );
      failing.client = false;
      await builder.buildApp();

      const [, originalSsr] = await Promise.allSettled(builds);
      expect(originalSsr.status).toBe('fulfilled');
      const output =
        originalSsr.status === 'fulfilled'
          ? JSON.stringify(originalSsr.value)
          : '';
      expect(output).toMatch(/assets\/badge[^"]*\.svg/);
      expect(output).toMatch(/"fileName":"[^"]*badge[^"]*\.svg"/);
    } finally {
      failing.client = false;
      fixture.dispose();
    }
  });
});
