import { build } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

import type { StylesheetDelivery } from '../../src/index';
import type { InlineConfig } from 'vite-plus';

interface BuildOutput {
  output: Array<{ fileName: string; source?: unknown; code?: string }>;
}

/** The fixture app with its own CSS imported before and after the
 *  components, so Vite bundles it into the stylesheet's chunk on both
 *  sides of Animus's sheet. */
function appWithOwnCss() {
  const app = createDevFixture();
  app.write('src/before.css', ':root{--color-brand-500:blue}\n');
  app.write('src/after.css', '.after{color:green}\n');
  app.write(
    'src/main.ts',
    "import './before.css';\nimport { Button } from './Button';\nimport { Sentinel } from './Sentinel';\nimport './after.css';\n\nexport const roots = [Button, Sentinel];\n"
  );
  return app;
}

async function buildApp(
  root: string,
  stylesheets: StylesheetDelivery,
  config: InlineConfig = {}
): Promise<{ html: string; linked: string[]; output: BuildOutput['output'] }> {
  // SAFETY: a build with no watcher and one environment returns one output.
  const { output } = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [animusExtract({ system: './src/ds.ts', stylesheets })],
    build: { write: false, cssMinify: false },
    ...config,
  })) as BuildOutput;
  const html = String(
    output.find((file) => file.fileName === 'index.html')?.source
  );
  const linked = [
    ...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g),
  ].map(([, href]) => href!);
  return { html, linked, output };
}

describe("stylesheets: 'split'", () => {
  // Contract: a split build's page links the stylesheet's slices exactly
  // where the single build's page has Animus's sheet, among the app's own
  // CSS, so the stylesheets the page links, in order, are the single
  // build's byte for byte, line breaks aside. The cascade is the single
  // sheet's.
  it('links the slices where the single sheet sat among the app CSS', async () => {
    const app = appWithOwnCss();
    try {
      // Line breaks aside: Vite ends each file it writes with one, and a
      // CSS string holds none.
      const sheets = (built: Awaited<ReturnType<typeof buildApp>>) =>
        built.linked
          .map((href) =>
            String(
              built.output.find((file) => `/${file.fileName}` === href)?.source
            )
          )
          .join('')
          .replace(/\n/g, '');
      const single = await buildApp(app.root, 'single');
      const split = await buildApp(app.root, 'split');
      expect(
        split.linked.map((href) => /animus-([a-z]+)-/.exec(href)?.[1] ?? 'app')
      ).toEqual(['app', 'foundation', 'components', 'utilities', 'app']);
      expect(split.html.indexOf('data-animus-layers')).toBeLessThan(
        split.html.indexOf('rel="stylesheet"')
      );
      expect(sheets(split)).toBe(sheets(single));
      // No script for a slice.
      expect(split.output.map((file) => file.fileName)).not.toContainEqual(
        expect.stringMatching(/animus-[a-z]+-.*\.js$/)
      );
    } finally {
      app.dispose();
    }
  });

  // Contract: where no app CSS shares the stylesheet's chunk and no script
  // can preload that chunk's CSS, the build emits no empty file in its
  // place, and Vite's manifests stay valid JSON whose every CSS file the
  // build emits, the slices listed where the empty file was.
  it('emits no empty file where the stylesheet has its chunk alone', async () => {
    const app = createDevFixture();
    try {
      // Two pages share the stylesheet's chunk, which the manifest records
      // with its own CSS file.
      app.write(
        'other.html',
        '<!doctype html><html><body><script type="module" src="/src/other.ts"></script></body></html>\n'
      );
      app.write('src/other.ts', "export { Button } from './Button';\n");
      const { output } = await buildApp(app.root, 'split', {
        base: './',
        build: {
          write: false,
          cssMinify: false,
          manifest: true,
          ssrManifest: true,
          rolldownOptions: { input: ['index.html', 'other.html'] },
        },
      });
      const sheets = output.filter((file) => file.fileName.endsWith('.css'));
      expect(sheets.filter((file) => String(file.source) === '')).toEqual([]);
      const emitted = new Set(sheets.map((file) => file.fileName));
      const slices = sheets
        .map((file) => file.fileName)
        .filter((name) => /animus-/.test(name));
      expect(slices).toHaveLength(3);
      for (const name of ['.vite/manifest.json', '.vite/ssr-manifest.json']) {
        const source = output.find((file) => file.fileName === name)?.source;
        // SAFETY: Vite writes the build manifest as records, each with its
        // file and CSS list, and the SSR manifest as URLs by module.
        const manifest = JSON.parse(String(source)) as Record<
          string,
          string[] | { file: string; css?: string[] }
        >;
        const named = Object.values(manifest)
          .flatMap((entry) =>
            Array.isArray(entry) ? entry : [entry.file, ...(entry.css ?? [])]
          )
          .filter((url) => url.endsWith('.css'))
          .map((url) => url.replace(/^\.\//, ''));
        expect(named).toEqual(expect.arrayContaining(slices));
        expect(named.filter((file) => !emitted.has(file))).toEqual([]);
      }
    } finally {
      app.dispose();
    }
  });

  // Contract: no lazy chunk's preload list names a stylesheet the build
  // does not emit, under any file name or URL the host gives it.
  it("keeps every file a lazy chunk's preload list names", async () => {
    const app = createDevFixture();
    try {
      app.write(
        'src/main.ts',
        "import { Button } from './Button';\n\nexport const roots = [Button];\ndocument.addEventListener('click', () => import('./Route').then((route) => route.open()));\n"
      );
      // A preload of a lazy chunk it loads lists the entry's CSS, which
      // that chunk imports.
      app.write(
        'src/Route.ts',
        "export const open = () => import('./Page');\n"
      );
      app.write('src/Page.ts', "export { Button } from './Button';\n");
      const { output } = await buildApp(app.root, 'split', {
        experimental: {
          renderBuiltUrl: (fileName) => `/${encodeURI(fileName)}`,
        },
        build: {
          write: false,
          cssMinify: false,
          rolldownOptions: {
            output: { assetFileNames: 'assets/é-[name]-[hash][extname]' },
          },
        },
      });
      const emitted = new Set(output.map((file) => file.fileName));
      const preloaded = output.flatMap((file) => {
        const list = /m\.f=(\[[^\]]*\])/.exec(file.code ?? '')?.[1];
        // SAFETY: Vite writes the preload list as an array of URL strings.
        return list ? (JSON.parse(list) as string[]) : [];
      });
      expect(preloaded.filter((url) => url.endsWith('.css'))).not.toEqual([]);
      expect(
        preloaded.filter((url) => !emitted.has(decodeURI(url).slice(1)))
      ).toEqual([]);
    } finally {
      app.dispose();
    }
  });

  // Contract: a slice's link names its URL as Vite names its own, through
  // the host's `renderBuiltUrl`.
  it('links the slices at the URLs renderBuiltUrl gives', async () => {
    const app = appWithOwnCss();
    try {
      const { linked } = await buildApp(app.root, 'split', {
        base: '/app/',
        experimental: {
          renderBuiltUrl: (fileName, { hostType }) =>
            hostType === 'html' ? `https://cdn.example/${fileName}` : undefined,
        },
      });
      expect(linked).toHaveLength(5);
      for (const href of linked) {
        expect(href).toMatch(/^https:\/\/cdn\.example\/assets\//);
      }
    } finally {
      app.dispose();
    }
  });
});
