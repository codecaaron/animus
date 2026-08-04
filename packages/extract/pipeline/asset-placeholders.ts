/**
 * Host-side handling of `asset()` placeholders (global-styles-system):
 * `animus-asset:<specifier>` markers ride through the sandbox and the
 * emitter byte-exact; each HOST plugin substitutes them with its bundler's
 * resolved asset URL after extraction. This module owns the shared scanning
 * and replacement mechanics — resolution and strict gating stay at the
 * plugin call sites.
 */

export const ASSET_PLACEHOLDER_PREFIX = 'animus-asset:';

/** Matches a placeholder up to CSS url()/quote/whitespace delimiters. */
const PLACEHOLDER_RE = /animus-asset:([^'")\s]+)/g;

/** Unique asset specifiers referenced by placeholders, in appearance order. */
export function findAssetSpecifiers(css: string): string[] {
  const seen = new Set<string>();
  for (const match of css.matchAll(PLACEHOLDER_RE)) {
    seen.add(match[1]);
  }
  return [...seen];
}

/**
 * Replace each specifier's placeholder with its substitution. Specifiers
 * absent from the map keep their placeholder — the caller decides whether
 * that is a strict failure, a warn-and-emit-literally, or a later pass
 * (e.g. Vite's generateBundle rewrite of hashed asset names).
 */
export function substituteAssetPlaceholders(
  css: string,
  urlBySpecifier: ReadonlyMap<string, string>
): string {
  if (urlBySpecifier.size === 0) return css;
  return css.replace(PLACEHOLDER_RE, (placeholder, specifier: string) => {
    return urlBySpecifier.get(specifier) ?? placeholder;
  });
}
