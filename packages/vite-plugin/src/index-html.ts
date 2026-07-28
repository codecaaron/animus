import type { PluginContext } from './context';
import type { HtmlTagDescriptor } from 'vite';

/**
 * transformIndexHtml: build the head-prepend tag set.
 *
 * Two independent tags, both delivery-only:
 * - the appearance bootstrap script, when the host build passed a
 *   pre-generated artifact via `appearanceBootstrap` (absent otherwise);
 * - the `@layer` declaration style, when `buildStart` computed one.
 *
 * Both branches are guarded on non-empty CONTENT, not on mere presence: an
 * artifact whose `code` is empty is a caller defect, and emitting
 * `<script data-animus-bootstrap></script>` for it would break the
 * unconfigured-parity contract in spirit (a tag that does nothing) while
 * hiding the defect. Symmetric with `layerDeclaration`.
 *
 * Ordering: every descriptor rides the same `head-prepend` bucket, which Vite
 * serializes in array order (`serializeTags`) and splices in immediately after
 * `<head>`. The bootstrap script is therefore FIRST in the array so it runs
 * before the layer declaration and — since built stylesheet links are appended
 * at `</head>` — before any stylesheet reference.
 *
 * When neither input is set the array is empty, so an unconfigured build emits
 * no tag, attribute, or whitespace of its own.
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

  return tags;
}
