export const UNITLESS_PROPERTIES = new Set([
  // Keyframe names ending in digits (`animus-kf-1w7pb41`) would otherwise take
  // a `px` suffix; `animation-name` never carries a number.
  'animation-name',
  'animation-iteration-count',
  'aspect-ratio',
  'border-image-outset',
  'border-image-slice',
  'border-image-width',
  'box-flex',
  'box-flex-group',
  'box-ordinal-group',
  'column-count',
  'columns',
  'flex',
  'flex-grow',
  'flex-negative',
  'flex-order',
  'flex-positive',
  'flex-shrink',
  'fill-opacity',
  'flood-opacity',
  'font-weight',
  'grid-area',
  'grid-column',
  'grid-column-end',
  'grid-column-span',
  'grid-column-start',
  'grid-row',
  'grid-row-end',
  'grid-row-span',
  'grid-row-start',
  'line-clamp',
  'line-height',
  'opacity',
  'order',
  'orphans',
  'scale',
  'stop-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'tab-size',
  'widows',
  'z-index',
  'zoom',
  // The vendor-prefixed spellings csstype lists for the properties above,
  // obsolete ones included.
  '-moz-animation-iteration-count',
  '-moz-animation-name',
  '-moz-box-flex',
  '-moz-box-ordinal-group',
  '-moz-column-count',
  '-moz-columns',
  '-moz-opacity',
  '-moz-tab-size',
  '-ms-flex',
  '-ms-flex-positive',
  '-ms-order',
  '-o-animation-iteration-count',
  '-o-animation-name',
  '-o-tab-size',
  '-webkit-animation-iteration-count',
  '-webkit-animation-name',
  '-webkit-border-image-slice',
  '-webkit-box-flex',
  '-webkit-box-flex-group',
  '-webkit-box-ordinal-group',
  '-webkit-column-count',
  '-webkit-columns',
  '-webkit-flex',
  '-webkit-flex-grow',
  '-webkit-flex-shrink',
  '-webkit-line-clamp',
  '-webkit-order',
]);

/**
 * A style key's vendor prefix and the CSS prefix it stands for:
 * `WebkitLineClamp` is `-webkit-line-clamp`, `msFlex` is `-ms-flex`. The
 * extractor reads this table through `property_table.json`.
 */
export const VENDOR_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['Webkit', '-webkit-'],
  ['Moz', '-moz-'],
  ['ms', '-ms-'],
  ['O', '-o-'],
];

/** The camelCase style key of a CSS property name. */
function styleKey(property: string): string {
  const vendor = VENDOR_PREFIXES.find(([, prefix]) =>
    property.startsWith(prefix)
  );
  const [key, rest] = vendor
    ? [vendor[0], property.slice(vendor[1].length - 1)]
    : ['', property];
  return (
    key + rest.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
  );
}

const UNITLESS_PROPERTY_SPELLINGS = new Set<string>();
for (const property of UNITLESS_PROPERTIES) {
  UNITLESS_PROPERTY_SPELLINGS.add(property);
  UNITLESS_PROPERTY_SPELLINGS.add(styleKey(property));
}

/** Accepts either spelling: `line-height` or `lineHeight`,
 *  `-webkit-line-clamp` or `WebkitLineClamp`. */
export function isUnitlessProperty(property: string): boolean {
  return UNITLESS_PROPERTY_SPELLINGS.has(property);
}
