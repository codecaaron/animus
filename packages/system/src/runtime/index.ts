import type { ForwardedRef, ReactElement, Ref, RefCallback } from 'react';
import { Children, cloneElement, createElement, forwardRef, isValidElement } from 'react';

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
 * Merge multiple refs (callback or object) into a single callback ref.
 * Creates a new callback on each call — no memoization possible in a
 * hook-free runtime (RSC compatibility). Matches @radix-ui/react-compose-refs.
 */
function composeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
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
    'asChild',
    ...variantProps,
    ...stateProps,
    ...systemPropNames,
  ]);

  // Closure-scoped memoization for dynamic style objects.
  // Per-component-type cache — avoids useRef so createComponent
  // stays hook-free and RSC-compatible.
  let prevDynKey = '';
  let prevDynStyle: Record<string, string> | null = null;

  const Component = forwardRef(
    (props: Record<string, any>, ref: ForwardedRef<any>) => {
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

      // Memoize dynamic style if any CSS variables were set
      if (dynamicStyle) {
        const dynKey = Object.entries(dynamicStyle)
          .map(([k, v]) => `${k}:${v}`)
          .join('|');
        if (dynKey !== prevDynKey) {
          prevDynKey = dynKey;
          prevDynStyle = dynamicStyle;
        }
      }

      // ── asChild branch ──────────────────────────────────────────
      // Don't render own element — merge className/ref/style onto child.
      if (props.asChild) {
        const child = Children.only(props.children) as ReactElement<
          Record<string, any>
        >;
        if (!isValidElement(child)) {
          throw new Error(
            `${className}: asChild requires a single React element as children`
          );
        }

        const childRef = (child as ReactElement<Record<string, any>> & { ref?: Ref<unknown> }).ref;
        const mergedClassName = [classes.join(' '), child.props.className]
          .filter(Boolean)
          .join(' ');

        // Style merge: parent's props.style loses to child's style,
        // dynamic CSS variables win last (different property names, no conflict).
        const mergedStyle =
          prevDynStyle || props.style || child.props.style
            ? {
                ...props.style,
                ...child.props.style,
                ...prevDynStyle,
              }
            : undefined;

        return cloneElement(child, {
          ref: composeRefs(ref, childRef),
          className: mergedClassName,
          ...(mergedStyle ? { style: mergedStyle } : {}),
        });
      }

      // ── Normal branch ───────────────────────────────────────────
      const renderElement = props.as || element;
      const isComponentElement = typeof renderElement !== 'string';

      // Forward props to the underlying element, filtering out all Animus-managed
      // props. For component elements, forward all non-filtered props.
      const domProps: Record<string, any> = {
        ref,
        className: classes.join(' '),
      };
      for (const [key, value] of Object.entries(props)) {
        if (key === 'className') continue;
        // data-* and aria-* attributes always pass through to the DOM, even
        // when used as variant/state keys. This enables headless UI interop:
        // the attribute is consumed for styling AND forwarded to the element
        // so external frameworks (Radix, Ark-UI) see it.
        const isPassthrough =
          key.startsWith('data-') || key.startsWith('aria-');
        if (!isPassthrough && filterProps.has(key)) continue;
        if (!isComponentElement) {
          // filterProps covers all Animus props — unknown props pass through,
          // letting React handle any unknown-attribute warnings in dev mode.
        }
        domProps[key] = value;
      }

      // Apply memoized dynamic style if any CSS variables were set
      if (prevDynStyle && dynamicStyle) {
        domProps.style = props.style
          ? { ...props.style, ...prevDynStyle }
          : prevDynStyle;
      }

      return createElement(renderElement as any, domProps);
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
