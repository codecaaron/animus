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

const ANIMUS_LAYER_SET: ReadonlySet<string> = new Set<string>(ANIMUS_LAYERS);

/**
 * Prefix an Animus layer name with dash-separated namespace.
 * Uses dash (not dot) to keep layers flat and interleave-able with other
 * frameworks' layers. Dot notation would create sublayers grouped under
 * a parent, preventing interleaving.
 */
export function prefixLayerName(name: string, prefix?: string): string {
  if (!prefix || !ANIMUS_LAYER_SET.has(name)) return name;
  return `${prefix}-${name}`;
}

/**
 * Build the `@layer` declaration line.
 *
 * When `isCustom` is false (default layers), applies prefix to Animus names.
 * When `isCustom` is true, passes names through as-is — the consumer already
 * wrote the final names including any `{prefix}.{name}` entries.
 */
function buildLayerDeclaration(
  layers: readonly string[],
  prefix?: string,
  isCustom?: boolean
): string {
  const names = isCustom ? layers : layers.map((l) => prefixLayerName(l, prefix));
  return `@layer ${names.join(', ')};\n`;
}

/**
 * Validate that a consumer `layers` array contains all 7 Animus layers
 * in the correct relative order. Consumer layers may be interleaved.
 *
 * When `prefix` is set, the expected Animus layer names are `{prefix}.{name}`
 * (e.g. `acme.base`). This lets consumers write the actual CSS layer names
 * in their config — important when composing with other frameworks that have
 * their own `@layer base` etc.
 *
 * @throws Error with descriptive message on violation
 */
export function validateLayerOrder(
  layers: string[],
  prefix?: string
): void {
  const expected = ANIMUS_LAYERS.map((l) => prefixLayerName(l, prefix));

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
   * Custom layer order. Must contain all 7 Animus layers as a subsequence.
   * When `prefix` is set, use prefixed names: `['reset', 'acme.global', 'acme.base', ...]`.
   * Names are emitted as-is — this is the actual `@layer` declaration.
   */
  layers?: string[];
  /** Namespace prefix — Animus layer names become `{prefix}.{name}` sublayers. */
  prefix?: string;
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
  const hasCustomLayers = !!options.layers;
  const layers = options.layers ?? ANIMUS_LAYERS;
  if (options.layers) {
    validateLayerOrder(options.layers, options.prefix);
  }
  const layerDeclaration = buildLayerDeclaration(
    layers,
    options.prefix,
    hasCustomLayers
  );

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
