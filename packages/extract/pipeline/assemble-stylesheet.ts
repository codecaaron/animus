/**
 * The 7 Animus cascade layers in required order.
 */
export const ANIMUS_LAYERS = [
  'global',
  'base',
  'variants',
  'compounds',
  'states',
  'system',
  'custom',
] as const;

const DEFAULT_LAYER_DECLARATION = `@layer ${ANIMUS_LAYERS.join(', ')};\n`;

/**
 * Validate that a consumer `layers` array contains all 7 Animus layers
 * in the correct relative order. Consumer layers may be interleaved.
 *
 * @throws Error with descriptive message on violation
 */
export function validateLayerOrder(layers: string[]): void {
  let cursor = 0;
  for (const layer of layers) {
    if (cursor < ANIMUS_LAYERS.length && layer === ANIMUS_LAYERS[cursor]) {
      cursor++;
    }
  }
  if (cursor < ANIMUS_LAYERS.length) {
    const missing = ANIMUS_LAYERS.slice(cursor);
    const found = ANIMUS_LAYERS.slice(0, cursor);
    const allPresent = ANIMUS_LAYERS.every((l) => layers.includes(l));
    if (!allPresent) {
      const absent = ANIMUS_LAYERS.filter((l) => !layers.includes(l));
      throw new Error(
        `[animus-extract] Custom layers missing required layers: ${absent.join(', ')}. ` +
          `All 7 Animus layers must be present: ${ANIMUS_LAYERS.join(', ')}`
      );
    }
    throw new Error(
      `[animus-extract] Custom layers have wrong order. Found ${found.join(', ')} ` +
        `but then expected ${missing[0]}. Required order: ` +
        `(${ANIMUS_LAYERS.join(' < ')}). ` +
        `You may interleave custom layers but must preserve this subsequence.`
    );
  }
}

/**
 * Strip a leading `@layer ...;` declaration line from CSS if present.
 * The Rust crate embeds this in prod-mode output; we strip it so the
 * shared assembler controls placement.
 */
function stripLeadingLayerDeclaration(css: string): string {
  // Match only `@layer name, name;` declarations (no `{` before the `;`)
  return css.replace(/^@layer\s+[^;{]+;\s*\n?/, '');
}

export interface AssembleStylesheetOptions {
  /** Custom layer order. Must contain all 7 Animus layers as a subsequence. */
  layers?: string[];
  /** Variable CSS: `:root { --color-*: ... }` + color mode selectors */
  variableCss?: string;
  /** Global CSS: `@layer global { reset + global styles }` */
  globalCss?: string;
  /** Component CSS from the Rust crate (may contain embedded @layer declaration) */
  componentCss?: string;
}

/**
 * Assemble the final stylesheet in canonical order:
 *
 * 1. `@layer` declaration (cascade ordering)
 * 2. Emitted variables (`:root`, color mode selectors)
 * 3. `@layer global { ... }` (reset + global styles)
 * 4. `@layer base/variants/compounds/states/system/custom { ... }` (components)
 *
 * This is the single source of truth for stylesheet assembly.
 * Both Vite and Next.js plugins must use this function.
 */
export function assembleStylesheet(options: AssembleStylesheetOptions): string {
  let layerDeclaration: string;
  if (options.layers) {
    validateLayerOrder(options.layers);
    layerDeclaration = `@layer ${options.layers.join(', ')};\n`;
  } else {
    layerDeclaration = DEFAULT_LAYER_DECLARATION;
  }

  // Strip any embedded @layer declaration from component CSS (Rust prod output)
  const componentCss = options.componentCss
    ? stripLeadingLayerDeclaration(options.componentCss)
    : '';

  const parts = [
    layerDeclaration,
    options.variableCss || '',
    options.globalCss || '',
    componentCss,
  ].filter(Boolean);

  return parts.join('\n');
}
