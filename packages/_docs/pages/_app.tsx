import { AnimusProvider } from '@animus/ui';
import { theme } from '@animus/theme';

const App = ({ Component, pageProps }: any) => {
  return (
    <AnimusProvider theme={theme}>
      <Component {...pageProps} />
    </AnimusProvider>
  );
};

export default App;
