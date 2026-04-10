/**
 * createComposedFamily — extraction-time replacement for compose().
 *
 * The transform emitter replaces `compose({ Root, Body }, { shared, name })`
 * with `createComposedFamily({ Root, Body }, { name })`.
 *
 * RSC-safe: uses only forwardRef and createElement — no createContext,
 * no useContext, no hooks.
 */

import {
  type ForwardRefExoticComponent,
  createElement,
  forwardRef,
  type ReactNode,
} from 'react';

interface ComposedFamilyConfig {
  name: string;
}

export function createComposedFamily(
  slots: Record<string, ForwardRefExoticComponent<any>>,
  config: ComposedFamilyConfig
): Record<string, ForwardRefExoticComponent<any>> {
  const { name } = config;
  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [slotName, SourceComponent] of Object.entries(slots)) {
    const Wrapper = forwardRef<unknown, Record<string, unknown>>(
      (props, ref) =>
        createElement(SourceComponent, { ...props, ref }, props.children as ReactNode)
    );
    Wrapper.displayName = `${name}.${slotName}`;
    result[slotName] = Wrapper;
  }

  return result;
}
