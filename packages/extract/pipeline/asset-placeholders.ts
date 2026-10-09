import type {
  ManifestComponentDescriptor,
  ProjectManifest,
} from './manifest-schema';

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
 *  strict build and warns otherwise. */
export function reportSurvivingAssetPlaceholders(
  css: string,
  report: {
    strict?: boolean;
    warn: (message: string) => void;
    prefix: string;
    /** Where the text goes; emitted CSS unless named. */
    surface?: string;
  }
): void {
  const specifiers = findAssetSpecifiers(css);
  if (specifiers.length === 0) return;
  const message = `${report.prefix} asset() placeholders reached ${report.surface ?? 'emitted CSS'} unsubstituted: ${specifiers.join(', ')} (${UNSUBSTITUTED_ASSET_CODE})`;
  if (report.strict) throw new Error(message);
  report.warn(message);
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
