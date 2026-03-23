export const createScale = <T extends string | number>() =>
  [] as readonly T[] & { length: 0 };

export const numericScale = [] as (number & {})[];

export const stringScale = [] as (string & {})[];

export const numericOrStringScale = [] as ((string & {}) | (number & {}))[];
