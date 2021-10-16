import { AnimusProvider, ColorMode, ComponentProvider, Link } from '@animus/ui';
import { Text } from '@animus/elements';
import { theme } from '@animus/theme';
import { createContext, useState } from 'react';
import NextLink from 'next/link';
import { Theme } from '@emotion/react';
import { Layout } from '../components/Layout';
import { Header } from '../components/Header';
import { MDXProvider } from '@mdx-js/react';
import { Sidebar } from '../components/Sidebar';
import { Content } from '../components/Content';
import { useRouter } from 'next/dist/client/router';

export const AppContext =
  createContext<{ changeMode: (mode: Theme['mode']) => void }>(undefined);

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
  h1: (props) => <Text as="h1" fontFamily="title" mb={16} {...props} />,
  h2: (props) => <Text as="h2" fontFamily="title" mb={16} {...props} />,
  h3: (props) => <Text as="h3" mb={16} {...props} />,
  h4: (props) => <Text as="h4" mb={16} {...props} />,
  h5: (props) => <Text as="h5" mb={16} {...props} />,
  h6: (props) => <Text as="h6" mb={16} {...props} />,
  p: (props) => <Text as="p" mb={16} fontSize={18} {...props} />,
  a: Link,
};

const App = ({ Component, pageProps }: any) => {
  const [mode, changeMode] = useState(theme.mode);

  return (
    <MDXProvider components={components}>
      <header>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="true"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&family=Share+Tech+Mono&display=swap"
          rel="stylesheet"
        />
      </header>
      <AppContext.Provider value={{ changeMode }}>
        <AnimusProvider theme={theme}>
          <ComponentProvider overrides={overrides}>
            <ColorMode mode={mode}>
              <Layout sidebar>
                <Header />
                <Sidebar>Hello World</Sidebar>
                <Content>
                  <Component {...pageProps} />
                </Content>
              </Layout>
            </ColorMode>
          </ComponentProvider>
        </AnimusProvider>
      </AppContext.Provider>
    </MDXProvider>
  );
};

export default App;
