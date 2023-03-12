import { useRouter } from 'next/dist/client/router';

import { AppWrapper } from '../components/AppProvider/AppWrapper';
import { Header } from '../components/Header/Header';
import { Layout } from '../components/Layout/Layout';
import { Meta } from '../components/Meta';
import { Sidebar } from '../components/Sidebar/Sidebar';

const App = ({ Component, pageProps, cache }: any) => {
  const { asPath } = useRouter();
  const isDocsPage = asPath !== '/';

  return (
    <AppWrapper cache={cache}>
      <Meta />
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
  );
};

export default App;
