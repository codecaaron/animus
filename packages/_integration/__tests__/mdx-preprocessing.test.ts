import {
  DEFAULT_EXTENSIONS,
  mdxUsageSource,
} from '@animus-ui/extract/pipeline';
import { describe, expect, test } from 'vitest';

/**
 * Contract: an MDX file is read, with no MDX compiler, as the TSX it
 * renders. Its imports, exports, JSX tags and expressions keep their line
 * and column; markdown, code and frontmatter are blanked, so a tag in code
 * renders nothing. A tag the file does not import comes from the provider's
 * components, and markdown syntax renders the provider's element components
 * with no props of their own. MDX the host would reject is an error.
 */
describe('mdxUsageSource', () => {
  const doc = [
    "import { Box } from './Box';",
    '',
    '# Title {meta.x}',
    '',
    'Some *text*, `<Box size="code" />` and <Box size="lg">**md**</Box>.',
    '',
    '```tsx',
    '<Box size="fence" />',
    '```',
    '',
    '- ```jsx',
    '  <Box size="listed" />',
    '  ```',
    '',
    '<Callout',
    "  tone={'warn'}",
    '>',
    '  - item <Badge />',
    '</Callout>',
  ].join('\n');

  test('keeps what the file renders at its own line and column', () => {
    const { kind, source } = mdxUsageSource(doc, 'doc.mdx');
    expect(kind).toBe('ok');
    const lines = source!.split('\n');
    const original = doc.split('\n');
    expect(lines[0]).toBe(original[0]);
    // The region's wrapper opens on the blank line after the imports.
    for (const kept of [
      '{meta.x}',
      '<Box size="lg">',
      '</Box>',
      "tone={'warn'}",
      '<Badge />',
    ]) {
      const row = original.findIndex((line) => line.includes(kept));
      expect(lines[row]!.indexOf(kept)).toBe(original[row]!.indexOf(kept));
    }
    expect(source).not.toContain('size="code"');
    expect(source).not.toContain('size="fence"');
    expect(source).not.toContain('size="listed"');
    expect(source).not.toContain('text');
  });

  test('takes unimported tags from the provider and renders markdown through it', () => {
    const { source } = mdxUsageSource(doc, 'doc.mdx');
    expect(source).toContain('{ Callout, Badge } = _components');
    expect(source).toContain('<_components.h1 />');
    expect(source).toContain('<_components.li />');
    expect(source).toMatch(/export default function MDXContent/);
    expect(source).toContain('/* @mdx-source: doc.mdx */');
  });

  test('lists every builder call, wherever it is written', () => {
    const result = mdxUsageSource(
      "import { ds } from './ds';\n\nexport const make = () => ds.styles({}).asElement('div');\n\n<Show when={() => ns.Card.extend()} />\n",
      'calls.mdx'
    );
    expect(result.kind === 'ok' && result.builderCalls).toEqual([
      'line 3: ds.styles(',
      'line 3: .asElement(',
      'line 5: ns.Card.extend(',
    ]);
  });

  test.each([
    ['unclosed element', '# X\n\n<Unclosed>\n'],
    ['unterminated expression', '{'],
    ['mismatched closing tag', '<A></B>'],
  ])('%s is an error', (_label, source) => {
    const result = mdxUsageSource(source, 'broken.mdx');
    expect(result.kind).toBe('error');
    expect(result.error).toEqual(expect.any(String));
    expect(result.source).toBeUndefined();
  });

  test('the default extensions include .mdx', () => {
    expect(DEFAULT_EXTENSIONS).toEqual(['.ts', '.tsx', '.js', '.jsx', '.mdx']);
  });
});
