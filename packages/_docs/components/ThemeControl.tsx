import { AnimusProvider } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { useDeferredRender } from 'hooks/useDeferredRender';
import { useIsomorphicLayoutEffect } from 'hooks/useIsomorphicLayoutEffect';
import Head from 'next/head';
import { createContext, useMemo } from 'react';
import { useCookies } from 'react-cookie';

import { theme } from '~theme';

export const ThemeControlContext = createContext<{ onChangeMode?: () => void }>(
  {}
);

const getUserColorScheme = () => {
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return undefined;
};

const Screen = animus
  .styles({ visibility: 'hidden' })
  .states({
    ready: {
      visibility: 'visible',
    },
  })
  .asComponent('div');

export const ThemeControl: React.FC = ({ children }) => {
  const [cookie, setCookie] = useCookies(['preferred_mode']);
  const mode = cookie.preferred_mode;

  const ready = useDeferredRender();

  const machinePreference = useMemo(() => {
    return getUserColorScheme() ?? mode ?? 'dark';
  }, [mode]);

  const context = useMemo(
    () => ({
      onChangeMode: () =>
        setCookie('preferred_mode', mode === 'light' ? 'dark' : 'light', {
          path: '/',
        }),
    }),
    [setCookie, mode]
  );

  useIsomorphicLayoutEffect(() => {
    if (mode === undefined) {
      setCookie('preferred_mode', getUserColorScheme() ?? 'dark');
    }
  }, [ready, mode, setCookie]);

  return (
    <ThemeControlContext.Provider value={context}>
      <AnimusProvider theme={theme} mode={mode}>
        <Head>
          <link rel="icon" href={`/favicon-${machinePreference}.png`} />
        </Head>
        <Screen ready={['light', 'dark'].includes(mode) && ready}>
          {children}
        </Screen>
      </AnimusProvider>
    </ThemeControlContext.Provider>
  );
};
