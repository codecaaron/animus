import {
  createContext,
  createElement,
  type ForwardRefExoticComponent,
  forwardRef,
  type ReactNode,
  useContext,
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
 * - **Context**: When `context: true`, shared variant prop values
 *   are also propagated via React context for portal-mounted children
 *   that CSS descendant selectors cannot reach.
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
  // at build time to emit composed variant CSS rules. When `context` is false/absent,
  // the runtime does not use `shared`. When `context: true`, the runtime reads shared
  // keys to determine which props to propagate via React context.
  options: { shared: Shared; name?: string; context?: boolean }
): ComposedFamily<Slots> {
  const familyName = options.name ?? 'Composed';
  const useCtx = options.context ?? false;

  // Context machinery — created once at compose() call time, not per render.
  const FamilyCtx = useCtx ? createContext<Record<string, unknown>>({}) : null;
  const sharedKeySet = useCtx ? new Set(Object.keys(options.shared)) : null;

  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [name, SourceComponent] of Object.entries(slots)) {
    let Wrapper: ForwardRefExoticComponent<any>;

    if (name === 'Root' && FamilyCtx && sharedKeySet) {
      // Root wrapper (context mode): extract shared props, provide via context.
      // Provider wraps props.children INSIDE Root's rendered output so that
      // portaled React children (which escape the DOM but remain React children)
      // receive the context.
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const shared: Record<string, unknown> = {};
        for (const key of sharedKeySet) {
          if (key in props) shared[key] = props[key];
        }
        return createElement(
          SourceComponent,
          { ...props, ref },
          createElement(
            FamilyCtx.Provider,
            { value: shared },
            props.children as ReactNode
          )
        );
      });
    } else if (FamilyCtx) {
      // Child wrapper (context mode): read context, merge under direct props.
      // Direct props win via spread ordering — { ...inherited, ...props }.
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const inherited = useContext(FamilyCtx);
        return createElement(SourceComponent, { ...inherited, ...props, ref });
      });
    } else {
      // Default: thin wrapper, no hooks, no context. CSS-only propagation.
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) =>
        createElement(SourceComponent, { ...props, ref })
      );
    }

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
