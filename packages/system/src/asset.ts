declare const ASSET_REF_BRAND: unique symbol;

/**
 * A plain string so it crosses the sandbox's JSON boundary untouched; the host
 * plugin substitutes the placeholder with the bundler-resolved URL.
 */
export type AssetRef = string & { readonly [ASSET_REF_BRAND]: true };

export const ASSET_PLACEHOLDER_PREFIX = 'animus-asset:';

/**
 * Brands the specifier only — aliases, exports maps and hashing belong to the
 * host bundler. A literal URL string stays a valid alternative.
 */
export function asset(specifier: string): AssetRef {
  return (ASSET_PLACEHOLDER_PREFIX + specifier) as AssetRef;
}
