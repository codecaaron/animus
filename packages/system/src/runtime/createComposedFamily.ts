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

  // Mirror compose(): a family without a Root slot has no cascade source, so
  // the composed variant rules emitted for its children would never inherit
  // anything — the silent-drop failure mode this runtime guards against.
  // Source form and extracted form must agree on this contract.
  if (!('Root' in result)) {
    throw new Error(
      'createComposedFamily(): No "Root" slot found. The root slot key must be exactly "Root" (PascalCase).'
    );
  }

  return result;
}
