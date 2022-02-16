import NextApp, { AppContext } from 'next/app';
import { useRouter } from 'next/dist/client/router';
import Head from 'next/head';
import { Cookies, CookiesProvider } from 'react-cookie';

import { AppWrapper } from '../components/AppProvider/AppWrapper';
import { Content } from '../components/Content/Content';
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
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="true"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=DM+Mono:ital@0;1&family=Major+Mono+Display&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap"
            rel="stylesheet"
          />
        </Head>
        <Layout sidebar={isDocsPage}>
          <Header />
          {isDocsPage && <Sidebar />}
          <Content>
            <Component {...pageProps} />
          </Content>
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
