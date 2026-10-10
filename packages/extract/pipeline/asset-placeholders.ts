import type {
  ManifestComponentDescriptor,
  ProjectManifest,
} from './manifest-schema';

export const ASSET_PLACEHOLDER_PREFIX = 'animus-asset:';

/**
 * An asset reference: `animus-asset:<specifier>` at `[start, end)`, where a
 * browser would load it. That is the argument of a `url()` in any case,
 * quoted or bare, or a quoted string opening an `image-set()` or
 * `-webkit-image-set()` candidate. The same text elsewhere, such as in a
 * `content` string, is ordinary text.
 */
interface AssetReference {
  start: number;
  end: number;
  specifier: string;
}

const URL_OPEN_RE = /url\(\s*(['"]?)/gi;
const IMAGE_SET_OPEN_RE = /(?:-webkit-)?image-set\(/gi;
const BARE_SPECIFIER_RE = /^[^'")\s]+/;

/** The index of the `)` that closes the `(` at `open`, outside strings. */
function closingParen(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < css.length; i += 1) {
    const c = css[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

function quotedReference(css: string, quoteAt: number): AssetReference | null {
  const start = quoteAt + 1;
  if (!css.startsWith(ASSET_PLACEHOLDER_PREFIX, start)) return null;
  const end = css.indexOf(css[quoteAt], start);
  if (end === -1) return null;
  return {
    start,
    end,
    specifier: css.slice(start + ASSET_PLACEHOLDER_PREFIX.length, end),
  };
}

function assetReferences(css: string): AssetReference[] {
  if (!css.includes(ASSET_PLACEHOLDER_PREFIX)) return [];
  const references: AssetReference[] = [];
  for (const open of css.matchAll(URL_OPEN_RE)) {
    const at = (open.index ?? 0) + open[0].length;
    if (open[1]) {
      const reference = quotedReference(css, at - 1);
      if (reference) references.push(reference);
      continue;
    }
    if (!css.startsWith(ASSET_PLACEHOLDER_PREFIX, at)) continue;
    const specifier = BARE_SPECIFIER_RE.exec(
      css.slice(at + ASSET_PLACEHOLDER_PREFIX.length)
    )?.[0];
    if (specifier === undefined) continue;
    const end = at + ASSET_PLACEHOLDER_PREFIX.length + specifier.length;
    references.push({ start: at, end, specifier });
  }
  for (const open of css.matchAll(IMAGE_SET_OPEN_RE)) {
    const paren = (open.index ?? 0) + open[0].length - 1;
    const close = closingParen(css, paren);
    let depth = 0;
    let candidateStart = true;
    for (let i = paren + 1; i < close; i += 1) {
      const c = css[i];
      if (/\s/.test(c)) continue;
      if (c === '"' || c === "'") {
        if (depth === 0 && candidateStart) {
          const reference = quotedReference(css, i);
          if (reference) references.push(reference);
        }
        const end = css.indexOf(c, i + 1);
        i = end === -1 ? close : end;
      } else if (c === '(') {
        depth += 1;
      } else if (c === ')') {
        depth -= 1;
      } else if (c === ',' && depth === 0) {
        candidateStart = true;
        continue;
      }
      candidateStart = false;
    }
  }
  return references.sort((a, b) => a.start - b.start);
}

export function findAssetSpecifiers(css: string): string[] {
  return [
    ...new Set(assetReferences(css).map((reference) => reference.specifier)),
  ];
}

export function substituteAssetPlaceholders(
  css: string,
  urlBySpecifier: ReadonlyMap<string, string>
): string {
  if (urlBySpecifier.size === 0) return css;
  let out = css;
  // From the end, so each earlier reference keeps its offsets.
  for (const reference of assetReferences(css).reverse()) {
    const url = urlBySpecifier.get(reference.specifier);
    if (url === undefined) continue;
    out = out.slice(0, reference.start) + url + out.slice(reference.end);
  }
  return out;
}

/**
 * Specifiers of placeholder text anywhere inside a `url()` or `image-set()`
 * call, a reference or not: after substitution any of it is a broken load.
 */
function placeholdersInAssetCalls(css: string): string[] {
  if (!css.includes(ASSET_PLACEHOLDER_PREFIX)) return [];
  const calls = [
    ...css.matchAll(URL_OPEN_RE),
    ...css.matchAll(IMAGE_SET_OPEN_RE),
  ].map((open) => {
    const paren = css.indexOf('(', open.index ?? 0);
    return [paren, closingParen(css, paren)] as const;
  });
  const found = new Set<string>();
  for (
    let at = css.indexOf(ASSET_PLACEHOLDER_PREFIX);
    at !== -1;
    at = css.indexOf(ASSET_PLACEHOLDER_PREFIX, at + 1)
  ) {
    if (!calls.some(([open, close]) => open < at && at < close)) continue;
    found.add(
      /^[^'")\s,]*/.exec(css.slice(at + ASSET_PLACEHOLDER_PREFIX.length))![0]
    );
  }
  return [...found];
}

/** The stylesheets one analysis emits. A theme scale value lands in
 *  `variableCss`, a global style in `globalCss` and a component's styles in
 *  `componentCss`; an asset() placeholder can sit in any of them. */
export interface AssetSheets {
  variableCss: string;
  globalCss: string;
  componentCss: string;
}

export function findSheetAssetSpecifiers(sheets: AssetSheets): string[] {
  return [
    ...new Set([
      ...findAssetSpecifiers(sheets.variableCss),
      ...findAssetSpecifiers(sheets.globalCss),
      ...findAssetSpecifiers(sheets.componentCss),
    ]),
  ];
}

/** The one substitution step every emitted sheet passes through. */
export function substituteSheetAssets(
  sheets: AssetSheets,
  urlBySpecifier: ReadonlyMap<string, string>
): AssetSheets {
  return {
    variableCss: substituteAssetPlaceholders(
      sheets.variableCss,
      urlBySpecifier
    ),
    globalCss: substituteAssetPlaceholders(sheets.globalCss, urlBySpecifier),
    componentCss: substituteAssetPlaceholders(
      sheets.componentCss,
      urlBySpecifier
    ),
  };
}

export const UNSUBSTITUTED_ASSET_CODE =
  'animus.asset.unsubstituted-placeholder';

/** A placeholder in emitted CSS is a broken URL in the browser: it fails a
 *  strict build, strict development reports it, and it warns otherwise. */
export function reportSurvivingAssetPlaceholders(
  css: string,
  report: {
    strict?: boolean;
    warn: (message: string) => void;
    /** Development's error sink: under `strict`, the message is reported
     *  here instead of thrown. */
    reportErrors?: (message: string) => void;
    prefix: string;
    /** Where the text goes; emitted CSS unless named. */
    surface?: string;
  }
): void {
  const specifiers = placeholdersInAssetCalls(css);
  if (specifiers.length === 0) return;
  const message = `${report.prefix} asset() placeholders reached ${report.surface ?? 'emitted CSS'} unsubstituted: ${specifiers.join(', ')} (${UNSUBSTITUTED_ASSET_CODE})`;
  if (!report.strict) {
    report.warn(message);
    return;
  }
  if (!report.reportErrors) throw new Error(message);
  report.reportErrors(message);
}

/**
 * The runtime code an analysis generates: each dynamic prop config, which the
 * shared prop map module carries, and each component's replacement. Extraction
 * lifts asset() out of them into root variables, so none should hold one.
 * Both embed values as JSON strings, so their quote and backslash escapes are
 * undone for scanning: the text is for `findAssetSpecifiers`, not to run.
 */
export function generatedModuleCode(manifest: {
  dynamic_props: ProjectManifest['dynamic_props'];
  components: Record<string, Pick<ManifestComponentDescriptor, 'replacement'>>;
}): string {
  return [
    JSON.stringify(manifest.dynamic_props),
    ...Object.values(manifest.components).map(
      (component) => component.replacement
    ),
  ]
    .join('\n')
    .replace(/\\(["\\])/g, '$1');
}
