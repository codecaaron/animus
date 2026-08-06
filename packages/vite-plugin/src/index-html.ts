import { BRIDGE_SCRIPT_SRC } from './constants';

import type { PluginContext } from './context';
import type { HtmlTagDescriptor } from 'vite';

/**
 * transformIndexHtml: build the head-prepend tag set.
 *
 * Three independent tags, all delivery-only:
 * - the appearance bootstrap script, when the host build passed a
 *   pre-generated artifact via `appearanceBootstrap` (absent otherwise);
 * - the `@layer` declaration style, when `buildStart` computed one;
 * - the HMR bridge module script, in dev only.
 *
 * The two build-time branches are guarded on non-empty CONTENT, not on mere
 * presence: an artifact whose `code` is empty is a caller defect, and emitting
 * `<script data-animus-bootstrap></script>` for it would break the
 * unconfigured-parity contract in spirit (a tag that does nothing) while
 * hiding the defect. Symmetric with `layerDeclaration`. The bridge has no
 * content of its own — it is a `src` reference — so its only guard is the mode.
 *
 * Ordering: every descriptor rides the same `head-prepend` bucket, which Vite
 * serializes in array order (`serializeTags`) and splices in immediately after
 * `<head>`. The bootstrap script is therefore FIRST in the array so it runs
 * before the layer declaration and — since built stylesheet links are appended
 * at `</head>` — before any stylesheet reference.
 *
 * With neither build-time input set, a production build emits no tag,
 * attribute, or whitespace of its own.
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

  // The HMR bridge, dev only (openspec: dev-stylesheet-management, "HMR bridge
  // auto-injected in dev mode" / "Bridge absent in prod build").
  //
  // Unconditional in dev, and deliberately NOT gated on `storedSheets`:
  // index.html can be served before the first analysis completes, and a
  // document that missed the tag has no adopted stylesheet for the life of the
  // page. The bridge body is generated at request time and dedupes its
  // `CSSStyleSheet` behind a `globalThis` key, so an early load is safe —
  // it adopts whatever CSS exists and takes updates from
  // `virtual:animus/components.js` afterwards.
  //
  // Position: last in the array, i.e. after the bootstrap and the layer
  // declaration in the document. A `type="module"` script is deferred, so it
  // cannot delay the inline classic bootstrap; what the ordering buys is that a
  // HEAD module script evaluates before the BODY entry module, so the adopted
  // stylesheet exists before any component module runs.
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
