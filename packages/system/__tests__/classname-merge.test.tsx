import { createElement } from 'react';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

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
