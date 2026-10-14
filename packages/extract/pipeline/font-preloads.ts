import { ASSET_PLACEHOLDER_PREFIX } from './asset-placeholders';

/** A font file the document preloads, by the URL its face's `url()` names:
 *  an absolute or root-relative URL, one relative to the stylesheet, or an
 *  asset() placeholder until the host substitutes it. */
export interface FontPreload {
  href: string;
  /** The file's MIME type, where its format names a known one. */
  type?: string;
}

/**
 * The preloads with each asset() placeholder replaced by the URL the host
 * gives the face's own `url()`, as `substituteAssetPlaceholders` does the
 * sheets, so the two are byte-identical and the browser fetches the file
 * once. One the map does not name keeps its placeholder.
 */
export function substituteFontPreloads(
  preloads: readonly FontPreload[] | undefined,
  urlBySpecifier: ReadonlyMap<string, string>
): FontPreload[] {
  return (preloads ?? []).map((preload) => {
    const href = preload.href.startsWith(ASSET_PLACEHOLDER_PREFIX)
      ? urlBySpecifier.get(preload.href.slice(ASSET_PLACEHOLDER_PREFIX.length))
      : undefined;
    return href === undefined ? preload : { ...preload, href };
  });
}

/** The origins of the absolute hrefs, once each, in order: a
 *  protocol-relative href's stays protocol-relative, to follow the page's.
 *  An href no URL parser reads has none; its preload fails on its own. */
export function fontPreloadOrigins(hrefs: readonly string[]): string[] {
  const origins = new Set<string>();
  for (const href of hrefs) {
    if (!/^(?:https?:)?\/\//i.test(href)) continue;
    try {
      const { origin } = new URL(href, 'https://animus.invalid');
      // As authored, port included: parsing would drop a default port.
      origins.add(
        href.startsWith('//') ? `//${href.slice(2).split(/[/?#]/)[0]}` : origin
      );
    } catch {
      // No origin to warm.
    }
  }
  return [...origins];
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * The `<link>` tags for the preloads a host without a document emits: one
 * `preconnect` per other origin, then one `preload` per file, each
 * `crossorigin`, as fonts are always fetched in CORS mode. An href relative
 * to the stylesheet resolves against `base`, the URL the stylesheet's
 * directory is served at. An href in `exclude`, after resolution, is one the
 * document already preloads.
 */
export function renderFontPreloads(
  preloads: readonly FontPreload[],
  options: { base?: string; exclude?: Iterable<string> } = {}
): string {
  const base =
    options.base === undefined ? '' : options.base.replace(/\/?$/, '/');
  const exclude = new Set(options.exclude ?? []);
  const resolved = preloads
    .map(({ href, type }) => ({
      href: href.startsWith('./') ? `${base}${href.slice(2)}` : href,
      type,
    }))
    .filter(({ href }) => !exclude.has(href));
  return [
    ...fontPreloadOrigins(resolved.map(({ href }) => href)).map(
      (origin) =>
        `<link rel="preconnect" href="${escapeAttribute(origin)}" crossorigin>`
    ),
    ...resolved.map(({ href, type }) => {
      const typed =
        type === undefined ? '' : ` type="${escapeAttribute(type)}"`;
      return `<link rel="preload" href="${escapeAttribute(href)}" as="font"${typed} crossorigin>`;
    }),
  ].join('\n');
}

/**
 * An ES module whose default export lists the preloads, each href relative
 * to the stylesheet written as `new URL(…, import.meta.url)`: a bundler
 * emits the file and gives the URL it serves it at, the one its CSS
 * pipeline gives the face's own `url()` beside this module.
 */
export function fontPreloadsModule(preloads: readonly FontPreload[]): string {
  const entries = preloads.map(({ href, type }) => {
    const url = href.startsWith('./')
      ? `new URL(${JSON.stringify(href)}, import.meta.url).href`
      : JSON.stringify(href);
    const typed = type === undefined ? '' : `, type: ${JSON.stringify(type)}`;
    return `  { href: ${url}${typed} },\n`;
  });
  return `export default [\n${entries.join('')}];\n`;
}
