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
