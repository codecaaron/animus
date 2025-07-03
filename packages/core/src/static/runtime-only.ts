/**
 * Runtime-only shim for Animus components
 * This file contains ONLY the runtime code needed for transformed components
 * No build-time dependencies should be imported here
 */

import isPropValid from '@emotion/is-prop-valid';
import { createElement, forwardRef } from 'react';

// Type for component runtime metadata
export interface ComponentRuntimeMetadata {
  baseClass: string;
  variants: Record<string, Record<string, string>>;
  states: Record<string, string>;
  systemProps: string[];
  groups: string[];
  customProps: string[];
}

// Global metadata storage
let componentMetadata: Record<string, ComponentRuntimeMetadata> = {};

// Initialize metadata from build artifacts
export function initializeAnimusShim(metadata: Record<string, ComponentRuntimeMetadata>) {
  componentMetadata = metadata;
}

// Create a shimmed component that applies static classes
export function createShimmedComponent<T extends keyof JSX.IntrinsicElements>(
  element: T,
  componentName: string
) {
  const metadata = componentMetadata[componentName];

  if (!metadata) {
    // No metadata found - return basic element
    return forwardRef<any, any>((props, ref) =>
      createElement(element, { ...props, ref })
    );
  }

  // Create the shimmed component
  const ShimmedComponent = forwardRef<any, any>((props, ref) => {
    const { className: userClassName, ...restProps } = props;

    // Collect classes based on props
    const classes: string[] = [];

    // Always add base class
    classes.push(metadata.baseClass);

    // Add variant classes
    for (const [variantProp, variantMap] of Object.entries(metadata.variants)) {
      const variantValue = props[variantProp];
      if (variantValue && variantMap[variantValue]) {
        classes.push(variantMap[variantValue]);
      }
    }

    // Add state classes
    for (const [stateName, stateClass] of Object.entries(metadata.states)) {
      if (props[stateName]) {
        classes.push(stateClass);
      }
    }

    // Add atomic utility classes for system props
    for (const prop of metadata.systemProps) {
      const value = props[prop];
      if (value !== undefined && value !== null) {
        // Generate atomic class name
        const atomicClass = generateAtomicClass(prop, value);
        if (atomicClass) {
          classes.push(atomicClass);
        }
      }
    }

    // Filter out system props and custom props from DOM
    const allSystemProps = [
      ...metadata.systemProps,
      ...metadata.customProps,
      ...Object.keys(metadata.variants),
      ...Object.keys(metadata.states)
    ];

    const domProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(restProps)) {
      if (isPropValid(key) && !allSystemProps.includes(key)) {
        domProps[key] = value;
      }
    }

    // Combine classes
    const finalClassName = [
      ...classes,
      userClassName
    ].filter(Boolean).join(' ');

    return createElement(element, {
      ...domProps,
      className: finalClassName,
      ref
    });
  });

  // Add display name for debugging
  ShimmedComponent.displayName = componentName;

  // Add extend method - throws error since all extension happens at build time
  (ShimmedComponent as any).extend = () => {
    throw new Error(
      `Component.extend() is not supported at runtime. ` +
      `All component extension must be resolved at build time. ` +
      `Please ensure your build process is configured correctly.`
    );
  };

  return ShimmedComponent;
}

// Shim for .asElement()
export function asElement<T extends keyof JSX.IntrinsicElements>(
  this: { componentName: string },
  element: T
) {
  return createShimmedComponent(element, this.componentName);
}

// Shim for .asComponent()
/**
 * Generate atomic CSS class name for a prop-value pair
 * This must match the logic in generator.ts
 */
function generateAtomicClass(prop: string, value: any): string | null {
  // Handle responsive values
  if (Array.isArray(value)) {
    // For responsive arrays, we'd need to handle each breakpoint
    // For now, just use the first value
    return generateAtomicClass(prop, value[0]);
  }

  if (typeof value === 'object' && value !== null) {
    // For responsive objects, use the base value
    if ('_' in value) {
      return generateAtomicClass(prop, value._);
    }
    return null;
  }

  // Generate class name matching generator.ts logic
  const prefix = 'animus';
  const propAbbrev = abbreviateProperty(prop);
  const valueAbbrev = String(value).replace(/[^a-zA-Z0-9]/g, '');

  return `${prefix}-${propAbbrev}-${valueAbbrev}`;
}

/**
 * Abbreviate property names to match generator.ts
 */
function abbreviateProperty(prop: string): string {
  // Match abbreviations from generator.ts
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

export function asComponent<T extends (props: { className?: string }) => any>(
  this: { componentName: string },
  Component: T
) {
  const metadata = componentMetadata[this.componentName];

  if (!metadata) {
    // No metadata available - return original component
    return Component;
  }

  // Create wrapper component
  const ShimmedComponent = forwardRef<any, any>((props, ref) => {
    const { className: userClassName, ...restProps } = props;

    // Collect classes based on props (same logic as asElement)
    const classes: string[] = [];
    classes.push(metadata.baseClass);

    for (const [variantProp, variantMap] of Object.entries(metadata.variants)) {
      const variantValue = props[variantProp];
      if (variantValue && variantMap[variantValue]) {
        classes.push(variantMap[variantValue]);
      }
    }

    for (const [stateName, stateClass] of Object.entries(metadata.states)) {
      if (props[stateName]) {
        classes.push(stateClass);
      }
    }

    // Add atomic utility classes for system props
    for (const prop of metadata.systemProps) {
      const value = props[prop];
      if (value !== undefined && value !== null) {
        const atomicClass = generateAtomicClass(prop, value);
        if (atomicClass) {
          classes.push(atomicClass);
        }
      }
    }

    // Filter props
    const allSystemProps = [
      ...metadata.systemProps,
      ...metadata.customProps,
      ...Object.keys(metadata.variants),
      ...Object.keys(metadata.states)
    ];

    const componentProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(restProps)) {
      if (!allSystemProps.includes(key)) {
        componentProps[key] = value;
      }
    }

    const finalClassName = [
      ...classes,
      userClassName
    ].filter(Boolean).join(' ');

    return createElement(Component, {
      ...componentProps,
      className: finalClassName,
      ...(ref ? { ref } : {})
    });
  });

  ShimmedComponent.displayName = this.componentName;
  (ShimmedComponent as any).extend = () => {
    throw new Error(
      `Component.extend() is not supported at runtime. ` +
      `All component extension must be resolved at build time. ` +
      `Please ensure your build process is configured correctly.`
    );
  };

  return ShimmedComponent;
}
