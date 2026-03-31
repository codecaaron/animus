export interface AnimusNextOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /** Glob patterns to exclude from analysis. */
  exclude?: string[];
  /** Package name patterns to resolve and include in analysis. Defaults to ['@animus-ui/*']. */
  packagePatterns?: string[];
  /** When true, extraction failures throw instead of warning. */
  strict?: boolean;
  /** Enable verbose logging. */
  verbose?: boolean;
  /** Namespace prefix for CSS variables and class names. */
  prefix?: string;
}
