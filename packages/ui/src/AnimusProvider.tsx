import { compatTheme, CSSObject } from '@animus-ui/core';
import { serializeTokens } from '@animus-ui/theming';
import {
  CacheProvider,
  EmotionCache,
  Theme,
  ThemeProvider,
} from '@emotion/react';
import { isEmpty, mapValues } from 'lodash';
import React, { useContext, useMemo, useRef } from 'react';

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

export const AnimusProvider: React.FC<AnimusProviderProps> = ({
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

  const { colors, modes } = normalizedTheme;
  // Do not initialize a new cache if one has been provided as props
  const activeCache = useRef<EmotionCache | false>(
    shouldCreateCache && (cache ?? createCache())
  );

  const contextValue = {
    hasGlobals: shouldInsertGlobals,
    hasCache: shouldCreateCache,
  };

  const { variables: colorVariables } = useMemo(() => {
    return mode && !isEmpty(colors)
      ? serializeTokens(
          mapValues(modes[mode], (color) => colors[color]),
          'color',
          theme
        )
      : { variables: {} };
  }, [colors, mode, modes, theme]);

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
      {colorVariables && (
        <>
          <ColorScheme />
          <Variables variables={{ currentMode: colorVariables }} />
        </>
      )}
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
