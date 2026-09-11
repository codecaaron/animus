import {
  createElement,
  type ForwardRefExoticComponent,
  forwardRef,
  type ReactNode,
} from 'react';

import { assertRootSlot } from './runtime/assert-root-slot';

import type {
  AnyBrandedComponent,
  ComposedFamily,
  SharedConfig,
} from './types/component';

/**
 * Shared variants propagate through the CSS cascade, so a slot only inherits
 * as a DOM descendant of Root; `composeWithContext` covers portaled children.
 */
export function compose<
  Slots extends { Root: AnyBrandedComponent } & Record<
    string,
    AnyBrandedComponent
  >,
  const Shared extends SharedConfig<Slots>,
>(
  slots: Slots,
  options: { shared: Shared; name?: string }
): ComposedFamily<Slots> {
  assertRootSlot(slots, 'compose');
  const familyName = options.name ?? 'Composed';

  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [name, SourceComponent] of Object.entries(slots)) {
    const Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) =>
      createElement(
        SourceComponent,
        { ...props, ref },
        props.children as ReactNode
      )
    );

    Wrapper.displayName = `${familyName}.${name}`;
    result[name] = Wrapper;
  }

  return result as ComposedFamily<Slots>;
}
