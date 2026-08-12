/**
 * createClassResolver — framework-agnostic className resolution.
 *
 * Produced by .asClass() terminal. Same resolution logic as createComponent
 * (variants, states, compounds, system props). The resolver remains callable
 * as a className string function and also exposes framework-neutral attributes
 * for renderers that need dynamic CSS-variable styles.
 */

import {
  type ClassResolverConfig,
  type DynamicPropConfig,
  resolveClasses,
  type SystemPropMap,
} from './resolveClasses.js';

export interface ClassResolverAttributes {
  class: string;
  style?: string;
}

export interface ClassResolver {
  (props?: Record<string, unknown>): string;
  attrs(props?: Record<string, unknown>): ClassResolverAttributes;
}

function serializeDynamicStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');
}

export function createClassResolver(
  className: string,
  config: ClassResolverConfig,
  systemPropMap?: SystemPropMap,
  dynamicPropConfig?: DynamicPropConfig
): ClassResolver {
  const resolveAttributes = (
    props?: Record<string, unknown>
  ): ClassResolverAttributes => {
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

  return Object.assign(resolver, { attrs: resolveAttributes });
}
