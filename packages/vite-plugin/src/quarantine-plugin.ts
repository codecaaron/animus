/**
 * layergate's Vite plugin for the `quarantine` option, loaded on first use:
 * layergate is an optional peer. Kept apart from `./quarantine`, whose types
 * Animus publishes, so they never name the peer.
 */
import { VIRTUAL_CSS_ID } from './constants';
import { VENDOR_LAYER, withVendorLayer } from './quarantine';

import type { AnimusQuarantineOptions } from './quarantine';
import type { LayergatePlugin } from '@animus-ui/layergate/vite';

export interface Quarantine {
  /** The layer order, `anm-vendor` first, Animus's stylesheet declares. */
  order: string[];
  /** layergate's plugin, whose hooks Animus's own run. */
  plugin(): Promise<LayergatePlugin>;
}

export function quarantinePlugin(
  options: AnimusQuarantineOptions,
  layers: readonly string[] | undefined
): Quarantine {
  const order = withVendorLayer(layers);
  let plugin: Promise<LayergatePlugin> | undefined;
  return { order, plugin: () => (plugin ??= load(options, order)) };
}

async function load(
  options: AnimusQuarantineOptions,
  order: string[]
): Promise<LayergatePlugin> {
  let layergate;
  try {
    ({ layergate } = await import('@animus-ui/layergate/vite'));
  } catch (cause) {
    throw new Error(
      '[animus-extract] the `quarantine` option needs @animus-ui/layergate; ' +
        'install it next to @animus-ui/vite-plugin',
      { cause }
    );
  }
  // Animus's stylesheet delivers the declared sheets, at its head.
  return layergate({
    ...options,
    layer: VENDOR_LAYER,
    order,
    declaredBy: VIRTUAL_CSS_ID,
  });
}
