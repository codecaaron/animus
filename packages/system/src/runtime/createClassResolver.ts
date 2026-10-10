import {
  type ClassResolverConfig,
  type DynamicPropConfig,
  resolveClasses,
  type SystemPropMap,
  withUniqueSystemPropNames,
} from './resolveClasses.js';

export interface ClassResolverAttributes {
  class: string;
  style?: string;
}

/**
 * `attrs()` with `{ styleAs: 'object' }`: the dynamic style as an object of
 * custom properties, which a style prop such as React's takes as it is.
 */
export interface ClassResolverObjectAttributes {
  class: string;
  style?: Record<string, string>;
}

/**
 * Input defaults to an open record; a builder's `asClass()` narrows it to the
 * props the builder admitted. `attrs()` returns the dynamic style as a CSS
 * string unless asked for an object.
 */
export interface ClassResolver<Props extends object = Record<string, unknown>> {
  (props?: Props): string;
  attrs(
    props: Props | undefined,
    options: { styleAs: 'object' }
  ): ClassResolverObjectAttributes;
  attrs(
    props?: Props,
    options?: { styleAs?: 'string' }
  ): ClassResolverAttributes;
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
    props?: Record<string, unknown>,
    options?: { styleAs?: 'string' | 'object' }
  ): ClassResolverAttributes | ClassResolverObjectAttributes => {
    const { classes, dynamicStyle } = resolveClasses(
      className,
      props || {},
      config,
      systemPropMap,
      dynamicPropConfig
    );
    const attributes: ClassResolverAttributes | ClassResolverObjectAttributes =
      { class: classes.join(' ') };
    if (dynamicStyle && Object.keys(dynamicStyle).length > 0) {
      attributes.style =
        options?.styleAs === 'object'
          ? dynamicStyle
          : serializeDynamicStyle(dynamicStyle);
    }
    return attributes;
  };

  // The string form runs per render: resolve classes directly rather than
  // building (and discarding) the attributes object and its style string.
  const resolver = (props?: Record<string, unknown>): string =>
    resolveClasses(
      className,
      props || {},
      config,
      systemPropMap,
      dynamicPropConfig
    ).classes.join(' ');

  return Object.assign(resolver, {
    attrs: resolveAttributes as ClassResolver['attrs'],
  });
}
