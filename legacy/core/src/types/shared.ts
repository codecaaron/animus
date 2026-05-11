export interface CSSObject {
  [key: string]: string | number | CSSObject | undefined;
}

export type NarrowPrimitive<T> = T & {};
