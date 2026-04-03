import {
  createContext,
  createElement,
  type ForwardRefExoticComponent,
  forwardRef,
  useContext,
} from 'react';

import type {
  AnyBrandedComponent,
  ComposedFamily,
  SharedConfig,
} from './types/component';

const EMPTY_SHARED: Record<string, unknown> = {};

/**
 * Compose independently-authored Animus components into a sealed,
 * namespaced component family with shared variant propagation via
 * React context.
 *
 * - **Enforce**: TypeScript ensures shared keys exist on Root (the
 *   provider). Non-Root slots that have the key consume it from
 *   context; slots without the key are unaffected.
 * - **Wire**: Root provides shared variant values via context.
 *   Child slots consume from context. Direct props override context.
 * - **Seal**: Output components are plain ForwardRefExoticComponent —
 *   no `.extend()`, no builder methods. One-way door from builder-land
 *   to component-land.
 */
export function compose<
  Slots extends Record<string, AnyBrandedComponent>,
  const Shared extends SharedConfig<Slots>,
>(
  slots: Slots,
  options: { shared: Shared; name?: string }
): ComposedFamily<Slots> {
  const sharedKeys = Object.keys(options.shared);
  const FamilyContext = createContext<Record<string, unknown>>(EMPTY_SHARED);

  // Family name: explicit option or generic fallback. No displayName parsing —
  // extraction class names are opaque hashes, not semantic identifiers.
  const familyName = options.name ?? 'Composed';

  const result: Record<string, ForwardRefExoticComponent<any>> = {};

  for (const [name, SourceComponent] of Object.entries(slots)) {
    const isRoot = name === 'Root';

    if (isRoot) {
      const RootWrapper = forwardRef<unknown, Record<string, unknown>>(
        (props, ref) => {
          const sharedValues: Record<string, unknown> = {};
          for (const key of sharedKeys) {
            if (key in props) {
              sharedValues[key] = props[key];
            }
          }

          return createElement(
            FamilyContext.Provider,
            { value: sharedKeys.length > 0 ? sharedValues : EMPTY_SHARED },
            createElement(SourceComponent, { ...props, ref })
          );
        }
      );
      RootWrapper.displayName = `${familyName}.${name}`;
      result[name] = RootWrapper;
    } else {
      // Only spread shared values that this slot actually understands
      // (has as a variant key). Prevents unknown props leaking to DOM.
      const knownKeys = (SourceComponent as any).__variantKeys as
        | Set<string>
        | undefined;

      const ChildWrapper = forwardRef<unknown, Record<string, unknown>>(
        (props, ref) => {
          const shared = useContext(FamilyContext);
          let merged: Record<string, unknown>;
          if (knownKeys && sharedKeys.length > 0) {
            const filtered: Record<string, unknown> = {};
            for (const key of sharedKeys) {
              if (knownKeys.has(key) && key in shared) {
                filtered[key] = shared[key];
              }
            }
            merged = { ...filtered, ...props, ref };
          } else {
            merged = { ...props, ref };
          }
          return createElement(SourceComponent, merged);
        }
      );
      ChildWrapper.displayName = `${familyName}.${name}`;
      result[name] = ChildWrapper;
    }
  }

  if (!('Root' in result)) {
    throw new Error(
      'compose(): No "Root" slot found. The root slot key must be exactly "Root" (PascalCase).'
    );
  }

  return result as ComposedFamily<Slots>;
}
