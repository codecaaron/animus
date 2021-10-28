import { Layout } from '../components/Layout';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { Content } from '../components/Content';
import { AppWrapper } from '../components/AppWrapper';
import { useRouter } from 'next/dist/client/router';

const App = ({ Component, pageProps }: any) => {
  const { asPath } = useRouter();
  const isDocsPage = asPath !== '/';

  console.log(isDocsPage);
  return (
    <AppWrapper>
      <header>
        <title>Animus</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="true"
        />
        <link
          rel="prefetch"
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&family=Share+Tech+Mono&display=swap"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&family=Share+Tech+Mono&display=swap"
          rel="stylesheet"
        />
      </header>
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
