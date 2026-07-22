import { relative } from 'path';

import { getManifestJson, engineApi } from './singleton';

type LoaderContext = {
  resourcePath: string;
  rootContext: string;
  getOptions: () => { strict?: boolean; cssImportTarget?: string };
};

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
 * the default filename-convention detection.
 */
function isCssImportTarget(
  filename: string,
  cssImportTarget: string | undefined
): boolean {
  if (cssImportTarget) {
    return normalizePath(filename) === normalizePath(cssImportTarget);
  }
  return ROOT_ENTRY_RE.test(filename);
}

/**
 * Webpack loader for Animus source transformation.
 * Runs with enforce: 'pre' to see original source before Babel/SWC.
 * Replaces builder chains with createComponent() calls using the pre-built manifest.
 *
 * CSS handling: the Rust emitter injects `import '.animus/styles.css'` into every
 * file with extracted components. Without intervention, webpack duplicates the full
 * stylesheet into every route chunk. This loader strips those imports and re-injects
 * a single CSS import in the root layout/app file, ensuring one copy for the whole app.
 */
export default function animusLoader(
  this: LoaderContext,
  source: string
): string {
  const manifestJson = getManifestJson();
  if (!manifestJson) return source;

  const filename = relative(this.rootContext, this.resourcePath);
  const opts = this.getOptions?.() ?? {};
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
        const nl = code.indexOf('\n');
        code = `${code.slice(0, nl + 1)}import '.animus/styles.css';\n${code.slice(nl + 1)}`;
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
