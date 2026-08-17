/**
 * Bundler-neutral loader policy shared by the webpack loader (manifest from
 * the process singleton) and the Turbopack loader (manifest hydrated from
 * disk artifacts). Owns the transform invocation, strict-mode error
 * handling, and the single-stylesheet-import policy.
 *
 * The one import below is the session's fs-free id vocabulary, already in
 * both loaders' own module graphs (`loader.ts`, `turbopack-loader.ts` both
 * import this specifier), so it adds nothing to the Turbopack worker scope
 * that guardrail G1 fences.
 */
import { ANIMUS_CSS_MODULE_ID } from '@animus-ui/extract/session';

export interface LoaderPolicyOptions {
  strict?: boolean;
  cssImportTarget?: string;
}

/**
 * The loader-runner context both Animus loaders receive. ONE contract, two
 * narrow views: Turbopack's loader-runner follows the webpack loader
 * contract (see `resolveTurbopackLoaderPath`), so these members carry the
 * same meaning under both runners. Each loader intersects this base with
 * the member only its own runner supplies — `mode` for webpack, `async`
 * for Turbopack — and the options half is already generic-and-extended
 * here (`TurbopackLoaderOptions extends LoaderPolicyOptions`).
 */
export interface LoaderContextBase<
  O extends LoaderPolicyOptions = LoaderPolicyOptions,
> {
  resourcePath: string;
  rootContext: string;
  getOptions: () => O;
  /** File-dependency registration — optional so bare policy tests can drive
   *  a loader without a full runner context. The per-runner registration
   *  semantics are commentary about the runner, not the type; they live at
   *  the use sites. */
  addDependency?: (file: string) => void;
}

/**
 * Regex matching CSS import lines injected by the Rust emitter.
 * Catches both the alias form (`import '.animus/styles.css'`),
 * relative forms (`import '../.animus/styles.css'`), and the Vite
 * virtual module form (`import 'virtual:animus/styles.css'`) which
 * appears in pre-built external packages compiled with the Vite plugin.
 *
 * Stays a literal pattern rather than a derivation of
 * `ANIMUS_CSS_MODULE_ID`: it matches a FAMILY of already-emitted forms
 * (arbitrary relative prefixes, plus the Vite emitter's own virtual id),
 * not this bundler's id — it is a reader of foreign output, not a second
 * spelling of the authority.
 */
const CSS_IMPORT_RE =
  /import\s+['"](?:[^'"]*\.animus\/styles\.css|virtual:animus\/styles\.css)['"];\n?/g;

/** The single stylesheet import this loader policy injects. */
const CSS_IMPORT_STATEMENT = `import '${ANIMUS_CSS_MODULE_ID}';\n`;

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
    if (isRootEntry && !code.includes(ANIMUS_CSS_MODULE_ID)) {
      if (code.startsWith("'use client'") || code.startsWith('"use client"')) {
        // Keep the directive first; a directive-only file without a trailing
        // newline appends after it instead of demoting it.
        const nl = code.indexOf('\n');
        if (nl === -1) {
          code = `${code}\n${CSS_IMPORT_STATEMENT}`;
        } else {
          code = `${code.slice(0, nl + 1)}${CSS_IMPORT_STATEMENT}${code.slice(nl + 1)}`;
        }
      } else {
        code = `${CSS_IMPORT_STATEMENT}${code}`;
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
