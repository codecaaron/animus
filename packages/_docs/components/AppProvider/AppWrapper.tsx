import {
  AnimusProvider,
  ColorModes,
  ComponentProvider,
} from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { MDXProvider } from '@mdx-js/react';
import Head from 'next/head';
import { useEffect, useMemo, useState } from 'react';
import { useCookies } from 'react-cookie';

import { theme } from '~theme';

import { components } from './components';
import { overrides } from './overrides';
import { ThemeControlContext } from './ThemeControl';

const Screen = animus
  .states({ loading: { visibility: 'hidden' } })
  .asComponent('div');

export const AppWrapper: React.FC = ({ children }) => {
  const [cookie, setCookie] = useCookies(['preferred_mode']);
  const [mode, setCurrentMode] = useState(cookie.preferred_mode as ColorModes);

  const context = useMemo(
    () => ({
      onChangeMode: () =>
        setCurrentMode((prev) => (prev === 'light' ? 'dark' : 'light')),
    }),
    [setCurrentMode]
  );

  useEffect(() => {
    if (!mode && typeof window !== 'undefined') {
      const initMode = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      setCurrentMode(initMode);
    } else {
      setCookie('preferred_mode', mode);
    }
  }, [setCookie, mode]);

  return (
    <ThemeControlContext.Provider value={context}>
      <MDXProvider components={components}>
        <AnimusProvider theme={theme} mode={mode}>
          <ComponentProvider overrides={overrides}>
            <Head>
              <link rel="icon" href={`/favicon-${mode}.png`} />
            </Head>
            <Screen loading={mode === undefined}>{children}</Screen>
          </ComponentProvider>
        </AnimusProvider>
      </MDXProvider>
    </ThemeControlContext.Provider>
  );
};
