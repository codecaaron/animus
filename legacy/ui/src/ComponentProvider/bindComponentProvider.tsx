/* eslint-disable guard-for-in */
import React, {
  createContext,
  PropsWithChildren,
  useContext,
  useMemo,
} from 'react';

import { ComponentOverrides, ComponentRegistry } from './types';

export const bindComponentProvider = <
  ComponentKey extends keyof Registry,
  Registry extends ComponentRegistry,
>(
  components: Registry
) => {
  const ComponentContext = createContext<Registry>(undefined!);

  const useComponent = <T extends ComponentKey>(component: T) =>
    useContext(ComponentContext)?.[component];

  function ComponentProvider<Overrides extends ComponentOverrides<Registry>>(
    props: PropsWithChildren<{ overrides: Overrides }>
  ) {
    const { overrides, children } = props;

    const contextValue = useMemo(() => {
      const extendedComponents = {} as Registry;

      for (const key in components) {
        const { wrapper, extend } = overrides?.[key] ?? {};
        extendedComponents[key] = components[key];

        if (extend) {
          extendedComponents[key] = extend(
            extendedComponents[key]
          ) as Registry[typeof key];
        }

        if (wrapper) {
          const Wrapper = wrapper;
          const Component = extendedComponents[key];
          extendedComponents[key] = ((props) => (
            <Wrapper {...props}>
              <Component {...props} />
            </Wrapper>
          )) as Registry[typeof key];
        }
      }
      return extendedComponents;
    }, [overrides]);

    return (
      <ComponentContext.Provider value={contextValue}>
        {children}
      </ComponentContext.Provider>
    );
  }

  const registry = {} as Registry;

  Object.keys(components).forEach((key) => {
    const AliasedComponent = ((props) => {
      const Fallback = components[key];
      const Component = useComponent(key as ComponentKey);

      return Component ? <Component {...props} /> : <Fallback {...props} />;
    }) as Registry[ComponentKey];

    registry[key as ComponentKey] = AliasedComponent;
  });

  return {
    useComponent,
    ComponentProvider,
    registry,
  };
};
