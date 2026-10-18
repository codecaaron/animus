import { postProcessCss } from '@animus-ui/extract/pipeline';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { Features } from 'lightningcss';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveConfig } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { applyResolvedConfig } from '../src/config';
import { PluginContext } from '../src/context';

import type { InlineConfig } from 'vite';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function resolvedContext(
  config: InlineConfig,
  options: { targets?: string; browserslist?: string } = {},
  command: 'build' | 'serve' = 'build'
) {
  const root = mkdtempSync(join(tmpdir(), 'animus-lightning-'));
  roots.push(root);
  if (options.browserslist) {
    writeFileSync(join(root, '.browserslistrc'), options.browserslist);
  }
  const ctx = new PluginContext(
    { system: './ds.ts', targets: options.targets },
    () => ({})
  );
  applyResolvedConfig(
    ctx,
    await resolveConfig(
      { configFile: false, root, logLevel: 'silent', ...config },
      command
    )
  );
  return ctx;
}

const version = (major: number, minor = 0) => (major << 16) | (minor << 8);

function passOptions(ctx: PluginContext) {
  if (!ctx.lightning)
    throw new Error('configResolved left no Lightning CSS settings');
  return { minify: true, ...ctx.lightning };
}

describe("Animus's Lightning CSS pass follows Vite's CSS settings", () => {
  // Contract: with no targets and no browserslist, Animus targets Vite's
  // cssTarget; a browserslist config, then the targets option, come first.
  it('targets the targets option, then a browserslist config, then build.cssTarget', async () => {
    const build = { cssTarget: ['chrome100', 'safari15.4'] };
    const fromVite = await resolvedContext({ build });
    const fromBrowserslist = await resolvedContext(
      { build },
      { browserslist: 'firefox 120' }
    );
    const fromOption = await resolvedContext(
      { build },
      { browserslist: 'firefox 120', targets: 'edge 120' }
    );
    const lowersNothing = await resolvedContext({
      build: { cssTarget: false },
    });

    expect(fromVite.lightning?.targets).toEqual({
      chrome: version(100),
      safari: version(15, 4),
    });
    expect(fromBrowserslist.lightning?.targets).toEqual({
      firefox: version(120),
    });
    expect(fromOption.lightning?.targets).toEqual({ edge: version(120) });
    expect(lowersNothing.lightning?.targets).toEqual({});
    // Vite's Lightning CSS transformer compiles CSS for its own targets,
    // served or built; the dev component sheet never passes through it.
    for (const command of ['serve', 'build'] as const) {
      const fromTransformer = await resolvedContext(
        {
          build,
          css: {
            transformer: 'lightningcss',
            lightningcss: { targets: { safari: version(15) } },
          },
        },
        {},
        command
      );
      expect(fromTransformer.lightning?.targets).toEqual({
        safari: version(15),
      });
    }
    // The Session's own pass, and its lowered :dir() report, follow the same.
    expect(fromVite.session?.hostLightning).toBe(fromVite.lightning);
  });

  // Contract: Animus's pass includes and excludes what Vite's own Lightning
  // CSS pass does (css.lightningcss).
  it("excludes what Vite's css.lightningcss excludes", async () => {
    const css = '.a { outline-color: color(display-p3 0 1 0); }';
    const lowering = await resolvedContext({});
    const excluding = await resolvedContext({
      css: { lightningcss: { exclude: Features.P3Colors } },
    });

    const lowered = postProcessCss(css, passOptions(lowering));
    const kept = postProcessCss(css, passOptions(excluding));

    expect(lowered).toMatch(/outline-color:#[0-9a-f]+;/);
    expect(kept).toBe('.a{outline-color:color(display-p3 0 1 0)}');
  });
});
