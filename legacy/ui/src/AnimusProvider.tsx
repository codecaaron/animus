import { CSSObject, compatTheme } from '@animus-ui/core';
import {
  CacheProvider,
  EmotionCache,
  Theme,
  ThemeProvider,
} from '@emotion/react';
import React, { PropsWithChildren, useContext, useMemo, useRef } from 'react';

import { createCache } from './cache/createCache';
import { ColorModes } from './components/ColorMode';
import { ColorScheme } from './globals/ColorScheme';
import { Reset } from './globals/Reset';
import { Variables } from './globals/Variables';

export interface AnimusProviderProps {
  useGlobals?: boolean;
  useCache?: boolean;
  theme: Theme;
  variables?: Record<string, CSSObject>;
  cache?: EmotionCache;
  mode?: ColorModes;
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

export const AnimusProvider: React.FC<
  PropsWithChildren<AnimusProviderProps>
> = ({
  children,
  cache,
  theme,
  variables,
  mode,
  useGlobals = true,
  useCache = true,
}) => {
  const normalizedTheme = theme ?? compatTheme;
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

  const activeTheme = useMemo(
    () => ({ ...normalizedTheme, mode }),
    [normalizedTheme, mode]
  );

  const globals = shouldInsertGlobals && (
    <>
      <Reset />
      {normalizedTheme?._variables && (
        <Variables variables={normalizedTheme?._variables} />
      )}
      {variables && <Variables variables={variables} />}
      <ColorScheme mode={mode} />
    </>
  );

  const providers = (
    <AnimusContext.Provider value={contextValue}>
      <ThemeProvider theme={activeTheme}>
        {globals}
        {children}
      </ThemeProvider>
    </AnimusContext.Provider>
  );

  if (!activeCache.current) return providers;

  return <CacheProvider value={activeCache.current}>{providers}</CacheProvider>;
};
