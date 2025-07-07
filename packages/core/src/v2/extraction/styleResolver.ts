/**
 * Style value resolution for Animus props
 *
 * This module provides functionality to resolve style prop values, including:
 * - Theme token resolution (e.g., "colors.primary" -> "#007bff")
 * - Scale value resolution (e.g., space.4 -> "1rem")
 * - Transform application (e.g., size transforms)
 */

import type { Logger } from '../infrastructure/logger';
import type { PropRegistry } from '../registry/propRegistryExtractor';
import type { Confidence, PropConfig } from '../types';

// ============================================================================
// Style Value Resolution Interfaces
// ============================================================================

export interface StyleValueResolver {
  resolve(
    value: unknown,
    propConfig: PropConfig,
    context: ResolutionContext
  ): ResolvedValue;
}

export interface ResolutionContext {
  readonly theme?: Record<string, unknown>;
  readonly propRegistry: PropRegistry | null;
  readonly componentId: string;
  readonly logger: Logger;
}

export interface ResolvedValue {
  readonly value: string | number;
  readonly isThemeValue: boolean;
  readonly isTransformed: boolean;
  readonly originalValue: unknown;
  readonly confidence: Confidence;
}

// ============================================================================
// Style Value Resolution Implementation
// ============================================================================

/**
 * Resolves style values from various forms to their final CSS values
 *
 * The resolver handles:
 * 1. Theme tokens - Resolving dot-notation paths into theme values
 * 2. Scale lookups - Using prop scales to map values to theme scales
 * 3. Transforms - Applying value transformations (when implemented)
 */
export class StyleValueResolverImpl implements StyleValueResolver {
  resolve(
    value: unknown,
    propConfig: PropConfig,
    context: ResolutionContext
  ): ResolvedValue {
    // Start with the original value
    let resolvedValue: string | number = String(value);
    let isThemeValue = false;
    let isTransformed = false;
    let confidence = 1.0; // STATIC

    // Step 1: Check if value is a theme token (e.g., "colors.primary", "space.4")
    if (typeof value === 'string' && value.includes('.')) {
      const themeValue = this.resolveThemeToken(value, propConfig, context);
      if (themeValue !== null) {
        resolvedValue = themeValue;
        isThemeValue = true;
        context.logger.debug('Resolved theme token', {
          token: value,
          resolved: resolvedValue,
          scale: propConfig.scale,
        });
      }
    }

    // Step 2: Apply scale if defined and not already a theme value
    if (!isThemeValue && propConfig.scale && context.theme) {
      const scaleValue = this.resolveScale(
        resolvedValue,
        propConfig.scale,
        context
      );
      if (scaleValue !== null) {
        resolvedValue = scaleValue;
        isThemeValue = true;
        context.logger.debug('Resolved scale value', {
          scale: propConfig.scale,
          key: value,
          resolved: resolvedValue,
        });
      }
    }

    // Step 3: Apply transform if defined
    if (propConfig.transform) {
      const transformedValue = this.applyTransform(
        resolvedValue,
        propConfig.transform,
        context
      );
      if (transformedValue !== null) {
        resolvedValue = transformedValue;
        isTransformed = true;
        context.logger.debug('Applied transform', {
          transform: propConfig.transform,
          input: value,
          output: resolvedValue,
        });
      }
    }

    // Step 4: Validate the resolved value
    if (
      typeof resolvedValue !== 'string' &&
      typeof resolvedValue !== 'number'
    ) {
      context.logger.warn('Failed to resolve value to string or number', {
        value,
        propConfig,
        resolved: resolvedValue,
      });
      confidence = 0.0; // DYNAMIC
    }

    return {
      value: resolvedValue,
      isThemeValue,
      isTransformed,
      originalValue: value,
      confidence,
    };
  }

  /**
   * Resolve a dot-notation theme token to its value
   *
   * Examples:
   * - "colors.primary" -> "#007bff"
   * - "space.4" -> "1rem"
   * - "breakpoints.md" -> "768px"
   */
  private resolveThemeToken(
    token: string,
    propConfig: PropConfig,
    context: ResolutionContext
  ): string | null {
    if (!context.theme) return null;

    // Handle dot notation (e.g., "colors.primary.500")
    const parts = token.split('.');
    let current: any = context.theme;

    // If there's a scale, try using it as the first part
    if (propConfig.scale && !context.theme[parts[0]]) {
      current = current[propConfig.scale];
      if (!current) return null;
    }

    // Traverse the theme object
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else if (propConfig.scale && parts[0] !== propConfig.scale) {
        // Try with scale prefix if not already tried
        const scaleValue = this.resolveThemeToken(
          `${propConfig.scale}.${token}`,
          propConfig,
          context
        );
        if (scaleValue !== null) return scaleValue;
        return null;
      } else {
        return null;
      }
    }

    return typeof current === 'string' || typeof current === 'number'
      ? String(current)
      : null;
  }

  /**
   * Resolve a value using a theme scale
   *
   * This looks up the value in the specified theme scale.
   * For example, with scale="space" and value="4", it would
   * look up theme.space[4] or theme.space["4"]
   */
  private resolveScale(
    value: string | number,
    scale: string,
    context: ResolutionContext
  ): string | null {
    if (!context.theme || !scale) return null;

    const scaleObject = context.theme[scale];
    if (!scaleObject || typeof scaleObject !== 'object') return null;

    // Try direct lookup
    const scaleValue = (scaleObject as any)[value];
    if (scaleValue !== undefined) {
      return String(scaleValue);
    }

    // For numeric values, try as string key
    if (typeof value === 'number') {
      const stringKey = String(value);
      const stringValue = (scaleObject as any)[stringKey];
      if (stringValue !== undefined) {
        return String(stringValue);
      }
    }

    return null;
  }

  /**
   * Apply a transform function to a value
   *
   * Transform functions modify values before they become CSS.
   * Common transforms include:
   * - size: Adding units (px, rem, %)
   * - borderShorthand: Expanding shorthand values
   * - Custom transforms defined by the user
   */
  private applyTransform(
    value: string | number,
    transform: string,
    context: ResolutionContext
  ): string | null {
    // TODO: Implement transform functions
    // For now, we'll just return null to indicate no transformation
    // In the future, this will handle transforms like:
    // - size: px, rem, %, viewport units
    // - borderShorthand: expanding border values
    // - gridItem: grid template values
    // - Custom transforms

    context.logger.debug('Transform not yet implemented', { transform, value });
    return null;
  }
}
