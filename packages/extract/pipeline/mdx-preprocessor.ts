/**
 * MDX compiled to scanner-consumable JSX, plus the extension sets every
 * driver imports. `@mdx-js/mdx` is an optional peer, so its import is lazy.
 */

export const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mdx',
] as const;

export type DefaultExtension = (typeof DEFAULT_EXTENSIONS)[number];

/**
 * The one engine-transform file gate every driver imports — the suffixes the
 * engine's parser accepts. `.mdx` is preprocessed to `.tsx` before it.
 */
export const ENGINE_TRANSFORM_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
] as const;

const ENGINE_TRANSFORM_RE = new RegExp(
  `\\.(?:${ENGINE_TRANSFORM_EXTENSIONS.join('|')})$`
);

export function isEngineTransformExtension(path: string): boolean {
  return ENGINE_TRANSFORM_RE.test(path);
}

export interface PreprocessMdxResult {
  kind: 'ok' | 'missing-dep' | 'error';
  /** Present when `kind` is `'ok'`. */
  source?: string;
  /** Present when `kind` is `'error'`. */
  error?: string;
}

/**
 * Compile MDX to scanner-consumable JSX. `missing-dep` means the consumer
 * must install `@mdx-js/mdx`; hosts warn and skip the file on `error`.
 */
export async function preprocessMdx(
  source: string,
  filename: string
): Promise<PreprocessMdxResult> {
  const mdxMod = await import('@mdx-js/mdx').catch(() => null);
  if (mdxMod === null) {
    return { kind: 'missing-dep' };
  }

  try {
    const vfile = await mdxMod.compile(source, {
      // `program` emits static `import` statements; the import resolver
      // tracks only those, so MDX bindings resolve as `.tsx` ones do.
      outputFormat: 'program',
      development: false,
      // Keep JSX element syntax: the scanner recognizes element tags and
      // member expressions, not `_jsx(...)` factory calls.
      jsx: true,
    });
    const jsxSource = `/* @mdx-source: ${filename} */\n${String(vfile)}`;
    return { kind: 'ok', source: jsxSource };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { kind: 'error', error };
  }
}
