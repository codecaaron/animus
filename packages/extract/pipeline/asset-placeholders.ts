/**
 * Host-side handling of `asset()` placeholders (global-styles-system):
 * `animus-asset:<specifier>` markers ride through the sandbox and the
 * emitter byte-exact; each HOST plugin substitutes them with its bundler's
 * resolved asset URL after extraction. This module owns the shared scanning
 * and replacement mechanics — resolution and strict gating stay at the
 * plugin call sites.
 */

/** Mirrors the producer-side constant in `@animus-ui/system`'s `asset.ts`
 *  (extract must not take a runtime dependency on system); the pairing is
 *  pinned by a contract test in `tests/asset-placeholders.test.ts`. */
export const ASSET_PLACEHOLDER_PREFIX = 'animus-asset:';

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PREFIX_RE = escapeRegExp(ASSET_PLACEHOLDER_PREFIX);

/**
 * Quoted `url('animus-asset:<specifier>')` form — the emitter always quotes
 * `url()` values, so a quoted match carries the FULL specifier, including
 * whitespace and parentheses (D5 pins the placeholder as specifier-verbatim,
 * so scanning fidelity is the only place such characters can be honored).
 */
const QUOTED_PLACEHOLDER_RE = new RegExp(`(['"])${PREFIX_RE}([^'"]*?)\\1`, 'g');

/** Bare-form fallback: a placeholder up to CSS url()/quote/whitespace. */
const BARE_PLACEHOLDER_RE = new RegExp(`${PREFIX_RE}([^'")\\s]+)`, 'g');

/** Unique asset specifiers referenced by placeholders, in appearance order. */
export function findAssetSpecifiers(css: string): string[] {
  // Overwhelmingly common case (no asset() usage at all): one substring
  // scan instead of two regex traversals, on every dev analysis pass.
  if (!css.includes(ASSET_PLACEHOLDER_PREFIX)) return [];
  const seen = new Set<string>();
  // Blank out quoted matches before the bare scan so the truncated tail of
  // a quoted specifier is never reported as its own (bogus) specifier.
  const remainder = css.replace(
    QUOTED_PLACEHOLDER_RE,
    (_match, _quote, specifier: string) => {
      seen.add(specifier);
      return '';
    }
  );
  for (const match of remainder.matchAll(BARE_PLACEHOLDER_RE)) {
    seen.add(match[1]);
  }
  return [...seen];
}

/**
 * Replace each specifier's placeholder with its substitution. Specifiers
 * absent from the map keep their placeholder — the caller decides whether
 * that is a strict failure or a warn-and-emit-literally. A substitution may
 * itself be a bundler marker (e.g. Vite's `__VITE_ASSET__<ref>__`) that the
 * host's own asset pipeline resolves to a hashed file name later.
 *
 * Each replacement is anchored to a following delimiter (quote, `)`,
 * whitespace, or end of input) so a specifier that textually prefixes a
 * longer one can never clobber the longer placeholder; longest-first
 * ordering additionally lets the longer of two mapped specifiers claim its
 * occurrences before the shorter runs.
 */
export function substituteAssetPlaceholders(
  css: string,
  urlBySpecifier: ReadonlyMap<string, string>
): string {
  if (urlBySpecifier.size === 0) return css;
  if (!css.includes(ASSET_PLACEHOLDER_PREFIX)) return css;
  const specifiers = [...urlBySpecifier.keys()].sort(
    (a, b) => b.length - a.length
  );
  let out = css;
  for (const specifier of specifiers) {
    const placeholder = new RegExp(
      escapeRegExp(ASSET_PLACEHOLDER_PREFIX + specifier) +
        String.raw`(?=['")\s]|$)`,
      'g'
    );
    out = out.replace(placeholder, () => urlBySpecifier.get(specifier)!);
  }
  return out;
}
