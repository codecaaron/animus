import { BRIDGE_SCRIPT_SRC } from './constants';

import type { PluginContext } from './context';
import type { HtmlTagDescriptor } from 'vite';

/**
 * Vite serializes one `head-prepend` bucket in array order, so the bootstrap
 * script precedes the layer declaration and every stylesheet reference.
 */
export function buildIndexHtmlTags(ctx: PluginContext): HtmlTagDescriptor[] {
  const tags: HtmlTagDescriptor[] = [];

  const bootstrap = ctx.options.appearanceBootstrap;
  if (bootstrap?.code) {
    tags.push({
      tag: 'script',
      attrs: { 'data-animus-bootstrap': '' },
      children: bootstrap.code,
      injectTo: 'head-prepend',
    });
  }

  if (ctx.layerDeclaration) {
    tags.push({
      tag: 'style',
      attrs: { 'data-animus-layers': '' },
      children: ctx.layerDeclaration,
      injectTo: 'head-prepend',
    });
  }

  // Dev only, never gated on `storedSheets`: index.html can be served before
  // the first analysis, and a document missing the tag stays unstyled.
  if (!ctx.isProd) {
    tags.push({
      tag: 'script',
      attrs: {
        type: 'module',
        src: BRIDGE_SCRIPT_SRC,
        'data-animus-bridge': '',
      },
      injectTo: 'head-prepend',
    });
  }

  return tags;
}
