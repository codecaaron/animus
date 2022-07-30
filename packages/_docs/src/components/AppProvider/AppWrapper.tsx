import { ComponentProvider } from '@animus-ui/components';
import { EmotionCache } from '@emotion/react';
import { MDXProvider } from '@mdx-js/react';

import { ThemeControl } from '../ThemeControl';
import { components } from './markdown';
import { overrides } from './overrides';

export const AppWrapper: React.FC<{ cache: EmotionCache }> = ({
  children,
  cache,
}) => {
  return (
    <ThemeControl cache={cache}>
      <MDXProvider components={components}>
        <ComponentProvider overrides={overrides}>{children}</ComponentProvider>
      </MDXProvider>
    </ThemeControl>
  );
};
