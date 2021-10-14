import { AnimusProvider, FlexBox } from '@animus/ui';
import { theme } from '@animus/theme';

const App = ({ Component, pageProps }: any) => {
  return (
    <AnimusProvider theme={theme}>
      <FlexBox fit>
        <Component {...pageProps} />
      </FlexBox>
    </AnimusProvider>
  );
};

export default App;
