import { DEFAULT_EXTENSIONS, preprocessMdx } from '@animus-ui/extract/pipeline';
import { describe, expect, test } from 'vitest';

/**
 * The extract package has no vitest target, so unit coverage of its MDX
 * preprocessor lives in this tier.
 */

const MDX_WITH_COMPONENT = '# Hello\n\n<Box color="primary">hi there</Box>\n';

describe('preprocessMdx — successful compile (kind: "ok")', () => {
  test('compiles MDX-with-JSX to a JSX source string', async () => {
    const result = await preprocessMdx(MDX_WITH_COMPONENT, 'usage.mdx');
    expect(result.kind).toBe('ok');
    expect(result.source).toEqual(expect.any(String));
    expect((result.source ?? '').length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  test('prepends the "@mdx-source" provenance comment with the filename', async () => {
    const result = await preprocessMdx(MDX_WITH_COMPONENT, 'dir/deep/page.mdx');
    expect(result.source).toMatch(
      /^\/\* @mdx-source: dir\/deep\/page\.mdx \*\//
    );
  });

  test('emits an MDXContent component and keeps JSX (outputFormat "program", jsx: true)', async () => {
    const result = await preprocessMdx(MDX_WITH_COMPONENT, 'usage.mdx');
    expect(result.source).toContain('MDXContent');
    expect(result.source).toContain('Box');
  });

  test('plain markdown (no JSX) also compiles to "ok"', async () => {
    const result = await preprocessMdx(
      '# Title\n\nSome **bold** copy.',
      'md.mdx'
    );
    expect(result.kind).toBe('ok');
    expect(result.source).toEqual(expect.any(String));
  });

  test('there is NO non-mdx passthrough: plain prose still runs through the compiler', async () => {
    const result = await preprocessMdx('just some plain prose', 'plain.mdx');
    expect(result.kind).toBe('ok');
    expect(result.source).not.toBe('just some plain prose');
    expect(result.source).toContain('MDXContent');
  });
});

describe('preprocessMdx — compile failure (kind: "error")', () => {
  test.each([
    ['unclosed JSX tag', '# X\n\n<Unclosed>\n'],
    ['unterminated expression brace', '{'],
    ['unparseable expression', '{ 1 + }'],
  ])('%s -> { kind: "error", error: <message> }', async (_label, source) => {
    const result = await preprocessMdx(source, 'broken.mdx');
    expect(result.kind).toBe('error');
    expect(result.error).toEqual(expect.any(String));
    expect((result.error ?? '').length).toBeGreaterThan(0);
    expect(result.source).toBeUndefined();
  });
});

describe('preprocessMdx — result shape contract (PreprocessMdxResult)', () => {
  /** Reaching `missing-dep` needs `import('@mdx-js/mdx')` to reject; the
   *  specifier is hardcoded and the package is installed in-repo. */
  test.todo('returns { kind: "missing-dep" } when @mdx-js/mdx is unresolvable');
});

describe('DEFAULT_EXTENSIONS (shared source of truth)', () => {
  test('is the frozen tuple of scanner extensions including .mdx', () => {
    expect(DEFAULT_EXTENSIONS).toEqual(['.ts', '.tsx', '.js', '.jsx', '.mdx']);
  });
});
