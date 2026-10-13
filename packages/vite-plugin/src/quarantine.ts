/**
 * The `quarantine` option: third-party stylesheets loaded by layergate (an
 * optional peer dependency) into `anm-vendor`, below every Animus layer.
 * Animus runs layergate's hooks from its own, so the plugin stays one
 * object, and delivers layergate's stylesheets from the same modules that
 * deliver its own, ahead of them.
 */
import { ANIMUS_LAYERS } from '@animus-ui/extract/pipeline';


export const VENDOR_LAYER = 'anm-vendor';

/** The module delivering the layer order and the declared sheets. */
export const LAYERGATE_ENTRY_ID = 'virtual:layergate';

/** layergate's options, minus the layer and order Animus fixes. Declared
 *  here, so Animus's types never name the optional peer. */
export interface AnimusQuarantineOptions {
  /** Stylesheets always delivered, in this order, ahead of Animus's own:
   *  package specifiers or paths relative to the Vite root. */
  sheets?: string[];
  /** Also load `.css` a JS module imports from a package other than the
   *  app into `anm-vendor`: `true` for every package, or package names. */
  dependencies?: boolean | string[];
  /** Exact files inside a loaded graph whose own rules stay outside
   *  `anm-vendor`; never globs. */
  optOut?: string[];
}

/** The cascade layer order with `anm-vendor` first, unless it is listed. */
export function withVendorLayer(layers: readonly string[] | undefined): string[] {
  const order = [...(layers ?? ANIMUS_LAYERS)];
  return order.includes(VENDOR_LAYER) ? order : [VENDOR_LAYER, ...order];
}
