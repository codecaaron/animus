/** The layer every stylesheet Animus did not produce is wrapped in: below
 *  every Animus layer, so its normal declarations lose to Animus's. */
export const VENDOR_LAYER = 'anm-vendor';

/**
 * The cascade layer order, outermost first: its one definition. The engine
 * reads it from `crates/extract-v2/src/layer_order.json`, which
 * `scripts/layer-order.ts --write` writes from here.
 */
export const ANIMUS_LAYERS = [
  VENDOR_LAYER,
  'anm-global',
  'anm-base',
  'anm-variants',
  'anm-compounds',
  'anm-states',
  'anm-system',
  'anm-custom',
] as const;

/**
 * A host's `layers` option as the order it declares: a list written before
 * the vendor layer existed takes it first. The vendor layer comes first, and
 * every Animus layer appears in its required order.
 */
export function resolveLayerOrder(layers: readonly string[]): string[] {
  const order = layers.includes(VENDOR_LAYER)
    ? [...layers]
    : [VENDOR_LAYER, ...layers];
  if (order[0] !== VENDOR_LAYER) {
    throw new Error(
      `[animus-extract] Custom layers must start with ${VENDOR_LAYER}, the layer ` +
        `stylesheets Animus did not produce are wrapped in; found ${order[0]} first.`
    );
  }
  validateLayerOrder(order);
  return order;
}

export function validateLayerOrder(layers: string[]): void {
  const expected = [...ANIMUS_LAYERS];

  let cursor = 0;
  for (const layer of layers) {
    if (cursor < expected.length && layer === expected[cursor]) {
      cursor++;
    }
  }
  if (cursor < expected.length) {
    const missing = expected.slice(cursor);
    const found = expected.slice(0, cursor);
    const allPresent = expected.every((l) => layers.includes(l));
    if (!allPresent) {
      const absent = expected.filter((l) => !layers.includes(l));
      throw new Error(
        `[animus-extract] Custom layers missing required layers: ${absent.join(', ')}. ` +
          `All ${expected.length} Animus layers must be present: ${expected.join(', ')}`
      );
    }
    throw new Error(
      `[animus-extract] Custom layers have wrong order. Found ${found.join(', ')} ` +
        `but then expected ${missing[0]}. Required order: ` +
        `(${expected.join(' < ')}). ` +
        `You may interleave custom layers but must preserve this subsequence.`
    );
  }
}

export function stripLeadingLayerDeclaration(css: string): string {
  return css.replace(/^@layer\s+[^;{]+;\s*\n?/, '');
}

export interface AssembleStylesheetParts {
  declaration: string;
  variables: string;
  body: string;
}

export interface AssembleStylesheetOptions {
  layers?: string[];
  variableCss?: string;
  globalCss?: string;
  componentCss?: string;
  split?: boolean;
}

export function assembleStylesheet(
  options: AssembleStylesheetOptions & { split: true }
): AssembleStylesheetParts;
export function assembleStylesheet(
  options: AssembleStylesheetOptions & { split?: false }
): string;
export function assembleStylesheet(
  options: AssembleStylesheetOptions
): string | AssembleStylesheetParts;
export function assembleStylesheet(
  options: AssembleStylesheetOptions
): string | AssembleStylesheetParts {
  const layers = options.layers
    ? resolveLayerOrder(options.layers)
    : ANIMUS_LAYERS;
  const declaration = `@layer ${layers.join(', ')};\n`;
  const variables = options.variableCss || '';

  const componentCss = options.componentCss
    ? stripLeadingLayerDeclaration(options.componentCss)
    : '';

  const bodyParts = [options.globalCss || '', componentCss].filter(Boolean);
  const body = bodyParts.join('\n');

  if (options.split) {
    return { declaration, variables, body };
  }

  const parts = [declaration, variables, body].filter(Boolean);
  return parts.join('\n');
}
