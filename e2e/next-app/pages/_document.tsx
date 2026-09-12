import { Head, Html, Main, NextScript } from 'next/document';

import { appearanceBootstrap } from '../appearance-bootstrap';

/**
 * The plugin injects nothing; the app places the artifact here, and
 * `suppressHydrationWarning` covers the root attribute the snippet sets.
 */
export default function Document() {
  return (
    <Html lang="en" suppressHydrationWarning>
      <Head>
        <script
          data-animus-bootstrap=""
          dangerouslySetInnerHTML={{ __html: appearanceBootstrap.code }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
