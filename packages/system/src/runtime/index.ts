import type {
  ForwardedRef,
  ReactElement,
  ReactNode,
  Ref,
  RefCallback,
} from 'react';
import { Children, cloneElement, createElement, forwardRef } from 'react';

import {
  type ClassResolverConfig,
  type DynamicPropConfig,
  resolveClasses,
  type SystemPropMap,
  withUniqueSystemPropNames,
} from './resolveClasses';
import { reportUncompiledRender } from './uncompiled';

interface ComponentConfig extends ClassResolverConfig {}

type ElementType = string | React.ComponentType<any>;

type Transform = NonNullable<DynamicPropConfig[string]['transform']>;

type AnimusComponent = ReturnType<typeof forwardRef> & {
  extend: () => never;
  variantDefaults: Readonly<Record<string, string>>;
  customTransforms: Readonly<Record<string, Transform>>;
};

/** Sets one ref, returning the cleanup a callback ref hands back, if any. */
function setRef<T>(
  ref: Ref<T> | undefined,
  value: T | null
): (() => void) | undefined {
  if (typeof ref === 'function') {
    const cleanup = ref(value);
    return typeof cleanup === 'function' ? cleanup : undefined;
  }
  if (ref) (ref as React.MutableRefObject<T | null>).current = value;
  return undefined;
}

/**
 * Attaches every ref. When one hands back a cleanup (React 19), the merged
 * callback returns a cleanup that runs it and resets the others with null.
 * Otherwise it returns nothing, since React 18 warns on a returned function,
 * and React detaches by calling it with null, which reaches every ref.
 */
function mergeRefs<T>(parent: Ref<T>, child: Ref<T>): RefCallback<T> {
  return (node) => {
    const refs = [parent, child];
    const cleanups = refs.map((ref) => setRef(ref, node));
    if (!cleanups.some(Boolean)) return;
    return () => {
      refs.forEach((ref, index) => {
        const cleanup = cleanups[index];
        if (cleanup) cleanup();
        else setRef(ref, null);
      });
    };
  };
}

const mergedRefs = new WeakMap<object, WeakMap<object, RefCallback<any>>>();

/**
 * The ref an asChild element gets. A single ref needs no merging; a pair gets
 * one merged callback, cached by the refs themselves, so a re-render with
 * unchanged refs hands React the same callback and the refs stay attached.
 * The runtime is hook-free so components work in server components, which
 * rules per-instance memoization out.
 */
function composeRefs<T>(
  parent: Ref<T> | undefined,
  child: Ref<T> | undefined
): Ref<T> | undefined {
  if (!parent) return child;
  if (!child) return parent;
  let byChild = mergedRefs.get(parent);
  if (!byChild) {
    byChild = new WeakMap();
    mergedRefs.set(parent, byChild);
  }
  let merged = byChild.get(child);
  if (!merged) {
    merged = mergeRefs(parent, child);
    byChild.set(child, merged);
  }
  return merged;
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
 * The child wins every conflict: the slot's props spread under the child's
 * own, so a handler declared on the child replaces the slot's instead of
 * chaining. `variables`, Animus's own dynamic styles, win over the child's.
 */
function renderSlot(
  children: ReactNode,
  props: Record<string, any>,
  ref: Ref<any> | undefined,
  variables?: Record<string, string>
): ReactElement {
  // Throws unless `children` is exactly one React element.
  const child = Children.only(children) as ReactElement<Record<string, any>>;
  const {
    asChild: _asChild,
    children: _children,
    className,
    ref: propRef,
    style,
    ...slotProps
  } = props;

  const mergedClassName = [className, child.props.className]
    .filter(Boolean)
    .join(' ');

  const mergedStyle =
    variables || style || child.props.style
      ? { ...style, ...child.props.style, ...variables }
      : undefined;

  return cloneElement(child, {
    ...slotProps,
    ...child.props,
    ref: composeRefs(ref ?? propRef, childRefOf(child)),
    className: mergedClassName,
    ...(mergedStyle ? { style: mergedStyle } : {}),
  });
}

/**
 * Renders an `asChild` slot exactly as Animus renders its own: the one child
 * element, with `props` spread under the child's props so the child wins
 * every conflict, class names joined (the slot's first), styles merged and
 * both refs attached. An `asComponent` target that receives `asChild` calls
 * it in place of its element:
 *
 * ```tsx
 * if (asChild) return renderAsChild(children, props, ref);
 * ```
 *
 * `asChild` and `children` in `props` are dropped, and `ref` defaults to
 * `props.ref`. It throws unless `children` is exactly one React element.
 *
 * An `asComponent` component types `children` as any `ReactNode`, whatever
 * the target declares, so a target rendering a void element such as `input`
 * leaves its children out without `asChild`, where React would throw.
 */
export function renderAsChild(
  children: ReactNode,
  props: object,
  ref?: Ref<any>
): ReactElement {
  return renderSlot(children, props as Record<string, any>, ref);
}

/** Animus's classes, then the caller's. */
function joinClassNames(classes: string, className: unknown): string {
  return className ? `${classes} ${className}` : classes;
}

/**
 * A string terminal renders `as` in place of its tag. A component terminal
 * always renders its component, which receives `as` and `asChild` like any
 * other prop, so its own wiring runs whatever element it ends up rendering.
 *
 * A component target may take `className` and `style` as callbacks that it
 * calls with its own state, as Base UI's do. It gets a callback in their
 * place, which merges the caller's result as a plain value merges: Animus's
 * classes first, and Animus's dynamic style over the caller's style.
 */
function renderElement(
  element: ElementType,
  filterProps: Set<string>,
  props: Record<string, any>,
  ref: ForwardedRef<any>,
  classes: string[],
  dynamicStyle: Record<string, string> | undefined
): ReactElement {
  const ownsElement = typeof element === 'string';
  const target = ownsElement ? props.as || element : element;
  const { className, style } = props;
  const ownClassName = classes.join(' ');

  const domProps: Record<string, any> = {
    ref,
    className:
      !ownsElement && typeof className === 'function'
        ? (state: unknown) => joinClassNames(ownClassName, className(state))
        : joinClassNames(ownClassName, className),
  };
  forwardProps(props, filterProps, domProps);

  if (dynamicStyle && !ownsElement && typeof style === 'function') {
    domProps.style = (state: unknown) => ({ ...style(state), ...dynamicStyle });
  } else if (dynamicStyle) {
    domProps.style = style ? { ...style, ...dynamicStyle } : dynamicStyle;
  }

  return createElement(target as any, domProps);
}

export function createComponent(
  element: ElementType,
  className: string,
  componentConfig: ComponentConfig,
  systemPropMap?: SystemPropMap,
  dynamicPropConfig?: DynamicPropConfig
): AnimusComponent {
  const config = withUniqueSystemPropNames(componentConfig);
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
      reportUncompiledRender(
        config.uncompiled,
        Component.displayName || undefined
      );
      const { classes, dynamicStyle } = resolveClasses(
        className,
        props,
        config,
        systemPropMap,
        dynamicPropConfig
      );

      if (props.asChild && ownsPolymorphism) {
        const slotProps: Record<string, any> = {
          className: joinClassNames(classes.join(' '), props.className),
        };
        forwardProps(props, filterProps, slotProps);
        return renderSlot(props.children, slotProps, ref, dynamicStyle);
      }
      return renderElement(
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
