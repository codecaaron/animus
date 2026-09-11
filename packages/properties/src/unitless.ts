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
]);

const UNITLESS_PROPERTY_SPELLINGS = new Set<string>();
for (const property of UNITLESS_PROPERTIES) {
  UNITLESS_PROPERTY_SPELLINGS.add(property);
  UNITLESS_PROPERTY_SPELLINGS.add(
    property.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
  );
}

/** Accepts either spelling: `line-height` or `lineHeight`. */
export function isUnitlessProperty(property: string): boolean {
  return UNITLESS_PROPERTY_SPELLINGS.has(property);
}
