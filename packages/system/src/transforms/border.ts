import { createTransform } from './createTransform';

/**
 * Self-contained transform: all logic inlined in the callback.
 * No external references — satisfies the extraction constraint.
 */
export const borderShorthand = createTransform('borderShorthand', (val) =>
  typeof val === 'number' ? `${val}px solid currentColor` : val
);
