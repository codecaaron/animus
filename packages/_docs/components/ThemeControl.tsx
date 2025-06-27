import { EmotionCache } from '@emotion/react';
import Head from 'next/head';
import { createContext, PropsWithChildren, useState } from 'react';

import { AnimusProvider, ColorModes } from '@animus-ui/components';

import { theme } from '~theme';

export const ThemeControlContext = createContext<{
  onChangeMode?: (mode: ColorModes) => void;
}>({});

export const ThemeControl: React.FC<
  PropsWithChildren<{ cache: EmotionCache }>
> = ({ children, cache }) => {
  const [mode, setMode] = useState<ColorModes>('light');

  return (
    <ThemeControlContext.Provider value={{ onChangeMode: setMode }}>
      <AnimusProvider theme={theme} mode={mode} cache={cache}>
        <Head>
          <link rel="icon" href="/favicon-dark.png" />
        </Head>
        {children}
      </AnimusProvider>
    </ThemeControlContext.Provider>
  );
};
