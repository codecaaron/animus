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
    expect(out).not.toContain('\n  ');
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
