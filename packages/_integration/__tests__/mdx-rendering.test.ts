/**
 * MDX-only-rendered component extraction regression tests.
 *
 * The file-discovery walk in both bundler adapters hardcodes .ts/.tsx/.js/.jsx
 * (historical state). The MDX arc added an `extensions?: string[]` config
 * option with `.mdx` in the default list, and a preprocessor at
 * `@animus-ui/extract/pipeline`'s `preprocessMdx()` that compiles MDX to
 * scanner-consumable JSX (with path rewrite to `.mdx.tsx` for the Rust
 * source-type helper).
 *
 * This test exercises the preprocessor end-to-end by importing it directly
 * from the pipeline module — same code path the plugin uses at buildStart.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { preprocessMdx } from '@animus-ui/extract/pipeline';

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
    // End-to-end: preprocess MDX via the shared pipeline preprocessor,
    // pass to runPipeline with the path rewritten to `.mdx.tsx` (matching
    // the plugin's internal buildStart rewrite).
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
    // Baseline: without the preprocessor, the .mdx usage is invisible.
    // Component is eliminated as unrendered. This guard ensures the
    // preprocessor is actually doing something (if both pass/fail together,
    // the primary test above isn't exercising the fix path).
    const { manifest } = runPipeline([componentEntry]);
    expect(manifest.report.components_eliminated).toBeGreaterThanOrEqual(1);
  });
});
