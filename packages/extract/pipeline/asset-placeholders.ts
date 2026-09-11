export const ASSET_PLACEHOLDER_PREFIX = 'animus-asset:';

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PREFIX_RE = escapeRegExp(ASSET_PLACEHOLDER_PREFIX);

const QUOTED_PLACEHOLDER_RE = new RegExp(`(['"])${PREFIX_RE}([^'"]*?)\\1`, 'g');

const BARE_PLACEHOLDER_RE = new RegExp(`${PREFIX_RE}([^'")\\s]+)`, 'g');

export function findAssetSpecifiers(css: string): string[] {
  if (!css.includes(ASSET_PLACEHOLDER_PREFIX)) return [];
  const seen = new Set<string>();
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
