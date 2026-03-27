import type { AbstractProps } from '../types/props';
import type { CSSObject } from '../types/shared';

export type TransformFn = (
  value: string | number,
  property?: string,
  props?: AbstractProps
) => string | number | CSSObject;

export type NamedTransform = TransformFn & { transformName: string };

export function createTransform(name: string, fn: TransformFn): NamedTransform {
  const wrapper: TransformFn = (value, property, props) =>
    fn(value, property, props);
  Object.defineProperty(wrapper, 'name', { value: name });
  return Object.assign(wrapper, { transformName: name }) as NamedTransform;
}
