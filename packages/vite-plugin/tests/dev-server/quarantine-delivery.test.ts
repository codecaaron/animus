import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { build, createServer, searchForWorkspaceRoot } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

import type { ViteDevServer } from 'vite-plus';

/** A fixture whose entry imports Animus's stylesheet and nothing with a
 *  component, with one declared vendor sheet inside the root and one
 *  outside it, each with an image; the outside sheet's image lies in
 *  another directory. An app sheet an HTML link would load reaches the
 *  declared vendor sheet through another sheet and a supports condition. */
function globalOnlyFixture() {
  const fixture = createDevFixture();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'animus-outside-')));
  mkdirSync(join(outside, 'sheets'));
  mkdirSync(join(outside, 'assets'));
  writeFileSync(join(outside, 'assets/far.png'), Buffer.alloc(9000, 7));
  writeFileSync(
    join(outside, 'sheets/outside.css'),
    '.vendor-outside{background:url(../assets/far.png)}\n'
  );
  fixture.write(
    'src/linked.css',
    '@import "./mid.css";\n.linked-own{color:red}\n'
  );
  fixture.write(
    'src/mid.css',
    '@import "../vendor/vendor.css" supports(display: grid);\n'
  );
  fixture.write(
    'vendor/vendor.css',
    '.vendor-only{background:url(./img/near.png)}\n'
  );
  fixture.write('vendor/img/near.png', Buffer.alloc(9000, 3));
  fixture.write('src/main.ts', "import 'virtual:animus/styles.css';\n");
  return {
    root: fixture.root,
    outside,
    write: fixture.write,
    plugin: animusExtract({
      system: './src/ds.ts',
      quarantine: {
        sheets: ['./vendor/vendor.css', join(outside, 'sheets/outside.css')],
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
      // SAFETY: vite-plus runs Vite's build and consumes the same plugin hooks;
      // only the nominal declarations differ, and tsc overflows on them. A
      // build with no watcher and one environment returns one output.
      const runBuild = build as (config: {
        root: string;
        configFile: false;
        logLevel: 'silent';
        plugins: ReturnType<typeof animusExtract>[];
        build: {
          write: false;
          minify: false;
          rollupOptions: { input: string };
        };
      }) => Promise<{ output: Array<{ fileName: string; source?: unknown }> }>;
      const output = await runBuild({
        root: app.root,
        configFile: false,
        logLevel: 'silent',
        plugins: [app.plugin],
        build: {
          write: false,
          minify: false,
          rollupOptions: { input: join(app.root, 'src/main.ts') },
        },
      });
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

  // Contract: in development, a declared sheet's directory outside the
  // root is allowed when the server starts, beside Vite's default workspace
  // root; an asset it references elsewhere is served through `/@fs/` too.
  // A stylesheet an HTML link loads (`?direct`) is finished: what it
  // reaches of a declared sheet is layered.
  it('serves files outside the root and finishes linked stylesheets in development', async () => {
    const app = globalOnlyFixture();
    // SAFETY: vite-plus runs Vite's server and consumes the same plugin hooks;
    // only the nominal declarations differ, and tsc overflows on them.
    const startServer = createServer as (config: {
      root: string;
      configFile: false;
      logLevel: 'silent';
      plugins: ReturnType<typeof animusExtract>[];
      server: { port: number };
    }) => Promise<ViteDevServer>;
    const server = await startServer({
      root: app.root,
      configFile: false,
      logLevel: 'silent',
      plugins: [app.plugin],
      server: { port: 0 },
    });
    try {
      const allow = server.config.server.fs.allow;
      expect(allow).toContain(join(app.outside, 'sheets'));
      expect(allow).toContain(searchForWorkspaceRoot(app.root));
      await server.listen();
      const base = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
      const css = await (
        await fetch(`${base}/@id/__x00__virtual:animus/styles.css`)
      ).text();
      expect(css).toContain('.vendor-only{');
      const far = /url\(\\"(\/@fs[^"\\]+far\.png)\\"\)/.exec(css)?.[1];
      expect(far).toBeDefined();
      expect((await fetch(`${base}${far}`)).status).toBe(200);
      const linked = await (
        await fetch(`${base}/src/linked.css?direct`)
      ).text();
      expect(linked).toMatch(
        /@layer anm-vendor \{\s*@supports \(display: grid\) \{\s*\.vendor-only\{/
      );
      expect(linked).toMatch(/^\.linked-own\{/m);
    } finally {
      await server.close();
      app.dispose();
    }
  });
});
