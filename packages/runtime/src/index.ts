import type { ForwardedRef } from 'react';
import { createElement, forwardRef } from 'react';

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
 */
export function createComponent(
  element: ElementType,
  className: string,
  config: ComponentConfig
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
        // For HTML tags, skip keys that look like Animus system props but also
        // any non-standard HTML attribute. We rely on the filterProps set built
        // from the config — if a prop is known to the config it is filtered above.
        // Unknown props are forwarded for HTML tags the same as before, letting
        // React handle any unknown-attribute warnings in dev mode.
        // For component elements there is no extra filtering needed beyond filterProps.
        if (!isComponentElement) {
          // Only skip props that are definitely not valid HTML — currently we rely
          // on filterProps covering all Animus props, so unknown props pass through.
          // This matches the original behavior for string-tag elements.
        }
        domProps[key] = value;
      }

      return createElement(element as any, domProps);
    }
  );

  Component.displayName = className;

  // Extracted components cannot be extended at runtime because their
  // configuration contains resolved CSS values — not the original Prop/Parser
  // objects that AnimusExtended requires. Extensions must happen in source
  // code where the extraction pipeline can trace them at build time.
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
