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
   * Extraction engine selection. `'v2'` (default) is the production
   * engine — parity-proven against v1 with 8× fewer parses and no cache
   * machinery. `'v1'` remains selectable and functional as the escape
   * hatch until v1 retires. Propagated to every compiler instance,
   * including non-owning ones.
   *
   * @default 'v2'
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
