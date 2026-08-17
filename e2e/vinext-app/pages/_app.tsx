import type { ComponentType } from 'react';

import 'virtual:animus/styles.css';

interface VinextAppProps<PageProps extends object> {
  Component: ComponentType<PageProps>;
  pageProps: PageProps;
}

export default function App<PageProps extends object>({
  Component,
  pageProps,
}: VinextAppProps<PageProps>) {
  return <Component {...pageProps} />;
}
