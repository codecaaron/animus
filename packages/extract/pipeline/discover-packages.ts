import { readFileSync } from 'fs';

/**
 * Extract external DS package names from `.includes([...])` calls in the system file.
 *
 * Reads the system file source, finds `.includes([identifier, ...])` calls in the
 * builder chain, traces each identifier back to its import declaration, and returns
 * the import specifiers. This is the authoritative mechanism — only packages explicitly
 * declared via `.includes()` are treated as external DS dependencies.
 *
 * Falls back to empty array if no `.includes()` call is found.
 */
export function extractSystemFilePackages(systemFilePath: string): string[] {
  let source: string;
  try {
    source = readFileSync(systemFilePath, 'utf-8');
  } catch {
    return [];
  }

  // Find .includes([...]) calls — supports multiline, multiple identifiers
  const includesRegex = /\.includes\(\s*\[([^\]]*)\]\s*\)/gs;
  const identifiers = new Set<string>();

  let includesMatch: RegExpExecArray | null;
  while ((includesMatch = includesRegex.exec(source)) !== null) {
    const inner = includesMatch[1];
    // Extract comma-separated identifiers, trimming whitespace
    for (const token of inner.split(',')) {
      const id = token.trim();
      if (id && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id)) {
        identifiers.add(id);
      }
    }
  }

  if (identifiers.size === 0) return [];

  // Build a map of local identifier → import specifier
  // Handles: import { a } from '...', import d from '...', import d, { a } from '...'
  const importMap = new Map<string, string>();
  const importRegex =
    /^\s*import\s+(?:([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*)?(?:\{([^}]*)\}|([a-zA-Z_$][a-zA-Z0-9_$]*))\s+from\s+['"]([^'"]+)['"]/gm;

  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(source)) !== null) {
    const [, comboDefault, namedImports, defaultImport, specifier] =
      importMatch;

    // Combined: import ds, { helper } from '...'
    if (comboDefault) {
      importMap.set(comboDefault, specifier);
    }

    // Standalone: import ds from '...'
    if (defaultImport) {
      importMap.set(defaultImport, specifier);
    }

    if (namedImports) {
      // Handle `{ ds as testDs, system }` patterns
      for (const binding of namedImports.split(',')) {
        const parts = binding.trim().split(/\s+as\s+/);
        const localName = (parts[1] || parts[0]).trim();
        if (localName) {
          importMap.set(localName, specifier);
        }
      }
    }
  }

  // Resolve identifiers used in .includes() to their package specifiers
  const packages = new Set<string>();
  for (const id of identifiers) {
    const specifier = importMap.get(id);
    if (specifier && !specifier.startsWith('.')) {
      // Normalize to package name (strip subpath)
      const pkgName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      packages.add(pkgName);
    }
  }

  return Array.from(packages);
}
