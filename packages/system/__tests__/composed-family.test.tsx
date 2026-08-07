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

// ─── Test Fixtures (real builder chain) ─────────────────────────
//
// createComposedFamily / createComposedFamilyWithContext are the
// extraction-time replacements for compose() / composeWithContext().
// They accept ALREADY-BUILT forwardRef components as slots (the emitter
// hands them the terminal builder output), so we feed them the same
// ds.asElement() components the compose() tests use.

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

/**
 * Mount a component with a ref via the client renderer and return the DOM
 * node the ref resolved to. Uses flushSync so the commit (and therefore ref
 * attachment) is synchronous. The test env is happy-dom, so `document` and
 * the HTML*Element globals are available.
 */
function mountAndGetRefNode(
  Component: ForwardRefExoticComponent<any>,
  props: Record<string, unknown> = {}
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

// ─── createComposedFamily() Tests ───────────────────────────────

describe('createComposedFamily()', () => {
  it('returns exact slot keys (PascalCase)', () => {
    const Family = createComposedFamily({ Root, Control }, { name: 'Card' });
    expect('Root' in Family).toBe(true);
    expect('Control' in Family).toBe(true);
  });

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

    // Text child on a leaf slot
    const labelHtml = renderToString(
      createElement(Family.Label, null, 'hello')
    );
    expect(labelHtml).toContain('hello');

    // Nested element children on the root slot render inside it
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
    // createComposedFamily is the RSC-safe replacement: no shared config,
    // no context. A child rendered without its own size prop gets no class
    // (CSS descendant selectors handle propagation at the stylesheet level).
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
    // The extraction-time replacement mirrors compose()'s guard: a family
    // with no Root slot has no cascade source, so the composed variant CSS
    // rules would have nothing to inherit from and every slot would render
    // unstyled by the shared axes. Source form and extracted form must agree
    // on this contract — otherwise a dev build throws where the extracted
    // production build stays silent.
    expect(() =>
      createComposedFamily({ Control, Label }, { name: 'Card' })
    ).toThrow(/No "Root" slot found/);
  });

  it('throws when Root is inherited rather than an own enumerable slot', () => {
    // The wrapper loop iterates with Object.entries; a prototype-carried Root
    // would validate under an `in` check and then vanish from the family.
    expect(() =>
      createComposedFamily(Object.create({ Root }), { name: 'Card' })
    ).toThrow(/No "Root" slot found/);
  });
});

// ─── createComposedFamilyWithContext() Tests ────────────────────

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

    // The child escaped Root's DOM subtree — CSS descendant rules cannot
    // reach it — yet context carries the resolved default.
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
    // Cast-free: createComponent's return type carries the field.
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

    // Root has the class from its own direct prop
    expect(tagHasClass(html, 'div', '--size-sm')).toBe(true);
    // Children receive the shared value via context → variant resolves
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
    // Direct prop wins over the inherited context value
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

    // tone is Root-only (not a sharedKey) → stays on Root, never inherited
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
    // The extraction-time replacement mirrors composeWithContext()'s guard:
    // a family without a Root slot would silently render children against
    // the empty default context, so both forms fail loud instead.
    expect(() =>
      createComposedFamilyWithContext(
        { Control, Label },
        { name: 'Card', sharedKeys: ['size'] }
      )
    ).toThrow(/No "Root" slot found/);
  });
});
