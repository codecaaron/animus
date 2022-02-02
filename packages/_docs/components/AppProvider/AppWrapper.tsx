import {
  AnimusProvider,
  ColorModes,
  ComponentProvider,
} from '@animus-ui/components';
import { MDXProvider } from '@mdx-js/react';
import Head from 'next/head';
import { createContext, useMemo, useState } from 'react';

import { theme } from '~theme';

import { components } from './components';
import { overrides } from './overrides';

export const ThemeControlContext = createContext<{ onChangeMode?: () => void }>(
  {}
);

export const AppWrapper: React.FC = ({ children }) => {
  const initialMode = useMemo(() => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }, []);
  const [mode, setCurrentMode] = useState<ColorModes>(initialMode);

  const context = useMemo(
    () => ({
      onChangeMode: () =>
        setCurrentMode((prev) => (prev === 'light' ? 'dark' : 'light')),
    }),
    [setCurrentMode]
  );

  return (
    <ThemeControlContext.Provider value={context}>
      <MDXProvider components={components}>
        <AnimusProvider theme={theme} mode={mode}>
          <ComponentProvider overrides={overrides}>
            <Head>
              <link rel="icon" href={`/favicon-${mode}.png`} />
            </Head>
            {children}
          </ComponentProvider>
        </AnimusProvider>
      </MDXProvider>
    </ThemeControlContext.Provider>
  );
};
