/**
 * CSS parsing and analysis utilities for testing
 * Helps verify cascade order, style inheritance, and CSS output
 */

/**
 * Parses CSS string and extracts class names in order of appearance
 * Essential for verifying cascade ordering in extension tests
 */
export function parseCSSOrder(css: string): string[] {
  const classNames: string[] = [];

  // Match class selectors (handles both .className and complex selectors)
  const regex = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match;

  while ((match = regex.exec(css)) !== null) {
    const className = match[1];
    // Only add unique class names in order
    if (!classNames.includes(className)) {
      classNames.push(className);
    }
  }

  return classNames;
}

/**
 * Extracts component names from Animus-generated class names
 * e.g., "animus-Button-abc123" -> "Button"
 */
export function extractComponentNames(css: string): string[] {
  const componentNames: string[] = [];

  // Match animus class pattern: .animus-ComponentName-hash or .ComponentName-hash
  const regex = /\.(?:animus-)?([A-Z][a-zA-Z0-9]*)-[a-f0-9]+/g;
  let match;

  while ((match = regex.exec(css)) !== null) {
    const componentName = match[1];
    if (!componentNames.includes(componentName)) {
      componentNames.push(componentName);
    }
  }

  return componentNames;
}

/**
 * Extracts computed styles for a specific class name from CSS string
 * Returns an object with all CSS properties and their values
 */
export function getComputedStyles(
  css: string,
  className: string
): Record<string, string> {
  const styles: Record<string, string> = {};

  // Escape special characters in class name for regex
  const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match the class and its rules (handles nested braces)
  const classRegex = new RegExp(
    `\\.${escapedClassName}\\s*{([^{}]*(?:{[^}]*}[^{}]*)*)}`
  );
  const match = classRegex.exec(css);

  if (!match) return styles;

  // Extract style declarations
  const rulesContent = match[1];

  // Parse individual declarations (property: value)
  const declarationRegex = /([a-zA-Z-]+)\s*:\s*([^;]+);/g;
  let declMatch;

  while ((declMatch = declarationRegex.exec(rulesContent)) !== null) {
    const property = declMatch[1].trim();
    const value = declMatch[2].trim();
    styles[property] = value;
  }

  return styles;
}

/**
 * Finds a specific style declaration in CSS
 * Returns the value if found, null otherwise
 */
export function findStyleDeclaration(
  css: string,
  selector: string,
  property: string
): string | null {
  const styles = getComputedStyles(css, selector);
  return styles[property] || null;
}

/**
 * Verifies that child styles properly override parent styles
 * Used for extension cascade testing
 */
export function verifyCascadeOverride(
  css: string,
  parentClass: string,
  childClass: string,
  property: string
): {
  parentValue: string | null;
  childValue: string | null;
  properlyOverrides: boolean;
} {
  const parentStyles = getComputedStyles(css, parentClass);
  const childStyles = getComputedStyles(css, childClass);

  const parentValue = parentStyles[property] || null;
  const childValue = childStyles[property] || null;

  return {
    parentValue,
    childValue,
    properlyOverrides:
      parentValue !== null && childValue !== null && parentValue !== childValue,
  };
}

/**
 * Analyzes CSS output for responsive values
 * Extracts media query breakpoints and their styles
 */
export function analyzeResponsiveStyles(
  css: string,
  className: string
): Map<string, Record<string, string>> {
  const responsiveStyles = new Map<string, Record<string, string>>();

  // Base styles (no media query)
  const baseStyles = getComputedStyles(css, className);
  if (Object.keys(baseStyles).length > 0) {
    responsiveStyles.set('_', baseStyles);
  }

  // Extract media queries
  const mediaRegex = /@media[^{]+{([^}]+\.${className}[^}]+})}/g;
  let mediaMatch;

  while ((mediaMatch = mediaRegex.exec(css)) !== null) {
    // Extract breakpoint from media query
    const breakpointMatch = mediaMatch[0].match(/min-width:\s*(\d+)px/);
    if (breakpointMatch) {
      const breakpoint = breakpointMatch[1];
      const mediaStyles = getComputedStyles(mediaMatch[1], className);

      // Map pixel values to breakpoint names (this should match your theme)
      const breakpointMap: Record<string, string> = {
        '576': 'sm',
        '768': 'md',
        '992': 'lg',
        '1200': 'xl',
      };

      const breakpointName = breakpointMap[breakpoint] || breakpoint;
      responsiveStyles.set(breakpointName, mediaStyles);
    }
  }

  return responsiveStyles;
}

/**
 * Counts the number of unique CSS rules in the output
 * Useful for performance testing
 */
export function countCSSRules(css: string): {
  totalRules: number;
  classRules: number;
  mediaQueries: number;
  keyframes: number;
} {
  const classMatches = css.match(/\.[a-zA-Z][^{]*{/g) || [];
  const mediaMatches = css.match(/@media[^{]*{/g) || [];
  const keyframeMatches = css.match(/@keyframes[^{]*{/g) || [];

  return {
    totalRules:
      classMatches.length + mediaMatches.length + keyframeMatches.length,
    classRules: classMatches.length,
    mediaQueries: mediaMatches.length,
    keyframes: keyframeMatches.length,
  };
}

/**
 * Verifies CSS output matches expected patterns
 * Used for snapshot-like testing without actual snapshots
 */
export function assertCSSContains(
  css: string,
  expectations: {
    classes?: string[];
    styles?: Array<{ selector: string; property: string; value: string }>;
    order?: string[];
  }
): void {
  // Check for expected classes
  if (expectations.classes) {
    for (const className of expectations.classes) {
      if (!css.includes(`.${className}`)) {
        throw new Error(`Expected CSS to contain class .${className}`);
      }
    }
  }

  // Check for specific style declarations
  if (expectations.styles) {
    for (const { selector, property, value } of expectations.styles) {
      const actualValue = findStyleDeclaration(css, selector, property);
      if (actualValue !== value) {
        throw new Error(
          `Expected .${selector} { ${property}: ${value} }, got ${property}: ${actualValue}`
        );
      }
    }
  }

  // Check class order
  if (expectations.order) {
    const actualOrder = extractComponentNames(css);
    const expectedInActual = expectations.order.filter((name) =>
      actualOrder.includes(name)
    );

    // Verify relative order is maintained
    for (let i = 0; i < expectedInActual.length - 1; i++) {
      const currentIndex = actualOrder.indexOf(expectedInActual[i]);
      const nextIndex = actualOrder.indexOf(expectedInActual[i + 1]);

      if (currentIndex >= nextIndex) {
        throw new Error(
          `Expected ${expectedInActual[i]} to appear before ${expectedInActual[i + 1]} in CSS`
        );
      }
    }
  }
}
