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

  // Contract: an MDX ESM block starts and ends where @mdx-js puts it. Each
  // row is one rule where that differs from a block that ends at a blank
  // line and starts after one; its rows are those @mdx-js 3.1.1 parses as
  // ESM. Its kept lines are those outside every content wrapper.
  const esmRows = (source: string) => {
    const result = mdxUsageSource(source, 'esm.mdx');
    if (result.kind !== 'ok') throw new Error(result.error);
    const out = result.source.split('\n');
    let inWrapper = false;
    const rows: number[] = [];
    source.split('\n').forEach((line, row) => {
      if (out[row]!.includes('function _MDXContent')) inWrapper = true;
      if (!inWrapper && line.trim() !== '' && out[row] === line) {
        rows.push(row + 1);
      }
      if (out[row]!.endsWith('</>; }')) inWrapper = false;
    });
    return { rows, source: result.source };
  };

  test.each([
    [
      'an open bracket continues across a blank line',
      'export const C = () => {\n  const a = 1;\n\n  return a;\n};\n\nText\n',
      [1, 2, 4, 5],
    ],
    [
      'an open template literal continues across a blank line',
      'export const t = `\nline\n\n# not a heading\n`;\n\nText\n',
      [1, 2, 4, 5],
    ],
    [
      'an open block comment continues across a blank line',
      'export const a = 1;\n/* note\n\nmore\n*/\n\nText\n',
      [1, 2, 4, 5],
    ],
    [
      'an unfinished statement continues across a blank line',
      "import { a }\n\nfrom 'x';\n\nText\n",
      [1, 3],
    ],
    [
      'a keyword opens a block only with a space after it',
      'export{}\n\nexport\tconst a = 1\n\nText\n',
      [],
    ],
    [
      'a block opens right after a line that closes a paragraph',
      '<StoryEmbed id="x" />\nimport A from \'./a.mdx\';\n\n# Title\nexport const b = 1;\n\nText\n',
      [2, 5],
    ],
    [
      'a JSX flow closing tag ends its block after inner paragraph text',
      "<div>\ntext\n</div>\nimport R from './r';\n\n<R />\n",
      [4],
    ],
    [
      'a line blank but for its quote marker ends the quoted paragraph',
      "> text\n>\nimport R from './r';\n\n<R />\n",
      [3],
    ],
  ])('%s', (_rule, source, rows) => {
    expect(esmRows(source).rows).toEqual(rows);
  });

  // Contract: a line ends at LF, CRLF or a lone CR, as micromark ends it,
  // and every line keeps its row.
  test.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('a line ends at %s', (_name, eol) => {
    const result = mdxUsageSource(
      `export const x = 1${eol}${eol}<X />`,
      'eol.mdx'
    );
    if (result.kind !== 'ok') throw new Error(result.error);
    const out = result.source.split('\n');
    expect(out[0]!.trimEnd()).toBe('export const x = 1');
    expect(out[1]).toContain('{ X } = _components');
    expect(out[2]).toMatch(/^<X \/>/);
  });

  test('a block inside an element is the module’s, below the content', () => {
    const element = "<Box>\nimport A from './a';\n\n<A />\n</Box>\n";
    const { rows, source } = esmRows(element);
    expect(rows).toEqual([]);
    const lines = source.split('\n');
    expect(lines[1]!.trim()).toBe('');
    expect(lines).toContain("import A from './a';");
    expect(source).toContain('{ Box } = _components');
    expect(source).not.toMatch(/\{[^}]*\bA\b[^}]*\} = _components/);
  });

  test('the default extensions include .mdx', () => {
    expect(DEFAULT_EXTENSIONS).toEqual(['.ts', '.tsx', '.js', '.jsx', '.mdx']);
  });
});
