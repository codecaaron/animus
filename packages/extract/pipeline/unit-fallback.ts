import { UNITLESS_PROPERTIES } from '@animus-ui/properties';

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
