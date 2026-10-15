import { componentValues, tokenize } from '@animus-ui/properties';

import { ANIMUS_LAYERS } from './assemble-stylesheet';
import { contentHash } from './content-hash';

/**
 * How a host delivers Animus's stylesheet: `'single'`, one file, or
 * `'split'`, the same bytes cut into consecutive files a document links in
 * order, so a file whose content an edit leaves alone keeps its cached copy.
 */
export type StylesheetDelivery = 'single' | 'split';

/**
 * The files of a split stylesheet, in link order, as the sheet emits them:
 * the layer declaration, theme variables and color modes, `@property`
 * registrations and `anm-global` (resets, `@font-face`, keyframes), with any
 * vendor layer; the component layers, base through states; then the
 * utility layers, `anm-system` and `anm-custom`.
 */
export const STYLESHEET_SLICES = [
  'foundation',
  'components',
  'utilities',
] as const;

export type StylesheetSlice = (typeof STYLESHEET_SLICES)[number];

/** The slice, by index, each Animus layer after `anm-global` opens: the
 *  component layers up to `anm-system`, then the utility layers. */
const SLICE_OPENED_BY_LAYER: ReadonlyMap<string, number> = new Map(
  ANIMUS_LAYERS.slice(1).map((layer, index, layers) => [
    layer,
    index < layers.indexOf('anm-system') ? 1 : 2,
  ])
);

/**
 * `css` cut into its slices, each the text from where it opens to where the
 * next opens, so the slices concatenated in order are `css` byte for byte. A
 * slice opens at the first top-level `@layer` block of a layer it holds;
 * one with no such layer is empty. A layer met after a later slice opened
 * stays in the open slice: the cut never reorders the sheet.
 */
export function splitStylesheet(
  css: string
): Array<{ slice: StylesheetSlice; css: string }> {
  // cuts[i] is where slice i opens; a slice not yet open starts at the end.
  const cuts = [0, css.length, css.length, css.length];
  let open = 0;
  const values = componentValues(tokenize(css)).filter(
    (value) => value.kind === 'block' || value.token.type !== 'whitespace'
  );
  for (const [index, value] of values.entries()) {
    const name = values[index + 1];
    const block = values[index + 2];
    if (
      value.kind !== 'token' ||
      value.token.type !== 'at-keyword' ||
      value.token.value !== 'layer' ||
      name?.kind !== 'token' ||
      name.token.type !== 'ident' ||
      block?.kind !== 'block' ||
      block.open.type !== '{'
    ) {
      continue;
    }
    const slice = SLICE_OPENED_BY_LAYER.get(name.token.value) ?? 0;
    if (slice > open) {
      cuts.fill(value.start, open + 1, slice + 1);
      open = slice;
    }
  }
  return STYLESHEET_SLICES.map((slice, index) => ({
    slice,
    css: css.slice(cuts[index], cuts[index + 1]),
  }));
}

/**
 * The files a host publishes beside its stylesheet `<stem>.css`, in link
 * order: each non-empty slice as `<stem>.<slice>.<hash>.css`, named by its
 * content, so a slice an edit leaves alone keeps its name.
 */
export function stylesheetSliceFiles(
  css: string,
  stem: string
): Array<{ name: string; css: string }> {
  return splitStylesheet(css)
    .filter((slice) => slice.css !== '')
    .map((slice) => ({
      name: `${stem}.${slice.slice}.${contentHash(slice.css).slice(0, 8)}.css`,
      css: slice.css,
    }));
}
