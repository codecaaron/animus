import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { build, createServer } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

/** A fixture whose entry imports Animus's stylesheet and nothing with a
 *  component, with one declared vendor sheet inside the root and one
 *  outside it, each with an image. */
function globalOnlyFixture() {
  const fixture = createDevFixture();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'animus-outside-')));
  writeFileSync(join(outside, 'far.png'), Buffer.alloc(9000, 7));
  writeFileSync(
    join(outside, 'outside.css'),
    '.vendor-outside{background:url(./far.png)}\n'
  );
  fixture.write(
    'vendor/vendor.css',
    '.vendor-only{background:url(./img/near.png)}\n'
  );
  fixture.write('vendor/img/near.png', Buffer.alloc(9000, 3));
  fixture.write('src/main.ts', "import 'virtual:animus/styles.css';\n");
  return {
    root: fixture.root,
    write: fixture.write,
    plugin: animusExtract({
      system: './src/ds.ts',
      quarantine: {
        sheets: ['./vendor/vendor.css', join(outside, 'outside.css')],
      },
    }),
    dispose() {
      fixture.dispose();
      rmSync(outside, { recursive: true, force: true });
    },
  };
}

describe('quarantine delivers declared sheets with Animus stylesheet', () => {
  // Contract: the declared sheets arrive wherever Animus's stylesheet does,
  // at its head in `anm-vendor`, so an entry with no component, only
  // Animus's stylesheet, delivers them too, once even when a module also
  // imports one. Their URLs resolve to emitted assets, a file outside the
  // root included.
  it('delivers them through a global-only entry in a build', async () => {
    const app = globalOnlyFixture();
    try {
      app.write(
        'src/main.ts',
        "import 'virtual:animus/styles.css';\nimport '../vendor/vendor.css';\n"
      );
      // SAFETY: a build with no watcher and one environment returns one output.
      const output = (await build({
        root: app.root,
        configFile: false,
        logLevel: 'silent',
        plugins: [app.plugin],
        build: {
          write: false,
          minify: false,
          rollupOptions: { input: join(app.root, 'src/main.ts') },
        },
      })) as { output: Array<{ fileName: string; source?: unknown }> };
      const files = output.output.map((item) => item.fileName);
      const css = output.output
        .filter((item) => item.fileName.endsWith('.css'))
        .map((item) => String(item.source))
        .join('\n');
      expect(css).toMatch(/@layer anm-vendor\s*\{[^}]*\.vendor-only\{/);
      expect(css).toMatch(/@layer anm-vendor\s*\{[^}]*\.vendor-outside\{/);
      expect(css.split('.vendor-only{')).toHaveLength(2);
      for (const image of ['near', 'far']) {
        const asset = files.find((file) => file.startsWith(`assets/${image}-`));
        expect(asset, image).toBeDefined();
        expect(css).toContain(`/${asset}`);
      }
    } finally {
      app.dispose();
    }
  });

  // Contract: in development, a declared sheet's file outside the root is
  // served through `/@fs/`, its directory allowed.
  it('serves a file outside the root in development', async () => {
    const app = globalOnlyFixture();
    const server = await createServer({
      root: app.root,
      configFile: false,
      logLevel: 'silent',
      plugins: [app.plugin],
      server: { port: 0 },
    });
    try {
      await server.listen();
      const base = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
      const css = await (
        await fetch(`${base}/@id/__x00__virtual:animus/styles.css`)
      ).text();
      expect(css).toContain('.vendor-only{');
      const far = /url\(\\"(\/@fs[^"\\]+far\.png)\\"\)/.exec(css)?.[1];
      expect(far).toBeDefined();
      expect((await fetch(`${base}${far}`)).status).toBe(200);
    } finally {
      await server.close();
      app.dispose();
    }
  });
});
