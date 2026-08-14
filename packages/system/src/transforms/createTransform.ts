import type { AbstractProps } from '../types/props';
import type { CSSObject } from '../types/shared';

/**
 * The signature every prop transform satisfies: it receives the prop's raw
 * value, the CSS property being targeted, and the full props object.
 *
 * The `CSSObject` arm of the return union is DEPRECATED and is rejected on
 * both resolution paths. Build-time evaluation hard-errors on an object
 * return — no declaration is emitted and the build fails, naming the transform
 * and the file — and the browser runtime drops the whole prop value with a
 * dev-mode warning (production drops quietly). A transform must return a
 * `string` or a finite `number`; rule-level styling ships as declaration
 * scales (`composite-style-scales`), which is the sanctioned path.
 *
 * The arm survives in the type only so imported transforms whose inferred
 * signatures already carry it keep type-checking in `.props({ transform })`
 * positions; TypeScript cannot express `@deprecated` on a single union arm.
 * Narrowing to `string | number` is scheduled for the next breaking release.
 */
export type TransformFn = (
  value: string | number,
  property?: string,
  props?: AbstractProps
) => string | number | CSSObject;

export type NamedTransform = TransformFn & {
  transformName: string;
  /**
   * The user function's source text, captured at creation (design D12).
   * The wrapper's own `toString()` is byte-identical for every transform
   * (the body is closure-captured), so cross-system equality must compare
   * the original source. Optional in the type: instances built by an older
   * @animus-ui/system lack it, and a name match with a missing source is a
   * loud conflict, never a silent coalesce.
   */
  transformSource?: string;
};

export function createTransform(name: string, fn: TransformFn): NamedTransform {
  const wrapper: TransformFn = (value, property, props) =>
    fn(value, property, props);
  Object.defineProperty(wrapper, 'name', { value: name });
  // When `fn` is itself a createTransform product, its own text is the
  // generic forwarder — byte-identical for every wrapper — so the captured
  // source must be inherited from it, or two renamings of DIFFERENT
  // transforms would compare equal under the same name.
  const inherited = (fn as Partial<NamedTransform>).transformSource;
  return Object.assign(wrapper, {
    transformName: name,
    transformSource: inherited ?? fn.toString(),
  }) as NamedTransform;
}

/**
 * Cross-system transform equality (design D12): identity fast path, then —
 * when both carry `transformName` — equal names AND equal captured
 * `transformSource`. A name match with the captured source missing on either
 * side is a loud conflict (older-instance safety), as is a named/bare mix.
 * Bare-function pairs compare by their own `toString()` (their body IS their
 * source; only `createTransform` wrappers hide it). Known accepted residual:
 * two functions with byte-identical source can close over different values
 * and would coalesce — the loud-conflict alternative (identity-only) was
 * measured to false-conflict every transform-bearing prop under duplicate
 * module instances (inc-01 spike) and to forbid re-registering kit props.
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
