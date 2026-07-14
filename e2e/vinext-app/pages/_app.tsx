import type { ComponentType } from 'react';

import 'virtual:animus/styles.css';

export default function App({
  Component,
  pageProps,
}: {
  Component: ComponentType<Record<string, unknown>>;
  pageProps: Record<string, unknown>;
}) {
  return <Component {...pageProps} />;
}
