import { compatTheme } from '../compatTheme';
import type { ComponentRegistry } from './component-registry';
import { cssPropertyScales } from './cssPropertyScales';
import type { ExtractedStyles } from './extractor';
import {
  expandShorthand,
  generateMediaQuery,
  getBreakpointOrder,
  isResponsiveArray,
  isResponsiveObject,
  sortPropertiesBySpecificity,
} from './propertyMappings';
import {
  resolveThemeInStyles,
  StaticThemeResolver,
  ThemeResolutionStrategy,
} from './theme-resolver';
import type { UsageMap } from './usageCollector';

/**
 * CSS generation options
 */
export interface GeneratorOptions {
  atomic?: boolean;
  prefix?: string;
  themeResolution?: ThemeResolutionStrategy;
}

/**
 * Generated CSS result
 */
export interface GeneratedCSS {
  className: string;
  css: string;
}

/**
 * Layered CSS generation result - respects cascade order
 */
export interface LayeredCSS {
  cssVariables: string;
  baseStyles: string;
  variantStyles: string;
  stateStyles: string;
  atomicUtilities: string;
  fullCSS: string;
  usedTokens: Set<string>;

  // Breakpoint-organized styles (new)
  byBreakpoint?: {
    base: Record<string, string>; // breakpoint -> base styles for all components
    variants: Record<string, string>; // breakpoint -> variant styles for all components
    states: Record<string, string>; // breakpoint -> state styles for all components
    atomics: Record<string, string>; // breakpoint -> atomic utilities
  };
}

/**
 * Generate CSS from extracted Animus styles
 */
export class CSSGenerator {
  private options: GeneratorOptions;

  constructor(options: GeneratorOptions = {}) {
    this.options = {
      atomic: true,
      prefix: 'animus',
      ...options,
    };
  }

  /**
   * Generate CSS from extracted component styles
   */
  generateFromExtracted(
    extracted: ExtractedStyles,
    groupDefinitions?: Record<string, Record<string, any>>,
    theme?: any,
    usageMap?: UsageMap
  ): GeneratedCSS & { cssVariables?: string; usedTokens?: Set<string> } {
    // Component styles (styles, variants, states) always use grouped mode
    const componentCSS = this.generateGroupedFromExtracted(
      extracted,
      theme,
      groupDefinitions
    );

    // Generate atomic utilities for groups/props
    const atomicCSS = this.generateAtomicsFromGroupsAndProps(
      extracted,
      groupDefinitions,
      theme,
      usageMap
    );

    // Combine component styles and atomic utilities
    // Atomic utilities come AFTER component styles in the cascade

    // Merge CSS variables from both sources
    let mergedCssVariables = '';
    const mergedUsedTokens = new Set<string>();

    if (componentCSS.cssVariables || atomicCSS.cssVariables) {
      const allVars = new Map<string, string>();

      // Parse component variables
      if (componentCSS.cssVariables) {
        const matches = componentCSS.cssVariables.matchAll(
          /\s*(--[^:]+):\s*([^;]+);/g
        );
        for (const match of matches) {
          allVars.set(match[1], match[2]);
        }
      }

      // Parse atomic variables
      if (atomicCSS.cssVariables) {
        const matches = atomicCSS.cssVariables.matchAll(
          /\s*(--[^:]+):\s*([^;]+);/g
        );
        for (const match of matches) {
          allVars.set(match[1], match[2]);
        }
      }

      // Generate merged CSS variables
      if (allVars.size > 0) {
        const declarations = Array.from(allVars.entries())
          .map(([varName, value]) => `  ${varName}: ${value};`)
          .join('\n');
        mergedCssVariables = `:root {\n${declarations}\n}`;
      }
    }

    // Merge used tokens
    if (componentCSS.usedTokens) {
      componentCSS.usedTokens.forEach((token) => mergedUsedTokens.add(token));
    }
    if (atomicCSS.usedTokens) {
      atomicCSS.usedTokens.forEach((token) => mergedUsedTokens.add(token));
    }

    if (atomicCSS.css) {
      return {
        className: componentCSS.className,
        css: `${componentCSS.css}\n\n${atomicCSS.css}`,
        cssVariables: mergedCssVariables || undefined,
        usedTokens: mergedUsedTokens.size > 0 ? mergedUsedTokens : undefined,
      };
    }

    return {
      ...componentCSS,
      cssVariables: mergedCssVariables || componentCSS.cssVariables,
      usedTokens:
        mergedUsedTokens.size > 0 ? mergedUsedTokens : componentCSS.usedTokens,
    };
  }

  /**
   * Generate atomic CSS from extracted styles
   * @deprecated Use generateGroupedFromExtracted instead
   */
  // private _generateAtomicFromExtracted(extracted: ExtractedStyles): GeneratedCSS {
  //   const allClasses: string[] = [];
  //   const allCSS: string[] = [];

  //   // Generate base styles
  //   if (extracted.baseStyles) {
  //     const { className, css } = this.generateStyles(
  //       extracted.baseStyles,
  //       extracted.componentName || 'component'
  //     );
  //     allClasses.push(className);
  //     allCSS.push(css);
  //   }

  //   // Generate variant styles
  //   if (extracted.variants) {
  //     const variantsList = Array.isArray(extracted.variants) ? extracted.variants : [extracted.variants];

  //     for (const variantConfig of variantsList) {
  //       if (variantConfig && variantConfig.variants) {
  //         const variantProp = variantConfig.prop || 'variant';
  //         const variants = variantConfig.variants;

  //         for (const [variantName, variantStyles] of Object.entries(variants)) {
  //           if (variantStyles && typeof variantStyles === 'object') {
  //             const variantClass = `${extracted.componentName || 'component'}--${variantProp}-${variantName}`;
  //             const { css } = this.generateStyles(
  //               variantStyles as Record<string, any>,
  //               variantClass
  //             );
  //             allCSS.push(`/* Variant: ${variantProp}="${variantName}" */\n${css}`);
  //           }
  //         }
  //       }
  //     }
  //   }

  //   // Generate state styles
  //   if (extracted.states) {
  //     for (const [stateName, stateStyles] of Object.entries(extracted.states)) {
  //       if (stateStyles && typeof stateStyles === 'object') {
  //         const stateClass = `${extracted.componentName || 'component'}--${stateName}`;
  //         const { css } = this.generateStyles(
  //           stateStyles as Record<string, any>,
  //           stateClass
  //         );
  //         allCSS.push(`/* State: ${stateName} */\n${css}`);
  //       }
  //     }
  //   }

  //   return {
  //     className: allClasses.join(' '),
  //     css: allCSS.join('\n\n'),
  //   };
  // }

  /**
   * Generate grouped CSS with proper cascade ordering
   */
  private generateGroupedFromExtracted(
    extracted: ExtractedStyles,
    theme?: any,
    groupDefinitions?: Record<string, Record<string, any>>
  ): GeneratedCSS & { cssVariables?: string; usedTokens?: Set<string> } {
    const componentName = extracted.componentName || 'component';
    // Generate a simple hash from component name for better namespacing
    const componentHash = this.generateComponentHash(componentName);
    const mainClassName = `${this.options.prefix}-${componentHash}`;
    const cssRules: string[] = [];

    // Track theme resolution across all styles
    let allCssVariables = '';
    const allUsedTokens = new Set<string>();

    // Convert cssPropertyScales to the expected format
    const propConfig = Object.entries(cssPropertyScales).reduce(
      (acc, [prop, scale]) => {
        acc[prop] = { scale };
        return acc;
      },
      {} as Record<string, { scale?: string }>
    );

    // 1. Base styles (single selector with all rules and media queries)
    if (extracted.baseStyles) {
      const resolved = theme
        ? resolveThemeInStyles(
            extracted.baseStyles,
            theme,
            propConfig,
            this.options.themeResolution
          )
        : {
            resolved: extracted.baseStyles,
            cssVariables: '',
            usedTokens: new Set<string>(),
          };

      const baseRule = this.generateRule(
        `.${mainClassName}`,
        resolved.resolved
      );
      if (baseRule) {
        cssRules.push(`/* Base Styles */\n${baseRule}`);
      }

      // Collect theme data
      allCssVariables = resolved.cssVariables;
      resolved.usedTokens.forEach((token) => allUsedTokens.add(token));
    }

    // 2. Variant styles (maintain builder chain order)
    if (extracted.variants) {
      // Handle single variant object or array of variants
      const variantsList = Array.isArray(extracted.variants)
        ? extracted.variants
        : [extracted.variants];

      variantsList.forEach((variantConfig) => {
        if (variantConfig && variantConfig.variants) {
          const variantProp = variantConfig.prop || 'variant';
          const variants = variantConfig.variants;

          // Process variants in order they appear in the object
          for (const [variantName, variantStyles] of Object.entries(variants)) {
            if (variantStyles && typeof variantStyles === 'object') {
              // Resolve theme values in variant styles
              const resolved = theme
                ? resolveThemeInStyles(
                    variantStyles as Record<string, any>,
                    theme,
                    propConfig,
                    this.options.themeResolution
                  )
                : {
                    resolved: variantStyles,
                    cssVariables: '',
                    usedTokens: new Set<string>(),
                  };

              // Use single class selector with hash for equal specificity
              const variantClassName = `${mainClassName}-${variantProp}-${variantName}`;
              const variantSelector = `.${variantClassName}`;
              const variantRule = this.generateRule(
                variantSelector,
                resolved.resolved
              );
              if (variantRule) {
                cssRules.push(
                  `/* Variant: ${variantProp}="${variantName}" */\n${variantRule}`
                );
              }

              // Collect theme data
              resolved.usedTokens.forEach((token) => allUsedTokens.add(token));
            }
          }
        }
      });
    }

    // 3. State styles (ordered by parameter object keys)
    if (extracted.states) {
      // Object.entries maintains insertion order in modern JS
      for (const [stateName, stateStyles] of Object.entries(extracted.states)) {
        if (stateStyles && typeof stateStyles === 'object') {
          // Resolve theme values in state styles
          const resolved = theme
            ? resolveThemeInStyles(
                stateStyles as Record<string, any>,
                theme,
                propConfig,
                this.options.themeResolution
              )
            : {
                resolved: stateStyles,
                cssVariables: '',
                usedTokens: new Set<string>(),
              };

          // Use single class selector with hash for equal specificity
          const stateClassName = `${mainClassName}-state-${stateName}`;
          const stateSelector = `.${stateClassName}`;
          const stateRule = this.generateRule(stateSelector, resolved.resolved);
          if (stateRule) {
            cssRules.push(`/* State: ${stateName} */\n${stateRule}`);
          }

          // Collect theme data
          resolved.usedTokens.forEach((token) => allUsedTokens.add(token));
        }
      }
    }

    // 4. Groups and props would be handled as atomic utilities here
    // (not yet extracted, but this is where they would go)

    return {
      className: mainClassName,
      css: cssRules.join('\n\n'),
      cssVariables: allCssVariables,
      usedTokens: allUsedTokens,
    };
  }

  /**
   * Generate CSS from a styles object
   * Always uses grouped mode for component styles
   */
  // private generateStyles(
  //   styles: Record<string, any>,
  //   baseName: string
  // ): GeneratedCSS {
  //   return this.generateGroupedStyles(styles, baseName);
  // }

  /**
   * Generate atomic CSS classes (one class per property)
   * @deprecated No longer used - atomic utilities are generated differently
   */
  // private _generateAtomicStyles(
  //   styles: Record<string, any>,
  //   baseName: string
  // ): GeneratedCSS {
  //   const classes: string[] = [];
  //   const cssRules: string[] = [];
  //   const baseClass = `${this.options.prefix}-${baseName.toLowerCase()}`;

  //   // Sort properties to handle shorthands first
  //   const sortedProps = sortPropertiesBySpecificity(
  //     Object.keys(styles).filter(prop => !prop.startsWith('&') && !prop.startsWith('@'))
  //   );

  //   // First pass: regular properties
  //   for (const prop of sortedProps) {
  //     const value = styles[prop];

  //     // Handle responsive values
  //     if (isResponsiveArray(value) || isResponsiveObject(value)) {
  //       const responsiveRules = this.generateResponsiveRules(prop, value);
  //       classes.push(...responsiveRules.classes);
  //       cssRules.push(...responsiveRules.rules);
  //       continue;
  //     }

  //     // Expand shorthand properties
  //     const expandedProps = expandShorthand(prop);
  //     const propsToProcess = Array.isArray(expandedProps) ? expandedProps : [expandedProps];

  //     for (const cssPropName of propsToProcess) {
  //       // Generate unique class name for this property-value pair
  //       const classKey = `${cssPropName}:${JSON.stringify(value)}`;
  //       let className = this.classCache.get(classKey);

  //       if (!className) {
  //         className = this.generateClassName(cssPropName, value);
  //         this.classCache.set(classKey, className);

  //         // Convert camelCase to kebab-case
  //         const cssProp = cssPropName.replace(/([A-Z])/g, '-$1').toLowerCase();
  //         const cssValue = this.formatCSSValue(cssPropName, value);

  //         cssRules.push(`.${className} { ${cssProp}: ${cssValue}; }`);
  //       }

  //       classes.push(className);
  //     }
  //   }

  //   // Second pass: pseudo-selectors and nested rules
  //   for (const [prop, value] of Object.entries(styles)) {
  //     if (prop.startsWith('&') && typeof value === 'object') {
  //       const selector = prop.replace('&', `.${baseClass}`);
  //       const nestedDeclarations: string[] = [];

  //       for (const [nestedProp, nestedValue] of Object.entries(value)) {
  //         const cssProp = nestedProp.replace(/([A-Z])/g, '-$1').toLowerCase();
  //         const cssValue = this.formatCSSValue(nestedProp, nestedValue);
  //         nestedDeclarations.push(`  ${cssProp}: ${cssValue};`);
  //       }

  //       if (nestedDeclarations.length > 0) {
  //         cssRules.push(`${selector} {\n${nestedDeclarations.join('\n')}\n}`);
  //       }
  //     }
  //   }

  //   // Include base class in the class list for pseudo-selectors to work
  //   if (Object.keys(styles).some(key => key.startsWith('&'))) {
  //     classes.unshift(baseClass);
  //   }

  //   return {
  //     className: classes.join(' '),
  //     css: cssRules.join('\n'),
  //   };
  // }

  /**
   * Generate grouped CSS (all styles in one class)
   */
  // private generateGroupedStyles(
  //   styles: Record<string, any>,
  //   baseName: string
  // ): GeneratedCSS {
  //   const className = `${this.options.prefix}-${baseName}`;
  //   const cssRules: string[] = [];

  //   // Generate the main rule and nested rules
  //   const mainRule = this.generateRule(`.${className}`, styles);
  //   if (mainRule) {
  //     cssRules.push(mainRule);
  //   }

  //   return {
  //     className,
  //     css: cssRules.join('\n'),
  //   };
  // }

  /**
   * Generate CSS rules organized by breakpoint from styles object
   * Returns base styles and media rules separately for proper layering
   */
  private generateRulesByBreakpoint(
    selector: string,
    styles: Record<string, any>
  ): Record<string, string> {
    const declarations: string[] = [];
    const mediaRules: Record<string, string[]> = {};
    const result: Record<string, string> = {};

    // Sort properties to handle shorthands first
    const sortedProps = sortPropertiesBySpecificity(
      Object.keys(styles).filter(
        (prop) => !prop.startsWith('&') && !prop.startsWith('@')
      )
    );

    // Process regular properties first
    for (const prop of sortedProps) {
      const value = styles[prop];

      if (isResponsiveArray(value) || isResponsiveObject(value)) {
        // Handle responsive values
        const breakpointOrder = getBreakpointOrder();

        if (isResponsiveArray(value)) {
          value.forEach((val, index) => {
            if (val === undefined || val === null) return;
            const breakpoint = breakpointOrder[index];
            this.addResponsiveDeclarations(
              prop,
              val,
              breakpoint,
              selector,
              declarations,
              mediaRules
            );
          });
        } else {
          for (const [breakpoint, val] of Object.entries(value)) {
            if (val === undefined || val === null) continue;
            this.addResponsiveDeclarations(
              prop,
              val,
              breakpoint,
              selector,
              declarations,
              mediaRules
            );
          }
        }
      } else {
        // Regular property - expand shorthands
        const expandedProps = expandShorthand(prop);
        const propsToProcess = Array.isArray(expandedProps)
          ? expandedProps
          : [expandedProps];

        for (const cssPropName of propsToProcess) {
          const cssProp = cssPropName.replace(/([A-Z])/g, '-$1').toLowerCase();
          const cssValue = this.formatCSSValue(cssPropName, value);
          declarations.push(`  ${cssProp}: ${cssValue};`);
        }
      }
    }

    // Process nested selectors and other special properties
    for (const [prop, value] of Object.entries(styles)) {
      if (prop.startsWith('&')) {
        // Handle nested selectors
        const nestedSelector = prop.replace('&', selector);
        const nestedRulesByBreakpoint = this.generateRulesByBreakpoint(
          nestedSelector,
          value
        );

        // Merge nested rules into our result
        for (const [bp, rule] of Object.entries(nestedRulesByBreakpoint)) {
          if (!result[bp]) result[bp] = '';
          if (result[bp]) result[bp] += '\n';
          result[bp] += rule;
        }
      }
    }

    // Generate base rule (breakpoint '_')
    if (declarations.length > 0) {
      result['_'] =
        (result['_'] ? result['_'] + '\n' : '') +
        `${selector} {\n${declarations.join('\n')}\n}`;
    }

    // Generate media query rules for other breakpoints
    for (const [mediaQuery, mediaDeclarations] of Object.entries(mediaRules)) {
      if (mediaDeclarations.length > 0) {
        // Extract breakpoint from media query
        const breakpoint = this.extractBreakpointFromMediaQuery(mediaQuery);
        if (breakpoint && breakpoint !== '_') {
          const rule = `${selector} {\n${mediaDeclarations.join('\n')}\n}`;
          result[breakpoint] =
            (result[breakpoint] ? result[breakpoint] + '\n' : '') + rule;
        }
      }
    }

    return result;
  }

  /**
   * Extract breakpoint name from media query string
   */
  private extractBreakpointFromMediaQuery(mediaQuery: string): string | null {
    const breakpointOrder = getBreakpointOrder();
    for (const bp of breakpointOrder) {
      if (bp === '_') continue;
      const expectedQuery = generateMediaQuery(bp);
      if (mediaQuery === expectedQuery) {
        return bp;
      }
    }
    return null;
  }

  /**
   * Generate a CSS rule from styles object (handles nested selectors)
   * @deprecated Use generateRulesByBreakpoint for new breakpoint-aware generation
   */
  private generateRule(selector: string, styles: Record<string, any>): string {
    const declarations: string[] = [];
    const nestedRules: string[] = [];
    const mediaRules: Record<string, string[]> = {};

    // Sort properties to handle shorthands first
    const sortedProps = sortPropertiesBySpecificity(
      Object.keys(styles).filter(
        (prop) => !prop.startsWith('&') && !prop.startsWith('@')
      )
    );

    // Process regular properties first
    for (const prop of sortedProps) {
      const value = styles[prop];

      if (isResponsiveArray(value) || isResponsiveObject(value)) {
        // Handle responsive values
        const breakpointOrder = getBreakpointOrder();

        if (isResponsiveArray(value)) {
          value.forEach((val, index) => {
            if (val === undefined || val === null) return;
            const breakpoint = breakpointOrder[index];
            this.addResponsiveDeclarations(
              prop,
              val,
              breakpoint,
              selector,
              declarations,
              mediaRules
            );
          });
        } else {
          for (const [breakpoint, val] of Object.entries(value)) {
            if (val === undefined || val === null) continue;
            this.addResponsiveDeclarations(
              prop,
              val,
              breakpoint,
              selector,
              declarations,
              mediaRules
            );
          }
        }
      } else {
        // Regular property - expand shorthands
        const expandedProps = expandShorthand(prop);
        const propsToProcess = Array.isArray(expandedProps)
          ? expandedProps
          : [expandedProps];

        for (const cssPropName of propsToProcess) {
          const cssProp = cssPropName.replace(/([A-Z])/g, '-$1').toLowerCase();
          const cssValue = this.formatCSSValue(cssPropName, value);
          declarations.push(`  ${cssProp}: ${cssValue};`);
        }
      }
    }

    // Process nested selectors and other special properties
    for (const [prop, value] of Object.entries(styles)) {
      if (prop.startsWith('&')) {
        // Handle nested selectors
        const nestedSelector = prop.replace('&', selector);
        const nestedRule = this.generateRule(nestedSelector, value);
        if (nestedRule) {
          nestedRules.push(nestedRule);
        }
      }
    }

    let result = '';

    if (declarations.length > 0) {
      result = `${selector} {\n${declarations.join('\n')}\n}`;
    }

    if (nestedRules.length > 0) {
      result += result ? '\n' + nestedRules.join('\n') : nestedRules.join('\n');
    }

    // Add media query rules
    for (const [mediaQuery, mediaDeclarations] of Object.entries(mediaRules)) {
      if (mediaDeclarations.length > 0) {
        result += result ? '\n' : '';
        result += `${mediaQuery} {\n  ${selector} {\n${mediaDeclarations.join('\n')}\n  }\n}`;
      }
    }

    return result;
  }

  /**
   * Add responsive declarations to the appropriate buckets
   */
  private addResponsiveDeclarations(
    prop: string,
    value: any,
    breakpoint: string,
    _selector: string,
    declarations: string[],
    mediaRules: Record<string, string[]>
  ): void {
    const expandedProps = expandShorthand(prop);
    const propsToProcess = Array.isArray(expandedProps)
      ? expandedProps
      : [expandedProps];

    for (const cssPropName of propsToProcess) {
      const cssProp = cssPropName.replace(/([A-Z])/g, '-$1').toLowerCase();
      const cssValue = this.formatCSSValue(cssPropName, value);
      const declaration = `    ${cssProp}: ${cssValue};`;

      if (breakpoint === '_') {
        // Base styles
        declarations.push(`  ${cssProp}: ${cssValue};`);
      } else {
        // Media query styles
        const mediaQuery = generateMediaQuery(breakpoint);
        if (!mediaRules[mediaQuery]) {
          mediaRules[mediaQuery] = [];
        }
        mediaRules[mediaQuery].push(declaration);
      }
    }
  }

  /**
   * Abbreviate property names for shorter class names
   */
  private abbreviateProperty(prop: string): string {
    const abbreviations: Record<string, string> = {
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
      fontSize: 'fs',
      fontWeight: 'fw',
      color: 'c',
      backgroundColor: 'bg',
      display: 'd',
      position: 'pos',
      width: 'w',
      height: 'h',
    };

    return abbreviations[prop] || prop.slice(0, 3);
  }

  /**
   * Abbreviate values for shorter class names
   */
  // private _abbreviateValue(value: any): string {
  //   if (typeof value === 'number') {
  //     return value.toString();
  //   } else if (typeof value === 'string') {
  //     // Remove special characters and spaces
  //     return value
  //       .replace(/[^a-zA-Z0-9]/g, '')
  //       .slice(0, 8)
  //       .toLowerCase();
  //   }

  //   return `v${this.classCounter++}`;
  // }

  /**
   * Format a CSS value
   */
  private formatCSSValue(prop: string, value: any): string {
    if (typeof value === 'number') {
      // Add px to numeric values for certain properties
      const needsPx = [
        'width',
        'height',
        'padding',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'margin',
        'marginTop',
        'marginRight',
        'marginBottom',
        'marginLeft',
        'fontSize',
        'top',
        'right',
        'bottom',
        'left',
        'borderRadius',
        'gap',
        'columnGap',
        'rowGap',
      ];

      if (needsPx.some((p) => prop.toLowerCase().includes(p.toLowerCase()))) {
        return `${value}px`;
      }
    }

    return String(value);
  }

  /**
   * Generate responsive CSS rules for a property
   */
  // private generateResponsiveRules(
  //   prop: string,
  //   value: any[] | Record<string, any>
  // ): { classes: string[]; rules: string[] } {
  //   const classes: string[] = [];
  //   const rules: string[] = [];
  //   const breakpointOrder = getBreakpointOrder();

  //   // Expand shorthand for the property
  //   const expandedProps = expandShorthand(prop);
  //   const propsToProcess = Array.isArray(expandedProps)
  //     ? expandedProps
  //     : [expandedProps];

  //   if (isResponsiveArray(value)) {
  //     // Array syntax: [base, xs, sm, md, lg, xl]
  //     value.forEach((val, index) => {
  //       if (val === undefined || val === null) return;

  //       const breakpoint = breakpointOrder[index];
  //       const mediaQuery =
  //         breakpoint === '_' ? null : generateMediaQuery(breakpoint);

  //       for (const cssPropName of propsToProcess) {
  //         const classKey = `${cssPropName}:${JSON.stringify(val)}:${breakpoint}`;
  //         let className = this.classCache.get(classKey);

  //         if (!className) {
  //           className = this.generateClassName(cssPropName, val, breakpoint);
  //           this.classCache.set(classKey, className);

  //           const cssProp = cssPropName
  //             .replace(/([A-Z])/g, '-$1')
  //             .toLowerCase();
  //           const cssValue = this.formatCSSValue(cssPropName, val);

  //           if (mediaQuery) {
  //             rules.push(
  //               `${mediaQuery} { .${className} { ${cssProp}: ${cssValue}; } }`
  //             );
  //           } else {
  //             rules.push(`.${className} { ${cssProp}: ${cssValue}; }`);
  //           }
  //         }

  //         classes.push(className);
  //       }
  //     });
  //   } else {
  //     // Object syntax: { _: value, sm: value, md: value }
  //     for (const [breakpoint, val] of Object.entries(value)) {
  //       if (val === undefined || val === null) continue;

  //       const mediaQuery =
  //         breakpoint === '_' ? null : generateMediaQuery(breakpoint);

  //       for (const cssPropName of propsToProcess) {
  //         const classKey = `${cssPropName}:${JSON.stringify(val)}:${breakpoint}`;
  //         let className = this.classCache.get(classKey);

  //         if (!className) {
  //           className = this.generateClassName(cssPropName, val, breakpoint);
  //           this.classCache.set(classKey, className);

  //           const cssProp = cssPropName
  //             .replace(/([A-Z])/g, '-$1')
  //             .toLowerCase();
  //           const cssValue = this.formatCSSValue(cssPropName, val);

  //           if (mediaQuery) {
  //             rules.push(
  //               `${mediaQuery} { .${className} { ${cssProp}: ${cssValue}; } }`
  //             );
  //           } else {
  //             rules.push(`.${className} { ${cssProp}: ${cssValue}; }`);
  //           }
  //         }

  //         classes.push(className);
  //       }
  //     }
  //   }

  //   return { classes, rules };
  // }

  /**
   * Generate a unique class name for atomic CSS
   */
  // private generateClassName(
  //   prop: string,
  //   value: any,
  //   breakpoint?: string
  // ): string {
  //   // Create short prop abbreviations
  //   const propAbbrev = this.abbreviateProperty(prop);

  //   // Create short value representation
  //   const valueAbbrev = this.abbreviateValue(value);

  //   // Add breakpoint suffix if present
  //   const bpSuffix = breakpoint && breakpoint !== '_' ? `-${breakpoint}` : '';

  //   return `${this.options.prefix}-${propAbbrev}-${valueAbbrev}${bpSuffix}`;
  // }

  /**
   * Generate a simple hash from component name for consistent namespacing
   * In production, this could be a more sophisticated hash function
   */
  private generateComponentHash(componentName: string): string {
    // Simple hash: take first letter + length + last letter
    // This is just for demo - in production use a proper hash
    const first = componentName.charAt(0).toLowerCase();
    const last = componentName.charAt(componentName.length - 1).toLowerCase();
    const len = componentName.length;

    // For demo purposes, also include the component name for readability
    return `${componentName}-${first}${len}${last}`;
  }

  /**
   * Generate atomic utilities for groups and props
   * These are single-purpose utility classes that apply after component styles
   */
  private generateAtomicsFromGroupsAndProps(
    extracted: ExtractedStyles,
    groupDefinitions?: Record<string, Record<string, any>>,
    theme?: any,
    usageMap?: UsageMap
  ): GeneratedCSS & { cssVariables?: string; usedTokens?: Set<string> } {
    const cssRules: string[] = [];
    const processedKeys = new Set<string>();
    const atomicResolver = theme
      ? new StaticThemeResolver(theme, this.options.themeResolution)
      : undefined;

    // Get usage for this component if available
    const componentName = extracted.componentName;
    const componentUsage =
      componentName && usageMap ? usageMap[componentName] : undefined;

    // Process enabled groups
    if (extracted.groups && groupDefinitions) {
      cssRules.push('/* Atomic Utilities from Groups */');

      for (const groupName of extracted.groups) {
        const groupDef = groupDefinitions[groupName];
        if (!groupDef) continue;

        cssRules.push(`/* Group: ${groupName} */`);

        // Generate utilities for common values in each prop
        for (const [propName, propDef] of Object.entries(groupDef)) {
          // Get used values for this prop
          const usedValues = componentUsage?.[propName];

          const utilities = this.generatePropUtilities(
            propName,
            propDef,
            theme,
            processedKeys,
            usedValues,
            atomicResolver
          );
          if (utilities.length > 0) {
            cssRules.push(...utilities);
          }
        }
      }
    }

    // Process custom props
    if (extracted.props) {
      cssRules.push('\n/* Atomic Utilities from Custom Props */');

      for (const [propName, propDef] of Object.entries(extracted.props)) {
        // Get used values for this prop
        const usedValues = componentUsage?.[propName];

        const utilities = this.generatePropUtilities(
          propName,
          propDef,
          theme,
          processedKeys,
          usedValues,
          atomicResolver
        );
        if (utilities.length > 0) {
          cssRules.push(...utilities);
        }
      }
    }

    return {
      className: '',
      css: cssRules.join('\n'),
      cssVariables: atomicResolver?.generateCssVariableDeclarations(),
      usedTokens: atomicResolver?.getUsedTokens(),
    };
  }

  /**
   * Generate utilities for a single prop definition
   */
  private generatePropUtilities(
    propName: string,
    propDef: any,
    theme?: any,
    processedKeys?: Set<string>,
    usedValues?: Set<string>,
    resolver?: StaticThemeResolver
  ): string[] {
    const utilities: string[] = [];

    // Get scale values from theme or use defaults
    const scaleValues = this.getScaleValues(propDef.scale, theme);

    // Only generate utilities if we have usage data
    if (!usedValues || usedValues.size === 0) {
      return [];
    }

    // Parse used values to extract value and breakpoint pairs
    const valueBreakpointPairs: Array<{ value: any; breakpoint: string }> = [];

    for (const usageString of usedValues) {
      const [value, breakpoint = '_'] = usageString.split(':');
      valueBreakpointPairs.push({ value, breakpoint });
    }

    // Generate utility classes for each value-breakpoint pair
    for (const { value, breakpoint } of valueBreakpointPairs) {
      // Resolve theme value using the theme resolver
      let resolvedValue = value;
      if (theme && propDef.scale && resolver) {
        const result = resolver.resolve(value, propDef.scale);
        resolvedValue = result.value;
      } else if (scaleValues[value] !== undefined) {
        // Fallback to direct scale lookup
        resolvedValue = scaleValues[value];
      }

      // Generate utility for this specific breakpoint
      const key =
        breakpoint === '_'
          ? `${propName}:${value}`
          : `${propName}:${value}:${breakpoint}`;
      if (!processedKeys?.has(key)) {
        processedKeys?.add(key);

        if (breakpoint === '_') {
          // Base breakpoint
          const className = this.generateUtilityClassName(
            propName,
            String(value)
          );
          const css = this.generateUtilityRule(
            className,
            propName,
            resolvedValue,
            propDef
          );
          if (css) {
            utilities.push(css);
          }
        } else {
          // Responsive breakpoint
          const responsiveClass = this.generateUtilityClassName(
            propName,
            String(value),
            breakpoint
          );
          const mediaQuery = generateMediaQuery(breakpoint);
          if (mediaQuery) {
            const rule = this.generateUtilityRule(
              responsiveClass,
              propName,
              resolvedValue,
              propDef,
              true
            );
            if (rule) {
              utilities.push(`${mediaQuery} {\n${rule}\n}`);
            }
          }
        }
      }
    }

    return utilities;
  }

  /**
   * Generate a single utility rule
   */
  private generateUtilityRule(
    className: string,
    _propName: string,
    value: any,
    propDef: any,
    nested = false
  ): string {
    const indent = nested ? '  ' : '';
    const properties = propDef.properties || [propDef.property];
    const declarations: string[] = [];

    for (const property of properties) {
      if (!property || property === 'none') continue;

      const expandedProps = expandShorthand(property);
      const propsToProcess = Array.isArray(expandedProps)
        ? expandedProps
        : [expandedProps];

      for (const cssPropName of propsToProcess) {
        const cssProp = cssPropName.replace(/([A-Z])/g, '-$1').toLowerCase();
        const cssValue = propDef.transform
          ? propDef.transform(value)
          : this.formatCSSValue(cssPropName, value);

        declarations.push(`${indent}  ${cssProp}: ${cssValue};`);
      }
    }

    if (declarations.length === 0) return '';

    return `${indent}.${className} {\n${declarations.join('\n')}\n${indent}}`;
  }

  /**
   * Generate utility class name
   */
  private generateUtilityClassName(
    propName: string,
    value: string,
    breakpoint?: string
  ): string {
    const propAbbrev = this.abbreviateProperty(propName);
    const valueAbbrev = value.replace(/[^a-zA-Z0-9]/g, '');
    const bpSuffix = breakpoint ? `-${breakpoint}` : '';

    return `${this.options.prefix}-${propAbbrev}-${valueAbbrev}${bpSuffix}`;
  }

  /**
   * Get scale values from theme or defaults
   */
  private getScaleValues(scale?: string, theme?: any): Record<string, any> {
    if (!scale) return {};

    // Check theme first
    if (theme && theme[scale]) {
      return theme[scale];
    }

    // Use compatTheme scales as defaults
    const themeScale = (compatTheme as any)[scale];
    if (themeScale) {
      // Handle array scales (like space and fontSizes)
      if (Array.isArray(themeScale)) {
        const scaleObj: Record<string, any> = {};
        themeScale.forEach((value, index) => {
          scaleObj[index] = value;
        });
        return scaleObj;
      }
      return themeScale;
    }

    // Fallback to some common defaults
    const defaultScales: Record<string, Record<string, any>> = {
      colors: {
        primary: 'var(--colors-primary)',
        secondary: 'var(--colors-secondary)',
        white: '#ffffff',
        black: '#000000',
      },
      gradients: {
        primary: 'linear-gradient(to right, #667eea, #764ba2)',
      },
    };

    return defaultScales[scale] || {};
  }

  /**
   * Generate layered CSS from all components with proper cascade ordering
   * This is the new approach that respects component extension hierarchy
   */
  generateLayeredCSS(
    registry: ComponentRegistry,
    groupDefinitions?: Record<string, Record<string, any>>,
    theme?: any,
    globalUsageMap?: Record<string, UsageMap>
  ): LayeredCSS {
    // Get components sorted by extension hierarchy (parents before children)
    const sortedComponents = registry.getComponentsSortedByExtension();

    // CSS layer accumulators organized by breakpoint
    const cssVariables = new Map<string, string>();
    const allUsedTokens = new Set<string>();
    const breakpointOrder = getBreakpointOrder();

    // Breakpoint-organized styles: breakpoint -> array of CSS blocks
    const baseStylesByBreakpoint: Record<string, string[]> = {};
    const variantStylesByBreakpoint: Record<string, string[]> = {};
    const stateStylesByBreakpoint: Record<string, string[]> = {};
    const atomicStylesByBreakpoint: Record<string, string[]> = {};

    // Initialize breakpoint buckets
    for (const bp of breakpointOrder) {
      baseStylesByBreakpoint[bp] = [];
      variantStylesByBreakpoint[bp] = [];
      stateStylesByBreakpoint[bp] = [];
      atomicStylesByBreakpoint[bp] = [];
    }

    // Convert cssPropertyScales to the expected format
    const propConfig = Object.entries(cssPropertyScales).reduce(
      (acc, [prop, scale]) => {
        acc[prop] = { scale };
        return acc;
      },
      {} as Record<string, { scale?: string }>
    );

    // Process each component in sorted order
    for (const componentEntry of sortedComponents) {
      const component = componentEntry.styles;
      const componentName = component.componentName || 'component';
      const componentHash = this.generateComponentHash(componentName);
      const mainClassName = `${this.options.prefix}-${componentHash}`;

      // Track CSS variables from this component
      const componentUsage = globalUsageMap?.[component.componentName || ''];

      // 1. BASE STYLES LAYER - Generate base styles for this component
      if (component.baseStyles) {
        const resolved = theme
          ? resolveThemeInStyles(
              component.baseStyles,
              theme,
              propConfig,
              this.options.themeResolution
            )
          : {
              resolved: component.baseStyles,
              cssVariables: '',
              usedTokens: new Set<string>(),
            };

        const baseRulesByBreakpoint = this.generateRulesByBreakpoint(
          `.${mainClassName}`,
          resolved.resolved
        );

        // Distribute base rules to their respective breakpoint buckets
        for (const [breakpoint, rule] of Object.entries(
          baseRulesByBreakpoint
        )) {
          if (rule && baseStylesByBreakpoint[breakpoint]) {
            baseStylesByBreakpoint[breakpoint].push(
              `/* ${componentName} Base */\n${rule}`
            );
          }
        }

        // Collect CSS variables
        if (resolved.cssVariables) {
          const matches = resolved.cssVariables.matchAll(
            /\s*(--[^:]+):\s*([^;]+);/g
          );
          for (const match of matches) {
            cssVariables.set(match[1], match[2]);
          }
        }
        resolved.usedTokens.forEach((token) => allUsedTokens.add(token));
      }

      // 2. VARIANT STYLES LAYER - Generate variant styles for this component
      if (component.variants) {
        const variantsList = Array.isArray(component.variants)
          ? component.variants
          : [component.variants];

        variantsList.forEach((variantConfig) => {
          if (variantConfig && variantConfig.variants) {
            const variantProp = variantConfig.prop || 'variant';
            const variants = variantConfig.variants;

            for (const [variantName, variantStls] of Object.entries(variants)) {
              if (variantStls && typeof variantStls === 'object') {
                const resolved = theme
                  ? resolveThemeInStyles(
                      variantStls as Record<string, any>,
                      theme,
                      propConfig,
                      this.options.themeResolution
                    )
                  : {
                      resolved: variantStls,
                      cssVariables: '',
                      usedTokens: new Set<string>(),
                    };

                const variantClassName = `${mainClassName}-${variantProp}-${variantName}`;
                const variantRulesByBreakpoint = this.generateRulesByBreakpoint(
                  `.${variantClassName}`,
                  resolved.resolved
                );

                // Distribute variant rules to their respective breakpoint buckets
                for (const [breakpoint, rule] of Object.entries(
                  variantRulesByBreakpoint
                )) {
                  if (rule && variantStylesByBreakpoint[breakpoint]) {
                    variantStylesByBreakpoint[breakpoint].push(
                      `/* ${componentName} ${variantProp}="${variantName}" */\n${rule}`
                    );
                  }
                }

                resolved.usedTokens.forEach((token) =>
                  allUsedTokens.add(token)
                );
              }
            }
          }
        });
      }

      // 3. STATE STYLES LAYER - Generate state styles for this component
      if (component.states) {
        for (const [stateName, stateStls] of Object.entries(component.states)) {
          if (stateStls && typeof stateStls === 'object') {
            const resolved = theme
              ? resolveThemeInStyles(
                  stateStls as Record<string, any>,
                  theme,
                  propConfig,
                  this.options.themeResolution
                )
              : {
                  resolved: stateStls,
                  cssVariables: '',
                  usedTokens: new Set<string>(),
                };

            const stateClassName = `${mainClassName}-state-${stateName}`;
            const stateRulesByBreakpoint = this.generateRulesByBreakpoint(
              `.${stateClassName}`,
              resolved.resolved
            );

            // Distribute state rules to their respective breakpoint buckets
            for (const [breakpoint, rule] of Object.entries(
              stateRulesByBreakpoint
            )) {
              if (rule && stateStylesByBreakpoint[breakpoint]) {
                stateStylesByBreakpoint[breakpoint].push(
                  `/* ${componentName} state: ${stateName} */\n${rule}`
                );
              }
            }

            resolved.usedTokens.forEach((token) => allUsedTokens.add(token));
          }
        }
      }

      // 4. ATOMIC UTILITIES LAYER - Generate atomic utilities for this component
      if ((component.groups || component.props) && this.options.atomic) {
        const atomicCSS = this.generateAtomicsFromGroupsAndProps(
          component,
          groupDefinitions,
          theme,
          componentUsage
        );

        if (atomicCSS.css) {
          // For now, atomic utilities go to base breakpoint
          // TODO: Extract breakpoint-specific atomic utilities
          atomicStylesByBreakpoint['_'].push(
            `/* ${componentName} Utilities */\n${atomicCSS.css}`
          );
        }

        // Collect atomic CSS variables
        if (atomicCSS.cssVariables) {
          const matches = atomicCSS.cssVariables.matchAll(
            /\s*(--[^:]+):\s*([^;]+);/g
          );
          for (const match of matches) {
            cssVariables.set(match[1], match[2]);
          }
        }
        atomicCSS.usedTokens?.forEach((token) => allUsedTokens.add(token));
      }
    }

    // Assemble final CSS layers with breakpoint organization
    const cssVariablesSection =
      cssVariables.size > 0
        ? `:root {\n${Array.from(cssVariables.entries())
            .map(([varName, value]) => `  ${varName}: ${value};`)
            .join('\n')}\n}`
        : '';

    // Assemble sections by cascade layer, then by breakpoint
    const sections: string[] = [];

    // 1. CSS Variables (no breakpoints)
    if (cssVariablesSection) {
      sections.push(cssVariablesSection);
    }

    // 2. Base Styles by breakpoint
    for (const breakpoint of breakpointOrder) {
      const breakpointStyles = baseStylesByBreakpoint[breakpoint];
      if (breakpointStyles.length > 0) {
        const content = breakpointStyles.join('\n\n');
        if (breakpoint === '_') {
          sections.push(`/* Base Styles */\n${content}`);
        } else {
          const mediaQuery = generateMediaQuery(breakpoint);
          sections.push(
            `/* Base Styles - ${breakpoint.toUpperCase()} */\n${mediaQuery} {\n${content}\n}`
          );
        }
      }
    }

    // 3. Variant Styles by breakpoint
    for (const breakpoint of breakpointOrder) {
      const breakpointStyles = variantStylesByBreakpoint[breakpoint];
      if (breakpointStyles.length > 0) {
        const content = breakpointStyles.join('\n\n');
        if (breakpoint === '_') {
          sections.push(`/* Variant Styles */\n${content}`);
        } else {
          const mediaQuery = generateMediaQuery(breakpoint);
          sections.push(
            `/* Variant Styles - ${breakpoint.toUpperCase()} */\n${mediaQuery} {\n${content}\n}`
          );
        }
      }
    }

    // 4. State Styles by breakpoint
    for (const breakpoint of breakpointOrder) {
      const breakpointStyles = stateStylesByBreakpoint[breakpoint];
      if (breakpointStyles.length > 0) {
        const content = breakpointStyles.join('\n\n');
        if (breakpoint === '_') {
          sections.push(`/* State Styles */\n${content}`);
        } else {
          const mediaQuery = generateMediaQuery(breakpoint);
          sections.push(
            `/* State Styles - ${breakpoint.toUpperCase()} */\n${mediaQuery} {\n${content}\n}`
          );
        }
      }
    }

    // 5. Atomic Utilities by breakpoint
    for (const breakpoint of breakpointOrder) {
      const breakpointStyles = atomicStylesByBreakpoint[breakpoint];
      if (breakpointStyles.length > 0) {
        const content = breakpointStyles.join('\n\n');
        if (breakpoint === '_') {
          sections.push(`/* Atomic Utilities */\n${content}`);
        } else {
          const mediaQuery = generateMediaQuery(breakpoint);
          sections.push(
            `/* Atomic Utilities - ${breakpoint.toUpperCase()} */\n${mediaQuery} {\n${content}\n}`
          );
        }
      }
    }

    const fullCSS = sections.join('\n\n');

    // Legacy flat sections for backwards compatibility
    const baseSection = Object.values(baseStylesByBreakpoint)
      .flat()
      .join('\n\n');
    const variantSection = Object.values(variantStylesByBreakpoint)
      .flat()
      .join('\n\n');
    const stateSection = Object.values(stateStylesByBreakpoint)
      .flat()
      .join('\n\n');
    const atomicSection = Object.values(atomicStylesByBreakpoint)
      .flat()
      .join('\n\n');

    return {
      cssVariables: cssVariablesSection,
      baseStyles: baseSection,
      variantStyles: variantSection,
      stateStyles: stateSection,
      atomicUtilities: atomicSection,
      fullCSS,
      usedTokens: allUsedTokens,
      byBreakpoint: {
        base: Object.fromEntries(
          Object.entries(baseStylesByBreakpoint).map(([bp, styles]) => [
            bp,
            styles.join('\n\n'),
          ])
        ),
        variants: Object.fromEntries(
          Object.entries(variantStylesByBreakpoint).map(([bp, styles]) => [
            bp,
            styles.join('\n\n'),
          ])
        ),
        states: Object.fromEntries(
          Object.entries(stateStylesByBreakpoint).map(([bp, styles]) => [
            bp,
            styles.join('\n\n'),
          ])
        ),
        atomics: Object.fromEntries(
          Object.entries(atomicStylesByBreakpoint).map(([bp, styles]) => [
            bp,
            styles.join('\n\n'),
          ])
        ),
      },
    };
  }
}
