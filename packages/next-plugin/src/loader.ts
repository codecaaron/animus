import { relative } from 'path';

import { getManifestJson } from './singleton';

type LoaderContext = {
  resourcePath: string;
  rootContext: string;
  getOptions: () => { strict?: boolean };
};

/**
 * Webpack loader for Animus source transformation.
 * Runs with enforce: 'pre' to see original source before Babel/SWC.
 * Replaces builder chains with createComponent() calls using the pre-built manifest.
 */
export default function animusLoader(
  this: LoaderContext,
  source: string
): string {
  const manifestJson = getManifestJson();
  if (!manifestJson) return source;

  const filename = relative(this.rootContext, this.resourcePath);

  try {
    const { transformFile } = require('@animus-ui/extract');
    const result = transformFile(source, filename, manifestJson);

    if (!result.hasComponents) return source;
    return result.code;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const opts = this.getOptions?.() ?? {};

    if (opts.strict) {
      throw new Error(
        `[animus-extract] Transform failed for ${filename}: ${msg}`
      );
    }

    console.warn(`[animus-extract] Transform failed for ${filename}:`, msg);
    return source;
  }
}
