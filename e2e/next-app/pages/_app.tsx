import type { AppProps } from 'next/app';

import '../.animus/styles.css';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
