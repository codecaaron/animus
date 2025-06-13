/**
 * Minimal Atomic CSS Generator for POC
 *
 * Converts style objects to atomic CSS classes
 */

import type { CSSObject } from '../types/shared';

export interface AtomicClass {
  className: string;
  css: string;
}

// Map to store generated atomic classes
const atomicClassMap = new Map<string, AtomicClass>();

// Convert CSS property to class name prefix
function propToPrefix(prop: string): string {
  const prefixMap: Record<string, string> = {
    padding: 'p',
    paddingTop: 'pt',
    paddingRight: 'pr',
    paddingBottom: 'pb',
    paddingLeft: 'pl',
    margin: 'm',
    marginTop: 'mt',
    marginRight: 'mr',
    marginBottom: 'mb',
    marginLeft: 'ml',
    backgroundColor: 'bg',
    color: 'col',
    borderRadius: 'br',
    border: 'b',
    width: 'w',
    height: 'h',
    fontSize: 'fs',
    fontWeight: 'fw',
    display: 'd',
    position: 'pos',
    opacity: 'op',
  };

  return (
    prefixMap[prop] ||
    prop.toLowerCase().replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
  );
}

// Convert CSS value to class name suffix
function valueToSuffix(value: string | number): string {
  return String(value).replace(/[^a-zA-Z0-9]/g, (match) => {
    const replacements: Record<string, string> = {
      '.': '_',
      ' ': '-',
      '#': '',
      '%': 'pct',
      '(': '',
      ')': '',
      ',': '-',
    };
    return replacements[match] || '';
  });
}

// Generate atomic class for a single style property
export function generateAtomicClass(
  prop: string,
  value: string | number
): AtomicClass {
  const prefix = propToPrefix(prop);
  const suffix = valueToSuffix(value);
  const className = `_${prefix}-${suffix}`;

  // Convert camelCase to kebab-case for CSS property
  const cssProp = prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  const css = `.${className} { ${cssProp}: ${value}; }`;

  return { className, css };
}

// Convert style object to array of atomic classes
export function stylesToAtomicClasses(styles: CSSObject): AtomicClass[] {
  const classes: AtomicClass[] = [];

  for (const [prop, value] of Object.entries(styles)) {
    // Skip pseudo-selectors and nested selectors for POC
    if (prop.startsWith('&') || prop.startsWith(':')) {
      continue;
    }

    // Skip non-primitive values for POC
    if (typeof value !== 'string' && typeof value !== 'number') {
      continue;
    }

    const atomicClass = generateAtomicClass(prop, value);

    // Check if we've already generated this exact class
    const existing = atomicClassMap.get(atomicClass.className);
    if (!existing) {
      atomicClassMap.set(atomicClass.className, atomicClass);
      classes.push(atomicClass);
    } else {
      classes.push(existing);
    }
  }

  return classes;
}

// Get all generated CSS
export function getGeneratedCSS(): string {
  return Array.from(atomicClassMap.values())
    .map(({ css }) => css)
    .join('\n');
}

// Clear generated classes (for testing)
export function clearAtomicClasses(): void {
  atomicClassMap.clear();
}
