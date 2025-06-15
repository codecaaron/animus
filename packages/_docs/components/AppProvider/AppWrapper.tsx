import { EmotionCache } from '@emotion/react';
import { MDXProvider } from '@mdx-js/react';
import { ComponentProvider } from '@syzygos/components';
import { PropsWithChildren } from 'react';

import { ThemeControl } from '../ThemeControl';
import { components } from './markdown';
import { overrides } from './overrides';

export const AppWrapper: React.FC<
  PropsWithChildren<{ cache: EmotionCache }>
> = ({ children, cache }) => {
  return (
    <ThemeControl cache={cache}>
      <MDXProvider components={components}>
        <ComponentProvider overrides={overrides}>{children}</ComponentProvider>
      </MDXProvider>
    </ThemeControl>
  );
};
