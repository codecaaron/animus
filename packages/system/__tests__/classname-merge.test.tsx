import {
  type CSSProperties,
  createElement,
  type ForwardRefExoticComponent,
} from 'react';

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
    type Style = CSSProperties & { [name: `--${string}`]: string };
    // Calls both callbacks with its own state, as Base UI's components do.
    function CallbackTarget(props: {
      className: (state: State) => string;
      style: (state: State) => Style;
    }) {
      const state = { open: true };
      return createElement('div', {
        className: props.className(state),
        style: props.style(state),
      });
    }
    function PlainTarget(props: { className: string; style: Style }) {
      return createElement('div', props);
    }
    const dynamicPropConfig = {
      maxW: {
        varName: '--max-w',
        slotClass: 'animus-dyn-max-w',
        property: 'max-width',
      },
    };
    const config = { systemPropNames: ['maxW'] };
    const CallbackChip: ForwardRefExoticComponent<any> = createComponent(
      CallbackTarget,
      'animus-Chip',
      config,
      {},
      dynamicPropConfig
    );
    const PlainChip: ForwardRefExoticComponent<any> = createComponent(
      PlainTarget,
      'animus-Chip',
      config,
      {},
      dynamicPropConfig
    );

    // The caller's style sets the slot's own variable: Animus's value wins.
    const html =
      '<div class="animus-Chip animus-dyn-max-w is-open" style="opacity:1;--max-w:120px"></div>';
    expect(
      renderToStaticMarkup(
        createElement(CallbackChip, {
          maxW: '120px',
          className: (state: State) => (state.open ? 'is-open' : 'is-closed'),
          style: (state: State) => ({
            opacity: state.open ? 1 : 0.5,
            '--max-w': '1px',
          }),
        })
      )
    ).toBe(html);
    expect(
      renderToStaticMarkup(
        createElement(PlainChip, {
          maxW: '120px',
          className: 'is-open',
          style: { opacity: 1, '--max-w': '1px' },
        })
      )
    ).toBe(html);
  });
});
