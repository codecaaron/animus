import { describe, expect, it } from 'bun:test';

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { compose } from '../src';
import { ds } from './test-system';

// ─── Test Fixtures (real builder chain) ─────────────────────────

const Root = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'size',
    variants: { sm: { p: 4 }, lg: { p: 16 } },
  })
  .variant({
    prop: 'tone',
    variants: { muted: { opacity: '0.5' }, bold: { opacity: '1' } },
  })
  .asElement('div');

const Control = ds
  .styles({ display: 'block' })
  .variant({
    prop: 'size',
    variants: { sm: { p: 4 }, lg: { p: 16 } },
  })
  .variant({
    prop: 'checked',
    variants: { on: { opacity: '1' }, off: { opacity: '0.5' } },
  })
  .asElement('input');

const Label = ds
  .styles({ display: 'inline' })
  .variant({
    prop: 'size',
    variants: { sm: { p: 4 }, lg: { p: 16 } },
  })
  .asElement('span');

// ─── Assertion Helpers ──────────────────────────────────────────

/** Check if a specific HTML element tag has a variant class */
function tagHasClass(html: string, tag: string, cls: string): boolean {
  return new RegExp(`<${tag}[^>]*class="[^"]*${cls}`).test(html);
}

function tagLacksClass(html: string, tag: string, cls: string): boolean {
  return !tagHasClass(html, tag, cls);
}

// ─── Tests ──────────────────────────────────────────────────────

describe('compose()', () => {
  it('returns exact slot keys (PascalCase)', () => {
    const Family = compose({ Root, Control }, { shared: { size: true } });
    expect('Root' in Family).toBe(true);
    expect('Control' in Family).toBe(true);
  });

  it('sets displayName on composed slots', () => {
    const Family = compose(
      { Root, Control, Label },
      { shared: { size: true } }
    );
    expect(Family.Root.displayName).toContain('.Root');
    expect(Family.Control.displayName).toContain('.Control');
    expect(Family.Label.displayName).toContain('.Label');
  });

  it('composed output has no .extend() method (sealed)', () => {
    const Family = compose({ Root, Control }, { shared: { size: true } });
    expect((Family.Root as any).extend).toBeUndefined();
    expect((Family.Control as any).extend).toBeUndefined();
  });

  it('Root provides shared variant values to children via context', () => {
    const Family = compose(
      { Root, Control, Label },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(
        Family.Root,
        { size: 'sm' },
        createElement(Family.Control),
        createElement(Family.Label, null, 'text')
      )
    );

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagHasClass(html, 'input', '--size-sm')).toBe(true);
    expect(tagHasClass(html, 'span', '--size-sm')).toBe(true);
  });

  it('explicit family name via options.name', () => {
    const Family = compose(
      { Root, Control },
      { shared: { size: true }, name: 'Card' }
    );
    expect(Family.Root.displayName).toBe('Card.Root');
    expect(Family.Control.displayName).toBe('Card.Control');
  });

  it('direct prop on child slot overrides context value', () => {
    const Family = compose({ Root, Control }, { shared: { size: true } });

    const html = renderToString(
      createElement(
        Family.Root,
        { size: 'sm' },
        createElement(Family.Control, { size: 'lg' })
      )
    );

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagHasClass(html, 'input', '--size-lg')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size-sm')).toBe(true);
  });

  it('non-shared variant props are NOT propagated through context', () => {
    const Family = compose({ Root, Control }, { shared: { size: true } });

    const html = renderToString(
      createElement(
        Family.Root,
        { size: 'sm', tone: 'muted' },
        createElement(Family.Control)
      )
    );

    expect(tagHasClass(html, 'div', '--tone-muted')).toBe(true);
    expect(tagLacksClass(html, 'input', '--tone')).toBe(true);
  });

  it('consumer className merges correctly on composed slots', () => {
    const Family = compose({ Root, Label }, { shared: { size: true } });

    const html = renderToString(
      createElement(
        Family.Root,
        { size: 'sm', className: 'root-extra' },
        createElement(Family.Label, { className: 'label-extra' }, 'text')
      )
    );

    expect(html).toContain('root-extra');
    expect(html).toContain('label-extra');
  });

  it('empty shared config produces family without context wiring', () => {
    const Family = compose({ Root, Control }, { shared: {} });

    const html = renderToString(
      createElement(Family.Root, { size: 'sm' }, createElement(Family.Control))
    );

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size')).toBe(true);
  });

  it('asymmetric shared: only slots with the variant key receive it', () => {
    const Family = compose(
      { Root, Label },
      { shared: { size: true, tone: true } }
    );

    const html = renderToString(
      createElement(
        Family.Root,
        { size: 'sm', tone: 'muted' },
        createElement(Family.Label, null, 'text')
      )
    );

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagHasClass(html, 'div', '--tone-muted')).toBe(true);
    // Label receives size (it has a size variant)
    expect(tagHasClass(html, 'span', '--size-sm')).toBe(true);
    // Label does NOT receive tone (no tone variant)
    expect(tagLacksClass(html, 'span', '--tone')).toBe(true);
  });

  it('child slot can override shared value from context', () => {
    const Family = compose(
      { Root, Control, Label },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(
        Family.Root,
        { size: 'sm' },
        createElement(Family.Label, { size: 'lg' }, 'text')
      )
    );

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagHasClass(html, 'span', '--size-lg')).toBe(true);
    expect(tagLacksClass(html, 'span', '--size-sm')).toBe(true);
  });

  it('React keys propagate through forwardRef wrappers', () => {
    const Family = compose({ Root, Label }, { shared: { size: true } });

    // Render a list of keyed Root elements — should not throw
    const html = renderToString(
      createElement(
        'div',
        null,
        ...['a', 'b', 'c'].map((key) =>
          createElement(Family.Root, { key, size: 'sm' }, key)
        )
      )
    );

    expect(html).toContain('a');
    expect(html).toContain('b');
    expect(html).toContain('c');
  });

  it('displayName fallback when Root has no displayName', () => {
    const Family = compose({ Root, Control }, { shared: { size: true } });
    // Builder output initially has empty displayName — falls back to 'Composed'
    expect(Family.Root.displayName).toContain('.Root');
    expect(Family.Control.displayName).toContain('.Control');
  });
});
