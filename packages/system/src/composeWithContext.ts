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
      // Root wrapper: provide EFFECTIVE shared values via context — the
      // explicit prop, else the Root component's default option, so
      // portaled children match the CSS transport's `--default`-keyed
      // inheritance rule. Axes with neither stay absent.
      const rootDefaults = (
        SourceComponent as {
          variantDefaults?: Readonly<Record<string, string>>;
        }
      ).variantDefaults;
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const shared: Record<string, unknown> = {};
        for (const key of sharedKeySet) {
          // Mirror class assembly's effective-value resolution exactly
          // (`props[prop] ?? vc.default`): explicit nullish falls through
          // to the default; neither → absent.
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
      // Child wrapper: read context, merge under direct props. A nullish
      // direct prop on a SHARED key yields to the inherited effective
      // value (same `??` principle as the Root wrapper) — otherwise
      // `prop={undefined}` would erase the default for a portaled child
      // while a DOM-descendant child keeps it via the CSS transport.
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const inherited = useContext(FamilyCtx);
        const merged: Record<string, unknown> = { ...inherited, ...props };
        for (const key of sharedKeySet) {
          if (props[key] == null && key in inherited)
            merged[key] = inherited[key];
        }
        return createElement(SourceComponent, { ...merged, ref });
      });
    }

    Wrapper.displayName = `${familyName}.${name}`;
    result[name] = Wrapper;
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
  // Same precondition as the source form — see assertRootSlot.
  assertRootSlot(slots, 'createComposedFamilyWithContext');
  const { name, sharedKeys } = config;
  const Ctx = createContext<Record<string, unknown>>({});
  const keySet = new Set(sharedKeys);
  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [slotName, SourceComponent] of Object.entries(slots)) {
    let Wrapper: ForwardRefExoticComponent<any>;

    if (slotName === 'Root') {
      // Effective shared values — see composeWithContext(); the extracted
      // form must stay behaviorally identical to the source form.
      const rootDefaults = (
        SourceComponent as {
          variantDefaults?: Readonly<Record<string, string>>;
        }
      ).variantDefaults;
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const shared: Record<string, unknown> = {};
        for (const key of keySet) {
          // Mirror class assembly's `props[prop] ?? default` resolution —
          // see composeWithContext(); the forms stay identical.
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
      // Nullish shared props yield to inherited — see composeWithContext().
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const inherited = useContext(Ctx);
        const merged: Record<string, unknown> = { ...inherited, ...props };
        for (const key of keySet) {
          if (props[key] == null && key in inherited)
            merged[key] = inherited[key];
        }
        return createElement(SourceComponent, { ...merged, ref });
      });
    }

    Wrapper.displayName = `${name}.${slotName}`;
    result[slotName] = Wrapper;
  }

  return result;
}
