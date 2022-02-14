import { AnimusProvider, ComponentProvider } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { MDXProvider } from '@mdx-js/react';
import Head from 'next/head';
import { useEffect, useMemo, useState } from 'react';
import { useCookies } from 'react-cookie';

import { theme } from '~theme';

import { components } from './components';
import { overrides } from './overrides';
import { ThemeControlContext } from './ThemeControl';

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

const useDeferredRender = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready;
};

export const AppWrapper: React.FC = ({ children }) => {
  const [cookie, setCookie] = useCookies(['preferred_mode']);
  const mode = cookie.preferred_mode;

  const ready = useDeferredRender();

  const machinePreference = useMemo(() => {
    return getUserColorScheme() ?? mode ?? 'dark';
  }, [mode]);

  const context = useMemo(
    () => ({
      onChangeMode: () =>
        setCookie('preferred_mode', mode === 'light' ? 'dark' : 'light'),
    }),
    [setCookie, mode]
  );

  useEffect(() => {
    if (mode === undefined) {
      setCookie('preferred_mode', getUserColorScheme() ?? 'dark');
    }
  }, [ready, mode, setCookie]);

  return (
    <ThemeControlContext.Provider value={context}>
      <MDXProvider components={components}>
        <AnimusProvider theme={theme} mode={mode}>
          <ComponentProvider overrides={overrides}>
            <Head>
              <link rel="icon" href={`/favicon-${machinePreference}.png`} />
            </Head>
            <Screen ready={['light', 'dark'].includes(mode) && ready}>
              {children}
            </Screen>
          </ComponentProvider>
        </AnimusProvider>
      </MDXProvider>
    </ThemeControlContext.Provider>
  );
};
