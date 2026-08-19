import { describe, expect, test, vi } from 'vitest';

import {
  postProcessCss,
  resolveLightningTargets,
} from '../pipeline/post-process-css';

// Fixed targets so assertions don't depend on the repo's browserslist.
const SAFARI15 = resolveLightningTargets('safari 15', process.cwd());
const CHROME120 = resolveLightningTargets('chrome 120', process.cwd());

describe('postProcessCss', () => {
  test('prod mode minifies and autoprefixes for the targets', () => {
    const css = [
      '@layer anm-base {',
      '  .card {',
      '    backdrop-filter: blur(8px);',
      '    display: flex;',
      '  }',
      '}',
    ].join('\n');

    const out = postProcessCss(css, { minify: true, targets: SAFARI15 });
    expect(out).toContain('-webkit-backdrop-filter:blur(8px)');
    // Minification removes unnecessary newlines and indentation entirely.
    expect(out).not.toContain('\n');
    expect(out).not.toContain('  ');
    // Layer wrapper preserved
    expect(out).toContain('@layer anm-base');
  });

  test('dev mode autoprefixes without collapsing formatting', () => {
    const css = '.card {\n  backdrop-filter: blur(8px);\n}\n';
    const out = postProcessCss(css, { minify: false, targets: SAFARI15 });
    expect(out).toContain('-webkit-backdrop-filter');
    expect(out).toContain('\n');
  });

  test('does not add prefixes the targets do not need', () => {
    const out = postProcessCss('.a { display: flex; }', {
      minify: true,
      targets: CHROME120,
    });
    expect(out).not.toContain('-webkit-');
  });

  test('preserves var() references and :root declarations', () => {
    const css =
      ':root { --colors-primary: #ff2800; }\n.a { color: var(--colors-primary); }';
    const out = postProcessCss(css, { minify: true, targets: CHROME120 });
    expect(out).toContain('var(--colors-primary)');
    expect(out).toContain('--colors-primary:#ff2800');
  });

  test('degrades gracefully on malformed CSS with a contextual warning', () => {
    const warnFn = vi.fn();
    const broken = '.a { color: ; @}} nonsense';
    const out = postProcessCss(broken, {
      minify: true,
      targets: CHROME120,
      warnFn,
    });
    expect(out).toBe(broken);
    expect(warnFn).toHaveBeenCalledTimes(1);
    expect(String(warnFn.mock.calls[0][0])).toContain(
      'Lightning CSS post-processing failed'
    );
  });

  test('empty input passes through untouched', () => {
    expect(postProcessCss('', { minify: true, targets: CHROME120 })).toBe('');
  });
});

// Ported from packages/vite-plugin/tests/post-process.test.ts (deleted): that
// suite ran a test-local Lightning CSS mirror and never executed this
// production helper. These are the css-post-processing spec scenarios the
// mirror alone witnessed, now against the real export with fixed targets.
describe('postProcessCss — layer topology (css-post-processing spec)', () => {
  test('preserves all six cascade layer blocks in declared order', () => {
    const input = [
      '@layer anm-global, anm-base, anm-variants, anm-states, anm-system, anm-custom;',
      '@layer anm-global { body { margin: 0; } }',
      '@layer anm-base { .animus-Box-abc12345 { display: flex; } }',
      '@layer anm-variants { .animus-Box-abc12345--size-sm { padding: 0.5rem; } }',
      '@layer anm-states { .animus-Box-abc12345--disabled { opacity: 0.4; } }',
      '@layer anm-system { .animus-u-def67890 { margin-top: 1rem; } }',
      '@layer anm-custom { .animus-dyn-aabb1122-density { line-height: var(--animus-density); } }',
    ].join('\n');

    const out = postProcessCss(input, { minify: true, targets: CHROME120 });

    const blockIdx = (name: string) => out.indexOf(`@layer ${name}{`);
    const order = [
      'anm-global',
      'anm-base',
      'anm-variants',
      'anm-states',
      'anm-system',
      'anm-custom',
    ].map(blockIdx);
    // Every block survives...
    expect(order.filter((i) => i < 0)).toEqual([]);
    // ...in declared order.
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('does not merge layer blocks with different names', () => {
    const input =
      '@layer anm-base { .a { color: red; } }\n@layer anm-system { .b { color: blue; } }';
    const out = postProcessCss(input, { minify: true, targets: CHROME120 });
    expect(out).toContain('@layer anm-base{');
    expect(out).toContain('@layer anm-system{');
  });

  test('preserves a slot variable nested under @media + @layer', () => {
    const input = [
      '@layer anm-system { .animus-dyn-p { padding: var(--animus-p); } }',
      '@media (min-width: 768px) {',
      '  @layer anm-system { .animus-dyn-p-sm { padding: var(--animus-p-sm); } }',
      '}',
    ].join('\n');
    const out = postProcessCss(input, { minify: true, targets: CHROME120 });
    expect(out).toContain('var(--animus-p)');
    expect(out).toContain('var(--animus-p-sm)');
    expect(out).toContain('@media');
  });

  test('prefixes user-select for Safari targets, preserving the original', () => {
    const out = postProcessCss('.foo { user-select: none; }', {
      minify: false,
      targets: SAFARI15,
    });
    expect(out).toContain('-webkit-user-select');
    expect(out).toContain('user-select: none');
  });
});
