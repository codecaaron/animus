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
