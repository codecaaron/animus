import { createElement } from 'react';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { flex, grid } from '../src/groups';
import { createComponent } from '../src/runtime';
import { createClassResolver } from '../src/runtime/createClassResolver';

describe('admitted props', () => {
  it('applies a prop two admitted groups share once, at its first position', () => {
    // An extracted config concatenates each admitted group's props.
    const config = {
      systemPropNames: [...Object.keys(flex), ...Object.keys(grid)],
    };
    const systemPropMap = {
      alignItems: { center: 'animus-u-items' },
      gap: { '8': 'animus-u-gap' },
      cols: { '2': 'animus-u-cols' },
    };
    const props = { cols: 2, gap: 8, alignItems: 'center' };
    const classes = 'animus-Box animus-u-items animus-u-gap animus-u-cols';

    const Box = createComponent('div', 'animus-Box', config, systemPropMap);
    expect(renderToStaticMarkup(createElement(Box, props))).toBe(
      `<div class="${classes}"></div>`
    );
    expect(
      createClassResolver('animus-Box', config, systemPropMap)(props)
    ).toBe(classes);
  });
});
