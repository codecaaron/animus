import {
  createElement,
  createRef,
  type ForwardRefExoticComponent,
} from 'react';
import { flushSync } from 'react-dom';

import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createComposedFamilyWithContext } from '../src/composeWithContext';
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
});

// ─── createComposedFamilyWithContext() Tests ────────────────────

describe('createComposedFamilyWithContext()', () => {
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
