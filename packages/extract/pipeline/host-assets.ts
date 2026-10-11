import { createRequire } from 'node:module';

import {
  BUILT_IN_ASSET_SOURCE,
  BUILT_IN_ASSET_TYPES,
  BUILT_IN_STYLESHEET_TYPES,
} from './built-in-asset-types';

/** Which files a host loads as opaque values (spec §2.2 A8): an asset, or a
 *  stylesheet, with no JS exports or effects on app objects (a CSS module's
 *  class-name map is opaque data). An opaque file the host opens is
 *  Resolved(asset). Where the host's reading is uncertain, a file is not
 *  opaque. */
export interface HostAssetClassification {
  /** Whether the host loads `file`, requested with `query` (`''`, or the
   *  specifier's `?…`), as an opaque value. */
  isAsset(file: string, query: string): boolean;
  /** Where the classification comes from: the host's captured option, or
   *  `built-in` with the reason (`noHost`, `hostOptionUnreadable`). */
  readonly resolverVersion: string;
}

const BUILT_IN_ASSET_RE = new RegExp(
  `\\.(?:${BUILT_IN_ASSET_TYPES.join('|')})$`,
  'i'
);

/** Vite's stylesheet test (`isCSSRequest`), on the final extension only: a
 *  `x.css.ts` is a module. Exact case, as Vite reads it. */
const STYLESHEET_RE = new RegExp(
  `\\.(?:${BUILT_IN_STYLESHEET_TYPES.join('|')})$`
);

/** The queries Vite answers with a string whatever the file holds: `?url`
 *  and `?raw`. Any other query keeps the file's own reading. */
const VITE_OPAQUE_QUERY_RE = /[?&](?:url|raw)\b/;

/** The built-in classification, where no host's can be read or is not
 *  modelled (webpack's and Rspack's rules, as a conditional rule may never
 *  apply): Vite's known asset types, less `svg`, and its CSS languages
 *  (`BUILT_IN_ASSET_SOURCE`), read with Vite's queries. */
export function builtInAssetClassification(
  reason: 'noHost' | 'hostOptionUnreadable',
  detail?: string
): HostAssetClassification {
  return {
    isAsset: (file, query) =>
      VITE_OPAQUE_QUERY_RE.test(query) ||
      BUILT_IN_ASSET_RE.test(file) ||
      STYLESHEET_RE.test(file),
    resolverVersion: `built-in (${reason}${detail ? `: ${detail}` : ''}; ${BUILT_IN_ASSET_SOURCE})`,
  };
}

/** Vite's own classification: `?url` and `?raw`, its known asset types and
 *  the user's `assetsInclude`, as `ResolvedConfig.assetsInclude` answers,
 *  and its CSS languages (`isCSSRequest`). */
export function viteAssetClassification(
  assetsInclude: (file: string) => boolean,
  version?: string
): HostAssetClassification {
  return {
    isAsset: (file, query) =>
      VITE_OPAQUE_QUERY_RE.test(query) ||
      assetsInclude(file) ||
      STYLESHEET_RE.test(file),
    resolverVersion: `${version ? `vite@${version}` : 'vite'} captured`,
  };
}

/** esbuild's built-in loaders, which a configured `loader` map extends. */
const ESBUILD_DEFAULT_LOADERS = {
  '': 'js',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  '.ts': 'ts',
  '.cts': 'ts',
  '.mts': 'ts',
  '.tsx': 'tsx',
  '.css': 'css',
  '.module.css': 'local-css',
  '.json': 'json',
  '.txt': 'text',
} satisfies Readonly<Record<string, string>>;

/** esbuild loaders whose module is an opaque value: a URL, the file's bytes
 *  or text, or a stylesheet. `copy` keeps the file as code. */
const ESBUILD_OPAQUE_LOADERS = new Set([
  'file',
  'dataurl',
  'base64',
  'binary',
  'text',
  'css',
  'local-css',
  'global-css',
]);

/** esbuild's classification, from its `loader` map: the loader esbuild
 *  picks for a file is the longest extension of its name the map holds,
 *  exact case. */
export function esbuildAssetClassification(
  loader: Readonly<Record<string, string>> | undefined
): HostAssetClassification {
  const loaders = new Map(
    Object.entries({ ...ESBUILD_DEFAULT_LOADERS, ...loader })
  );
  return {
    isAsset: (file) => {
      let name = file.slice(
        Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1
      );
      let picked = name.includes('.') ? undefined : loaders.get('');
      for (let dot = name.indexOf('.'); dot !== -1; dot = name.indexOf('.')) {
        picked = loaders.get(name.slice(dot));
        if (picked !== undefined) break;
        name = name.slice(dot + 1);
      }
      return picked !== undefined && ESBUILD_OPAQUE_LOADERS.has(picked);
    },
    resolverVersion: 'esbuild captured',
  };
}

/** Turbopack's classification under Next: Next's static-image table
 *  (`nextImageLoaderRegex`), unless `images.disableStaticImages`, and its
 *  stylesheets (`regexLikeCss`), as the installed `next` declares them.
 *  Built-in where Next cannot be read. */
export function nextImageAssetClassification(
  rootDir: string,
  disableStaticImages: boolean
): HostAssetClassification {
  try {
    const require = createRequire(`${rootDir}/package.json`);
    const { version } = require('next/package.json');
    const { nextImageLoaderRegex } = require('next/dist/build/webpack-config');
    const {
      regexLikeCss,
    } = require('next/dist/build/webpack/config/blocks/css');
    if (
      !(nextImageLoaderRegex instanceof RegExp) ||
      !(regexLikeCss instanceof RegExp)
    ) {
      return builtInAssetClassification(
        'hostOptionUnreadable',
        `next@${version} image and stylesheet types`
      );
    }
    return {
      isAsset: (file) =>
        regexLikeCss.test(file) ||
        (!disableStaticImages && nextImageLoaderRegex.test(file)),
      resolverVersion: `from next@${version}`,
    };
  } catch {
    return builtInAssetClassification('hostOptionUnreadable', 'next');
  }
}
