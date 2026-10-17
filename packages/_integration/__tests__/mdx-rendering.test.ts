import { mdxUsageSource } from '@animus-ui/extract/pipeline';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { runPipeline } from './run-pipeline';

const FIXTURE_DIR = join(
  __dirname,
  '..',
  'fixtures',
  'components',
  'mdx-rendering'
);
const FIXTURES_ROOT = join(__dirname, '..', 'fixtures');

const componentEntry = {
  path: relative(FIXTURES_ROOT, join(FIXTURE_DIR, 'component.tsx')),
  source: readFileSync(join(FIXTURE_DIR, 'component.tsx'), 'utf-8'),
};

const mdxSource = readFileSync(join(FIXTURE_DIR, 'usage.mdx'), 'utf-8');
const mdxRelPath = relative(FIXTURES_ROOT, join(FIXTURE_DIR, 'usage.mdx'));

describe('MDX-only-rendered component extraction', () => {
  test('[Regression guard — MDX-only rendering extracts in prod mode]', async () => {
    // The `.tsx` suffix below is load-bearing: source type comes from the
    // path extension, and a bare `.mdx` path is never scanned.
    const result = mdxUsageSource(mdxSource, mdxRelPath);
    expect(result.kind).toBe('ok');
    const mdxEntry = {
      path: mdxRelPath + '.tsx',
      source: result.source!,
    };
    const { manifest, css } = runPipeline([componentEntry, mdxEntry]);
    expect(manifest.report.components_eliminated).toBe(0);
    expect(css).toMatch(/\.animus-MdxRenderedBox-\w+/);
    assertNoUnresolvedTokens(css);
  });

  test('Without MDX preprocessing, rendering is invisible (regression baseline)', () => {
    const { manifest } = runPipeline([componentEntry]);
    expect(manifest.report.components_eliminated).toBeGreaterThanOrEqual(1);
  });

  // Contract: a component an MDX document declares itself keeps its
  // identity uncertain even where it is spelled as the adapter's wrapper
  // would be, so a component it may hold keeps its CSS: the adapter names
  // its wrappers by names the document never spells, and only those are
  // quiet.
  test("a document's own component spelled as a wrapper stays uncertain", () => {
    const definitions = {
      path: 'components/mdx-rendering/collision.tsx',
      source:
        "import { ds } from '../../setup';\n" +
        "export const Box = ds.system({ space: true }).styles({ display: 'flex' }).asElement('div');\n" +
        "export const Layout = ds.styles({ display: 'block' }).asElement('div');\n" +
        "export const Ghost = ds.styles({ display: 'grid' }).asElement('div');\n",
    };
    const document =
      "import {Box, Layout} from './collision';\n" +
      "import {pickComponent} from 'unanalysed-factory';\n" +
      'export const _MDXContent0 = pickComponent();\n' +
      'export default Layout;\n\n' +
      '<_MDXContent0 />\n' +
      '<Box p="8" />\n';
    const result = mdxUsageSource(document, 'collision.mdx');
    if (result.kind !== 'ok') throw new Error(result.error);
    expect(result.synthesizedComponents).toEqual(['_MDXContent1']);
    const entry = {
      path: 'components/mdx-rendering/collision.mdx.tsx',
      source: result.source,
      synthesizedComponents: result.synthesizedComponents,
    };
    const { manifest, css } = runPipeline([definitions, entry]);
    const uncertain = manifest.diagnostics
      .filter(
        (diagnostic: { code?: string }) =>
          diagnostic.code === 'animus.usage.identity-uncertain-tag'
      )
      .map(
        (diagnostic: { message: string }) => diagnostic.message.split(' ')[0]
      );
    expect(uncertain).toContain('<_MDXContent0>');
    expect(uncertain).not.toContain('<_MDXContent1>');
    expect(css).toMatch(/display:\s*grid/);
    assertNoUnresolvedTokens(css);
  });
});
