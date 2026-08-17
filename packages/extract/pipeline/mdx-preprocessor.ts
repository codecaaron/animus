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

/**
 * Extensions the ENGINE TRANSFORM may rewrite (distinct from
 * `DEFAULT_EXTENSIONS`, the discovery set: `.mjs` is here so dist-entry
 * kits reach the engine, `.mdx` is not — MDX is preprocessed to `.tsx`
 * before the engine sees it). Matches what the engine's parser accepts —
 * `source_type_for` (crates/extract-v2/src/owned_ast.rs) maps exactly these
 * five suffixes onto tsx/ts/jsx/mjs source types.
 *
 * The single source for EVERY driver's engine-transform file gate — the
 * Turbopack rule glob (`next-plugin/src/turbopack-config.ts`), the webpack
 * loader rule (`next-plugin/src/with-animus.ts`), the Vite transform hook
 * (`vite-plugin/src/transform.ts`), and the unplugin host
 * (`unplugin/src/core.ts`). Independent redeclaration of this set is
 * considered a regression — a missed copy silently skips a whole file class
 * on one bundler family.
 *
 * The set is the file-class gate only; each driver keeps its own
 * module-graph scoping (node_modules exclusion, root containment, admitted
 * external-package dirs) and the manifest lookup remains the file-level
 * authority. Two widenings are deliberate and documented at their sites:
 * unplugin adds `.cjs` for define substitution alone (no engine transform),
 * and Turbopack's rule carries no node_modules condition because Next 15
 * rules have no condition algebra.
 */
export const ENGINE_TRANSFORM_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
] as const;

/** The owner set as a suffix test — the ONE spelling every driver's
 *  file-class gate calls, so no driver can re-derive it and drift. */
const ENGINE_TRANSFORM_RE = new RegExp(
  `\\.(?:${ENGINE_TRANSFORM_EXTENSIONS.join('|')})$`
);

/** Whether `path`'s extension is one the engine transform may rewrite. */
export function isEngineTransformExtension(path: string): boolean {
  return ENGINE_TRANSFORM_RE.test(path);
}

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
