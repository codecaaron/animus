const isMergeable = (value: unknown) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function deepMerge<
  A extends Record<string, any>,
  B extends Record<string, any>,
>(target: A, source: B): A & B {
  const result = { ...target } as any;
  for (const key of Object.keys(source)) {
    if (isMergeable(source[key]) && isMergeable(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
/**
 * A variant's options with a boolean `defaultVariant` stored as the key it
 * names (`true` as `'true'`), as the extractor reads it.
 */
export function withDefaultKey<Options extends { defaultVariant?: unknown }>(
  options: Options
): Options {
  const { defaultVariant } = options;
  return defaultVariant === true || defaultVariant === false
    ? { ...options, defaultVariant: String(defaultVariant) }
    : options;
}
