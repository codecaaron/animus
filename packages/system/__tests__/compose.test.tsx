import { createElement, type ReactNode } from 'react';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { compose } from '../src';
import { composeWithContext } from '../src/composeWithContext';
import { ds } from './test-system';

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

const Leaf = (props: { className?: string; children?: ReactNode }) =>
  createElement('section', props);

const WrappedRoot = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'size',
    variants: { sm: { p: 4 }, lg: { p: 16 } },
  })
  .asComponent(Leaf);

function tagHasClass(html: string, tag: string, cls: string): boolean {
  return new RegExp(`<${tag}[^>]*class="[^"]*${cls}`).test(html);
}

function tagLacksClass(html: string, tag: string, cls: string): boolean {
  return !tagHasClass(html, tag, cls);
}

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
    expect(Family.Root.displayName).toBe('Composed.Root');
    expect(Family.Control.displayName).toBe('Composed.Control');
    expect(Family.Label.displayName).toBe('Composed.Label');
  });

  it('throws without a Root slot', () => {
    expect(() =>
      // SAFETY: crosses the `Slots extends { Root }` constraint on purpose —
      // the runtime guard behind it is what this test proves still fires.
      compose({ Control } as never, { shared: {} })
    ).toThrow(/No "Root" slot found/);
  });

  it('throws when Root is inherited rather than an own enumerable slot', () => {
    expect(() =>
      // SAFETY: crosses the `Slots extends { Root }` constraint on purpose — a
      // prototype Root satisfies neither it nor the own-enumerable rule.
      compose(Object.create({ Root }) as never, { shared: {} })
    ).toThrow(/No "Root" slot found/);
  });

  it('composed output has no .extend() method (sealed)', () => {
    const Family = compose({ Root, Control }, { shared: { size: true } });
    expect('extend' in Family.Root).toBe(false);
    expect('extend' in Family.Control).toBe(false);
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

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
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

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagHasClass(html, 'div', '--tone-muted')).toBe(true);
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

  it('accepts an .asComponent() output as the Root slot', () => {
    const Family = compose(
      { Root: WrappedRoot, Control },
      { shared: { size: true } }
    );

    const html = renderToString(
      createElement(Family.Root, { size: 'sm' }, createElement(Family.Control))
    );

    expect(tagHasClass(html, 'section', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size-sm')).toBe(true);
  });
});

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

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
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

    expect(tagHasClass(html, 'input', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size-lg')).toBe(true);
  });

  it('throws without a Root slot (source form)', () => {
    expect(() =>
      // SAFETY: crosses the `Slots extends { Root }` constraint on purpose —
      // the runtime guard behind it is what this test proves.
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
    expect(RootWithDefault.variantDefaults.size).toBe('sm');
    expect(Root.variantDefaults.size).toBeUndefined();
  });
});
