import { AnimusProvider, ComponentProvider } from '@animus/ui';
import { theme } from '@animus/theme';
import { MDXProvider } from '@mdx-js/react';
import { overrides } from './overrides';
import { components } from './components';

export const AppWrapper: React.FC = ({ children }) => {
  return (
    <MDXProvider components={components}>
      <AnimusProvider theme={theme}>
        <ComponentProvider overrides={overrides}>{children}</ComponentProvider>
      </AnimusProvider>
    </MDXProvider>
  );
};
