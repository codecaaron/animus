import {
  type ForwardRefExoticComponent,
  createElement,
  forwardRef,
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
 *   provider). Non-Root slots that have the key consume it from
 *   CSS inheritance; slots without the key are unaffected.
 * - **Wire**: The extraction pipeline emits composed variant CSS
 *   rules — two per shared variant option per child (inheritance +
 *   override) within @layer variants. No runtime context needed.
 * - **Seal**: Output components are plain ForwardRefExoticComponent —
 *   no `.extend()`, no builder methods. One-way door from builder-land
 *   to component-land.
 */
export function compose<
  Slots extends Record<string, AnyBrandedComponent>,
  const Shared extends SharedConfig<Slots>,
>(
  slots: Slots,
  // IMPORTANT: `shared` is read by the Rust extraction pipeline (jsx_scanner.rs)
  // at build time to emit composed variant CSS rules. The runtime does not use it,
  // but removing it would silently break CSS-only shared variant propagation.
  options: { shared: Shared; name?: string }
): ComposedFamily<Slots> {
  // Family name: explicit option or generic fallback.
  const familyName = options.name ?? 'Composed';

  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [name, SourceComponent] of Object.entries(slots)) {
    // Thin wrapper: seals the component (no .extend()) and assigns displayName.
    // Shared variant propagation is handled entirely by CSS — no context needed.
    const Wrapper = forwardRef<unknown, Record<string, unknown>>(
      (props, ref) => createElement(SourceComponent, { ...props, ref })
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
