import { createElement, type ReactNode } from 'react';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { compose } from '../src';
import { composeWithContext } from '../src/composeWithContext';
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

const RootWithDefault = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'size',
    defaultVariant: 'sm',
    variants: { sm: { p: 4 }, lg: { p: 16 } },
  })
  .asElement('div');

/** Plain React component behind `.asComponent()` — the wrapped-slot fixture. */
const Leaf = (props: { className?: string; children?: ReactNode }) =>
  createElement('section', props);

const WrappedRoot = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'size',
    variants: { sm: { p: 4 }, lg: { p: 16 } },
  })
  .asComponent(Leaf);

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

  it('throws without a Root slot', () => {
    expect(() => compose({ Control } as never, { shared: {} })).toThrow(
      /No "Root" slot found/
    );
  });

  it('composed output has no .extend() method (sealed)', () => {
    const Family = compose({ Root, Control }, { shared: { size: true } });
    expect((Family.Root as any).extend).toBeUndefined();
    expect((Family.Control as any).extend).toBeUndefined();
  });

  it('Root applies shared variant class, children rely on CSS cascade', () => {
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

    // Root has the variant class (direct prop)
    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    // Children do NOT get shared variant classes at runtime —
    // CSS descendant selectors (.Root.Root--size-sm .Child) handle propagation
    expect(tagLacksClass(html, 'input', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'span', '--size-sm')).toBe(true);
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

  it('asymmetric shared: CSS cascade handles variant propagation', () => {
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

    // Root has both variant classes (direct props)
    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagHasClass(html, 'div', '--tone-muted')).toBe(true);
    // Label does NOT get shared classes at runtime — CSS handles propagation
    expect(tagLacksClass(html, 'span', '--size')).toBe(true);
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

  it('accepts an .asComponent() output as the Root slot', () => {
    const Family = compose(
      { Root: WrappedRoot, Control },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(Family.Root, { size: 'sm' }, createElement(Family.Control))
    );

    // Wrapped Root renders its wrapped element with the variant class
    expect(tagHasClass(html, 'section', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size-sm')).toBe(true);
  });

  it('compose has no context option — CSS-only propagation', () => {
    const Family = compose({ Root, Control }, { shared: { size: true } });

    const html = renderToString(
      createElement(Family.Root, { size: 'sm' }, createElement(Family.Control))
    );

    // Root has class, child does NOT — CSS-only propagation
    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size-sm')).toBe(true);
  });
});

// ─── composeWithContext() Tests ────────────────────────────────

describe('composeWithContext()', () => {
  it('child receives shared prop values from context', () => {
    const Family = composeWithContext(
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

    // Root has the variant class (direct prop)
    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    // Children receive shared values via context → variant runtime resolves classes
    expect(tagHasClass(html, 'input', '--size-sm')).toBe(true);
    expect(tagHasClass(html, 'span', '--size-sm')).toBe(true);
  });

  it('direct props on child override context-provided values', () => {
    const Family = composeWithContext(
      { Root, Control },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(
        Family.Root,
        { size: 'sm' },
        createElement(Family.Control, { size: 'lg' })
      )
    );

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    // Direct prop wins over context value
    expect(tagHasClass(html, 'input', '--size-lg')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size-sm')).toBe(true);
  });

  it('sets displayName on composed slots', () => {
    const Family = composeWithContext(
      { Root, Control },
      { shared: { size: true }, name: 'Card' }
    );
    expect(Family.Root.displayName).toBe('Card.Root');
    expect(Family.Control.displayName).toBe('Card.Control');
  });

  it('omitted Root prop provides the default option via context', () => {
    const Family = composeWithContext(
      { Root: RootWithDefault, Control },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(Family.Root, null, createElement(Family.Control))
    );

    // Root emits the sentinel class (CSS transport handles descendants);
    // the child receives the RESOLVED default via context and emits the
    // explicit option class — matching what the `--size-default` descendant
    // rule produces for non-portaled children.
    expect(tagHasClass(html, 'div', '--size-default')).toBe(true);
    expect(tagHasClass(html, 'input', '--size-sm')).toBe(true);
  });

  it('direct child prop overrides a context-provided default', () => {
    const Family = composeWithContext(
      { Root: RootWithDefault, Control },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(
        Family.Root,
        null,
        createElement(Family.Control, { size: 'lg' })
      )
    );

    expect(tagHasClass(html, 'input', '--size-lg')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size-sm')).toBe(true);
  });

  it('explicit undefined behaves as omitted (mirrors class assembly)', () => {
    const Family = composeWithContext(
      { Root: RootWithDefault, Control },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(
        Family.Root,
        { size: undefined },
        createElement(Family.Control)
      )
    );

    // The resolver's `props[prop] ?? default` gives the Root the EXPLICIT
    // default-option class for present-but-undefined; the provider must
    // resolve the same way so the child still receives the default.
    expect(tagHasClass(html, 'input', '--size-sm')).toBe(true);
  });

  it('nullish child prop yields to the inherited context value', () => {
    const Family = composeWithContext(
      { Root: RootWithDefault, Control },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(
        Family.Root,
        null,
        createElement(Family.Control, { size: undefined })
      )
    );

    // `size={undefined}` must not erase the inherited default — a
    // DOM-descendant child in this state keeps it via the CSS transport.
    expect(tagHasClass(html, 'input', '--size-sm')).toBe(true);
  });

  it('nullish child prop yields even against a child-local default', () => {
    const ControlWithOwnDefault = ds
      .styles({ display: 'block' })
      .variant({
        prop: 'size',
        defaultVariant: 'lg',
        variants: { sm: { p: 4 }, lg: { p: 16 } },
      })
      .asElement('input');

    const Family = composeWithContext(
      { Root: RootWithDefault, Control: ControlWithOwnDefault },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(
        Family.Root,
        null,
        createElement(Family.Control, { size: undefined })
      )
    );

    // The shared value (Root default sm) wins over the child-local default
    // (lg): a child that wants its own default states the option explicitly.
    expect(tagHasClass(html, 'input', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size-lg')).toBe(true);
  });

  it('throws without a Root slot (source form)', () => {
    expect(() =>
      composeWithContext({ Control } as never, { shared: {} })
    ).toThrow(/No "Root" slot found/);
  });

  it('an axis without a default stays absent from context', () => {
    const Family = composeWithContext(
      { Root, Control },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(Family.Root, null, createElement(Family.Control))
    );

    expect(tagLacksClass(html, 'input', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size-lg')).toBe(true);
  });

  it('exposes variantDefaults on created components', () => {
    // Cast-free: the public AnimusComponent type carries the field.
    expect(RootWithDefault.variantDefaults.size).toBe('sm');
    expect(Root.variantDefaults.size).toBeUndefined();
  });
});
