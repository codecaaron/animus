'use client';

import {
  createContext,
  createElement,
  type ForwardRefExoticComponent,
  forwardRef,
  type ReactNode,
  useContext,
} from 'react';

import { assertRootSlot } from './runtime/assert-root-slot';

import type {
  AnyBrandedComponent,
  ComposedFamily,
  SharedConfig,
} from './types/component';

/**
 * Context transport for shared variants, for children rendered in portals,
 * where the CSS descendant selectors `compose` relies on cannot reach.
 */
export function composeWithContext<
  Slots extends { Root: AnyBrandedComponent } & Record<
    string,
    AnyBrandedComponent
  >,
  const Shared extends SharedConfig<Slots>,
>(
  slots: Slots,
  options: { shared: Shared; name?: string }
): ComposedFamily<Slots> {
  assertRootSlot(slots, 'composeWithContext');
  const familyName = options.name ?? 'Composed';
  const sharedKeySet = new Set(Object.keys(options.shared));
  const FamilyCtx = createContext<Record<string, unknown>>({});

  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [name, SourceComponent] of Object.entries(slots)) {
    let Wrapper: ForwardRefExoticComponent<any>;

    if (name === 'Root') {
      // Context carries effective values — the explicit prop, else the Root's
      // default — so portaled children inherit what the CSS transport gives.
      const rootDefaults = (
        SourceComponent as {
          variantDefaults?: Readonly<Record<string, string>>;
        }
      ).variantDefaults;
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const shared: Record<string, unknown> = {};
        for (const key of sharedKeySet) {
          const value = props[key] ?? rootDefaults?.[key];
          if (value != null) shared[key] = value;
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
      // A nullish direct prop on a shared key yields to the inherited value:
      // `prop={undefined}` must not erase what a DOM child keeps via CSS.
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const inherited = useContext(FamilyCtx);
        const merged: Record<string, unknown> = { ...inherited, ...props };
        for (const key of sharedKeySet) {
          if (props[key] == null && key in inherited)
            merged[key] = inherited[key];
        }
        // oxlint-disable-next-line react/refs -- the ref is forwarded, not read
        return createElement(SourceComponent, { ...merged, ref });
      });
    }

    Wrapper.displayName = `${familyName}.${name}`;
    result[name] = Wrapper;
  }

  return result as ComposedFamily<Slots>;
}

/**
 * The extraction emitter rewrites `composeWithContext()` calls to this form
 * and adds the `'use client'` directive its context hooks require.
 */
export function createComposedFamilyWithContext(
  slots: Record<string, ForwardRefExoticComponent<any>>,
  config: { name: string; sharedKeys: string[] }
): Record<string, ForwardRefExoticComponent<any>> {
  assertRootSlot(slots, 'createComposedFamilyWithContext');
  const { name, sharedKeys } = config;
  const Ctx = createContext<Record<string, unknown>>({});
  const keySet = new Set(sharedKeys);
  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [slotName, SourceComponent] of Object.entries(slots)) {
    let Wrapper: ForwardRefExoticComponent<any>;

    if (slotName === 'Root') {
      const rootDefaults = (
        SourceComponent as {
          variantDefaults?: Readonly<Record<string, string>>;
        }
      ).variantDefaults;
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const shared: Record<string, unknown> = {};
        for (const key of keySet) {
          const value = props[key] ?? rootDefaults?.[key];
          if (value != null) shared[key] = value;
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
        const merged: Record<string, unknown> = { ...inherited, ...props };
        for (const key of keySet) {
          if (props[key] == null && key in inherited)
            merged[key] = inherited[key];
        }
        // oxlint-disable-next-line react/refs -- the ref is forwarded, not read
        return createElement(SourceComponent, { ...merged, ref });
      });
    }

    Wrapper.displayName = `${name}.${slotName}`;
    result[slotName] = Wrapper;
  }

  return result;
}
