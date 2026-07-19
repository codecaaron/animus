import { createTransform } from '@animus-ui/system';

import { ds } from '../setup';

export const doubleSize = createTransform('size', (value) =>
  typeof value === 'number' ? `${value * 2}px` : value
);

export const Card = ds.styles({ width: 4 }).asElement('div');

export function CardExample() {
  return <Card />;
}
