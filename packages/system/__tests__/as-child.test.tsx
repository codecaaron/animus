import { createElement, type ReactElement } from 'react';
import { flushSync } from 'react-dom';

import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

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

/**
 * Mount into a detached container with the client renderer and hand the
 * mounted DOM back to the caller, then unmount. flushSync makes the commit
 * synchronous; the test env is happy-dom, so `document` is available.
 * Needed for the handler tests — renderToString cannot fire events.
 */
function mountAndInspect(
  element: ReactElement,
  inspect: (container: HTMLElement) => void
): void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(element);
  });
  try {
    inspect(container);
  } finally {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  }
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

  it('forwards parent event handlers to the child element', () => {
    let clicks = 0;

    mountAndInspect(
      createElement(
        Box,
        { asChild: true, onClick: () => (clicks += 1) },
        createElement('button', { type: 'button' }, 'press')
      ),
      (container) => {
        const button = container.querySelector('button');
        expect(button).not.toBeNull();
        button?.click();
      }
    );

    expect(clicks).toBe(1);
  });

  it('forwards parent role, aria-* and data-* to the child element', () => {
    // Hoisted rather than inlined: an inline object literal in createElement
    // is freshness-checked, and `data-*` keys are only exempt in JSX position.
    const parentProps = {
      asChild: true,
      role: 'tab',
      'aria-label': 'parent label',
      'data-state': 'open',
      id: 'parent-id',
      tabIndex: -1,
    };

    const html = renderToString(
      createElement(Box, parentProps, createElement('span', null, 'text'))
    );

    expect(html).toMatch(/^<span /);
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-label="parent label"');
    expect(html).toContain('data-state="open"');
    expect(html).toContain('id="parent-id"');
    expect(html).toContain('tabindex="-1"');
  });

  it('does not forward Animus-managed props to the child element', () => {
    const html = renderToString(
      createElement(
        Box,
        { asChild: true, size: 'sm', as: 'article' },
        createElement('span', null, 'text')
      )
    );

    expect(html).toMatch(/^<span /);
    expect(html).not.toContain('asChild');
    expect(html).not.toContain('size=');
    expect(html).not.toContain('as=');
  });

  it("child's own handler wins over the parent's on conflict", () => {
    let parentClicks = 0;
    let childClicks = 0;

    mountAndInspect(
      createElement(
        Box,
        { asChild: true, onClick: () => (parentClicks += 1) },
        createElement(
          'button',
          { type: 'button', onClick: () => (childClicks += 1) },
          'press'
        )
      ),
      (container) => {
        container.querySelector('button')?.click();
      }
    );

    // Child-wins replacement, not handler chaining.
    expect(childClicks).toBe(1);
    expect(parentClicks).toBe(0);
  });

  it("child's own attributes win over the parent's on conflict", () => {
    const html = renderToString(
      createElement(
        Box,
        { asChild: true, 'aria-label': 'parent label', role: 'tab' },
        createElement(
          'span',
          { 'aria-label': 'child label', role: 'button' },
          'text'
        )
      )
    );

    expect(html).toContain('aria-label="child label"');
    expect(html).not.toContain('parent label');
    expect(html).toContain('role="button"');
    expect(html).not.toContain('role="tab"');
  });
});
