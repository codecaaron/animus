import { AnimusProvider, ColorModes } from '@animus-ui/components';
import { EmotionCache } from '@emotion/react';
import { useIsomorphicLayoutEffect } from 'hooks/useIsomorphicLayoutEffect';
import Head from 'next/head';
import { createContext, useMemo } from 'react';
import { useCookies } from 'react-cookie';

import { theme } from '~theme';

export const ThemeControlContext = createContext<{
  onChangeMode?: (mode: ColorModes) => void;
}>({});

const getUserColorScheme = () => {
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return 'light';
};

export const ThemeControl: React.FC<{ cache: EmotionCache }> = ({
  children,
  cache,
}) => {
  const [cookie, setCookie] = useCookies(['preferred_mode']);
  const mode = cookie.preferred_mode;

  const context = useMemo(
    () => ({
      onChangeMode: (nextMode: ColorModes) =>
        setCookie('preferred_mode', nextMode, {
          path: '/',
        }),
    }),
    [setCookie]
  );

  useIsomorphicLayoutEffect(() => {
    if (mode === undefined) {
      setCookie('preferred_mode', getUserColorScheme());
    }
  }, [mode, setCookie]);

  return (
    <ThemeControlContext.Provider value={context}>
      <AnimusProvider theme={theme} mode={mode} cache={cache}>
        <Head>
          <link rel="icon" href="/favicon-dark.png" />
        </Head>
        {children}
      </AnimusProvider>
    </ThemeControlContext.Provider>
  );
};
