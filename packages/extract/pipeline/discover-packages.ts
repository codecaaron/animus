import { readFileSync } from 'fs';

/**
 * Known non-DS packages that should never be treated as external DS dependencies.
 */
const KNOWN_SKIP = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'next',
  'next/image',
  'next/link',
  'next/router',
  'next/navigation',
  'vite',
  'lodash',
  'lodash-es',
]);

const KNOWN_SKIP_PREFIXES = ['@types/', 'node:'];

/**
 * Extract external DS package names from a system entry file's import declarations.
 *
 * Reads the file at `systemFilePath`, regex-extracts all `from '...'` / `from "..."`
 * import specifiers, filters out relative imports, the system framework package,
 * and known non-DS packages. Returns normalized package names (subpaths stripped).
 */
export function extractSystemFilePackages(systemFilePath: string): string[] {
  let source: string;
  try {
    source = readFileSync(systemFilePath, 'utf-8');
  } catch {
    return [];
  }

  const importRegex = /^\s*import\s.*from\s+['"]([^'"]+)['"]/gm;
  const packages = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(source)) !== null) {
    const specifier = match[1];

    // Skip relative imports
    if (specifier.startsWith('.')) continue;

    // Normalize to package name (strip subpath)
    const pkgName = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];

    // Skip the system framework package
    if (pkgName === '@animus-ui/system') continue;

    // Skip known non-DS packages
    if (KNOWN_SKIP.has(specifier) || KNOWN_SKIP.has(pkgName)) continue;

    // Skip known prefixes
    if (KNOWN_SKIP_PREFIXES.some((p) => specifier.startsWith(p))) continue;

    packages.add(pkgName);
  }

  return Array.from(packages);
}
