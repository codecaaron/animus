import { AnimusProvider, ComponentProvider } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { MDXProvider } from '@mdx-js/react';
import Head from 'next/head';
import { useEffect, useMemo } from 'react';
import { useCookies } from 'react-cookie';

import { theme } from '~theme';

import { components } from './components';
import { overrides } from './overrides';
import { ThemeControlContext } from './ThemeControl';

const getUserColorScheme = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const Screen = animus
  .styles({ visibility: 'hidden' })
  .states({
    ready: {
      visibility: 'visible',
    },
  })
  .asComponent('div');

export const AppWrapper: React.FC = ({ children }) => {
  const [cookie, setCookie] = useCookies(['preferred_mode']);

  const mode = cookie.preferred_mode;

  const context = useMemo(
    () => ({
      onChangeMode: () =>
        setCookie('preferred_mode', mode === 'light' ? 'dark' : 'light'),
    }),
    [setCookie, mode]
  );

  useEffect(() => {
    if (mode === undefined && typeof window !== 'undefined') {
      setCookie('preferred_mode', getUserColorScheme());
    }
  }, [mode, setCookie]);

  return (
    <ThemeControlContext.Provider value={context}>
      <MDXProvider components={components}>
        <AnimusProvider theme={theme} mode={mode}>
          <ComponentProvider overrides={overrides}>
            <Head>
              <link rel="icon" href={`/favicon-${mode}.png`} />
            </Head>
            <Screen ready={['light', 'dark'].includes(mode)}>{children}</Screen>
          </ComponentProvider>
        </AnimusProvider>
      </MDXProvider>
    </ThemeControlContext.Provider>
  );
};
