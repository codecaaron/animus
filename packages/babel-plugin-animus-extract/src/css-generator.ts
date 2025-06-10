import type { AnimusExtractState, AtomicClass,ComponentData } from './types';
import { camelToKebab, escapeSelector,generateAtomicClassName, generateClassName } from './utils';

// Default breakpoints (should be loaded from theme)
const DEFAULT_BREAKPOINTS = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
};

// Default spacing scale (should be loaded from theme)
const DEFAULT_SPACING_SCALE = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  32: '8rem',
  40: '10rem',
  48: '12rem',
  56: '14rem',
  64: '16rem',
};

export function generateCSS(
  componentData: ComponentData,
  state: AnimusExtractState
): string {
  const cssRules: string[] = [];

  // Generate component-level styles
  if (componentData.styles && Object.keys(componentData.styles).length > 0) {
    const className = generateClassName(JSON.stringify(componentData.styles));
    componentData.className = className;

    const css = generateStylesCSS(componentData.styles, `.${className}`);
    cssRules.push(css);
  }

  // Generate state-based styles
  if (componentData.states) {
    const stateCSS = generateStatesCSS(componentData.states, componentData.className || '');
    cssRules.push(...stateCSS);
  }

  return cssRules.join('\n\n');
}

function generateStylesCSS(styles: Record<string, any>, selector: string): string {
  const declarations: string[] = [];

  for (const [prop, value] of Object.entries(styles)) {
    const cssProperty = camelToKebab(prop);
    const cssValue = formatCSSValue(prop, value);

    if (cssValue !== null) {
      declarations.push(`  ${cssProperty}: ${cssValue};`);
    }
  }

  if (declarations.length === 0) return '';

  return `${selector} {\n${declarations.join('\n')}\n}`;
}

function generateStatesCSS(
  states: Record<string, any>,
  baseClassName: string
): string[] {
  const cssRules: string[] = [];

  for (const [stateName, stateStyles] of Object.entries(states)) {
    if (typeof stateStyles === 'object' && stateStyles !== null) {
      const stateClassName = `${baseClassName}--${stateName}`;
      const css = generateStylesCSS(stateStyles, `.${stateClassName}`);

      if (css) {
        cssRules.push(css);
      }
    }
  }

  return cssRules;
}

export function generateAtomicClasses(atomicClasses: Map<string, AtomicClass>): string {
  const cssRules: string[] = [];
  const breakpointRules: Record<string, string[]> = {};

  for (const atomicClass of atomicClasses.values()) {
    const selector = `.${escapeSelector(atomicClass.className)}`;
    const declaration = `${camelToKebab(atomicClass.prop)}: ${formatCSSValue(atomicClass.prop, atomicClass.value)};`;
    const rule = `${selector} { ${declaration} }`;

    if (atomicClass.breakpoint) {
      if (!breakpointRules[atomicClass.breakpoint]) {
        breakpointRules[atomicClass.breakpoint] = [];
      }
      breakpointRules[atomicClass.breakpoint].push(rule);
    } else {
      cssRules.push(rule);
    }
  }

  // Add media queries
  for (const [breakpoint, rules] of Object.entries(breakpointRules)) {
    const minWidth = DEFAULT_BREAKPOINTS[breakpoint as keyof typeof DEFAULT_BREAKPOINTS];
    if (minWidth) {
      const mediaQuery = `@media (min-width: ${minWidth}) {\n  ${rules.join('\n  ')}\n}`;
      cssRules.push(mediaQuery);
    }
  }

  return cssRules.join('\n');
}

export function createAtomicClass(
  prop: string,
  value: any,
  state: AnimusExtractState,
  breakpoint?: string
): AtomicClass | null {
  // Map common props to their scale
  const scaleProps = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml'];

  let cssValue: string;
  if (scaleProps.includes(prop) && typeof value === 'number') {
    // Use spacing scale
    cssValue = DEFAULT_SPACING_SCALE[value as keyof typeof DEFAULT_SPACING_SCALE] || `${value}px`;
  } else {
    cssValue = formatCSSValue(prop, value);
  }

  if (cssValue === null) return null;

  const className = generateAtomicClassName(prop, value, breakpoint);

  return {
    className,
    css: `${camelToKebab(expandProp(prop))}: ${cssValue};`,
    prop,
    value,
    breakpoint,
  };
}

function expandProp(prop: string): string {
  // Expand shorthand props to full CSS properties
  const expansions: Record<string, string> = {
    p: 'padding',
    px: 'padding-left',
    py: 'padding-top',
    pt: 'padding-top',
    pr: 'padding-right',
    pb: 'padding-bottom',
    pl: 'padding-left',
    m: 'margin',
    mx: 'margin-left',
    my: 'margin-top',
    mt: 'margin-top',
    mr: 'margin-right',
    mb: 'margin-bottom',
    ml: 'margin-left',
    bg: 'background',
    bgColor: 'background-color',
  };

  return expansions[prop] || prop;
}

function formatCSSValue(prop: string, value: any): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    // Add px to numeric values for certain properties
    const unitlessProps = ['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink'];
    return unitlessProps.includes(prop) ? String(value) : `${value}px`;
  }

  if (typeof value === 'boolean') {
    return value ? 'initial' : 'none';
  }

  return String(value);
}
