import type { StaticCssConfig } from '@animus-ui/extract/pipeline';

export interface AnimusNextOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /** Glob patterns to exclude from analysis. */
  exclude?: string[];
  /**
   * File extensions to scan for component definitions and JSX usages.
   * Replaces the default list entirely (not additive). Include `.mdx` to
   * extract components rendered from MDX files — `@mdx-js/mdx` must be
   * installed as a peer for MDX files to be preprocessed; otherwise the
   * plugin warns once at buildStart and skips them.
   *
   * @default ['.ts', '.tsx', '.js', '.jsx', '.mdx']
   */
  extensions?: string[];
  /** When true, extraction failures throw instead of warning. */
  strict?: boolean;
  /**
   * Project-root-relative path of the single file that receives the
   * `import '.animus/styles.css'` injection (the stylesheet import is
   * stripped from every other file to prevent per-chunk CSS duplication).
   * Set this when your root entry doesn't match the default detection of
   * `app/layout.*` / `pages/_app.*`, optionally under `src/` — e.g. a
   * nested App Router root layout like `'src/app/[locale]/layout.tsx'`.
   */
  cssImportTarget?: string;
  /** Enable verbose logging. */
  verbose?: boolean;
  /** Namespace prefix for CSS variables and class names. */
  prefix?: string;
  /**
   * Forced-emission declarations for usage the scanner cannot observe
   * (CMS-driven variants, spread-hidden props, dynamically selected
   * components). Declared variants/states/system-prop values and custom
   * dynamic slots are emitted as if used; entries are labeled as forced
   * in the extraction report. Empty/absent is a no-op.
   */
  staticCss?: StaticCssConfig;
  /**
   * Browser targets for CSS autoprefixing and syntax lowering.
   * Accepts a browserslist query string or array of queries.
   * Falls back to project's browserslist config, then to `defaults`.
   */
  targets?: string | string[];
  /**
   * Control CSS minification of the emitted stylesheet.
   * - `true`: always minify (dev + prod)
   * - `false`: never minify (autoprefixing still applies)
   * - `undefined` (default): minify in production (`NODE_ENV === 'production'`)
   */
  minify?: boolean;
  /**
   * Extraction engine selection. `'v2'` is the only engine and the default,
   * propagated to every compiler instance (including non-owning ones). The v1
   * engine was retired (openspec: retire-extract-v1); configuring
   * `engine: 'v1'` (or setting `ANIMUS_ENGINE=v1`) throws — the selection is
   * never silently upgraded.
   *
   * @default 'v2'
   */
  engine?: 'v2';
  /**
   * Turbopack integration mode.
   *
   * - `'auto'` (default): activate whenever the process runs under
   *   Turbopack (Next sets the `TURBOPACK` environment variable for every
   *   Turbopack dev/build). Zero-config support for Next 16 defaults and
   *   `next dev --turbopack` on Next 15.
   * - `'on'`: always generate Turbopack wiring.
   * - `'off'`: webpack-only; no Turbopack keys are generated.
   *
   * When active, extraction runs during next.config resolution (the wrapped
   * config resolves asynchronously — Next awaits it), a dev watcher re-runs
   * analysis on source changes, and per-file transforms run in a stateless
   * loader fed by `.animus/` disk artifacts.
   */
  turbopack?: { mode?: 'auto' | 'on' | 'off' };
  /**
   * @deprecated Use `turbopack` — same shape. Honored for one release
   * cycle with a one-time warning; `turbopack` wins when both are set.
   */
  unstable_turbopack?: { mode?: 'off' | 'auto' | 'on' };
  /**
   * Full `@layer` declaration order. Must include all 7 Animus `anm-*`
   * layers (`anm-global`, `anm-base`, `anm-variants`, `anm-compounds`,
   * `anm-states`, `anm-system`, `anm-custom`) as a subsequence. Consumer
   * layers may be interleaved. Names are emitted as-is.
   *
   * @example ['reset', 'anm-global', 'anm-base', 'anm-variants', 'anm-compounds', 'anm-states', 'anm-system', 'anm-custom', 'overrides']
   */
  layers?: string[];
}
