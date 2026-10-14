/**
 * The `quarantine` option every Animus host takes: third-party stylesheets
 * loaded by layergate (an optional peer dependency of the host plugins)
 * into `anm-vendor`, below every Animus layer. Declared here, so Animus's
 * types never name the optional peer.
 */
import { ANIMUS_LAYERS } from './assemble-stylesheet';

const VENDOR_LAYER = 'anm-vendor';

/** layergate's options, minus the layer and order Animus fixes. */
export interface AnimusQuarantineOptions {
  /** Stylesheets delivered, in this order, at the head of Animus's own:
   *  package specifiers or paths relative to the app root. */
  sheets?: string[];
  /** Also load `.css` a JS module imports from a package other than the
   *  app into `anm-vendor`: `true` for every package, or package names. */
  dependencies?: boolean | string[];
  /** Exact files inside a loaded graph whose own rules stay outside
   *  `anm-vendor`; never globs. */
  optOut?: string[];
}

/** The cascade layer order with `anm-vendor` first, unless it is listed. */
export function withVendorLayer(
  layers: readonly string[] | undefined
): string[] {
  const order = [...(layers ?? ANIMUS_LAYERS)];
  return order.includes(VENDOR_LAYER) ? order : [VENDOR_LAYER, ...order];
}

/** layergate's options for `quarantine`: owned files go into `anm-vendor`,
 *  which `order` declares first. */
export function layergateOptions(
  options: AnimusQuarantineOptions,
  order: readonly string[]
) {
  return { ...options, layer: VENDOR_LAYER, order };
}

/** The error a host plugin raises when `quarantine` is set and layergate,
 *  its optional peer, is not installed. */
export function layergateMissing(host: string, cause: unknown): Error {
  return new Error(
    '[animus-extract] the `quarantine` option needs @animus-ui/layergate; ' +
      `install it next to ${host}`,
    { cause }
  );
}
