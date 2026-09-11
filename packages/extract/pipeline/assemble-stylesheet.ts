export const ANIMUS_LAYERS = [
  'anm-global',
  'anm-base',
  'anm-variants',
  'anm-compounds',
  'anm-states',
  'anm-system',
  'anm-custom',
] as const;

function buildLayerDeclaration(
  layers: readonly string[],
  isCustom?: boolean
): string {
  const names = isCustom ? layers : [...ANIMUS_LAYERS];
  return `@layer ${names.join(', ')};\n`;
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
  const hasCustomLayers = !!options.layers;
  const layers = options.layers ?? ANIMUS_LAYERS;
  if (options.layers) {
    validateLayerOrder(options.layers);
  }
  const declaration = buildLayerDeclaration(layers, hasCustomLayers);
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
