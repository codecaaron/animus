/**
 * Resolve __TRANSFORM__ placeholders in extracted CSS.
 *
 * Pattern: `__TRANSFORM__name__rawValue__` -> transform function result.
 * The Rust crate emits these placeholders for CSS values that require
 * JS transform functions (e.g., size, grid) which can't be evaluated in Rust.
 */
export function resolveTransformPlaceholders(
  css: string,
  transforms: Record<string, (v: unknown) => unknown>
): string {
  return css.replace(
    /__TRANSFORM__(\w+)__(.+?)__/g,
    (_, name: string, rawValue: string) => {
      const fn = transforms[name];
      if (!fn) return rawValue;
      const value =
        rawValue !== '' && !Number.isNaN(Number(rawValue))
          ? Number(rawValue)
          : rawValue;
      const result = fn(value);
      return typeof result === 'object'
        ? JSON.stringify(result)
        : String(result);
    }
  );
}
