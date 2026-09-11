/**
 * The extraction emitter rewrites `compose()` calls to this form. It stays
 * hook- and context-free so composed families work in server components.
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
