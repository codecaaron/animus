/**
 * Deep merge utility — replaces lodash.merge for variant accumulation.
 */
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
