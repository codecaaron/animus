export interface AnimusNextOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /** Glob patterns to exclude from analysis. */
  exclude?: string[];
  /** When true, extraction failures throw instead of warning. */
  strict?: boolean;
  /** Enable verbose logging. */
  verbose?: boolean;
  /** Namespace prefix for CSS variables and class names. */
  prefix?: string;
  /**
   * Full `@layer` declaration order. Must include all 7 Animus layers
   * (`global`, `base`, `variants`, `compounds`, `states`, `system`, `custom`)
   * as a subsequence. Consumer layers may be interleaved.
   *
   * @example ['reset', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom', 'overrides']
   */
  layers?: string[];
}
