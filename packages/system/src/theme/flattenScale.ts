import { isObject } from './utils';

/** Every path through T reachable from K, joined by `D`. */
export type FindPath<T, K extends keyof T, D extends string = '.'> = K extends
  | string
  | number
  ? T[K] extends Record<string | number, any>
    ? T[K] extends ArrayLike<any>
      ? K | `${K}${D}${FindPath<T[K], Exclude<keyof T[K], keyof any[]>, D>}`
      : K | `${K}${D}${FindPath<T[K], keyof T[K], D>}`
    : K
  : never;

export type Path<T, D extends string = '.'> = FindPath<T, keyof T, D> | keyof T;

export type PathValue<
  T,
  P extends Path<T, D>,
  D extends string = '.',
> = P extends `${infer K}${D}${infer Rest}`
  ? K extends keyof T
    ? Rest extends Path<T[K], D>
      ? PathValue<T[K], Rest, D>
      : never
    : never
  : P extends keyof T
    ? T[P]
    : never;

/** Only the paths whose value is a string or number, as a union. */
export type PathToLiteral<
  T,
  K extends Path<T, D>,
  D extends string = '.',
  Base extends string = '',
> =
  PathValue<T, K, D> extends string | number
    ? K extends string | number
      ? K extends `${infer BasePath}${D}${Base}`
        ? BasePath
        : K
      : never
    : never;

/**
 * Flat map of the primitive-valued paths only: `{ a: { b: 1 } }` becomes
 * `{ 'a-b': 1 }` when `D` is `-`.
 */
export type LiteralPaths<
  T extends Record<string | number, any>,
  D extends string = '.',
  Base extends string = '',
> = {
  [K in Path<T, D> as PathToLiteral<T, K, D, Base>]: PathValue<
    T,
    PathToLiteral<T, K, D>,
    D
  >;
};

export function flattenScale<
  T extends Record<string | number, unknown>,
  P extends string,
>(object: T, path?: P): LiteralPaths<T, '-', '_'> {
  return Object.keys(object).reduce(
    (carry, key) => {
      const nextKey = path ? `${path}${key === '_' ? '' : `-${key}`}` : key;
      const current = object[key];
      if (isObject(current)) {
        return {
          ...carry,
          ...flattenScale(current as Record<string | number, unknown>, nextKey),
        };
      }
      return {
        ...carry,
        [nextKey]: object[key],
      };
    },
    {} as LiteralPaths<T, '-', '_'>
  );
}
