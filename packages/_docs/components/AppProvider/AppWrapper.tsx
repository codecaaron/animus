import { ComponentProvider } from '@animus-ui/components';
import { MDXProvider } from '@mdx-js/react';

import { ThemeControl } from '../ThemeControl';
import { components } from './markdown';
import { overrides } from './overrides';

export const AppWrapper: React.FC = ({ children }) => {
  return (
    <ThemeControl>
      <MDXProvider components={components}>
        <ComponentProvider overrides={overrides}>{children}</ComponentProvider>
      </MDXProvider>
    </ThemeControl>
  );
};
