import { ASSET_PLACEHOLDER_PREFIX } from './asset-placeholders';
import { FONT_FACE_PRELOAD_COSTLY, severityFor } from './manifest-diagnostics';

import type { ManifestDiagnostic } from './manifest-diagnostics';
import type { ManifestFontPreload } from './manifest-schema';

/** A font file the document preloads, by the URL its face's `url()` names:
 *  an absolute or root-relative URL, one relative to the stylesheet, or an
 *  asset() placeholder until the host substitutes it. */
export interface FontPreload {
  href: string;
  /** The file's MIME type, where its format names a known one. */
  type?: string;
  /** The faces that preload the file: those whose flag asks, or those the
   *  host's `fontPreloads` selects. */
  faces?: PreloadedFontFace[];
}

/** A face that preloads a file: its family, as `fontPreloads` matches it,
 *  and the descriptors it declares. */
export interface PreloadedFontFace {
  family: string;
  weight?: string;
  style?: string;
  unicodeRange?: string;
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

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * The `<link>` tags for the preloads a host without a document emits: one
 * `preload` per file, `crossorigin`, as fonts are always fetched in CORS
 * mode. No `preconnect`: each preload opens its origin's connection as early
 * as one would. An href relative to the stylesheet resolves against `base`,
 * the URL the stylesheet's directory is served at. An href in `exclude`,
 * after resolution, is one the document already preloads.
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
  return resolved
    .map(({ href, type }) => {
      const typed =
        type === undefined ? '' : ` type="${escapeAttribute(type)}"`;
      return `<link rel="preload" href="${escapeAttribute(href)}" as="font"${typed} crossorigin>`;
    })
    .join('\n');
}

/**
 * An ES module whose default export lists the preloads, each href relative
 * to the stylesheet written as `new URL(…, import.meta.url)`: a bundler
 * emits the file and gives the URL it serves it at, the one its CSS
 * pipeline gives the face's own `url()` beside this module.
 */
export function fontPreloadsModule(preloads: readonly FontPreload[]): string {
  const entries = preloads.map(({ href, type, faces }) => {
    const url = href.startsWith('./')
      ? `new URL(${JSON.stringify(href)}, import.meta.url).href`
      : JSON.stringify(href);
    const typed = type === undefined ? '' : `, type: ${JSON.stringify(type)}`;
    const declared =
      faces === undefined ? '' : `, faces: ${JSON.stringify(faces)}`;
    return `  { href: ${url}${typed}${declared} },\n`;
  });
  return `export default [\n${entries.join('')}];\n`;
}

/** A preloaded file larger than this delays first paint enough to report. */
export const COSTLY_FONT_PRELOAD_BYTES = 150 * 1024;

const FONT_FORMATS = new Map([
  ['font/woff2', 'WOFF2'],
  ['font/woff', 'WOFF'],
  ['font/ttf', 'TrueType'],
  ['font/otf', 'OpenType'],
]);

/**
 * One warning per face whose preload costs first paint: a file that is not
 * WOFF2 or WOFF, or one larger than `COSTLY_FONT_PRELOAD_BYTES`. A preload
 * competes with the critical CSS and JavaScript for the connection, so a
 * large or uncompressed font delays the first paint it was meant to steady.
 * The faces are those the engine preloaded the file for: by their flags, or
 * by the host's `fontPreloads` when `selected`. `sizeOf` gives an asset()
 * file's size in bytes, where it resolves; another URL is judged by its
 * format alone.
 */
export function costlyFontPreloadDiagnostics(
  preloads: readonly ManifestFontPreload[] | undefined,
  selected: boolean,
  sizeOf: (specifier: string) => number | undefined
): ManifestDiagnostic[] {
  const diagnostics: ManifestDiagnostic[] = [];
  const remedy = selected
    ? 'leave the face out of `fontPreloads`'
    : 'drop `preload`';
  for (const { href, type, faces } of preloads ?? []) {
    const format = type === undefined ? undefined : FONT_FORMATS.get(type);
    const specifier = href.startsWith(ASSET_PLACEHOLDER_PREFIX)
      ? href.slice(ASSET_PLACEHOLDER_PREFIX.length)
      : undefined;
    const size = specifier === undefined ? undefined : sizeOf(specifier);
    const compressed = format === 'WOFF2' || format === 'WOFF';
    if (compressed && (size === undefined || size <= COSTLY_FONT_PRELOAD_BYTES))
      continue;
    const file = (specifier ?? href).split(/[?#]/)[0]!.split('/').pop();
    const what = `${format === undefined ? 'a font of unknown format' : `a ${format} font`}${size === undefined ? '' : ` of ${Math.round(size / 1024)} KB`}`;
    for (const face of faces) {
      diagnostics.push({
        file: 'system',
        component: face,
        kind: 'warn',
        message: `the font face preloads ${file}, ${what}: a preload competes with the critical CSS and JavaScript for first paint, so a large or uncompressed font delays it — preload a WOFF2 file, subset the font, or ${remedy}`,
        code: FONT_FACE_PRELOAD_COSTLY,
        severity: severityFor(FONT_FACE_PRELOAD_COSTLY),
      });
    }
  }
  return diagnostics;
}
