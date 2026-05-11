/**
 * Transform function signature.
 * Takes a raw prop value and produces a CSS-ready value.
 * Runs AFTER scale resolution.
 */
export type TransformFn = (
  value: string | number,
  property?: string,
  props?: any
) => string | number | Record<string, any>;

/**
 * A transform function decorated with a serializable name.
 * Created via `createTransform()`. The `.transformName` property
 * is used by the extraction pipeline to identify transforms
 * without executing them in Rust.
 */
export type NamedTransform = TransformFn & { transformName: string };

/**
 * Create a named transform function for use in prop configs.
 *
 * Returns a NEW callable function decorated with `.transformName`.
 * The original function is not mutated — safe for shared references.
 *
 * @example
 * ```ts
 * const size = createTransform('size', (value) => {
 *   if (typeof value === 'number') return percentageOrAbsolute(value);
 *   return value;
 * });
 *
 * size(4);              // "4px"
 * size.transformName;   // "size"
 * ```
 */
export function createTransform(name: string, fn: TransformFn): NamedTransform {
  const wrapper: TransformFn = (value, property, props) =>
    fn(value, property, props);
  Object.defineProperty(wrapper, 'name', { value: name });
  return Object.assign(wrapper, { transformName: name }) as NamedTransform;
}
