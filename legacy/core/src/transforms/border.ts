import { createTransform } from './createTransform';
import { numberToTemplate } from './utils';

export const borderShorthand = createTransform('borderShorthand', (val) =>
  numberToTemplate(val, (width) => `${width}px solid currentColor`)
);
