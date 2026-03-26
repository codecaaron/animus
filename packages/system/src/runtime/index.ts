import type { ForwardedRef } from 'react';
import { createElement, forwardRef } from 'react';

interface VariantConfig {
  options: string[];
  default?: string;
}

interface ComponentConfig {
  variants?: Record<string, VariantConfig>;
  states?: string[];
  systemPropNames?: string[];
}

type SystemPropMap = Record<string, Record<string, string>>;

// Accept either an HTML tag string or a React component reference.
// React.createElement handles both transparently.
type ElementType = string | React.ComponentType<any>;

type AnimusComponent = ReturnType<typeof forwardRef> & {
  extend: () => never;
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
      .map((k) => `${k}:${(value as Record<string, unknown>)[k]}`)
      .join('|');
  }
  return String(value);
}

/**
 * Create a lightweight component that applies extracted CSS class names.
 * Replaces Emotion's styled() for extracted components.
 *
 * The element parameter accepts either an HTML tag string (e.g. 'button') or
 * a React component reference (e.g. NextLink). When a component reference is
 * used, prop forwarding skips the HTML-attribute validity check — all
 * non-filtered props are forwarded to the component.
 *
 * The optional systemPropMap parameter provides the shared prop→value→className
 * lookup table, served as a virtual module by the Vite plugin.
 */
export function createComponent(
  element: ElementType,
  className: string,
  config: ComponentConfig,
  systemPropMap?: SystemPropMap
): AnimusComponent {
  const variantProps = config.variants ? Object.keys(config.variants) : [];
  const stateProps = config.states || [];
  const systemPropNames = config.systemPropNames || [];
  const filterProps = new Set([
    ...variantProps,
    ...stateProps,
    ...systemPropNames,
  ]);

  // When element is not a string, it is a React component. Component elements
  // accept arbitrary props, so we skip the HTML attribute validity check and
  // forward everything that isn't an Animus-managed prop.
  const isComponentElement = typeof element !== 'string';

  const Component = forwardRef(
    (props: Record<string, any>, ref: ForwardedRef<any>) => {
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

      // Apply system prop utility classes from shared map
      if (systemPropMap && systemPropNames.length > 0) {
        for (const propName of systemPropNames) {
          if (propName in props) {
            const key = serializeValueKey(props[propName]);
            const cls = systemPropMap[propName]?.[key];
            if (cls) classes.push(cls);
          }
        }
      }

      // Merge external className
      if (props.className) {
        classes.push(props.className);
      }

      // Forward props to the underlying element, filtering out all Animus-managed
      // props. For HTML tag elements, also skip props that are not valid HTML
      // attributes to avoid React DOM warnings. For component elements, forward
      // all non-filtered props without an attribute validity check.
      const domProps: Record<string, any> = {
        ref,
        className: classes.join(' '),
      };
      for (const [key, value] of Object.entries(props)) {
        if (key === 'className') continue;
        if (filterProps.has(key)) continue;
        if (!isComponentElement) {
          // filterProps covers all Animus props — unknown props pass through,
          // letting React handle any unknown-attribute warnings in dev mode.
        }
        domProps[key] = value;
      }

      return createElement(element as any, domProps);
    }
  );

  Component.displayName = className;

  return Object.assign(Component, {
    extend: (): never => {
      throw new Error(
        `Cannot extend extracted component "${className}" at runtime. ` +
          `Extensions must be authored in source code using the builder API ` +
          `(e.g. import the original component and call .extend() there) ` +
          `so the extraction pipeline can resolve them at build time.`
      );
    },
  }) as any;
}
