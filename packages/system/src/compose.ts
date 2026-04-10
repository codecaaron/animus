import {
  createElement,
  type ForwardRefExoticComponent,
  forwardRef,
  type ReactNode,
} from 'react';

import type {
  AnyBrandedComponent,
  ComposedFamily,
  SharedConfig,
} from './types/component';

/**
 * Compose independently-authored Animus components into a sealed,
 * namespaced component family with shared variant propagation via
 * CSS cascade.
 *
 * - **Enforce**: TypeScript ensures shared keys exist on Root (the
 *   cascade source). Non-Root slots that have the key consume it from
 *   CSS inheritance; slots without the key are unaffected.
 * - **Wire**: The extraction pipeline emits composed variant CSS
 *   rules — two per shared variant option per child (inheritance +
 *   override) within @layer variants.
 * - **Seal**: Output components are plain ForwardRefExoticComponent —
 *   no `.extend()`, no builder methods. One-way door from builder-land
 *   to component-land.
 *
 * For React context propagation (portal-crossing), use
 * `composeWithContext` from `@animus-ui/system/compose-with-context`.
 */
export function compose<
  Slots extends Record<string, AnyBrandedComponent>,
  const Shared extends SharedConfig<Slots>,
>(
  slots: Slots,
  options: { shared: Shared; name?: string }
): ComposedFamily<Slots> {
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

  if (!('Root' in result)) {
    throw new Error(
      'compose(): No "Root" slot found. The root slot key must be exactly "Root" (PascalCase).'
    );
  }

  return result as ComposedFamily<Slots>;
}
