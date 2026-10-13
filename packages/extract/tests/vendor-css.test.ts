import { describe, expect, it } from 'vitest';

import { wrapVendorCss } from '../pipeline/vendor-css';

/**
 * Contract: a stylesheet Animus did not produce is wrapped in `anm-vendor`
 * with its text kept as written and every line at its number; its leading
 * `@charset`, `@import` and `@namespace` stay at the top (an import the
 * browser loads takes the vendor layer, nested under any it names), its
 * leading `@layer` lists move inside, a CSS Module's top-level `:export`
 * and `:import` rules stay at the top level, and `!important` and animations
 * are reported, never removed.
 */
describe('wrapVendorCss', () => {
  const sheet = [
    '@charset "utf-8";',
    '@layer base, comp;',
    '@import url("https://x.test/a.css") screen;',
    '@import "b.css" layer(own) supports(display: grid);',
    '@namespace svg url(http://www.w3.org/2000/svg);',
    '.a { *zoom: 1; color: red !important; }',
    '.s::after { content: "!important"; } /* !important */',
    '.b { animation: spin 1s; }',
    '@keyframes spin { to { opacity: 1; } }',
  ].join('\n');

  it('keeps leading statements on top and the body, line for line, inside', () => {
    const { code } = wrapVendorCss(sheet, 'v.css', 'layer');
    const lines = code.split('\n');
    expect(lines[0]).toBe('@charset "utf-8";');
    expect(lines[2]).toBe(
      '@import url("https://x.test/a.css") layer(anm-vendor) screen;'
    );
    expect(lines[3]).toBe(
      '@import "b.css" layer(anm-vendor.own) supports(display: grid);'
    );
    expect(lines[4]).toMatch(
      /^@namespace svg .*;@layer anm-vendor \{@layer base, comp;$/
    );
    // Every body line keeps its number and text.
    expect(lines.slice(5, 9)).toEqual(sheet.split('\n').slice(5, 9));
    expect(code.trimEnd().endsWith('}')).toBe(true);
  });

  it('keeps CSS Modules interchange rules at the top level', () => {
    const cssModule =
      '.a { color: red; }\n:export { primary: red; }\n.b { color: blue; }\n';
    const { code } = wrapVendorCss(cssModule, 'm.module.css', 'keep');
    expect(code).toBe(
      '@layer anm-vendor {.a { color: red; }\n\n.b { color: blue; }\n\n}\n:export { primary: red; }\n'
    );
  });

  it('leaves imports as written where the host loads each as a unit', () => {
    const { code } = wrapVendorCss(sheet, 'v.css', 'keep');
    expect(code).toContain(
      '@import "b.css" layer(own) supports(display: grid);'
    );
    expect(code).not.toContain('layer(anm-vendor');
  });

  it('reports importance and animation without removing them', () => {
    const { code, diagnostics } = wrapVendorCss(sheet, 'v.css', 'layer');
    expect(code).toContain('color: red !important;');
    expect(diagnostics.map((d) => [d.code, d.line, d.severity])).toEqual([
      ['animus.vendor.important', 6, 'warn'],
      ['animus.vendor.animation', 8, 'warn'],
    ]);
  });
});
