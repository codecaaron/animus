import { Head, Html, Main, NextScript } from 'next/document';

import { appearanceBootstrap } from '../appearance-bootstrap';

/**
 * Application-owned bootstrap placement (openspec: system-color-scheme, D6).
 *
 * The Animus Next plugin injects no script of its own — the app places the
 * artifact itself, which is what makes a static-hash CSP or a per-request nonce
 * possible without the plugin knowing anything about appearance.
 *
 * Placement: as a child of `<Head>`. Next renders `_document`'s head children
 * BEFORE `getCssLinks()` (see `next/dist/pages/_document.js` — `children` is
 * emitted ahead of `!optimizeCss && this.getCssLinks(files)`), so the snippet
 * runs before the first stylesheet is even requested. `scripts/assert-build.ts`
 * asserts that ordering on the emitted HTML rather than trusting it.
 *
 * `suppressHydrationWarning` on `<Html>` is required, not cosmetic: the snippet
 * mutates `data-color-mode` on the root element between SSR and hydration, so
 * the client tree legitimately disagrees with the server markup on exactly that
 * attribute.
 *
 * This is the PAGES router document. The App Router (`app/layout.tsx`) is
 * intentionally left without a bootstrap: it is this build's live negative
 * witness for "the Next.js plugin SHALL NOT inject the bootstrap script", and
 * the assert script proves the App Router HTML carries no bootstrap marker.
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
