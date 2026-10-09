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

type ElementType = string | React.ComponentType<any>;

type Transform = NonNullable<DynamicPropConfig[string]['transform']>;

type AnimusComponent = ReturnType<typeof forwardRef> & {
  extend: () => never;
  variantDefaults: Readonly<Record<string, string>>;
  customTransforms: Readonly<Record<string, Transform>>;
};

/**
 * A new callback on every call: the runtime stays hook-free so components
 * work in server components, which rules memoization out.
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
 * `data-*` and `aria-*` reach the DOM even when they key a variant or state,
 * so headless libraries driving those attributes still see them.
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
 * React 19 carries a ref as a plain prop and warns on `element.ref`; React 18
 * keeps it on the element and guards `props.ref` with a warning getter.
 * Reading the descriptor never invokes either getter.
 */
function childRefOf(
  child: ReactElement<Record<string, any>> & { ref?: Ref<unknown> }
): Ref<unknown> | undefined {
  const propRef = Object.getOwnPropertyDescriptor(child.props, 'ref');
  if (propRef && !propRef.get) return propRef.value;
  return child.ref;
}

/**
 * The child wins every conflict: parent props spread under the child's own, so
 * a handler declared on the child replaces the parent's instead of chaining.
 */
function renderAsChild(
  className: string,
  filterProps: Set<string>,
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

  const childRef = childRefOf(child);
  const mergedClassName = [classes.join(' '), child.props.className]
    .filter(Boolean)
    .join(' ');

  const mergedStyle =
    dynamicStyle || props.style || child.props.style
      ? {
          ...props.style,
          ...child.props.style,
          ...dynamicStyle,
        }
      : undefined;

  const parentProps: Record<string, any> = {};
  forwardProps(props, filterProps, parentProps);
  delete parentProps.children;
  delete parentProps.style;
  delete parentProps.ref;

  return cloneElement(child, {
    ...parentProps,
    ...child.props,
    ref: composeRefs(ref, childRef),
    className: mergedClassName,
    ...(mergedStyle ? { style: mergedStyle } : {}),
  });
}

/**
 * A string terminal renders `as` in place of its tag. A component terminal
 * always renders its component, which receives `as` and `asChild` like any
 * other prop, so its own wiring runs whatever element it ends up rendering.
 */
function renderElement(
  element: ElementType,
  filterProps: Set<string>,
  props: Record<string, any>,
  ref: ForwardedRef<any>,
  classes: string[],
  dynamicStyle: Record<string, string> | undefined
): ReactElement {
  const target = typeof element === 'string' ? props.as || element : element;

  const domProps: Record<string, any> = {
    ref,
    className: classes.join(' '),
  };
  forwardProps(props, filterProps, domProps);

  if (dynamicStyle) {
    domProps.style = props.style
      ? { ...props.style, ...dynamicStyle }
      : dynamicStyle;
  }

  return createElement(target as any, domProps);
}

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
  const ownsPolymorphism = typeof element === 'string';
  const filterProps = new Set([
    ...(ownsPolymorphism ? ['as', 'asChild'] : []),
    ...variantProps,
    ...stateProps,
    ...systemPropNames,
  ]);

  const Component = forwardRef(
    (props: Record<string, any>, ref: ForwardedRef<any>) => {
      const { classes, dynamicStyle } = resolveClasses(
        className,
        props,
        config,
        systemPropMap,
        dynamicPropConfig
      );

      if (props.className) {
        classes.push(props.className);
      }

      return props.asChild && ownsPolymorphism
        ? renderAsChild(
            className,
            filterProps,
            props,
            ref,
            classes,
            dynamicStyle
          )
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

  const variantDefaults: Record<string, string> = {};
  if (config.variants) {
    for (const [prop, vc] of Object.entries(config.variants)) {
      if (vc.default != null) variantDefaults[prop] = vc.default;
    }
  }

  // An extension's extracted config reads the callables it inherits from
  // here, so they keep the scope of the module that declares them.
  const customTransforms: Record<string, Transform> = {};
  for (const [prop, dc] of Object.entries(config.customDynamicConfig ?? {})) {
    if (dc.transform) customTransforms[prop] = dc.transform;
  }

  return Object.assign(Component, {
    variantDefaults: Object.freeze(variantDefaults) as Readonly<
      Record<string, string>
    >,
    customTransforms: Object.freeze(customTransforms),
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
