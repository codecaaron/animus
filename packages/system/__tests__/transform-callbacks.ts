import { createTransform } from '../src';

// Callbacks another module imports into custom prop configs.
export const sharedDouble = (val: string | number) => `${Number(val) * 2}px`;
export function sharedHalf(val: string | number) {
  return `${Number(val) / 2}px`;
}
export default function sharedQuarter(val: string | number) {
  return `${Number(val) / 4}px`;
}
export const sharedNamed = createTransform(
  'double',
  (val) => `${Number(val) * 3}px`
);
export const sharedBoolean = (val: boolean) => String(val);
