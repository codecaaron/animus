/**
 * CSS properties that accept unitless numeric values.
 * Bare numerics on properties NOT in this set receive automatic `px` suffix.
 *
 * Entries use **kebab-case** (CSS declaration convention) because consumers
 * check against CSS property names in post-processed output.
 * See shorthands.ts for camelCase convention rationale.
 */
export const UNITLESS_PROPERTIES = new Set([
  // `animation-name` is always an identifier (keyframe name) or `none`;
  // bare-number unit fallback must skip it — otherwise a hash-based keyframe
  // name whose tail looks numeric (e.g. `animus-kf-1w7pb41`) gets mangled
  // into `animus-kf-1w7pb41px`.
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

/**
 * Both spellings of every unitless property, precomputed at module load.
 *
 * Callers arrive from two directions — CSS declaration text (kebab-case) and
 * prop configs (camelCase) — and the lookup sits on the runtime's dynamic-prop
 * hot path, so the conversion happens once here rather than per call.
 * Single-word entries convert to themselves and collapse into one member.
 */
const UNITLESS_PROPERTY_SPELLINGS = new Set<string>();
for (const property of UNITLESS_PROPERTIES) {
  UNITLESS_PROPERTY_SPELLINGS.add(property);
  UNITLESS_PROPERTY_SPELLINGS.add(
    property.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
  );
}

/**
 * Whether bare numeric values on this CSS property render without a unit.
 * Accepts either spelling (`line-height` or `lineHeight`) — the single home
 * for the unitless decision, so no caller has to pair a case conversion with
 * a set lookup of its own.
 */
export function isUnitlessProperty(property: string): boolean {
  return UNITLESS_PROPERTY_SPELLINGS.has(property);
}
