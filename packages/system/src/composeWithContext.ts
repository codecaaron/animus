'use client';

import {
  createContext,
  createElement,
  type ForwardRefExoticComponent,
  forwardRef,
  useContext,
} from 'react';

import { assertRootSlot } from './runtime/assert-root-slot';
import { IS_DEV } from './runtime/is-dev';

import type {
  AnyBrandedComponent,
  ComposedFamily,
  SharedConfig,
} from './types/component';

// Module-local so reading the token never widens a global (see is-dev.ts).
declare const __ANIMUS_DEV__: boolean | undefined;

/**
 * Context transport for shared variants, for children rendered in portals,
 * where the CSS descendant selectors `compose` relies on cannot reach.
 *
 * With `requireRoot: true`, a member rendered outside its family's Root
 * throws in development (`<Tabs.Panel> must be inside <Tabs.Root>`), as
 * extracted code does. A member a portal renders is still inside: React
 * context crosses portals. Production builds skip the check.
 */
export function composeWithContext<
  Slots extends { Root: AnyBrandedComponent } & Record<
    string,
    AnyBrandedComponent
  >,
  const Shared extends SharedConfig<Slots>,
>(
  slots: Slots,
  options: { shared: Shared; name?: string; requireRoot?: boolean }
): ComposedFamily<Slots> {
  assertRootSlot(slots, 'composeWithContext');
  return contextFamily(slots, {
    name: options.name ?? 'Composed',
    sharedKeys: Object.keys(options.shared),
    requireRoot: options.requireRoot === true,
  }) as ComposedFamily<Slots>;
}

/**
 * The extraction emitter rewrites `composeWithContext()` calls to this form
 * and adds the `'use client'` directive its context hooks require.
 */
export function createComposedFamilyWithContext(
  slots: Record<string, ForwardRefExoticComponent<any>>,
  config: { name: string; sharedKeys: string[]; requireRoot?: boolean }
): Record<string, ForwardRefExoticComponent<any>> {
  assertRootSlot(slots, 'createComposedFamilyWithContext');
  return contextFamily(slots, {
    ...config,
    requireRoot: config.requireRoot === true,
  });
}

/** The value a member reads where no Root provides one. */
const NO_ROOT: Readonly<Record<string, unknown>> = Object.freeze({});

/** The family both factories build, so authored and extracted code agree. */
function contextFamily(
  slots: Record<string, unknown>,
  config: { name: string; sharedKeys: string[]; requireRoot: boolean }
): Record<string, ForwardRefExoticComponent<any>> {
  const { name: familyName, requireRoot } = config;
  const sharedKeySet = new Set(config.sharedKeys);
  const FamilyCtx = createContext<Readonly<Record<string, unknown>>>(NO_ROOT);
  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [name, SourceComponent] of Object.entries(slots)) {
    const Source = SourceComponent as ForwardRefExoticComponent<any>;
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
        // The Provider wraps the Root's own render, so an `asChild` Root
        // clones its real child, not the Provider.
        return createElement(
          FamilyCtx.Provider,
          { value: shared },
          createElement(Source, { ...props, ref })
        );
      });
    } else {
      const member = `${familyName}.${name}`;
      // A nullish direct prop on a shared key yields to the inherited value:
      // `prop={undefined}` must not erase what a DOM child keeps via CSS.
      Wrapper = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const inherited = useContext(FamilyCtx);
        // The define token tested in place lets a minifier drop the check
        // from a production bundle.
        if (
          requireRoot &&
          inherited === NO_ROOT &&
          (typeof __ANIMUS_DEV__ === 'boolean' ? __ANIMUS_DEV__ : IS_DEV)
        ) {
          throw new Error(
            `<${member}> must be inside <${familyName}.Root>: ${familyName} is composed with requireRoot, so each member reads its shared props from the Root above it.`
          );
        }
        const merged: Record<string, unknown> = { ...inherited, ...props };
        for (const key of sharedKeySet) {
          if (props[key] == null && key in inherited)
            merged[key] = inherited[key];
        }
        // oxlint-disable-next-line react/refs -- the ref is forwarded, not read
        return createElement(Source, { ...merged, ref });
      });
    }

    Wrapper.displayName = `${familyName}.${name}`;
    result[name] = Wrapper;
  }

  return result;
}
