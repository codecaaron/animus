import { Layout } from '../components/Layout/Layout';
import Head from 'next/head';
import { Header } from '../components/Header/Header';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { Content } from '../components/Content/Content';
import { AppWrapper } from '../components/AppProvider/AppWrapper';
import { useRouter } from 'next/dist/client/router';

const App = ({ Component, pageProps }: any) => {
  const { asPath } = useRouter();
  const isDocsPage = asPath !== '/';

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
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Major+Mono+Display&family=PT+Mono&display=swap"
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
  );
};

export default App;
