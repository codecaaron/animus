import { relative } from 'path';

import { transformWithManifest } from './loader-core';
import { engineApi, getManifestJson } from './singleton';

import type { LoaderPolicyOptions } from './loader-core';

type LoaderContext = {
  resourcePath: string;
  rootContext: string;
  getOptions: () => LoaderPolicyOptions;
};

/**
 * Webpack loader for Animus source transformation.
 * Runs with enforce: 'pre' to see original source before Babel/SWC.
 * The manifest arrives via the process singleton (the webpack pipeline and
 * this loader share one process); the transform + CSS-import policy lives
 * in the shared loader-core.
 */
export default function animusLoader(
  this: LoaderContext,
  source: string
): string {
  const manifestJson = getManifestJson();
  if (!manifestJson) return source;

  const filename = relative(this.rootContext, this.resourcePath);
  return transformWithManifest({
    source,
    filename,
    manifestJson,
    engineApi,
    opts: this.getOptions?.() ?? {},
  });
}
