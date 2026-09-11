import {
  createElement,
  createRef,
  type ForwardRefExoticComponent,
} from 'react';
import { createPortal, flushSync } from 'react-dom';

import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  composeWithContext,
  createComposedFamilyWithContext,
} from '../src/composeWithContext';
import { createComponent } from '../src/runtime';
import { createComposedFamily } from '../src/runtime/createComposedFamily';
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

function tagHasClass(html: string, tag: string, cls: string): boolean {
  return new RegExp(`<${tag}[^>]*class="[^"]*${cls}`).test(html);
}

function tagLacksClass(html: string, tag: string, cls: string): boolean {
  return !tagHasClass(html, tag, cls);
}

type SlotVariantProps = { size?: 'sm' | 'lg' };

function mountAndGetRefNode(
  Component: ForwardRefExoticComponent<any>,
  props: SlotVariantProps = {}
): Element | null {
  const ref = createRef<Element>();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(createElement(Component, { ...props, ref }));
  });
  const node = ref.current;
  flushSync(() => {
    root.unmount();
  });
  container.remove();
  return node;
}

describe('createComposedFamily()', () => {
  it('sets displayName as `${name}.${slot}`', () => {
    const Family = createComposedFamily(
      { Root, Control, Label },
      { name: 'Card' }
    );
    expect(Family.Root.displayName).toBe('Card.Root');
    expect(Family.Control.displayName).toBe('Card.Control');
    expect(Family.Label.displayName).toBe('Card.Label');
  });

  it('each slot renders its own source element', () => {
    const Family = createComposedFamily(
      { Root, Control, Label },
      { name: 'Card' }
    );

    expect(renderToString(createElement(Family.Root))).toMatch(/^<div/);
    expect(renderToString(createElement(Family.Control))).toMatch(/^<input/);
    expect(renderToString(createElement(Family.Label))).toMatch(/^<span/);
  });

  it('passes variant props through to the source component', () => {
    const Family = createComposedFamily({ Root, Control }, { name: 'Card' });

    const rootHtml = renderToString(
      createElement(Family.Root, { size: 'sm', tone: 'muted' })
    );
    expect(tagHasClass(rootHtml, 'div', '--size-sm')).toBe(true);
    expect(tagHasClass(rootHtml, 'div', '--tone-muted')).toBe(true);

    const controlHtml = renderToString(
      createElement(Family.Control, { size: 'lg' })
    );
    expect(tagHasClass(controlHtml, 'input', '--size-lg')).toBe(true);
  });

  it('passes children through', () => {
    const Family = createComposedFamily({ Root, Label }, { name: 'Card' });

    const labelHtml = renderToString(
      createElement(Family.Label, null, 'hello')
    );
    expect(labelHtml).toContain('hello');

    const nestedHtml = renderToString(
      createElement(
        Family.Root,
        { size: 'sm' },
        createElement(Family.Label, null, 'nested')
      )
    );
    expect(nestedHtml).toMatch(/^<div/);
    expect(nestedHtml).toContain('<span');
    expect(nestedHtml).toContain('nested');
  });

  it('passes consumer className through', () => {
    const Family = createComposedFamily({ Root, Label }, { name: 'Card' });

    const html = renderToString(
      createElement(
        Family.Root,
        { className: 'root-extra' },
        createElement(Family.Label, { className: 'label-extra' }, 'text')
      )
    );
    expect(html).toContain('root-extra');
    expect(html).toContain('label-extra');
  });

  it('slots are independent — no runtime shared/context propagation', () => {
    const Family = createComposedFamily({ Root, Control }, { name: 'Card' });

    const html = renderToString(
      createElement(Family.Root, { size: 'sm' }, createElement(Family.Control))
    );

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size')).toBe(true);
  });

  it('forwards ref through the wrapper to the underlying DOM node', () => {
    const Family = createComposedFamily({ Root, Control }, { name: 'Card' });

    const rootNode = mountAndGetRefNode(Family.Root);
    expect(rootNode).not.toBeNull();
    expect(rootNode?.tagName.toLowerCase()).toBe('div');

    const controlNode = mountAndGetRefNode(Family.Control);
    expect(controlNode).not.toBeNull();
    expect(controlNode?.tagName.toLowerCase()).toBe('input');
  });

  it('throws when no "Root" slot is present (matches compose)', () => {
    expect(() =>
      createComposedFamily({ Control, Label }, { name: 'Card' })
    ).toThrow(/No "Root" slot found/);
  });

  it('throws when Root is inherited rather than an own enumerable slot', () => {
    expect(() =>
      createComposedFamily(Object.create({ Root }), { name: 'Card' })
    ).toThrow(/No "Root" slot found/);
  });
});

describe('createComposedFamilyWithContext()', () => {
  it('omitted Root prop provides the default option via context (form parity with composeWithContext)', () => {
    const RootWithDefault = ds
      .styles({ display: 'flex' })
      .variant({
        prop: 'size',
        defaultVariant: 'sm',
        variants: { sm: { p: 4 }, lg: { p: 16 } },
      })
      .asElement('div');

    const Family = createComposedFamilyWithContext(
      { Root: RootWithDefault, Control },
      { name: 'Card', sharedKeys: ['size'] }
    );

    const html = renderToString(
      createElement(Family.Root, null, createElement(Family.Control))
    );

    expect(/<div[^>]*class="[^"]*--size-default/.test(html)).toBe(true);
    expect(/<input[^>]*class="[^"]*--size-sm/.test(html)).toBe(true);
  });

  it('a PORTALED child receives the omitted-Root default through context', () => {
    const RootWithDefault = ds
      .styles({ display: 'flex' })
      .variant({
        prop: 'size',
        defaultVariant: 'sm',
        variants: { sm: { p: 4 }, lg: { p: 16 } },
      })
      .asElement('div');

    const Family = createComposedFamilyWithContext(
      { Root: RootWithDefault, Control },
      { name: 'Card', sharedKeys: ['size'] }
    );

    const container = document.createElement('div');
    const portalTarget = document.createElement('div');
    document.body.appendChild(container);
    document.body.appendChild(portalTarget);
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        createElement(
          Family.Root,
          null,
          createPortal(createElement(Family.Control), portalTarget)
        )
      );
    });

    const portaled = portalTarget.querySelector('input');
    expect(portaled?.className).toContain('--size-sm');

    flushSync(() => root.unmount());
    container.remove();
    portalTarget.remove();
  });

  it('exposes variantDefaults on a raw createComponent (extracted-shape) component', () => {
    const Extracted = createComponent('div', 'animus-Probe-1', {
      variants: { size: { options: ['sm', 'lg'], default: 'lg' } },
    });
    expect(Extracted.variantDefaults.size).toBe('lg');
  });

  it('a PORTALED child receives the omitted-Root default (source form)', () => {
    const RootWithDefault = ds
      .styles({ display: 'flex' })
      .variant({
        prop: 'size',
        defaultVariant: 'sm',
        variants: { sm: { p: 4 }, lg: { p: 16 } },
      })
      .asElement('div');

    const Family = composeWithContext(
      { Root: RootWithDefault, Control },
      { shared: { size: true } }
    );

    const container = document.createElement('div');
    const portalTarget = document.createElement('div');
    document.body.appendChild(container);
    document.body.appendChild(portalTarget);
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        createElement(
          Family.Root,
          null,
          createPortal(createElement(Family.Control), portalTarget)
        )
      );
    });

    const portaled = portalTarget.querySelector('input');
    expect(portaled?.className).toContain('--size-sm');

    flushSync(() => root.unmount());
    container.remove();
    portalTarget.remove();
  });

  it('sets displayName as `${name}.${slot}`', () => {
    const Family = createComposedFamilyWithContext(
      { Root, Control, Label },
      { name: 'Card', sharedKeys: ['size'] }
    );
    expect(Family.Root.displayName).toBe('Card.Root');
    expect(Family.Control.displayName).toBe('Card.Control');
    expect(Family.Label.displayName).toBe('Card.Label');
  });

  it('Root extracts sharedKeys and children read them via context', () => {
    const Family = createComposedFamilyWithContext(
      { Root, Control, Label },
      { name: 'Card', sharedKeys: ['size'] }
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

  it('direct prop on a child overrides the context value', () => {
    const Family = createComposedFamilyWithContext(
      { Root, Control },
      { name: 'Card', sharedKeys: ['size'] }
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

  it('only sharedKeys are placed into context — other props stay on Root', () => {
    const Family = createComposedFamilyWithContext(
      { Root, Control },
      { name: 'Card', sharedKeys: ['size'] }
    );

    const html = renderToString(
      createElement(
        Family.Root,
        { size: 'sm', tone: 'muted' },
        createElement(Family.Control)
      )
    );

    expect(tagHasClass(html, 'div', '--tone-muted')).toBe(true);
    expect(tagHasClass(html, 'input', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--tone')).toBe(true);
  });

  it('empty sharedKeys — children inherit nothing', () => {
    const Family = createComposedFamilyWithContext(
      { Root, Control },
      { name: 'Card', sharedKeys: [] }
    );

    const html = renderToString(
      createElement(Family.Root, { size: 'sm' }, createElement(Family.Control))
    );

    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    expect(tagLacksClass(html, 'input', '--size')).toBe(true);
  });

  it('forwards ref through the Root wrapper to the DOM node', () => {
    const Family = createComposedFamilyWithContext(
      { Root, Control },
      { name: 'Card', sharedKeys: ['size'] }
    );

    const rootNode = mountAndGetRefNode(Family.Root, { size: 'sm' });
    expect(rootNode).not.toBeNull();
    expect(rootNode?.tagName.toLowerCase()).toBe('div');
  });

  it('throws when no "Root" slot is present (matches composeWithContext)', () => {
    expect(() =>
      createComposedFamilyWithContext(
        { Control, Label },
        { name: 'Card', sharedKeys: ['size'] }
      )
    ).toThrow(/No "Root" slot found/);
  });
});
