import { CSSObject } from '../types/theme';

/**
 * Returns an type of any object with { key: 'var(--key) }
 */
export type KeyAsVariable<
  T extends Record<string, any>,
  Prefix extends string,
> = {
  [V in keyof T]: `var(--${Prefix}-${SanitizeKey<Extract<V, string>>})`;
};

export type SanitizeKey<T extends string> = T extends `${'$'}${infer Y}`
  ? Y
  : T;

type SerializedTokensInput = Record<
  string,
  string | number | CSSObject | SerializedTokensInputRecursive
>;

interface SerializedTokensInputRecursive {
  [i: number]: SerializedTokensInput;
  [i: string]: SerializedTokensInput;
}
