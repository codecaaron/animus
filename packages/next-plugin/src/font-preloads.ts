/**
 * The font preloads the system's faces ask for (`preload: true`, or the
 * `fontPreloads` option), rendered into the document. Server-only; it
 * imports neither the engine nor Node.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement } from 'react';
import { preload } from 'react-dom';

import preloads from 'virtual:animus/font-preloads';

/**
 * App Router: render it in the root layout. React hoists each preload into
 * `<head>` ahead of the stylesheets and dedupes it by href, against
 * `next/font` too. Renders nothing; a no-op when no face preloads.
 */
export function AnimusFontPreloads(): null {
  for (const { href, type } of preloads) {
    preload(href, { as: 'font', type, crossOrigin: '' });
  }
  return null;
}

/**
 * Pages Router: render it inside `<Head>` in `pages/_document`, as plain
 * `<link>` tags any React version renders. Empty when no face preloads.
 */
export function AnimusFontPreloadLinks(): ReactElement {
  return createElement(
    Fragment,
    null,
    ...preloads.map(({ href, type }) =>
      createElement('link', {
        key: href,
        rel: 'preload',
        href,
        as: 'font',
        type,
        crossOrigin: '',
      })
    )
  );
}
