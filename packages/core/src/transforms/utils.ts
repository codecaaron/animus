export const numberToPx = (val: string | number) =>
  typeof val === 'number' ? `${val}px` : val;
