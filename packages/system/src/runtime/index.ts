import type { ForwardedRef } from 'react';
import { createElement, forwardRef, useRef } from 'react';

import {
  type ClassResolverConfig,
  type DynamicPropConfig,
  resolveClasses,
  type SystemPropMap,
} from './resolveClasses';

interface ComponentConfig extends ClassResolverConfig {}

// Accept either an HTML tag string or a React component reference.
// React.createElement handles both transparently.
type ElementType = string | React.ComponentType<any>;

type AnimusComponent = ReturnType<typeof forwardRef> & {
  extend: () => never;
};

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
 *
 * The optional dynamicPropConfig parameter provides CSS variable fallback
 * metadata for props with detected dynamic usage.
 */
export function createComponent(
  element: ElementType,
  className: string,
  config: ComponentConfig,
  systemPropMap?: SystemPropMap,
  dynamicPropConfig?: DynamicPropConfig
): AnimusComponent {
  const variantProps = config.variants ? Object.keys(config.variants) : [];
  const stateProps = config.states || [];
  const systemPropNames = config.systemPropNames || [];
  const filterProps = new Set([
    'as',
    ...variantProps,
    ...stateProps,
    ...systemPropNames,
  ]);

  const Component = forwardRef(
    (props: Record<string, any>, ref: ForwardedRef<any>) => {
      const renderElement = props.as || element;
      const isComponentElement = typeof renderElement !== 'string';

      // useRef-based memoization for dynamic style object
      const prevDynKey = useRef('');
      const prevDynStyle = useRef<Record<string, string> | null>(null);

      // Shared className resolution
      const { classes, dynamicStyle } = resolveClasses(
        className,
        props,
        config,
        systemPropMap,
        dynamicPropConfig
      );

      // Merge external className
      if (props.className) {
        classes.push(props.className);
      }

      // Forward props to the underlying element, filtering out all Animus-managed
      // props. For component elements, forward all non-filtered props.
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

      // Apply memoized dynamic style if any CSS variables were set
      if (dynamicStyle) {
        const dynKey = Object.entries(dynamicStyle)
          .map(([k, v]) => `${k}:${v}`)
          .join('|');
        if (dynKey !== prevDynKey.current) {
          prevDynKey.current = dynKey;
          prevDynStyle.current = dynamicStyle;
        }
        domProps.style = props.style
          ? { ...props.style, ...prevDynStyle.current }
          : prevDynStyle.current;
      }

      return createElement(renderElement as any, domProps);
    }
  );

  Component.displayName = className;

  // Expose variant keys so compose() can filter shared context
  // propagation — only spreading values the slot actually understands.
  (Component as any).__variantKeys = new Set(variantProps);

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
