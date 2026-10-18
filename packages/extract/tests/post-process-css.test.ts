import { describe, expect, test, vi } from 'vitest';

import {
  postProcessCss,
  resolveLightningTargets,
} from '../pipeline/post-process-css';

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
    expect(out).not.toContain('\n');
    expect(out).not.toContain('  ');
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

  // Contract: targets that lower `:dir()` report it, and `keepDirSelector`
  // keeps it as written.
  test('a lowered :dir() is reported, and keepDirSelector keeps it', () => {
    const css = '.a:dir(rtl) { margin-left: 4px; }';
    const onLoweredDir = vi.fn();
    const lowered = postProcessCss(css, {
      minify: true,
      targets: SAFARI15,
      onLoweredDir,
    });
    expect(lowered).not.toContain(':dir(');
    expect(onLoweredDir).toHaveBeenCalledTimes(1);
    for (const opts of [
      { targets: SAFARI15, keepDirSelector: true },
      { targets: CHROME120 },
    ]) {
      const kept = postProcessCss(css, { minify: true, ...opts, onLoweredDir });
      expect(kept).toBe('.a:dir(rtl){margin-left:4px}');
    }
    expect(onLoweredDir).toHaveBeenCalledTimes(1);
  });

  // Contract: keepDirSelector changes no CSS output except :dir().
  test('keepDirSelector leaves every other selector as the targets compile it', () => {
    const css = [
      '.mix, .x::-webkit-scrollbar { width: 8px; }',
      'input:autofill { color: red; }',
      '.f:fullscreen { color: red; }',
      '.l:lang(en, fr) { color: blue; }',
      '.n:not(.e, .f) { color: green; }',
      '.i:is(.h, .j) { color: teal; }',
      '.b { & .c { color: gray; } }',
    ].join('\n');
    for (const query of [
      'defaults',
      'last 2 versions, firefox esr, safari >= 13',
      'safari 15',
      'chrome 120',
    ]) {
      const targets = resolveLightningTargets(query, process.cwd());
      for (const minify of [true, false]) {
        expect(
          postProcessCss(css, { minify, targets, keepDirSelector: true })
        ).toBe(postProcessCss(css, { minify, targets }));
      }
    }
  });

  // Contract: a transform the cache answers still reports its diagnostics.
  test('a repeated transform reports a lowered :dir() and a failure each time', () => {
    const onLoweredDir = vi.fn();
    const warnFn = vi.fn();
    const broken = '.a { color: ; @}} nonsense';
    for (let pass = 0; pass < 2; pass++) {
      const lowered = postProcessCss('.r:dir(rtl) { margin-left: 2px; }', {
        minify: true,
        targets: SAFARI15,
        onLoweredDir,
      });
      expect(lowered).not.toContain(':dir(');
      expect(
        postProcessCss(broken, { minify: true, targets: CHROME120, warnFn })
      ).toBe(broken);
    }
    expect(onLoweredDir).toHaveBeenCalledTimes(2);
    expect(warnFn).toHaveBeenCalledTimes(2);
  });

  // Contract: the cache answers only the input and options it transformed.
  test('one input under each other option transforms again', () => {
    const css = '.a:dir(rtl) { backdrop-filter: blur(2px); }';
    const options = [
      { minify: true, targets: SAFARI15 },
      { minify: false, targets: SAFARI15 },
      { minify: true, targets: CHROME120 },
      { minify: true, targets: SAFARI15, keepDirSelector: true },
    ];
    const first = options.map((opts) => postProcessCss(css, opts));
    expect(new Set(first).size).toBe(options.length);
    expect(options.map((opts) => postProcessCss(css, opts))).toEqual(first);
  });

  test('targets a prototype names are part of the input', () => {
    const css = '.inherited:dir(rtl) { backdrop-filter: blur(2px); }';
    const inherited: typeof SAFARI15 = Object.create(SAFARI15);
    const lowered = postProcessCss(css, { minify: true, targets: inherited });
    expect(lowered).toBe(
      postProcessCss(css, { minify: true, targets: SAFARI15 })
    );
    let reported = false;
    const untargeted = postProcessCss(css, {
      minify: true,
      targets: {},
      onLoweredDir: () => {
        reported = true;
      },
    });
    expect(untargeted).not.toBe(lowered);
    expect(untargeted).toContain(':dir(rtl)');
    expect(reported).toBe(false);
  });

  test('empty input passes through untouched', () => {
    expect(postProcessCss('', { minify: true, targets: CHROME120 })).toBe('');
  });
});

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
    expect(order.filter((i) => i < 0)).toEqual([]);
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
