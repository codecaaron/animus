import {
  DEFAULT_EXTENSIONS,
  preprocessMdx,
  type PreprocessMdxResult,
} from '@animus-ui/extract/pipeline';
import { describe, expect, test } from 'vitest';

/**
 * Direct unit/characterization tests for the MDX preprocessor.
 *
 * `preprocessMdx` (packages/extract/pipeline/mdx-preprocessor.ts) compiles an
 * MDX source string to scanner-consumable JSX via `@mdx-js/mdx`. Unlike
 * mdx-rendering.test.ts (which drives the OUTPUT through the full extraction
 * pipeline), this file exercises the preprocessor in isolation: its result
 * shape, the `ok` / `error` branches, and the (deliberately noted) unreachable
 * `missing-dep` branch.
 *
 * @mdx-js/mdx is an in-repo devDependency of both @animus-ui/extract and this
 * integration package, so the dynamic `import('@mdx-js/mdx')` resolves under
 * the real (vitest) runner.
 *
 * Placement: this lives beside the other pipeline-export consumers in
 * packages/_integration/__tests__ (the integration tier). packages/extract has
 * no vitest target in vite.config.ts's typescriptTestTargets, so this cannot
 * live under packages/extract.
 */

const MDX_WITH_COMPONENT = '# Hello\n\n<Box color="primary">hi there</Box>\n';

describe('preprocessMdx — successful compile (kind: "ok")', () => {
  test('compiles MDX-with-JSX to a JSX source string', async () => {
    const result = await preprocessMdx(MDX_WITH_COMPONENT, 'usage.mdx');
    expect(result.kind).toBe('ok');
    expect(typeof result.source).toBe('string');
    expect((result.source ?? '').length).toBeGreaterThan(0);
    // The `error` field is absent on success.
    expect(result.error).toBeUndefined();
  });

  test('prepends the "@mdx-source" provenance comment with the filename', async () => {
    const result = await preprocessMdx(MDX_WITH_COMPONENT, 'dir/deep/page.mdx');
    // The wrapper prefixes `/* @mdx-source: <filename> */\n` verbatim — the
    // filename is interpolated, not resolved/normalized.
    expect(result.source).toMatch(
      /^\/\* @mdx-source: dir\/deep\/page\.mdx \*\//
    );
  });

  test('emits an MDXContent component and keeps JSX (outputFormat "program", jsx: true)', async () => {
    const result = await preprocessMdx(MDX_WITH_COMPONENT, 'usage.mdx');
    // outputFormat: 'program' emits a full ESM module exporting MDXContent.
    expect(result.source).toContain('MDXContent');
    // jsx: true preserves element syntax rather than compiling to _jsx() calls,
    // so the referenced component binding stays visible as JSX.
    expect(result.source).toContain('Box');
  });

  test('plain markdown (no JSX) also compiles to "ok"', async () => {
    const result = await preprocessMdx(
      '# Title\n\nSome **bold** copy.',
      'md.mdx'
    );
    expect(result.kind).toBe('ok');
    expect(typeof result.source).toBe('string');
  });

  test('there is NO non-mdx passthrough: plain prose still runs through the compiler', async () => {
    // The module has no early-return passthrough branch; markdown/plaintext is
    // valid MDX, so even bare prose is compiled (not returned verbatim).
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
    expect(typeof result.error).toBe('string');
    expect((result.error ?? '').length).toBeGreaterThan(0);
    // On failure there is no compiled source.
    expect(result.source).toBeUndefined();
  });
});

describe('preprocessMdx — result shape contract (PreprocessMdxResult)', () => {
  test('kind is always one of the documented union members', async () => {
    const result: PreprocessMdxResult = await preprocessMdx('# ok\n', 'x.mdx');
    expect(['ok', 'missing-dep', 'error']).toContain(result.kind);
  });

  /**
   * Honestly-unreachable branch — DOCUMENTED GAP.
   *
   * The `{ kind: 'missing-dep' }` branch fires only when
   * `import('@mdx-js/mdx')` rejects. `preprocessMdx(source, filename)` takes no
   * injection seam — the specifier is hardcoded — and @mdx-js/mdx is installed
   * in-repo, so under the real runner the import always resolves. Forcing this
   * branch would require mocking the native dynamic import (which the dist keeps
   * as a real `import(...)`, so vi.mock cannot reliably intercept it without
   * destabilizing the other cases). Left uncovered on purpose.
   */
  test.todo('returns { kind: "missing-dep" } when @mdx-js/mdx is unresolvable');
});

describe('DEFAULT_EXTENSIONS (shared source of truth)', () => {
  test('is the frozen tuple of scanner extensions including .mdx', () => {
    expect(DEFAULT_EXTENSIONS).toEqual(['.ts', '.tsx', '.js', '.jsx', '.mdx']);
  });
});
