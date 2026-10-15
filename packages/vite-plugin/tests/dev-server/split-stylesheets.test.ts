import { build } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import { animusExtract } from '../../src/index';
import { createDevFixture } from './fixture';

import type { StylesheetDelivery } from '../../src/index';

interface BuildOutput {
  output: Array<{ fileName: string; source?: unknown }>;
}

describe("stylesheets: 'split'", () => {
  // Contract: a split build's stylesheet files, linked in order after the
  // layer declaration, are byte for byte the one sheet a single build
  // emits, but for the newline Vite ends each file with. The cascade is
  // the single sheet's.
  it('links slices whose bytes in order are the single sheet', async () => {
    const app = createDevFixture();
    try {
      const run = async (stylesheets: StylesheetDelivery) =>
        // SAFETY: a build with no watcher and one environment returns one output.
        (await build({
          root: app.root,
          configFile: false,
          logLevel: 'silent',
          plugins: [animusExtract({ system: './src/ds.ts', stylesheets })],
          build: { write: false },
        })) as BuildOutput;

      const single = (await run('single')).output.filter((file) =>
        file.fileName.endsWith('.css')
      );
      expect(single).toHaveLength(1);

      const split = (await run('split')).output;
      const html = String(
        split.find((file) => file.fileName === 'index.html')?.source
      );
      const hrefs = [
        ...html.matchAll(
          /<link [^>]*href="\/([^"]+)"[^>]*data-animus-stylesheet>/g
        ),
      ].map(([, href]) => href!);
      expect(
        hrefs.map((href) => /^assets\/animus-([a-z]+)-/.exec(href)?.[1])
      ).toEqual(['foundation', 'components', 'utilities']);
      expect(html.indexOf('data-animus-layers')).toBeLessThan(
        html.indexOf('data-animus-stylesheet')
      );
      // No other stylesheet, and no script for a slice: the slices are the
      // whole sheet.
      expect(split.map((file) => file.fileName)).not.toContainEqual(
        expect.stringMatching(/animus-[a-z]+-.*\.js$/)
      );
      expect(
        split.filter((file) => file.fileName.endsWith('.css'))
      ).toHaveLength(3);

      const slices = hrefs.map((href) =>
        String(split.find((file) => file.fileName === href)?.source)
      );
      const joined = slices
        .map((css, index) =>
          index < slices.length - 1 ? css.replace(/\n$/, '') : css
        )
        .join('');
      expect(joined).toBe(String(single[0]!.source));
    } finally {
      app.dispose();
    }
  });
});
