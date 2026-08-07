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
  createElement,
  type ForwardRefExoticComponent,
  forwardRef,
  type ReactNode,
} from 'react';

import { assertRootSlot } from './assert-root-slot';

interface ComposedFamilyConfig {
  name: string;
}

export function createComposedFamily(
  slots: Record<string, ForwardRefExoticComponent<any>>,
  config: ComposedFamilyConfig
): Record<string, ForwardRefExoticComponent<any>> {
  // Same precondition as the source form — see assertRootSlot.
  assertRootSlot(slots, 'createComposedFamily');
  const { name } = config;
  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [slotName, SourceComponent] of Object.entries(slots)) {
    const Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) =>
      createElement(
        SourceComponent,
        { ...props, ref },
        props.children as ReactNode
      )
    );
    Wrapper.displayName = `${name}.${slotName}`;
    result[slotName] = Wrapper;
  }

  return result;
}
