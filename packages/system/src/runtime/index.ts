import type { ForwardedRef, ReactElement, Ref, RefCallback } from 'react';
import {
  Children,
  cloneElement,
  createElement,
  forwardRef,
  isValidElement,
} from 'react';

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
 * Forward props to the underlying element, filtering out Animus-managed props.
 *
 * data-* and aria-* attributes always pass through to the DOM, even when used
 * as variant/state keys. This enables headless UI interop: the attribute is
 * consumed for styling AND forwarded to the element so external frameworks
 * (Radix, Ark-UI) see it.
 *
 * filterProps covers all Animus props, so unknown props pass through: for DOM
 * elements React handles any unknown-attribute warnings in dev mode, and for
 * component elements all non-filtered props are forwarded to the component.
 */
function forwardProps(
  props: Record<string, any>,
  filterProps: Set<string>,
  domProps: Record<string, any>
): void {
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') continue;
    const isPassthrough = key.startsWith('data-') || key.startsWith('aria-');
    if (!isPassthrough && filterProps.has(key)) continue;
    domProps[key] = value;
  }
}

/**
 * asChild render path: don't render our own element — merge the resolved
 * className/ref/style onto the single child element.
 */
function renderAsChild(
  className: string,
  props: Record<string, any>,
  ref: ForwardedRef<any>,
  classes: string[],
  dynamicStyle: Record<string, string> | undefined
): ReactElement {
  const child = Children.only(props.children) as ReactElement<
    Record<string, any>
  >;
  if (!isValidElement(child)) {
    throw new Error(
      `${className}: asChild requires a single React element as children`
    );
  }

  const childRef = (
    child as ReactElement<Record<string, any>> & { ref?: Ref<unknown> }
  ).ref;
  const mergedClassName = [classes.join(' '), child.props.className]
    .filter(Boolean)
    .join(' ');

  // Style merge: parent's props.style loses to child's style,
  // dynamic CSS variables win last (different property names, no conflict).
  const mergedStyle =
    dynamicStyle || props.style || child.props.style
      ? {
          ...props.style,
          ...child.props.style,
          ...dynamicStyle,
        }
      : undefined;

  return cloneElement(child, {
    ref: composeRefs(ref, childRef),
    className: mergedClassName,
    ...(mergedStyle ? { style: mergedStyle } : {}),
  });
}

/**
 * Normal render path: render our own element (or the `as` override), forwarding
 * filtered props and applying any dynamic CSS-variable style.
 */
function renderElement(
  element: ElementType,
  filterProps: Set<string>,
  props: Record<string, any>,
  ref: ForwardedRef<any>,
  classes: string[],
  dynamicStyle: Record<string, string> | undefined
): ReactElement {
  const target = props.as || element;

  const domProps: Record<string, any> = {
    ref,
    className: classes.join(' '),
  };
  forwardProps(props, filterProps, domProps);

  // Apply dynamic style if any CSS variables were set
  if (dynamicStyle) {
    domProps.style = props.style
      ? { ...props.style, ...dynamicStyle }
      : dynamicStyle;
  }

  return createElement(target as any, domProps);
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

      // Dispatch: asChild merges onto the child; otherwise render own element.
      return props.asChild
        ? renderAsChild(className, props, ref, classes, dynamicStyle)
        : renderElement(
            element,
            filterProps,
            props,
            ref,
            classes,
            dynamicStyle
          );
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
