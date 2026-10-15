import { build } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

import type { StylesheetDelivery } from '../../src/index';
import type { InlineConfig } from 'vite-plus';

interface BuildOutput {
  output: Array<{ fileName: string; source?: unknown }>;
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
