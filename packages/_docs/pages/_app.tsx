import NextApp, { AppContext } from 'next/app';
import { useRouter } from 'next/dist/client/router';
import Head from 'next/head';
import { Cookies, CookiesProvider } from 'react-cookie';

import { AppWrapper } from '../components/AppProvider/AppWrapper';
import { Header } from '../components/Header/Header';
import { Layout } from '../components/Layout/Layout';
import { Sidebar } from '../components/Sidebar/Sidebar';

const App = ({ Component, pageProps, cookies }: any) => {
  const { asPath } = useRouter();
  const isDocsPage = asPath !== '/';

  return (
    <CookiesProvider
      cookies={typeof window === 'undefined' ? cookies : undefined}
    >
      <AppWrapper>
        <Head>
          <title>Animus</title>
        </Head>
        <Layout sidebar={isDocsPage}>
          <Layout.Header>
            <Header />
          </Layout.Header>
          {isDocsPage && (
            <Layout.Sidebar>
              <Sidebar />
            </Layout.Sidebar>
          )}
          <Layout.Content>
            <Component {...pageProps} />
          </Layout.Content>
        </Layout>
      </AppWrapper>
    </CookiesProvider>
  );
};

App.getInitialProps = async (appCtx: AppContext) => {
  const appProps = await NextApp.getInitialProps(appCtx);
  const cookies = new Cookies(appCtx.ctx?.req?.headers.cookie || '');

  return {
    ...appProps,
    cookies,
  };
};

export default App;
