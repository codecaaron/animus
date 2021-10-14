import { CSSObject } from '@animus/core';

import {
  CacheProvider,
  EmotionCache,
  Theme,
  ThemeProvider,
} from '@emotion/react';
import React, { useContext, useRef } from 'react';
import { createCache } from './cache/createCache';

import { Variables } from './globals/Variables';
import { Reset } from './globals/Reset';

export interface AnimusProviderProps {
  useGlobals?: boolean;
  useCache?: boolean;
  theme: Theme;
  variables?: Record<string, CSSObject>;
  cache?: EmotionCache;
}

interface AnimusContextShape {
  hasGlobals?: boolean;
  hasCache?: boolean;
}

export const AnimusContext = React.createContext<AnimusContextShape>({
  hasGlobals: false,
  hasCache: false,
});

AnimusContext.displayName = 'AnimusContext';

export const AnimusProvider: React.FC<AnimusProviderProps> = ({
  children,
  cache,
  theme,
  variables,
  useGlobals = true,
  useCache = true,
}) => {
  const { hasGlobals, hasCache } = useContext(AnimusContext);
  const shouldCreateCache = useCache && !hasCache;
  const shouldInsertGlobals = useGlobals && !hasGlobals;

  // Do not initialize a new cache if one has been provided as props
  const activeCache = useRef<EmotionCache | false>(
    shouldCreateCache && (cache ?? createCache())
  );

  const contextValue = {
    hasGlobals: shouldInsertGlobals,
    hasCache: shouldCreateCache,
  };

  const globals = shouldInsertGlobals && (
    <>
      <Reset />
      <Variables variables={theme._variables} />
      {variables && <Variables variables={variables} />}
    </>
  );

  const providers = (
    <AnimusContext.Provider value={contextValue}>
      <ThemeProvider theme={theme}>
        {globals}
        {children}
      </ThemeProvider>
    </AnimusContext.Provider>
  );

  if (!activeCache.current) return providers;

  return <CacheProvider value={activeCache.current}>{providers}</CacheProvider>;
};
