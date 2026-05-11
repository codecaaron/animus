/**
 * MDX source preprocessor for the extraction pipeline.
 *
 * MDX files are first-class consumers of ds-built components but are not
 * directly parseable by OXC (which the scanner uses for .tsx/.jsx). This
 * module compiles MDX sources to scanner-consumable JSX using @mdx-js/mdx.
 *
 * @mdx-js/mdx is declared as `peerDependenciesMeta.optional` on the
 * plugin packages that import this module. The dynamic import with
 * .catch() ensures non-MDX consumers (who configure `extensions` to
 * exclude .mdx) never trigger the resolution — zero install-footprint
 * cost for them.
 *
 * The `DEFAULT_EXTENSIONS` constant is the shared source of truth for
 * both `@animus-ui/vite-plugin` and `@animus-ui/next-plugin`. Each plugin
 * imports it directly; independent redeclaration of default extensions
 * is considered a regression.
 */

export const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mdx',
] as const;

export type DefaultExtension = (typeof DEFAULT_EXTENSIONS)[number];

export interface PreprocessMdxResult {
  kind: 'ok' | 'missing-dep' | 'error';
  /** Preprocessed JSX source. Present when kind === 'ok'. */
  source?: string;
  /** Error message. Present when kind === 'error'. */
  error?: string;
}

/**
 * Preprocess an MDX source string into scanner-consumable JSX.
 *
 * - Returns `{ kind: 'ok', source }` with JSX-compiled output on success.
 * - Returns `{ kind: 'missing-dep' }` if @mdx-js/mdx is not resolvable
 *   (consumer needs to install it).
 * - Returns `{ kind: 'error', error }` on compile failure (e.g. malformed
 *   MDX syntax). Plugins SHALL warn + skip affected files; the build
 *   continues with remaining files.
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
      // `program` produces a full ESM module with static `import` statements
      // (rather than `function-body`'s `await import(...)` dynamic form).
      // Static imports are what the animus import resolver tracks, so MDX-
      // imported component bindings resolve to their origin module's active
      // props, matching .tsx semantics.
      outputFormat: 'program',
      development: false,
      // Preserve JSX element syntax (`<Component>`) instead of compiling to
      // `_jsx(Component, ...)` factory calls. The animus JSX scanner recognizes
      // JSX element tags and member expressions but not the jsx-runtime factory
      // call form; this option ensures MDX-rendered components remain visible
      // to scanner element-recognition.
      jsx: true,
    });
    const jsxSource = `/* @mdx-source: ${filename} */\n${String(vfile)}`;
    return { kind: 'ok', source: jsxSource };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { kind: 'error', error };
  }
}
