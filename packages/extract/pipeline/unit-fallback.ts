/**
 * CSS properties that accept unitless numeric values.
 * Matches @emotion/unitless and React DOM's style handling.
 * Bare numerics on properties NOT in this set receive `px`.
 */
const UNITLESS_PROPERTIES = new Set([
  'animation-iteration-count',
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
  'flex-positive',
  'flex-shrink',
  'flex-negative',
  'flex-order',
  'grid-area',
  'grid-row',
  'grid-row-end',
  'grid-row-span',
  'grid-row-start',
  'grid-column',
  'grid-column-end',
  'grid-column-span',
  'grid-column-start',
  'font-weight',
  'line-clamp',
  'line-height',
  'opacity',
  'order',
  'orphans',
  'tab-size',
  'widows',
  'z-index',
  'zoom',
  'fill-opacity',
  'flood-opacity',
  'stop-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
]);

/**
 * Append `px` to bare numeric values in CSS declarations for properties
 * that expect length units. Unitless properties are preserved as-is.
 * Numbers inside CSS function calls (cubic-bezier, rgb, calc, etc.) are skipped.
 */
export function applyUnitFallback(css: string): string {
  return css.replace(
    /([a-z-]+)\s*:\s*([^;{}]+);/g,
    (match, prop: string, value: string) => {
      if (UNITLESS_PROPERTIES.has(prop)) return match;
      // Strip function call contents to avoid mangling cubic-bezier(), rgb(), etc.
      // Replace numbers only OUTSIDE parenthesized expressions.
      let depth = 0;
      let fixed = '';
      let i = 0;
      while (i < value.length) {
        if (value[i] === '(') {
          depth++;
          fixed += value[i];
          i++;
        } else if (value[i] === ')') {
          depth--;
          fixed += value[i];
          i++;
        } else if (depth > 0) {
          fixed += value[i];
          i++;
        } else {
          const rest = value.slice(i);
          const numMatch = rest.match(/^(-?\d+\.?\d*)/);
          if (numMatch) {
            const num = numMatch[1];
            const after = value[i + num.length];
            if (after && /[a-z%]/i.test(after)) {
              fixed += num;
            } else {
              fixed += num + 'px';
            }
            i += num.length;
          } else {
            fixed += value[i];
            i++;
          }
        }
      }
      return fixed !== value ? `${prop}:${fixed};` : match;
    }
  );
}
