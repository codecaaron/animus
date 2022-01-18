import {
  AnimusProvider,
  ComponentProvider,
  ColorModes,
} from '@animus-ui/components';
import { theme } from '~theme';
import { MDXProvider } from '@mdx-js/react';
import { overrides } from './overrides';
import { components } from './components';
import { createContext, useMemo, useState } from 'react';
import Head from 'next/head';

export const ThemeControlContext = createContext<{ onChangeMode?: () => void }>(
  {}
);

export const AppWrapper: React.FC = ({ children }) => {
  const initialMode = useMemo(() => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
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
              <link rel="shortcut icon" href={`/favicon-${mode}.png`} />
            </Head>
            {children}
          </ComponentProvider>
        </AnimusProvider>
      </MDXProvider>
    </ThemeControlContext.Provider>
  );
};
