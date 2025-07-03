import { get } from './utils/get';

/**
 * Theme Resolver for Static Extraction
 *
 * Unlike runtime resolution, we have the power to:
 * 1. Resolve all theme paths at build time
 * 2. Generate CSS variables for dynamic values
 * 3. Inline static values directly
 * 4. Track which theme values are actually used
 */

export interface ThemeResolutionStrategy {
  mode: 'inline' | 'css-variable' | 'hybrid';
  variablePrefix?: string;
  generateFallbacks?: boolean;
}

export interface ResolvedValue {
  value: string;
  isThemeToken: boolean;
  cssVariable?: string;
  fallback?: string;
}

/**
 * Static theme resolver - transforms theme tokens to CSS values at build time
 */
export class StaticThemeResolver {
  private theme: Record<string, any>;
  private strategy: ThemeResolutionStrategy;
  private usedTokens = new Set<string>();
  private cssVariables = new Map<string, string>();

  constructor(
    theme: Record<string, any>,
    strategy: ThemeResolutionStrategy = { mode: 'hybrid' }
  ) {
    this.theme = theme;
    this.strategy = strategy;
  }

  /**
   * Resolve a value that might be a theme token
   */
  resolve(value: any, scale?: string): ResolvedValue {
    // Convert to string for processing
    const stringValue = String(value);
    
    // Try to resolve as theme path
    const resolved = this.resolveThemePath(stringValue, scale);
    if (resolved) {
      return resolved;
    }

    // Not a theme token
    return {
      value: stringValue,
      isThemeToken: false,
    };
  }

  /**
   * Resolve a theme path like 'colors.primary' or use scale + value
   */
  private resolveThemePath(
    value: string,
    scale?: string
  ): ResolvedValue | null {
    let themeValue: any;
    let tokenPath: string;

    if (scale && !value.startsWith(scale + '.')) {
      // Use provided scale as prefix if not already present
      // e.g., scale='colors', value='primary' → 'colors.primary'
      // e.g., scale='colors', value='text.primary' → 'colors.text.primary'
      tokenPath = `${scale}.${value}`;
      themeValue = get(this.theme, tokenPath);
    } else if (value.includes('.')) {
      // Direct path (e.g., 'colors.primary')
      tokenPath = value;
      themeValue = get(this.theme, tokenPath);
    } else if (scale) {
      // Single value with scale (e.g., scale='colors', value='primary')
      tokenPath = `${scale}.${value}`;
      themeValue = get(this.theme, tokenPath);
    } else {
      return null;
    }

    if (themeValue === undefined) {
      return null;
    }

    // Track that we used this token
    this.usedTokens.add(tokenPath);

    // Decide how to resolve based on strategy
    switch (this.strategy.mode) {
      case 'inline':
        return this.resolveInline(themeValue, tokenPath);

      case 'css-variable':
        return this.resolveToCssVariable(themeValue, tokenPath);

      case 'hybrid':
        return this.resolveHybrid(themeValue, tokenPath);

      default:
        return null;
    }
  }

  /**
   * Inline the actual value
   */
  private resolveInline(themeValue: any, _tokenPath: string): ResolvedValue {
    // If the theme value is already a CSS variable, preserve it
    if (typeof themeValue === 'string' && themeValue.startsWith('var(')) {
      return {
        value: themeValue,
        isThemeToken: true,
        cssVariable: themeValue,
      };
    }

    return {
      value: String(themeValue),
      isThemeToken: true,
    };
  }

  /**
   * Convert to CSS variable reference
   */
  private resolveToCssVariable(
    themeValue: any,
    tokenPath: string
  ): ResolvedValue {
    const variableName = this.generateCssVariableName(tokenPath);
    this.cssVariables.set(variableName, String(themeValue));

    return {
      value: `var(${variableName})`,
      isThemeToken: true,
      cssVariable: variableName,
      fallback: this.strategy.generateFallbacks
        ? String(themeValue)
        : undefined,
    };
  }

  /**
   * Hybrid approach - use CSS variables for colors, inline for others
   */
  private resolveHybrid(themeValue: any, tokenPath: string): ResolvedValue {
    // If the theme value is already a CSS variable, preserve it
    if (typeof themeValue === 'string' && themeValue.startsWith('var(')) {
      return {
        value: themeValue,
        isThemeToken: true,
        cssVariable: themeValue,
      };
    }

    // Use CSS variables for values that might change (colors, shadows)
    const useCssVariable =
      tokenPath.includes('color') ||
      tokenPath.includes('shadow') ||
      tokenPath.includes('gradient') ||
      (typeof themeValue === 'string' && themeValue.startsWith('#'));

    if (useCssVariable) {
      return this.resolveToCssVariable(themeValue, tokenPath);
    } else {
      return this.resolveInline(themeValue, tokenPath);
    }
  }

  /**
   * Generate CSS variable name from token path
   */
  private generateCssVariableName(tokenPath: string): string {
    const prefix = this.strategy.variablePrefix || '--animus';
    // Convert dots to dashes: colors.primary -> --animus-colors-primary
    const varName = tokenPath.replace(/\./g, '-');
    return `${prefix}-${varName}`;
  }

  /**
   * Get all CSS variables that need to be injected
   */
  getCssVariables(): Map<string, string> {
    return this.cssVariables;
  }

  /**
   * Get all used theme tokens for optimization
   */
  getUsedTokens(): Set<string> {
    return this.usedTokens;
  }

  /**
   * Generate CSS variable declarations
   */
  generateCssVariableDeclarations(): string {
    if (this.cssVariables.size === 0) return '';

    const declarations = Array.from(this.cssVariables.entries())
      .map(([varName, value]) => `  ${varName}: ${value};`)
      .join('\n');

    return `:root {\n${declarations}\n}`;
  }
}

/**
 * Resolve theme values in a styles object
 */
export function resolveThemeInStyles(
  styles: Record<string, any>,
  theme: Record<string, any>,
  propConfig?: Record<string, { scale?: string }>,
  strategy?: ThemeResolutionStrategy
): {
  resolved: Record<string, any>;
  cssVariables: string;
  usedTokens: Set<string>;
} {
  const resolver = new StaticThemeResolver(theme, strategy);
  const resolved: Record<string, any> = {};
  for (const [prop, value] of Object.entries(styles)) {
    // Check if this prop has a scale in the config
    const scale = propConfig?.[prop]?.scale;

    if (typeof value === 'object' && !Array.isArray(value)) {
      // Handle nested objects (responsive values, pseudo-selectors)
      resolved[prop] = resolveThemeInStyles(
        value,
        theme,
        propConfig,
        strategy
      ).resolved;
    } else if (Array.isArray(value)) {
      // Handle responsive arrays
      resolved[prop] = value.map((v) =>
        v != null ? resolver.resolve(v, scale).value : v
      );
    } else {
      // Handle single values
      const result = resolver.resolve(value, scale);

      resolved[prop] = result.value;
    }
  }

  return {
    resolved,
    cssVariables: resolver.generateCssVariableDeclarations(),
    usedTokens: resolver.getUsedTokens(),
  };
}
