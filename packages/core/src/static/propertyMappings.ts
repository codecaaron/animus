/**
 * CSS property mappings and utilities for static extraction
 */

// Default breakpoints from compatTheme
export const DEFAULT_BREAKPOINTS = {
  xs: 480,
  sm: 768,
  md: 1024,
  lg: 1200,
  xl: 1440,
} as const;

// CSS shorthand to full property mappings
export const PROPERTY_MAPPINGS: Record<string, string | string[]> = {
  // Margin shorthands
  m: 'margin',
  mx: ['marginLeft', 'marginRight'],
  my: ['marginTop', 'marginBottom'],
  mt: 'marginTop',
  mb: 'marginBottom',
  mr: 'marginRight',
  ml: 'marginLeft',

  // Padding shorthands
  p: 'padding',
  px: ['paddingLeft', 'paddingRight'],
  py: ['paddingTop', 'paddingBottom'],
  pt: 'paddingTop',
  pb: 'paddingBottom',
  pr: 'paddingRight',
  pl: 'paddingLeft',

  // Background shorthands
  bg: 'backgroundColor',
  gradient: 'backgroundImage',

  // Border shorthands
  borderX: ['borderLeft', 'borderRight'],
  borderY: ['borderTop', 'borderBottom'],
  borderColorX: ['borderLeftColor', 'borderRightColor'],
  borderColorY: ['borderTopColor', 'borderBottomColor'],
  borderWidthX: ['borderLeftWidth', 'borderRightWidth'],
  borderWidthY: ['borderTopWidth', 'borderBottomWidth'],
  borderRadiusLeft: ['borderTopLeftRadius', 'borderBottomLeftRadius'],
  borderRadiusTop: ['borderTopLeftRadius', 'borderTopRightRadius'],
  borderRadiusBottom: ['borderBottomLeftRadius', 'borderBottomRightRadius'],
  borderRadiusRight: ['borderTopRightRadius', 'borderBottomRightRadius'],
  borderStyleX: ['borderLeftStyle', 'borderRightStyle'],
  borderStyleY: ['borderTopStyle', 'borderBottomStyle'],

  // Layout shorthands
  size: ['width', 'height'],
  area: 'gridArea',
  cols: 'gridTemplateColumns',
  rows: 'gridTemplateRows',
  flow: 'gridAutoFlow',

  // Position shorthands
  inset: ['top', 'right', 'bottom', 'left'],

  // Alignment shorthands
  alignAll: ['justifyContent', 'alignItems'],
} as const;

// Properties that are shorthands and should be processed first
export const SHORTHAND_PROPERTIES = [
  'margin',
  'padding',
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
  'transition',
  'gap',
  'grid',
  'gridArea',
  'gridColumn',
  'gridRow',
  'gridTemplate',
  'overflow',
];

/**
 * Expand a shorthand property to its full CSS property name(s)
 */
export function expandShorthand(prop: string): string | string[] {
  return PROPERTY_MAPPINGS[prop] || prop;
}

/**
 * Check if a property is a shorthand
 */
export function isShorthand(prop: string): boolean {
  return prop in PROPERTY_MAPPINGS;
}

/**
 * Generate media query string for a breakpoint
 */
export function generateMediaQuery(
  breakpoint: string,
  breakpoints = DEFAULT_BREAKPOINTS
): string {
  const value = breakpoints[breakpoint as keyof typeof breakpoints];
  if (!value) return '';
  return `@media screen and (min-width: ${value}px)`;
}

/**
 * Get ordered breakpoint keys for array mapping
 */
export function getBreakpointOrder(): string[] {
  return ['_', 'xs', 'sm', 'md', 'lg', 'xl'];
}

/**
 * Check if a value is a responsive array
 */
export function isResponsiveArray(value: any): value is any[] {
  return Array.isArray(value);
}

/**
 * Check if a value is a responsive object
 */
export function isResponsiveObject(value: any): value is Record<string, any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  const breakpointKeys = getBreakpointOrder();
  return keys.some((key) => breakpointKeys.includes(key));
}

/**
 * Sort properties with shorthands first, then more specific properties
 */
export function sortPropertiesBySpecificity(props: string[]): string[] {
  // First pass: separate shorthands and specific properties
  const shorthands: string[] = [];
  const specific: string[] = [];

  for (const prop of props) {
    const expanded = expandShorthand(prop);
    const expandedProps = Array.isArray(expanded) ? expanded : [expanded];

    if (expandedProps.some((p) => SHORTHAND_PROPERTIES.includes(p))) {
      shorthands.push(prop);
    } else {
      specific.push(prop);
    }
  }

  // Sort shorthands by specificity (more general first)
  shorthands.sort((a, b) => {
    const aExpanded = expandShorthand(a);
    const bExpanded = expandShorthand(b);
    const aCount = Array.isArray(aExpanded) ? aExpanded.length : 1;
    const bCount = Array.isArray(bExpanded) ? bExpanded.length : 1;

    // More properties = less specific = should come first
    return bCount - aCount;
  });

  return [...shorthands, ...specific];
}
