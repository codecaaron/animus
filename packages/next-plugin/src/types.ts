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
  /** Enable verbose logging. */
  verbose?: boolean;
  /** Namespace prefix for CSS variables and class names. */
  prefix?: string;
  /**
   * Extraction engine selection. `'v1'` (default) is the production engine;
   * `'v2'` routes all native extraction calls to the parity-gated rewrite
   * spine (in development — fails loud on surfaces it does not implement
   * yet). Propagated to every compiler instance, including non-owning ones.
   *
   * @default 'v1'
   */
  engine?: 'v1' | 'v2';
  /**
   * Full `@layer` declaration order. Must include all 7 Animus layers
   * (`global`, `base`, `variants`, `compounds`, `states`, `system`, `custom`)
   * as a subsequence. Consumer layers may be interleaved.
   *
   * @example ['reset', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom', 'overrides']
   */
  layers?: string[];
}
