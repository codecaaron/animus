'use client';

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
 * Compose components into a sealed family with shared variant propagation
 * via React context. Use this when children may be rendered in portals
 * or other React subtrees that escape the DOM hierarchy (where CSS
 * descendant selectors cannot reach).
 *
 * This function uses `createContext` and `useContext` — it is client-only.
 * For CSS-only propagation (RSC-safe), use `compose` from the barrel or
 * `@animus-ui/system/compose`.
 */
export function composeWithContext<
  Slots extends Record<string, AnyBrandedComponent>,
  const Shared extends SharedConfig<Slots>,
>(
  slots: Slots,
  options: { shared: Shared; name?: string }
): ComposedFamily<Slots> {
  const familyName = options.name ?? 'Composed';
  const sharedKeySet = new Set(Object.keys(options.shared));
  const FamilyCtx = createContext<Record<string, unknown>>({});

  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [name, SourceComponent] of Object.entries(slots)) {
    let Wrapper: ForwardRefExoticComponent<any>;

    if (name === 'Root') {
      // Root wrapper: extract shared props, provide via context.
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
    } else {
      // Child wrapper: read context, merge under direct props.
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const inherited = useContext(FamilyCtx);
        return createElement(SourceComponent, { ...inherited, ...props, ref });
      });
    }

    Wrapper.displayName = `${familyName}.${name}`;
    result[name] = Wrapper;
  }

  if (!('Root' in result)) {
    throw new Error(
      'composeWithContext(): No "Root" slot found. The root slot key must be exactly "Root" (PascalCase).'
    );
  }

  return result as ComposedFamily<Slots>;
}

/**
 * createComposedFamilyWithContext — extraction-time replacement for composeWithContext().
 *
 * The transform emitter replaces `composeWithContext({ Root, Body }, { shared, name })`
 * with `createComposedFamilyWithContext({ Root, Body }, { name, sharedKeys })`.
 *
 * Client-only: uses createContext and useContext. Files containing this function
 * receive a 'use client' directive from the transform emitter.
 */
export function createComposedFamilyWithContext(
  slots: Record<string, ForwardRefExoticComponent<any>>,
  config: { name: string; sharedKeys: string[] }
): Record<string, ForwardRefExoticComponent<any>> {
  const { name, sharedKeys } = config;
  const Ctx = createContext<Record<string, unknown>>({});
  const keySet = new Set(sharedKeys);
  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [slotName, SourceComponent] of Object.entries(slots)) {
    let Wrapper: ForwardRefExoticComponent<any>;

    if (slotName === 'Root') {
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const shared: Record<string, unknown> = {};
        for (const key of keySet) {
          if (key in props) shared[key] = props[key];
        }
        return createElement(
          SourceComponent,
          { ...props, ref },
          createElement(
            Ctx.Provider,
            { value: shared },
            props.children as ReactNode
          )
        );
      });
    } else {
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const inherited = useContext(Ctx);
        return createElement(SourceComponent, { ...inherited, ...props, ref });
      });
    }

    Wrapper.displayName = `${name}.${slotName}`;
    result[slotName] = Wrapper;
  }

  return result;
}
