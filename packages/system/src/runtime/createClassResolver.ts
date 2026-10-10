import { IS_DEV } from './is-dev.js';
import {
  type ClassResolverConfig,
  type DynamicPropConfig,
  resolveClasses,
  type SystemPropMap,
  withUniqueSystemPropNames,
} from './resolveClasses.js';
import { reportUncompiledRender } from './uncompiled.js';

declare const __ANIMUS_DEV__: boolean | undefined;

export interface ClassResolverAttributes {
  class: string;
  style?: string;
}

/**
 * `props()`: the attributes under React's names. The style is an object, the
 * dynamic style's custom properties merged with the caller's style. A type
 * literal, not an interface, so it assigns to an open record such as Base
 * UI's `useRender({ props })`.
 */
export type ClassResolverProps = {
  className: string;
  style?: Record<string, string | number>;
};

/**
 * Input defaults to an open record; a builder's `asClass()` narrows it to the
 * props the builder admitted. `props()` also takes the caller's `className`
 * and `style`. That style is a record of `any`: React's `CSSProperties` is an
 * interface, and an interface assigns to no narrower index signature.
 */
export interface ClassResolver<Props extends object = Record<string, unknown>> {
  (props?: Props): string;
  attrs(props?: Props): ClassResolverAttributes;
  props(
    props?: Props & {
      className?: string | undefined;
      style?: Record<string, any> | undefined;
    }
  ): ClassResolverProps;
}

function serializeDynamicStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');
}

export function createClassResolver(
  className: string,
  resolverConfig: ClassResolverConfig,
  systemPropMap?: SystemPropMap,
  dynamicPropConfig?: DynamicPropConfig
): ClassResolver {
  const config = withUniqueSystemPropNames(resolverConfig);
  const resolveAttributes = (
    props?: Record<string, unknown>
  ): ClassResolverAttributes => {
    // The define token tested in place lets a minifier drop the report from
    // a production bundle.
    if (typeof __ANIMUS_DEV__ === 'boolean' ? __ANIMUS_DEV__ : IS_DEV) {
      reportUncompiledRender(config.uncompiled, undefined);
    }
    const { classes, dynamicStyle } = resolveClasses(
      className,
      props || {},
      config,
      systemPropMap,
      dynamicPropConfig
    );
    const attributes: ClassResolverAttributes = {
      class: classes.join(' '),
    };
    if (dynamicStyle && Object.keys(dynamicStyle).length > 0) {
      attributes.style = serializeDynamicStyle(dynamicStyle);
    }
    return attributes;
  };

  // The caller's className follows the resolver's classes, and the caller's
  // style keys win over the dynamic style's, as in a React spread.
  const resolveProps = (props?: {
    className?: string | undefined;
    style?: Record<string, any> | undefined;
  }): ClassResolverProps => {
    if (typeof __ANIMUS_DEV__ === 'boolean' ? __ANIMUS_DEV__ : IS_DEV) {
      reportUncompiledRender(config.uncompiled, undefined);
    }
    const { classes, dynamicStyle } = resolveClasses(
      className,
      props || {},
      config,
      systemPropMap,
      dynamicPropConfig
    );
    if (props?.className) classes.push(props.className);
    const attributes: ClassResolverProps = { className: classes.join(' ') };
    const style = props?.style
      ? { ...dynamicStyle, ...props.style }
      : dynamicStyle;
    if (style && Object.keys(style).length > 0) {
      attributes.style = style;
    }
    return attributes;
  };

  // The string form runs per render: resolve classes directly rather than
  // building (and discarding) the attributes object and its style string.
  const resolver = (props?: Record<string, unknown>): string => {
    if (typeof __ANIMUS_DEV__ === 'boolean' ? __ANIMUS_DEV__ : IS_DEV) {
      reportUncompiledRender(config.uncompiled, undefined);
    }
    return resolveClasses(
      className,
      props || {},
      config,
      systemPropMap,
      dynamicPropConfig
    ).classes.join(' ');
  };

  return Object.assign(resolver, {
    attrs: resolveAttributes,
    props: resolveProps,
  });
}
