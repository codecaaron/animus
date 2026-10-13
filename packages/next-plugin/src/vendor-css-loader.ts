import {
  createVendorReporter,
  vendorCssUnit,
} from '@animus-ui/extract/pipeline';
import { getStylesheetPlan, sessionKey } from '@animus-ui/extract/session';
import { relative, sep } from 'path';

import type { DiagnosticLevels } from '@animus-ui/extract/pipeline';

interface VendorCssLoaderOptions {
  /** The real path of the app's `.animus` directory: every stylesheet in
   *  it is Animus's own, and stays as it is. */
  animusArtifacts: string;
  /** The build and root whose session publishes the stylesheet plan. */
  build: string;
  root: string;
  strict?: boolean;
  diagnostics?: DiagnosticLevels;
}

/** The source map the previous loader handed on, passed through as is:
 *  every line keeps its number. */
interface RawSourceMap {
  version: number;
  sources: string[];
  mappings: string;
}
type IncomingMap = string | RawSourceMap;

interface VendorCssLoaderContext {
  resourcePath: string;
  getOptions(): VendorCssLoaderOptions;
  callback(error: Error | null, code?: string, map?: IncomingMap): void;
}

/** A file's diagnostics print once per content, across compilers. */
let report: ReturnType<typeof createVendorReporter> | null = null;
const keys = new Map<string, ReturnType<typeof sessionKey>>();

/**
 * Wraps one CSS unit Animus did not produce into the vendor layer. Next's
 * CSS rules run it after PostCSS (or Sass) and before css-loader, so it
 * reads each unit's compiled CSS while `@import`s are still requests:
 * css-loader loads each imported file as a unit of its own, wrapped in turn,
 * and a CSS Module is wrapped before css-loader mints its class names.
 * Lines keep their numbers, so the incoming map still holds.
 */
export default function vendorCssLoader(
  this: VendorCssLoaderContext,
  source: string,
  map?: IncomingMap
): void {
  const options = this.getOptions();
  const file = this.resourcePath;
  if (file.startsWith(options.animusArtifacts + sep)) {
    this.callback(null, source, map);
    return;
  }
  report ??= createVendorReporter((line) => console.warn(`[animus] ${line}`), {
    levels: options.diagnostics,
    strict: options.strict,
  });
  const keyId = `${options.build}\0${options.root}`;
  let key = keys.get(keyId);
  if (key === undefined) {
    key = sessionKey(options.build, options.root);
    keys.set(keyId, key);
  }
  const code = vendorCssUnit(
    source,
    file,
    relative(options.root, file),
    getStylesheetPlan(key),
    'keep',
    report
  );
  this.callback(null, code, map);
}
