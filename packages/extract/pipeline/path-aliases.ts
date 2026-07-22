/**
 * Path-alias normalization for the Rust-facing `pathAliasesJson` contract.
 *
 * This is the single authoritative encoder of the wire format
 * `{ aliases: [{ pattern, replacement, type }] }` consumed by
 * `analyzeProject` — both the Vite and Next.js plugins must build their
 * alias JSON through here (same convention as buildAnalyzeProjectArgs).
 * Each plugin only flattens its bundler's alias config into pairs.
 */

export interface PathAliasEntry {
  pattern: string;
  replacement: string;
  type: 'prefix' | 'exact';
}

export interface PathAliasPair {
  pattern: string;
  target: string;
  /**
   * Force a classification instead of sniffing the target for a file
   * extension. Vite's array-form aliases are always prefix matches.
   */
  kind?: 'prefix' | 'exact';
}

/**
 * Normalize alias pairs: strip a `rootDir` prefix from targets, classify
 * exact (file) vs prefix (directory) matches, force trailing slashes on
 * prefix entries, and sort longest pattern first for correct matching
 * priority. Returns null when no entries survive.
 */
export function buildPathAliasesJson(
  pairs: PathAliasPair[],
  rootDir: string
): { json: string; count: number } | null {
  const entries: PathAliasEntry[] = [];

  for (const { pattern, target, kind } of pairs) {
    const replacement = target.startsWith(rootDir)
      ? target.slice(rootDir.length + 1)
      : target;
    const isExact = kind ? kind === 'exact' : /\.\w+$/.test(replacement);
    if (isExact) {
      entries.push({ pattern, replacement, type: 'exact' });
    } else {
      entries.push({
        pattern: pattern.endsWith('/') ? pattern : pattern + '/',
        replacement: replacement.endsWith('/')
          ? replacement
          : replacement + '/',
        type: 'prefix',
      });
    }
  }

  entries.sort((a, b) => b.pattern.length - a.pattern.length);

  if (entries.length === 0) return null;
  return { json: JSON.stringify({ aliases: entries }), count: entries.length };
}
