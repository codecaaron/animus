import { preprocessMdx } from '@animus-ui/extract/pipeline';
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
    const result = await preprocessMdx(mdxSource, mdxRelPath);
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
});
