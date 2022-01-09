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

export const ThemeControlContext = createContext<{ onChangeMode?: () => void }>(
  {}
);

export const AppWrapper: React.FC = ({ children }) => {
  const [mode, setCurrentMode] = useState<ColorModes>('dark');
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
            {children as any}
          </ComponentProvider>
        </AnimusProvider>
      </MDXProvider>
    </ThemeControlContext.Provider>
  );
};
