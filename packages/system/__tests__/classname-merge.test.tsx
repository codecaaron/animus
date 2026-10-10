import { type CSSProperties, createElement } from 'react';

import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createComponent } from '../src/runtime';
import { ds } from './test-system';

const Box = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'size',
    variants: { sm: { p: 4 }, lg: { p: 16 } },
  })
  .asElement('div');

describe('consumer className on the normal render path', () => {
  it('merges consumer className after the generated classes', () => {
    const html = renderToString(
      createElement(Box, { size: 'sm', className: 'group' }, 'content')
    );
    expect(html).toMatch(/<div class="[^"]*--size-sm group"/);
  });

  it('keeps consumer className when no variant props are set', () => {
    const html = renderToString(
      createElement(Box, { className: 'group' }, 'content')
    );
    expect(html).toMatch(/<div class="[^"]*group"/);
  });

  it('keeps consumer className under an `as` override', () => {
    const html = renderToString(
      createElement(Box, { as: 'section', className: 'group' }, 'content')
    );
    expect(html).toMatch(/<section class="[^"]*group"/);
  });
});

describe('consumer className and style callbacks on a component target', () => {
  it('reach the target, run with its state and merge as plain values do', () => {
    type State = { open: boolean };
    const resolve = <T,>(value: T | ((state: State) => T), state: State) =>
      typeof value === 'function'
        ? (value as (state: State) => T)(state)
        : value;
    // Calls a callback with its own state, as Base UI's components do.
    function Target({
      className,
      style,
    }: {
      className?: string | ((state: State) => string);
      style?: CSSProperties | ((state: State) => CSSProperties);
    }) {
      const state = { open: true };
      return createElement('div', {
        className: resolve(className, state),
        style: resolve(style, state),
      });
    }
    const Chip = createComponent(
      Target,
      'animus-Chip',
      { systemPropNames: ['maxW'] },
      {},
      {
        maxW: {
          varName: '--max-w',
          slotClass: 'animus-dyn-max-w',
          property: 'max-width',
        },
      }
    );
    const render = (props: Record<string, unknown>) => {
      const chipProps: Record<string, unknown> = { maxW: '120px', ...props };
      return renderToStaticMarkup(createElement(Chip, chipProps));
    };

    const html =
      '<div class="animus-Chip animus-dyn-max-w is-open" style="opacity:1;--max-w:120px"></div>';
    expect(
      render({
        className: (state: State) => (state.open ? 'is-open' : 'is-closed'),
        style: (state: State) => ({
          opacity: state.open ? 1 : 0.5,
          '--max-w': '1px',
        }),
      })
    ).toBe(html);
    expect(
      render({ className: 'is-open', style: { opacity: 1, '--max-w': '1px' } })
    ).toBe(html);
  });
});
