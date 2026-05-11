/**
 * createClassResolver — framework-agnostic className resolution.
 *
 * Produced by .asClass() terminal. Same resolution logic as createComponent
 * (variants, states, compounds, system props) but returns a className string
 * instead of a React element.
 */

import {
  type ClassResolverConfig,
  type DynamicPropConfig,
  resolveClasses,
  type SystemPropMap,
} from './resolveClasses';

export function createClassResolver(
  className: string,
  config: ClassResolverConfig,
  systemPropMap?: SystemPropMap,
  dynamicPropConfig?: DynamicPropConfig
): (props?: Record<string, unknown>) => string {
  return (props?: Record<string, unknown>): string => {
    const { classes } = resolveClasses(
      className,
      props || {},
      config,
      systemPropMap,
      dynamicPropConfig
    );
    return classes.join(' ');
  };
}
