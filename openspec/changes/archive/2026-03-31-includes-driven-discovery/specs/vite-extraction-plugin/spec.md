# vite-extraction-plugin (MODIFIED)

## Changed Requirements

### REQ-MODIFIED: Package discovery source

**Was:** Scan all discovered source file contents for imports matching `packagePatterns` glob (default `@animus-ui/*`).

**Now:** Read the system entry file's import declarations. Filter to external package specifiers. Resolve and walk those packages only.

### REQ-REMOVED: `packagePatterns` option

The `packagePatterns` option is removed from `AnimusExtractOptions`. Discovery is driven entirely by the system entry file imports.
