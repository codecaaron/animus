import { AnimusProvider, ComponentProvider, Link, Text } from '@animus/ui';
import { theme } from '@animus/theme';
import { useRouter } from 'next/dist/client/router';
import NextLink from 'next/link';
import { Highlighter } from './SyntaxHighlighter';
import { MDXProvider } from '@mdx-js/react';

const overrides = {
  Link: {
    extend: (Link) => (props) => {
      const { asPath } = useRouter();
      return (
        <NextLink href={props.href} passHref>
          <Link active={asPath === props.href} {...props} />
        </NextLink>
      );
    },
  },
};

const components = {
  h1: (props) => <Text as="h1" fontSize={36} mb={16} {...props} />,
  h2: (props) => <Text as="h2" fontSize={28} mb={16} {...props} />,
  h3: (props) => <Text as="h3" fontSize={22} mb={16} {...props} />,
  h4: (props) => <Text as="h4" fontSize={18} mb={16} {...props} />,
  h5: (props) => <Text as="h5" fontSize={16} mb={16} {...props} />,
  h6: (props) => <Text as="h6" fontSize={14} mb={16} {...props} />,
  p: (props) => <Text as="p" mb={16} {...props} />,
  a: Link,
  pre: Highlighter,
};

export const AppWrapper: React.FC = ({ children }) => {
  return (
    <MDXProvider components={components}>
      <AnimusProvider theme={theme}>
        <ComponentProvider overrides={overrides}>{children}</ComponentProvider>
      </AnimusProvider>
    </MDXProvider>
  );
};
