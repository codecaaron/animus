import { numberToPx } from './utils';

export const borderShorthand = (val: string | number) => {
  const width = numberToPx(val);
  return `${width} solid currentColor`;
};
