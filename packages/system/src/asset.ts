declare const ASSET_REF_BRAND: unique symbol;

/**
 * A branded package-asset reference for `fontFaces[].src[].url`
 * (global-styles-system). The VALUE is the deterministic placeholder
 * `animus-asset:<specifier>` — a plain string, so it survives the QuickJS
 * sandbox's JSON serialization and the extraction emitter's byte-exact url
 * pass-through untouched. The HOST plugin substitutes the placeholder with
 * the bundler-resolved asset URL after extraction; the sandbox never
 * resolves anything.
 */
export type AssetRef = string & { readonly [ASSET_REF_BRAND]: true };

/** The reserved scheme marking an unsubstituted asset reference. */
export const ASSET_PLACEHOLDER_PREFIX = 'animus-asset:';

/**
 * Reference a package-owned asset (e.g. a font file) by module specifier:
 * `asset('@acme/tokens/fonts/inter.woff2')`. Resolution — aliases, exports
 * maps, `base`, content hashing — belongs to the host bundler; this function
 * only brands the specifier into its placeholder form. A literal URL string
 * (`'/fonts/inter.woff2'`) remains the pass-through alternative.
 */
export function asset(specifier: string): AssetRef {
  return (ASSET_PLACEHOLDER_PREFIX + specifier) as AssetRef;
}
