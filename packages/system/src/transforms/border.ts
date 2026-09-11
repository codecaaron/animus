import { createTransform } from './createTransform';

/** All logic stays inline: the extractor cannot follow external references. */
export const borderShorthand = createTransform('borderShorthand', (val) =>
  typeof val === 'number' ? `${val}px solid currentColor` : val
);
