import type { StaticCssConfig } from '@animus-ui/extract/pipeline';

export interface AnimusNextOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /** Substrings, or globs when `*`/`?` present. Replaces `dist`/`.test.`/
   *  `.spec.`; `node_modules`, `.next` and `.animus` are always excluded. */
  exclude?: string[];
  /** Extensions scanned for definitions and usages; replaces the default
   *  `['.ts','.tsx','.js','.jsx','.mdx']`. `.mdx` needs `@mdx-js/mdx`. */
  extensions?: string[];
  /** When true, extraction failures throw instead of warning. */
  strict?: boolean;
  /** Project-root-relative path of the one file that receives the stylesheet
   *  import; replaces the `app/layout.*` / `pages/_app.*` detection. */
  cssImportTarget?: string;
  verbose?: boolean;
  /** Namespace prefix for CSS variables and class names. */
  prefix?: string;
  /** Forced-emission declarations for usage the scanner cannot observe
   *  (CMS-driven variants, spread-hidden props). Absent is a no-op. */
  staticCss?: StaticCssConfig;
  /** Browserslist query string or array. Falls back to the project's
   *  browserslist config, then to `defaults`. */
  targets?: string | string[];
  /** `true`/`false` force minification on or off; absent minifies in
   *  production. Autoprefixing applies either way. */
  minify?: boolean;
  /** Explicit emission mode, winning over the environment signal that
   *  otherwise decides minification and the dev-diagnostics define. */
  mode?: 'development' | 'production';
  /** `'v2'` is the only engine and the default. `engine: 'v1'` or
   *  `ANIMUS_ENGINE=v1` throws — the selection is never silently upgraded. */
  engine?: 'v2';
  /** `'auto'` (default) generates Turbopack wiring whenever the `TURBOPACK`
   *  environment variable is set; `'on'` always, `'off'` never. */
  turbopack?: { mode?: 'auto' | 'on' | 'off' };
  /** @deprecated Use `turbopack` — same shape, and it wins when both are
   *  set. This alias warns once. */
  unstable_turbopack?: { mode?: 'off' | 'auto' | 'on' };
  /** @internal Absolute path of a loader module registered in place of this
   *  package's own; feeds the needBuild loader-chain predicate. */
  loaderPath?: string;
  /** Full `@layer` declaration order, emitted as-is. Must contain the seven
   *  `anm-*` layers as a subsequence; consumer layers may be interleaved. */
  layers?: string[];
}
