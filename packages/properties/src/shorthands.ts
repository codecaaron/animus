/**
 * CSS shorthand properties registered in the prop config, used for
 * declaration ordering (shorthands before longhands).
 *
 * Entries use **camelCase** (prop config convention) because consumers
 * check against JS prop config keys, not CSS declaration names.
 * See unitless.ts for kebab-case convention rationale.
 *
 * Scoped to shorthands registered in the prop system — not all CSS shorthands.
 */
export const SHORTHAND_PROPERTIES = [
  'border',
  'borderTop',
  'borderBottom',
  'borderLeft',
  'borderRight',
  'borderWidth',
  'borderStyle',
  'borderColor',
  'background',
  'flex',
  'margin',
  'padding',
  'transition',
  'gap',
  'grid',
  'gridArea',
  'gridColumn',
  'gridRow',
  'gridTemplate',
  'overflow',
] as const;
