import { Layout } from '../components/Layout/Layout';
import Head from 'next/head';
import { Header, ThemeControlContext } from '../components/Header/Header';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { Content } from '../components/Content/Content';
import { AppWrapper } from '../components/AppProvider/AppWrapper';
import { useRouter } from 'next/dist/client/router';
import { ColorModes, ColorMode } from '@animus/ui';
import { useMemo, useState } from 'react';

const App = ({ Component, pageProps }: any) => {
  const { asPath } = useRouter();
  const isDocsPage = asPath !== '/';
  const [mode, setCurrentMode] = useState<ColorModes>('dark');
  const context = useMemo(
    () => ({
      onChangeMode: () =>
        setCurrentMode((prev) => (prev === 'light' ? 'dark' : 'light')),
    }),
    [setCurrentMode]
  );
  return (
    <AppWrapper>
      <Head>
        <title>Animus</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="shortcut icon" href="/favicon-64.png" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="true"
        />
        <link
          rel="prefetch"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Major+Mono+Display&family=PT+Mono&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Major+Mono+Display&family=PT+Mono&display=swap"
        />
      </Head>
      <ThemeControlContext.Provider value={context}>
        <ColorMode mode={mode}>
          <Layout sidebar={isDocsPage}>
            <Header />
            {isDocsPage && <Sidebar />}
            <Content>
              <Component {...pageProps} />
            </Content>
          </Layout>
        </ColorMode>
      </ThemeControlContext.Provider>
    </AppWrapper>
  );
};

export default App;
