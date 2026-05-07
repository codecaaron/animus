import { createElement } from 'react';

import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';

import { ds } from './test-system';

// ─── Test Fixtures ─────────────────────────────────────────────

const Box = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'size',
    variants: { sm: { p: 4 }, lg: { p: 16 } },
  })
  .asElement('div');

// ─── Assertion Helpers ─────────────────────────────────────────

function tagHasClass(html: string, tag: string, cls: string): boolean {
  return new RegExp(`<${tag}[^>]*class="[^"]*${cls}`).test(html);
}

// ─── Tests ─────────────────────────────────────────────────────

describe('asChild', () => {
  it('renders child element with parent className merged', () => {
    const html = renderToString(
      createElement(
        Box,
        { size: 'sm', asChild: true },
        createElement('a', { href: '/foo' }, 'link')
      )
    );

    // Should render <a>, not <div>
    expect(html).toMatch(/^<a /);
    expect(html).not.toContain('<div');
    // Should have the Animus class
    expect(tagHasClass(html, 'a', '--size-sm')).toBe(true);
    // Should preserve child's href
    expect(html).toContain('href="/foo"');
  });

  it('preserves child own props (href, data attributes)', () => {
    const html = renderToString(
      createElement(
        Box,
        { asChild: true },
        createElement('a', { href: '/bar', 'data-testid': 'link' }, 'text')
      )
    );

    expect(html).toContain('href="/bar"');
    expect(html).toContain('data-testid="link"');
  });

  it('merges className (parent classes + child className)', () => {
    const html = renderToString(
      createElement(
        Box,
        { size: 'lg', asChild: true },
        createElement('span', { className: 'child-extra' }, 'text')
      )
    );

    expect(html).toContain('child-extra');
    expect(tagHasClass(html, 'span', '--size-lg')).toBe(true);
  });

  it('throws on non-element children', () => {
    expect(() => {
      renderToString(createElement(Box, { asChild: true }, 'just a string'));
    }).toThrow();
  });

  it('throws on multiple children', () => {
    expect(() => {
      renderToString(
        createElement(
          Box,
          { asChild: true },
          createElement('span', null, 'a'),
          createElement('span', null, 'b')
        )
      );
    }).toThrow();
  });

  it('variant props resolve to classes on child element', () => {
    const html = renderToString(
      createElement(
        Box,
        { size: 'sm', asChild: true },
        createElement('section', null, 'content')
      )
    );

    expect(html).toMatch(/^<section /);
    expect(tagHasClass(html, 'section', '--size-sm')).toBe(true);
  });

  it('ignores `as` prop when asChild is true', () => {
    const html = renderToString(
      createElement(
        Box,
        { as: 'article', asChild: true },
        createElement('span', null, 'text')
      )
    );

    // asChild wins — renders <span>, not <article>
    expect(html).toMatch(/^<span /);
    expect(html).not.toContain('<article');
  });

  it('without asChild, renders own element normally', () => {
    const html = renderToString(createElement(Box, { size: 'sm' }, 'content'));

    // Should render <div> (the defined element)
    expect(html).toMatch(/^<div /);
    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
  });

  it('asChild prop does not appear on rendered DOM element', () => {
    const html = renderToString(
      createElement(Box, { asChild: true }, createElement('span', null, 'text'))
    );

    expect(html).not.toContain('asChild');
    expect(html).not.toContain('asChild');
  });
});
