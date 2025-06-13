/**
 * Static Mode Implementation for POC
 *
 * This module intercepts Animus's build() method to generate
 * static atomic CSS classes instead of runtime Emotion styles
 */

// import * as React from 'react';

import { AnimusWithAll } from '../Animus';
import { AnimusExtended } from '../AnimusExtended';
import { CSSObject } from '../types/shared';
import {
  AtomicClass,
  clearAtomicClasses,
  getGeneratedCSS,
  stylesToAtomicClasses,
} from './atomic-css';

// Global flag to enable/disable static mode
let staticModeEnabled = false;

// Store mapping of component to its static configuration
const staticComponentMap = new WeakMap<any, StaticConfig>();

interface StaticConfig {
  baseClasses: AtomicClass[];
  variantClasses: Record<string, Record<string, AtomicClass[]>>;
  element?: string;
  parent?: any; // Reference to parent for extension
}

// Static mode controller
export const AnimusStatic = {
  enable() {
    staticModeEnabled = true;
    // Monkey-patch the build method
    patchBuildMethod();
  },

  disable() {
    staticModeEnabled = false;
    // Restore original build method
    restoreOriginalBuild();
  },

  isEnabled() {
    return staticModeEnabled;
  },
};

// Store original build methods
let originalBuild: any;
let originalExtendedBuild: any;

function patchBuildMethod() {
  // Store original if not already stored
  if (!originalBuild) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalBuild = AnimusWithAll.prototype.build as any;
  }
  if (!originalExtendedBuild) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalExtendedBuild = AnimusExtended.prototype.build as any;
  }

  // Create a shared build patcher function
  const createStaticBuildFunction = function(this: any, originalBuildFn: any) {
    if (!staticModeEnabled) {
      return originalBuildFn.call(this);
    }

    // Extract base styles to atomic classes
    const baseClasses = this.baseStyles
      ? stylesToAtomicClasses(this.baseStyles as CSSObject)
      : [];

    // Extract variant styles
    const variantClasses: Record<string, Record<string, AtomicClass[]>> = {};
    if (this.variants) {
      for (const [variantProp, config] of Object.entries(this.variants)) {
        variantClasses[variantProp] = {};
        const variants = (config as any).variants || {};

        for (const [variantName, styles] of Object.entries(variants)) {
          variantClasses[variantProp][variantName] = stylesToAtomicClasses(
            styles as CSSObject
          );
        }
      }
    }

    // Store static config for this component
    const staticConfig: StaticConfig = {
      baseClasses,
      variantClasses,
    };

    // Store config on function for later retrieval
    const styleFunction = function staticStyleFunction(props: any) {
      // Generate class names for this component
      const classes: string[] = [];

      // Add base classes
      const baseClassNames = staticConfig.baseClasses.map(c => c.className);
      classes.push(...baseClassNames);

      // Handle variants based on props
      for (const [variantProp, variants] of Object.entries(staticConfig.variantClasses)) {
        const variantValue = props[variantProp];
        if (variantValue && variants[variantValue]) {
          // Get variant classes
          const variantClasses = variants[variantValue];
          const variantClassNames = variantClasses.map(c => c.className);

          // Find which properties are overridden by variant
          const overriddenProps = new Set(
            variantClasses.map(c => {
              // Extract property prefix from class name (e.g., '_p-1rem' -> '_p')
              const match = c.className.match(/^_([^-]+)/);
              return match ? match[1] : '';
            })
          );

          // Remove base classes that are overridden
          const filteredBaseClasses = classes.filter(className => {
            const match = className.match(/^_([^-]+)/);
            const prefix = match ? match[1] : '';
            return !overriddenProps.has(prefix);
          });

          // Replace classes array with filtered base + variant classes
          classes.length = 0;
          classes.push(...filteredBaseClasses, ...variantClassNames);
        }
      }

      // Return a style object that applies our classes via Emotion
      return {
        // Use Emotion's label for debugging
        label: 'animus-static',
        // Apply our atomic classes via className
        className: classes.join(' ')
      };
    };

    // Attach static config to the function
    (styleFunction as any).__staticConfig = staticConfig;

    // Preserve the extend method if it exists on the original
    const originalHandler = originalBuildFn.call(this);
    if (originalHandler?.extend) {
      (styleFunction as any).extend = originalHandler.extend;
    }

    return styleFunction;
  };

  // Apply patch to AnimusWithAll
  (AnimusWithAll.prototype as any).build = function (this: any) {
    return createStaticBuildFunction.call(this, originalBuild);
  };

  // Apply patch to AnimusExtended
  (AnimusExtended.prototype as any).build = function (this: any) {
    return createStaticBuildFunction.call(this, originalExtendedBuild);
  };

  // Also patch extend method to track parent relationship
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalExtend = AnimusWithAll.prototype.extend as any;
  (AnimusWithAll.prototype as any).extend = function (this: any) {
    const extended = originalExtend.call(this);

    // Track parent relationship for static extraction
    if (staticModeEnabled) {
      const parentConfig = staticComponentMap.get(this);
      if (parentConfig) {
        staticComponentMap.set(extended, { ...parentConfig, parent: this });
      }
    }

    return extended;
  };
}

function restoreOriginalBuild() {
  if (originalBuild) {
    AnimusWithAll.prototype.build = originalBuild;
  }
  if (originalExtendedBuild) {
    AnimusExtended.prototype.build = originalExtendedBuild;
  }
}

// Collect styles (for testing)
export const collectStyles = {
  clear() {
    clearAtomicClasses();
  },
};

// Get generated stylesheet
export function getStyleSheet(): string {
  return getGeneratedCSS();
}
