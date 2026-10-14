/**
 * The font preloads the system's faces ask for (`preload: true`), rendered
 * into the document. Server-only; it imports neither the engine nor Node.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement } from 'react';
import { preconnect, preload } from 'react-dom';

import preloads from 'virtual:animus/font-preloads';

/** The origins of the absolute hrefs, once each: an asset prefix on
 *  another host makes the bundler's URLs absolute. `fontPreloadOrigins`'s
 *  rule, restated: its module would bring the engine into the bundle. A
 *  malformed href warms no origin, and never fails the render. */
const ORIGINS = [
  ...new Set(
    preloads.flatMap(({ href }) => {
      if (!/^(?:https?:)?\/\//i.test(href)) return [];
      try {
        const url = new URL(href, 'https://animus.invalid');
        return [href.startsWith('//') ? `//${url.host}` : url.origin];
      } catch {
        return [];
      }
    })
  ),
];

/**
 * App Router: render it in the root layout. React hoists each preload into
 * `<head>` ahead of the stylesheets and dedupes it by href, against
 * `next/font` too. Renders nothing; a no-op when no face preloads.
 */
export function AnimusFontPreloads(): null {
  for (const origin of ORIGINS) preconnect(origin, { crossOrigin: '' });
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
    ...ORIGINS.map((origin) =>
      createElement('link', {
        key: origin,
        rel: 'preconnect',
        href: origin,
        crossOrigin: '',
      })
    ),
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
