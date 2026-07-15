import { createElement } from 'react';

import { ds } from '../test-system';

export const Box = ds.styles({ display: 'block', p: 8 }).asElement('div');

export const node = createElement(Box, { p: 12 });
