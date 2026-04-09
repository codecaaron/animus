/**
 * The 7 Animus cascade layers. Always prefixed with `anm-` to avoid
 * collision with other frameworks' layer names (e.g., Tailwind's `base`).
 */
export const ANIMUS_LAYERS = [
  'anm-global',
  'anm-base',
  'anm-variants',
  'anm-compounds',
  'anm-states',
  'anm-system',
  'anm-custom',
] as const;

/**
 * Build the `@layer` declaration line.
 *
 * When `isCustom` is false (default layers), uses ANIMUS_LAYERS directly.
 * When `isCustom` is true, passes names through as-is — the consumer already
 * wrote the final names including the `anm-` prefixed entries.
 */
function buildLayerDeclaration(
  layers: readonly string[],
  isCustom?: boolean
): string {
  const names = isCustom ? layers : [...ANIMUS_LAYERS];
  return `@layer ${names.join(', ')};\n`;
}

/**
 * Validate that a consumer `layers` array contains all 7 Animus layers
 * in the correct relative order. Consumer layers may be interleaved.
 *
 * @throws Error with descriptive message on violation
 */
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
          `All 7 Animus layers must be present: ${expected.join(', ')}`
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
  /**
   * Custom layer order. Must contain all 7 Animus `anm-*` layers as a subsequence.
   * Example: `['reset', 'anm-global', 'anm-base', ..., 'anm-custom', 'overrides']`
   * Names are emitted as-is — this is the actual `@layer` declaration.
   */
  layers?: string[];
  /** Variable CSS: `:root { --color-*: ... }` + color mode selectors */
  variableCss?: string;
  /** Global CSS: `@layer anm-global { reset + global styles }` */
  globalCss?: string;
  /** Component CSS from the Rust crate (may contain embedded @layer declaration) */
  componentCss?: string;
}

/**
 * Assemble the final stylesheet in canonical order:
 *
 * 1. `@layer` declaration (cascade ordering)
 * 2. Emitted variables (`:root`, color mode selectors)
 * 3. `@layer anm-global { ... }` (reset + global styles)
 * 4. `@layer anm-base/variants/compounds/states/system/custom { ... }` (components)
 *
 * This is the single source of truth for stylesheet assembly.
 * Both Vite and Next.js plugins must use this function.
 */
export function assembleStylesheet(options: AssembleStylesheetOptions): string {
  const hasCustomLayers = !!options.layers;
  const layers = options.layers ?? ANIMUS_LAYERS;
  if (options.layers) {
    validateLayerOrder(options.layers);
  }
  const layerDeclaration = buildLayerDeclaration(layers, hasCustomLayers);

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
