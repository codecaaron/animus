/**
 * layergate's webpack plugin for the `quarantine` option, loaded on first
 * use: layergate is an optional peer. Only the client compiler builds
 * stylesheets, so only it gets one.
 */
import {
  layergateMissing,
  layergateOptions,
} from '@animus-ui/extract/pipeline';
import { createRequire } from 'module';

import type { AnimusQuarantineOptions } from '@animus-ui/extract/pipeline';
import type { LayergatePlugin } from '@animus-ui/layergate/webpack';

/** The error Turbopack meets: it runs no loader on a stylesheet's
 *  imports, so layergate cannot load a graph there. */
export const QUARANTINE_TURBOPACK_MESSAGE =
  '[animus-extract] the `quarantine` option needs webpack: Turbopack runs ' +
  'no loader on the stylesheets a stylesheet imports, so it cannot keep ' +
  'them in `anm-vendor`. Run `next build --webpack` and `next dev --webpack`, ' +
  'or remove `quarantine` [layergate.turbopack]';

export function quarantinePlugin(
  options: AnimusQuarantineOptions,
  order: readonly string[],
  declaredBy: string
): LayergatePlugin {
  let layergate: typeof import('@animus-ui/layergate/webpack');
  try {
    layergate = createRequire(import.meta.url)('@animus-ui/layergate/webpack');
  } catch (cause) {
    throw layergateMissing('@animus-ui/next-plugin', cause);
  }
  // Animus's stylesheet delivers the declared sheets, at its head, and
  // Animus's watch matcher asks `watches`.
  return new layergate.LayergatePlugin({
    ...layergateOptions(options, order),
    declaredBy,
    watchIgnored: false,
  });
}
