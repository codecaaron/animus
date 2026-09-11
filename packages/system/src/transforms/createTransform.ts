import type { AbstractProps } from '../types/props';
import type { CSSObject } from '../types/shared';

/**
 * The `CSSObject` return arm fails the build and drops the value at runtime;
 * a transform must return a string or a finite number.
 */
export type TransformFn = (
  value: string | number,
  property?: string,
  props?: AbstractProps
) => string | number | CSSObject;

export type NamedTransform = TransformFn & {
  transformName: string;
  /**
   * A wrapper's own `toString()` is identical for every transform, so
   * equality compares this captured source instead.
   */
  transformSource?: string;
};

export function createTransform(name: string, fn: TransformFn): NamedTransform {
  const wrapper: TransformFn = (value, property, props) =>
    fn(value, property, props);
  Object.defineProperty(wrapper, 'name', { value: name });
  // A `fn` that is itself a wrapper stringifies to the generic forwarder; its
  // captured source must be inherited or unrelated transforms compare equal.
  const inherited = (fn as Partial<NamedTransform>).transformSource;
  return Object.assign(wrapper, {
    transformName: name,
    transformSource: inherited ?? fn.toString(),
  }) as NamedTransform;
}

/**
 * Two transforms with byte-identical source compare equal even when they
 * close over different values.
 */
export function areTransformsEqual(
  a: TransformFn | undefined,
  b: TransformFn | undefined
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const aNamed = a as Partial<NamedTransform>;
  const bNamed = b as Partial<NamedTransform>;
  const aName = aNamed.transformName;
  const bName = bNamed.transformName;
  if (aName !== undefined && bName !== undefined) {
    return (
      aName === bName &&
      aNamed.transformSource !== undefined &&
      aNamed.transformSource === bNamed.transformSource
    );
  }
  if (aName === undefined && bName === undefined) {
    return a.toString() === b.toString();
  }
  return false;
}
