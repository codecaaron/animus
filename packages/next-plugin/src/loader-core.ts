/**
 * Bundler-neutral loader policy shared by the webpack loader (manifest from
 * the process singleton) and the Turbopack loader (manifest hydrated from
 * disk artifacts). Owns the transform invocation, strict-mode error
 * handling, and the single-stylesheet-import policy.
 */

export interface LoaderPolicyOptions {
  strict?: boolean;
  cssImportTarget?: string;
}

/**
 * Regex matching CSS import lines injected by the Rust emitter.
 * Catches both the alias form (`import '.animus/styles.css'`),
 * relative forms (`import '../.animus/styles.css'`), and the Vite
 * virtual module form (`import 'virtual:animus/styles.css'`) which
 * appears in pre-built external packages compiled with the Vite plugin.
 */
const CSS_IMPORT_RE =
  /import\s+['"](?:[^'"]*\.animus\/styles\.css|virtual:animus\/styles\.css)['"];\n?/g;

/**
 * Default root entry file patterns. CSS is imported ONLY in the root entry
 * to prevent per-chunk duplication in Next.js builds.
 *
 * - App Router: `app/layout.tsx` (root layout wraps all routes)
 * - Pages Router: `pages/_app.tsx` (custom App wraps all pages)
 *
 * The `(src\/)?` prefix handles projects that use a `src/` directory.
 * Projects whose root entry doesn't match (nested layouts, monorepo roots)
 * set the `cssImportTarget` plugin option, which replaces this detection.
 */
const ROOT_ENTRY_RE = /^(src\/)?(?:app\/layout|pages\/_app)\.[tj]sx?$/;

/** Normalize separators and strip a leading './' for path comparison. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Decide whether `filename` (project-root-relative) is the file that
 * receives the single CSS import. An explicit `cssImportTarget` replaces
 * the default filename-convention detection. Separators are normalized
 * first — Windows `relative()` yields backslashes the patterns would miss.
 */
function isCssImportTarget(
  filename: string,
  cssImportTarget: string | undefined
): boolean {
  const normalized = normalizePath(filename);
  if (cssImportTarget) {
    return normalized === normalizePath(cssImportTarget);
  }
  return ROOT_ENTRY_RE.test(normalized);
}

/**
 * Transform one source file against a manifest: replace builder chains via
 * the engine, strip emitter-injected stylesheet imports everywhere, and
 * re-inject a single import at the root entry (after any leading
 * `'use client'` directive). On failure: throw in strict mode, otherwise
 * warn and return the source unchanged.
 */
export function transformWithManifest(args: {
  source: string;
  /** Project-root-relative path of the file being transformed. */
  filename: string;
  manifestJson: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engineApi: () => any;
  opts: LoaderPolicyOptions;
}): string {
  const { source, filename, manifestJson, engineApi, opts } = args;
  const isRootEntry = isCssImportTarget(filename, opts.cssImportTarget);

  try {
    const { transformFile } = engineApi();

    const result = transformFile(source, filename, manifestJson);

    let code = result.hasComponents ? result.code : source;

    // Strip CSS imports from all files — both Rust-injected and hand-written
    code = code.replace(CSS_IMPORT_RE, '');

    // Re-inject the CSS import in root entry files only
    if (isRootEntry && !code.includes('.animus/styles.css')) {
      if (code.startsWith("'use client'") || code.startsWith('"use client"')) {
        // Keep the directive first; a directive-only file without a trailing
        // newline appends after it instead of demoting it.
        const nl = code.indexOf('\n');
        if (nl === -1) {
          code = `${code}\nimport '.animus/styles.css';\n`;
        } else {
          code = `${code.slice(0, nl + 1)}import '.animus/styles.css';\n${code.slice(nl + 1)}`;
        }
      } else {
        code = `import '.animus/styles.css';\n${code}`;
      }
    }

    return code;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    if (opts.strict) {
      throw new Error(
        `[animus-extract] Transform failed for ${filename}: ${msg}`,
        { cause: e }
      );
    }

    console.warn(`[animus-extract] Transform failed for ${filename}:`, msg);
    return source;
  }
}
