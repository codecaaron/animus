export type IsAny<T> = 0 extends 1 & T ? true : false;
/**
 * The same set of values: each assignable to the other, so a widened type
 * fails, and `any` equals only `any`. The identity form
 * (`<T>() => T extends A ? 1 : 2`) is stricter, but TS 7 and 5.9 disagree on
 * it for equal unions of template literals.
 */
export type Equal<A, B> =
  IsAny<A> extends true
    ? IsAny<B>
    : IsAny<B> extends true
      ? false
      : [A] extends [B]
        ? [B] extends [A]
          ? true
          : false
        : false;
export type Assert<T extends true> = T;
export type IsNever<T> = [T] extends [never] ? true : false;
/** Every string is admitted: a closed union widened to `string` reads true. */
export type IsOpenString<T> = string extends T ? true : false;

// The guards themselves: if one always held, its negative would go unused.
// @ts-expect-error — a closed union is not string
export type _EqualTellsUnionFromString = Assert<Equal<'a' | 'b', string>>;
// @ts-expect-error — any is not unknown
export type _EqualTellsAnyFromUnknown = Assert<Equal<any, unknown>>;
// @ts-expect-error — nor is it a closed union
export type _EqualTellsAnyFromUnion = Assert<Equal<'a' | 'b', any>>;
// @ts-expect-error — never is not undefined
export type _EqualTellsNeverFromUndefined = Assert<Equal<never, undefined>>;
// @ts-expect-error — unknown is not any
export type _IsAnyRejectsUnknown = Assert<IsAny<unknown>>;
// @ts-expect-error — undefined is not never
export type _IsNeverRejectsUndefined = Assert<IsNever<undefined>>;
// @ts-expect-error — a closed union is not open
export type _IsOpenStringRejectsUnion = Assert<IsOpenString<'a' | 'b'>>;
export type _GuardsHold = [
  Assert<Equal<'a' | 'b', 'b' | 'a'>>,
  Assert<Equal<any, any>>,
  Assert<IsAny<any>>,
  Assert<IsNever<never>>,
  Assert<IsOpenString<string>>,
];
