import { forwardRef, createElement } from 'react';
import type { ComponentPropsWithRef, ElementType, ForwardedRef } from 'react';

interface VariantConfig {
  options: string[];
  default?: string;
}

interface ComponentConfig {
  variants?: Record<string, VariantConfig>;
  states?: string[];
  systemProps?: Record<string, Record<string, string>>;
  systemPropNames?: string[];
}

type AnimusComponent<T extends ElementType> = ReturnType<typeof forwardRef> & {
  extend: () => any;
};

/**
 * Serialize a system prop value to a lookup key matching the Rust
 * css_generator's serialize_value_key output format:
 * - Numbers and strings → their string representation
 * - Responsive objects → sorted "key:value" pairs joined by "|"
 */
function serializeValueKey(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .map(k => `${k}:${(value as Record<string, unknown>)[k]}`)
      .join('|');
  }
  return String(value);
}

/**
 * Create a lightweight component that applies extracted CSS class names.
 * Replaces Emotion's styled() for extracted components.
 */
export function createComponent<T extends keyof JSX.IntrinsicElements>(
  tag: T,
  className: string,
  config: ComponentConfig
): AnimusComponent<T> {
  const variantProps = config.variants ? Object.keys(config.variants) : [];
  const stateProps = config.states || [];
  const systemPropNames = config.systemPropNames || [];
  const filterProps = new Set([...variantProps, ...stateProps, ...systemPropNames]);

  const Component = forwardRef((props: Record<string, any>, ref: ForwardedRef<any>) => {
    const classes = [className];

    // Apply variant classes
    if (config.variants) {
      for (const [prop, vc] of Object.entries(config.variants)) {
        const value = props[prop] ?? vc.default;
        if (value != null) {
          classes.push(`${className}--${prop}-${value}`);
        }
      }
    }

    // Apply state classes
    if (config.states) {
      for (const state of config.states) {
        if (props[state]) {
          classes.push(`${className}--${state}`);
        }
      }
    }

    // Apply system prop utility classes
    if (config.systemProps && systemPropNames.length > 0) {
      for (const propName of systemPropNames) {
        if (propName in props) {
          const key = serializeValueKey(props[propName]);
          const cls = config.systemProps[propName]?.[key];
          if (cls) classes.push(cls);
        }
      }
    }

    // Merge external className
    if (props.className) {
      classes.push(props.className);
    }

    // Filter out config props, forward everything else to the DOM element
    const domProps: Record<string, any> = { ref, className: classes.join(' ') };
    for (const [key, value] of Object.entries(props)) {
      if (key !== 'className' && !filterProps.has(key)) {
        domProps[key] = value;
      }
    }

    return createElement(tag, domProps);
  });

  Component.displayName = className;

  // Attach extend method for cross-component extension
  return Object.assign(Component, {
    extend: () => {
      // TODO: Return AnimusExtended instance initialized with extracted config
      // This bridges extracted components back to the Emotion chain for extension
      throw new Error(
        `${className}.extend() is not yet supported for extracted components (Arc 3)`
      );
    },
  }) as any;
}
